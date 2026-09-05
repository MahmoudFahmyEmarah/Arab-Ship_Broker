-- ════════════════════════════════════════════════════════════════════════
-- platform_events + job_runs (05 Sep 2026)
--
-- Two small operational tables the console dashboard was designed around:
--   platform_events — first-party product events from the portal (page views,
--     routes drawn, estimate consent, match popups, calculator runs). Written
--     by the signed-in member through RLS (own uid only), read by admins.
--   job_runs — one row per background run (Vercel crons, Group Mail dispatch,
--     email sync, WhatsApp webhook, bunker ingest). Written by the server with
--     the service role, read by admins.
-- Plus get_admin_dashboard_events(p_days): the admin-only feed that folds
-- both into the dashboard (feature usage, sessions, devices, cron run log).
-- ════════════════════════════════════════════════════════════════════════

-- ── platform_events ─────────────────────────────────────────────────────
create table if not exists public.platform_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,                     -- auth.uid() of the member (null never happens via RLS today)
  session_id  text,                     -- per-tab id from the browser
  event       text not null,            -- page_view · route_drawn · estimate_shown · estimate_declined · match_popup · voyage_estimate · suez_calc · …
  target      text,                     -- what it was about (route pair, listing id, vessel id)
  path        text,                     -- pathname at the time
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists platform_events_at_idx on public.platform_events (at desc);
create index if not exists platform_events_event_at_idx on public.platform_events (event, at desc);
create index if not exists platform_events_user_at_idx on public.platform_events (user_id, at desc);
create index if not exists platform_events_session_idx on public.platform_events (session_id);

alter table public.platform_events enable row level security;
drop policy if exists platform_events_insert_own on public.platform_events;
create policy platform_events_insert_own on public.platform_events
  for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists platform_events_admin_read on public.platform_events;
create policy platform_events_admin_read on public.platform_events
  for select to authenticated
  using (public.fn_is_admin());
grant insert, select on public.platform_events to authenticated;
grant all on public.platform_events to service_role;

-- ── job_runs ────────────────────────────────────────────────────────────
create table if not exists public.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,            -- refresh-matches · market-insights · groupmail-dispatch · email-sync · whatsapp-webhook · bunker-ingest
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  rows        integer,
  error       text,
  trigger     text,                     -- cron · manual · webhook · pg_cron
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);
create index if not exists job_runs_started_idx on public.job_runs (started_at desc);

alter table public.job_runs enable row level security;
drop policy if exists job_runs_admin_read on public.job_runs;
create policy job_runs_admin_read on public.job_runs
  for select to authenticated
  using (public.fn_is_admin());
grant select on public.job_runs to authenticated;
grant all on public.job_runs to service_role;

-- ── retention: keep a year of events, 90 days of runs ───────────────────
create or replace function public.fn_prune_ops_tables()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.platform_events where at < now() - interval '365 days';
  delete from public.job_runs where started_at < now() - interval '90 days';
$$;
revoke all on function public.fn_prune_ops_tables() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ops-tables-prune';
    perform cron.schedule('ops-tables-prune', '30 3 * * *', $cron$select public.fn_prune_ops_tables()$cron$);
  end if;
end $$;

-- ── admin feed ──────────────────────────────────────────────────────────
create or replace function public.get_admin_dashboard_events(p_days integer default 7)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 7), 365));
  v_since timestamptz;
begin
  if not public.fn_is_admin() then raise exception 'Access denied'; end if;
  v_since := case when v_days <= 1 then now() - interval '24 hours' else now() - (v_days * interval '1 day') end;

  return jsonb_build_object(
    'first_event_at', (select min(at) from public.platform_events),
    'events_total',   (select count(*) from public.platform_events),
    'range', jsonb_build_object(
      'events',       (select count(*) from public.platform_events where at >= v_since),
      'sessions',     (select count(distinct session_id) from public.platform_events where at >= v_since and session_id is not null),
      'active_users', (select count(distinct user_id) from public.platform_events where at >= v_since and user_id is not null),
      'page_views',   (select count(*) from public.platform_events where at >= v_since and event = 'page_view'),
      'viewers',      (select count(distinct user_id) from public.platform_events where at >= v_since and event = 'page_view' and user_id is not null)
    ),
    'by_event', (
      select coalesce(jsonb_object_agg(event, n), '{}'::jsonb)
      from (select event, count(*) as n from public.platform_events where at >= v_since group by 1) s
    ),
    'top_members', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'company', company, 'n', n) order by n desc), '[]'::jsonb)
      from (
        select coalesce(u.full_name, u.email, 'member') as name, u.company, count(*) as n
        from public.platform_events e
        join public.users u on u.supabase_user_id = e.user_id
        where e.at >= v_since and u.role <> 'admin'
        group by u.id, u.full_name, u.email, u.company
        order by 3 desc limit 3
      ) s
    ),
    'devices', (
      select coalesce(jsonb_object_agg(d, n), '{}'::jsonb)
      from (select coalesce(meta->>'device', 'unknown') as d, count(distinct coalesce(session_id, id::text)) as n
            from public.platform_events where at >= v_since group by 1) s
    ),
    'top_paths', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc), '[]'::jsonb)
      from (select path, count(*) as n from public.platform_events
            where at >= v_since and event = 'page_view' and path is not null group by 1 order by 2 desc limit 5) s
    ),
    'job_runs', jsonb_build_object(
      'total', (select count(*) from public.job_runs),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'job', job, 'status', status, 'started_at', started_at, 'finished_at', finished_at,
          'rows', rows, 'error', error, 'trigger', trigger) order by started_at desc), '[]'::jsonb)
        from (select * from public.job_runs order by started_at desc limit 10) r
      ),
      'last_by_job', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'job', job, 'status', status, 'started_at', started_at, 'finished_at', finished_at,
          'rows', rows, 'error', error, 'trigger', trigger) order by job), '[]'::jsonb)
        from (select distinct on (job) * from public.job_runs order by job, started_at desc) r
      ),
      'failed_range', (select count(*) from public.job_runs where started_at >= v_since and status = 'failed'),
      'email_failed_range', (select count(*) from public.job_runs where started_at >= v_since and status = 'failed' and job = 'email-sync')
    )
  );
end $$;
revoke all on function public.get_admin_dashboard_events(integer) from public, anon;
grant execute on function public.get_admin_dashboard_events(integer) to authenticated, service_role;
