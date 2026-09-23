#!/usr/bin/env bash
# Rebuild a database from REPOSITORY-OWNED artifacts only (21 Sep 2026).
#
#   scripts/db-rebuild.sh [--container <name>] [--db <database>] [--keep]
#                         [--before <version>]
#
# --before <14-digit version> stops BEFORE that migration, so the result is the
# database as it stands the moment before a release is applied. That is what a
# release rehearsal needs: a baseline the release's DOWN files can return to
# exactly. Without it, rebuilding applies everything in supabase/migrations —
# including the release under test — and the migration harness then measures a
# DOWN chain against a baseline that already contained the release, so the
# fingerprints differ by every object the DOWNs correctly dropped.
#
# What it does, in order:
#   1. drops and recreates the public schema of the target database
#   2. supabase/baseline/00_platform_prereqs.sql   roles, schemas, extensions,
#                                                  and the Auth surface the
#                                                  schema's policies call
#   3. supabase/baseline/10_missing_from_history.sql  the three tables no
#                                                  migration creates
#   4. every file in supabase/migrations, in name order, each in its own
#      transaction with ON_ERROR_STOP
#   5. records them all in supabase_migrations.schema_migrations, so the
#      result is a database the Supabase CLI recognises as up to date
#
# No production dump is read at any point. The only inputs are files in this
# repository.
#
# TARGET DATABASE: pg_cron can only be installed in the database named in
# cron.database_name (normally `postgres`), so a rebuild has to happen in that
# database, in a fresh public schema — not in a brand-new database. That is a
# property of the extension, not of this repository.
set -uo pipefail
CONTAINER=supabase_db_arab-ship-broker
DB=postgres
KEEP=0
BEFORE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2;;
    --db) DB="$2"; shift 2;;
    --keep) KEEP=1; shift;;
    --before) BEFORE="$2"; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
cd "$(dirname "$0")/.."
PSQL="docker exec -i $CONTAINER psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
say() { printf '%s\n' "$*"; }
fail=0

run() { # $1 file  $2 label
  local out rc=0
  out="$($PSQL -1 -f - < "$1" 2>&1)" || rc=$?
  if [ $rc -ne 0 ]; then
    say " FAIL  $2 (psql exit $rc)"
    printf '%s\n' "$out" | grep -E "ERROR|FATAL|DETAIL" | head -5 | sed 's/^/        /'
    fail=1; return 1
  fi
  if printf '%s' "$out" | grep -qE "^(psql:)?.*(ERROR|FATAL):"; then
    say " FAIL  $2 (error in output)"
    printf '%s\n' "$out" | grep -E "ERROR|FATAL" | head -3 | sed 's/^/        /'
    fail=1; return 1
  fi
  return 0
}

if [ $KEEP -eq 0 ]; then
  say "── 1 · empty the public schema of $DB"
  docker exec -i $CONTAINER psql -U postgres -d "$DB" -q -c \
    "drop schema if exists public cascade; create schema public; drop schema if exists supabase_migrations cascade;" 2>&1 | grep -E "ERROR" && { say "FAILED to reset the schema"; exit 1; }
  # vault.secrets lives OUTSIDE the public schema, so it survives the drop —
  # and 20260815101000_group_mail_cron.sql inserts a named secret with no
  # on-conflict clause, so a second rebuild collides with the first.
  # This is a disposable database: clear the secrets the migrations create.
  docker exec -i $CONTAINER psql -U postgres -d "$DB" -q -c \
    "do \$\$ begin if to_regclass('vault.secrets') is not null then delete from vault.secrets; end if; end \$\$;" 2>&1 | grep -E "ERROR" || true
fi

say "── 2 · platform prerequisites (repo-owned)"
run supabase/baseline/00_platform_prereqs.sql "00_platform_prereqs.sql" || exit 1
say "  ok   roles, schemas, extensions, auth surface"

say "── 3 · objects missing from migration history (repo-owned)"
run supabase/baseline/10_missing_from_history.sql "10_missing_from_history.sql" || exit 1
say "  ok   contact_messages, sync_source_state, vessel_review_queue"

if [ -n "$BEFORE" ]; then
  case "$BEFORE" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) echo "--before takes a 14-digit migration version, got: $BEFORE" >&2; exit 2;;
  esac
  say "── 4 · every migration BEFORE $BEFORE, in order"
else
  say "── 4 · every migration, in order"
fi
$PSQL -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" > /dev/null 2>&1
n=0
skipped=0
for f in $(ls supabase/migrations/*.sql | sort); do
  b="$(basename "$f")"
  # POSIX test knows \< and \> only, so "at or after" is "not before"
  if [ -n "$BEFORE" ] && ! [ "${b%%_*}" \< "$BEFORE" ]; then skipped=$((skipped+1)); continue; fi
  if ! run "$f" "$b"; then say "── stopped at $b after $n migration(s)"; exit 1; fi
  # the remote baseline creates public.ports; the port-identity migration
  # further down inserts port_areas rows with foreign keys into it, so the
  # reference codes have to exist by then (repo-owned, placeholders only)
  if [ "$b" = "20260616120000_remote_baseline.sql" ]; then
    run supabase/baseline/20_reference_ports.sql "20_reference_ports.sql" || exit 1
    say "  ok   reference ports seeded (repo-owned placeholders)"
    run supabase/baseline/30_matching_layer.sql "30_matching_layer.sql" || exit 1
    say "  ok   matching layer (7 functions, 1 view, 3 triggers)"
  fi
  v="${b%%_*}"
  $PSQL -c "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '${b%.sql}') on conflict (version) do nothing;" > /dev/null 2>&1
  n=$((n+1))
done
if [ -n "$BEFORE" ]; then say "  ok   $n migrations applied, $skipped held back at or after $BEFORE"; else say "  ok   $n migrations applied"; fi

say "── 5 · objects that attach to tables the chain creates (repo-owned)"
run supabase/baseline/40_billing_audit_triggers.sql "40_billing_audit_triggers.sql" || exit 1
say "  ok   billing audit triggers"

say "── 6 · what was built"
docker exec -i $CONTAINER psql -U postgres -d "$DB" -At -c \
  "select '  tables=' || (select count(*) from information_schema.tables where table_schema='public')
        || '  views=' || (select count(*) from information_schema.views where table_schema='public')
        || '  functions=' || (select count(*) from pg_proc p join pg_namespace nsp on nsp.oid=p.pronamespace where nsp.nspname='public')
        || '  policies=' || (select count(*) from pg_policies where schemaname='public')
        || '  indexes=' || (select count(*) from pg_indexes where schemaname='public')"

if [ $fail = 0 ]; then say "DB REBUILD: OK — built from repository artifacts only, no production dump"; else say "DB REBUILD: FAILED"; exit 1; fi
