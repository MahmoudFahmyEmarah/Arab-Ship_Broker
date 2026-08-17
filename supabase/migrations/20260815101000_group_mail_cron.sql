-- Group Mail scheduler heartbeat — pg_cron pings the app's dispatch route
-- every 10 minutes WHEN something is due (cheap guard first, HTTP only when
-- needed). The route does the actual member resolution + SMTP sending.
--
-- Auth: a random dispatch token minted here into Vault (groupmail_secret
-- 'dispatch_token'); the route compares Authorization: Bearer <token>.
-- URL: groupmail_config.dispatch_url — defaults to the production domain;
-- the route only exists there after the dev branch merges, until then the
-- ping 404s harmlessly and the owner can dispatch manually from the UI.
--
-- Rollback: select cron.unschedule('groupmail-dispatch');
--           drop function groupmail_dispatch_tick();
--           alter table groupmail_config drop column dispatch_url;

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.groupmail_config
  add column if not exists dispatch_url text not null
    default 'https://www.arabshipbroker.com/api/group-mail/dispatch';

-- mint the dispatch token once (kept in Vault; the route reads it back)
do $$
begin
  if not exists (select 1 from public.groupmail_secret where key = 'dispatch_token') then
    perform public.groupmail_set_secret(
      'dispatch_token',
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    );
  end if;
end $$;

create or replace function public.groupmail_dispatch_tick()
 returns void
 language plpgsql
 security definer
 set search_path to 'public','vault'
as $$
declare
  v_url   text;
  v_token text;
begin
  -- fire only when a scheduled campaign is due (or a partial send resumes)
  if not exists (
    select 1 from public.groupmail_campaign
    where status in ('scheduled', 'sending')
      and scheduled_at is not null
      and scheduled_at <= now()
  ) then
    return;
  end if;
  select dispatch_url into v_url from public.groupmail_config where id = 1;
  v_token := public.groupmail_get_secret('dispatch_token');
  if v_url is null or v_token is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
end $$;

revoke all on function public.groupmail_dispatch_tick() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'groupmail-dispatch') then
    perform cron.schedule('groupmail-dispatch', '*/10 * * * *', 'select public.groupmail_dispatch_tick()');
  end if;
end $$;
