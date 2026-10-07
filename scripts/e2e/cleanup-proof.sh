#!/usr/bin/env bash
# Proof of e2e/fixture-room.helpers.ts#cleanupSql on the ISOLATED asb_fixture database; every case is rolled back.
#   A  a full e2e seed with a real room (events, proposals, messages, parties) is removed; guards are back on; FKs never off
#   B  naming a non-e2e account is refused (E2E_GUARD) and nothing is removed
#   C  an unlisted dependent row (billing_customers -> users, ON DELETE RESTRICT) fails the whole transaction
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d asb_fixture -X -q -v ON_ERROR_STOP=1"
SEED=supabase/tests/fixture_room/seed_fixture_shape.sql
E2E_USERS="00000000-0000-4000-8000-00000000e0a1,00000000-0000-4000-8000-00000000e0a2"
SEED_USER="00000000-0000-4000-8000-0000000000a1"   # u_ch1 of the suite seed: not an e2e account
fail() { echo "PROOF FAIL: $*"; exit 1; }
cleanup() { npx tsx scripts/e2e/print-cleanup.ts "$1"; }
ASSERT_A="do \$\$ begin
  if exists (select 1 from auth.users where email like 'e2e-fx-%-proof@arabshipbroker.test') or exists (select 1 from public.users where email like 'e2e-fx-%-proof@arabshipbroker.test')
     or exists (select 1 from public.cargo_listings where ref = 'E2EFX-proof') or exists (select 1 from public.vessels where vessel_name = 'E2E HULL PROOF')
     or exists (select 1 from public.organizations where name like 'E2E % proof') or exists (select 1 from public.fixture_rooms where cargo_listing_id = '00000000-0000-4000-8000-00000000e0e1')
     or exists (select 1 from public.fixture_events e where e.payload::text like '%e2e-proof%' or e.idempotency_key like 'e2e-proof%')
     or exists (select 1 from public.listing_ownership where listing_id in ('00000000-0000-4000-8000-00000000e0e1','00000000-0000-4000-8000-00000000e0b1')) then
    raise exception 'A: residue after the teardown'; end if;
  if exists (select 1 from pg_trigger where tgname like 'trg_fixture_%immutable' and tgenabled <> 'O') then raise exception 'A: a guard stayed disabled'; end if;
  if exists (select 1 from public.users where id = '$SEED_USER') is not true then raise exception 'A: a non-e2e row was removed'; end if;
  raise notice 'A ok: e2e seed, room ledger, ownership removed; guards enabled; suite seed untouched';
end \$\$;"
# A (the transaction's own BEGIN/ROLLBACK wrap seed + rows + cleanup + asserts)
out=$({ echo "begin;"; cat "$SEED"; cat scripts/e2e/cleanup-proof-rows.sql; cleanup "$E2E_USERS"; echo "$ASSERT_A"; echo "rollback;"; } | $PSQL 2>&1); rc=$?
echo "$out" | grep -E "NOTICE|ERROR" | sed 's/^psql:<stdin>:[0-9]*: //' | grep -v "does not exist, skipping"
[ $rc = 0 ] && echo "$out" | grep -q "A ok" || fail "case A (rc=$rc)"
# B
out=$({ echo "begin;"; cat "$SEED"; cat scripts/e2e/cleanup-proof-rows.sql; cleanup "$E2E_USERS,$SEED_USER"; echo "rollback;"; } | $PSQL 2>&1); rc=$?
echo "$out" | grep -E "ERROR" | sed 's/^psql:<stdin>:[0-9]*: //'
[ $rc != 0 ] && echo "$out" | grep -q "E2E_GUARD: a named user is not an e2e account" || fail "case B must be refused by the guard (rc=$rc)"
echo "B ok: a non-e2e account in the list is refused before anything is removed"
# C
out=$({ echo "begin;"; cat "$SEED"; cat scripts/e2e/cleanup-proof-rows.sql; echo "insert into public.billing_customers (user_id, legal_name) values ('00000000-0000-4000-8000-00000000e0a1', 'E2E proof');"; cleanup "$E2E_USERS"; echo "rollback;"; } | $PSQL 2>&1); rc=$?
echo "$out" | grep -E "ERROR" | sed 's/^psql:<stdin>:[0-9]*: //'
[ $rc != 0 ] && echo "$out" | grep -qi "foreign key" || fail "case C must fail on the restricting foreign key (rc=$rc)"
echo "C ok: an unlisted dependent row fails the transaction (foreign keys stay enforced, no replica mode)"
# afterwards: nothing committed, every guard enabled
n=$($PSQL -At -c "select count(*) from pg_trigger where tgname like 'trg_fixture_%immutable' and tgenabled = 'O'")
r=$($PSQL -At -c "select count(*) from public.users where email like 'e2e-fx-%-proof@arabshipbroker.test'")
echo "after: fixture guards enabled=$n, proof users left=$r"
[ "$r" = 0 ] && [ "$n" -ge 6 ] || fail "state after the proof"
echo "E2E CLEANUP PROOF: OK"
