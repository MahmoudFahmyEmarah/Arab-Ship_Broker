-- ════════════════════════════════════════════════════════════════════════
-- Objects the repository depends on but no migration creates (21 Sep 2026)
--
-- Inventory taken on 21 Sep 2026 by comparing every `create table` in
-- supabase/migrations with the deployed public schema. Three tables exist in
-- the database and in no migration — they were created by hand, or by a
-- migration that was archived into supabase/migrations/_archive_pre_baseline
-- before the 20260616 remote baseline was introspected:
--
--   contact_messages      the public contact form; first REFERENCED by
--                         20260904193900_restore_admin_dashboard_rpcs.sql
--   sync_source_state     Data Sync's per-source watermark and run lease;
--                         first referenced by 20260705120000_whatsapp_source.sql
--   vessel_review_queue   Manual Review's vessels-without-IMO queue; first
--                         referenced by 20260828120000_vessel_queue_grt_open_date.sql
--
-- A clean build stopped at the first of those references, which is why
-- `supabase db reset` could not rebuild this database and a production dump
-- was being used instead.
--
-- The shapes below are deliberately the EARLY ones. Every column, constraint
-- and index that a later migration adds is left out (the list is at the top
-- of the generated section), so the migration chain still evolves these
-- tables exactly as it does on the live project, and the end state is the
-- same either way. supabase/tests/schema_parity_check.sql proves that.
--
-- Not a migration: it runs once, before the chain, on a database being built
-- from scratch. Idempotent. Regenerate with the procedure in
-- docs/data-sync-hardening-2.md §12.
-- ════════════════════════════════════════════════════════════════════════

-- skipped, because a migration adds them:
--   sync_source_state constraint sync_source_state_source_check (added by a migration)
--   sync_source_state.lease_token (added by a migration)
--   sync_source_state.uid_validity (added by a migration)
--   vessel_review_queue.dest_zones (added by a migration)
--   vessel_review_queue.direction (added by a migration)
--   vessel_review_queue.grt (added by a migration)
--   vessel_review_queue.imo_hint (added by a migration)
--   vessel_review_queue.nrt (added by a migration)
--   vessel_review_queue.open_country (added by a migration)
--   vessel_review_queue.open_date (added by a migration)
--   vessel_review_queue.open_port (added by a migration)
--   vessel_review_queue.open_zone (added by a migration)
--   vessel_review_queue.owner_company (added by a migration)
--   vessel_review_queue.posted_at (added by a migration)
--   vessel_review_queue.source_contact_id (added by a migration)

create table if not exists public.contact_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  how_did_you_find_us text,
  message text NOT NULL,
  is_read boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.sync_source_state (
  source text NOT NULL,
  last_sync_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_uid bigint,
  lease_owner text,
  lease_until timestamp with time zone
);

create table if not exists public.vessel_review_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  vessel_name text NOT NULL,
  built smallint,
  dwt_grain integer,
  vessel_type text,
  flag text,
  composite_key text NOT NULL,
  source_email jsonb,
  source text DEFAULT 'email'::text NOT NULL,
  first_batch_id uuid,
  status text DEFAULT 'pending'::text NOT NULL,
  resolved_vessel_id uuid,
  resolved_with_imo boolean,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  commercial_manager text,
  ism_manager text,
  resolved_availability_id uuid,
  CONSTRAINT vessel_review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'synced'::text, 'ignored'::text])))
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_pkey') then
    alter table public.contact_messages add constraint contact_messages_pkey primary key (id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sync_source_state_pkey') then
    alter table public.sync_source_state add constraint sync_source_state_pkey primary key (source);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vessel_review_queue_composite_key_key') then
    alter table public.vessel_review_queue add constraint vessel_review_queue_composite_key_key unique (composite_key);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vessel_review_queue_pkey') then
    alter table public.vessel_review_queue add constraint vessel_review_queue_pkey primary key (id);
  end if;
end $$;

-- row security matches the rest of the schema: nothing reachable without a
-- policy, and the service role does its work through the RPCs.
alter table public.contact_messages    enable row level security;
alter table public.sync_source_state   enable row level security;
alter table public.vessel_review_queue enable row level security;
grant select, insert, update, delete on public.contact_messages    to service_role;
grant select, insert, update, delete on public.sync_source_state   to service_role;
grant select, insert, update, delete on public.vessel_review_queue to service_role;
