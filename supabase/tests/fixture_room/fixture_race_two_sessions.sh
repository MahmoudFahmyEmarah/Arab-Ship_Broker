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

# ── race 2: two handles for the same pairing, two sessions (C2O-013) ────────
# the owner matches its position a1 against the admin-owned cargo c3 twice: two
# different candidate keys for one pair; one room wins, the other gets FX_CONFLICT
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_c.log 2>&1 &
$(claims $U_OW1)
begin;
select public.create_fixture_room_from_candidate((select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('vessel', '$A1')) x where x->>'ref' = 'FXC-003'), '$TERMS'::jsonb, 'race-create-c', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_C=$!
sleep 1
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_d.log 2>&1 &
$(claims $U_OW1)
select public.create_fixture_room_from_candidate((select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('vessel', '$A1')) x where x->>'ref' = 'FXC-003'), '$TERMS'::jsonb, 'race-create-d', '{}'::jsonb);
SQL
PID_D=$!
wait $PID_C; wait $PID_D
ok "$(q "select count(*) from public.fixture_rooms where cargo_listing_id = '$C3' and vessel_availability_id = '$A1'")" "1" "exactly one room for the raced pairing (two handles)"
ok "$(grep -c 'FX_CONFLICT' /tmp/fxrace_d.log)" "1" "the second handle was refused with FX_CONFLICT"
WINNER=$(q "select id from public.fixture_rooms where cargo_listing_id = '$C3' and vessel_availability_id = '$A1'")
ok "$(grep -c "FX_CONFLICT: room $WINNER" /tmp/fxrace_d.log)" "1" "the loser's conflict names the winning room (the builder opens it)"

# ── race 3: listing update vs create (C2O-014 item 4, the TOCTOU window) ────
# free the C1/A1 pairing: close race 1's room
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /dev/null
$(claims $U_CH1)
select public.close_fixture_room('$ROOM', 'withdrawn', null, (select version from public.fixture_rooms where id = '$ROOM'), 'race-close');
SQL
# 3a · the update is in flight first: the create waits on the locked position, then sees it
#      no longer matches and refuses
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_e.log 2>&1 &
begin;
set local session_replication_role = replica;
update public.vessel_availability set open_date = current_date + 60 where id = '$A1';
select pg_sleep(4);
commit;
SQL
PID_E=$!
sleep 1
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_f.log 2>&1 &
$(claims $U_CH1)
select public.create_fixture_room_from_candidate((select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('cargo', '$C1')) x where x->>'name' = 'SEED VESSEL ONE'), '$TERMS'::jsonb, 'race-toctou-a', '{}'::jsonb);
SQL
PID_F=$!
wait $PID_E; wait $PID_F
ok "$(grep -c 'no longer matches' /tmp/fxrace_f.log)" "1" "a create racing an in-flight listing update waits, then refuses the invalid pair"
ok "$(q "select count(*) from public.fixture_rooms where cargo_listing_id = '$C1' and vessel_availability_id = '$A1' and status not in ('withdrawn', 'failed', 'expired')")" "0" "no room was opened on the invalidated pair"
q "set session_replication_role = replica; update public.vessel_availability set open_date = current_date + 5 where id = '$A1'" > /dev/null
# 3b · the create is in flight first: the listing update waits until the room exists
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_g.log 2>&1 &
$(claims $U_CH1)
begin;
select public.create_fixture_room_from_candidate((select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('cargo', '$C1')) x where x->>'name' = 'SEED VESSEL ONE'), '$TERMS'::jsonb, 'race-toctou-b', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_G=$!
sleep 2
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_h.log 2>&1 &
set lock_timeout = '1s';
set session_replication_role = replica;
update public.vessel_availability set open_date = current_date + 60 where id = '$A1';
SQL
PID_H=$!
wait $PID_G; wait $PID_H
ok "$(grep -c 'lock timeout' /tmp/fxrace_h.log)" "1" "a listing update racing an in-flight create waits on the locked position (lock timeout after 1 s)"
ok "$(grep -c 'ERROR' /tmp/fxrace_g.log)" "0" "the in-flight create completed"
ok "$(q "select count(*) from public.fixture_rooms where cargo_listing_id = '$C1' and vessel_availability_id = '$A1' and status not in ('withdrawn', 'failed', 'expired')")" "1" "the room exists on the pair that was valid when it was validated"

