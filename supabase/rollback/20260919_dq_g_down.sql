-- DOWN for 20260919160000_dq_g_notifications.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_g_down.sql
--   supabase migration repair --status reverted 20260919160000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919160000, never dropped.
-- Deploy the pre-G application first (the outbox worker and the schedule key are gone after this).
-- The outbox is renamed, not dropped: undelivered and delivered notifications stay readable.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.fn_dq_outbox_enqueue(text, text, jsonb);
drop function if exists public.fn_dq_outbox_claim(integer, integer, integer);
drop function if exists public.fn_dq_outbox_claim(integer, integer);
drop function if exists public.fn_dq_outbox_settle(bigint, uuid, boolean, text, text[], integer);
drop function if exists public.fn_dq_outbox_requeue(bigint);
drop policy if exists dq_notification_outbox_admin_read on public.dq_notification_outbox;
drop index if exists public.dq_notification_outbox_due_idx;
do $$ begin
  if to_regclass('public.dq_notification_outbox') is not null then
    execute 'alter table public.dq_notification_outbox rename to dq_notification_outbox_bak_20260919160000';
    -- the bigserial's sequence is OWNED by the table but does not follow a
    -- rename: leave it and the live name stays taken, and the schema
    -- fingerprint sees a sequence the baseline never had
    execute 'alter sequence if exists public.dq_notification_outbox_id_seq rename to dq_notification_outbox_id_seq_bak_20260919160000';
-- the constraints (and their indexes) follow the table into the backup name, so nothing keeps the live name
alter table public.dq_notification_outbox_bak_20260919160000 rename constraint dq_notification_outbox_pkey to dq_notification_outbox_pkey_bak_20260919160000;
alter table public.dq_notification_outbox_bak_20260919160000 rename constraint dq_notification_outbox_idem_key_key to dq_notification_outbox_idem_key_key_bak_20260919160000;
alter table public.dq_notification_outbox_bak_20260919160000 rename constraint dq_notification_outbox_kind_check to dq_notification_outbox_kind_check_bak_20260919160000;
alter table public.dq_notification_outbox_bak_20260919160000 rename constraint dq_notification_outbox_status_check to dq_notification_outbox_status_check_bak_20260919160000;
    execute 'alter table public.dq_notification_outbox_bak_20260919160000 disable row level security';
    execute 'revoke all on public.dq_notification_outbox_bak_20260919160000 from service_role';
  end if;
end $$;
drop index if exists public.dq_runs_schedule_key_uq;
alter table public.dq_runs drop column if exists schedule_key;
-- delivery records already written stay in dq_config_events; the kind check narrows back to what E allows
do $$
declare c record;
begin
  delete from public.dq_config_events where kind = 'notification';
  for c in select conname from pg_constraint where conrelid = 'public.dq_config_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.dq_config_events drop constraint %I', c.conname);
  end loop;
  alter table public.dq_config_events add constraint dq_config_events_kind_check check (kind in ('channel_mode', 'settings'));
end $$;
revoke insert on public.dq_config_events from service_role;
