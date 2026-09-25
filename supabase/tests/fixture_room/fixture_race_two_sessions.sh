#!/usr/bin/env bash
# Fixture Room — optimistic concurrency with two REAL database sessions
# (23 Sep 2026). Proves the contract of architecture 1.0 §5.4:
#
#   1. Two commands from the same expected_version: session A submits a
#      proposal at version V and holds its transaction open for 4 s; session
#      B submits another proposal at the same V one second later. B waits on
#      the room's row lock, then finds the room at V+1 and is refused with
#      FX_VERSION_CONFLICT. Exactly one proposal.submitted event exists.
#   2. Two sessions creating a room for the same pairing: exactly one room
#      exists; the loser is refused with FX_CONFLICT.
#
#   supabase/tests/fixture_room/fixture_race_two_sessions.sh [psql-command]
#
# Default psql: docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres
# (the local disposable database). Run it ONLY against a disposable database:
# the sessions COMMIT (a race cannot be rolled back) and the seed rows are
# removed afterwards.
set -uo pipefail
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
cd "$(dirname "$0")/../../.."
SEED=supabase/tests/fixture_room/seed_fixture_shape.sql
U_CH1=00000000-0000-4000-8000-0000000000a1
C1=00000000-0000-4000-8000-0000000000e1
A1=00000000-0000-4000-8000-0000000000b1
A4=00000000-0000-4000-8000-0000000000b4
q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }
claims() { # session-scoped JWT claims for a seeded member
  printf "select set_config('request.jwt.claim.sub', '%s', false); select set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\",\"app_metadata\":{\"role\":\"member\"}}', false);\n" "$1" "$1"
}
# the exact v1 catalogue: create_fixture_room refuses anything else (FR-H2)
TERMS='[{"code":"cargo_grade","label":"Cargo & grade","category":"cargo","sortOrder":1,"valueKind":"text","required":true},{"code":"quantity","label":"Quantity","category":"cargo","sortOrder":2,"valueKind":"number","unit":"MT","required":true},{"code":"ports","label":"Load / discharge ports","category":"route","sortOrder":3,"valueKind":"port_pair","required":true},{"code":"laycan","label":"Laycan","category":"timing","sortOrder":4,"valueKind":"date_range","required":true},{"code":"ld_rates","label":"Load / discharge rates","category":"operations","sortOrder":5,"valueKind":"rate_pair","unit":"MT/day","required":true},{"code":"freight","label":"Freight & terms","category":"money","sortOrder":6,"valueKind":"money_per_mt","unit":"USD/MT","required":true}]'

# ── clean slate ─────────────────────────────────────────────────────────────
cleanup() {
  $PSQL -q -v ON_ERROR_STOP=0 <<SQL >/dev/null 2>&1 || true
set session_replication_role = replica;
delete from public.fixture_access_log where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_access_log where user_id in (select id from public.users where email like '%@fixture.test');
delete from public.fixture_events where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_recap_versions where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_messages where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_subjects where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
update public.fixture_terms set cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, agreed_proposal_id = null, status = 'open' where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_proposals where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_terms where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_parties where room_id in (select id from public.fixture_rooms where cargo_listing_id in ('$C1'));
delete from public.fixture_rooms where cargo_listing_id in ('$C1');
delete from public.listing_ownership where listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4');
delete from public.vessel_availability where id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4');
delete from public.vessels where id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3');
delete from public.cargo_listings where id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5');
delete from public.contacts where id = '00000000-0000-4000-8000-0000000000d1';
delete from public.organization_members where user_id in (select id from public.users where email like '%@fixture.test');
delete from public.users where email like '%@fixture.test';
delete from auth.users where email like '%@fixture.test';
delete from public.organizations where id in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000c5');
delete from public.ports where locode in ('ZZFXA', 'ZZFXB');
SQL
}
cleanup
{ echo 'begin;'; cat "$SEED"; echo 'commit;'; } | $PSQL -q -v ON_ERROR_STOP=1 > /dev/null || { echo "seed failed"; exit 1; }

