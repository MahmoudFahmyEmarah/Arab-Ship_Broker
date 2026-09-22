-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · background staging for large workbooks, and the
-- health signals unattended processing is alerted on (20 Sep 2026;
-- token-owned leases, one-batch guarantee, retry state machine and private
-- Storage payloads added 21 Sep 2026)
--
-- P1-3: a workbook above SYNC_STAGE_ROWS is not staged inside the upload
-- request. /api/cron/upload-jobs claims it every five minutes and stages it
-- with the full function budget.
--
-- 21 Sep 2026 — four defects the second review found in that design:
--
-- A · the lease had no owner.  lease_until said WHEN a claim expired but
--     nothing said WHOSE it was, and finish_sync_upload_job matched on
--     `id and status = 'running'`. A worker whose lease had lapsed could
--     therefore finish a job another worker had already reclaimed and was
--     still staging: one job marked done, two batches created, a success
--     reported for work that was thrown away.
--       Every claim now mints an opaque lease_token and returns it with the
--     row. Finishing requires the exact (id, lease_token) pair. A reclaim
--     mints a new token, which makes the previous one permanently useless —
--     it can no longer finish the job, fail it, move its batch, clear its
--     payload or touch its totals. A token that is still current may finish
--     late, after its nominal lease_until, because lateness alone is not
--     loss of ownership; only a reclaim is.
--
-- B · one job could produce more than one batch.  Staging opened a fresh
--     sync_batch as its first act, so a crash after staging but before
--     finalisation left an orphan batch and the next attempt opened another.
--       The batch identity is now RESERVED BY THE CLAIM, inside the claiming
--     transaction, and stored on the job. Every attempt of a job is handed
--     the same batch id, and `sync_upload_job_batch_uq` makes a second batch
--     per job impossible at the storage layer. Re-staging into a batch that
--     an administrator has already committed or edited is refused, not
--     rebuilt (fn_sync_upload_batch_resumable).
--
-- C · "three attempts" was documentation only.  A caught staging error set
--     the job straight to 'failed', and the claim query never looks at a
--     failed row again, so the bytes were kept for a retry that could not
--     happen. The three-attempt rule only ever covered a crashed worker.
--       There is now an explicit state machine —
--         queued → running → (done | retry_wait → running … | failed | cancelled)
--     with a classified failure (transient / permanent / timeout /
--     lost_lease), a bounded exponential back-off in next_attempt_at, and
--     max_attempts per row. A transient failure goes to retry_wait and is
--     re-claimed when it comes due; a permanent one parks immediately; the
--     last attempt parks whatever the classification.
--
-- D · the payload travelled as hex.  bytea through PostgREST is a hex
--     string, so a 10 MB workbook was a 20 MB insert, and the file was
--     parsed once in the request and again in the worker.
--       A job may now instead name a private Storage object
--     (storage_bucket / storage_path / checksum_sha256). The route hands the
--     browser a short-lived signed upload target for an unpredictable path
--     bound to the administrator and the job, then creates the job row with
--     the metadata only; the worker downloads, verifies size and checksum,
--     and parses outside the interactive request. Inline bytes remain for
--     small workbooks and for a database without the storage schema.
--
-- P2: sync_health_alerts is ONE place for every condition an operator
-- should be paged on — stuck leases, failed WhatsApp messages, gate errors,
-- partial batches that stayed partial, job_runs that never finished, upload
-- jobs stuck or parked — with the thresholds the runbook documents.
-- fn_sync_health_summary() is the dashboard / alert query.
--
-- Idempotent. Service-role only. DOWN: supabase/rollback/20260920_sync_upload_jobs_and_health_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── 1 · upload jobs ─────────────────────────────────────────────────────────
create table if not exists public.sync_upload_job (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  bytes        bytea,
  size         integer not null,
  rows_parsed  integer,
  started_by   uuid,
  status       text not null default 'queued',
  attempts     integer not null default 0,
  lease_until  timestamptz,
  batch_id     uuid,
  error        text,
  totals       jsonb,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

-- columns added 21 Sep 2026 (the table above is the 20 Sep shape, so a
-- database created either before or after this change ends up identical)
alter table public.sync_upload_job
  add column if not exists lease_token        uuid,
  add column if not exists max_attempts       integer not null default 3,
  add column if not exists next_attempt_at    timestamptz not null default now(),
  add column if not exists last_started_at    timestamptz,
  add column if not exists failure_kind       text,
  add column if not exists storage_bucket     text,
  add column if not exists storage_path       text,
  add column if not exists checksum_sha256    text,
  add column if not exists payload_bytes      integer,
  add column if not exists payload_expires_at timestamptz,
  add column if not exists payload_deleted_at timestamptz,
  add column if not exists cancelled_by       uuid,
  add column if not exists requeued_by        uuid,
  add column if not exists requeued_at        timestamptz;
-- 20 Sep shipped `bytes` NOT NULL; a storage-backed job has no inline bytes
alter table public.sync_upload_job alter column bytes drop not null;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.sync_upload_job'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%status%' or pg_get_constraintdef(oid) like '%failure_kind%'
                   or pg_get_constraintdef(oid) like '%payload%' or pg_get_constraintdef(oid) like '%max_attempts%')
  loop
    execute format('alter table public.sync_upload_job drop constraint %I', c.conname);
  end loop;
  alter table public.sync_upload_job
    add constraint sync_upload_job_status_check
      check (status in ('queued', 'running', 'retry_wait', 'done', 'failed', 'cancelled')),
    add constraint sync_upload_job_failure_kind_check
      check (failure_kind is null or failure_kind in ('transient', 'permanent', 'timeout', 'lost_lease')),
    add constraint sync_upload_job_max_attempts_check
      check (max_attempts between 1 and 10),
    -- a job must say where its workbook is: inline bytes or a storage object
    add constraint sync_upload_job_payload_check
      check (bytes is not null or storage_path is not null or payload_deleted_at is not null
             or status in ('done', 'failed', 'cancelled'));
