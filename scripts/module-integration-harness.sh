#!/usr/bin/env bash
# PDA + Fixture Room combined migration harness.
#
# It starts without either module, applies both module chains and their shared
# integration migration, then applies the downs in dependency order and checks
# an exact schema fingerprint.  --from-applied is intentionally explicit:
# rolling back a populated local development database is never implicit.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET=local; REAPPLY=0; FROM_APPLIED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --reapply) REAPPLY=1; shift;;
    --from-applied) FROM_APPLIED=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

M=supabase/migrations
CHAIN=(
  "$M/20260923100000_pda_tariff_schema.sql"
  "$M/20260923101000_pda_tariff_publication.sql"
  "$M/20260923102000_pda_estimates_and_reads.sql"
  "$M/20260923103000_pda_admin_ingestion.sql"
  "$M/20260923200000_fixture_room_tables.sql"
  "$M/20260923201000_fixture_room_helpers.sql"
  "$M/20260923202000_fixture_room_reads.sql"
  "$M/20260923203000_fixture_room_commands.sql"
  "$M/20260923320000_fixture_pda_shared_integration.sql"
)
DOWNS=(
  "supabase/rollback/20260923_fixture_pda_shared_integration_down.sql"
  "supabase/rollback/20260923_fixture_room_down.sql"
  "supabase/rollback/20260923_pda_down.sql"
)

if [ "$TARGET" = local ]; then
  PSQL="${HARNESS_PSQL:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
  applied=$($PSQL -At -c "select to_regclass('public.fixture_pda_links') is not null or to_regclass('public.fixture_rooms') is not null or to_regclass('public.pda_estimates') is not null" 2>/dev/null | tr -d '[:space:]')
  if [ "$applied" = t ]; then
    if [ "$FROM_APPLIED" = 1 ]; then
      echo "module present at baseline: rolling it back first (--from-applied)"
      for f in "${DOWNS[@]}"; do
        $PSQL -v ON_ERROR_STOP=1 -q -1 -f - < "$f" || { echo "FAIL  down $(basename "$f")"; exit 1; }
      done
    else
      echo "STOP  PDA, Fixture Room or their integration is already applied."
      echo "      Re-run with --from-applied only after confirming this local database has no module data to retain."
      exit 2
    fi
  fi
fi

bash scripts/migration-harness.sh --target "$TARGET" --chain "${CHAIN[@]}" --downs "${DOWNS[@]}"
rc=$?

if [ "$REAPPLY" = 1 ] && [ "$TARGET" = local ] && [ "$rc" = 0 ]; then
  for f in "${CHAIN[@]}"; do
    if $PSQL -v ON_ERROR_STOP=1 -q -1 -f - < "$f"; then echo "  ok   re-applied $(basename "$f")"; else echo "FAIL  re-apply $(basename "$f")"; rc=1; fi
  done
fi
exit "$rc"
