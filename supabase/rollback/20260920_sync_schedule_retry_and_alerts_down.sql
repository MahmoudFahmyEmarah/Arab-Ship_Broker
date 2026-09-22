-- DOWN for 20260920140000_sync_schedule_retry_and_alerts.sql
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20260920_sync_schedule_retry_and_alerts_down.sql
--   supabase migration repair --status reverted 20260920140000
--
-- Deploy the pre-140000 application FIRST: /api/cron/email-sync,
-- /api/cron/sync-health and the console's health panel call these objects.
--
-- next_run_at is left exactly as it is. After the rollback the old cron
-- advances it unconditionally again, so a failed scheduled run will once more
-- wait for its normal cadence.
--
-- sync_alert_state is DATA (which conditions were already reported). It is
-- renamed rather than dropped so re-applying the migration does not re-page
-- the owner for conditions that were already acknowledged:
--     public.sync_alert_state → public.sync_alert_state_bak_20260920140000
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.fn_sync_alert_prune(integer);
drop function if exists public.fn_sync_alert_state(integer);
drop function if exists public.fn_sync_reconcile_job_runs(integer);
drop function if exists public.fn_sync_email_schedule_outcome(text, timestamptz, integer, integer, boolean);

do $$
begin
  if to_regclass('public.sync_alert_state') is not null then
    if to_regclass('public.sync_alert_state_bak_20260920140000') is not null then
      raise notice 'public.sync_alert_state_bak_20260920140000 already exists — dropping the current table instead of overwriting the backup';
      drop table public.sync_alert_state;
    else
      execute 'alter table public.sync_alert_state rename to sync_alert_state_bak_20260920140000';
      execute 'alter table public.sync_alert_state_bak_20260920140000 rename constraint sync_alert_state_pkey to sync_alert_state_pkey_bak_20260920140000';
      raise notice 'alert state kept as public.sync_alert_state_bak_20260920140000 (% row(s))',
        (select count(*) from public.sync_alert_state_bak_20260920140000);
    end if;
  end if;
end $$;

drop table if exists public.sync_alert_config;

alter table public.email_ingest_config
  drop constraint if exists email_ingest_config_last_outcome_check;
alter table public.email_ingest_config
  drop column if exists last_outcome_at,
  drop column if exists last_outcome,
  drop column if exists schedule_retry_count,
  drop column if exists schedule_anchor_at;
