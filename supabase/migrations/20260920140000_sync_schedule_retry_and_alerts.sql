-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · a scheduled run that fails retries soon, a job_runs
-- row cannot stay "running" for ever, and health conditions have somewhere
-- to remember that they were already reported (21 Sep 2026)
--
-- F · the email cron advanced next_run_at unconditionally, "whatever the
--     outcome". Checkpoints meant no MESSAGE was skipped, but a transient
--     IMAP failure at 02:00 on a weekly schedule waited a week for its next
--     attempt, and a run refused because another lease was active burned
--     the slot without doing any work at all.
--       fn_sync_email_schedule_outcome() is now the only writer of the
--     schedule. It takes the run's classified outcome and decides:
--         success / empty   advance to the normal slot, reset the retry
--                           counter, move the cadence anchor
--         failed            next_run_at = now + bounded back-off
--                           (10, 20, 40 … capped at 60 minutes), the
--                           anchor UNTOUCHED so the daily / weekly rhythm
--                           is preserved; after p_max_retries the normal
--                           slot is restored so a broken inbox does not
--                           retry for ever
--         skipped_lease     nothing moves — no work was done
--         forced            nothing moves unless the caller asks
--     The single config row is taken FOR UPDATE, so two cron invocations
--     that overlap cannot both compute and write a schedule (F7).
--
-- G · finishJobRun() awaited its update but never read the returned error,
--     so "awaited" did not mean "persisted": a failed update left the row
--     running for ever and the health view reported a phantom stuck job.
--     The application now uses a strict finaliser, and this migration adds
--     the safety net underneath it: fn_sync_reconcile_job_runs() closes any
--     row that has been running past the threshold, so the signal is
--     self-healing rather than permanently wrong.
--
-- I · sync_health_alerts said what was wrong but nothing consumed it, and a
--     consumer that simply mailed the view every five minutes would page
--     the owner every five minutes. sync_alert_state remembers, per
--     condition, how many consecutive checks have seen it and whether it has
--     already been reported, so the cron notifies once after N consecutive
--     failures and once more when the condition clears.
--
-- Idempotent. Service-role only. DOWN: supabase/rollback/20260920_sync_schedule_retry_and_alerts_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── 1 · schedule state on the single config row ─────────────────────────────
alter table public.email_ingest_config
  add column if not exists schedule_anchor_at   timestamptz,
  add column if not exists schedule_retry_count integer not null default 0,
  add column if not exists last_outcome         text,
  add column if not exists last_outcome_at      timestamptz;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.email_ingest_config'::regclass and conname = 'email_ingest_config_last_outcome_check') then
    alter table public.email_ingest_config drop constraint email_ingest_config_last_outcome_check;
  end if;
  alter table public.email_ingest_config
    add constraint email_ingest_config_last_outcome_check
      check (last_outcome is null or last_outcome in ('success', 'empty', 'skipped_lease', 'failed', 'forced'));
end $$;

comment on column public.email_ingest_config.schedule_anchor_at is 'The cadence anchor: the last SUCCESSFUL scheduled run. Retries do not move it, so "every N days" keeps its rhythm through a failure.';
comment on column public.email_ingest_config.schedule_retry_count is 'Consecutive failed scheduled runs. Drives the back-off and is reset by a success.';
comment on column public.email_ingest_config.last_outcome is 'success | empty | skipped_lease | failed | forced — what the last scheduled wake-up actually did.';

-- ── 2 · the only writer of next_run_at ──────────────────────────────────────
create or replace function public.fn_sync_email_schedule_outcome(
  p_outcome text,
  p_next_normal timestamptz default null,
  p_retry_base_seconds integer default 600,
  p_max_retries integer default 6,
  p_advance_on_forced boolean default false
) returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare c record; v_backoff interval; v_next timestamptz; v_advanced boolean := false; v_retrying boolean := false; v_retries int;
        v_base int := greatest(60, least(coalesce(p_retry_base_seconds, 600), 3600));
        v_max  int := greatest(0, least(coalesce(p_max_retries, 6), 20));
