#!/usr/bin/env bash
# Two real PostgreSQL sessions prove that the unified scheduler gives instant jobs distinct leases, never splits one
# digest across workers, never resurrects a settled row, and gives a claimant that waited a full lease.
#
# Safety contract (C2O-097 #4, the same as the Fixture race tests):
#   * no default target: the psql command is required; current_database() must be a disposable notification-test
#     database (asb_shared_fixture_services_test_<n>, made by scripts/shared-fixture-services-harness.sh, or
#     asb_race_*) AND equal NTF_RACE_DISPOSABLE (a positive confirmation); hosted hosts are refused;
#   * run-scoped identities (fresh UUIDs), dedupe keys, session names and a private log directory;
#   * deterministic coordination: each in-flight session names itself and holds its locks inside a pg_sleep; its
#     competitor waits INSIDE the database until that session is sleeping (pg_stat_activity, snapshot refreshed on
#     every pass) — never a fixed shell delay;
#   * EXIT/INT/TERM teardown: the run's server sessions are terminated, cleanup is one fatal transaction, zero
#     residue is asserted, and PASSED is printed only after that proof.
#
#   NTF_RACE_DISPOSABLE=<db> bash supabase/tests/shared_fixture_services_claim_race.sh "<psql command for <db>>"
set -euo pipefail
PSQL="${1:-}"
refuse() { echo "REFUSED: $*" >&2; exit 2; }
[ -n "$PSQL" ] || refuse "pass the psql command of a disposable database explicitly; there is no default target"
case "$PSQL" in *supabase.co*|*pooler.supabase*|*rezfejaxbmdzkslrrefr*|*sidcsytgqalqacsgyguz*) refuse "a hosted database is never a race-test target";; esac
cd "$(dirname "$0")/../.."
q() { $PSQL -At -X -q -v ON_ERROR_STOP=1 -c "$1"; }
DB="$(q "select current_database()" 2>/dev/null)" || refuse "the target cannot be reached"
case "$DB" in asb_shared_fixture_services_test_[0-9]*|asb_race_[0-9a-z_]*) ;; *) refuse "database '$DB' is not a disposable notification-test database";; esac
[ "${NTF_RACE_DISPOSABLE:-}" = "$DB" ] || refuse "set NTF_RACE_DISPOSABLE=$DB to confirm that '$DB' is disposable (these sessions COMMIT)"

LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/ntfrace.XXXXXX")"
RUN="$(basename "$LOGDIR" | tr -cd 'A-Za-z0-9' | tr 'A-Z' 'a-z')"
u1="$(q "select gen_random_uuid()")"; u2="$(q "select gen_random_uuid()")"
ARMED=0; CLEAN=0

# the competitor's first statement: wait inside the database until the named holder is in its pg_sleep
waitfor() {
  printf "do \$w\$ declare ready boolean := false; begin for i in 1..600 loop perform pg_stat_clear_snapshot(); ready := exists (select 1 from pg_stat_activity where datname = current_database() and application_name = '%s' and state = 'active' and query like '%%pg_sleep%%'); exit when ready; perform pg_sleep(0.05); end loop; if not ready then raise exception 'RACE_SETUP: %s never reached its sleep'; end if; end \$w\$;\n" "$1" "$1"
}

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/cleanup.log" 2>&1 <<SQL || { echo "CLEANUP FAILED:" >&2; cat "$LOGDIR/cleanup.log" >&2; return 1; }
select count(pg_terminate_backend(pid)) from pg_stat_activity
 where datname = current_database() and pid <> pg_backend_pid() and application_name like 'ntfrace\_${RUN}\_%';
begin;
set local session_replication_role = replica;
delete from public.notification_deliveries where notification_id in (select id from public.notifications where recipient_user_id in ('$u1', '$u2'));
delete from public.notification_digest_batches where recipient_user_id in ('$u1', '$u2');
delete from public.notifications where recipient_user_id in ('$u1', '$u2');
delete from public.notification_preferences where user_id in ('$u1', '$u2');
delete from public.users where id in ('$u1', '$u2');
delete from auth.users where id in ('$u1', '$u2');
commit;
SQL
}
residue() {
  local n
  n="$(q "select (select count(*) from public.notifications where recipient_user_id in ('$u1', '$u2'))
      + (select count(*) from public.notification_digest_batches where recipient_user_id in ('$u1', '$u2'))
      + (select count(*) from public.notification_preferences where user_id in ('$u1', '$u2'))
      + (select count(*) from public.users where id in ('$u1', '$u2')) + (select count(*) from auth.users where id in ('$u1', '$u2'))
      + (select count(*) from pg_stat_activity where datname = current_database() and application_name like 'ntfrace\_${RUN}\_%' and pid <> pg_backend_pid())")" || { echo "RESIDUE CHECK FAILED" >&2; return 1; }
  [ "$n" = 0 ] || { echo "RESIDUE: $n row(s) or session(s) of run $RUN survived" >&2; return 1; }
}
teardown() {
  local rc=$?
  trap - EXIT INT TERM
  for p in $(jobs -p); do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  if [ "$ARMED" = 1 ] && [ "$CLEAN" != 1 ]; then cleanup || rc=1; residue || rc=1; fi
  rm -rf "$LOGDIR"
  exit "$rc"
}
trap teardown EXIT
trap 'exit 130' INT TERM
fail() { echo "FAIL: $*" >&2; exit 1; }

