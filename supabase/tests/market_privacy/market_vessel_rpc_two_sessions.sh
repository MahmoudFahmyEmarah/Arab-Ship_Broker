#!/usr/bin/env bash
# Real PostgreSQL sessions are queued behind the production per-IMO lock, then
# released together.  The proof covers two new-mode callers and the harder
# stale register_vessel check-then-insert race.
set -euo pipefail

cd "$(dirname "$0")/../../.."
PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
TMP="$(mktemp -d -t market-vessel-rpc-race.XXXXXX)"

ACTOR1=30000000-0000-4000-8000-000000000011
ACTOR2=30000000-0000-4000-8000-000000000012
IMO=9876529
REGISTER_IMO=9876555
PORT=ZZMVR
GATE_PID=
P1_PID=
P2_PID=
WRAPPER_PID=
REGISTER_PID=

cleanup() {
  local child_pid
  for child_pid in "$GATE_PID" "$P1_PID" "$P2_PID" "$WRAPPER_PID" "$REGISTER_PID"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  $PSQL -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL || true
set session_replication_role = replica;
delete from public.dq_gate_log
 where actor_id in ('$ACTOR1', '$ACTOR2')
   and table_name in ('vessels', 'vessel_availability');
delete from public.review_queue
 where listing_type::text = 'vessel_availability'
   and listing_id in (
     select a.id from public.vessel_availability a
      join public.vessels v on v.id = a.vessel_id
     where (
       v.imo_number = '$IMO'
       and v.vessel_name in ('RACE NEW HULL ONE', 'RACE NEW HULL TWO')
       and v.source_tag = 'user'
     ) or (
       v.imo_number = '$REGISTER_IMO'
       and v.vessel_name in ('RACE WRAPPER HULL', 'RACE REGISTER HULL')
       and (v.source_tag = 'user' or v.source_tag is null)
     )
   );
delete from public.listing_ownership
 where listing_type::text = 'vessel_availability'
   and listing_id in (
     select a.id from public.vessel_availability a
      join public.vessels v on v.id = a.vessel_id
     where (
       v.imo_number = '$IMO'
       and v.vessel_name in ('RACE NEW HULL ONE', 'RACE NEW HULL TWO')
       and v.source_tag = 'user'
     ) or (
       v.imo_number = '$REGISTER_IMO'
       and v.vessel_name in ('RACE WRAPPER HULL', 'RACE REGISTER HULL')
       and (v.source_tag = 'user' or v.source_tag is null)
     )
   );
delete from public.vessel_claims
 where vessel_id in (
   select id from public.vessels
    where (
      imo_number = '$IMO'
      and vessel_name in ('RACE NEW HULL ONE', 'RACE NEW HULL TWO')
      and source_tag = 'user'
    ) or (
      imo_number = '$REGISTER_IMO'
      and vessel_name in ('RACE WRAPPER HULL', 'RACE REGISTER HULL')
      and (source_tag = 'user' or source_tag is null)
    )
 );
delete from public.vessel_availability
 where vessel_id in (
   select id from public.vessels
    where (
      imo_number = '$IMO'
      and vessel_name in ('RACE NEW HULL ONE', 'RACE NEW HULL TWO')
      and source_tag = 'user'
    ) or (
      imo_number = '$REGISTER_IMO'
      and vessel_name in ('RACE WRAPPER HULL', 'RACE REGISTER HULL')
      and (source_tag = 'user' or source_tag is null)
    )
 );
delete from public.vessels
 where (
   imo_number = '$IMO'
   and vessel_name in ('RACE NEW HULL ONE', 'RACE NEW HULL TWO')
   and source_tag = 'user'
 ) or (
   imo_number = '$REGISTER_IMO'
   and vessel_name in ('RACE WRAPPER HULL', 'RACE REGISTER HULL')
   and (source_tag = 'user' or source_tag is null)
 );
delete from public.users
 where (id, email) in (
   ('$ACTOR1'::uuid, 'market-vessel-race-1@privacy.test'),
   ('$ACTOR2'::uuid, 'market-vessel-race-2@privacy.test')
 );
delete from auth.users
 where (id, email) in (
   ('$ACTOR1'::uuid, 'market-vessel-race-1@privacy.test'),
   ('$ACTOR2'::uuid, 'market-vessel-race-2@privacy.test')
 );
delete from public.ports
 where locode = '$PORT'
   and trade_name = 'Vessel RPC Race Port';
SQL
  rm -rf "$TMP"
}
trap cleanup EXIT
cleanup
mkdir -p "$TMP"

