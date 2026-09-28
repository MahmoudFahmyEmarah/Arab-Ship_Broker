#!/usr/bin/env bash
# Shared Fixture services · disposable-database release harness.
#
# Builds a schema-only clone of the local Supabase database under an exact,
# throw-away name, then proves forward -> behavioural smoke -> two-session
# claim race -> DOWN -> identical schema -> reapply -> smoke -> DOWN. The
# shared application database is never changed.
set -euo pipefail

cd "$(dirname "$0")/.."
CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_arab-ship-broker}"
TEST_DB="asb_shared_fixture_services_test_$$"

case "$TEST_DB" in
  asb_shared_fixture_services_test_[0-9]*) ;;
  *) echo "unsafe disposable database name: $TEST_DB" >&2; exit 2 ;;
esac
psql_test() { docker exec -i "$CONTAINER" psql -U postgres -d "$TEST_DB" -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  docker exec "$CONTAINER" dropdb -U postgres --if-exists --force "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker exec "$CONTAINER" createdb -U postgres -T template0 "$TEST_DB"
psql_test -1 -f - < supabase/tests/shared_fixture_services_bootstrap.sql

schema_fingerprint() {
  docker exec "$CONTAINER" pg_dump -U postgres -d "$TEST_DB" --schema-only --no-owner \
    | sed -E '/^--/d; /^SET /d; /^SELECT pg_catalog\.set_config/d; /^\\(un)?restrict /d; /^$/d' \
    | sha256sum | cut -d' ' -f1
}

baseline="$(schema_fingerprint)"
PSQL_CMD="docker exec -i $CONTAINER psql -U postgres -d $TEST_DB"

prove_missing_storage_refused() {
  psql_test -c "alter schema storage rename to storage_unavailable"
  local accepted=0
  if psql_test -1 -f - < supabase/migrations/20260923351000_fixture_recap_storage.sql >/dev/null 2>&1; then
    accepted=1
  fi
  psql_test -c "alter schema storage_unavailable rename to storage"
  if [ "$accepted" -eq 1 ]; then
    echo "FAIL: storage migration succeeded without storage.buckets" >&2
    return 1
  fi
}

prove_preexisting_bucket_refused() {
  psql_test -c "insert into storage.buckets(id, name, public) values ('fixture-recaps', 'fixture-recaps', true)"
  if psql_test -1 -f - < supabase/migrations/20260923351000_fixture_recap_storage.sql >/dev/null 2>&1; then
    echo "FAIL: storage migration adopted a pre-existing bucket" >&2
    return 1
  fi
  psql_test -c "delete from storage.buckets where id = 'fixture-recaps'"
}

apply_forward() {
  psql_test -1 -f - < supabase/migrations/20260923350000_shared_notifications.sql
  psql_test -1 -f - < supabase/migrations/20260923351000_fixture_recap_storage.sql
}
run_smoke() {
  { printf 'begin;\n'; cat supabase/tests/shared_fixture_services_smoke.sql; printf '\nrollback;\n'; } \
    | psql_test -f -
}
run_down() {
  psql_test -1 -f - < supabase/rollback/20260923350000_shared_fixture_services_down.sql
  local after
  after="$(schema_fingerprint)"
  if [ "$after" != "$baseline" ]; then
    echo "FAIL: shared-services DOWN did not restore the baseline schema" >&2
    return 1
  fi
  if psql_test -At -c "select count(*) from storage.buckets where id = 'fixture-recaps'" 2>/dev/null | grep -qv '^0$'; then
    echo "FAIL: fixture-recaps bucket remained after DOWN" >&2
    return 1
  fi
}

prove_nonempty_down_refused() {
  psql_test -c "insert into storage.objects(bucket_id, name) values ('fixture-recaps', 'release-gate.pdf')"
  if psql_test -1 -f - < supabase/rollback/20260923350000_shared_fixture_services_down.sql >/dev/null 2>&1; then
    echo "FAIL: shared-services DOWN removed a bucket containing a PDF" >&2
    return 1
  fi
  psql_test -c "delete from storage.objects where bucket_id = 'fixture-recaps'"
}

prove_missing_storage_refused
prove_preexisting_bucket_refused
apply_forward
run_smoke
bash supabase/tests/shared_fixture_services_claim_race.sh "$PSQL_CMD"
prove_nonempty_down_refused
run_down
apply_forward
run_smoke
run_down

echo "SHARED FIXTURE SERVICES HARNESS: ALL ASSERTIONS PASSED"
