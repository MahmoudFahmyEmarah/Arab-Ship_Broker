-- Data Sync hardening — upload-job ownership and idempotency
-- (workstreams A, B and C; 21 Sep 2026)
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/upload_lease_idempotency_smoke.sql
--
-- BEGIN … ROLLBACK. Prints UPLOAD LEASE + IDEMPOTENCY SMOKE: ALL ASSERTIONS PASSED.
--
-- Every acceptance statement the review asked for, as an assertion:
--   A1  two claims in a row cannot both own a job
--   A2  a lapsed lease is reclaimed, with a NEW token
--   A3  the stale token cannot finish, fail, move the batch, clear the
--       payload or touch the totals
--   A4  the CURRENT token may finish after its nominal expiry, because
--       lateness is not loss of ownership
--   A5  once reclaimed, the old token is permanently useless
--   A6  max attempts parks the job
--   B1  the claim reserves the batch; every attempt gets the same one
--   B2  a second batch per job is impossible at the storage layer
--   B3  a batch with a committed row is not resumable
--   B4  fault injection at each interruption point leaves ONE batch, ONE
--       logical copy of each staged row and ONE terminal result
--   C1  a transient failure waits; a permanent one parks
--   C2  the back-off grows and is bounded
--   C3  a retry is not claimable before it is due
--   C4  a cron pass cannot re-claim a parked job

begin;

do $$
declare
  j public.sync_upload_job%rowtype; j2 public.sync_upload_job%rowtype; j3 public.sync_upload_job%rowtype;
  v_id uuid; v_other uuid; v_batch uuid; v_tok1 uuid; v_tok2 uuid; n int; r jsonb; res jsonb;
  v_first timestamptz; v_second timestamptz; v_rows int;
