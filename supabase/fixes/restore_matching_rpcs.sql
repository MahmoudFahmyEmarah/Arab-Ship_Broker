-- ════════════════════════════════════════════════════════════════════
-- FIX: restore the matching RPCs on the live database
--
-- Symptom 1: "Could not find the function public.get_matches_for_* in the
--            schema cache" → the matching functions are missing, so every
--            match count renders 0 (dashboard, My Vessels, vessel detail).
-- Symptom 2: "type public.cargo_type_v2_enum does not exist" when creating
--            them → the LIVE database stores cargo_type / *_zone / scope /
--            risk_level / load_terms as plain TEXT, not the custom enum types
--            the migrations declare (schema drift).
--
-- This version is therefore TYPE-AGNOSTIC: every column that the migrations
-- type as an enum is returned as TEXT (with an explicit ::text cast in the
-- SELECT). It compiles whether those columns are text OR enums, and the app
-- reads them as strings in both cases. Logic is otherwise byte-identical to
-- supabase/migrations/20260601000704_matching_classifier_dg_block.sql.
--
-- Paste the whole file into the Supabase SQL editor and Run. Idempotent.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_matches_for_cargo(uuid);
DROP FUNCTION IF EXISTS public.get_matches_for_availability(uuid);

CREATE OR REPLACE FUNCTION public.get_matches_for_cargo(
  p_cargo_id uuid
) RETURNS TABLE (
  availability_id       uuid,
  vessel_ref            text,
  vessel_id             uuid,
  vessel_name           text,
  vessel_type           text,
  dwt_grain             integer,
  build_year            smallint,
  flag                  text,
  scope                 text,
  risk_level            text,
  is_geared             boolean,
  grain_certified       boolean,
  dg_certified          boolean,
  open_port_name        text,
  open_zone             text,
  open_date             date,
  open_date_range_days  smallint,
  accepts_part_cargo    boolean,
  freight_idea_usd_mt   numeric,
  is_rate_aligned       boolean,
  dwt_delta             integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cl            public.cargo_listings%ROWTYPE;
  v_current_year  integer := EXTRACT(YEAR FROM NOW())::integer;
BEGIN
  SELECT * INTO v_cl FROM public.cargo_listings WHERE id = p_cargo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo listing not found: %', p_cargo_id;
  END IF;
  IF v_cl.status::text NOT IN ('IN', 'PARTIAL') OR v_cl.review_status::text != 'APPROVED' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    -- vessel_availability has no `ref` column on this database; use the vessel's
    -- IMO number as the vessel reference (SDK treats vessel_ref as nullable text).
    va.id, v.imo_number, v.id, v.vessel_name, v.vessel_type::text, v.dwt_grain,
    v.build_year, v.flag, v.scope::text, v.risk_level::text, v.is_geared, v.grain_certified,
    v.dg_certified, va.open_port_name, va.open_zone::text, va.open_date,
    va.open_date_range_days, va.accepts_part_cargo, va.freight_idea_usd_mt,
    (v_cl.freight_idea_usd_mt IS NOT NULL AND va.freight_idea_usd_mt IS NOT NULL
       AND ABS(v_cl.freight_idea_usd_mt - va.freight_idea_usd_mt) <= 5.0) AS is_rate_aligned,
    ABS(COALESCE(v.dwt_grain, 0) - v_cl.qty_max_mt) AS dwt_delta
  FROM public.vessel_availability va
  JOIN public.vessels v ON v.id = va.vessel_id
  WHERE
    v.is_sanctioned = FALSE
    AND va.status::text = 'OPEN'
    AND va.review_status::text = 'APPROVED'
    AND (va.open_zone::text = v_cl.load_zone::text OR va.open_zone::text = v_cl.disch_zone::text)
    AND v.dwt_grain IS NOT NULL
    AND (
      CASE
        WHEN va.accepts_part_cargo THEN
          v.dwt_grain >= v_cl.qty_min_mt AND v.dwt_grain <= v_cl.qty_max_mt * 1.20 AND v.dwt_grain >= v_cl.qty_max_mt * 0.80
        ELSE
          v.dwt_grain >= v_cl.qty_min_mt AND v.dwt_grain <= v_cl.qty_max_mt * 1.10 AND v.dwt_grain >= v_cl.qty_max_mt * 0.90
      END
    )
    AND (v_cl.cargo_type::text = 'Break Bulk' OR v.vessel_type::text IN ('Bulk Carrier', 'General Cargo'))
    AND (
      v_cl.is_spot = TRUE
      OR (va.open_date IS NOT NULL AND v_cl.laycan_from IS NOT NULL
          AND va.open_date BETWEEN (v_cl.laycan_from - INTERVAL '21 days')::date
                                AND (v_cl.laycan_from + INTERVAL '14 days')::date)
    )
    AND (v_cl.requires_geared IS NULL OR v_cl.requires_geared = FALSE OR v.is_geared = TRUE)
    -- GRAIN hard-block: grain cargo → grain-certified vessel
    AND (v_cl.is_grain_cargo = FALSE OR COALESCE(v.grain_certified, FALSE) = TRUE)
    -- DG hard-block: DG cargo → DG-certified vessel
    AND (v_cl.is_dg_cargo = FALSE OR COALESCE(v.dg_certified, FALSE) = TRUE)
    AND (v_cl.max_vessel_age_yr IS NULL OR v.build_year IS NULL OR (v_current_year - v.build_year::integer) <= v_cl.max_vessel_age_yr)
    AND (v_cl.max_draft_m IS NULL OR v.max_draft_m IS NULL OR v.max_draft_m <= v_cl.max_draft_m)
    AND (v_cl.max_loa_m IS NULL OR v.max_loa_m IS NULL OR v.max_loa_m <= v_cl.max_loa_m)
  ORDER BY is_rate_aligned DESC, dwt_delta ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matches_for_availability(
  p_availability_id uuid
) RETURNS TABLE (
  cargo_id            uuid,
  ref                 text,
  commodity_name      text,
  cargo_type          text,
  qty_min_mt          integer,
  qty_max_mt          integer,
  load_port_name      text,
  load_zone           text,
  disch_port_name     text,
  disch_zone          text,
  laycan_from         date,
  laycan_to           date,
  is_spot             boolean,
  is_grain_cargo      boolean,
  is_dg_cargo         boolean,
  load_terms          text,
  freight_idea_usd_mt numeric,
  requires_geared     boolean,
  max_vessel_age_yr   smallint,
  max_draft_m         numeric,
  max_loa_m           numeric,
  is_rate_aligned     boolean,
  dwt_delta           integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_va           public.vessel_availability%ROWTYPE;
  v_vessel       public.vessels%ROWTYPE;
  v_current_year integer := EXTRACT(YEAR FROM NOW())::integer;
  v_vessel_age   integer;
BEGIN
  SELECT * INTO v_va FROM public.vessel_availability WHERE id = p_availability_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Availability record not found: %', p_availability_id;
  END IF;
  SELECT * INTO v_vessel FROM public.vessels WHERE id = v_va.vessel_id AND is_sanctioned = FALSE;
  IF NOT FOUND THEN RETURN; END IF;
  v_vessel_age := v_current_year - COALESCE(v_vessel.build_year, 0);

  RETURN QUERY
  SELECT
    cl.id, cl.ref, cl.commodity_name, cl.cargo_type::text, cl.qty_min_mt, cl.qty_max_mt,
    cl.load_port_name, cl.load_zone::text, cl.disch_port_name, cl.disch_zone::text,
    cl.laycan_from, cl.laycan_to, cl.is_spot, cl.is_grain_cargo, cl.is_dg_cargo,
    cl.load_terms::text, cl.freight_idea_usd_mt, cl.requires_geared, cl.max_vessel_age_yr,
    cl.max_draft_m, cl.max_loa_m,
    (cl.freight_idea_usd_mt IS NOT NULL AND v_va.freight_idea_usd_mt IS NOT NULL
       AND ABS(cl.freight_idea_usd_mt - v_va.freight_idea_usd_mt) <= 5.0) AS is_rate_aligned,
    ABS(COALESCE(v_vessel.dwt_grain, 0) - cl.qty_max_mt) AS dwt_delta
  FROM public.cargo_listings cl
  WHERE
    cl.review_status::text = 'APPROVED'
    AND cl.status::text IN ('IN', 'PARTIAL')
    AND (v_va.open_zone::text = cl.load_zone::text OR v_va.open_zone::text = cl.disch_zone::text)
    AND v_vessel.dwt_grain IS NOT NULL
    AND (
      CASE
        WHEN v_va.accepts_part_cargo THEN
          v_vessel.dwt_grain >= cl.qty_min_mt AND v_vessel.dwt_grain <= cl.qty_max_mt * 1.20 AND v_vessel.dwt_grain >= cl.qty_max_mt * 0.80
        ELSE
          v_vessel.dwt_grain >= cl.qty_min_mt AND v_vessel.dwt_grain <= cl.qty_max_mt * 1.10 AND v_vessel.dwt_grain >= cl.qty_max_mt * 0.90
      END
    )
    AND (cl.cargo_type::text = 'Break Bulk' OR v_vessel.vessel_type::text IN ('Bulk Carrier', 'General Cargo'))
    AND (
      cl.is_spot = TRUE
      OR (v_va.open_date IS NOT NULL AND cl.laycan_from IS NOT NULL
          AND v_va.open_date BETWEEN (cl.laycan_from - INTERVAL '21 days')::date
                                  AND (cl.laycan_from + INTERVAL '14 days')::date)
    )
    AND (cl.requires_geared IS NULL OR cl.requires_geared = FALSE OR v_vessel.is_geared = TRUE)
    -- GRAIN hard-block: grain cargo → grain-certified vessel
    AND (cl.is_grain_cargo = FALSE OR COALESCE(v_vessel.grain_certified, FALSE) = TRUE)
    -- DG hard-block: DG cargo → DG-certified vessel
    AND (cl.is_dg_cargo = FALSE OR COALESCE(v_vessel.dg_certified, FALSE) = TRUE)
    AND (cl.max_vessel_age_yr IS NULL OR v_vessel.build_year IS NULL OR v_vessel_age <= cl.max_vessel_age_yr)
    AND (cl.max_draft_m IS NULL OR v_vessel.max_draft_m IS NULL OR v_vessel.max_draft_m <= cl.max_draft_m)
    AND (cl.max_loa_m IS NULL OR v_vessel.max_loa_m IS NULL OR v_vessel.max_loa_m <= cl.max_loa_m)
  ORDER BY is_rate_aligned DESC, dwt_delta ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_matches_for_cargo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches_for_availability(uuid) TO authenticated;

-- Force PostgREST to reload its schema cache so the functions resolve immediately.
NOTIFY pgrst, 'reload schema';
