#!/usr/bin/env bash
# Two real PostgreSQL sessions prove that SKIP LOCKED never leases the same
# notification delivery to concurrent workers. Run only on a disposable DB.
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

log_a="$(mktemp)"; log_b="$(mktemp)"
trap 'rm -f "$log_a" "$log_b"' EXIT

$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<'SQL' &
begin;
select id from public.fn_notification_delivery_claim(1, 180, 8);
select pg_sleep(4);
commit;
SQL
pid_a=$!
sleep 1
$PSQL -At -q -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<'SQL' &
select id from public.fn_notification_delivery_claim(1, 180, 8);
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

echo "SHARED FIXTURE SERVICES CLAIM RACE: ALL ASSERTIONS PASSED"
