-- ════════════════════════════════════════════════════════════════════════
-- Shared notifications · the email dispatch schedule (Wave 4, 8 Oct 2026; owner decision: pg_cron + pg_net)
--
-- The shared core (20261008050000/352000) queues email deliveries; its route /api/cron/fixture-notifications
-- sends one envelope per call. This migration adds the database timer the owner chose, under the core's rule
-- that no environment-specific URL or secret is embedded in a migration:
--   * notification_dispatch_config.dispatch_url starts EMPTY: until it is set for an environment
--     (admin_set_notification_dispatch_url, service role only) the timer does nothing — email stays off;
--   * the bearer token is minted at apply time into Vault ('notifications:dispatch_token'); the route checks it
--     through fn_notification_dispatch_token_matches, so the secret never leaves the database;
--   * fn_notification_dispatch_tick runs every minute (pg_cron 'notification-dispatch') and calls the route only
--     when an envelope is due — up to three calls per tick when there is a backlog (each claims one envelope under
--     the core's SKIP LOCKED lease, so parallel calls are safe), about 180 emails an hour at most;
--   * capacity / SLO (C2O-092 #6): urgent items are claimed first (core claim order); at three calls a minute the
--     route sends up to ~180 envelopes an hour, so an urgent email normally leaves within two minutes;
--   * the same tick replays Fixture projections that were deferred (fn_fixture_notify_reconcile, when present) and
--     raises an alert to the platform's super admins — in the bell and by email, at most once an hour per condition —
--     when an urgent email has waited more than 10 minutes, an email failed in the last hour, a Fixture projection is
--     failing or stuck, or email work has waited an hour while this environment has no dispatch URL;
--   * every function here is service-role only.
--
-- DOWN: supabase/rollback/20261008110000_notification_dispatch_schedule_down.sql
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.notification_dispatch_config (
  id            smallint primary key default 1 check (id = 1),
  dispatch_url  text check (dispatch_url is null or dispatch_url ~ '^https?://[^/\s]+/api/cron/fixture-notifications$'),
  updated_at    timestamptz not null default now()
);
insert into public.notification_dispatch_config (id) values (1) on conflict (id) do nothing;
alter table public.notification_dispatch_config enable row level security;
revoke all on table public.notification_dispatch_config from public, anon, authenticated, service_role;

-- the bearer token: minted once per environment, at apply time, never written in a file
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notifications:dispatch_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                'notifications:dispatch_token', 'ASB notification dispatch bearer token');
  end if;
end $$;

create or replace function public.fn_notification_dispatch_token_matches(p_token text)
 returns boolean language plpgsql stable security definer set search_path to ''
as $$
declare v text;
begin
  if coalesce(p_token, '') = '' then return false; end if;
  select s.decrypted_secret into v from vault.decrypted_secrets s where s.name = 'notifications:dispatch_token';
  return v is not null and v = p_token;
end $$;
revoke all on function public.fn_notification_dispatch_token_matches(text) from public, anon, authenticated;
grant execute on function public.fn_notification_dispatch_token_matches(text) to service_role;

-- the release owner sets the URL per environment (staging, then production); null turns email delivery off again
create or replace function public.admin_set_notification_dispatch_url(p_url text)
 returns text language plpgsql volatile security definer set search_path to ''
as $$
begin
  if p_url is not null and p_url !~ '^https://[^/\s]+/api/cron/fixture-notifications$' then
    raise exception 'NTF_CONFIG: the dispatch URL must be https://<host>/api/cron/fixture-notifications' using errcode = '22023';
  end if;
  update public.notification_dispatch_config set dispatch_url = p_url, updated_at = now() where id = 1;
  return coalesce(p_url, 'email delivery off');
end $$;
revoke all on function public.admin_set_notification_dispatch_url(text) from public, anon, authenticated;
grant execute on function public.admin_set_notification_dispatch_url(text) to service_role;

-- the operator alert (C2O-092 #6): once an hour per condition, to every active super admin, urgent (bell + email)
create or replace function public.fn_notification_dispatch_alert()
 returns integer language plpgsql volatile security definer set search_path to ''
as $$
declare v_hour text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24'); v_url text; v_proj jsonb;
        v_cond text; v_body text; v_admin uuid; v_n integer := 0;
begin
  select c.dispatch_url into v_url from public.notification_dispatch_config c where c.id = 1;
  if to_regprocedure('public.fn_fixture_notify_health()') is not null then
    execute 'select public.fn_fixture_notify_health()' into v_proj;
  end if;
  for v_cond, v_body in
    select x.cond, x.body from (values
      ('urgent-waiting', case when exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
                                            where d.digest_batch_id is null and d.status = 'queued' and n.importance = 'urgent'
                                              and d.created_at < clock_timestamp() - interval '10 minutes')
                         then 'An urgent notification email has waited more than 10 minutes to be sent.' end),
      ('email-failed', case when exists (select 1 from public.notification_deliveries d where d.status = 'failed' and d.updated_at > clock_timestamp() - interval '1 hour')
                              or exists (select 1 from public.notification_digest_batches b where b.status = 'failed' and b.updated_at > clock_timestamp() - interval '1 hour')
                       then 'A notification email failed in the last hour.' end),
      ('projection', case when coalesce((v_proj->>'failed')::int, 0) > 0
                              or (v_proj->>'oldestOpenAt') is not null and (v_proj->>'oldestOpenAt')::timestamptz < clock_timestamp() - interval '15 minutes'
                     then 'Fixture Room notifications are failing or waiting to be written.' end),
      ('no-dispatch-url', case when v_url is null and exists (select 1 from public.notification_deliveries d
                                                                where d.status = 'queued' and d.created_at < clock_timestamp() - interval '1 hour')
                          then 'Email notifications are waiting, but email delivery is not configured in this environment.' end)
    ) x(cond, body)
    where x.body is not null
  loop
    for v_admin in select u.id from public.users u where u.is_active and lower(coalesce(u.role, '')) = 'admin' and coalesce(u.admin_tier, 'super') = 'super' loop
      perform public.fn_notification_enqueue(v_admin, 'system.notification_alert', 'ntf-alert:' || v_cond || ':' || v_hour,
        'Notification delivery needs attention', v_body, '/admin/dashboard', 'urgent',
        jsonb_build_object('condition', v_cond, 'hour', v_hour), true, null, null);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function public.fn_notification_dispatch_alert() from public, anon, authenticated;
grant execute on function public.fn_notification_dispatch_alert() to service_role;

create or replace function public.fn_notification_dispatch_tick()
 returns integer language plpgsql volatile security definer set search_path to ''
as $$
declare v_url text; v_token text; v_due integer; v_calls integer; i integer;
begin
  -- deferred Fixture projections first (they may add work), then the alert check; neither may stop the dispatch
  if to_regprocedure('public.fn_fixture_notify_reconcile(integer)') is not null then
    begin execute 'select public.fn_fixture_notify_reconcile(20)'; exception when others then raise warning 'notification reconcile: %', sqlerrm; end;
  end if;
  begin perform public.fn_notification_dispatch_alert(); exception when others then raise warning 'notification alert: %', sqlerrm; end;
  select c.dispatch_url into v_url from public.notification_dispatch_config c where c.id = 1;
  if v_url is null then return 0; end if;                       -- not configured here: email delivery is off
  select (select count(*) from public.notification_deliveries d
           where d.digest_batch_id is null and d.next_attempt_at <= clock_timestamp()
             and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < clock_timestamp())))
       + (select count(*) from public.notification_digest_batches b
           where b.next_attempt_at <= clock_timestamp()
             and (b.status = 'queued' or (b.status = 'sending' and b.lease_until < clock_timestamp())))
    into v_due;
  if v_due = 0 then return 0; end if;                           -- nothing due: no HTTP at all
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notifications:dispatch_token';
  if v_token is null then return 0; end if;
  v_calls := least(v_due, 3);
  for i in 1 .. v_calls loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000);
  end loop;
  return v_calls;
end $$;
revoke all on function public.fn_notification_dispatch_tick() from public, anon, authenticated;
grant execute on function public.fn_notification_dispatch_tick() to service_role;

do $$
begin
  -- pg_cron's scheduler (or an isolated proof database's stand-in) is present when cron.schedule exists
  if to_regprocedure('cron.schedule(text, text, text)') is not null
     and not exists (select 1 from cron.job where jobname = 'notification-dispatch') then
    perform cron.schedule('notification-dispatch', '* * * * *', 'select public.fn_notification_dispatch_tick()');
  end if;
end $$;

comment on table public.notification_dispatch_config is
  'Shared notifications: the per-environment dispatch URL (empty = email delivery off). Set only with admin_set_notification_dispatch_url.';
comment on function public.fn_notification_dispatch_tick() is
  'Shared notifications: every minute (pg_cron notification-dispatch), calls the dispatch route when an envelope is due — up to three calls per tick; nothing when the URL is not configured.';