# ── a room at version 2, the charterer holding the pen ──────────────────────
ROOM=$($PSQL -At -v ON_ERROR_STOP=1 -q <<SQL | grep '^ROOM=' | cut -d= -f2
$(claims $U_CH1)
select 'ROOM=' || (public.create_fixture_room('$C1', '$A1', '$TERMS'::jsonb, 'race-create', '{}'::jsonb)->'data'->>'roomId');
SQL
)
[ -n "$ROOM" ] || { echo "room creation failed"; cleanup; exit 1; }
TERM=$(q "select id from public.fixture_terms where room_id = '$ROOM' and code = 'freight'")
VER=$(q "select version from public.fixture_rooms where id = '$ROOM'")
echo "room $ROOM at version $VER"

# ── race 1: two proposals from the same expected_version ────────────────────
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_a.log 2>&1 &
$(claims $U_CH1)
begin;
select public.submit_fixture_proposal('$ROOM', '$TERM', '{"num": 24}'::jsonb, 'session A', false, null, $VER, 'race-bid-a');
select pg_sleep(4);
commit;
SQL
PID_A=$!
sleep 1
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_b.log 2>&1 &
$(claims $U_CH1)
select public.submit_fixture_proposal('$ROOM', '$TERM', '{"num": 23}'::jsonb, 'session B', false, null, $VER, 'race-bid-b');
SQL
PID_B=$!
wait $PID_A; wait $PID_B

fail=0
ok() { if [ "$1" = "$2" ]; then echo "  ok   $3 ($1)"; else echo " FAIL  $3 — expected [$2] got [$1]"; fail=1; fi; }
ok "$(q "select count(*) from public.fixture_events where room_id = '$ROOM' and type = 'proposal.submitted'")" "1" "exactly one proposal.submitted event"
ok "$(q "select count(*) from public.fixture_proposals where room_id = '$ROOM'")" "1" "exactly one proposal row"
ok "$(q "select version from public.fixture_rooms where id = '$ROOM'")" "$((VER + 1))" "the room advanced by exactly one version"
ok "$(q "select comment from public.fixture_proposals where room_id = '$ROOM'")" "session A" "the first session's proposal is the one that landed"
ok "$(grep -c 'FX_VERSION_CONFLICT' /tmp/fxrace_b.log)" "1" "session B was refused with FX_VERSION_CONFLICT"
ok "$(grep -c 'ERROR' /tmp/fxrace_a.log)" "0" "session A saw no error"

# ── race 2: two sessions creating the same pairing ──────────────────────────
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_c.log 2>&1 &
$(claims $U_CH1)
begin;
select public.create_fixture_room('$C1', '$A4', '$TERMS'::jsonb, 'race-create-c', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_C=$!
sleep 1
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_d.log 2>&1 &
$(claims $U_CH1)
select public.create_fixture_room('$C1', '$A4', '$TERMS'::jsonb, 'race-create-d', '{}'::jsonb);
SQL
PID_D=$!
wait $PID_C; wait $PID_D
ok "$(q "select count(*) from public.fixture_rooms where cargo_listing_id = '$C1' and vessel_availability_id = '$A4'")" "1" "exactly one room for the raced pairing"
ok "$(grep -c 'FX_CONFLICT' /tmp/fxrace_d.log)" "1" "the second creator was refused with FX_CONFLICT"

cleanup
if [ $fail = 0 ]; then echo "FIXTURE RACE (two sessions): ALL ASSERTIONS PASSED"; else echo "FIXTURE RACE (two sessions): FAILED"; echo "--- A"; cat /tmp/fxrace_a.log; echo "--- B"; cat /tmp/fxrace_b.log; echo "--- D"; cat /tmp/fxrace_d.log; exit 1; fi