end $$;

-- B: one job owns at most ONE batch, enforced by the database
create unique index if not exists sync_upload_job_batch_uq
  on public.sync_upload_job (batch_id) where batch_id is not null;
-- the claim's search: due queued / retry_wait / lapsed-running rows
create index if not exists idx_sync_upload_job_due
  on public.sync_upload_job (next_attempt_at, created_at) where status in ('queued', 'running', 'retry_wait');
create index if not exists idx_sync_upload_job_recent on public.sync_upload_job (created_at desc);
create index if not exists idx_sync_upload_job_payload_expiry
  on public.sync_upload_job (payload_expires_at) where payload_deleted_at is null and payload_expires_at is not null;

alter table public.sync_upload_job enable row level security;
revoke all on table public.sync_upload_job from public, anon, authenticated;
grant select, insert, update, delete on table public.sync_upload_job to service_role;
comment on table public.sync_upload_job is 'Workbooks too large to stage inside the upload request. The upload-jobs cron claims one at a time with a token lease and stages it into the batch the claim reserved. A job owns at most one sync_batch (sync_upload_job_batch_uq).';
comment on column public.sync_upload_job.lease_token is 'Opaque owner of the current claim. Minted by claim_sync_upload_job, required by finish_sync_upload_job; a reclaim mints a new one and invalidates the old permanently.';
comment on column public.sync_upload_job.batch_id is 'The batch this job stages into, reserved by the FIRST claim and reused by every retry. Unique across jobs.';
comment on column public.sync_upload_job.next_attempt_at is 'retry_wait: when the job becomes claimable again (bounded exponential back-off).';
comment on column public.sync_upload_job.failure_kind is 'transient = retried; permanent = parked at once; timeout = the worker ran out of budget; lost_lease = another worker had reclaimed it.';
comment on column public.sync_upload_job.storage_path is 'Private Storage object holding the workbook (preferred over inline bytes). Unpredictable, bound to the uploading administrator and this job id.';

