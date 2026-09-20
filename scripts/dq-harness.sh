#!/usr/bin/env bash
# The Data Quality release's migration harness, in one place (21 Sep 2026).
#
#   scripts/dq-harness.sh [--target local|linked]
#
# Forward chain (A, D, B, C, E, F, G, H, I) → every smoke suite → the DOWN
# files newest-first → schema fingerprint comparison. The chain order is the
# migration order, which is not alphabetical by workstream letter: D (fix and
# undo safety) applies before B (finding lifecycle) because its version is
# older, and the harness must rehearse the order production will actually see.
#
# --target local   the disposable Supabase container (default). Safe, commits.
#                  The database is REBUILT to the pre-release state first, from
#                  repository artifacts only (scripts/db-rebuild.sh --before).
#                  That is not a convenience: the DOWN files deliberately keep
#                  data by renaming tables to *_bak_<version>, so a second run
#                  against the same database finds those names taken and every
#                  DOWN after the first failure is skipped — which reads as a
#                  fingerprint full of objects the DOWNs "failed to remove".
#                  Pass --no-rebuild to skip it when the baseline is already
#                  known good (and expect that trap if it is not).
# --target linked  ONE transaction against the linked project, conclusively
#                  rolled back. This is an OWNER GATE: it is not run from here.
#
# The allowed residue is the backup tables the A and B DOWN files deliberately
# leave behind (dq_issues_dedup_backup, *_bak_20260919*) — the fingerprint
# comparison ignores exactly those lines and nothing else.
set -uo pipefail
cd "$(dirname "$0")/.."
TARGET=local
REBUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --no-rebuild) REBUILD=0; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

FIRST=20260919100000   # the release's first migration: the baseline stops here

M=supabase/migrations
T=supabase/tests/data_quality
R=supabase/rollback

CHAIN=(
  "$M/20260919100000_dq_a_evaluator_boundary.sql"
  "$M/20260919110000_dq_d_fix_undo_safety.sql"
  "$M/20260919120000_dq_b_finding_lifecycle.sql"
  "$M/20260919130000_dq_c_run_integrity.sql"
  "$M/20260919140000_dq_e_policy_and_audit.sql"
  "$M/20260919150000_dq_f_performance.sql"
  "$M/20260919160000_dq_g_notifications.sql"
  "$M/20260919170000_dq_h_scaling.sql"
  "$M/20260919180000_dq_i_restricted_paths.sql"
)
SMOKES=(
  "$T/dq_a_boundary_smoke.sql"
  "$T/dq_d_fix_undo_smoke.sql"
  "$T/dq_b_lifecycle_smoke.sql"
  "$T/dq_c_run_integrity_smoke.sql"
  "$T/dq_e_policy_smoke.sql"
  "$T/dq_f_performance_smoke.sql"
  "$T/dq_g_notifications_smoke.sql"
  "$T/dq_h_scaling_smoke.sql"
  "$T/dq_i_restricted_paths_smoke.sql"
  "$T/dq_retry_accounting_smoke.sql"
  "$T/dq_engine_failure_state_smoke.sql"
  "$T/dq_security_smoke.sql"
)
DOWNS=(   # newest first
  "$R/20260919_dq_i_down.sql"
  "$R/20260919_dq_h_down.sql"
  "$R/20260919_dq_g_down.sql"
  "$R/20260919_dq_f_down.sql"
  "$R/20260919_dq_e_down.sql"
  "$R/20260919_dq_c_down.sql"
  "$R/20260919_dq_b_down.sql"
  "$R/20260919_dq_d_down.sql"
  "$R/20260919_dq_a_down.sql"
)

if [ "$TARGET" = local ] && [ $REBUILD -eq 1 ]; then
  echo "── 0 · rebuilding the disposable database to the state before $FIRST"
  if ! bash scripts/db-rebuild.sh --before "$FIRST" > /tmp/dq-harness-rebuild.log 2>&1; then
    echo " FAIL  the baseline rebuild failed; the harness would measure against an unknown schema"
    tail -12 /tmp/dq-harness-rebuild.log
    exit 1
  fi
  tail -2 /tmp/dq-harness-rebuild.log | sed 's/^/  /'
fi

# The backup tables the DOWN files keep on purpose.
RESIDUE='dq_issues_dedup_backup|_bak_20260919'

if [ "$TARGET" = linked ]; then
  # One known repository-vs-production difference, declared rather than hidden.
  #
  # Production's dq_save_rule is 3987 bytes (md5 8d8a5f02...); the body
  # 20260908130000 creates is 4085 (md5 e0439baf...). Stripped of comments and
  # blank lines the two are IDENTICAL — the difference is one comment line and
  # the line endings carrying it. The repository is simply wrong about what was
  # applied, and correcting it would mean editing a migration that is already
  # live, which this project forbids.
  #
  # So the linked run tolerates this ONE function and nothing else. The local
  # run does not: it still requires an exact match, so any real change to
  # dq_save_rule fails there. Remove this the next time that migration is
  # legitimately superseded.
  RESIDUE="$RESIDUE|function dq_save_rule\\("
fi

exec bash scripts/migration-harness.sh --target "$TARGET" \
  --allow-residue "$RESIDUE" \
  --chain "${CHAIN[@]}" --smokes "${SMOKES[@]}" --downs "${DOWNS[@]}"