begin
  if p_outcome is null or p_outcome not in ('success', 'empty', 'skipped_lease', 'failed', 'forced') then
    raise exception 'fn_sync_email_schedule_outcome: unknown outcome %', coalesce(p_outcome, '(null)') using errcode = '22023';
  end if;
  -- one config row; FOR UPDATE serialises overlapping cron invocations (F7)
  select * into c from public.email_ingest_config where only_one = true for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_config');
  end if;

  if p_outcome in ('success', 'empty') then
    v_next := p_next_normal;
    v_advanced := p_next_normal is not null;
    update public.email_ingest_config
       set next_run_at = coalesce(p_next_normal, next_run_at),
           last_scheduled_run_at = now(),
           schedule_anchor_at = now(),        -- the cadence moves only on success
           schedule_retry_count = 0,
           last_outcome = p_outcome, last_outcome_at = now()
     where only_one = true;

  elsif p_outcome = 'failed' then
    v_retries := c.schedule_retry_count + 1;
    if v_retries > v_max then
      -- stop hammering: fall back to the normal cadence and start again there
      v_next := p_next_normal;
      v_advanced := p_next_normal is not null;
      update public.email_ingest_config
         set next_run_at = coalesce(p_next_normal, next_run_at),
             last_scheduled_run_at = now(),
             schedule_retry_count = 0,
             last_outcome = 'failed', last_outcome_at = now()
       where only_one = true;
    else
      v_backoff := least(make_interval(secs => v_base * power(2, v_retries - 1)::int), interval '60 minutes');
      v_next := now() + v_backoff;
      v_retrying := true;
      update public.email_ingest_config
         set next_run_at = v_next,
             last_scheduled_run_at = now(),
             -- schedule_anchor_at deliberately untouched (F5)
             schedule_retry_count = v_retries,
             last_outcome = 'failed', last_outcome_at = now()
       where only_one = true;
    end if;

  elsif p_outcome = 'skipped_lease' then
    -- no work was done, so the slot is not spent (F3)
    v_next := c.next_run_at;
    update public.email_ingest_config
       set last_outcome = 'skipped_lease', last_outcome_at = now()
     where only_one = true;

  else -- forced
    if p_advance_on_forced and p_next_normal is not null then
      v_next := p_next_normal; v_advanced := true;
      update public.email_ingest_config
         set next_run_at = p_next_normal, last_scheduled_run_at = now(), schedule_anchor_at = now(),
             schedule_retry_count = 0, last_outcome = 'forced', last_outcome_at = now()
       where only_one = true;
    else
      v_next := c.next_run_at;
      update public.email_ingest_config
         set last_outcome = 'forced', last_outcome_at = now()
       where only_one = true;
    end if;
  end if;

  select * into c from public.email_ingest_config where only_one = true;
  return jsonb_build_object('ok', true, 'outcome', p_outcome, 'advanced', v_advanced, 'retrying', v_retrying,
                            'next_run_at', c.next_run_at, 'retry_count', c.schedule_retry_count,
                            'anchor_at', c.schedule_anchor_at, 'computed_next', v_next);