-- ── 2 · is a job's batch safe to re-stage into? ─────────────────────────────
-- A retry may rebuild the staged rows of its own batch, but only while no
-- administrator has acted on it: nothing committed, no commit audit, and the
-- batch still in a pre-commit state. Otherwise the job parks permanently
-- rather than touching reviewed work.
create or replace function public.fn_sync_upload_batch_resumable(p_batch_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare b public.sync_batch%rowtype; v_committed int; v_audit int;
begin
  if p_batch_id is null then return jsonb_build_object('resumable', true, 'reason', 'no batch yet'); end if;
  select * into b from public.sync_batch where id = p_batch_id;
  if not found then return jsonb_build_object('resumable', true, 'reason', 'the reserved batch no longer exists'); end if;
  select count(*) into v_committed from public.sync_staged_row where batch_id = p_batch_id and committed;
  select count(*) into v_audit from public.sync_commit_audit where batch_id = p_batch_id;
  if v_committed > 0 or v_audit > 0 then
    return jsonb_build_object('resumable', false, 'reason',
      format('%s row(s) of this batch are already committed — a retry must not rebuild reviewed work', greatest(v_committed, v_audit)));
  end if;
  if b.status not in ('draft', 'gated', 'gate_failed', 'failed') then
    return jsonb_build_object('resumable', false, 'reason', format('the batch is %s — a retry must not rebuild it', b.status));
  end if;
  return jsonb_build_object('resumable', true, 'reason', 'no committed row and no commit audit', 'status', b.status,
                            'staged', (select count(*) from public.sync_staged_row where batch_id = p_batch_id));
end $$;
comment on function public.fn_sync_upload_batch_resumable(uuid) is 'May a retry of an upload job rebuild the staged rows of its reserved batch? False once anything is committed or an administrator has acted on it.';
revoke all on function public.fn_sync_upload_batch_resumable(uuid) from public, anon, authenticated;
grant execute on function public.fn_sync_upload_batch_resumable(uuid) to service_role;

-- ── 3 · claim: one job, one new token, one reserved batch ───────────────────
-- The whole claim is one transaction: park the exhausted, pick the oldest due
-- row with FOR UPDATE SKIP LOCKED, mint a token, reserve the batch if this is
-- the first attempt, and count the attempt exactly once.
create or replace function public.claim_sync_upload_job(p_ttl_seconds integer default 330, p_max_attempts integer default null)
 returns setof public.sync_upload_job language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_ttl   interval := make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 330), 3600)));
  v_id    uuid;
  v_token uuid;
  v_batch uuid;
  v_job   public.sync_upload_job%rowtype;
begin
  -- a claim that never reported back, out of attempts: park it (failure_kind
  -- 'timeout' — the worker died rather than refusing the work)
  update public.sync_upload_job
     set status = 'failed', failure_kind = coalesce(failure_kind, 'timeout'),
         error = left(coalesce(error, 'the worker never reported a result') || format(' · gave up after %s attempt(s)', attempts), 2000),
         lease_token = null, lease_until = null, finished_at = now()
   where status = 'running' and lease_until < now() and attempts >= coalesce(p_max_attempts, max_attempts);
  -- a retry that has exhausted its attempts parks too, without being claimed again
  update public.sync_upload_job
     set status = 'failed', lease_token = null, lease_until = null, finished_at = now(),
         error = left(coalesce(error, 'no result') || format(' · gave up after %s attempt(s)', attempts), 2000)
   where status = 'retry_wait' and attempts >= coalesce(p_max_attempts, max_attempts);

  select j.id into v_id
    from public.sync_upload_job j
   where (j.status = 'queued'
          or (j.status = 'retry_wait' and j.next_attempt_at <= now())   -- C: a retry only when it is DUE
          or (j.status = 'running' and j.lease_until < now()))          -- A: a lapsed lease is reclaimable
     and j.attempts < coalesce(p_max_attempts, j.max_attempts)
     -- D: a storage-backed job whose object has not been confirmed yet (the
     -- browser was handed a signed URL but has not finished uploading) has no
     -- checksum and is NOT claimable; expire_sync_upload_payloads parks it if
     -- the workbook never arrives.
     and (j.storage_path is null or j.bytes is not null or j.checksum_sha256 is not null)
   order by j.next_attempt_at, j.created_at, j.id
   limit 1
     for update skip locked;
  if v_id is null then return; end if;

  v_token := gen_random_uuid();   -- A: a NEW owner for every claim; the old token dies here

  -- B: reserve the batch identity inside the claiming transaction, so every
  -- attempt of this job stages into the same batch and a crash before
  -- finalisation cannot produce a second one.
  select j.batch_id into v_batch from public.sync_upload_job j where j.id = v_id;
  if v_batch is null then
    insert into public.sync_batch (source, file_name, started_by, label, status)
    select 'upload', j.file_name, j.started_by,
           coalesce('UP-' || to_char(now(), 'YYYY-MM-DD'), 'UP'), 'draft'
      from public.sync_upload_job j where j.id = v_id
    returning id into v_batch;
  end if;

  update public.sync_upload_job j
     set status = 'running',
         attempts = j.attempts + 1,                 -- exactly once per claim
         lease_token = v_token,
         lease_until = now() + v_ttl,
         last_started_at = now(),
         started_at = coalesce(j.started_at, now()),
         batch_id = v_batch,
         error = null, failure_kind = null
   where j.id = v_id
  returning j.* into v_job;
  return next v_job;
