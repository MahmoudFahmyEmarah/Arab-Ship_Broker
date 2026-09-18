-- DOWN for 20260918130000_sync_phase3_gate_mandatory.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase3_down.sql
--   supabase migration repair --status reverted 20260918130000
-- Deploy the pre-phase-3 application first (it no longer calls regate_sync_batch).
-- Function bodies then need re-applying from their last migrations:
--   commit_sync_batch                → 20260918120000 (phase 2 body)
--   fn_dq_gate_batch                 → 20260909150000
--   fn_dq_forms_gate                 → 20260917120000
--   edit_live_record                 → 20260704120000   (bulk_update_live_records too)
--   insert_live_record               → 20260731110000

drop function if exists public.regate_sync_batch(uuid, text, text);   -- also undoes 20260918160000
drop function if exists public.fn_sync_batch_recount(uuid);
drop function if exists public.fn_sync_gate_stale(uuid, text, uuid[]);
drop function if exists public.fn_dq_rules_version();

alter table public.sync_staged_row drop constraint if exists sync_staged_row_gate_status_chk;
alter table public.sync_staged_row
  drop column if exists gate_status,
  drop column if exists gate_rules_version,
  drop column if exists gate_payload_hash,
  drop column if exists gated_at;

-- then re-run, in this order, the function definitions listed above.