end $$;
comment on function public.fn_sync_email_schedule_outcome(text, timestamptz, integer, integer, boolean) is 'The only writer of email_ingest_config.next_run_at. Advances the cadence on success, retries soon after a failure without moving the anchor, and leaves the slot untouched when a run was skipped because another lease was active. Takes the config row FOR UPDATE so overlapping crons cannot race.';
revoke all on function public.fn_sync_email_schedule_outcome(text, timestamptz, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.fn_sync_email_schedule_outcome(text, timestamptz, integer, integer, boolean) to service_role;

-- ── 3 · job_runs reconciliation (workstream G) ──────────────────────────────
create or replace function public.fn_sync_reconcile_job_runs(p_stale_minutes integer default 120)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare v_n int; v_jobs text;
begin
  with u as (
    update public.job_runs
       set status = 'failed', finished_at = now(),
           error = left(coalesce(error, '') || case when coalesce(error, '') = '' then '' else ' · ' end
                        || format('no terminal status was recorded within %s minutes — closed by reconciliation',
                                  greatest(5, least(coalesce(p_stale_minutes, 120), 1440))), 500)
     where status = 'running'
       and started_at < now() - make_interval(mins => greatest(5, least(coalesce(p_stale_minutes, 120), 1440)))
    returning job)
  select count(*), string_agg(distinct job, ', ') into v_n, v_jobs from u;
  return jsonb_build_object('closed', coalesce(v_n, 0), 'jobs', coalesce(v_jobs, ''));
end $$;
comment on function public.fn_sync_reconcile_job_runs(integer) is 'Closes job_runs rows still "running" past the threshold. The safety net under the strict finaliser: a lost connection can leave a row open, but not for ever.';
revoke all on function public.fn_sync_reconcile_job_runs(integer) from public, anon, authenticated;
grant execute on function public.fn_sync_reconcile_job_runs(integer) to service_role;

-- ── 4 · alert state: dedupe, threshold, recovery (workstream I) ─────────────
create table if not exists public.sync_alert_state (
  kind        text not null,
  ref         text not null,
  consecutive integer not null default 0,
  detail      text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  notified_at timestamptz,
  cleared_at  timestamptz,
  -- set when the RECOVERY has been reported. A time window cannot do this
  -- job: inside one transaction now() does not advance, so "cleared in the
  -- last second" is true for every call in that transaction and the recovery
  -- would be emitted again and again.
  recovered_at timestamptz,
  primary key (kind, ref)
);
alter table public.sync_alert_state add column if not exists recovered_at timestamptz;
alter table public.sync_alert_state enable row level security;
revoke all on table public.sync_alert_state from public, anon, authenticated;
grant select, insert, update, delete on table public.sync_alert_state to service_role;
comment on table public.sync_alert_state is 'One row per health condition seen (kind, ref): how many consecutive checks have seen it, whether it has already been reported, and when it cleared. Makes the alert cron notify once, not every five minutes.';

-- Who hears about it, and after how many consecutive checks. One row, so the
-- console can edit it and the cron can read it without an environment
-- variable deploy.
create table if not exists public.sync_alert_config (
  id              smallint primary key default 1 check (id = 1),
  enabled         boolean not null default false,
  recipients      text[] not null default '{}'::text[],
  min_consecutive integer not null default 2 check (min_consecutive between 1 and 20),
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
insert into public.sync_alert_config (id) values (1) on conflict (id) do nothing;
alter table public.sync_alert_config enable row level security;
revoke all on table public.sync_alert_config from public, anon, authenticated;
grant select, insert, update on table public.sync_alert_config to service_role;
comment on table public.sync_alert_config is 'Data Sync health alerting: whether it is on, who is mailed, and how many consecutive failing checks are required before anyone is. The module is only "unattended" while enabled is true and recipients is non-empty.';

-- Runs one health check: fold the current view into the state table and
-- return only what the operator should hear about now.
--   action 'notify'  → the condition has been present for p_min_consecutive
--                      checks and has not been reported yet
--   action 'recover' → a reported condition is no longer present
create or replace function public.fn_sync_alert_state(p_min_consecutive integer default 2)
 returns table (action text, kind text, ref text, detail text, consecutive integer, since timestamptz)
 language plpgsql volatile security definer set search_path to ''
as $$
-- The OUT columns are named kind / ref / detail / consecutive, which makes them
-- PL/pgSQL variables that shadow the table columns of the same name. Every
-- reference below is qualified, and this tells PostgreSQL to prefer the column
-- wherever a bare name could still be read either way.
#variable_conflict use_column
declare v_min int := greatest(1, least(coalesce(p_min_consecutive, 2), 100));
begin
  create temp table if not exists _sync_alert_now (kind text, ref text, detail text, since timestamptz) on commit drop;
  delete from _sync_alert_now;
  insert into _sync_alert_now (kind, ref, detail, since)
  select a.kind, a.ref, left(a.detail, 400), a.since from public.sync_health_alerts a where a.ref is not null;

  -- conditions present now: count the consecutive sighting, clear any
  -- previous recovery mark (the condition came back)
  insert into public.sync_alert_state as s (kind, ref, consecutive, detail, first_seen, last_seen)
  select n.kind, n.ref, 1, n.detail, coalesce(n.since, now()), now() from _sync_alert_now n
  on conflict on constraint sync_alert_state_pkey do update
    set consecutive  = case when s.cleared_at is not null then 1 else s.consecutive + 1 end,
        detail       = excluded.detail,
        last_seen    = now(),
        notified_at  = case when s.cleared_at is not null then null else s.notified_at end,
        cleared_at   = null,
        recovered_at = null;

  -- conditions that were reported and are now gone: recover, once
  update public.sync_alert_state s set cleared_at = now()
   where s.cleared_at is null and s.notified_at is not null
     and not exists (select 1 from _sync_alert_now n where n.kind = s.kind and n.ref = s.ref);

  -- conditions that were never reported and are gone: forget them entirely
  delete from public.sync_alert_state s
   where s.notified_at is null
     and not exists (select 1 from _sync_alert_now n where n.kind = s.kind and n.ref = s.ref);

  -- what to say now
  return query
    with notify as (
      update public.sync_alert_state s set notified_at = now()
       where s.notified_at is null and s.cleared_at is null and s.consecutive >= v_min
      returning 'notify'::text as action, s.kind, s.ref, s.detail, s.consecutive, s.first_seen
    ), recover as (
      update public.sync_alert_state s set recovered_at = now()
       where s.cleared_at is not null and s.notified_at is not null and s.recovered_at is null
      returning 'recover'::text as action, s.kind, s.ref, s.detail, s.consecutive, s.cleared_at as first_seen
    )
    select * from notify union all select * from recover;
end $$;
comment on function public.fn_sync_alert_state(integer) is 'Folds sync_health_alerts into sync_alert_state and returns only what should be sent now: conditions seen p_min_consecutive times in a row and not yet reported (notify), and reported conditions that have cleared (recover). Calling it repeatedly does not re-notify.';
revoke all on function public.fn_sync_alert_state(integer) from public, anon, authenticated;
grant execute on function public.fn_sync_alert_state(integer) to service_role;

-- A recovered row is kept briefly for the console, then forgotten.
create or replace function public.fn_sync_alert_prune(p_keep_hours integer default 72)
 returns integer language sql volatile security definer set search_path to ''
as $$
  with d as (
    delete from public.sync_alert_state
     where cleared_at is not null
       and cleared_at < now() - make_interval(hours => greatest(1, least(coalesce(p_keep_hours, 72), 720)))
    returning 1)
  select coalesce(count(*), 0)::int from d;
$$;
revoke all on function public.fn_sync_alert_prune(integer) from public, anon, authenticated;
grant execute on function public.fn_sync_alert_prune(integer) to service_role;
