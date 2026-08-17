-- Group Mail scheduler heartbeat — owner decision: keep the every-10-minutes
-- rhythm (a minutely variant was briefly applied and rolled back here).
-- Scheduled circulars therefore send within 10 minutes of their chosen time.

do $$
declare
  v_id int;
begin
  select jobid into v_id from cron.job where jobname = 'groupmail-dispatch';
  if v_id is not null then
    perform cron.unschedule(v_id);
  end if;
  perform cron.schedule('groupmail-dispatch', '*/10 * * * *', 'select public.groupmail_dispatch_tick()');
end $$;