end $$;
comment on function public.claim_sync_upload_job(integer, integer) is 'Claims the oldest DUE upload job (queued, a due retry_wait, or a running row whose lease lapsed): mints a lease token, reserves the batch on the first attempt, counts the attempt once. FOR UPDATE SKIP LOCKED, so two workers never claim the same row.';
revoke all on function public.claim_sync_upload_job(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_sync_upload_job(integer, integer) to service_role;

-- ── 4 · finish: only the current owner, and the state machine ───────────────
create or replace function public.finish_sync_upload_job(
  p_id uuid, p_lease_token uuid, p_ok boolean,
  p_batch_id uuid default null, p_error text default null, p_totals jsonb default null,
  p_failure_kind text default null, p_rows_parsed integer default null,
  p_retain_payload_days integer default 7
) returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare j public.sync_upload_job%rowtype; v_next timestamptz; v_status text; v_kind text; v_backoff interval;
begin
  if p_id is null then raise exception 'finish_sync_upload_job: p_id is required' using errcode = '22023'; end if;
  if p_lease_token is null then raise exception 'finish_sync_upload_job: p_lease_token is required' using errcode = '22023'; end if;
  if p_failure_kind is not null and p_failure_kind not in ('transient', 'permanent', 'timeout', 'lost_lease') then
    raise exception 'finish_sync_upload_job: unknown failure kind %', p_failure_kind using errcode = '22023';
  end if;

  select * into j from public.sync_upload_job where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_job');
  end if;
  -- A: ownership, not lateness, decides. A current token may finish after
  -- lease_until; a token superseded by a reclaim can do nothing at all.
  if j.status <> 'running' or j.lease_token is distinct from p_lease_token then
    return jsonb_build_object('ok', false, 'reason', 'lost_lease', 'status', j.status,
                              'attempts', j.attempts, 'batch_id', j.batch_id,
                              'detail', 'this job was reclaimed or already finalised by another worker');
  end if;
  -- B: a worker may only confirm the batch the claim reserved
  if p_batch_id is not null and j.batch_id is not null and p_batch_id <> j.batch_id then
    return jsonb_build_object('ok', false, 'reason', 'batch_mismatch', 'status', j.status,
                              'batch_id', j.batch_id, 'detail', 'the job is bound to a different batch');
  end if;

  if p_ok then
    v_status := 'done';
    update public.sync_upload_job
       set status = 'done', failure_kind = null, error = null,
           batch_id = coalesce(p_batch_id, batch_id),
           totals = coalesce(p_totals, totals),
           rows_parsed = coalesce(p_rows_parsed, rows_parsed),
           lease_token = null, lease_until = null, finished_at = now(),
           -- the workbook is not kept once it is staged
           bytes = null,
           payload_expires_at = now(),
           payload_deleted_at = case when storage_path is null then now() else payload_deleted_at end
     where id = p_id;
  else
    v_kind := coalesce(p_failure_kind, 'transient');
    if v_kind in ('permanent') or j.attempts >= j.max_attempts then
      v_status := 'failed';
      update public.sync_upload_job
         set status = 'failed', failure_kind = v_kind, error = left(p_error, 2000),
             totals = coalesce(p_totals, totals), lease_token = null, lease_until = null, finished_at = now(),
             -- D9: failed input is kept for a bounded troubleshooting window
             payload_expires_at = now() + make_interval(days => greatest(0, least(coalesce(p_retain_payload_days, 7), 90)))
       where id = p_id;
    else
      -- C: bounded exponential back-off with a little jitter, so a cron does
      -- not re-claim the same job on its very next tick
      v_backoff := least(make_interval(secs => 60 * power(2, greatest(j.attempts - 1, 0))::int), interval '30 minutes')
                 + make_interval(secs => (random() * 20)::int);
      v_next := now() + v_backoff;
      v_status := 'retry_wait';
      update public.sync_upload_job
         set status = 'retry_wait', failure_kind = v_kind, error = left(p_error, 2000),
             lease_token = null, lease_until = null, next_attempt_at = v_next,
             payload_expires_at = null, finished_at = null
       where id = p_id;
    end if;
  end if;

  select * into j from public.sync_upload_job where id = p_id;
  return jsonb_build_object('ok', true, 'status', j.status, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
                            'batch_id', j.batch_id, 'failure_kind', j.failure_kind,
                            'next_attempt_at', j.next_attempt_at, 'finished_at', j.finished_at);
end $$;
comment on function public.finish_sync_upload_job(uuid, uuid, boolean, uuid, text, jsonb, text, integer, integer) is 'Records the outcome of ONE claim. Requires the exact (id, lease_token) of the current owner; a superseded token gets {ok:false, reason:"lost_lease"} and changes nothing. A transient failure becomes retry_wait with back-off; a permanent one, or the last attempt, parks as failed.';
revoke all on function public.finish_sync_upload_job(uuid, uuid, boolean, uuid, text, jsonb, text, integer, integer) from public, anon, authenticated;
grant execute on function public.finish_sync_upload_job(uuid, uuid, boolean, uuid, text, jsonb, text, integer, integer) to service_role;

-- ── 5 · the console's actions (workstream I), audited by the caller ─────────
create or replace function public.cancel_sync_upload_job(p_id uuid, p_actor uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare j public.sync_upload_job%rowtype;
begin
  if p_id is null then raise exception 'cancel_sync_upload_job: p_id is required' using errcode = '22023'; end if;
  select * into j from public.sync_upload_job where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_job'); end if;
  if j.status not in ('queued', 'retry_wait') then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable', 'status', j.status,
      'detail', case when j.status = 'running' then 'a running job finishes or loses its lease first' else format('the job is already %s', j.status) end);
  end if;
  update public.sync_upload_job
     set status = 'cancelled', cancelled_by = p_actor, finished_at = now(), lease_token = null, lease_until = null,
         payload_expires_at = now(), error = coalesce(error, 'cancelled in the console')
   where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;
revoke all on function public.cancel_sync_upload_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_sync_upload_job(uuid, uuid) to service_role;

-- Put a parked job back in the queue. Refused when its payload is gone, or
-- when its batch has been committed or edited (that work must not be rebuilt).
create or replace function public.retry_sync_upload_job(p_id uuid, p_actor uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare j public.sync_upload_job%rowtype; v_res jsonb;
begin
  if p_id is null then raise exception 'retry_sync_upload_job: p_id is required' using errcode = '22023'; end if;
  select * into j from public.sync_upload_job where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_job'); end if;
  if j.status not in ('failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'not_retryable', 'status', j.status, 'detail', 'only a failed or cancelled job can be queued again');
  end if;
  if j.payload_deleted_at is not null or (j.bytes is null and j.storage_path is null) then
    return jsonb_build_object('ok', false, 'reason', 'payload_gone', 'detail', 'the workbook is no longer stored — upload it again');
  end if;
  v_res := public.fn_sync_upload_batch_resumable(j.batch_id);
  if not (v_res->>'resumable')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'batch_touched', 'detail', v_res->>'reason');
  end if;
  update public.sync_upload_job
     set status = 'queued', attempts = 0, failure_kind = null, error = null,
         next_attempt_at = now(), lease_token = null, lease_until = null, finished_at = null,
         payload_expires_at = null, requeued_by = p_actor, requeued_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'queued', 'batch_id', j.batch_id);
end $$;
revoke all on function public.retry_sync_upload_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.retry_sync_upload_job(uuid, uuid) to service_role;

-- D10: abandoned and expired payloads. Returns what should be deleted from
-- Storage (the worker does the object delete, then calls back with the ids).
create or replace function public.expire_sync_upload_payloads(p_abandoned_hours integer default 24, p_limit integer default 50)
 returns table (id uuid, storage_bucket text, storage_path text, why text)
 language sql volatile security definer set search_path to ''
as $$
  with abandoned as (
    -- a queued job whose workbook never arrived in Storage
    update public.sync_upload_job j
       set status = 'failed', failure_kind = 'permanent', finished_at = now(),
           error = coalesce(j.error, 'the workbook was never uploaded to storage')
     where j.id in (
       select x.id from public.sync_upload_job x
        where x.status = 'queued' and x.storage_path is not null and x.bytes is null
          and x.checksum_sha256 is null
          and x.created_at < now() - make_interval(hours => greatest(1, least(coalesce(p_abandoned_hours, 24), 720)))
        limit greatest(1, least(coalesce(p_limit, 50), 500)))
    returning j.id, j.storage_bucket, j.storage_path, 'abandoned upload'::text as why
  ), expired as (
    select x.id, x.storage_bucket, x.storage_path, 'retention window elapsed'::text as why
      from public.sync_upload_job x
     where x.payload_deleted_at is null and x.storage_path is not null
       and x.payload_expires_at is not null and x.payload_expires_at < now()
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  )
  select * from abandoned union all select * from expired;
$$;
comment on function public.expire_sync_upload_payloads(integer, integer) is 'Parks uploads whose workbook never arrived and lists storage objects past their retention window. The caller deletes the objects and then calls mark_sync_upload_payload_deleted.';
revoke all on function public.expire_sync_upload_payloads(integer, integer) from public, anon, authenticated;
grant execute on function public.expire_sync_upload_payloads(integer, integer) to service_role;

create or replace function public.mark_sync_upload_payload_deleted(p_ids uuid[])
 returns integer language sql volatile security definer set search_path to ''
as $$
  with u as (
    update public.sync_upload_job set payload_deleted_at = now(), bytes = null
     where id = any (coalesce(p_ids, '{}'::uuid[])) and payload_deleted_at is null
    returning 1)
  select coalesce(count(*), 0)::int from u;
$$;
revoke all on function public.mark_sync_upload_payload_deleted(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_sync_upload_payload_deleted(uuid[]) to service_role;

-- ── 6 · staged rows are idempotent within a batch ───────────────────────────
-- Re-staging a resumable batch clears its uncommitted rows first (the worker
-- does that), and this index makes a double insert inside one attempt
-- impossible for any source that numbers its rows.
create unique index if not exists sync_staged_row_batch_sheet_row_uq
  on public.sync_staged_row (batch_id, sheet, row_index) where row_index is not null;

-- ── 7 · the private bucket for queued workbooks (workstream D) ──────────────
-- Created only where the storage schema exists; a bare PostgreSQL used for
-- tests simply keeps the inline-bytes path.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sync-uploads', 'sync-uploads', false, 10485760,
            array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update
      set public = false, file_size_limit = 10485760,
          allowed_mime_types = array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    raise notice 'storage bucket sync-uploads is present and private';
  else
    raise notice 'no storage schema in this database — upload jobs will use inline bytes';
  end if;
end $$;

-- ── 8 · health signals and thresholds ───────────────────────────────────────
-- kind                 threshold (docs/data-sync-hardening-2.md)
--   stuck_lease        a run lease expired more than 10 minutes ago and was never released
--   whatsapp_failed    a message parked as failed
--   whatsapp_stale     a message pending / processing for more than 30 minutes
--   gate_error         an uncommitted staged row the gate could not evaluate
--   partial_batch      a partial batch older than 24 hours
--   unfinished_job     a job_runs row still running after 2 hours
--   upload_job_stuck   an upload job queued / running for more than 30 minutes
--   upload_job_failed  an upload job parked as failed
--   upload_job_retry   an upload job that has been waiting to retry for over an hour
create or replace view public.sync_health_alerts as
  select 'stuck_lease'::text as kind, s.source as ref, s.lease_until as since,
         format('lease %s (%s) expired %s ago and was never released', s.source, coalesce(s.lease_owner, '?'), now() - s.lease_until) as detail
    from public.sync_source_state s
   where s.lease_until is not null and s.lease_until < now() - interval '10 minutes'
  union all
  select 'whatsapp_failed', m.id::text, m.received_at, left(coalesce(m.error, 'failed'), 200)
    from public.whatsapp_message m where m.status = 'failed'
  union all
  select 'whatsapp_stale', m.id::text, m.received_at, format('%s for %s', m.status, now() - m.received_at)
    from public.whatsapp_message m where m.status in ('pending', 'processing') and m.received_at < now() - interval '30 minutes'
  union all
  select 'gate_error', r.batch_id::text, min(r.gated_at), format('%s row(s) the gate could not evaluate', count(*))
    from public.sync_staged_row r where r.gate_status = 'error' and not r.committed group by r.batch_id
  union all
  select 'partial_batch', b.id::text, b.committed_at, format('%s partly committed since %s', coalesce(b.label, left(b.id::text, 8)), b.committed_at)
    from public.sync_batch b where b.status = 'partial' and b.committed_at < now() - interval '24 hours'
  union all
  select 'unfinished_job', j.id::text, j.started_at, format('%s running since %s', j.job, j.started_at)
    from public.job_runs j where j.status = 'running' and j.started_at < now() - interval '2 hours'
  union all
  select 'upload_job_stuck', u.id::text, u.created_at, format('%s %s since %s (%s attempt(s))', u.file_name, u.status, u.created_at, u.attempts)
    from public.sync_upload_job u where u.status in ('queued', 'running') and u.created_at < now() - interval '30 minutes'
  union all
  select 'upload_job_failed', u.id::text, u.finished_at, format('%s parked after %s attempt(s): %s', u.file_name, u.attempts, left(coalesce(u.error, 'no reason recorded'), 160))
    from public.sync_upload_job u where u.status = 'failed'
  union all
  select 'upload_job_retry', u.id::text, u.next_attempt_at, format('%s waiting to retry since %s (attempt %s of %s)', u.file_name, u.next_attempt_at, u.attempts, u.max_attempts)
    from public.sync_upload_job u where u.status = 'retry_wait' and u.next_attempt_at < now() - interval '1 hour';

revoke all on public.sync_health_alerts from public, anon, authenticated;
grant select on public.sync_health_alerts to service_role;

create or replace function public.fn_sync_health_summary()
 returns jsonb language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
    from (select kind, count(*) as n from public.sync_health_alerts group by kind) x;
$$;
revoke all on function public.fn_sync_health_summary() from public, anon, authenticated;
grant execute on function public.fn_sync_health_summary() to service_role;

-- the 20 Sep signatures are gone: drop them so no caller can reach a version
-- of finish that does not require a lease token
drop function if exists public.finish_sync_upload_job(uuid, boolean, uuid, text, jsonb);
