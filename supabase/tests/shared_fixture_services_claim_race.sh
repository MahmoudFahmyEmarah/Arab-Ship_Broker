#!/usr/bin/env bash
# Two real PostgreSQL sessions prove that the unified scheduler gives instant
# jobs distinct leases and never splits one digest across workers. Disposable DB only.
set -euo pipefail
PSQL="${1:?pass the disposable psql command}"
cd "$(dirname "$0")/../.."

u1=10000000-0000-4000-8000-000000000011
u2=10000000-0000-4000-8000-000000000012

$PSQL -q -v ON_ERROR_STOP=1 <<SQL
set session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('$u1', 'ntf-race-one@test.invalid', 'authenticated', 'authenticated'),
  ('$u2', 'ntf-race-two@test.invalid', 'authenticated', 'authenticated');
insert into public.users
  (id, supabase_user_id, email, full_name, role, subscription_tier, is_active)
values
  ('$u1', '$u1', 'ntf-race-one@test.invalid', 'Race One', 'broker', 'T3', true),
  ('$u2', '$u2', 'ntf-race-two@test.invalid', 'Race Two', 'broker', 'T3', true);
set session_replication_role = origin;
select public.fn_notification_enqueue('$u1', 'fixture.race', 'fixture:race:1', 'Race one', 'First lease.', null, 'urgent');
select public.fn_notification_enqueue('$u2', 'fixture.race', 'fixture:race:2', 'Race two', 'Second lease.', null, 'urgent');
update public.notification_deliveries set next_attempt_at = now() - interval '1 minute';
SQL

log_a="$(mktemp)"; log_b="$(mktemp)"; log_c="$(mktemp)"; log_d="$(mktemp)"; log_e="$(mktemp)"
trap 'rm -f "$log_a" "$log_b" "$log_c" "$log_d" "$log_e"' EXIT

$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
begin;
select id from public.fn_notification_email_claim(180, 8);
select pg_sleep(4);
commit;
SQL
pid_a=$!
sleep 1
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<'SQL' &
select id from public.fn_notification_email_claim(180, 8);
SQL
pid_b=$!
wait "$pid_a"
wait "$pid_b"

id_a="$(grep -E '^[0-9a-f-]{36}$' "$log_a" | head -1)"
id_b="$(grep -E '^[0-9a-f-]{36}$' "$log_b" | head -1)"
if [ -z "$id_a" ] || [ -z "$id_b" ] || [ "$id_a" = "$id_b" ]; then
  echo "FAIL: concurrent workers did not receive two distinct leases" >&2
  echo "--- worker A" >&2; cat "$log_a" >&2
  echo "--- worker B" >&2; cat "$log_b" >&2
  exit 1
fi

claimed="$($PSQL -At -q -v ON_ERROR_STOP=1 -c "select count(*) from public.notification_deliveries where status = 'sending' and attempts = 1 and claim_token is not null")"
if [ "$claimed" != "2" ]; then
  echo "FAIL: expected two once-only leases, got $claimed" >&2
  exit 1
fi

$PSQL -q -v ON_ERROR_STOP=1 <<SQL
select public.fn_notification_enqueue('$u1', 'fixture.digest-race', 'fixture:digest-race:1', 'Digest race one', 'First digest item.', null, 'normal');
select public.fn_notification_enqueue('$u1', 'fixture.digest-race', 'fixture:digest-race:2', 'Digest race two', 'Second digest item.', null, 'normal');
update public.notification_digest_batches set next_attempt_at = now() - interval '1 minute';
SQL

$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_c" 2>&1 <<'SQL' &
begin;
select id from public.fn_notification_email_claim(180, 8);
select pg_sleep(4);
commit;
SQL
pid_c=$!
sleep 1
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_d" 2>&1 <<'SQL' &
select id from public.fn_notification_email_claim(180, 8);
SQL
pid_d=$!
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_e" 2>&1 <<SQL &
select public.fn_notification_enqueue(
  '$u1', 'fixture.digest-race', 'fixture:digest-race:late',
  'Digest race late', 'Must enter the next envelope.', null, 'normal'
);
SQL
pid_e=$!
wait "$pid_c"
wait "$pid_d"
wait "$pid_e"

id_c="$(grep -E '^[0-9a-f-]{36}$' "$log_c" | head -1)"
id_d="$(grep -E '^[0-9a-f-]{36}$' "$log_d" | head -1 || true)"
if [ -z "$id_c" ] || [ -n "$id_d" ]; then
  echo "FAIL: one digest window was leased as more than one envelope" >&2
  echo "--- worker C" >&2; cat "$log_c" >&2
  echo "--- worker D" >&2; cat "$log_d" >&2
  exit 1
fi

digest_claimed="$($PSQL -At -q -v ON_ERROR_STOP=1 -c "select count(*) from public.notification_digest_batches where status = 'sending' and attempts = 1 and claim_token is not null")"
digest_children="$($PSQL -At -q -v ON_ERROR_STOP=1 -c "select count(*) from public.notification_deliveries where digest_batch_id = '$id_c' and status = 'queued'")"
late_notification="$(grep -E '^[0-9a-f-]{36}$' "$log_e" | head -1)"
late_batch="$($PSQL -At -q -v ON_ERROR_STOP=1 -c "select digest_batch_id from public.notification_deliveries where notification_id = '$late_notification'")"
if [ "$digest_claimed" != "1" ] || [ "$digest_children" != "2" ] || [ -z "$late_batch" ] || [ "$late_batch" = "$id_c" ]; then
  echo "FAIL: digest lease or membership was split (batches=$digest_claimed children=$digest_children)" >&2
  echo "late notification=$late_notification late batch=$late_batch claimed batch=$id_c" >&2
  exit 1
