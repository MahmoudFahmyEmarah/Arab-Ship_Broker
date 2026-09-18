-- ════════════════════════════════════════════════════════════════════════
-- Data Sync — inbox schedule cadence + audit trail (12 Sep 2026)
--
-- 1 · email_ingest_config gains a real cadence: daily / every N days / weekly,
--     at an hour the owner picks. /api/cron/email-sync wakes hourly and runs
--     only when next_run_at has passed, then advances it (lib/sync/email/
--     schedule.ts holds the one computation, shared with the UI preview).
-- 2 · data_sync_audit — who did what, when, to what. Every mutating server
--     action and route in the module writes one row through
--     lib/admin/data-sync-audit.ts (service role; a failed write never fails
--     the action). Admins read it in History → Audit trail.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

alter table public.email_ingest_config
  add column if not exists schedule_kind          text not null default 'daily'
    check (schedule_kind in ('daily', 'every_n_days', 'weekly')),
  add column if not exists schedule_hour_utc      smallint not null default 2
    check (schedule_hour_utc between 0 and 23),
  add column if not exists schedule_interval_days smallint not null default 2
    check (schedule_interval_days between 2 and 30),
  add column if not exists schedule_weekday       smallint not null default 1
    check (schedule_weekday between 0 and 6),          -- 0 = Sunday … 6 = Saturday (UTC)
  add column if not exists schedule_tz            text,   -- IANA zone the owner picked the hour in (display only)
  add column if not exists next_run_at            timestamptz,
  add column if not exists last_scheduled_run_at  timestamptz;

comment on column public.email_ingest_config.next_run_at is
  'Set by setEmailSchedule() and advanced by /api/cron/email-sync after each scheduled run. Null while the schedule is off.';

-- ── audit trail ──────────────────────────────────────────────────────────
create table if not exists public.data_sync_audit (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,                    -- public.users.id (null for cron / webhook)
  actor_name   text,                    -- denormalised so the trail survives renames
  actor_kind   text not null default 'admin' check (actor_kind in ('admin', 'cron', 'webhook', 'system')),
  action       text not null,           -- batch.commit · batch.undo · row.edit · settings.llm_key.save · …
  target_kind  text,                    -- batch · staged_row · record · queue · settings · run
  target_id    text,                    -- uuid / business key / table name
  batch_id     uuid,                    -- when the action concerns a batch
  summary      text not null,           -- one plain-English line
  detail       jsonb not null default '{}'::jsonb,
  ok           boolean not null default true,
  ip           text,
  user_agent   text
);
create index if not exists idx_dsa_at        on public.data_sync_audit (at desc);
create index if not exists idx_dsa_actor_at  on public.data_sync_audit (actor_id, at desc);
create index if not exists idx_dsa_action_at on public.data_sync_audit (action, at desc);
create index if not exists idx_dsa_batch     on public.data_sync_audit (batch_id) where batch_id is not null;

alter table public.data_sync_audit enable row level security;
drop policy if exists dsa_admin_read on public.data_sync_audit;
create policy dsa_admin_read on public.data_sync_audit for select using (public.fn_is_admin());
-- no insert/update/delete policy: only the service role writes, nobody edits history
revoke all on public.data_sync_audit from anon;
grant select on public.data_sync_audit to authenticated;
grant all on public.data_sync_audit to service_role;

comment on table public.data_sync_audit is
  'Data Sync audit trail — who did what, when. Written only by the server (service role); admins read it in History → Audit trail. Retained 24 months (fn_prune_ops_tables).';

-- retention: 24 months
create or replace function public.fn_data_sync_audit_prune()
 returns integer language sql security definer set search_path to ''
as $$
  with d as (delete from public.data_sync_audit where at < now() - interval '24 months' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.fn_data_sync_audit_prune() from public, anon, authenticated;
grant execute on function public.fn_data_sync_audit_prune() to service_role;
