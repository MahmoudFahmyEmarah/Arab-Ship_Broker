-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream E — configuration history and settings limits
-- (19 Sep 2026; audit: "immutable audit history for channel modes and
-- settings", "server-validate settings")
--
--   dq_config_events   every change to a rule's channel mode and to the
--       module settings, with before / after images and the actor. Rule
--       edits, enable / disable / delete already leave dq_rule_versions rows.
--   dq_settings        numeric limits as CHECK constraints, so a bad value
--       cannot land whatever client sends it.
-- The permission split (run audits vs view) and the pre-submit form check
-- live in the application. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── 0 · correlation of a publication attempt with its refusal ─────────────
-- The forms channel's own gate-log line is written by the trigger inside the
-- refused statement, so it rolls back with it. The form therefore reports the
-- refusal afterwards, in its own transaction, tagged with the correlation id
-- the pre-check handed out — that line survives; the trigger's does not.
alter table public.dq_gate_log add column if not exists correlation_id uuid;
create index if not exists idx_dq_gate_log_correlation on public.dq_gate_log (correlation_id) where correlation_id is not null;
comment on column public.dq_gate_log.correlation_id is 'Set by the application after a refused publication attempt (lib/dq/member-gate.ts reportGateRefusal): the id validateMemberDraft handed the form. Trigger-written lines of a refused statement do not survive; these do.';

create table if not exists public.dq_config_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('channel_mode', 'settings')),
  key        text not null,           -- "<rule code>/<channel>" or "settings"
  before     jsonb,
  after      jsonb,
  actor      uuid,
  actor_name text
);
create index if not exists dq_config_events_at_idx on public.dq_config_events (at desc);
alter table public.dq_config_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dq_config_events' and policyname = 'dq_config_events_admin_read') then
    create policy dq_config_events_admin_read on public.dq_config_events for select using (public.fn_is_admin());
  end if;
end $$;
grant select on public.dq_config_events to service_role;

create or replace function public.fn_dq_channel_mode_event()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_code text; v_key text;
begin
  select code into v_code from public.dq_rules where id = coalesce(new.rule_id, old.rule_id);
  v_key := coalesce(v_code, coalesce(new.rule_id, old.rule_id)::text) || '/' || coalesce(new.channel, old.channel);
  insert into public.dq_config_events (kind, key, before, after, actor, actor_name)
  values ('channel_mode', v_key,
          case when tg_op = 'INSERT' then null else jsonb_build_object('mode', old.mode) end,
          case when tg_op = 'DELETE' then null else jsonb_build_object('mode', new.mode) end,
          case when tg_op = 'DELETE' then old.updated_by else new.updated_by end,
          nullif(current_setting('dq.actor_name', true), ''));
  return null;
end $$;
drop trigger if exists trg_dq_channel_mode_event on public.dq_rule_channels;
create trigger trg_dq_channel_mode_event after insert or update or delete on public.dq_rule_channels
  for each row execute function public.fn_dq_channel_mode_event();

create or replace function public.fn_dq_settings_event()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_before jsonb := to_jsonb(old) - 'updated_at' - 'version' - 'registry_imported_at'; v_after jsonb := to_jsonb(new) - 'updated_at' - 'version' - 'registry_imported_at'; k text; v_diff_b jsonb := '{}'; v_diff_a jsonb := '{}';
begin
  for k in select jsonb_object_keys(v_after) loop
    if v_before -> k is distinct from v_after -> k then
      v_diff_b := v_diff_b || jsonb_build_object(k, v_before -> k);
      v_diff_a := v_diff_a || jsonb_build_object(k, v_after -> k);
    end if;
  end loop;
  if v_diff_a = '{}'::jsonb then return null; end if;
  insert into public.dq_config_events (kind, key, before, after, actor, actor_name)
  values ('settings', 'settings', v_diff_b, v_diff_a, new.updated_by, nullif(current_setting('dq.actor_name', true), ''));
  return null;
end $$;
drop trigger if exists trg_dq_settings_event on public.dq_settings;
create trigger trg_dq_settings_event after update on public.dq_settings
  for each row execute function public.fn_dq_settings_event();

-- limits the console used to leave to the client
do $$
begin
  update public.dq_settings set ai_sample = greatest(5, least(200, ai_sample)), ai_daily_tokens = greatest(0, ai_daily_tokens), ai_price_per_mtok = greatest(0, ai_price_per_mtok),
                                auto_apply_threshold = greatest(0, least(1, auto_apply_threshold)) where id = 1;
  if not exists (select 1 from pg_constraint where conname = 'dq_settings_ai_sample_ck') then
    alter table public.dq_settings add constraint dq_settings_ai_sample_ck check (ai_sample between 5 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dq_settings_ai_budget_ck') then
    alter table public.dq_settings add constraint dq_settings_ai_budget_ck check (ai_daily_tokens >= 0 and ai_price_per_mtok >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dq_settings_threshold_ck') then
    alter table public.dq_settings add constraint dq_settings_threshold_ck check (auto_apply_threshold between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dq_settings_nightly_time_ck') then
    alter table public.dq_settings add constraint dq_settings_nightly_time_ck check (nightly_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

revoke all on function public.fn_dq_channel_mode_event() from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_settings_event() from public, anon, authenticated, dq_evaluator;
