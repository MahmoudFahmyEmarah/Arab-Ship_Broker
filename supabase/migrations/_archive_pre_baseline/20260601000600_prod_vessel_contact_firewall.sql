-- ════════════════════════════════════════════════════════════════════
-- PROD vessel contact firewall (NON-NEGOTIABLE)  ·  append-only
--
-- Enforces the contact firewall against PRODUCTION's *actual* vessels
-- schema. The earlier …000100/000200 firewall migrations target the
-- migration-schema column names (commercial_manager_*, tc_charterer_*) and
-- gate on vessel_claims — none of which exist in prod — so they cannot be
-- applied as-is. This is the prod-accurate equivalent.
--
-- Rule: a non-admin, non-owner must NEVER receive counterparty identity /
-- contact — not in the UI and NOT via raw API. Enforced two ways:
--   1) base-table column REVOKE/GRANT  → raw select of PII = permission denied
--   2) masked view v_vessel_detail gated on admin OR the vessel's own owner.
--
-- Prod state at write time: vessels are broker-imported with NO user-owner
-- (listing_ownership / ownership_claims are empty), so this resolves to
-- ADMIN-ONLY today; fn_owns_vessel() begins returning true the moment a user
-- owns a vessel (current primary listing_ownership on its availability).
--
-- ⚠️ DO NOT APPLY until: (audit E) no other view/RPC reads vessels PII, and
-- every PII-reading app path (admin vessel pages + vessel-detail) reads via
-- v_vessel_detail. Rollback = re-GRANT SELECT ON vessels + DROP VIEW.
-- Assumes the admin predicate is public.fn_is_admin() (confirm via audit A).
-- ════════════════════════════════════════════════════════════════════

-- 1) Owner check — prod ownership model. SECURITY DEFINER so it can read
--    listing_ownership while only ever testing the caller's own rows.
CREATE OR REPLACE FUNCTION public.fn_owns_vessel(p_vessel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listing_ownership lo
    JOIN public.vessel_availability va ON va.id = lo.listing_id
    WHERE va.vessel_id = p_vessel_id
      AND lo.listing_type = 'vessel_availability'
      AND lo.owner_user_id = auth.uid()
      AND lo.is_current = true
      AND lo.role = 'primary'
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_owns_vessel(uuid) TO authenticated;

-- 2) Lock the 12 contact/identity columns at the base table: revoke blanket
--    SELECT, re-grant only the 31 NON-PII columns. Raw select of any PII
--    column now errors for anon + authenticated (incl. admin via base table —
--    admin reads PII through the view in step 3).
REVOKE SELECT ON public.vessels FROM anon, authenticated;
GRANT SELECT (
  id, vessel_name, imo_number, vessel_type, dwt_grain, dwt_bale, build_year,
  flag, flag_category, scope, risk_level, risk_notes, preferred_zones,
  trading_zone_raw, is_geared, crane_count, crane_swl_mt, grain_certified,
  dg_certified, max_loa_m, max_draft_m, pi_club, is_sanctioned, notes,
  created_at, updated_at, dwcc, grain_cbm, bale_cbm, lat, lng
) ON public.vessels TO anon, authenticated;

-- 3) Masked detail view — every column; the 12 PII columns NULLed unless
--    admin or the vessel's own owner. Runs with the view owner's rights, so
--    it can read the now-revoked columns and apply the gate. The WHERE
--    preserves the "hide sanctioned from non-admin" behaviour.
DROP VIEW IF EXISTS public.v_vessel_detail;
CREATE VIEW public.v_vessel_detail AS
SELECT
  v.id, v.vessel_name, v.imo_number, v.vessel_type, v.dwt_grain, v.dwt_bale,
  v.build_year, v.flag, v.flag_category, v.scope, v.risk_level, v.risk_notes,
  v.preferred_zones, v.trading_zone_raw, v.is_geared, v.crane_count,
  v.crane_swl_mt, v.grain_certified, v.dg_certified, v.max_loa_m, v.max_draft_m,
  v.pi_club, v.is_sanctioned, v.notes, v.created_at, v.updated_at, v.dwcc,
  v.grain_cbm, v.bale_cbm, v.lat, v.lng,
  CASE WHEN g THEN v.owner_company    END AS owner_company,
  CASE WHEN g THEN v.owner_country    END AS owner_country,
  CASE WHEN g THEN v.owner_address    END AS owner_address,
  CASE WHEN g THEN v.manager_company  END AS manager_company,
  CASE WHEN g THEN v.manager_country  END AS manager_country,
  CASE WHEN g THEN v.manager_address  END AS manager_address,
  CASE WHEN g THEN v.pic_name         END AS pic_name,
  CASE WHEN g THEN v.pic_role         END AS pic_role,
  CASE WHEN g THEN v.phone            END AS phone,
  CASE WHEN g THEN v.email_general    END AS email_general,
  CASE WHEN g THEN v.email_chartering END AS email_chartering,
  CASE WHEN g THEN v.website          END AS website
FROM public.vessels v
CROSS JOIN LATERAL (
  SELECT (public.fn_is_admin() OR public.fn_owns_vessel(v.id)) AS g
) gate
WHERE NOT v.is_sanctioned OR public.fn_is_admin();

GRANT SELECT ON public.v_vessel_detail TO authenticated;
