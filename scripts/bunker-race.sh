#!/usr/bin/env bash
# Fuel Bar two-session idempotency proof (Codex audit C2B-002 #3).
#
#   bash scripts/bunker-race.sh [database]      (default asb_bunker; never postgres)
#
# Two member sessions submit the same clientRef at the same moment; each holds
# its transaction open for 3 s. Expected:
#   R1 identical command  -> exactly one quote; one session duplicate=false,
#                            the other waits, then replays duplicate=true;
#   R2 different content  -> one session succeeds, the other gets 23505;
#   neither run surfaces a raw unique-index violation.
# Seed rows are committed (sessions must see each other) and removed at the end.
set -uo pipefail
DB="${1:-asb_bunker}"
[ "$DB" = "postgres" ] && { echo "refusing: run on an isolated database"; exit 2; }
C=supabase_db_arab-ship-broker
PSQL="docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qAt"
U=00000000-0000-4000-a000-00000000ace1
SUP=00000000-0000-4000-b000-00000000ace1
TMP="$(mktemp -d)"
# One fixed expiry for both sessions: the command hash includes validUntil.
VU="$(date -u -d '+10 days' +%Y-%m-%dT%H:00:00Z)"
cleanup() {
  $PSQL >/dev/null 2>&1 <<SQL
set session_replication_role = replica;
delete from public.bunker_quote_events where supplier_id = '$SUP';
delete from public.bunker_quotes where supplier_id = '$SUP';
delete from public.bunker_supplier_members where supplier_id = '$SUP';
delete from public.bunker_supplier_ports where supplier_id = '$SUP';
delete from public.bunker_suppliers where id = '$SUP';
delete from public.users where id = '$U';
delete from auth.users where id = '$U';
SQL
  rm -rf "$TMP"
}
trap cleanup EXIT
cleanup; TMP="$(mktemp -d)"

$PSQL <<SQL >/dev/null || { echo "seed failed"; exit 1; }
insert into auth.users (id, email) values ('$U', 'src-bunker-race@example.invalid');
insert into public.users (id, supabase_user_id, email, full_name, role, is_active)
values ('$U', '$U', 'src-bunker-race@example.invalid', 'src:bunker-race', 'user', true)
on conflict (id) do update set is_active = true;
insert into public.bunker_suppliers (id, name, status, verified) values ('$SUP', 'src:bunker-race supplier', 'enabled', false);
insert into public.bunker_supplier_ports (supplier_id, port_locode, is_primary) values ('$SUP', 'GRPIR', true);
insert into public.bunker_supplier_members (supplier_id, user_id, role) values ('$SUP', '$U', 'editor');
SQL

session() { # $1 out-file  $2 clientRef  $3 price
  docker exec -i $C psql -U postgres -d "$DB" -qAt > "$1" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"$U"}', true) as claims \gset
select coalesce(r->'results'->0->>'duplicate', 'none') || ' ' || (r->'results'->0->>'quoteId')
  from (select public.supplier_upsert_quotes(jsonb_build_array(jsonb_build_object(
    'portLocode','GRPIR','productKey','VLSFO','priceUsdMt',$3,'clientRef','$2',
    'validUntil','$VU'))) as r) x;
select pg_sleep(3);
commit;
SQL
}

fail=0
run() { # $1 label $2 ref $3 priceA $4 priceB
  session "$TMP/a" "$2" "$3" & local pa=$!
  sleep 0.3
  session "$TMP/b" "$2" "$4" & local pb=$!
  wait $pa; wait $pb
  echo "  $1 session A: $(tr '\n' ' ' < "$TMP/a")"
  echo "  $1 session B: $(tr '\n' ' ' < "$TMP/b")"
}

echo "── R1 · same clientRef, identical command, concurrent"
run R1 race-same 610 610
n=$($PSQL -c "select count(*) from public.bunker_quotes where supplier_id = '$SUP' and client_ref = 'race-same'")
if grep -q "^false " "$TMP/a" && grep -q "^true " "$TMP/b" && [ "$n" = 1 ] \
   && [ "$(grep -E '^(true|false) ' "$TMP/a" | cut -d' ' -f2)" = "$(grep -E '^(true|false) ' "$TMP/b" | cut -d' ' -f2)" ]; then
  echo "  ok   one quote; the second session replayed the first's quote id"
else echo "  FAIL R1 (rows=$n)"; fail=1; fi

echo "── R2 · same clientRef, different price, concurrent"
run R2 race-diff 611 612
n=$($PSQL -c "select count(*) from public.bunker_quotes where supplier_id = '$SUP' and client_ref = 'race-diff'")
if grep -q "^false " "$TMP/a" && grep -q "already used for a different quote" "$TMP/b" && [ "$n" = 1 ] \
   && ! grep -q "duplicate key value" "$TMP/a" "$TMP/b"; then
  echo "  ok   first wins; the second is refused with the clientRef message, not a raw index error"
else echo "  FAIL R2 (rows=$n)"; fail=1; fi

[ $fail = 0 ] && echo "BUNKER RACE: OK" || { echo "BUNKER RACE: FAILED"; exit 1; }
