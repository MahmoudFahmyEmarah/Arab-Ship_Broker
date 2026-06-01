-- Allow broker and active vessel-profile accounts to self-register vessels.
-- This aligns RPC permissions with dashboard access/profile guard behavior.

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
  -- Auth guard
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

  -- Validate required fields
  IF NULLIF(TRIM(payload->>'vessel_name'), '') IS NULL THEN
    RAISE EXCEPTION 'vessel_name is required';
  END IF;

  IF NULLIF(payload->>'vessel_type', '') IS NULL THEN
    RAISE EXCEPTION 'vessel_type is required';
  END IF;

  -- Duplicate IMO guard
  v_imo := NULLIF(TRIM(payload->>'imo_number'), '');
  IF v_imo IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.vessels WHERE imo_number = v_imo) THEN
      RAISE EXCEPTION 'A vessel with IMO number % already exists in the register. If this is your vessel, please contact Arab ShipBroker to claim it.', v_imo;
    END IF;
  END IF;

  -- Insert vessel with safe defaults (admin promotes risk/scope later)
  INSERT INTO public.vessels (
    vessel_name,
    imo_number,
    vessel_type,
    dwt_grain,
    dwt_bale,
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
    NULLIF(TRIM(payload->>'pi_club'),         ''),
    NULLIF(TRIM(payload->>'owner_company'),   ''),
    NULLIF(TRIM(payload->>'owner_country'),   ''),
    NULLIF(TRIM(payload->>'manager_company'), ''),
    NULLIF(TRIM(payload->>'manager_country'), ''),
    NULLIF(TRIM(payload->>'notes'),           ''),
    'In Scope'::public.scope_enum,
    'CLEAR'::public.risk_level_enum,
    FALSE
  )
  RETURNING id INTO v_vessel_id;

  INSERT INTO public.vessel_claims (vessel_id, user_id, role)
  VALUES (v_vessel_id, v_user_id, 'owner');

  RETURN v_vessel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_vessel(JSONB) TO authenticated;
