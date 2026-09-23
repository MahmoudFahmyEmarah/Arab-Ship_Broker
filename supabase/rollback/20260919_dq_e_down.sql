-- DOWN for 20260919140000_dq_e_policy_and_audit.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_e_down.sql
--   supabase migration repair --status reverted 20260919140000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919140000, never dropped.
-- The configuration history is renamed, not dropped.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop trigger if exists trg_dq_channel_mode_event on public.dq_rule_channels;
drop trigger if exists trg_dq_settings_event on public.dq_settings;
drop function if exists public.fn_dq_channel_mode_event();
drop function if exists public.fn_dq_settings_event();
drop policy if exists dq_config_events_admin_read on public.dq_config_events;
drop index if exists public.dq_config_events_at_idx;
do $$ begin
  if to_regclass('public.dq_config_events') is not null then
    execute 'alter table public.dq_config_events rename to dq_config_events_bak_20260919140000';
    -- the bigserial's sequence is OWNED by the table but does not follow a
    -- rename: leave it and the live name stays taken, and the schema
    -- fingerprint sees a sequence the baseline never had
    execute 'alter sequence if exists public.dq_config_events_id_seq rename to dq_config_events_id_seq_bak_20260919140000';
-- the constraints (and their indexes) follow the table into the backup name, so nothing keeps the live name
alter table public.dq_config_events_bak_20260919140000 rename constraint dq_config_events_pkey to dq_config_events_pkey_bak_20260919140000;
alter table public.dq_config_events_bak_20260919140000 rename constraint dq_config_events_kind_check to dq_config_events_kind_check_bak_20260919140000;
    execute 'alter table public.dq_config_events_bak_20260919140000 disable row level security';
    execute 'revoke all on public.dq_config_events_bak_20260919140000 from service_role';
  end if;
end $$;
alter table public.dq_settings drop constraint if exists dq_settings_ai_sample_ck;
alter table public.dq_settings drop constraint if exists dq_settings_ai_budget_ck;
alter table public.dq_settings drop constraint if exists dq_settings_threshold_ck;
alter table public.dq_settings drop constraint if exists dq_settings_nightly_time_ck;

drop index if exists public.idx_dq_gate_log_correlation;
alter table public.dq_gate_log drop column if exists correlation_id;
