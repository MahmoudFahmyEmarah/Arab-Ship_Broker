-- Data Sync hardening — upload jobs and health signals, behavioural test for
-- 20260920130000_sync_upload_jobs_and_health.sql (20 Sep 2026; rewritten
-- 21 Sep 2026 for token leases and the retry state machine).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/upload_jobs_health_smoke.sql
--   supabase db query --local  --file supabase/tests/data_sync/upload_jobs_health_smoke.sql
--
-- BEGIN … ROLLBACK. Prints UPLOAD JOBS + HEALTH SMOKE: ALL ASSERTIONS PASSED.
--
-- Two assertions in the 20 Sep version encoded the defects as correct:
--   · S3 called finish with no lease token, because none existed.
--   · S5 asserted that ONE handled failure leaves the job 'failed', under a
--     comment that said the bytes were kept "for the next one" — when the
--     claim query never looks at a failed row again, so there was no next
--     one. That test would have fought the fix, so it now asserts the
--     behaviour the module is supposed to have: a transient failure waits in
--     retry_wait and is claimed again when it comes due.

begin;

do $$
declare j public.sync_upload_job%rowtype; j2 public.sync_upload_job%rowtype; v_id uuid; v_batch uuid; n int; s jsonb; r jsonb;
begin
  insert into public.sync_upload_job (file_name, bytes, size, rows_parsed) values ('big.xlsx', '\x504b0304'::bytea, 4, 20000) returning id into v_id;

  -- S1 · claim: leased WITH A TOKEN, running, attempts = 1, batch reserved;
  --      a second claim gets nothing
  select * into j from public.claim_sync_upload_job(60);
  if j.id is distinct from v_id or j.status <> 'running' or j.attempts <> 1 or j.lease_until is null then
    raise exception 'S1: claim wrong: % % %', j.status, j.attempts, j.lease_until;
  end if;
  if j.lease_token is null then raise exception 'S1: the claim returned no lease token'; end if;
  if j.batch_id is null then raise exception 'S1: the claim did not reserve a batch'; end if;
  select count(*) into n from public.claim_sync_upload_job(60);
  if n <> 0 then raise exception 'S1: a leased job was claimed again'; end if;

  -- S2 · an expired lease is claimed again (attempt 2) with a NEW token; the
  --      bytes are still there and the batch is the SAME one
  update public.sync_upload_job set lease_until = now() - interval '1 second' where id = v_id;
  select * into j2 from public.claim_sync_upload_job(60);
  if j2.id is distinct from v_id or j2.attempts <> 2 or length(j2.bytes) <> 4 then raise exception 'S2: re-claim wrong'; end if;
  if j2.lease_token is null or j2.lease_token = j.lease_token then raise exception 'S2: the reclaim did not mint a new token'; end if;
  if j2.batch_id is distinct from j.batch_id then raise exception 'S2: the reclaim reserved a second batch (% vs %)', j2.batch_id, j.batch_id; end if;

  -- S3 · the stale token can do nothing; the current one finishes
  r := public.finish_sync_upload_job(v_id, j.lease_token, true, j2.batch_id, null, '{"new": 5}'::jsonb);
  if (r->>'ok')::boolean then raise exception 'S3: the superseded token finished the job'; end if;
  if r->>'reason' <> 'lost_lease' then raise exception 'S3: wrong refusal reason: %', r; end if;
  select * into j from public.sync_upload_job where id = v_id;
  if j.status <> 'running' then raise exception 'S3: the stale token changed the status to %', j.status; end if;

  r := public.finish_sync_upload_job(v_id, j2.lease_token, true, j2.batch_id, null, '{"new": 5}'::jsonb);
  if not (r->>'ok')::boolean or r->>'status' <> 'done' then raise exception 'S3: the current token could not finish: %', r; end if;
  select * into j from public.sync_upload_job where id = v_id;
  if j.status <> 'done' or j.batch_id is null or j.bytes is not null or j.finished_at is null then raise exception 'S3: finished state wrong'; end if;
  r := public.finish_sync_upload_job(v_id, j2.lease_token, false, null, 'late', null);
  if (r->>'ok')::boolean then raise exception 'S3: a finished job accepted another result'; end if;

  -- S4 · attempts without a result park the job as failed
  insert into public.sync_upload_job (file_name, bytes, size) values ('poison.xlsx', '\x00'::bytea, 1) returning id into v_id;
  for n in 1..3 loop
    perform * from public.claim_sync_upload_job(60);
    update public.sync_upload_job set lease_until = now() - interval '1 second' where id = v_id;
  end loop;
  select count(*) into n from public.claim_sync_upload_job(60);
  if n <> 0 then raise exception 'S4: a poison job was claimed a fourth time'; end if;
  select * into j from public.sync_upload_job where id = v_id;
  if j.status <> 'failed' or j.error not like '%gave up after 3 attempt%' then raise exception 'S4: poison job not parked: % %', j.status, j.error; end if;

  -- S5 · a HANDLED transient failure is a RETRY, not a terminal failure. The
  --      job waits in retry_wait with a future next_attempt_at, keeps its
  --      workbook, is not claimable before it is due, and is claimable after.
  insert into public.sync_upload_job (file_name, bytes, size) values ('retry.xlsx', '\x0102'::bytea, 2) returning id into v_id;
  select * into j from public.claim_sync_upload_job(60);
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'connection reset', null, 'transient');
  if r->>'status' <> 'retry_wait' then raise exception 'S5: a transient failure should wait to retry, got %', r; end if;
  select * into j2 from public.sync_upload_job where id = v_id;
  if j2.status <> 'retry_wait' or length(j2.bytes) <> 2 then raise exception 'S5: retrying job lost its bytes or its state'; end if;
  if j2.next_attempt_at <= now() then raise exception 'S5: the retry has no back-off (next_attempt_at %)', j2.next_attempt_at; end if;
  if j2.failure_kind <> 'transient' then raise exception 'S5: the failure was not classified'; end if;
  select count(*) into n from public.claim_sync_upload_job(60);
  if n <> 0 then raise exception 'S5: a retry was claimed before it was due'; end if;
  update public.sync_upload_job set next_attempt_at = now() - interval '1 second' where id = v_id;
  select * into j from public.claim_sync_upload_job(60);
  if j.id is distinct from v_id or j.attempts <> 2 then raise exception 'S5: a due retry was not claimed'; end if;

  -- S5b · a PERMANENT failure parks at once, whatever the attempt count
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'not a workbook', null, 'permanent');
  if r->>'status' <> 'failed' then raise exception 'S5b: a permanent failure should park, got %', r; end if;
  select * into j from public.sync_upload_job where id = v_id;
  if j.failure_kind <> 'permanent' or j.payload_expires_at is null then raise exception 'S5b: parked state wrong (kind %, expiry %)', j.failure_kind, j.payload_expires_at; end if;

  -- S6 · health signals: each seeded condition shows up under its kind
  update public.sync_source_state set lease_owner = 'smoke', lease_until = now() - interval '11 minutes' where source = 'email';
  if not found then insert into public.sync_source_state (source, lease_owner, lease_until) values ('email', 'smoke', now() - interval '11 minutes'); end if;
  insert into public.whatsapp_message (wa_message_id, provider, wa_from, body, received_at, status) values ('SMOKE:health-failed', 'meta', '+20100000099', 'x', now() - interval '1 hour', 'failed');
  insert into public.whatsapp_message (wa_message_id, provider, wa_from, body, received_at, status) values ('SMOKE:health-stale', 'meta', '+20100000098', 'x', now() - interval '31 minutes', 'pending');
  insert into public.job_runs (job, started_at, status) values ('email-sync', now() - interval '3 hours', 'running');
  insert into public.sync_upload_job (file_name, bytes, size, status, created_at) values ('stuck.xlsx', '\x03'::bytea, 1, 'queued', now() - interval '31 minutes');
  s := public.fn_sync_health_summary();
  if coalesce((s->>'stuck_lease')::int, 0) < 1 then raise exception 'S6: stuck lease not reported: %', s; end if;
  if coalesce((s->>'whatsapp_failed')::int, 0) < 1 then raise exception 'S6: failed message not reported: %', s; end if;
  if coalesce((s->>'whatsapp_stale')::int, 0) < 1 then raise exception 'S6: stale message not reported: %', s; end if;
  if coalesce((s->>'unfinished_job')::int, 0) < 1 then raise exception 'S6: unfinished job not reported: %', s; end if;
  if coalesce((s->>'upload_job_stuck')::int, 0) < 1 then raise exception 'S6: stuck upload job not reported: %', s; end if;
  if coalesce((s->>'upload_job_failed')::int, 0) < 1 then raise exception 'S6: parked upload job not reported: %', s; end if;
  -- a fresh lease, a message received a minute ago, a job started now: not alerts
  update public.sync_source_state set lease_until = now() + interval '5 minutes' where source = 'email';
  if exists (select 1 from public.sync_health_alerts where kind = 'stuck_lease' and ref = 'email') then raise exception 'S6: a live lease reported as stuck'; end if;

  raise notice 'UPLOAD JOBS + HEALTH SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
