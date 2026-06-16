-- ── 1. Seed missing ports for existing cargo data ─────────────
-- The existing cargos table has free-text load_locode values.
-- We create placeholder port rows for any locode not already present
-- so the FK insert in step 2 doesn't fail.

INSERT INTO public.ports (locode, trade_name, country, zone, port_type, is_verified)
SELECT DISTINCT
  c.load_locode,
  c.load_port,
  'Unknown',
  'Unknown'::public.zone_enum,
  'Sea Port'::public.port_type_enum,
  FALSE          -- is_verified = FALSE — admin must confirm these
FROM public.cargos c
WHERE c.load_locode IS NOT NULL
  AND c.load_locode <> ''
  AND NOT EXISTS (SELECT 1 FROM public.ports p WHERE p.locode = c.load_locode)
ON CONFLICT (locode) DO NOTHING;

INSERT INTO public.ports (locode, trade_name, country, zone, port_type, is_verified)
SELECT DISTINCT
  c.discharge_locode,
  c.discharge_port,
  'Unknown',
  'Unknown'::public.zone_enum,
  'Sea Port'::public.port_type_enum,
  FALSE
FROM public.cargos c
WHERE c.discharge_locode IS NOT NULL
  AND c.discharge_locode <> ''
  AND NOT EXISTS (SELECT 1 FROM public.ports p WHERE p.locode = c.discharge_locode)
ON CONFLICT (locode) DO NOTHING;

-- ── 2. Migrate cargo rows ─────────────────────────────────────
-- Maps old schema columns to new cargo_listings columns.
-- contact_* fields are preserved in notes (PII — no dedicated column now).
-- Old cargos have category as commodity_name (no commodity_id FK yet).
-- review_status = APPROVED for all historical data (they were already live).

INSERT INTO public.cargo_listings (
  cargo_type,
  commodity_name,
  is_dg_cargo,
  qty_min_mt,
  qty_max_mt,
  stowage_factor,
  load_port_locode,
  disch_port_locode,
  laycan_from,
  laycan_to,
  load_rate,
  load_terms,
  freight_idea_usd_mt,
  broker,
  notes,
  status,
  review_status,
  goes_live_at,
  created_at,
  updated_at
)
SELECT
  CASE c.cargo_type
    WHEN 'bulk'      THEN 'Dry Bulk'::public.cargo_type_v2_enum
    WHEN 'breakbulk' THEN 'Break Bulk'::public.cargo_type_v2_enum
  END,
  COALESCE(c.bcsn, c.category),   -- use bcsn as commodity name, fall back to category
  c.is_dangerous_goods,
  c.quantity_min_mt::INTEGER,
  c.quantity_max_mt::INTEGER,
  c.stowage_factor,
  NULLIF(c.load_locode, ''),
  NULLIF(c.discharge_locode, ''),
  c.laycan_from,
  c.laycan_to,
  c.loading_terms,
  NULL,  -- load_terms_enum: old data used free text — cannot map cleanly
  NULL,  -- freight_idea: old field was text, new is numeric — skip
  CONCAT(c.contact_name, ' (', c.contact_role, ')'),
  -- Preserve contact info in notes (will be redacted/removed by admin later)
  CONCAT(
    'Migrated from cargos table. Contact: ', c.contact_name,
    ' | Email: ', c.contact_email,
    ' | Phone: ', c.contact_phone
  ),
  CASE c.status WHEN 'IN' THEN 'IN'::public.cargo_status_enum ELSE 'CLOSED'::public.cargo_status_enum END,
  'APPROVED'::public.review_status_enum,
  c.created_at,   -- goes_live_at = original created_at
  c.created_at,
  c.updated_at
FROM public.cargos c
WHERE NOT EXISTS (
  -- Idempotent: don't re-migrate rows already in cargo_listings
  -- (match on load_locode + disch_locode + laycan_from + created_at)
  SELECT 1 FROM public.cargo_listings cl
  WHERE cl.load_port_locode = NULLIF(c.load_locode,'')
    AND cl.disch_port_locode = NULLIF(c.discharge_locode,'')
    AND cl.laycan_from = c.laycan_from
    AND cl.created_at = c.created_at
);

-- ── 3. Create listing_ownership rows for migrated data ────────
-- Migrated rows have no owner (the original user_id references auth.users
-- not our users table). We mark them as admin_posted.
-- Admins can assign real owners via the ownership claim workflow later.

INSERT INTO public.listing_ownership (listing_type, listing_id, owner_user_id, role, transfer_reason)
SELECT
  'cargo',
  cl.id,
  (SELECT supabase_user_id FROM public.users WHERE role = 'admin' LIMIT 1),
  'admin_posted',
  'initial_post'
FROM public.cargo_listings cl
WHERE NOT EXISTS (
  SELECT 1 FROM public.listing_ownership lo
  WHERE lo.listing_id = cl.id AND lo.listing_type = 'cargo'
)
AND (SELECT supabase_user_id FROM public.users WHERE role = 'admin' LIMIT 1) IS NOT NULL;

-- ── 4. Rename old table (safe — does not drop data) ───────────
-- After 30 days of stable operation, drop cargos_deprecated.

ALTER TABLE public.cargos RENAME TO cargos_deprecated;
DROP VIEW IF EXISTS public.cargos_access_view;

-- ── 5. Drop the now-unused get_or_create_user_profile RPC ─────
-- The auto-registration flow it powered is removed from the codebase.
DROP FUNCTION IF EXISTS public.get_or_create_user_profile(text, text, public.user_role, public.access_tier);

-- ── 6. Drop legacy access_tier type ──────────────────────────
DROP TYPE IF EXISTS public.access_tier CASCADE;
DROP TYPE IF EXISTS public.access_granted_by CASCADE;