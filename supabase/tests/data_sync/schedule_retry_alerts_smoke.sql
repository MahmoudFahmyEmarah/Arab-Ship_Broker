-- Data Sync hardening — scheduled-run outcomes, job reconciliation and health
-- alert state (workstreams F, G and I; 21 Sep 2026)
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/schedule_retry_alerts_smoke.sql
--
-- BEGIN … ROLLBACK. Prints SCHEDULE + ALERTS SMOKE: ALL ASSERTIONS PASSED.
--
--   F1  a success advances to the normal slot, moves the anchor, resets retries
--   F2  an empty run counts as a success
--   F3  a failure retries soon and does NOT move the anchor
--   F4  consecutive failures back off further, bounded at an hour
--   F5  past the retry ceiling the normal cadence is restored
--   F6  a lease refusal moves nothing at all
--   F7  a forced run moves nothing unless asked
--   F8  an unknown outcome is refused
--   G1  a job_runs row running past the threshold is closed
--   G2  a fresh running row is left alone
--   I1  a condition must be seen N times before it is reported
--   I2  a reported condition is not reported again
--   I3  a cleared condition produces exactly one recovery
--   I4  a condition that never reached the threshold is forgotten, not recovered

begin;

do $$
declare
  c public.email_ingest_config%rowtype; r jsonb; v_anchor timestamptz; v_next timestamptz; v_prev timestamptz;
  n int; v_id bigint; v_notify int; v_recover int; v_msg text;
