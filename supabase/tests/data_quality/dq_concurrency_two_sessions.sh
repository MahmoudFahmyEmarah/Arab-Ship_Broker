#!/usr/bin/env bash
# Data Quality · concurrency with two REAL database sessions (20 Sep 2026).
# Disposable database only: the sessions commit; the script cleans up.
#
#   supabase/tests/data_quality/dq_concurrency_two_sessions.sh [psql-command]
#
#   1. outbox workers   20 queued notifications; two workers claim 10 each at
#                       the same moment → disjoint sets, every row claimed once
#   2. AI reservations  cap 1,000; two sessions each reserve 600 in overlapping
#                       transactions → exactly one succeeds, reserved never
#                       exceeds the cap
#   3. nightly schedule two sessions insert the same day's scheduled run at
#                       once → exactly one row exists
#   4. run settlement   two sessions settle the same run at once → one row,
#                       one notification, consistent counters
set -euo pipefail
PSQL="${1:-docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres}"
q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }
fail=0
ok() { if [ "$1" = "$2" ]; then echo "  ok   $3 ($1)"; else echo " FAIL  $3 — expected [$2] got [$1]"; fail=1; fi; }
T=/tmp
cleanup() {
  $PSQL -q -v ON_ERROR_STOP=0 <<'SQL' > /dev/null 2>&1 || true
delete from public.dq_notification_outbox where idem_key like 'race/%';
delete from public.dq_ai_reservations where idem_key like 'race/%';
delete from public.dq_run_batches where run_id in (select id from public.dq_runs where started_by_name like 'race%');
delete from public.dq_run_keys where run_id in (select id from public.dq_runs where started_by_name like 'race%');
delete from public.dq_runs where started_by_name like 'race%';
delete from public.dq_ai_usage where day = current_date and tokens = 0 and reserved = 0;
SQL
}
cleanup

echo "── 1 · two outbox workers"
q "select count(*) from (select public.fn_dq_outbox_enqueue('digest', 'race/' || g, '{}'::jsonb) from generate_series(1, 20) g) x" > /dev/null
$PSQL -At -c "begin; select id from public.fn_dq_outbox_claim(10, 60); select pg_sleep(2); commit;" > $T/w1.txt 2>&1 &
$PSQL -At -c "begin; select id from public.fn_dq_outbox_claim(10, 60); select pg_sleep(2); commit;" > $T/w2.txt 2>&1 &
wait
a=$(grep -E '^[0-9]+$' $T/w1.txt | sort); b=$(grep -E '^[0-9]+$' $T/w2.txt | sort)
ok "$(echo "$a" | grep -c .)" "10" "worker 1 claimed 10"
ok "$(echo "$b" | grep -c .)" "10" "worker 2 claimed 10"
ok "$(comm -12 <(echo "$a") <(echo "$b") | grep -c . || true)" "0" "no row claimed by both"
ok "$(q "select count(*) from public.dq_notification_outbox where idem_key like 'race/%' and status = 'sending' and claim_token is not null")" "20" "every row is leased exactly once"

echo "── 2 · two sessions reserving against one cap"
q "update public.dq_settings set ai_daily_tokens = 1000 where id = 1; delete from public.dq_ai_reservations where day = current_date; delete from public.dq_ai_usage where day = current_date;" > /dev/null
$PSQL -At -c "begin; select (public.fn_dq_reserve_ai(600, 'race/a', null, 60))->>'ok'; select pg_sleep(2); commit;" > $T/r1.txt 2>&1 &
sleep 0.3
$PSQL -At -c "begin; select (public.fn_dq_reserve_ai(600, 'race/b', null, 60))->>'ok'; commit;" > $T/r2.txt 2>&1 &
wait
oks=$(cat $T/r1.txt $T/r2.txt | grep -c '^true$' || true)
ok "$oks" "1" "exactly one of two 600-token reservations succeeded under a 1,000 cap"
ok "$(q "select reserved from public.dq_ai_usage where day = current_date")" "600" "reserved never exceeds what was granted"

echo "── 3 · two cron invocations creating the same night's run"
KEY="nightly/2098-12-31"
$PSQL -At -c "insert into public.dq_runs (scope, mode, batch_size, started_by_name, trigger, schedule_key) values ('{\"kind\":\"db\"}', 'rules', 1000, 'race cron 1', 'scheduler', '$KEY');" > $T/c1.txt 2>&1 &
$PSQL -At -c "insert into public.dq_runs (scope, mode, batch_size, started_by_name, trigger, schedule_key) values ('{\"kind\":\"db\"}', 'rules', 1000, 'race cron 2', 'scheduler', '$KEY');" > $T/c2.txt 2>&1 &
wait
ok "$(q "select count(*) from public.dq_runs where schedule_key = '$KEY'")" "1" "one scheduled run for the day"
ok "$(cat $T/c1.txt $T/c2.txt | grep -c 'duplicate key' || true)" "1" "the other invocation hit the unique key"

echo "── 4 · two sessions settling one run"
RUN=$(q "with i as (insert into public.dq_runs (scope, mode, batch_size, started_by_name, status, tables, started_at) values ('{\"kind\":\"tables\",\"tables\":[\"ports\"]}', 'rules', 1000, 'race settle', 'running', array['ports'], now()) returning id) select id from i")
$PSQL -At -c "begin; select public.fn_dq_settle_run('$RUN'::uuid)->>'status'; select pg_sleep(2); commit;" > $T/s1.txt 2>&1 &
sleep 0.3
$PSQL -At -c "begin; select public.fn_dq_settle_run('$RUN'::uuid)->>'status'; commit;" > $T/s2.txt 2>&1 &
wait
ok "$(cat $T/s1.txt $T/s2.txt | grep -c '^completed$' || true)" "2" "both settlements completed (the second waited for the first's row lock)"
ok "$(q "select count(*) from public.dq_notification_outbox where idem_key = 'run/$RUN'")" "1" "one notification for the run"
ok "$(q "select status from public.dq_runs where id = '$RUN'")" "completed" "the run is completed once"

cleanup
if [ $fail = 0 ]; then echo "DQ CONCURRENCY (two sessions): ALL ASSERTIONS PASSED"; else echo "DQ CONCURRENCY (two sessions): FAILED"; exit 1; fi
