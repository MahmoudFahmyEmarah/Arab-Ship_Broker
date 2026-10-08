# Fixture Room two-session race tests — shared safety harness (C2O-095, 8 Oct 2026).
# Sourced by fixture_race_two_sessions.sh and fixture_recreate_race.sh. Those scripts COMMIT, and their cleanup
# deletes fixed fixture identities, so this file makes them refuse anything but an explicitly confirmed disposable
# database and guarantees teardown:
#   * no default target: the psql command is required, and current_database() must be allowlisted AND equal to
#     FIXTURE_RACE_DISPOSABLE (a positive confirmation from the operator); hosted hosts are refused outright;
#   * one run per database: a gate session holds a database advisory lock for the whole run; a second run refuses;
#   * run-scoped logs (a private temp directory), never shared /tmp names;
#   * EXIT/INT/TERM teardown: the run's server sessions are terminated, cleanup runs and is FATAL, and zero residue
#     of the fixture identities is asserted; "PASSED" is printed only after that proof.
# The calling script defines cleanup() (one transaction, ON_ERROR_STOP=1) and uses $LOGDIR for its session logs.

RACE_ARMED=0
RACE_CLEAN=0

race_refuse() { echo "REFUSED: $*" >&2; exit 2; }

race_init() { # $1 = the psql command of a DISPOSABLE database (required)
  PSQL="${1:-}"
  [ -n "$PSQL" ] || race_refuse "pass the psql command of a disposable database explicitly; there is no default target"
  case "$PSQL" in
    *supabase.co*|*pooler.supabase*|*rezfejaxbmdzkslrrefr*|*sidcsytgqalqacsgyguz*) race_refuse "a hosted database is never a race-test target";;
  esac
  local db
  db="$($PSQL -At -X -v ON_ERROR_STOP=1 -c "select current_database()" 2>/dev/null)" || race_refuse "the target cannot be reached"
  case "$db" in
    asb_fixture|asb_e2e|asb_rc|asb_w[0-9a-z]*|asb_race_[0-9a-z_]*) ;;
    *) race_refuse "database '$db' is not an allowlisted disposable database (asb_fixture, asb_e2e, asb_rc, asb_w*, asb_race_*)";;
  esac
  [ "${FIXTURE_RACE_DISPOSABLE:-}" = "$db" ] || race_refuse "set FIXTURE_RACE_DISPOSABLE=$db to confirm that '$db' is disposable (these sessions COMMIT and cleanup deletes fixture identities)"
  RACE_DB="$db"
  LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/fxrace.XXXXXX")"
  RACE_RUN="$(basename "$LOGDIR" | tr -cd 'A-Za-z0-9')"
  trap race_teardown EXIT
  trap 'exit 130' INT TERM
  # the run gate: try the database advisory lock once; only a holder that got it reaches its sleep
  $PSQL -q -X -v gate="fxrace_gate_$RACE_RUN" >"$LOGDIR/gate.log" 2>&1 <<'SQL' &
select set_config('application_name', :'gate', false);
select pg_try_advisory_lock(hashtextextended('asb:fixture-race-gate', 0)) as got \gset
\if :got
select pg_sleep(3600);
\endif
SQL
  RACE_GATE_PID=$!
  local i=0
  until [ "$(race_q "select count(*) from pg_stat_activity where datname = current_database() and application_name = 'fxrace_gate_$RACE_RUN' and state = 'active' and query like '%pg_sleep%'")" = 1 ]; do
    if ! kill -0 "$RACE_GATE_PID" 2>/dev/null; then race_refuse "another race run holds this database's gate"; fi
    i=$((i + 1)); [ $i -lt 60 ] || race_refuse "the run gate could not be confirmed"
    sleep 0.5
  done
  RACE_ARMED=1
  echo "race target: $RACE_DB (gate held by run $RACE_RUN)"
}

race_q() { $PSQL -At -X -v ON_ERROR_STOP=1 -c "$1"; }

# terminate this run's server sessions (killing a local docker/psql client does not stop the server-side session)
race_stop_sessions() {
  for p in $(jobs -p); do kill "$p" 2>/dev/null; done
  race_q "select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and (application_name like 'fxrace\_%' or application_name like 'fxrr\_%') and application_name not like 'fxrace\_gate\_%'" >/dev/null 2>&1 || true
  wait 2>/dev/null
}

race_assert_no_residue() {
  local n
  n="$(race_q "select (select count(*) from public.users where email like '%@fixture.test')
    + (select count(*) from auth.users where email like '%@fixture.test')
    + (select count(*) from public.fixture_rooms where cargo_listing_id::text like '00000000-0000-4000-8000-0000000000e_' or vessel_availability_id::text like '00000000-0000-4000-8000-0000000000b_')
    + (select count(*) from public.cargo_listings where id::text like '00000000-0000-4000-8000-0000000000e_')
    + (select count(*) from public.vessel_availability where id::text like '00000000-0000-4000-8000-0000000000b_')
    + (select count(*) from public.vessels where id::text like '00000000-0000-4000-8000-0000000000f_')
    + (select count(*) from public.organizations where id::text like '00000000-0000-4000-8000-0000000000c_')
    + (select count(*) from public.listing_ownership where listing_id::text like '00000000-0000-4000-8000-0000000000e_' or listing_id::text like '00000000-0000-4000-8000-0000000000b_')
    + (select count(*) from public.ports where locode in ('ZZFXA', 'ZZFXB'))")" || { echo "RESIDUE CHECK FAILED: the count could not be read" >&2; return 1; }
  if [ "$n" != 0 ]; then echo "RESIDUE: $n fixture row(s) survived the cleanup" >&2; return 1; fi
}

# the normal end: stop sessions, fatal cleanup, prove zero residue, and only then report
race_finish() { # $1 = suite label
  race_stop_sessions
  cleanup || { echo "$1: CLEANUP FAILED" >&2; exit 1; }
  race_assert_no_residue || { echo "$1: FAILED (residue)" >&2; exit 1; }
  RACE_CLEAN=1
  if [ "$fail" = 0 ]; then echo "$1: ALL ASSERTIONS PASSED (cleanup proven, zero residue)"; else echo "$1: FAILED"; exit 1; fi
}

race_teardown() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$RACE_ARMED" = 1 ]; then
    if [ "$RACE_CLEAN" != 1 ]; then
      race_stop_sessions
      if declare -F cleanup >/dev/null; then
        cleanup || { echo "TEARDOWN: CLEANUP FAILED" >&2; rc=1; }
        race_assert_no_residue || rc=1
      fi
    fi
    # release the gate last
    race_q "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and application_name = 'fxrace_gate_$RACE_RUN'" >/dev/null 2>&1 || true
  fi
  kill "${RACE_GATE_PID:-0}" 2>/dev/null
  rm -rf "${LOGDIR:-/nonexistent-fxrace}"
  [ "$rc" = 0 ] || [ "$rc" = 2 ] || echo "race run ended with status $rc" >&2
  exit "$rc"
}
