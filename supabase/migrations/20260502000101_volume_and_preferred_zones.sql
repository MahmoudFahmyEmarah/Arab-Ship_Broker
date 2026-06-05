-- ── 1. Schema changes ─────────────────────────────────────────

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS bale_cbm INTEGER CHECK (bale_cbm > 0);

ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS volume_cbm INTEGER CHECK (volume_cbm > 0);

COMMENT ON COLUMN public.vessels.grain_cbm IS
  'Grain cubic capacity of all holds combined (m³ / cbm). '
  'Used to verify cargo volume fits: volume = qty_mt × stowage_factor.';

COMMENT ON COLUMN public.vessels.bale_cbm IS
  'Bale cubic capacity (m³ / cbm). Used for break-bulk and bagged cargo.';

COMMENT ON COLUMN public.cargo_listings.volume_cbm IS
  'Total cargo volume in cubic metres (cbm). '
  'Typically = qty_max_mt × stowage_factor. Stored for matching/display.';


-- ── 2. register_vessel — add grain_cbm, bale_cbm, preferred_zones ──

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
    -- ── NEW: cubic capacities ──────────────────
    grain_cbm,
    bale_cbm,
    -- ───────────────────────────────────────────
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
    -- ── NEW: structured zone preferences ───────
    preferred_zones,
    -- ───────────────────────────────────────────
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
    -- grain_cbm
    NULLIF(payload->>'grain_cbm',  '')::INTEGER,
    -- bale_cbm
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
    -- preferred_zones: cast each element to zone_enum
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

GRANT EXECUTE ON FUNCTION public.register_vessel(JSONB) TO authenticated;


-- ── 3. create_cargo_listing — add volume_cbm ──────────────────

CREATE OR REPLACE FUNCTION public.create_cargo_listing(
  payload jsonb
) RETURNS public.cargo_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing   public.cargo_listings;
  v_user_id   uuid := auth.uid();
  v_tier      public.trust_tier_enum;
  v_random    boolean;
BEGIN
  INSERT INTO public.cargo_listings (
    cargo_type,
    commodity_id,
    commodity_name,
    is_dg_cargo,
    is_grain_cargo,
    qty_min_mt,
    qty_max_mt,
    stowage_factor,
    -- ── NEW ──────────────────────────────────
    volume_cbm,
    -- ─────────────────────────────────────────
    load_port_locode,
    disch_port_locode,
    laycan_from,
    laycan_to,
    load_rate,
    disch_rate,
    load_terms,
    laytime_structure,
    freight_idea_usd_mt,
    commission_pct,
    demurrage_rate,
    despatch_rate,
    broker,
    notes
  ) VALUES (
    (payload->>'cargo_type')::public.cargo_type_v2_enum,
    (payload->>'commodity_id')::uuid,
    payload->>'commodity_name',
    COALESCE((payload->>'is_dg_cargo')::boolean, false),
    COALESCE((payload->>'is_grain_cargo')::boolean, false),
    (payload->>'qty_min_mt')::integer,
    (payload->>'qty_max_mt')::integer,
    (payload->>'stowage_factor')::numeric,
    -- volume_cbm (nullable integer)
    NULLIF(payload->>'volume_cbm', '')::integer,
    payload->>'load_port_locode',
    payload->>'disch_port_locode',
    (payload->>'laycan_from')::date,
    (payload->>'laycan_to')::date,
    payload->>'load_rate',
    payload->>'disch_rate',
    (payload->>'load_terms')::public.load_terms_enum,
    payload->>'laytime_structure',
    (payload->>'freight_idea_usd_mt')::numeric,
    (payload->>'commission_pct')::numeric,
    (payload->>'demurrage_rate')::numeric,
    (payload->>'despatch_rate')::numeric,
    payload->>'broker',
    payload->>'notes'
  )
  RETURNING * INTO v_listing;

  INSERT INTO public.listing_ownership (
    listing_type,
    listing_id,
    owner_user_id,
    role,
    transfer_reason
  ) VALUES (
    'cargo',
    v_listing.id,
    v_user_id,
    'primary',
    'initial_post'
  );

  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_user_id;
  v_random := (RANDOM() < 0.1);

  IF v_tier = 'VERIFIED' AND NOT v_random THEN
    UPDATE public.cargo_listings
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = v_listing.id;
    SELECT * INTO v_listing FROM public.cargo_listings WHERE id = v_listing.id;
  ELSE
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by,
      trust_tier_at_submit, is_random_sample, review_reason
    ) VALUES (
      'cargo', v_listing.id, v_user_id, v_tier, v_random,
      CASE
        WHEN v_tier = 'FLAGGED' THEN 'Flagged account'
        WHEN v_random            THEN 'Random sample check'
        ELSE                          'New user'
      END
    );
  END IF;

  RETURN v_listing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_cargo_listing(jsonb) TO authenticated;