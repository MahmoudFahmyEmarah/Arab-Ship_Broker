#!/usr/bin/env bash
# Proof of e2e/e2e-cleanup.ts#cleanupSql on the ISOLATED asb_e2e database (scripts/e2e/build-proof-db.sh); every case
# runs in its own transaction and is rolled back.
#   A  a full e2e seed — a room with an agreed term, a proposal chain, a PDA-link chain with a self link, and a
#      successor room — is removed; the six guards are enabled after; the suite seed is untouched
#   B  naming a non-e2e account is refused (E2E_GUARD) and nothing is removed
#   C  an unlisted dependent row (billing_customers -> users, RESTRICT) fails the whole transaction
#   D  target binding: rows absent in teardown mode are refused (E2E_TARGET); absent in replay mode is the proved
#      replay state; a mixed state is refused in replay mode
#   E  a guard already disabled before the teardown is refused (E2E_GUARD)
#   G  (with the notification core) an affected staff digest batch keeps a legitimate item; one left empty goes
set -uo pipefail
cd "$(dirname "$0")/../.."
DB="${E2E_PROOF_DB:-asb_e2e}"
case "$DB" in postgres|template*) echo "refusing to run the proof on $DB"; exit 2;; esac
PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d $DB -X -q -v ON_ERROR_STOP=1"
SEED=supabase/tests/fixture_room/seed_fixture_shape.sql
ROWS=scripts/e2e/cleanup-proof-rows.sql
E2E_USERS="00000000-0000-4000-8000-00000000e0a1,00000000-0000-4000-8000-00000000e0a2"
GHOST="00000000-0000-4000-8000-00000000e0a9"          # an e2e-looking id that is not on the database
SEED_USER="00000000-0000-4000-8000-0000000000a1"      # u_ch1 of the suite seed: not an e2e account
fail() { echo "PROOF FAIL: $*"; exit 1; }
cleanup() { npx tsx scripts/e2e/print-cleanup.ts "$@"; }
show() { echo "$1" | grep -E "NOTICE|ERROR" | sed 's/^psql:<stdin>:[0-9]*: //' | grep -v "does not exist, skipping"; }
ASSERT_A="do \$\$ begin
  if exists (select 1 from auth.users where email like 'e2e-fx-%-proof@arabshipbroker.test') or exists (select 1 from public.users where email like 'e2e-fx-%-proof@arabshipbroker.test')
     or exists (select 1 from public.cargo_listings where ref = 'E2EFX-proof') or exists (select 1 from public.vessels where vessel_name = 'E2E HULL PROOF')
     or exists (select 1 from public.organizations where name like 'E2E % proof')
     or exists (select 1 from public.fixture_rooms where cargo_listing_id = '00000000-0000-4000-8000-00000000e0e1')
     or exists (select 1 from public.fixture_pda_links l join public.pda_estimates e on e.id = l.pda_estimate_id where e.terminal_name = 'proof quay')
     or exists (select 1 from public.fixture_events where idempotency_key like 'e2e-proof%')
     or exists (select 1 from public.fixture_proposals p join public.fixture_terms t on t.id = p.term_id where t.room_id not in (select id from public.fixture_rooms))
     or exists (select 1 from public.listing_ownership where listing_id in ('00000000-0000-4000-8000-00000000e0e1','00000000-0000-4000-8000-00000000e0b1')) then
    raise exception 'A: residue after the teardown'; end if;
  if (select count(*) from pg_trigger where tgname like 'trg_fixture_%immutable' and tgenabled = 'O') <> 6 then raise exception 'A: a guard is not enabled'; end if;
  if to_regclass('public.notifications') is not null then
    if exists (select 1 from pg_trigger where tgname = 'notifications_snapshot_guard' and tgenabled <> 'O') then raise exception 'A: the notification guard is not enabled'; end if;
    if exists (select 1 from public.notifications where payload->>'roomId' in (select id::text from public.fixture_rooms where cargo_listing_id = '00000000-0000-4000-8000-00000000e0e1'))
       or exists (select 1 from public.notifications n where n.kind like 'fixture.%' and n.recipient_user_id = '00000000-0000-4000-8000-0000000000a5') then
      raise exception 'A: a notification about the run survived (staff included)'; end if;
    raise notice 'A notifications: the run''s notifications (the e2e accounts'' and staff''s) removed; the core''s guard enabled';
  end if;
  if not exists (select 1 from public.users where id = '$SEED_USER') or not exists (select 1 from public.pda_estimates where terminal_name = 'proof quay') then raise exception 'A: a non-e2e row was removed'; end if;
  raise notice 'A ok: agreed term, proposal chain, PDA-link chain (self link), successor room and the e2e seed removed; guards enabled; non-e2e rows untouched';
