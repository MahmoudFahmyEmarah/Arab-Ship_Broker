-- DOWN · 20261008110000_notification_dispatch_schedule.sql — stops the database timer and removes its config,
-- token and functions. Queued deliveries stay in the shared core (the route can still be called by CRON_SECRET).
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>
do $$
begin
  if to_regprocedure('cron.unschedule(bigint)') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'notification-dispatch';
  end if;
end $$;
drop function if exists public.fn_notification_dispatch_tick();
drop function if exists public.fn_notification_dispatch_alert();
drop function if exists public.admin_set_notification_dispatch_url(text);
drop function if exists public.fn_notification_dispatch_token_matches(text);
drop table if exists public.notification_dispatch_config;
delete from vault.secrets where name = 'notifications:dispatch_token';