ARMED=1
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
set session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('$u1', 'ntf-race-$RUN-one@test.invalid', 'authenticated', 'authenticated'),
  ('$u2', 'ntf-race-$RUN-two@test.invalid', 'authenticated', 'authenticated');
insert into public.users (id, supabase_user_id, email, full_name, role, subscription_tier, is_active)
values ('$u1', '$u1', 'ntf-race-$RUN-one@test.invalid', 'Race One', 'broker', 'T3', true),
       ('$u2', '$u2', 'ntf-race-$RUN-two@test.invalid', 'Race Two', 'broker', 'T3', true);
set session_replication_role = origin;
select public.fn_notification_enqueue('$u1', 'fixture.race', 'race:$RUN:1', 'Race one', 'First lease.', null, 'urgent');
select public.fn_notification_enqueue('$u2', 'fixture.race', 'race:$RUN:2', 'Race two', 'Second lease.', null, 'urgent');
update public.notification_deliveries d set next_attempt_at = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.recipient_user_id in ('$u1', '$u2');
SQL
MINE="(select id from public.notifications where recipient_user_id in ('$u1', '$u2'))"

# ── 1 · two instant claims at once get two distinct leases ──────────────────────────────────────────────────────
$PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/a.log" 2>&1 <<SQL &
set application_name = 'ntfrace_${RUN}_a';
begin;
select id from public.fn_notification_email_claim(180, 8);
select pg_sleep(6);
commit;
SQL
{ waitfor "ntfrace_${RUN}_a"; echo "select id from public.fn_notification_email_claim(180, 8);"; } | $PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/b.log" 2>&1 &
wait
id_a="$(grep -E '^[0-9a-f-]{36}$' "$LOGDIR/a.log" | head -1 || true)"
id_b="$(grep -E '^[0-9a-f-]{36}$' "$LOGDIR/b.log" | head -1 || true)"
if [ -z "$id_a" ] || [ -z "$id_b" ] || [ "$id_a" = "$id_b" ]; then
  echo "--- worker A" >&2; cat "$LOGDIR/a.log" >&2; echo "--- worker B" >&2; cat "$LOGDIR/b.log" >&2
  fail "concurrent workers did not receive two distinct leases"
fi
[ "$(q "select count(*) from public.notification_deliveries where notification_id in $MINE and status = 'sending' and attempts = 1 and claim_token is not null")" = 2 ] \
  || fail "expected two once-only leases"

# ── 2 · one digest window is one envelope; a late item enters the next one ──────────────────────────────────────
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
select public.fn_notification_enqueue('$u1', 'fixture.digest-race', 'digest:$RUN:1', 'Digest race one', 'First digest item.', null, 'normal');
select public.fn_notification_enqueue('$u1', 'fixture.digest-race', 'digest:$RUN:2', 'Digest race two', 'Second digest item.', null, 'normal');
update public.notification_digest_batches set next_attempt_at = now() - interval '1 minute' where recipient_user_id = '$u1';
SQL
$PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/c.log" 2>&1 <<SQL &
set application_name = 'ntfrace_${RUN}_c';
begin;
select id from public.fn_notification_email_claim(180, 8);
select pg_sleep(6);
commit;
SQL
{ waitfor "ntfrace_${RUN}_c"; echo "select id from public.fn_notification_email_claim(180, 8);"; } | $PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/d.log" 2>&1 &
{ waitfor "ntfrace_${RUN}_c"; echo "select public.fn_notification_enqueue('$u1', 'fixture.digest-race', 'digest:$RUN:late', 'Digest race late', 'Must enter the next envelope.', null, 'normal');"; } \
  | $PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/e.log" 2>&1 &
wait
id_c="$(grep -E '^[0-9a-f-]{36}$' "$LOGDIR/c.log" | head -1 || true)"
id_d="$(grep -E '^[0-9a-f-]{36}$' "$LOGDIR/d.log" | head -1 || true)"
if [ -z "$id_c" ] || [ -n "$id_d" ]; then
  echo "--- worker C" >&2; cat "$LOGDIR/c.log" >&2; echo "--- worker D" >&2; cat "$LOGDIR/d.log" >&2
  fail "one digest window was leased as more than one envelope"
