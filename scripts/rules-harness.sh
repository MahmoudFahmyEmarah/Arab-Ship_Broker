#!/usr/bin/env bash
# Stream R · reversible rules migration harness.
#
#   scripts/rules-harness.sh [--target local] [--from-applied] [--reapply]
#
# The database phase is deliberately limited to the three forward migrations,
# every SQL smoke suite under supabase/tests/rules, the single combined DOWN,
# and the shared migration-harness schema fingerprint.  The cross-runtime and
# two-session checks need their own processes/connections, so this wrapper does
# NOT run them.  After a successful local --reapply, run separately:
#
#   node --import tsx scripts/rules-check.ts
#   node --import tsx scripts/intelligence-rules-check.ts
#   node --import tsx scripts/matching-sql-parity-check.ts
#   node --import tsx scripts/matching-concurrency-check.ts
#   bash supabase/tests/rules/intelligence_race_two_sessions.sh
#
# Those hooks are release gates, not substitutes for the reversible database
# proof.  This harness deliberately refuses the shared local postgres database
# and linked projects: its rollback probes mutate matching sources inside a
# transaction and are authorised only on the isolated asb_rules database.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET=local
FROM_APPLIED=0
REAPPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --from-applied) FROM_APPLIED=1; shift;;
    --reapply) REAPPLY=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

if [ "$TARGET" != local ]; then
  echo "STOP  rules-harness is isolated-local only; --target must be local." >&2
  exit 2
fi

M=supabase/migrations
DOWN="supabase/rollback/20261003_rules_down.sql"
CHAIN=(
  "$M/20261003300000_matching_rules.sql"
  "$M/20261003310000_intelligence_rules_foundation.sql"
  "$M/20261003310100_intelligence_rules_seed.sql"
)
SMOKES=(
  "supabase/tests/rules/matching_contract.sql"
  "supabase/tests/rules/matching_behavior.sql"
  "supabase/tests/rules/intelligence_contract.sql"
  "supabase/tests/rules/intelligence_cross_runtime_parity.sql"
  "supabase/tests/rules/intelligence_rls.sql"
  "supabase/tests/rules/intelligence_anonymisation_tombstone.sql"
)

# psql runs inside the database container and cannot \i a host-side DOWN file.
# Expand the two transactional rollback probes on the host before handing them
# to migration-harness, which will stream each resulting file over stdin.
ROLLBACK_SMOKE_TMP="$(mktemp -d -t rules-rollback.XXXXXX)"
DOWN_TX_BODY="$ROLLBACK_SMOKE_TMP/20261003_rules_down_body.sql"
trap 'rm -f "$ROLLBACK_SMOKE_TMP/matching_rollback_unchanged.sql" "$ROLLBACK_SMOKE_TMP/matching_rollback_source_change.sql" "$DOWN_TX_BODY"; rmdir "$ROLLBACK_SMOKE_TMP" 2>/dev/null || true' EXIT

# The release DOWN is deliberately self-transactional. migration-harness and
# the rollback probes already provide an outer transaction, so embed only its
# body there while separately proving the checked-in wrapper is present.
if ! grep -Fq 'RULES_DOWN_TRANSACTION_START' "$DOWN" \
   || ! grep -Fq 'RULES_DOWN_TRANSACTION_END' "$DOWN"; then
  echo "STOP  rules DOWN must contain an explicit BEGIN/COMMIT wrapper." >&2
  exit 2
fi
grep -vE 'RULES_DOWN_TRANSACTION_(START|END)' "$DOWN" > "$DOWN_TX_BODY"

expand_rollback_smoke() {
  local template="$1" output="$2" line
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$line" = '-- @RULES_DOWN@' ]; then
      cat "$DOWN_TX_BODY"
    else
      printf '%s\n' "$line"
    fi
  done < "$template" > "$output"
}
for template in \
  supabase/tests/rules/matching_rollback_unchanged.sql \
  supabase/tests/rules/matching_rollback_source_change.sql
do
  expanded="$ROLLBACK_SMOKE_TMP/$(basename "$template")"
  expand_rollback_smoke "$template" "$expanded"
  SMOKES+=("$expanded")
done

if [ "$TARGET" = local ]; then
  PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d asb_rules}"
  if ! current_database=$($PSQL -At -v ON_ERROR_STOP=1 -c "select current_database()" 2>/dev/null | tr -d '[:space:]'); then
    echo "STOP  could not identify the rules harness database." >&2
    exit 2
  fi
  if [ "$current_database" != asb_rules ]; then
    echo "STOP  rules-harness may run only on the isolated asb_rules database; connected to '$current_database'." >&2
    exit 2
  fi
  # migration-harness.sh is a child process and otherwise falls back to its
  # own shared-postgres default.  Pin the already-verified isolated command.
  export HARNESS_PSQL="$PSQL"
  applied=$($PSQL -At -c "select
    to_regclass('public.matching_rule_state') is not null
    or to_regclass('public.intelligence_rule_sets') is not null
    or to_regprocedure('public.fn_matching_params()') is not null
    or to_regprocedure('public.get_intelligence_rules()') is not null" 2>/dev/null | tr -d '[:space:]')
  if [ "$applied" = t ]; then
    if [ "$FROM_APPLIED" = 1 ]; then
      echo "rules modules present at baseline: applying the combined DOWN first (--from-applied)"
      if ! $PSQL -v ON_ERROR_STOP=1 -q -f - < "$DOWN"; then
        echo "FAIL  combined DOWN did not complete; the forward proof was not started" >&2
        exit 1
      fi
    else
      echo "STOP  Matching Rules or Intelligence Rules is already applied."
      echo "      The reversible proof needs a baseline without either module."
      echo "      Re-run with --from-applied only after accepting loss of local rules history;"
      echo "      the exact legacy matcher/cache/settings snapshot will be restored first."
      exit 2
    fi
  fi
fi

bash scripts/migration-harness.sh \
  --target "$TARGET" \
  --chain "${CHAIN[@]}" \
  --smokes "${SMOKES[@]}" \
  --downs "$DOWN_TX_BODY"
rc=$?

if [ "$REAPPLY" = 1 ] && [ "$TARGET" = local ] && [ "$rc" = 0 ]; then
  echo "re-applying the rules chain for local application/two-session checks"
  for f in "${CHAIN[@]}"; do
    if $PSQL -v ON_ERROR_STOP=1 -q -1 -f - < "$f" > /dev/null; then
      echo "  ok   re-applied $(basename "$f")"
    else
      echo "FAIL  re-apply $(basename "$f")" >&2
      rc=1
      break
    fi
  done
fi

if [ "$rc" = 0 ]; then
  echo "RULES HARNESS: reversible proof passed"
  echo "Separate gates (not run):"
  echo "  node --import tsx scripts/rules-check.ts"
  echo "  node --import tsx scripts/intelligence-rules-check.ts"
  echo "  node --import tsx scripts/matching-sql-parity-check.ts"
  echo "  node --import tsx scripts/matching-concurrency-check.ts"
  echo "  bash supabase/tests/rules/intelligence_race_two_sessions.sh"
fi
exit "$rc"