end \$\$;"
run() { { echo "begin;"; cat "$SEED"; "$@"; echo "rollback;"; } | $PSQL 2>&1; }

# A
out=$(run eval 'cat "$ROWS"; cleanup teardown "$E2E_USERS"; echo "$ASSERT_A"'); rc=$?; show "$out"
[ $rc = 0 ] && echo "$out" | grep -q "A ok" || fail "case A (rc=$rc)"
# B
out=$(run eval 'cat "$ROWS"; cleanup teardown "$E2E_USERS,$SEED_USER"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -q "E2E_GUARD: a named user is not an e2e account" || fail "case B (rc=$rc)"
echo "B ok: a non-e2e account in the list is refused before anything is removed"
# C
out=$(run eval 'cat "$ROWS"; echo "insert into public.billing_customers (user_id, legal_name) values ('"'"'00000000-0000-4000-8000-00000000e0a1'"'"', '"'"'E2E proof'"'"');"; cleanup teardown "$E2E_USERS"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -qi "violates foreign key" || fail "case C (rc=$rc)"
echo "C ok: an unlisted dependent row fails the transaction (foreign keys stay enforced)"
# D
out=$(run eval 'cleanup teardown "$E2E_USERS"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -q "E2E_TARGET: 0 of 7 named rows" || fail "case D1: absent rows must be refused in teardown mode (rc=$rc)"
out=$(run eval 'cleanup replay "$E2E_USERS"; echo "do \$\$ begin raise notice '"'"'D2 replay accepted'"'"'; end \$\$;"'); rc=$?; show "$out"
[ $rc = 0 ] && echo "$out" | grep -q "D2 replay accepted" || fail "case D2: all-absent is the proved replay state (rc=$rc)"
out=$(run eval 'cat "$ROWS"; cleanup replay "$E2E_USERS,$GHOST"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -q "E2E_TARGET: replay found 7 of 8" || fail "case D3: a mixed state must be refused (rc=$rc)"
echo "D ok: absent rows refused on a first teardown; all-absent accepted only as a replay; a mixed state refused"
# E
out=$(run eval 'cat "$ROWS"; echo "alter table public.fixture_events disable trigger trg_fixture_events_immutable;"; cleanup teardown "$E2E_USERS"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -q "E2E_GUARD: the six Fixture append-only guards must exist and be enabled" || fail "case E (rc=$rc)"
echo "E ok: a guard already disabled before the teardown is refused"
# F · ports: this run's own port goes; a real port, or another run's e2e port, named in the list is refused
PORT_ROWS="insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified) values ('ZYP01', 'E2E Port proofstamp01 Load', 'Egypt', 'E.MED', 'Sea Port', true, true), ('ZYP02', 'Real Port', 'Egypt', 'E.MED', 'Sea Port', true, true), ('ZYP03', 'E2E Port otherrun0001 Load', 'Egypt', 'E.MED', 'Sea Port', true, true);"
out=$(run eval 'cat "$ROWS"; echo "$PORT_ROWS"; PROOF_PORTS=ZYP01 cleanup teardown "$E2E_USERS"; echo "do \$\$ begin if exists (select 1 from public.ports where locode = '"'"'ZYP01'"'"') or not exists (select 1 from public.ports where locode = '"'"'ZYP02'"'"') then raise exception '"'"'F1: own port must go, real port stay'"'"'; end if; raise notice '"'"'F1 ok'"'"'; end \$\$;"'); rc=$?; show "$out"
[ $rc = 0 ] && echo "$out" | grep -q "F1 ok" || fail "case F1: this run's port must be removed (rc=$rc)"
out=$(run eval 'cat "$ROWS"; echo "$PORT_ROWS"; PROOF_PORTS=ZYP01,ZYP02 cleanup teardown "$E2E_USERS"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -q "E2E_GUARD: a named port is not this run's e2e port" || fail "case F2: a real port must be refused (rc=$rc)"
out=$(run eval 'cat "$ROWS"; echo "$PORT_ROWS"; PROOF_PORTS=ZYP01,ZYP03 cleanup teardown "$E2E_USERS"'); rc=$?; show "$out"
[ $rc != 0 ] && echo "$out" | grep -q "E2E_GUARD: a named port is not this run's e2e port" || fail "case F3: another run's port must be refused (rc=$rc)"
echo "F ok: this run's port is removed; a real port or another run's e2e port in the list is refused"
# G · C2O-094 P1: a staff digest batch that also holds a legitimate item survives with it; one left empty is removed
STAFF="00000000-0000-4000-8000-0000000000a5"
G_LEGIT="select public.fn_notification_enqueue('$STAFF', 'proof.legit', 'proof:legit:g', 'Legit', 'Legit.', null, 'normal');
do \$\$ begin
  if not exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
                  where n.recipient_user_id = '$STAFF' and n.kind like 'fixture.%' and d.digest_batch_id is not null) then
    raise exception 'G: setup — the run gave the staff member no digest item'; end if;
  if not exists (select 1 from public.notification_deliveries a join public.notifications x on x.id = a.notification_id
                   join public.notification_deliveries b on b.digest_batch_id = a.digest_batch_id join public.notifications y on y.id = b.notification_id
                  where x.dedupe_key = 'proof:legit:g' and y.kind like 'fixture.%') then
    raise exception 'G: setup — the legitimate item must share a batch with a run item'; end if;
end \$\$;"
G_KEPT="do \$\$ begin
  if not exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
                   join public.notification_digest_batches b on b.id = d.digest_batch_id where n.dedupe_key = 'proof:legit:g') then
    raise exception 'G1: the batch holding a legitimate item must survive with it'; end if;
  raise notice 'G1 ok';
end \$\$;"
G_GONE="do \$\$ begin
  if exists (select 1 from public.notification_digest_batches b where b.recipient_user_id = '$STAFF'
              and not exists (select 1 from public.notification_deliveries d where d.digest_batch_id = b.id)) then
    raise exception 'G2: an affected staff batch was left empty'; end if;
  raise notice 'G2 ok';
end \$\$;"
if [ "$($PSQL -At -c "select to_regclass('public.notification_digest_batches') is not null")" = t ]; then
  out=$(run eval 'cat "$ROWS"; echo "$G_LEGIT"; cleanup teardown "$E2E_USERS"; echo "$G_KEPT"'); rc=$?; show "$out"
  [ $rc = 0 ] && echo "$out" | grep -q "G1 ok" || fail "case G1 (rc=$rc)"
  out=$(run eval 'cat "$ROWS"; cleanup teardown "$E2E_USERS"; echo "$G_GONE"'); rc=$?; show "$out"
  [ $rc = 0 ] && echo "$out" | grep -q "G2 ok" || fail "case G2 (rc=$rc)"
  echo "G ok: an affected staff digest batch keeps its legitimate item; one left empty is removed"
else
  echo "G skipped: no notification core on $DB"
fi
# nothing committed
n=$($PSQL -At -c "select count(*) from pg_trigger where tgname like 'trg_fixture_%immutable' and tgenabled = 'O'")
r=$($PSQL -At -c "select count(*) from public.users where email like 'e2e-fx-%-proof@arabshipbroker.test'")
echo "after: fixture guards enabled=$n, proof users left=$r"
[ "$r" = 0 ] && [ "$n" = 6 ] || fail "state after the proof"
echo "E2E CLEANUP PROOF: OK"
