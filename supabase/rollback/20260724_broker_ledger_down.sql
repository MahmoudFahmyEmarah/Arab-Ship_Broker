-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK for the Broker Ledger phase-1 migrations (20260724100000…103000).
-- Run this to undo the schema changes if the rollout must be reverted.
--
--   psql "$DATABASE_URL" -f supabase/rollback/20260724_broker_ledger_down.sql
--
-- Notes:
--   • Postgres cannot drop a single enum VALUE — 'GLAKES' (zone_enum) stays;
--     it is harmless while unused (same for the pre-existing R.SEA.N/S/BALTIC).
--   • Column drops below remove any data captured through the new pages.
--     They are guarded with IF EXISTS and are safe to re-run.
--   • v1 RPCs (create_cargo_listing, register_vessel,
--     create_vessel_availability) were never modified — nothing to restore.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 4d. RPCs ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_cargo_listing_v2(jsonb);
DROP FUNCTION IF EXISTS public.create_vessel_position(jsonb);
DROP FUNCTION IF EXISTS public.search_companies(text, int);
DROP FUNCTION IF EXISTS public.get_company_profile(uuid);
DROP FUNCTION IF EXISTS public.fn_imo_check_digit(text);

-- restore the pre-ledger require-IMO trigger (no TBN exemption)
CREATE OR REPLACE FUNCTION public.require_imo_for_new_vessel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.imo_number := NULLIF(TRIM(NEW.imo_number), '');

  IF NEW.imo_number IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'IMO number is required for new vessels';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4c. columns ─────────────────────────────────────────────────────────────
-- TBN vessels created by the ledger would violate the restored IMO trigger's
-- intent; remove them (cascades their availability + claims).
DELETE FROM public.vessels WHERE is_tbn = true;

-- The masking/list views select v.* at creation time; rebuild them AFTER the
-- column drops (their definitions pin columns).
DROP VIEW IF EXISTS public.v_vessel_detail;
DROP VIEW IF EXISTS public.v_my_vessels;

ALTER TABLE public.vessels
  DROP COLUMN IF EXISTS num_holds,
  DROP COLUMN IF EXISTS num_hatches,
  DROP COLUMN IF EXISTS box_shaped,
  DROP COLUMN IF EXISTS hatch_type,
  DROP COLUMN IF EXISTS strengthened_heavy,
  DROP COLUMN IF EXISTS holds_may_be_empty,
  DROP COLUMN IF EXISTS log_fitted,
  DROP COLUMN IF EXISTS vessel_config,
  DROP COLUMN IF EXISTS beam_m,
  DROP COLUMN IF EXISTS kick_plate,
  DROP COLUMN IF EXISTS hold_details,
  DROP COLUMN IF EXISTS class_society,
  DROP COLUMN IF EXISTS registered_owner,
  DROP COLUMN IF EXISTS parent_group,
  DROP COLUMN IF EXISTS technical_operator,
  DROP COLUMN IF EXISTS disponent_owner,
  DROP COLUMN IF EXISTS is_tbn,
  DROP COLUMN IF EXISTS is_verified,
  DROP COLUMN IF EXISTS source_tag;

ALTER TABLE public.vessel_availability
  DROP COLUMN IF EXISTS charter_type,
  DROP COLUMN IF EXISTS is_wog,
  DROP COLUMN IF EXISTS next_direction,
  DROP COLUMN IF EXISTS trading_zones,
  DROP COLUMN IF EXISTS scrubber_fitted,
  DROP COLUMN IF EXISTS eca_compliant;

ALTER TABLE public.cargo_listings
  DROP COLUMN IF EXISTS rate_mechanism,
  DROP COLUMN IF EXISTS day_exceptions,
  DROP COLUMN IF EXISTS turn_time_hrs,
  DROP COLUMN IF EXISTS laytime_reversible,
  DROP COLUMN IF EXISTS freight_basis,
  DROP COLUMN IF EXISTS despatch_basis,
  DROP COLUMN IF EXISTS iac_flag;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS owns_count,
  DROP COLUMN IF EXISTS manages_comm_count,
  DROP COLUMN IF EXISTS ism_manages_count,
  DROP COLUMN IF EXISTS linked_to_imo,
  DROP COLUMN IF EXISTS link_note,
  DROP COLUMN IF EXISTS link_type,
  DROP COLUMN IF EXISTS source_tag;

-- ── rebuild the two vessel views exactly as 20260713165215 defined them ─────
DO $$
DECLARE
  pii text[] := ARRAY[
    'owner_company','owner_country',
    'manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country',
    'commercial_manager_contact','commercial_manager_email','commercial_manager_phone',
    'pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
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

CREATE VIEW public.v_my_vessels AS
WITH latest_open AS (
  SELECT DISTINCT ON (va.vessel_id)
    va.vessel_id, va.open_port_name, va.open_port_locode, va.open_zone, va.open_date
  FROM public.vessel_availability va
  WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED'
  ORDER BY va.vessel_id, va.created_at DESC
),
open_counts AS (
  SELECT va.vessel_id,
         COUNT(*) FILTER (WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED')
           AS open_availability_count
  FROM public.vessel_availability va
  GROUP BY va.vessel_id
)
SELECT
  v.*,
  vc.user_id,
  vc.role       AS claim_role,
  vc.created_at AS claimed_at,
  COALESCE(oc.open_availability_count, 0)::BIGINT AS open_availability_count,
  lo.open_port_name, lo.open_port_locode, lo.open_zone, lo.open_date
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN open_counts oc ON oc.vessel_id = v.id
LEFT JOIN latest_open lo ON lo.vessel_id = v.id
WHERE vc.user_id = auth.uid();
GRANT SELECT ON public.v_my_vessels TO authenticated;

-- ── 4b. classification reference layer ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.search_commodity_names(text, int);
DROP FUNCTION IF EXISTS public.classify_commodity(text);
DROP FUNCTION IF EXISTS public.fn_classify_commodity(text);
DROP TABLE IF EXISTS public.market_names;
DROP TABLE IF EXISTS public.grain_list;
DROP TABLE IF EXISTS public.imsbc_codes;
DROP TABLE IF EXISTS public.css_categories;
-- cargo_regime_enum is left in place if anything else adopted it; drop only
-- when unused:
DO $$ BEGIN
  DROP TYPE public.cargo_regime_enum;
EXCEPTION WHEN dependent_objects_still_exist THEN NULL;
END $$;

COMMIT;
