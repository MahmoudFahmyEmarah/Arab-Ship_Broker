-- DOWN for 20260920130000_sync_upload_jobs_and_health.sql
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20260920_sync_upload_jobs_and_health_down.sql
--   supabase migration repair --status reverted 20260920130000
--
-- Deploy the pre-jobs application FIRST: the upload route, the upload-jobs
-- cron and the console's upload panel all call these objects.
--
-- Queued and failed upload jobs are DATA. The table is renamed, not dropped,
-- so the workbooks and their history survive a rollback:
--     public.sync_upload_job → public.sync_upload_job_bak_20260920130000
-- Storage objects under the private sync-uploads bucket are left in place;
-- the bucket row itself is left in place too (removing it would orphan them).
-- Drop the backup table and empty the bucket by hand once the rollback is
-- confirmed.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.fn_sync_health_summary();
drop view if exists public.sync_health_alerts;

drop function if exists public.mark_sync_upload_payload_deleted(uuid[]);
drop function if exists public.expire_sync_upload_payloads(integer, integer);
drop function if exists public.retry_sync_upload_job(uuid, uuid);
drop function if exists public.cancel_sync_upload_job(uuid, uuid);
drop function if exists public.fn_sync_upload_batch_resumable(uuid);
drop function if exists public.finish_sync_upload_job(uuid, uuid, boolean, uuid, text, jsonb, text, integer, integer);
drop function if exists public.finish_sync_upload_job(uuid, boolean, uuid, text, jsonb);
drop function if exists public.claim_sync_upload_job(integer, integer);

drop index if exists public.sync_staged_row_batch_sheet_row_uq;

do $$
begin
  if to_regclass('public.sync_upload_job') is not null then
    if to_regclass('public.sync_upload_job_bak_20260920130000') is not null then
      raise notice 'public.sync_upload_job_bak_20260920130000 already exists — dropping the current table instead of overwriting the backup';
      drop table public.sync_upload_job;
    else
      execute 'alter table public.sync_upload_job rename to sync_upload_job_bak_20260920130000';
      -- the constraints and their indexes follow the table into the backup name
      execute 'alter table public.sync_upload_job_bak_20260920130000 rename constraint sync_upload_job_pkey to sync_upload_job_pkey_bak_20260920130000';
      execute 'alter index if exists public.sync_upload_job_batch_uq rename to sync_upload_job_batch_uq_bak_20260920130000';
      execute 'alter index if exists public.idx_sync_upload_job_due rename to idx_sync_upload_job_due_bak_20260920130000';
      execute 'alter index if exists public.idx_sync_upload_job_recent rename to idx_sync_upload_job_recent_bak_20260920130000';
      execute 'alter index if exists public.idx_sync_upload_job_queue rename to idx_sync_upload_job_queue_bak_20260920130000';
      execute 'alter index if exists public.idx_sync_upload_job_payload_expiry rename to idx_sync_upload_job_payload_expiry_bak_20260920130000';
      raise notice 'upload jobs kept as public.sync_upload_job_bak_20260920130000 (% row(s))',
        (select count(*) from public.sync_upload_job_bak_20260920130000);
    end if;
  end if;
end $$;
