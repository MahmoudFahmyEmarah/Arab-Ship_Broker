#!/usr/bin/env bash
# Data Sync hardening — the commit race, with two REAL database sessions
# (20 Sep 2026). Proves P0-2 of 20260920110000_sync_commit_serialization.sql:
# two batches committing the same absent key at the same time end with
# exactly one 'insert' audit and one 'update' audit whose before-image is
# the winner's row; undoing either batch leaves the other's truth intact.
#
#   supabase/tests/data_sync/commit_race_two_sessions.sh [psql-command]
#
# Default psql: docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres
# (the local disposable database). Run it ONLY against a disposable database:
# the two sessions COMMIT (a race cannot be rolled back), and the script
# cleans its own rows up afterwards.
set -euo pipefail
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
KEY="ZZRC1"
q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }

# ── clean slate ─────────────────────────────────────────────────────────────
cleanup() {
  $PSQL -q -v ON_ERROR_STOP=0 <<SQL >/dev/null 2>&1 || true
delete from public.sync_commit_audit where batch_id in (select id from public.sync_batch where label like 'RACE-%');
delete from public.sync_staged_row  where batch_id in (select id from public.sync_batch where label like 'RACE-%');
alter table public.sync_batch disable trigger trg_sync_batch_discard_guard;
delete from public.sync_batch where label like 'RACE-%';
alter table public.sync_batch enable trigger trg_sync_batch_discard_guard;
delete from public.ports where locode = '$KEY';
SQL
}
cleanup

# ── two gated batches, each staging the same NEW key ─────────────────────────
$PSQL -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare b1 uuid; b2 uuid; p jsonb; v timestamptz := public.fn_dq_rules_version();
begin
  insert into public.sync_batch (source, label, status) values ('upload', 'RACE-A', 'gated') returning id into b1;
  insert into public.sync_batch (source, label, status) values ('upload', 'RACE-B', 'gated') returning id into b2;
  p := jsonb_build_object('locode', '$KEY', 'trade_name', 'Race A', 'country', 'Testland', 'zone', 'E.MED');
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, gate_status, gate_payload_hash, gate_rules_version, gated_at)
  values (b1, '04_PORTS', 'ports', 'locode', '$KEY', 'new', p, 1, 'ok', md5(p::text), v, now());
  p := jsonb_build_object('locode', '$KEY', 'trade_name', 'Race B', 'country', 'Testland', 'zone', 'W.MED');
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, row_index, gate_status, gate_payload_hash, gate_rules_version, gated_at)
  values (b2, '04_PORTS', 'ports', 'locode', '$KEY', 'new', p, 1, 'ok', md5(p::text), v, now());
end \$\$;
SQL
B1=$(q "select id from public.sync_batch where label = 'RACE-A'")
B2=$(q "select id from public.sync_batch where label = 'RACE-B'")

# ── the race: session A commits and holds its transaction open for 4 s ──────
# Session B starts one second later. Without the row lock, B reads "no row"
# too and records a second insert. With it, B waits for A and records an
# update whose before-image is A's row.
$PSQL -q -v ON_ERROR_STOP=1 <<SQL > /tmp/race_a.log 2>&1 &
begin;
select public.commit_sync_batch('$B1'::uuid);
select pg_sleep(4);
commit;
SQL
PID_A=$!
sleep 1
$PSQL -q -v ON_ERROR_STOP=1 -c "select public.commit_sync_batch('$B2'::uuid);" > /tmp/race_b.log 2>&1 &
PID_B=$!
wait $PID_A; wait $PID_B

# ── assertions ──────────────────────────────────────────────────────────────
fail=0
ok() { if [ "$1" = "$2" ]; then echo "  ok   $3 ($1)"; else echo " FAIL  $3 — expected [$2] got [$1]"; fail=1; fi; }

ok "$(q "select count(*) from public.sync_commit_audit where business_key = '$KEY' and undone_at is null and op = 'insert'")" "1" "exactly one audit operation is insert"
ok "$(q "select count(*) from public.sync_commit_audit where business_key = '$KEY' and undone_at is null and op = 'update' and before is not null")" "1" "the other is an update with a non-null before-image"
ok "$(q "select op from public.sync_commit_audit where batch_id = '$B1' and business_key = '$KEY'")" "insert" "the first session (A) holds the insert"
ok "$(q "select before->>'trade_name' from public.sync_commit_audit where batch_id = '$B2' and business_key = '$KEY'")" "Race A" "B's before-image is A's row"
ok "$(q "select count(*) from public.ports where locode = '$KEY'")" "1" "one live row"
ok "$(q "select trade_name from public.ports where locode = '$KEY'")" "Race B" "the live row carries the later payload"
ok "$(q "select status from public.sync_batch where id = '$B1'")" "committed" "batch A committed"
ok "$(q "select status from public.sync_batch where id = '$B2'")" "committed" "batch B committed"

# undo the second (losing) batch: A's state remains
q "select public.undo_sync_batch('$B2'::uuid, false, 'race')" > /dev/null
ok "$(q "select count(*) from public.ports where locode = '$KEY'")" "1" "after undoing B the row still exists"
ok "$(q "select trade_name from public.ports where locode = '$KEY'")" "Race A" "…with A's values restored"
ok "$(q "select status from public.sync_batch where id = '$B2'")" "undone" "batch B undone"

# undo the first batch: the inserted row is removed
q "select public.undo_sync_batch('$B1'::uuid, false, 'race')" > /dev/null
ok "$(q "select count(*) from public.ports where locode = '$KEY'")" "0" "after undoing A the inserted row is gone"
ok "$(q "select status from public.sync_batch where id = '$B1'")" "undone" "batch A undone"
ok "$(q "select count(*) from public.sync_commit_audit where business_key = '$KEY' and undone_at is null")" "0" "no active audit rows remain"
ok "$(q "select count(*) from (select staged_row_id from public.sync_commit_audit where business_key = '$KEY' group by 1 having count(*) > 1) d")" "0" "no duplicate audit rows per staged row"
ok "$(q "select count(*) from public.sync_staged_row where batch_id in ('$B1','$B2') and committed")" "0" "staged rows are uncommitted again"

cleanup
if [ $fail = 0 ]; then echo "COMMIT RACE (two sessions): ALL ASSERTIONS PASSED"; else echo "COMMIT RACE (two sessions): FAILED"; cat /tmp/race_a.log /tmp/race_b.log; exit 1; fi
