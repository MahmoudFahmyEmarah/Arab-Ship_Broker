-- ============================================================
-- ARAB SHIPBROKER — Migration support: feature columns + firewall (part 1)
-- Date: 2026-06-01
--
-- Supports porting two features from the legacy Vite app:
--   • Circular parser  → structured `is_wog` flag on cargo_listings
--   • Voyage estimator → per-fuel bunker granularity on vessel_availability
-- Plus the owner-controlled cross-side broadcast flag `for_circulation`.
--
-- Firewall stance (NON-NEGOTIABLE): counterparty contact is ADMIN-ONLY.
-- A user may see the contact details on THEIR OWN listing, never the
-- counterparty's. This file tightens the (legacy) cargos_access_view as
-- defense-in-depth. The live vessel-side firewall fix lands in part 2.
--
-- All changes are additive / policy-replacing. No existing column dropped.
-- ============================================================

-- ── 1. is_wog on cargo_listings ──────────────────────────────
-- Without Guarantee. Structured flag (NOT buried in notes): drives the
-- amber WOG warning banner and feeds matchmaking confidence.
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS is_wog BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cl_wog
  ON public.cargo_listings (is_wog) WHERE is_wog = TRUE;

COMMENT ON COLUMN public.cargo_listings.is_wog IS
  'Without Guarantee — cargo offered without firm commitment. Drives the '
  'amber WOG warning banner and feeds matchmaking confidence. Structured '
  'flag, never inferred from free-text notes.';

-- ── 2. Per-fuel bunker granularity on vessel_availability ─────
-- The voyage estimator needs VLSFO vs LSMGO split, at sea and in port.
-- Do NOT approximate onto the generic me/aux consumption columns — fuel
-- accuracy is the estimator's whole value.
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS vlsfo_sea_mt_day  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS lsmgo_sea_mt_day  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS vlsfo_port_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS lsmgo_port_mt_day NUMERIC(5,2);

COMMENT ON COLUMN public.vessel_availability.vlsfo_sea_mt_day IS
  'VLSFO consumption at sea (MT/day). Per-fuel granularity for the voyage '
  'estimator — kept distinct from generic me/aux consumption on purpose.';
COMMENT ON COLUMN public.vessel_availability.lsmgo_sea_mt_day IS
  'LSMGO consumption at sea (MT/day).';
COMMENT ON COLUMN public.vessel_availability.vlsfo_port_mt_day IS
  'VLSFO consumption in port (MT/day).';
COMMENT ON COLUMN public.vessel_availability.lsmgo_port_mt_day IS
  'LSMGO consumption in port (MT/day).';

-- ── 3. for_circulation — owner-controlled cross-side broadcast ─
-- The Next.js base has no owner-facing control over whether an approved
-- listing is shown to the OTHER side of the market; admin approval implies
-- broadcast. for_circulation restores that control (per migration brief).
-- Default TRUE preserves current marketplace behaviour (approved == shown);
-- owners/admin can switch a listing to non-circulated (worked privately).
-- It NEVER affects contact visibility — contact stays admin-only regardless.
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS for_circulation BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS for_circulation BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_cl_circulation
  ON public.cargo_listings (for_circulation) WHERE for_circulation = TRUE;
CREATE INDEX IF NOT EXISTS idx_va_circulation
  ON public.vessel_availability (for_circulation) WHERE for_circulation = TRUE;

COMMENT ON COLUMN public.cargo_listings.for_circulation IS
  'Owner/admin control: TRUE = listing particulars (NEVER contact) are '
  'visible to the other side of the market. FALSE = worked privately, '
  'visible only to owner and admin. Contact remains admin-only in all cases.';

-- ── 4. Wire for_circulation into the cross-side browse policies ─
-- Owner ("see own") and admin ("full access") policies are unchanged, so
-- non-circulated listings remain fully visible to their owner and to admin.
DROP POLICY IF EXISTS "Browse approved listings" ON public.cargo_listings;
CREATE POLICY "Browse approved listings"
  ON public.cargo_listings FOR SELECT TO anon, authenticated
  USING (
    review_status = 'APPROVED'
    AND status IN ('IN','PARTIAL')
    AND for_circulation = TRUE
  );

DROP POLICY IF EXISTS "Browse approved availability" ON public.vessel_availability;
CREATE POLICY "Browse approved availability"
  ON public.vessel_availability FOR SELECT TO authenticated
  USING (
    review_status = 'APPROVED'
    AND status = 'OPEN'
    AND for_circulation = TRUE
  );

-- ── 5. Defense-in-depth: tighten legacy cargos_access_view ────
-- This view is not on the live read path (the app reads cargo_listings),
-- but it still grants member-gated contact. Re-point contact columns to
-- ADMIN-ONLY (or the row's own owner). Listing particulars keep their
-- existing member/guest gating; only CONTACT changes.
CREATE OR REPLACE VIEW public.cargos_access_view AS
 SELECT
    c.id,
    c.created_at,
    c.cargo_type,
    c.category,
    c.load_region,
    c.discharge_region,
    c.is_dangerous_goods,
    c.imsbc_group,
    c.loading_terms,
    c.status,
    -- Particulars: existing member/guest gating retained
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member'
        then c.load_port else 'Restricted' end as load_port,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member'
        then c.discharge_port else 'Restricted' end as discharge_port,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member'
        then concat(c.quantity_min_mt, ' - ', c.quantity_max_mt, ' ', c.unit)
        else 'Login for details' end as quantity_range,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.bcsn else null end as bcsn,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.quantity_min_mt else null end as quantity_min_mt,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.quantity_max_mt else null end as quantity_max_mt,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.unit::text else null end as unit,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.stowage_factor else null end as stowage_factor,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.load_locode else null end as load_locode,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.discharge_locode else null end as discharge_locode,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.laycan_from::text else null end as laycan_from,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.laycan_to::text else null end as laycan_to,
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member' then c.freight_idea else null end as freight_idea,
    -- CONTACT FIREWALL: admin, or the row's own owner, only. Everyone else NULL.
    case when public.is_admin() OR c.user_id = auth.uid() then c.contact_name  else null end as contact_name,
    case when public.is_admin() OR c.user_id = auth.uid() then c.contact_email else null end as contact_email,
    case when public.is_admin() OR c.user_id = auth.uid() then c.contact_phone else null end as contact_phone,
    case when public.is_admin() OR c.user_id = auth.uid() then c.contact_role::text else null end as contact_role,
    -- Tier passthrough for UI logic
    case when (select access_tier from public.users where supabase_user_id = auth.uid()) = 'member'
        then 'member'::text else 'guest'::text end as access_tier
   from public.cargos c
  where c.status = 'IN';

GRANT SELECT ON TABLE public.cargos_access_view TO anon, authenticated;

-- ── Note ─────────────────────────────────────────────────────
-- Part 2 (separate migration, pending scope sign-off) locks down the
-- vessels table so counterparty PII (pic_name, website, owner/manager
-- company) is not returned to non-admin/non-owner clients at the API
-- layer — closing the current direct-PostgREST exposure.
-- ============================================================
