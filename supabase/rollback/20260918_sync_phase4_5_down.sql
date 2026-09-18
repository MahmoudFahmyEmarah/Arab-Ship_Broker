-- DOWN for 20260918140000_sync_phase4_fidelity.sql and 20260918150000_sync_phase5_scale.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase4_5_down.sql
--   supabase migration repair --status reverted 20260918140000 20260918150000
-- Deploy the pre-phase-4 application first (it no longer calls fn_sync_previous_payloads).
-- commit_sync_batch then needs its phase-3 body re-applied from 20260918130000.

-- phase 5
do $$
declare ix record;
begin
  for ix in select indexname from pg_indexes where schemaname = 'public' and indexname like 'idx_trgm_%' loop
    execute format('drop index if exists public.%I', ix.indexname);
  end loop;
end $$;
-- (pg_trgm itself is left installed: other objects may use it)

-- phase 4
drop function if exists public.fn_sync_unknown_ports(jsonb, text[]);
drop function if exists public.fn_sync_previous_payloads(text, text, text[]);
drop trigger if exists trg_staged_row_source_default on public.sync_staged_row;
drop function if exists public.fn_staged_row_source_default();
drop index if exists public.idx_staged_prev_by_source;
alter table public.sync_staged_row drop column if exists source;
-- then re-run the commit_sync_batch definition from 20260918130000_sync_phase3_gate_mandatory.sql
