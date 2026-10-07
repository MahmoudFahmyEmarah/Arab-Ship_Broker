#!/usr/bin/env bash
# Builds the ISOLATED proof database asb_e2e from this checkout's repository artefacts (db-rebuild.sh + every
# migration), with a throwaway pg_cron stub because pg_cron can only live in the cron database. Never touches
# postgres (shared), staging or production.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=asb_e2e
PG() { docker exec -i supabase_db_arab-ship-broker psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
PG -d postgres -c "drop database if exists $DB" >/dev/null
PG -d postgres -c "create database $DB" >/dev/null
PG -d $DB <<'SQL'
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432, database text default current_database(), username text default current_user, active boolean default true, jobname text);
create table if not exists cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $f$ declare v bigint; begin delete from cron.job where jobname = job_name; insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid into v; return v; end $f$;
create or replace function cron.schedule(schedule text, command text) returns bigint language plpgsql as $f$ declare v bigint; begin insert into cron.job (schedule, command) values (schedule, command) returning jobid into v; return v; end $f$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $f$ begin delete from cron.job where jobname = job_name; return found; end $f$;
create or replace function cron.unschedule(job_id bigint) returns boolean language plpgsql as $f$ begin delete from cron.job where jobid = job_id; return found; end $f$;
SQL
ROOT=tmp/rebuild-root; rm -rf "$ROOT"
mkdir -p "$ROOT/scripts" "$ROOT/supabase/migrations"
cp scripts/db-rebuild.sh "$ROOT/scripts/"
cp -r supabase/baseline "$ROOT/supabase/"
for f in supabase/migrations/*.sql; do sed 's/^create extension if not exists pg_cron;/-- (isolated proof) pg_cron stubbed/' "$f" > "$ROOT/supabase/migrations/$(basename "$f")"; done
bash "$ROOT/scripts/db-rebuild.sh" --db "$DB" 2>&1 | tail -4
rm -rf "$ROOT"
PG -d $DB -At -c "select 'asb_e2e: ' || count(*) || ' migrations; fixture guards enabled: ' || (select count(*) from pg_trigger where tgname like 'trg_fixture_%immutable' and tgenabled = 'O') || '; pda links: ' || (to_regclass('public.fixture_pda_links') is not null) from supabase_migrations.schema_migrations"
