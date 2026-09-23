-- DOWN for 20260918110000_sync_phase1_intake_durability.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase1_down.sql
--   supabase migration repair --status reverted 20260918110000
-- Deploy the pre-phase-1 application first: the new code calls these functions.

drop function if exists public.claim_whatsapp_messages(text, integer, integer, boolean, integer);
drop function if exists public.release_whatsapp_messages(uuid[]);
drop index if exists public.idx_wa_msg_claimable;
update public.whatsapp_message set status = 'pending', lease_token = null, lease_until = null where status = 'processing';
alter table public.whatsapp_message drop constraint if exists whatsapp_message_status_check;
alter table public.whatsapp_message add constraint whatsapp_message_status_check
  check (status in ('pending', 'staged', 'irrelevant', 'failed'));
alter table public.whatsapp_message
  drop column if exists lease_token,
  drop column if exists lease_until,
  drop column if exists attempts;

drop function if exists public.set_email_checkpoint(text, bigint, bigint, timestamptz);
drop function if exists public.release_sync_run(text, text);
drop function if exists public.claim_sync_run(text, text, integer);
alter table public.sync_source_state
  drop column if exists uid_validity,
  drop column if exists last_uid,
  drop column if exists lease_owner,
  drop column if exists lease_until;