begin
  -- one config row for the test (this whole block is rolled back)
  insert into public.email_ingest_config (only_one, provider, imap_host, imap_port, username, folder, is_enabled,
                                          schedule_enabled, schedule_kind, schedule_hour_utc, schedule_interval_days, schedule_weekday)
  values (true, 'imap', 'imap.example.com', 993, 'ops@example.com', 'INBOX', true, true, 'daily', 2, 2, 1)
  on conflict (only_one) do update set is_enabled = true, schedule_enabled = true;

  -- ── F1 · success ────────────────────────────────────────────────────────
  v_next := date_trunc('hour', now()) + interval '1 day';
  r := public.fn_sync_email_schedule_outcome('success', v_next, 600, 6, false);
  if not (r->>'ok')::boolean then raise exception 'F1: refused: %', r; end if;
  if not (r->>'advanced')::boolean then raise exception 'F1: a success must advance the schedule: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at is distinct from v_next then raise exception 'F1: next_run_at is % not %', c.next_run_at, v_next; end if;
  if c.schedule_anchor_at is null then raise exception 'F1: the anchor did not move'; end if;
  if c.schedule_retry_count <> 0 then raise exception 'F1: retries not reset'; end if;
  if c.last_outcome <> 'success' then raise exception 'F1: outcome not recorded'; end if;
  v_anchor := c.schedule_anchor_at;

  -- ── F2 · an empty inbox is a complete run ───────────────────────────────
  r := public.fn_sync_email_schedule_outcome('empty', v_next + interval '1 day', 600, 6, false);
  if not (r->>'advanced')::boolean then raise exception 'F2: an empty run must advance: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.last_outcome <> 'empty' then raise exception 'F2: outcome not recorded'; end if;
  v_anchor := c.schedule_anchor_at;

  -- ── F3 · a failure retries soon, anchor untouched ───────────────────────
  r := public.fn_sync_email_schedule_outcome('failed', v_next + interval '2 days', 600, 6, false);
  if (r->>'advanced')::boolean then raise exception 'F3: a failure must not advance the cadence: %', r; end if;
  if not (r->>'retrying')::boolean then raise exception 'F3: a failure must schedule a retry: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.schedule_anchor_at is distinct from v_anchor then raise exception 'F3: the failure moved the anchor'; end if;
  if c.schedule_retry_count <> 1 then raise exception 'F3: retry count is %', c.schedule_retry_count; end if;
  if c.next_run_at > now() + interval '11 minutes' or c.next_run_at <= now() then
    raise exception 'F3: the retry is not soon (%); expected about ten minutes', c.next_run_at;
  end if;
  v_prev := c.next_run_at;

  -- ── F4 · the back-off grows, bounded at an hour ─────────────────────────
  r := public.fn_sync_email_schedule_outcome('failed', null, 600, 6, false);
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at <= v_prev then raise exception 'F4: the back-off did not grow (% then %)', v_prev, c.next_run_at; end if;
  if c.schedule_retry_count <> 2 then raise exception 'F4: retry count is %', c.schedule_retry_count; end if;
  -- jump to a high retry count: still no more than an hour away
  update public.email_ingest_config set schedule_retry_count = 5 where only_one;
  r := public.fn_sync_email_schedule_outcome('failed', null, 600, 6, false);
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at > now() + interval '61 minutes' then raise exception 'F4: the back-off is unbounded (%)', c.next_run_at; end if;
  if c.schedule_anchor_at is distinct from v_anchor then raise exception 'F4: a retry moved the anchor'; end if;

  -- ── F5 · past the ceiling, back to the normal cadence ───────────────────
  update public.email_ingest_config set schedule_retry_count = 6 where only_one;
  v_next := date_trunc('hour', now()) + interval '2 days';
  r := public.fn_sync_email_schedule_outcome('failed', v_next, 600, 6, false);
  if not (r->>'advanced')::boolean then raise exception 'F5: past the ceiling the normal slot should be restored: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at is distinct from v_next then raise exception 'F5: next_run_at is %', c.next_run_at; end if;
  if c.schedule_retry_count <> 0 then raise exception 'F5: the retry counter was not reset'; end if;

  -- ── F6 · a lease refusal changes nothing but the record ─────────────────
  select * into c from public.email_ingest_config where only_one;
  v_prev := c.next_run_at; v_anchor := c.schedule_anchor_at;
  r := public.fn_sync_email_schedule_outcome('skipped_lease', date_trunc('hour', now()) + interval '9 days', 600, 6, false);
  if (r->>'advanced')::boolean or (r->>'retrying')::boolean then raise exception 'F6: a skipped run moved the schedule: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at is distinct from v_prev then raise exception 'F6: next_run_at moved to %', c.next_run_at; end if;
  if c.schedule_anchor_at is distinct from v_anchor then raise exception 'F6: the anchor moved'; end if;
  if c.schedule_retry_count <> 0 then raise exception 'F6: the retry counter moved'; end if;
  if c.last_outcome <> 'skipped_lease' then raise exception 'F6: outcome not recorded'; end if;

  -- ── F7 · a forced run only moves the schedule when asked ────────────────
  r := public.fn_sync_email_schedule_outcome('forced', date_trunc('hour', now()) + interval '9 days', 600, 6, false);
  if (r->>'advanced')::boolean then raise exception 'F7: a forced run moved the schedule without being asked: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at is distinct from v_prev then raise exception 'F7: next_run_at moved'; end if;
  v_next := date_trunc('hour', now()) + interval '3 days';
  r := public.fn_sync_email_schedule_outcome('forced', v_next, 600, 6, true);
  if not (r->>'advanced')::boolean then raise exception 'F7: an explicit advance was ignored: %', r; end if;
  select * into c from public.email_ingest_config where only_one;
  if c.next_run_at is distinct from v_next then raise exception 'F7: next_run_at is %', c.next_run_at; end if;

  -- ── F8 · an unknown outcome is refused, not guessed ─────────────────────
  begin
    r := public.fn_sync_email_schedule_outcome('whatever', now(), 600, 6, false);
    raise exception 'F8: an unknown outcome was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- ── G1 / G2 · job_runs reconciliation ───────────────────────────────────
  insert into public.job_runs (job, started_at, status) values ('email-sync', now() - interval '5 hours', 'running') returning id into v_id;
  insert into public.job_runs (job, started_at, status) values ('upload-jobs', now() - interval '2 minutes', 'running');
  r := public.fn_sync_reconcile_job_runs(120);
  if (r->>'closed')::int < 1 then raise exception 'G1: the stale job was not closed: %', r; end if;
  select status into v_msg from public.job_runs where id = v_id;
  if v_msg <> 'failed' then raise exception 'G1: the stale row is % not failed', v_msg; end if;
  select error into v_msg from public.job_runs where id = v_id;
  if v_msg not like '%no terminal status%' then raise exception 'G1: unclear reconciliation reason: %', v_msg; end if;
  if not exists (select 1 from public.job_runs where job = 'upload-jobs' and status = 'running' and started_at > now() - interval '5 minutes') then
    raise exception 'G2: a fresh running job was closed';
  end if;

  -- ── I1–I4 · alert state ─────────────────────────────────────────────────
  delete from public.sync_alert_state;
  -- one real condition: a lease that expired long ago
  insert into public.sync_source_state (source, lease_owner, lease_until) values ('email', 'smoke-alert', now() - interval '20 minutes')
  on conflict (source) do update set lease_owner = 'smoke-alert', lease_until = now() - interval '20 minutes';
  if not exists (select 1 from public.sync_health_alerts where kind = 'stuck_lease') then raise exception 'I1: the seeded condition is not in the view'; end if;

  -- first check at a threshold of two: seen once, said nothing
  select count(*) into v_notify from public.fn_sync_alert_state(2) where action = 'notify';
  if v_notify <> 0 then raise exception 'I1: reported on the first sighting (threshold 2)'; end if;
  select consecutive into n from public.sync_alert_state where kind = 'stuck_lease';
  if n <> 1 then raise exception 'I1: consecutive is % after one check', n; end if;

  -- second check: now it is reported, exactly once
  select count(*) into v_notify from public.fn_sync_alert_state(2) where action = 'notify';
  if v_notify <> 1 then raise exception 'I1: not reported on the second sighting, got %', v_notify; end if;
  select notified_at into v_next from public.sync_alert_state where kind = 'stuck_lease';
  if v_next is null then raise exception 'I1: notified_at was not set'; end if;

  -- I2 · a third check says nothing new
  select count(*) into v_notify from public.fn_sync_alert_state(2) where action = 'notify';
  if v_notify <> 0 then raise exception 'I2: the same condition was reported again'; end if;

  -- I3 · it clears: exactly one recovery, and only once
  update public.sync_source_state set lease_until = now() + interval '10 minutes' where source = 'email';
  select count(*) into v_recover from public.fn_sync_alert_state(2) where action = 'recover';
  if v_recover <> 1 then raise exception 'I3: expected one recovery, got %', v_recover; end if;
  select count(*) into v_recover from public.fn_sync_alert_state(2) where action = 'recover';
  if v_recover <> 0 then raise exception 'I3: the recovery was sent twice'; end if;
  select cleared_at into v_next from public.sync_alert_state where kind = 'stuck_lease';
  if v_next is null then raise exception 'I3: cleared_at was not set'; end if;

  -- I4 · a condition that never reached the threshold is forgotten silently
  delete from public.sync_alert_state;
  update public.sync_source_state set lease_until = now() - interval '20 minutes' where source = 'email';
  perform public.fn_sync_alert_state(3);                  -- seen once of three
  select count(*) into n from public.sync_alert_state where kind = 'stuck_lease';
  if n <> 1 then raise exception 'I4: the sighting was not recorded'; end if;
  update public.sync_source_state set lease_until = now() + interval '10 minutes' where source = 'email';
  select count(*) into v_recover from public.fn_sync_alert_state(3) where action = 'recover';
  if v_recover <> 0 then raise exception 'I4: recovered a condition nobody was told about'; end if;
  select count(*) into n from public.sync_alert_state where kind = 'stuck_lease';
  if n <> 0 then raise exception 'I4: an unreported, cleared condition was kept'; end if;

  -- the pruner clears old recoveries and nothing else
  insert into public.sync_alert_state (kind, ref, consecutive, notified_at, cleared_at) values ('gate_error', 'old', 3, now() - interval '9 days', now() - interval '8 days');
  insert into public.sync_alert_state (kind, ref, consecutive, notified_at) values ('gate_error', 'live', 3, now());
  select public.fn_sync_alert_prune(72) into n;
  if n <> 1 then raise exception 'prune: expected to forget one old recovery, got %', n; end if;
  if not exists (select 1 from public.sync_alert_state where ref = 'live') then raise exception 'prune: an open condition was forgotten'; end if;

  raise notice 'SCHEDULE + ALERTS SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