PREEXISTING="$($PSQL -qAt -v ON_ERROR_STOP=1 <<SQL
select count(*) from public.vessels where imo_number = '$IMO';
select count(*) from public.vessels where imo_number = '$REGISTER_IMO';
select count(*) from public.ports where locode = '$PORT';
SQL
)"
if [ "$PREEXISTING" != $'0\n0\n0' ]; then
  echo "FAIL: vessel RPC race fixture collides with a pre-existing IMO or port" >&2
  exit 1
fi

$PSQL -q -v ON_ERROR_STOP=1 <<SQL
set session_replication_role = replica;
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
 ('$ACTOR1','market-vessel-race-1@privacy.test','authenticated','authenticated','{"role":"member"}'),
 ('$ACTOR2','market-vessel-race-2@privacy.test','authenticated','authenticated','{"role":"member"}');
insert into public.users
 (id, supabase_user_id, email, full_name, company, role, subscription_tier, is_active)
values
 ('$ACTOR1','$ACTOR1','market-vessel-race-1@privacy.test','Vessel Race One','Race One','broker','T3',true),
 ('$ACTOR2','$ACTOR2','market-vessel-race-2@privacy.test','Vessel Race Two','Race Two','broker','T3',true);
insert into public.ports
 (locode, trade_name, country, zone, port_type, is_active, is_verified)
values ('$PORT','Vessel RPC Race Port','Egypt','E.MED','Sea Port',true,true);
set session_replication_role = origin;
SQL

wait_for_marker() {
  local target="$1" marker="$2"
  local i
  for ((i = 0; i < 800; i++)); do
    if grep -Fq "$marker" "$target" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$GATE_PID" 2>/dev/null; then
      echo "FAIL: IMO race gate exited before marker $marker" >&2
      tail -20 "$target" >&2 || true
      return 1
    fi
    sleep 0.025
  done
  echo "FAIL: timed out waiting for IMO race gate marker $marker" >&2
  tail -20 "$target" >&2 || true
  return 1
}

# Hold the exact production advisory key.  The holder announces when one
# caller is queued, waits until a second caller is queued on that same key, and
# only then releases them.  This makes contention a proven test precondition.
start_imo_gate() {
  local gate_imo="$1" gate_out="$2"
  $PSQL -qAt -v ON_ERROR_STOP=1 >"$gate_out" 2>&1 <<SQL &
set statement_timeout = '30s';
select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtextextended('market:vessel-imo:$gate_imo', 0)
);
\echo GATE_READY
do \$gate\$
declare
  v_waiters integer;
  v_announced boolean := false;
begin
  for i in 1..800 loop
    select count(*) into v_waiters
      from pg_catalog.pg_locks held
      join pg_catalog.pg_locks waiting
        on waiting.locktype = held.locktype
       and waiting.database is not distinct from held.database
       and waiting.classid is not distinct from held.classid
       and waiting.objid is not distinct from held.objid
       and waiting.objsubid is not distinct from held.objsubid
     where held.pid = pg_catalog.pg_backend_pid()
       and held.locktype = 'advisory'
       and held.granted
       and waiting.pid <> held.pid
       and not waiting.granted;
    if v_waiters >= 1 and not v_announced then
      raise notice 'GATE_ONE_WAITER';
      v_announced := true;
    end if;
    if v_waiters >= 2 then
      return;
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  raise exception 'IMO race gate timed out before two waiters arrived';
end
\$gate\$;
select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('market:vessel-imo:$gate_imo', 0)
);
SQL
  GATE_PID=$!
  wait_for_marker "$gate_out" GATE_READY
}

make_session() {
  local actor="$1" label="$2" target="$3" imo="$4"
  cat > "$target" <<SQL
\set VERBOSITY verbose
begin;
set local statement_timeout = '30s';
set local lock_timeout = '25s';
select set_config('request.jwt.claim.sub','$actor',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"$actor","role":"authenticated","app_metadata":{"role":"member"}}',
  true
);
set local role authenticated;
select public.create_vessel_position(jsonb_build_object(
  'entry_mode', 'new',
  'vessel', jsonb_build_object(
    'name', '$label',
    'imo', '$imo',
    'type', 'Bulk Carrier',
    'dwt', '28100',
    'built', '2021',
    'flag', 'Malta'
  ),
  'availability', jsonb_build_object(
    'status', 'OPEN',
    'open_port_locode', '$PORT',
    'open_from', (current_date + 7)::text
  ),
  'notes', '$label'
));
commit;
SQL
}

