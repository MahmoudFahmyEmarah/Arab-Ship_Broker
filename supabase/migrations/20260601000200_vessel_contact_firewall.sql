-- ============================================================
-- ARAB SHIPBROKER — Contact firewall, part 2: vessel-side lockdown
-- Date: 2026-06-01
--
-- NON-NEGOTIABLE firewall: a non-owner, non-admin user must NOT receive
-- another party's vessel owner / manager / commercial-contact / PIC /
-- website / charterer identity — NOT in the UI, and NOT in any raw API
-- response. The Next.js base exposed all of these to any authenticated
-- member via `from('vessels').select('*')` (RLS only filtered sanctioned
-- vessels, never the columns). This migration closes that at the data layer.
--
-- Model (mirrors the cargo side):
--   • Counterparty PII columns are revoked at the base table → 403 at the
--     API for anyone but service_role. Owners/admin never read PII off the
--     base table directly.
--   • The app reads vessels through v_vessel_detail, which masks PII to
--     NULL unless the viewer is admin OR the vessel's own claimant.
--   • Owner sees their OWN vessel's PII (via the view + v_my_vessels).
--   • Admin sees everything (service-role client in the /admin area).
--
-- Built dynamically from information_schema so every current/future column
-- is covered automatically — no hand-maintained column list to drift.
-- ============================================================

-- ── 1. Owner-check helper ────────────────────────────────────
-- TRUE when the current user holds a claim on the given vessel.
CREATE OR REPLACE FUNCTION public.fn_is_vessel_owner(p_vessel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vessel_claims vc
    WHERE vc.vessel_id = p_vessel_id
      AND vc.user_id   = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_is_vessel_owner(uuid) TO authenticated;

-- ── 2. Base-table column lockdown (API-layer enforcement) ────
-- Revoke blanket SELECT, then re-grant every NON-PII column. The PII
-- columns are never granted → direct PostgREST selects of them return 403
-- for anon/authenticated. service_role (admin server actions) keeps full
-- access via its own grant, untouched here.
DO $$
DECLARE
  pii text[] := ARRAY[
    'owner_company','owner_country',
    'manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country',
    'commercial_manager_contact','commercial_manager_email','commercial_manager_phone',
    'pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    -- commercial intel (locked per firewall scope decision)
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'
  ];
  col text;
BEGIN
  EXECUTE 'REVOKE SELECT ON public.vessels FROM anon, authenticated';
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vessels'
      AND column_name <> ALL (pii)
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.vessels TO anon, authenticated', col);
  END LOOP;
END $$;

-- ── 3. Masked read view: v_vessel_detail ────────────────────
-- All columns; PII masked to NULL unless admin or the vessel's own owner.
-- Runs with the view owner's rights, so it can read the (revoked) PII
-- columns off the base table and apply the CASE mask per request.
-- WHERE preserves the "hide sanctioned from non-admin/non-owner" behaviour.
DROP VIEW IF EXISTS public.v_vessel_detail;
DO $$
DECLARE
  pii text[] := ARRAY[
    'owner_company','owner_country',
    'manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country',
    'commercial_manager_contact','commercial_manager_email','commercial_manager_phone',
    'pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    -- commercial intel (locked per firewall scope decision)
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'
  ];
  sel text := '';
  col text;
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vessels'
    ORDER BY ordinal_position
  LOOP
    IF sel <> '' THEN sel := sel || ', '; END IF;
    IF col = ANY (pii) THEN
      sel := sel || format(
        'CASE WHEN public.is_admin() OR public.fn_is_vessel_owner(v.id) '
        || 'THEN v.%I ELSE NULL END AS %I', col, col);
    ELSE
      sel := sel || format('v.%I', col);
    END IF;
  END LOOP;

  EXECUTE format(
    'CREATE VIEW public.v_vessel_detail AS SELECT %s FROM public.vessels v '
    || 'WHERE v.is_sanctioned = FALSE '
    || 'OR public.is_admin() OR public.fn_is_vessel_owner(v.id)',
    sel);
END $$;

GRANT SELECT ON public.v_vessel_detail TO authenticated;

-- ── Note ─────────────────────────────────────────────────────
-- vessel_contacts (name/email/phone) is already correctly owner-gated by
-- its existing RLS (claimants + admin only) — left unchanged.
--
-- Commercial INTEL columns (charter_status, tc_expiry, bbc_expiry, pi_club,
-- pi_ig_member, pi_coverage_types, war_risk_trading, war_risk_conditions,
-- preferred_trading_areas) ARE locked here too (per scope decision): the
-- entire commercial card is unreachable via the raw API for non-owner/
-- non-admin. Note: pi_club therefore no longer shows on the availability
-- detail for non-owners.
-- ============================================================
