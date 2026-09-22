#!/usr/bin/env bash
# Data Sync — the whole validation set, in one place (21 Sep 2026).
#
#   scripts/data-sync-validate.sh [--sql-only|--ts-only] [psql-command]
#
# Runs, and reports honestly:
#   · every Data Sync TypeScript check (exit code, not output shape)
#   · every Data Sync SQL smoke suite on the DISPOSABLE database
#   · the two-session concurrency scripts (they COMMIT — disposable only)
#
# Exit 0 only when everything passed. Nothing here touches production.
#
# TRUST THE EXIT CODE, NOT A REDIRECTED LOG. The two-session scripts spawn
# background psql children that inherit stdout; when this script's output is
# redirected to a file those children write at their own offsets and can
# overwrite lines that were already there. A run seen on 21 Sep 2026 printed
# a corrupted "FAILED" verdict over an "ALL PASSED" one while every
# individual check said ok and the script itself exited 0. Redirect stderr
# separately and read $? — or let it print to a terminal.
set -uo pipefail
MODE="all"
case "${1:-}" in --sql-only) MODE=sql; shift;; --ts-only) MODE=ts; shift;; esac
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
cd "$(dirname "$0")/.."
fail=0
say() { printf '%s\n' "$*"; }

TS_CHECKS=(
  scripts/data-sync-unit-check.ts
  scripts/schedule-check.ts
  scripts/sync-phase0-check.ts
  scripts/sync-phase1-check.ts
  scripts/sync-phase2-check.ts
  scripts/sync-phase3-check.ts
  scripts/sync-phase4-check.ts
  scripts/sync-hardening-phase2-check.ts
  scripts/sync-batch-status-check.ts
  scripts/sync-imap-page-check.ts
  scripts/sync-run-check.ts
  scripts/sync-webhook-check.ts
  scripts/sync-whatsapp-check.ts
  scripts/sync-workbook-limits-check.ts
  scripts/sync-upload-jobs-check.ts
  scripts/sync-schedule-outcome-check.ts
)
SQL_SUITES=(
  supabase/tests/data_sync/phase7_intake_smoke.sql
  supabase/tests/data_sync/phase8_batch_state_smoke.sql
  supabase/tests/data_sync/phase9_gate_smoke.sql
  supabase/tests/data_sync/phase10_fidelity_smoke.sql
  supabase/tests/data_sync/lease_v2_smoke.sql
  supabase/tests/data_sync/partial_commit_smoke.sql
  supabase/tests/data_sync/undo_edits_matrix_smoke.sql
  supabase/tests/data_sync/upload_jobs_health_smoke.sql
  supabase/tests/data_sync/upload_lease_idempotency_smoke.sql
  supabase/tests/data_sync/lock_order_smoke.sql
  supabase/tests/data_sync/schedule_retry_alerts_smoke.sql
)
RACE_SCRIPTS=(
  supabase/tests/data_sync/commit_race_two_sessions.sh
  supabase/tests/data_sync/lock_order_two_sessions.sh
)

if [ "$MODE" != sql ]; then
  say "── TypeScript checks"
  for f in "${TS_CHECKS[@]}"; do
    n="$(basename "$f" .ts)"
    out="$(npx tsx "$f" 2>&1)"; rc=$?
    count="$(printf '%s' "$out" | grep -oE '[0-9]+ passed, [0-9]+ failed' | tail -1)"
    if [ $rc -eq 0 ]; then say "  ok   ${n}${count:+  ($count)}"; else say " FAIL  $n (exit $rc)"; printf '%s\n' "$out" | grep -E "FAIL|Error" | head -4; fail=1; fi
  done
fi

if [ "$MODE" != ts ]; then
  say "── SQL smoke suites (disposable database)"
  for s in "${SQL_SUITES[@]}"; do
    n="$(basename "$s")"
    if [ ! -f "$s" ]; then say " FAIL  $n (missing)"; fail=1; continue; fi
    out="$($PSQL -q -v ON_ERROR_STOP=1 -f - < "$s" 2>&1)"; rc=$?
    if [ $rc -ne 0 ]; then say " FAIL  $n (psql exit $rc)"; printf '%s\n' "$out" | grep -E "ERROR|FATAL" | head -3; fail=1; continue; fi
    if printf '%s' "$out" | grep -q "ALL ASSERTIONS PASSED"; then say "  ok   $n"; else say " FAIL  $n (no assertion marker)"; printf '%s\n' "$out" | grep -E "ERROR" | head -3; fail=1; fi
  done

  say "── two-session concurrency (these COMMIT: disposable database only)"
  for r in "${RACE_SCRIPTS[@]}"; do
    n="$(basename "$r")"
    out="$(bash "$r" "$PSQL" 2>&1)"; rc=$?
    if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q "ALL ASSERTIONS PASSED"; then say "  ok   $n"; else say " FAIL  $n"; printf '%s\n' "$out" | grep -E "FAIL" | head -4; fail=1; fi
  done
fi

if [ $fail = 0 ]; then say "DATA SYNC VALIDATION: ALL PASSED"; else say "DATA SYNC VALIDATION: FAILED"; exit 1; fi
