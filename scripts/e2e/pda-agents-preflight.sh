#!/usr/bin/env bash
# PDA agents staging · READ-ONLY preflight (Codex C2O-160 / C2O-162 P0-1). Writes nothing to any database: every
# statement runs with default_transaction_read_only=on. Run it first, alone, in an approved read-only window:
#
#   scripts/e2e/pda-agents-preflight.sh
#
# It proves the quarantined target before anything may write to it:
#   1. the recorded migration history equals the pinned released manifest (supabase/tests/e2e/staging-released-manifest.txt,
#      every repository version before Wave 8), line for line
#   2. the invariants (supabase/tests/e2e/pda-agents-preflight.sql): zero rows of every 15:27-run and runner identity
#      shape and no orphaned descendant across Auth, public, market_private and notifications; no Wave 8 / Agents
#      object; every named guard enabled; email dispatch off; beta_mode = true
#   3. the exact schema fingerprint and the exact data fingerprint (row digests), saved line by line
# Exit 0 prints the RECEIPT FIELDS line (head SHA, schema md5, data md5) for Codex to review and, on GO, pin in the
# one-use receipt the runner requires. Any mismatch exits 1 before anything else happens. Secrets are never printed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
. scripts/e2e/staging-target.sh

OUT="test-results/pda-agents-preflight/$(date +%Y%m%d-%H%M%S)"
echo "== PDA agents staging preflight, read-only ($(date +%H:%M:%S)) → $OUT"
measure "$OUT" || { echo "FAIL: a read-only measurement failed: $(cat "$OUT"/*.err 2>/dev/null | redact | tr '\n' ' ' | cut -c1-300)"; exit 1; }
BAD=0
if diff <(tr -d '\r' < supabase/tests/e2e/staging-released-manifest.txt) "$OUT/manifest.txt" > "$OUT/manifest.diff"; then
  echo "  ok   migration history = pinned released manifest ($(wc -l < "$OUT/manifest.txt") versions)"
else
  echo "  FAIL migration history differs from the pinned manifest (< pinned only, > staging only):"; sed 's/^/        /' "$OUT/manifest.diff" | head -20; BAD=1
fi
sed 's/^/  /' "$OUT/invariants.txt"
echo "  ..   scheduled jobs on the target (unstamped writes during a window fail the data fingerprint):"; cron_jobs | sed 's/^/        /'
[ "$(tail -1 "$OUT/invariants.txt")" = "PREFLIGHT INVARIANTS OK" ] || BAD=1
echo "  ..   schema fingerprint $SCHEMA_MD5 ($(wc -l < "$OUT/schema.txt") catalog lines), data fingerprint $DATA_MD5 ($(wc -l < "$OUT/data.txt") tables)"
if [ $BAD = 0 ]; then
  echo "RECEIPT FIELDS: SHA=$(git rev-parse HEAD) SCHEMA=$SCHEMA_MD5 DATA=$DATA_MD5"
  echo "== PREFLIGHT OK (read-only; nothing written)"; exit 0
fi
echo "== PREFLIGHT FAILED (read-only; nothing written). Report it; do not run the browser run."; exit 1
