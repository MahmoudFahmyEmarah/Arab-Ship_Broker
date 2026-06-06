-- ════════════════════════════════════════════════════════════════════
-- Vessel GT + SCNRT — persist two strongly-recommended tonnages · append-only
--
-- GT (gross_tonnage) already existed as a column but was never persisted by
-- register_vessel (dropped at the SDK + RPC layers). SCNRT (Suez Canal Net
-- Registered Tonnage, the figure Suez dues are charged on) had no column.
-- This adds scnrt, widens the GT check to the real sub-66K range, persists both
-- through register_vessel, and grants them as readable NON-PII specs (no contact
-- data — the contact firewall is untouched).
-- ════════════════════════════════════════════════════════════════════

-- 1) Columns + sane ranges. (gross_tonnage exists; its old CHECK capped at
--    15,000 which a real supramax exceeds — widen so persisted GT is valid.)
ALTER TABLE public.vessels ADD COLUMN IF NOT EXISTS scnrt INTEGER;

ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_gross_tonnage_check;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_gross_tonnage_check
    CHECK (gross_tonnage IS NULL OR (gross_tonnage BETWEEN 200 AND 80000));
ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_scnrt_check;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_scnrt_check
    CHECK (scnrt IS NULL OR (scnrt BETWEEN 100 AND 80000));

-- 2) Make them readable as specs (additive GRANT only — these are NOT contact
--    PII, so this cannot weaken the …000600 contact firewall).
GRANT SELECT (gross_tonnage, scnrt) ON public.vessels TO anon, authenticated;

