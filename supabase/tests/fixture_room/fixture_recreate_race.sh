#!/usr/bin/env bash
# Fixture Room — two identical recreates, two REAL database sessions (C2O-094, 8 Oct 2026). Setup shared with
# fixture_race_two_sessions.sh (this header is copied from it). Proves: the second identical call waits on the
# (actor, key) and predecessor locks, then REPLAYS the first — never a refusal, never a second successor.
#
# (original header follows)
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
# Timing: each in-flight session names itself (application_name) and holds its locks inside a pg_sleep; its
# competitor first waits INSIDE the database until that session is sleeping (refreshing the per-transaction
# pg_stat_activity snapshot on every pass; RACE_SETUP if it never gets there) (refreshing the per-transaction
# pg_stat_activity snapshot on every pass; RACE_SETUP if it never gets there) — never a fixed shell delay, which a
# slow docker exec or candidate lookup on a loaded machine outruns.
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
U_OW1=00000000-0000-4000-8000-0000000000a3
C3=00000000-0000-4000-8000-0000000000e3
C6=00000000-0000-4000-8000-0000000000e6
ORG_CH=00000000-0000-4000-8000-0000000000c1
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
delete from public.fixture_access_log where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_access_log where user_id in (select id from public.users where email like '%@fixture.test');
delete from public.fixture_events where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_recap_versions where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_messages where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_subjects where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
update public.fixture_terms set cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, agreed_proposal_id = null, status = 'open' where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_proposals where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_terms where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_parties where room_id in (select id from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4')));
delete from public.fixture_rooms where (cargo_listing_id in ('$C1', '00000000-0000-4000-8000-0000000000e2', '$C3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$C6') or vessel_availability_id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4'));
delete from public.listing_ownership where listing_id in ('$C6', '$C1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5', '$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4');
delete from public.vessel_availability where id in ('$A1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '$A4');
delete from public.vessels where id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3');
delete from public.cargo_listings where id in ('$C6', '$C1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e5');
delete from public.contacts where id = '00000000-0000-4000-8000-0000000000d1';
delete from fixture_private.match_handles where actor_user_id in (select id from public.users where email like '%@fixture.test');
delete from public.organization_members where user_id in (select id from public.users where email like '%@fixture.test');
delete from public.users where email like '%@fixture.test';
delete from auth.users where email like '%@fixture.test';
delete from public.organizations where id in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000c5');
delete from public.ports where locode in ('ZZFXA', 'ZZFXB');
set session_replication_role = origin;
select public.fn_refresh_matches();
SQL
}
cleanup
{ echo 'begin;'; cat "$SEED"; echo 'commit;'; } | $PSQL -q -v ON_ERROR_STOP=1 > /dev/null || { echo "seed failed"; exit 1; }
# c6: a grain cargo of the charterer organisation that both the named hull (a1) and the TBN hull (a3) match
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /dev/null || { echo "c6 seed failed"; cleanup; exit 1; }
set session_replication_role = replica;
insert into public.cargo_listings (id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo,
  qty_min_mt, qty_max_mt, stowage_factor, load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone,
  laycan_from, laycan_to, is_spot, load_rate, disch_rate, load_terms, freight_idea_usd_mt, commission_pct, demurrage_rate) values
  ('$C6', 'FXC-006', 'IN', 'APPROVED', 'Dry Bulk', 'Soya beans', false, true, 29000, 31000, 1.30,
   'ZZFXA', 'Fixture Load Port', 'E.MED', 'ZZFXB', 'Fixture Disch Port', 'E.MED', current_date + 10, current_date + 20, false,
   '8000', '6000', 'FIOST', 26.00, 2.5, 12000) on conflict (id) do nothing;
insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason)
  values ('cargo', '$C6', '$U_CH1', '$ORG_CH', 'primary', true, 'initial_post') on conflict do nothing;
set session_replication_role = origin;
select public.fn_refresh_matches();
SQL

# ── a room at version 2, the charterer holding the pen ──────────────────────
ROOM=$($PSQL -At -v ON_ERROR_STOP=1 -q <<SQL | grep '^ROOM=' | cut -d= -f2
$(claims $U_CH1)
select 'ROOM=' || (public.create_fixture_room_from_candidate((select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('cargo', '$C1')) x where x->>'name' = 'SEED VESSEL ONE'), '$TERMS'::jsonb, 'race-create', '{}'::jsonb)->'data'->>'roomId');
SQL
)
[ -n "$ROOM" ] || { echo "room creation failed"; cleanup; exit 1; }
TERM=$(q "select id from public.fixture_terms where room_id = '$ROOM' and code = 'freight'")
VER=$(q "select version from public.fixture_rooms where id = '$ROOM'")
echo "room $ROOM at version $VER"

fail=0
ok() { if [ "$1" = "$2" ]; then echo "  ok   $3 ($1)"; else echo " FAIL  $3 — expected [$2] got [$1]"; fail=1; fi; }

# close it, so it can be started again
q "$(claims $U_CH1) select public.close_fixture_room('$ROOM', 'withdrawn', 'race', (select version from public.fixture_rooms where id = '$ROOM'), 'race-close-same')->>'ok'" > /dev/null
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrr_w.log 2>&1 &
set application_name = 'fxrr_w';
$(claims $U_CH1)
begin;
select public.recreate_fixture_room('$ROOM', '$TERMS'::jsonb, 'race-recreate-same', '{}'::jsonb)->>'replayed';
select pg_sleep(6);
commit;
SQL
PID_W=$!
$PSQL -At -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrr_x.log 2>&1 &
do \$w\$ declare ready boolean := false; begin for i in 1..600 loop perform pg_stat_clear_snapshot(); ready := exists (select 1 from pg_stat_activity where application_name = 'fxrr_w' and state = 'active' and query like '%pg_sleep%'); exit when ready; perform pg_sleep(0.05); end loop; if not ready then raise exception 'RACE_SETUP: fxrr_w never reached its sleep'; end if; end \$w\$;   -- wait, inside the database, until fxrr_w holds its locks
$(claims $U_CH1)
select public.recreate_fixture_room('$ROOM', '$TERMS'::jsonb, 'race-recreate-same', '{}'::jsonb)->>'replayed';
SQL
PID_X=$!
wait $PID_W; wait $PID_X
ok "$(grep -c 'ERROR' /tmp/fxrr_w.log)" "0" "the first identical recreate completed"
ok "$(grep -c 'ERROR' /tmp/fxrr_x.log)" "0" "the second identical recreate was not refused"
ok "$(grep -c '^true$' /tmp/fxrr_x.log)" "1" "the second identical recreate waited, then replayed the first"
ok "$(q "select count(*) from public.fixture_rooms where supersedes_room_id = '$ROOM'")" "1" "two identical recreates open exactly one successor"

cleanup
if [ $fail = 0 ]; then echo "FIXTURE RECREATE RACE (two sessions): ALL ASSERTIONS PASSED"; else echo "FIXTURE RECREATE RACE (two sessions): FAILED"; echo "--- W"; cat /tmp/fxrr_w.log; echo "--- X"; cat /tmp/fxrr_x.log; exit 1; fi
