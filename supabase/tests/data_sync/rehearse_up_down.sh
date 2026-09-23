#!/usr/bin/env bash
# Data Sync hardening — upgrade → smoke → downgrade → smoke → upgrade rehearsal
# on a DISPOSABLE database (20 Sep 2026). Never point this at production.
#
#   supabase/tests/data_sync/rehearse_up_down.sh [psql-command]
#
# Default psql: docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres
# Expects the database at the deployed state (through 20260918160000) with the
# four 20260920 migrations either applied or not — the script brings it to
# each state itself and checks function signatures after every step.
set -uo pipefail
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
fail=0
# 21 Sep 2026 — run_sql used to be
#   $PSQL … | grep -E "ERROR" && { echo FAIL; } || echo "  ok  "
# With `pipefail` the pipeline's status is psql's non-zero status whenever psql
# fails, so the `&&` branch was skipped and the `||` branch printed "ok" — for
# a real SQL error AND for a connection failure alike. That function could not
# report a failure at all, which made every "ok" line in this rehearsal empty.
# Output, exit code and error text are now captured and judged separately.
run_sql() {
  local out rc=0
  out="$($PSQL -q -v ON_ERROR_STOP=1 -1 -f - < "$1" 2>&1)" || rc=$?
  if [ $rc -ne 0 ]; then
    echo " FAIL  $1 — psql exited $rc"
    printf '%s\n' "$out" | grep -E "ERROR|FATAL|could not" | head -3 | sed 's/^/        /'
    fail=1; return 1
  fi
  if printf '%s' "$out" | grep -qE "ERROR|FATAL"; then
    echo " FAIL  $1 — error in output (psql exited 0)"
    printf '%s\n' "$out" | grep -E "ERROR|FATAL" | head -3 | sed 's/^/        /'
    fail=1; return 1
  fi
  echo "  ok   $1"; return 0
}
# A step whose failure makes everything after it meaningless.
require() { run_sql "$1" || { echo "REHEARSAL: ABORTED — $1 did not apply, later steps would be meaningless"; exit 1; }; }
smoke() { local out; out=$($PSQL -q -v ON_ERROR_STOP=1 -f - < "$1" 2>&1); if echo "$out" | grep -q "ALL ASSERTIONS PASSED"; then echo "  ok   $(basename "$1")"; else echo " FAIL  $(basename "$1")"; echo "$out" | grep ERROR | head -3; fail=1; fi; }
sigs() { $PSQL -At -c "select proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || left(md5(pg_get_functiondef(p.oid)),10) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('claim_sync_run','commit_sync_batch','regate_sync_batch','release_sync_run','set_email_checkpoint','undo_record_edits','undo_sync_batch','claim_sync_run_v2','set_email_checkpoint_v2','release_sync_run_v2','fn_sync_row_lock','claim_sync_upload_job','finish_sync_upload_job','fn_sync_lock_keys','fn_sync_reconcile_job_runs','fn_sync_email_schedule_outcome','fn_sync_alert_state') order by 1"; }
expect_sigs() { local got; got=$(sigs); if [ "$got" = "$1" ]; then echo "  ok   $2"; else echo " FAIL  $2"; diff <(echo "$1") <(echo "$got"); fail=1; fi; }
M=supabase/migrations; R=supabase/rollback; T=supabase/tests/data_sync
OLD_SMOKES="$T/phase7_intake_smoke.sql $T/phase8_batch_state_smoke.sql $T/phase9_gate_smoke.sql $T/phase10_fidelity_smoke.sql"
NEW_SMOKES="$T/lease_v2_smoke.sql $T/partial_commit_smoke.sql $T/undo_edits_matrix_smoke.sql $T/upload_jobs_health_smoke.sql $T/upload_lease_idempotency_smoke.sql $T/lock_order_smoke.sql $T/schedule_retry_alerts_smoke.sql"

# the deployed signatures (production, 19 Sep 2026)
DEPLOYED="claim_sync_run(p_source text, p_owner text, p_ttl_seconds integer) 3d79c523d9
commit_sync_batch(p_batch_id uuid, p_sheet text, p_row_ids uuid[]) 6ba6ad48ec
regate_sync_batch(p_batch_id uuid, p_channel text, p_actor text) 59bd88c836
release_sync_run(p_source text, p_owner text) 1c097c1213
set_email_checkpoint(p_owner text, p_uid_validity bigint, p_last_uid bigint, p_last_sync_at timestamp with time zone) 2ab463e58b
undo_record_edits(p_audit_id uuid, p_group_id uuid, p_actor uuid, p_force boolean) 908e0ed2dc
undo_sync_batch(p_batch_id uuid, p_force boolean, p_actor text) b28631c58a"

echo "── 1 · downgrade the four 20260920 migrations (newest first)"
require $R/20260920_sync_schedule_retry_and_alerts_down.sql
require $R/20260920_sync_upload_jobs_and_health_down.sql
require $R/20260920_sync_undo_edits_truthful_down.sql
require $R/20260920_sync_commit_serialization_down.sql
require $R/20260920_sync_lease_v2_down.sql
expect_sigs "$DEPLOYED" "after downgrade: signatures and bodies identical to production"
echo "── 2 · the four existing suites on the downgraded database"
for s in $OLD_SMOKES; do smoke "$s"; done

echo "── 3 · downgrade the 18 Sep phases too (their DOWN files are now executable)"
require $R/20260918_sync_phase4_5_down.sql
require $R/20260918_sync_regate_reports_failure_down.sql
require $R/20260918_sync_phase3_down.sql
require $R/20260918_sync_phase2_down.sql
require $R/20260918_sync_phase1_down.sql
require $R/20260918_sync_phase0_down.sql
$PSQL -At -c "select 'pre-hardening signatures: ' || string_agg(proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ' · ' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('commit_sync_batch','undo_sync_batch','undo_record_edits','claim_sync_run','regate_sync_batch','mark_sync_batch_failed')"
echo "── 4 · upgrade the 18 Sep phases again"
for f in $M/20260918100000_sync_phase0_failed_status.sql $M/20260918110000_sync_phase1_intake_durability.sql $M/20260918120000_sync_phase2_batch_state_machine.sql $M/20260918130000_sync_phase3_gate_mandatory.sql $M/20260918140000_sync_phase4_fidelity.sql $M/20260918150000_sync_phase5_scale.sql $M/20260918160000_sync_regate_reports_failure.sql; do require "$f"; done
expect_sigs "$DEPLOYED" "after re-upgrade: signatures and bodies identical to production"
for s in $OLD_SMOKES; do smoke "$s"; done

echo "── 5 · upgrade the four 20260920 migrations"
for f in $M/20260920100000_sync_lease_v2.sql $M/20260920110000_sync_commit_serialization.sql $M/20260920120000_sync_undo_edits_truthful.sql $M/20260920130000_sync_upload_jobs_and_health.sql $M/20260920140000_sync_schedule_retry_and_alerts.sql; do require "$f"; done
echo "── 6 · every suite on the upgraded database"
for s in $OLD_SMOKES $NEW_SMOKES; do smoke "$s"; done
if bash $T/commit_race_two_sessions.sh "$PSQL" 2>&1 | grep -q "ALL ASSERTIONS PASSED"; then echo "  ok   commit_race_two_sessions.sh"; else echo " FAIL  commit_race_two_sessions.sh"; fail=1; fi

if [ $fail = 0 ]; then echo "REHEARSAL: UP → SMOKE → DOWN → SMOKE → UP: ALL PASSED"; else echo "REHEARSAL: FAILED"; exit 1; fi