-- 3) register_vessel — faithful copy of the …000502 definition with exactly two
--    added inserted columns: gross_tonnage and scnrt (right after dwt_bale).
CREATE OR REPLACE FUNCTION public.register_vessel(payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id                    UUID := auth.uid();
  v_vessel_id                  UUID;
  v_imo                        TEXT;
  v_app_role                   TEXT;
  v_has_active_vessel_profile  BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_app_role
  FROM public.users
  WHERE supabase_user_id = v_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.profiles p ON p.account_id = u.id
    WHERE u.supabase_user_id = v_user_id
      AND p.profile_type = 'vessel'::public.profile_type_enum
      AND p.is_active = TRUE
  )
  INTO v_has_active_vessel_profile;

  IF COALESCE(v_app_role, '') NOT IN ('vessel_owner', 'broker', 'admin')
     AND NOT v_has_active_vessel_profile THEN
    RAISE EXCEPTION 'Only users with an active Vessel profile may register vessels';
  END IF;

  IF NULLIF(TRIM(payload->>'vessel_name'), '') IS NULL THEN
    RAISE EXCEPTION 'vessel_name is required';
  END IF;

  IF NULLIF(payload->>'vessel_type', '') IS NULL THEN
    RAISE EXCEPTION 'vessel_type is required';
  END IF;

  v_imo := NULLIF(TRIM(payload->>'imo_number'), '');
  IF v_imo IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.vessels WHERE imo_number = v_imo) THEN
      RAISE EXCEPTION
        'A vessel with IMO number % already exists in the register. '
        'If this is your vessel, please contact Arab ShipBroker to claim it.',
        v_imo;
    END IF;
  END IF;

  INSERT INTO public.vessels (
    vessel_name,
    imo_number,
    vessel_type,
    dwt_grain,
    dwt_bale,
    gross_tonnage,
    scnrt,
    grain_cbm,
    bale_cbm,
    build_year,
    flag,
    flag_category,
    is_geared,
    crane_count,
    crane_swl_mt,
    grain_certified,
    dg_certified,
    max_loa_m,
    max_draft_m,
    pi_club,
    owner_company,
    owner_country,
    manager_company,
    manager_country,
    commercial_manager_company,
    commercial_manager_country,
    commercial_manager_contact,
    commercial_manager_email,
    commercial_manager_phone,
    charter_status,
    tc_charterer_name,
    tc_expiry,
    bbc_charterer_name,
    bbc_expiry,
    pi_ig_member,
    pi_coverage_types,
    war_risk_trading,
    war_risk_conditions,
    preferred_trading_areas,
    preferred_zones,
    notes,
    scope,
    risk_level,
    is_sanctioned
  ) VALUES (
    TRIM(payload->>'vessel_name'),
    v_imo,
    (payload->>'vessel_type')::public.vessel_type_enum,
    NULLIF(payload->>'dwt_grain',  '')::INTEGER,
    NULLIF(payload->>'dwt_bale',   '')::INTEGER,
    NULLIF(payload->>'gross_tonnage', '')::INTEGER,
    NULLIF(payload->>'scnrt',         '')::INTEGER,
    NULLIF(payload->>'grain_cbm',  '')::INTEGER,
    NULLIF(payload->>'bale_cbm',   '')::INTEGER,
    NULLIF(payload->>'build_year', '')::SMALLINT,
    NULLIF(TRIM(payload->>'flag'), ''),
    NULLIF(payload->>'flag_category', '')::public.flag_category_enum,
    CASE
      WHEN payload->>'is_geared' = 'true'  THEN TRUE
      WHEN payload->>'is_geared' = 'false' THEN FALSE
      ELSE NULL
    END,
    NULLIF(payload->>'crane_count',  '')::SMALLINT,
    NULLIF(payload->>'crane_swl_mt', '')::NUMERIC,
    CASE
      WHEN payload->>'grain_certified' = 'true'  THEN TRUE
      WHEN payload->>'grain_certified' = 'false' THEN FALSE
      ELSE NULL
    END,
    CASE
      WHEN payload->>'dg_certified' = 'true'  THEN TRUE
      WHEN payload->>'dg_certified' = 'false' THEN FALSE
      ELSE NULL
    END,
    NULLIF(payload->>'max_loa_m',  '')::NUMERIC,
    NULLIF(payload->>'max_draft_m','')::NUMERIC,
    NULLIF(TRIM(payload->>'pi_club'), ''),
    NULLIF(TRIM(payload->>'owner_company'), ''),
    NULLIF(TRIM(payload->>'owner_country'), ''),
    NULLIF(TRIM(payload->>'manager_company'), ''),
    NULLIF(TRIM(payload->>'manager_country'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_company'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_country'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_contact'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_email'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_phone'), ''),
    NULLIF(TRIM(payload->>'charter_status'), ''),
    NULLIF(TRIM(payload->>'tc_charterer_name'), ''),
    NULLIF(payload->>'tc_expiry', '')::DATE,
    NULLIF(TRIM(payload->>'bbc_charterer_name'), ''),
    NULLIF(payload->>'bbc_expiry', '')::DATE,
    CASE
      WHEN payload->>'pi_ig_member' = 'true'  THEN TRUE
      WHEN payload->>'pi_ig_member' = 'false' THEN FALSE
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(payload->'pi_coverage_types') = 'array'
       AND jsonb_array_length(payload->'pi_coverage_types') > 0
      THEN ARRAY(
        SELECT TRIM(v)
        FROM jsonb_array_elements_text(payload->'pi_coverage_types') AS v
        WHERE NULLIF(TRIM(v), '') IS NOT NULL
      )
      ELSE NULL
    END,
    NULLIF(TRIM(payload->>'war_risk_trading'), ''),
    NULLIF(TRIM(payload->>'war_risk_conditions'), ''),
    CASE
      WHEN jsonb_typeof(payload->'preferred_trading_areas') = 'array'
       AND jsonb_array_length(payload->'preferred_trading_areas') > 0
      THEN ARRAY(
        SELECT TRIM(v)
        FROM jsonb_array_elements_text(payload->'preferred_trading_areas') AS v
        WHERE NULLIF(TRIM(v), '') IS NOT NULL
      )
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(payload->'preferred_zones') = 'array'
       AND jsonb_array_length(payload->'preferred_zones') > 0
      THEN ARRAY(
        SELECT z::public.zone_enum
        FROM jsonb_array_elements_text(payload->'preferred_zones') AS z
        WHERE NULLIF(TRIM(z), '') IS NOT NULL
      )
      ELSE NULL
    END,
    NULLIF(TRIM(payload->>'notes'), ''),
    'In Scope'::public.scope_enum,
    'CLEAR'::public.risk_level_enum,
    FALSE
  )
  RETURNING id INTO v_vessel_id;

  INSERT INTO public.vessel_claims (vessel_id, user_id, role)
  VALUES (v_vessel_id, v_user_id, 'owner');

  IF jsonb_typeof(payload->'persons_in_charge') = 'array' THEN
    INSERT INTO public.vessel_contacts (vessel_id, name, role, email, phone)
    SELECT
      v_vessel_id,
      NULLIF(TRIM(pic->>'name'), ''),
      COALESCE(NULLIF(TRIM(pic->>'role'), ''), 'Other'),
      NULLIF(TRIM(pic->>'email'), ''),
      NULLIF(TRIM(pic->>'phone'), '')
    FROM jsonb_array_elements(payload->'persons_in_charge') AS pic
    WHERE NULLIF(TRIM(pic->>'name'), '') IS NOT NULL;
  END IF;

  RETURN v_vessel_id;
END;
$$;