fi
digest_claimed="$(q "select count(*) from public.notification_digest_batches where recipient_user_id = '$u1' and status = 'sending' and attempts = 1 and claim_token is not null")"
digest_children="$(q "select count(*) from public.notification_deliveries where digest_batch_id = '$id_c' and status = 'queued'")"
late_notification="$(grep -E '^[0-9a-f-]{36}$' "$LOGDIR/e.log" | head -1 || true)"
late_batch="$(q "select coalesce((select digest_batch_id::text from public.notification_deliveries where notification_id = '${late_notification:-00000000-0000-0000-0000-000000000000}'), '')")"
if [ "$digest_claimed" != 1 ] || [ "$digest_children" != 2 ] || [ -z "$late_batch" ] || [ "$late_batch" = "$id_c" ]; then
  fail "digest lease or membership was split (batches=$digest_claimed children=$digest_children late=$late_notification batch=$late_batch claimed=$id_c)"
fi

# ── 3 · C2O-092 #5a: settle vs reclaim — a row settled while a claimant waits is never resurrected ──────────────
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
select public.fn_notification_enqueue('$u2', 'fixture.settle-race', 'settle:$RUN:1', 'Settle race', 'Settle race.', null, 'urgent');
update public.notification_deliveries d set next_attempt_at = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.dedupe_key = 'settle:$RUN:1';
SQL
claim_x="$(q "select id || '|' || claim_token from public.fn_notification_email_claim(30, 8) where job_kind = 'instant'" | head -1 || true)"
row_x="${claim_x%%|*}"; tok_x="${claim_x##*|}"
[ -n "$row_x" ] || fail "settle race setup claimed nothing"
q "update public.notification_deliveries set lease_until = now() - interval '1 second' where id = '$row_x'" >/dev/null
$PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/f.log" 2>&1 <<SQL &
set application_name = 'ntfrace_${RUN}_f';
begin;
select id from public.notification_deliveries where id = '$row_x' for update;
select pg_sleep(4);
select public.fn_notification_email_settle('instant', '$row_x', '$tok_x', 'sent', null, 8);
commit;
SQL
{ waitfor "ntfrace_${RUN}_f"; echo "select coalesce((select id::text from public.fn_notification_email_claim(30, 8) limit 1), 'none');"; } \
  | $PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/g.log" 2>&1 &
wait
state_x="$(q "select status || ':' || coalesce(claim_token::text, '-') from public.notification_deliveries where id = '$row_x'")"
if [ "$state_x" != "sent:-" ] || grep -q "$row_x" "$LOGDIR/g.log"; then
  echo "--- settle" >&2; cat "$LOGDIR/f.log" >&2; echo "--- reclaim" >&2; cat "$LOGDIR/g.log" >&2
  fail "a settled row was reclaimed or resurrected (state=$state_x)"
fi

# ── 4 · C2O-092 #5b: a claimant that waited behind the scheduler lock longer than a lease still gets a full lease ─
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
select public.fn_notification_enqueue('$u2', 'fixture.ttl-race', 'ttl:$RUN:1', 'TTL race', 'TTL race.', null, 'urgent');
update public.notification_deliveries d set next_attempt_at = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.dedupe_key = 'ttl:$RUN:1';
SQL
$PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/h.log" 2>&1 <<SQL &
set application_name = 'ntfrace_${RUN}_h';
begin;
select pg_advisory_xact_lock(1095978574);
select pg_sleep(32);
commit;
SQL
{ waitfor "ntfrace_${RUN}_h"; cat <<'SQL'; } | $PSQL -At -X -q -v ON_ERROR_STOP=1 >"$LOGDIR/i.log" 2>&1 &
begin;
-- the claim and the read are separate statements: one statement's snapshot predates its own claim's update
create temp table ttl_claim on commit drop as select x.id from public.fn_notification_email_claim(30, 8) x;
select extract(epoch from (c.lease_until - clock_timestamp()))::int
  from ttl_claim x join public.notification_deliveries c on c.id = x.id;
commit;
SQL
wait
left_s="$(grep -E '^-?[0-9]+$' "$LOGDIR/i.log" | head -1 || true)"
if [ -z "$left_s" ] || [ "$left_s" -lt 25 ]; then
  cat "$LOGDIR/i.log" >&2
  fail "a claimant that waited behind the lock got a stale lease (seconds left: ${left_s:-none})"
fi

# ── the proven end: cleanup, zero residue, then PASSED ──────────────────────────────────────────────────────────
cleanup || fail "cleanup failed"
residue || fail "residue after cleanup"
CLEAN=1
echo "SHARED FIXTURE SERVICES CLAIM RACE: ALL ASSERTIONS PASSED (run $RUN; cleanup proven, zero residue)"