make_session "$ACTOR1" 'RACE NEW HULL ONE' "$TMP/session-1.sql" "$IMO"
make_session "$ACTOR2" 'RACE NEW HULL TWO' "$TMP/session-2.sql" "$IMO"

start_imo_gate "$IMO" "$TMP/gate-wrapper.out"
set +e
$PSQL -qAt -v ON_ERROR_STOP=1 < "$TMP/session-1.sql" > "$TMP/session-1.out" 2>&1 & P1_PID=$!
set -e
wait_for_marker "$TMP/gate-wrapper.out" GATE_ONE_WAITER
set +e
$PSQL -qAt -v ON_ERROR_STOP=1 < "$TMP/session-2.sql" > "$TMP/session-2.out" 2>&1 & P2_PID=$!
wait "$P1_PID"; r1=$?; P1_PID=
wait "$P2_PID"; r2=$?; P2_PID=
wait "$GATE_PID"; gate_rc=$?
GATE_PID=
set -e

if [ "$gate_rc" != 0 ]; then
  echo "FAIL: same-IMO wrapper gate failed" >&2
  tail -20 "$TMP/gate-wrapper.out" >&2 || true
  exit 1
fi

if [ "$r1" = 0 ] && [ "$r2" != 0 ]; then
  WINNER="$ACTOR1"; LOSER="$ACTOR2"; WINNER_NAME='RACE NEW HULL ONE'; LOSER_OUT="$TMP/session-2.out"
elif [ "$r2" = 0 ] && [ "$r1" != 0 ]; then
  WINNER="$ACTOR2"; LOSER="$ACTOR1"; WINNER_NAME='RACE NEW HULL TWO'; LOSER_OUT="$TMP/session-1.out"
else
  echo "FAIL: expected exactly one successful same-IMO creator, got exit $r1/$r2" >&2
  tail -20 "$TMP/session-1.out" >&2 || true
  tail -20 "$TMP/session-2.out" >&2 || true
  exit 1
fi

grep -Fq 'MARKET_AUTH:' "$LOSER_OUT" || {
  echo "FAIL: same-IMO waiter did not receive MARKET_AUTH" >&2
  tail -20 "$LOSER_OUT" >&2 || true
  exit 1
}

COUNTS=$($PSQL -qAt -v ON_ERROR_STOP=1 -F '|' -c "
select
  (select count(*) from public.vessels where imo_number = '$IMO'),
  (select count(*) from public.vessel_claims vc join public.vessels v on v.id = vc.vessel_id where v.imo_number = '$IMO'),
  (select count(*) from public.vessel_availability a join public.vessels v on v.id = a.vessel_id where v.imo_number = '$IMO'),
  (select count(*) from public.listing_ownership lo join public.vessel_availability a on a.id = lo.listing_id join public.vessels v on v.id = a.vessel_id where lo.listing_type::text = 'vessel_availability' and v.imo_number = '$IMO'),
  (select count(*) from public.vessel_claims vc join public.vessels v on v.id = vc.vessel_id where v.imo_number = '$IMO' and vc.user_id = '$WINNER'),
  (select count(*) from public.vessel_claims vc join public.vessels v on v.id = vc.vessel_id where v.imo_number = '$IMO' and vc.user_id = '$LOSER'),
  (select count(*) from public.listing_ownership lo join public.vessel_availability a on a.id = lo.listing_id join public.vessels v on v.id = a.vessel_id where lo.listing_type::text = 'vessel_availability' and v.imo_number = '$IMO' and lo.owner_user_id = '$WINNER'),
  (select count(*) from public.listing_ownership lo join public.vessel_availability a on a.id = lo.listing_id join public.vessels v on v.id = a.vessel_id where lo.listing_type::text = 'vessel_availability' and v.imo_number = '$IMO' and lo.owner_user_id = '$LOSER'),
  (select vessel_name from public.vessels where imo_number = '$IMO');")

[ "$COUNTS" = "1|1|1|1|1|0|1|0|$WINNER_NAME" ] || {
  echo "FAIL: race left an unexpected vessel/claim/availability/ownership graph: $COUNTS" >&2
  exit 1
}

make_register_session() {
  local actor="$1" target="$2"
  cat > "$target" <<SQL
\set VERBOSITY verbose
begin;
set local statement_timeout = '30s';
set local lock_timeout = '25s';
select set_config('request.jwt.claim.sub','$actor',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"$actor","role":"authenticated","app_metadata":{"role":"member"}}',
  true
);
set local role authenticated;
select public.register_vessel(jsonb_build_object(
  'vessel_name', 'RACE REGISTER HULL',
  'imo_number', '$REGISTER_IMO',
  'vessel_type', 'Bulk Carrier',
  'dwt_grain', '28200',
  'build_year', '2020',
  'flag', 'Liberia'
));
commit;
SQL
}