# ── helpers for races 4-7 ───────────────────────────────────────────────────
KEY_A1="(select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('cargo', '$C6')) x where x->>'name' = 'SEED VESSEL ONE')"
KEY_A3="(select (x->>'candidateKey')::uuid from jsonb_array_elements(public.list_fixture_match_candidates('cargo', '$C6')) x where x->>'name' = 'TBN')"
live_rooms() { q "select count(*) from public.fixture_rooms where cargo_listing_id = '$C6' and vessel_availability_id = '$1' and status not in ('withdrawn', 'failed', 'expired')"; }
close_live() { $PSQL -q -v ON_ERROR_STOP=1 <<SQL > /dev/null
$(claims $U_CH1)
select public.close_fixture_room(x.id, 'withdrawn', null, x.version, 'race-close-' || x.id) from public.fixture_rooms x
 where x.cargo_listing_id = '$C6' and x.vessel_availability_id = '$1' and x.status not in ('withdrawn', 'failed', 'expired');
SQL
}

# ── race 4: one actor, one idempotency key, two different pairs (C2O-015 item 1) ──
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_i.log 2>&1 &
$(claims $U_CH1)
begin;
select public.create_fixture_room_from_candidate($KEY_A1, '$TERMS'::jsonb, 'race-idem-pair', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_I=$!
sleep 1.5
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_j.log 2>&1 &
$(claims $U_CH1)
select public.create_fixture_room_from_candidate($KEY_A3, '$TERMS'::jsonb, 'race-idem-pair', '{}'::jsonb);
SQL
PID_J=$!
wait $PID_I; wait $PID_J
ok "$(grep -c 'FX_IDEMPOTENCY_MISMATCH' /tmp/fxrace_j.log)" "1" "the same key racing for a different pair is FX_IDEMPOTENCY_MISMATCH, never the winner's room"
ok "$(q "select count(*) from public.fixture_rooms where create_idempotency_key = 'race-idem-pair'")" "1" "exactly one room for that key"
ok "$(live_rooms '00000000-0000-4000-8000-0000000000b3')" "0" "no room on the loser's pair"
close_live "$A1"

# ── race 5: recreate vs listing update, both orders (C2O-015 item 2) ────────
TERMINAL=$(q "select id from public.fixture_rooms where create_idempotency_key = 'race-idem-pair'")
# 5a · the update (position no longer live) is in flight: the recreate waits, then refuses
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_k.log 2>&1 &
begin;
set local session_replication_role = replica;
update public.vessel_availability set status = 'FIXED' where id = '$A1';
select pg_sleep(4);
commit;
SQL
PID_K=$!
sleep 1.5
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_l.log 2>&1 &
$(claims $U_CH1)
select public.recreate_fixture_room('$TERMINAL', '$TERMS'::jsonb, 'race-recreate-a', '{}'::jsonb);
SQL
PID_L=$!
wait $PID_K; wait $PID_L
ok "$(grep -c 'not live on the market' /tmp/fxrace_l.log)" "1" "a recreate racing an in-flight listing update waits, then refuses the stale position"
ok "$(live_rooms "$A1")" "0" "no room from the stale position"
q "set session_replication_role = replica; update public.vessel_availability set status = 'OPEN' where id = '$A1'" > /dev/null
# 5b · the recreate is in flight: the listing update waits until the room exists
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_m.log 2>&1 &
$(claims $U_CH1)
begin;
select public.recreate_fixture_room('$TERMINAL', '$TERMS'::jsonb, 'race-recreate-b', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_M=$!
sleep 2
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_n.log 2>&1 &
set lock_timeout = '1s';
set session_replication_role = replica;
update public.vessel_availability set status = 'FIXED' where id = '$A1';
SQL
PID_N=$!
wait $PID_M; wait $PID_N
ok "$(grep -c 'lock timeout' /tmp/fxrace_n.log)" "1" "a listing update racing an in-flight recreate waits on the locked position"
ok "$(grep -c 'ERROR' /tmp/fxrace_m.log)" "0" "the in-flight recreate completed"
ok "$(live_rooms "$A1")" "1" "the recreated room exists on a position that was live when it was checked"
close_live "$A1"

# ── race 6: seat revocation vs create, both orders (C2O-015 item 3) ─────────
# 6a · the revocation is in flight: the create waits, then refuses (the member no longer represents c6)
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_o.log 2>&1 &
begin;
set local session_replication_role = replica;
update public.organization_members set is_current = false where org_id = '$ORG_CH' and user_id = '$U_CH1';
select pg_sleep(4);
commit;
SQL
PID_O=$!
sleep 1.5
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_p.log 2>&1 &
$(claims $U_CH1)
select public.create_fixture_room_from_candidate($KEY_A1, '$TERMS'::jsonb, 'race-seat-a', '{}'::jsonb);
SQL
PID_P=$!
wait $PID_O; wait $PID_P
ok "$(grep -cE 'FX_AUTH' /tmp/fxrace_p.log)" "1" "a create racing an in-flight seat revocation waits, then refuses"
ok "$(live_rooms "$A1")" "0" "no room created by the revoked seat"
q "set session_replication_role = replica; update public.organization_members set is_current = true where org_id = '$ORG_CH' and user_id = '$U_CH1'" > /dev/null
# 6b · the create is in flight: the revocation waits until the room exists
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_q.log 2>&1 &
$(claims $U_CH1)
begin;
select public.create_fixture_room_from_candidate($KEY_A1, '$TERMS'::jsonb, 'race-seat-b', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_Q=$!
sleep 2
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_r.log 2>&1 &
set lock_timeout = '1s';
set session_replication_role = replica;
update public.organization_members set is_current = false where org_id = '$ORG_CH' and user_id = '$U_CH1';
SQL
PID_R=$!
wait $PID_Q; wait $PID_R
ok "$(grep -c 'lock timeout' /tmp/fxrace_r.log)" "1" "a seat revocation racing an in-flight create waits until the room is committed"
ok "$(grep -c 'ERROR' /tmp/fxrace_q.log)" "0" "the in-flight create completed"
close_live "$A1"

# ── race 7: account deactivation vs create, both orders (C2O-015 item 3) ────
# 7a · the deactivation is in flight: the create waits, then refuses (the account is no actor)
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_s.log 2>&1 &
begin;
set local session_replication_role = replica;
update public.users set is_active = false where id = '$U_CH1';
select pg_sleep(4);
commit;
SQL
PID_S=$!
sleep 1.5
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_t.log 2>&1 &
$(claims $U_CH1)
select public.create_fixture_room_from_candidate($KEY_A1, '$TERMS'::jsonb, 'race-account-a', '{}'::jsonb);
SQL
PID_T=$!
wait $PID_S; wait $PID_T
ok "$(grep -c 'not active' /tmp/fxrace_t.log)" "1" "a create racing an in-flight account deactivation waits, then refuses"
ok "$(live_rooms "$A1")" "0" "no room created by the deactivated account"
q "set session_replication_role = replica; update public.users set is_active = true where id = '$U_CH1'" > /dev/null
# 7b · the create is in flight: the deactivation (or a tier change) waits until the room exists
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/fxrace_u.log 2>&1 &
$(claims $U_CH1)
begin;
select public.create_fixture_room_from_candidate($KEY_A1, '$TERMS'::jsonb, 'race-account-b', '{}'::jsonb);
select pg_sleep(4);
commit;
SQL
PID_U=$!
sleep 2
$PSQL -q -v ON_ERROR_STOP=0 <<SQL > /tmp/fxrace_v.log 2>&1 &
set lock_timeout = '1s';
set session_replication_role = replica;
update public.users set subscription_tier = 'T1' where id = '$U_CH1';
SQL
PID_V=$!
wait $PID_U; wait $PID_V
ok "$(grep -c 'lock timeout' /tmp/fxrace_v.log)" "1" "a tier change racing an in-flight create waits until the room is committed"
ok "$(grep -c 'ERROR' /tmp/fxrace_u.log)" "0" "the in-flight create completed"
close_live "$A1"

cleanup
if [ $fail = 0 ]; then echo "FIXTURE RACE (two sessions): ALL ASSERTIONS PASSED"; else echo "FIXTURE RACE (two sessions): FAILED"; echo "--- A"; cat /tmp/fxrace_a.log; echo "--- B"; cat /tmp/fxrace_b.log; echo "--- D"; cat /tmp/fxrace_d.log; exit 1; fi