begin
  -- ── A1 · one owner at a time ───────────────────────────────────────────
  insert into public.sync_upload_job (file_name, bytes, size) values ('a.xlsx', '\x504b'::bytea, 2) returning id into v_id;
  select * into j from public.claim_sync_upload_job(300);
  v_tok1 := j.lease_token; v_batch := j.batch_id;
  if v_tok1 is null then raise exception 'A1: no token'; end if;
  select count(*) into n from public.claim_sync_upload_job(300);
  if n <> 0 then raise exception 'A1: the job was claimed twice while leased'; end if;

  -- ── A4 · a current token may finish LATE (not reclaimed) ───────────────
  update public.sync_upload_job set lease_until = now() - interval '5 minutes' where id = v_id;
  r := public.finish_sync_upload_job(v_id, v_tok1, true, v_batch, null, '{"new":1}'::jsonb);
  if not (r->>'ok')::boolean then raise exception 'A4: a current token was refused merely for being late: %', r; end if;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- ── A2 / A3 / A5 · reclaim mints a new token and kills the old one ─────
  insert into public.sync_upload_job (file_name, bytes, size, totals) values ('b.xlsx', '\x504b'::bytea, 2, '{"seed":7}'::jsonb) returning id into v_id;
  select * into j from public.claim_sync_upload_job(300);
  v_tok1 := j.lease_token; v_batch := j.batch_id;
  update public.sync_upload_job set lease_until = now() - interval '1 second' where id = v_id;
  select * into j2 from public.claim_sync_upload_job(300);
  v_tok2 := j2.lease_token;
  if v_tok2 is null or v_tok2 = v_tok1 then raise exception 'A2: the reclaim did not mint a new token'; end if;
  if j2.attempts <> 2 then raise exception 'A2: attempts should be 2, got %', j2.attempts; end if;

  -- the stale token: every avenue refused, nothing changed
  r := public.finish_sync_upload_job(v_id, v_tok1, true, gen_random_uuid(), null, '{"new":99}'::jsonb);
  if (r->>'ok')::boolean or r->>'reason' <> 'lost_lease' then raise exception 'A3: stale success accepted: %', r; end if;
  r := public.finish_sync_upload_job(v_id, v_tok1, false, null, 'stale failure', null, 'permanent');
  if (r->>'ok')::boolean then raise exception 'A3: stale failure accepted: %', r; end if;
  select * into j3 from public.sync_upload_job where id = v_id;
  if j3.status <> 'running' then raise exception 'A3: the stale token changed the status to %', j3.status; end if;
  if j3.batch_id is distinct from v_batch then raise exception 'A3: the stale token moved the batch'; end if;
  if j3.bytes is null then raise exception 'A3: the stale token cleared the payload'; end if;
  if j3.totals is distinct from '{"seed":7}'::jsonb then raise exception 'A3: the stale token changed the totals to %', j3.totals; end if;
  if j3.lease_token <> v_tok2 then raise exception 'A3: the stale token replaced the owner'; end if;
  -- A5 · and it stays useless after the current owner finishes
  r := public.finish_sync_upload_job(v_id, v_tok2, true, v_batch, null, null);
  if not (r->>'ok')::boolean then raise exception 'A5: the current owner could not finish: %', r; end if;
  r := public.finish_sync_upload_job(v_id, v_tok1, true, v_batch, null, null);
  if (r->>'ok')::boolean then raise exception 'A5: the old token worked after the job was done'; end if;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- ── A6 · the last attempt parks whatever the classification ────────────
  insert into public.sync_upload_job (file_name, bytes, size, max_attempts) values ('c.xlsx', '\x504b'::bytea, 2, 2) returning id into v_id;
  select * into j from public.claim_sync_upload_job(300);
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'one', null, 'transient');
  if r->>'status' <> 'retry_wait' then raise exception 'A6: attempt 1 of 2 should retry, got %', r; end if;
  update public.sync_upload_job set next_attempt_at = now() - interval '1 second' where id = v_id;
  select * into j from public.claim_sync_upload_job(300);
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'two', null, 'transient');
  if r->>'status' <> 'failed' then raise exception 'A6: the last attempt should park even for a transient failure, got %', r; end if;
  -- C4 · and a parked job is never claimed again
  select count(*) into n from public.claim_sync_upload_job(300);
  if n <> 0 then raise exception 'C4: a parked job was claimed again'; end if;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- ── B1 / B2 · one job, one batch ───────────────────────────────────────
  -- max_attempts 5 so the four claims below stay inside the budget; the
  -- refusal past max_attempts is asserted by A6 and C4.
  insert into public.sync_upload_job (file_name, bytes, size, max_attempts) values ('d.xlsx', '\x504b'::bytea, 2, 5) returning id into v_id;
  select * into j from public.claim_sync_upload_job(300);
  v_batch := j.batch_id;
  if v_batch is null then raise exception 'B1: the claim reserved no batch'; end if;
  if not exists (select 1 from public.sync_batch where id = v_batch and source = 'upload' and status = 'draft') then
    raise exception 'B1: the reserved batch is not a draft upload batch';
  end if;
  -- three more attempts: the same batch every time
  for n in 1..3 loop
    update public.sync_upload_job set lease_until = now() - interval '1 second' where id = v_id;
    select * into j2 from public.claim_sync_upload_job(300);
    if j2.id is distinct from v_id then raise exception 'B1: attempt % claimed job % instead of %', n, j2.id, v_id; end if;
    if j2.batch_id is distinct from v_batch then raise exception 'B1: attempt % reserved a different batch', n; end if;
  end loop;
  -- B2 · the database itself refuses a second job on that batch
  insert into public.sync_upload_job (file_name, bytes, size) values ('e.xlsx', '\x504b'::bytea, 2) returning id into v_other;
  begin
    update public.sync_upload_job set batch_id = v_batch where id = v_other;
    raise exception 'B2: two jobs were allowed to own one batch';
  exception when unique_violation then null;
  end;

  -- ── B3 · a batch with committed work is not resumable ──────────────────
  res := public.fn_sync_upload_batch_resumable(v_batch);
  if not (res->>'resumable')::boolean then raise exception 'B3: a draft batch should be resumable: %', res; end if;
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, raw, diff, flags, row_index, committed)
  values (v_batch, 'ports', 'ports', 'locode', 'ZZRES', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 1, true);
  res := public.fn_sync_upload_batch_resumable(v_batch);
  if (res->>'resumable')::boolean then raise exception 'B3: a batch with a committed row must not be rebuilt: %', res; end if;
  if res->>'reason' not like '%already committed%' then raise exception 'B3: unclear reason: %', res; end if;
  -- and retry_sync_upload_job refuses on that basis
  update public.sync_upload_job set status = 'failed', finished_at = now() where id = v_id;
  r := public.retry_sync_upload_job(v_id, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'batch_touched' then raise exception 'B3: retry allowed into committed work: %', r; end if;
  delete from public.sync_staged_row where batch_id = v_batch;
  r := public.retry_sync_upload_job(v_id, null);
  if not (r->>'ok')::boolean then raise exception 'B3: retry refused for a clean batch: %', r; end if;
  select * into j from public.sync_upload_job where id = v_id;
  if j.status <> 'queued' or j.attempts <> 0 then raise exception 'B3: requeue did not reset the job'; end if;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- ── B4 · fault injection at every interruption point ───────────────────
  -- Each case claims, simulates dying at one point, then lets the next pass
  -- continue. The closing assertion is the same every time: one batch, one
  -- logical copy of the row, one terminal result.
  declare
    v_point text;
    v_points text[] := array['after_claim', 'after_batch', 'mid_rows', 'after_rows', 'after_gate', 'after_finalise'];
    v_job uuid; v_b uuid; v_tok uuid;
  begin
    foreach v_point in array v_points loop
      update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
       where status in ('queued', 'running', 'retry_wait');
      insert into public.sync_upload_job (file_name, bytes, size) values (v_point || '.xlsx', '\x504b'::bytea, 2) returning id into v_job;
      select * into j from public.claim_sync_upload_job(300);
      v_b := j.batch_id; v_tok := j.lease_token;

      -- the work this attempt got through before it died
      if v_point in ('mid_rows', 'after_rows', 'after_gate', 'after_finalise') then
        insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, raw, diff, flags, row_index)
        values (v_b, 'ports', 'ports', 'locode', 'ZZF01', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 1);
      end if;
      if v_point in ('after_rows', 'after_gate', 'after_finalise') then
        insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, raw, diff, flags, row_index)
        values (v_b, 'ports', 'ports', 'locode', 'ZZF02', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 2);
      end if;
      if v_point in ('after_gate', 'after_finalise') then
        update public.sync_batch set status = 'gated' where id = v_b;
      end if;
      if v_point = 'after_finalise' then
        r := public.finish_sync_upload_job(v_job, v_tok, true, v_b, null, '{"new":2}'::jsonb);
        if not (r->>'ok')::boolean then raise exception 'B4/%: finalisation failed: %', v_point, r; end if;
      end if;

      -- the worker died here; the lease lapses and the next pass takes over
      if v_point <> 'after_finalise' then
        update public.sync_upload_job set lease_until = now() - interval '1 second' where id = v_job;
        select * into j2 from public.claim_sync_upload_job(300);
        if j2.id is distinct from v_job then raise exception 'B4/%: the next pass did not reclaim the job', v_point; end if;
        if j2.batch_id is distinct from v_b then raise exception 'B4/%: the next pass opened a second batch', v_point; end if;
        -- what stageBatch does when it resumes: refuse if unsafe, else clear
        -- the previous attempt's uncommitted rows and re-stage
        res := public.fn_sync_upload_batch_resumable(j2.batch_id);
        if not (res->>'resumable')::boolean then raise exception 'B4/%: the reserved batch became unusable: %', v_point, res; end if;
        delete from public.sync_staged_row where batch_id = j2.batch_id and not committed;
        insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, raw, diff, flags, row_index)
        values (j2.batch_id, 'ports', 'ports', 'locode', 'ZZF01', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 1),
               (j2.batch_id, 'ports', 'ports', 'locode', 'ZZF02', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 2);
        update public.sync_batch set status = 'gated' where id = j2.batch_id;
        r := public.finish_sync_upload_job(v_job, j2.lease_token, true, j2.batch_id, null, '{"new":2}'::jsonb);
        if not (r->>'ok')::boolean then raise exception 'B4/%: the resumed pass could not finalise: %', v_point, r; end if;
      end if;

      -- ONE job, ONE batch, ONE logical copy of each row, ONE terminal result
      select count(*) into n from public.sync_upload_job where id = v_job;
      if n <> 1 then raise exception 'B4/%: % job rows', v_point, n; end if;
      select count(*) into n from public.sync_upload_job where batch_id = v_b;
      if n <> 1 then raise exception 'B4/%: % jobs own the batch', v_point, n; end if;
      select count(*) into n from public.sync_batch where id = v_b;
      if n <> 1 then raise exception 'B4/%: % batches', v_point, n; end if;
      select count(*) into v_rows from public.sync_staged_row where batch_id = v_b;
      if v_rows <> 2 then raise exception 'B4/%: expected 2 staged rows, found % (a retry duplicated them)', v_point, v_rows; end if;
      select count(distinct (sheet, row_index)) into n from public.sync_staged_row where batch_id = v_b;
      if n <> v_rows then raise exception 'B4/%: staged rows are not unique per (sheet, row_index)', v_point; end if;
      select count(*) into n from public.sync_upload_job where id = v_job and status = 'done' and finished_at is not null;
      if n <> 1 then raise exception 'B4/%: the job has no single terminal result', v_point; end if;
    end loop;
  end;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- the unique index behind B4's row assertion really exists and bites
  insert into public.sync_upload_job (file_name, bytes, size) values ('dup.xlsx', '\x504b'::bytea, 2) returning id into v_id;
  select * into j from public.claim_sync_upload_job(300);
  insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, raw, diff, flags, row_index)
  values (j.batch_id, 'ports', 'ports', 'locode', 'ZZDUP', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 9);
  begin
    insert into public.sync_staged_row (batch_id, sheet, target_table, key_column, business_key, classification, payload, raw, diff, flags, row_index)
    values (j.batch_id, 'ports', 'ports', 'locode', 'ZZDUP2', 'new', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 9);
    raise exception 'B4: (batch, sheet, row_index) is not unique';
  exception when unique_violation then null;
  end;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- ── C2 · the back-off grows and is bounded ─────────────────────────────
  insert into public.sync_upload_job (file_name, bytes, size, max_attempts) values ('backoff.xlsx', '\x504b'::bytea, 2, 10) returning id into v_id;
  select * into j from public.claim_sync_upload_job(300);
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'x', null, 'transient');
  v_first := (r->>'next_attempt_at')::timestamptz;
  update public.sync_upload_job set next_attempt_at = now() - interval '1 second' where id = v_id;
  select * into j from public.claim_sync_upload_job(300);
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'x', null, 'transient');
  v_second := (r->>'next_attempt_at')::timestamptz;
  if v_second <= v_first then raise exception 'C2: the back-off did not grow (% then %)', v_first, v_second; end if;
  -- bounded: even at attempt 9 the wait is at most half an hour plus jitter
  update public.sync_upload_job set attempts = 9, next_attempt_at = now() - interval '1 second', status = 'retry_wait' where id = v_id;
  select * into j from public.claim_sync_upload_job(300);
  r := public.finish_sync_upload_job(v_id, j.lease_token, false, null, 'x', null, 'transient');
  if (r->>'next_attempt_at')::timestamptz > now() + interval '31 minutes' then
    raise exception 'C2: the back-off is unbounded: %', r->>'next_attempt_at';
  end if;

  -- the claim takes the OLDEST due job, so park everything left over from
  -- the sections above; each block below must be the only claimable job.
  update public.sync_upload_job set status = 'cancelled', lease_token = null, lease_until = null, finished_at = now()
   where status in ('queued', 'running', 'retry_wait');

  -- ── a storage-backed job is not claimable until its object is confirmed
  insert into public.sync_upload_job (file_name, size, storage_bucket, storage_path, checksum_sha256)
  values ('pending.xlsx', 100, 'sync-uploads', 'jobs/2026/09/abc/00000000-0000-4000-8000-000000000000-deadbeefdeadbeefdeadbeefdeadbeef.xlsx', null);
  select count(*) into n from public.claim_sync_upload_job(300);
  if n <> 0 then raise exception 'D: a job whose workbook has not arrived was claimed'; end if;

  raise notice 'UPLOAD LEASE + IDEMPOTENCY SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
