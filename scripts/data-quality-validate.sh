#!/usr/bin/env bash
# Data Quality — the whole validation set, in one place (21 Sep 2026).
#
#   scripts/data-quality-validate.sh [--sql-only|--ts-only] [--no-harness]
#
# Runs, and reports honestly:
#   · every Data Quality TypeScript check (exit code, not output shape)
#   · the DOWN-fidelity check, which compares every DOWN file's restored
#     function bodies with what the migrations actually created
#   · the migration harness on the DISPOSABLE database: rebuild to the
#     pre-release state, forward chain, every SQL smoke suite, the DOWN chain
#     newest-first, and a schema fingerprint that must match the baseline
#
# Exit 0 only when everything passed. Nothing here touches production, and
# nothing here runs the LINKED harness — that is an owner gate, printed at the
# end rather than run.
#
# The harness rebuilds the disposable database from repository artifacts each
# time. That is slow (minutes) and deliberate: the DOWN files keep data by
# renaming tables to *_bak_<version>, so a second run against the same
# database finds those names taken, every DOWN after the first failure is
# skipped, and the fingerprint fills with objects the DOWNs "failed to
# remove". Use --no-harness for a fast TypeScript-only pass.
set -uo pipefail
MODE=all
HARNESS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --sql-only) MODE=sql; shift;;
    --ts-only)  MODE=ts;  shift;;
    --no-harness) HARNESS=0; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
cd "$(dirname "$0")/.."
fail=0
say() { printf '%s\n' "$*"; }

TS_CHECKS=(
  scripts/dq-a-check.ts
  scripts/dq-authz-check.ts
  scripts/dq-b-check.ts
  scripts/dq-c-check.ts
  scripts/dq-e-check.ts
  scripts/dq-f-check.ts
  scripts/dq-g-check.ts
  scripts/dq-write-paths-check.ts
  scripts/dq-cron-budget-check.ts
  scripts/dq-engine-resilience-check.ts
)

if [ "$MODE" != sql ]; then
  say "── TypeScript checks"
  for f in "${TS_CHECKS[@]}"; do
    n="$(basename "$f" .ts)"
    out="$(npx tsx "$f" 2>&1)"; rc=$?
    count="$(printf '%s' "$out" | grep -oE '[0-9]+ passed, [0-9]+ failed' | tail -1)"
    if [ $rc -eq 0 ]; then say "  ok   ${n}${count:+  ($count)}"; else say " FAIL  $n (exit $rc)"; printf '%s\n' "$out" | grep -E "FAIL|Error" | head -4; fail=1; fi
  done

  say "── DOWN fidelity (every restored body matches what its migration created)"
  out="$(node scripts/down-fidelity-check.mjs 2>&1)"; rc=$?
  count="$(printf '%s' "$out" | grep -oE '[0-9]+ passed, [0-9]+ failed' | tail -1)"
  if [ $rc -eq 0 ]; then say "  ok   down-fidelity-check  ($count)"; else say " FAIL  down-fidelity-check"; printf '%s\n' "$out" | grep "FAIL" | head -6; fail=1; fi
fi

if [ "$MODE" != ts ] && [ $HARNESS -eq 1 ]; then
  say "── migration harness (disposable database: rebuild, chain, smokes, downs, fingerprint)"
  out="$(bash scripts/dq-harness.sh --target local 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q "HARNESS: OK"; then
    printf '%s\n' "$out" | grep -E "^  ok   (2026|dq_)" | sed 's/^/  /'
    say "  ok   $(printf '%s' "$out" | grep -o 'HARNESS: OK.*')"
  else
    say " FAIL  the harness did not pass"
    printf '%s\n' "$out" | grep -E "FAIL|differs" | head -10
    fail=1
  fi
fi

say ""
if [ $fail = 0 ]; then
  say "DATA QUALITY VALIDATION: ALL PASSED"
  say ""
  say "Still to run, by the owner, against the linked project:"
  say "  bash scripts/release-check.sh supabase/releases/dq-20260919.txt --isolated   (read-only)"
  say "  bash scripts/dq-harness.sh --target linked                                   (one rolled-back transaction)"
else
  say "DATA QUALITY VALIDATION: FAILED"
  exit 1
fi
