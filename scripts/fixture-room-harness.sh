#!/usr/bin/env bash
# Fixture Room · migration and smoke harness (23 Sep 2026).
#
#   scripts/fixture-room-harness.sh [--target local|linked] [--no-down] [--reapply] [--from-applied]
#
# 0. checks the starting state (audit FR-L2): the baseline fingerprint must be
#    taken WITHOUT the module, otherwise the forward chain is a no-op, the
#    DOWN removes the module and the comparison reports a false failure. When
#    the module is present the run refuses, unless --from-applied is given,
#    in which case the DOWN runs first (rooms are kept as *_bak tables);
# 1. assembles the self-contained smoke files from the shared seed and the
#    bodies (supabase/tests/fixture_room/bodies/*.sql), so the seed in every
#    smoke is byte-identical to seed_fixture_shape.sql;
# 2. runs scripts/migration-harness.sh: baseline fingerprint → the seven
#    released Fixture Room migrations → every smoke suite (BEGIN … ROLLBACK, each must
#    print ALL ASSERTIONS PASSED) → the DOWN file → fingerprint comparison;
# 3. with --reapply, applies the forward chain again afterwards so the local
#    database keeps the module for the application and the race test.
#
# The local database is shared with the PDA Estimator branch, whose own
# harness may add or drop pda_* / tariff objects between the two fingerprints.
# Those catalogue lines are ignored (--allow-residue); every Fixture Room
# object is named fixture_*, so Fixture residue would still be reported. The
# DOWN keeps *_bak_20260923200000 copies when rooms exist; those lines are the
# residue the migration harness documents and are allowed too.
#
# --target linked is an OWNER GATE and is not run from here without approval.
set -uo pipefail
RESIDUE='(pda_|tariff|_pda|_bak_20260923200000)'
cd "$(dirname "$0")/.."
TARGET=local; DOWN=1; REAPPLY=0; FROM_APPLIED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --no-down) DOWN=0; shift;;
    --reapply) REAPPLY=1; shift;;
    --from-applied) FROM_APPLIED=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

M=supabase/migrations
T=supabase/tests/fixture_room
CHAIN=(
  "$M/20260923200000_fixture_room_tables.sql"
  "$M/20260923201000_fixture_room_helpers.sql"
  "$M/20260923202000_fixture_room_reads.sql"
  "$M/20260923203000_fixture_room_commands.sql"
  "$M/20260923206000_fixture_room_match_candidates.sql"
  "$M/20260923207000_fixture_room_lift_all.sql"
  "$M/20260923208000_fixture_room_candidate_handles.sql"
  "$M/20261006100000_fixture_room_enforcement.sql"
  "$M/20261007100000_fixture_match_label.sql"
  "$M/20261007400000_fixture_bridge_suggestion.sql"
  "$M/20261007500000_fixture_room_lineage.sql"
)
DOWNS=("supabase/rollback/20261007_fixture_room_lineage_down.sql" "supabase/rollback/20261007_fixture_bridge_suggestion_down.sql" "supabase/rollback/20261007_fixture_match_label_down.sql" "supabase/rollback/20261006_fixture_room_enforcement_down.sql" "supabase/rollback/20260923_fixture_room_down.sql")

# ── 0 · starting state (FR-L2) ──────────────────────────────────────────────
if [ "$TARGET" = local ]; then
  PSQL0="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
  applied=$($PSQL0 -At -c "select (to_regclass('public.fixture_rooms') is not null) or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fn_fixture_actor')" 2>/dev/null | tr -d '[:space:]')
  if [ "$applied" = t ]; then
    if [ $FROM_APPLIED = 1 ]; then
      echo "module present at the baseline: applying the DOWN first (--from-applied)"
      for d in "${DOWNS[@]}"; do $PSQL0 -v ON_ERROR_STOP=1 -q -1 -f - < "$d" > /dev/null || exit 1; done || { echo " FAIL  the DOWN did not complete"; exit 1; }
    else
      echo " STOP  the Fixture Room module is already applied on the local database."
      echo "       The harness needs a baseline WITHOUT it: otherwise the forward chain is a no-op,"
      echo "       the DOWN removes the module and the fingerprint comparison reports a false failure."
      echo "       Run again with --from-applied to roll it back first (rooms are kept as *_bak tables),"
      echo "       or apply supabase/rollback/20260923_fixture_room_down.sql yourself."
      exit 2
    fi
  fi
fi

# ── 1 · assemble the smoke files ────────────────────────────────────────────
declare -A MARK=(
  [state]="FIXTURE STATE SMOKE"
  [rls]="FIXTURE RLS SMOKE"
  [masking]="FIXTURE MASKING SMOKE"
  [idempotency]="FIXTURE IDEMPOTENCY SMOKE"
  [immutability]="FIXTURE IMMUTABILITY SMOKE"
  [snapshot]="FIXTURE SNAPSHOT SMOKE"
  [candidates]="FIXTURE CANDIDATES SMOKE"
  [liftall]="FIXTURE LIFT ALL SMOKE"
  [handles]="FIXTURE HANDLES SMOKE"
  [enforcement]="FIXTURE ENFORCEMENT SMOKE"
  [bridge]="FIXTURE BRIDGE SMOKE"
  [lineage]="FIXTURE LINEAGE SMOKE"
)
SMOKES=()
for name in state rls masking idempotency immutability snapshot candidates liftall handles enforcement bridge lineage; do
  out="$T/fixture_${name}_smoke.sql"
  {
    printf -- '-- Fixture Room · %s (generated by scripts/fixture-room-harness.sh from\n' "${MARK[$name]}"
    printf -- '-- seed_fixture_shape.sql + bodies/%s.sql; edit those, not this file).\n' "$name"
    printf -- '-- BEGIN … ROLLBACK. Run as the database owner:\n'
    printf -- '--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < %s\n\n' "$out"
    printf 'begin;\n\n'
    cat "$T/seed_fixture_shape.sql"
    printf '\n'
    cat "$T/bodies/$name.sql"
    printf '\ndo $$ begin raise notice '"'"'%s: ALL ASSERTIONS PASSED'"'"'; end $$;\n\nrollback;\n' "${MARK[$name]}"
  } > "$out"
  SMOKES+=("$out")
done
echo "assembled ${#SMOKES[@]} smoke file(s)"

# ── 2 · the harness ─────────────────────────────────────────────────────────
if [ $DOWN = 1 ]; then
  bash scripts/migration-harness.sh --target "$TARGET" --allow-residue "$RESIDUE" --chain "${CHAIN[@]}" --smokes "${SMOKES[@]}" --downs "${DOWNS[@]}"
else
  bash scripts/migration-harness.sh --target "$TARGET" --allow-residue "$RESIDUE" --chain "${CHAIN[@]}" --smokes "${SMOKES[@]}"
fi
rc=$?

# ── 3 · keep the module on the local database ───────────────────────────────
if [ $REAPPLY = 1 ] && [ "$TARGET" = local ] && [ $DOWN = 1 ]; then
  PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
  for f in "${CHAIN[@]}"; do
    if $PSQL -v ON_ERROR_STOP=1 -q -1 -f - < "$f" > /dev/null 2>&1; then echo "  ok   re-applied $(basename "$f")"; else echo " FAIL  re-apply $(basename "$f")"; rc=1; fi
  done
fi
exit $rc
