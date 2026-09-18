-- DOWN for 20260918120000_sync_phase2_batch_state_machine.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase2_down.sql
--   supabase migration repair --status reverted 20260918120000
-- Deploy the pre-phase-2 application first (it calls the old undo signatures).
-- Restores the function bodies of 20260714110801 (commit), 20260704090000
-- (undo_sync_batch) and 20260731110000 (undo_record_edits): re-apply those
-- three migration files' function definitions after this script.

drop trigger if exists trg_sync_batch_discard_guard on public.sync_batch;
drop function if exists public.fn_sync_batch_discard_guard();

drop function if exists public.undo_sync_batch(uuid, boolean, text);
drop function if exists public.undo_record_edits(uuid, uuid, uuid, boolean);
drop function if exists public.fn_sync_row_conflicts(jsonb, jsonb);

drop index if exists public.idx_commit_audit_active_row;
alter table public.sync_commit_audit
  drop column if exists undone_at,
  drop column if exists undone_by,
  drop column if exists undo_conflict;

update public.sync_batch set status = 'draft' where status in ('gated', 'gate_failed', 'partial');
alter table public.sync_batch drop constraint if exists sync_batch_status_chk;
alter table public.sync_batch add constraint sync_batch_status_chk
  check (status in ('draft', 'committing', 'committed', 'undone', 'failed'));

-- mark_sync_batch_failed: back to the phase-0 body
create or replace function public.mark_sync_batch_failed(p_batch_id uuid, p_error text)
 returns void language sql volatile security definer set search_path to ''
as $$
  update public.sync_batch
     set status = 'failed', error = left(coalesce(p_error, 'commit failed'), 2000)
   where id = p_batch_id and status not in ('committed', 'undone');
$$;

-- then re-run, in this order, the function definitions from:
--   supabase/migrations/20260714110801_sync_commit_auto_approve_listings.sql  (commit_sync_batch)
--   supabase/migrations/20260704090000_data_sync_pipeline.sql                 (undo_sync_batch, section 6)
--   supabase/migrations/20260731110000_preview_reference_tables.sql           (undo_record_edits, section 5)