# Queue the wrapper first on the exact production IMO key.  register_vessel
# then completes its historical "absent" read and blocks in the new BEFORE
# INSERT guard.  Releasing the holder forces the wrapper to commit first; the
# stale register insert must wake, recheck, and fail 23505.
make_session "$ACTOR1" 'RACE WRAPPER HULL' "$TMP/wrapper-register.sql" "$REGISTER_IMO"
make_register_session "$ACTOR2" "$TMP/register.sql"
start_imo_gate "$REGISTER_IMO" "$TMP/gate-register.out"
set +e
$PSQL -qAt -v ON_ERROR_STOP=1 < "$TMP/wrapper-register.sql" > "$TMP/wrapper-register.out" 2>&1 & WRAPPER_PID=$!
set -e
wait_for_marker "$TMP/gate-register.out" GATE_ONE_WAITER
set +e
$PSQL -qAt -v ON_ERROR_STOP=1 < "$TMP/register.sql" > "$TMP/register.out" 2>&1 & REGISTER_PID=$!
wait "$WRAPPER_PID"; wrapper_rc=$?; WRAPPER_PID=
wait "$REGISTER_PID"; register_rc=$?; REGISTER_PID=
wait "$GATE_PID"; register_gate_rc=$?
GATE_PID=
set -e

if [ "$register_gate_rc" != 0 ] || [ "$wrapper_rc" != 0 ] || [ "$register_rc" = 0 ]; then
  echo "FAIL: expected queued wrapper success and stale register_vessel failure, got gate/wrapper/register $register_gate_rc/$wrapper_rc/$register_rc" >&2
  tail -20 "$TMP/gate-register.out" >&2 || true
  tail -20 "$TMP/wrapper-register.out" >&2 || true
  tail -20 "$TMP/register.out" >&2 || true
  exit 1
fi
grep -Fq '23505' "$TMP/register.out" || {
  echo "FAIL: stale register_vessel insert did not fail with duplicate SQLSTATE 23505" >&2
  tail -20 "$TMP/register.out" >&2 || true
  exit 1
}

REGISTER_COUNTS=$($PSQL -qAt -v ON_ERROR_STOP=1 -F '|' -c "
select
  (select count(*) from public.vessels where imo_number = '$REGISTER_IMO'),
  (select count(*) from public.vessel_claims vc join public.vessels v on v.id = vc.vessel_id where v.imo_number = '$REGISTER_IMO'),
  (select count(*) from public.vessel_availability a join public.vessels v on v.id = a.vessel_id where v.imo_number = '$REGISTER_IMO'),
  (select count(*) from public.listing_ownership lo join public.vessel_availability a on a.id = lo.listing_id join public.vessels v on v.id = a.vessel_id where lo.listing_type::text = 'vessel_availability' and v.imo_number = '$REGISTER_IMO'),
  (select count(*) from public.vessel_claims vc join public.vessels v on v.id = vc.vessel_id where v.imo_number = '$REGISTER_IMO' and vc.user_id = '$ACTOR1'),
  (select count(*) from public.vessel_claims vc join public.vessels v on v.id = vc.vessel_id where v.imo_number = '$REGISTER_IMO' and vc.user_id = '$ACTOR2'),
  (select vessel_name from public.vessels where imo_number = '$REGISTER_IMO');")

[ "$REGISTER_COUNTS" = "1|1|1|1|1|0|RACE WRAPPER HULL" ] || {
  echo "FAIL: wrapper/register race left an unexpected graph: $REGISTER_COUNTS" >&2
  exit 1
}

echo "  ok   same-IMO new-mode race produced one hull and one exact owner"
echo "  ok   waiter was denied before claim, availability, ownership, or vessel mutation"
echo "  ok   register_vessel completed its stale absent-read while both writers were queued"
echo "  ok   stale register insert rechecked under the shared IMO guard and failed 23505"
echo "MARKET VESSEL RPC TWO SESSIONS: 4/4 passed"
