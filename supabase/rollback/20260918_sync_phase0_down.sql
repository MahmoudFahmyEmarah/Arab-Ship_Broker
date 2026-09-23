-- DOWN for 20260918100000_sync_phase0_failed_status.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase0_down.sql
--   supabase migration repair --status reverted 20260918100000
drop function if exists public.mark_sync_batch_failed(uuid, text);