fi

# ── C2O-092 #5a · settle vs reclaim: a row settled while a claimant waits is never resurrected ──────────────────
$PSQL -q -v ON_ERROR_STOP=1 <<SQL
select public.fn_notification_enqueue('$u2', 'fixture.settle-race', 'fixture:settle-race:1', 'Settle race', 'Settle race.', null, 'urgent');
update public.notification_deliveries d set next_attempt_at = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.dedupe_key = 'fixture:settle-race:1';
SQL
claim_x="$($PSQL -At -q -v ON_ERROR_STOP=1 -c "select id || '|' || claim_token from public.fn_notification_email_claim(30, 8) where job_kind = 'instant'" | head -1 || true)"
row_x="${claim_x%%|*}"; tok_x="${claim_x##*|}"
if [ -z "$row_x" ]; then echo "FAIL: settle race setup claimed nothing" >&2; exit 1; fi
# the first lease expires; worker A (still holding its token) settles while worker B tries to reclaim the same row
$PSQL -q -v ON_ERROR_STOP=1 -c "update public.notification_deliveries set lease_until = now() - interval '1 second' where id = '$row_x'"
log_f="$(mktemp)"; log_g="$(mktemp)"
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_f" 2>&1 <<SQL &
begin;
select id from public.notification_deliveries where id = '$row_x' for update;
select pg_sleep(3);
select public.fn_notification_email_settle('instant', '$row_x', '$tok_x', 'sent', null, 8);
commit;
SQL
pid_f=$!
sleep 1
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_g" 2>&1 <<'SQL' &
select coalesce((select id::text from public.fn_notification_email_claim(30, 8) limit 1), 'none');
SQL
pid_g=$!
wait "$pid_f"; wait "$pid_g"
state_x="$($PSQL -At -q -v ON_ERROR_STOP=1 -c "select status || ':' || coalesce(claim_token::text, '-') from public.notification_deliveries where id = '$row_x'")"
if [ "$state_x" != "sent:-" ] || grep -q "$row_x" "$log_g"; then
  echo "FAIL: a settled row was reclaimed or resurrected (state=$state_x)" >&2
  echo "--- settle" >&2; cat "$log_f" >&2; echo "--- reclaim" >&2; cat "$log_g" >&2
  exit 1
fi
rm -f "$log_f" "$log_g"

# ── C2O-092 #5b · a claimant that waited behind the scheduler lock longer than a lease still gets a full lease ──
$PSQL -q -v ON_ERROR_STOP=1 <<SQL
select public.fn_notification_enqueue('$u2', 'fixture.ttl-race', 'fixture:ttl-race:1', 'TTL race', 'TTL race.', null, 'urgent');
update public.notification_deliveries d set next_attempt_at = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.dedupe_key = 'fixture:ttl-race:1';
SQL
log_h="$(mktemp)"; log_i="$(mktemp)"
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_h" 2>&1 <<'SQL' &
begin;
select pg_advisory_xact_lock(1095978574);
select pg_sleep(32);
commit;
SQL
pid_h=$!
sleep 1
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_i" 2>&1 <<'SQL' &
begin;
-- the claim and the read are separate statements: one statement's snapshot predates its own claim's update
create temp table ttl_claim on commit drop as select x.id from public.fn_notification_email_claim(30, 8) x;
select extract(epoch from (c.lease_until - clock_timestamp()))::int
  from ttl_claim x join public.notification_deliveries c on c.id = x.id;
commit;
SQL
pid_i=$!
wait "$pid_h"; wait "$pid_i"
left_s="$(grep -E '^-?[0-9]+$' "$log_i" | head -1 || true)"
if [ -z "$left_s" ] || [ "$left_s" -lt 25 ]; then
  echo "FAIL: a claimant that waited behind the lock got a stale lease (seconds left: ${left_s:-none})" >&2
  cat "$log_i" >&2
  $PSQL -At -c "select n.dedupe_key, d.status, d.next_attempt_at > now(), d.lease_until, d.attempts from public.notification_deliveries d join public.notifications n on n.id = d.notification_id order by d.created_at" >&2
  exit 1
fi
rm -f "$log_h" "$log_i"

$PSQL -q -v ON_ERROR_STOP=1 <<SQL
set session_replication_role = replica;
delete from public.notification_deliveries where notification_id in (
  select id from public.notifications where recipient_user_id in ('$u1', '$u2')
);
delete from public.notification_digest_batches where recipient_user_id in ('$u1', '$u2');
delete from public.notifications where recipient_user_id in ('$u1', '$u2');
delete from public.notification_preferences where user_id in ('$u1', '$u2');
delete from public.users where id in ('$u1', '$u2');
delete from auth.users where id in ('$u1', '$u2');
set session_replication_role = origin;
SQL

echo "SHARED FIXTURE SERVICES CLAIM RACE: ALL ASSERTIONS PASSED"
