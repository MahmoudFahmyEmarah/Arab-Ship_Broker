-- ════════════════════════════════════════════════════════════════════════
-- Broker Ledger phase 1d: submission + registry RPCs
--
--   1. fn_imo_check_digit          — IMO validity (7 digits + check digit)
--   2. require_imo_for_new_vessel  — amended to skip TBN rows
--   3. create_cargo_listing_v2     — Broker Ledger cargo post
--   4. create_vessel_position      — unified vessel + open-position post
--   5. search_companies / get_company_profile — 03_COMPANIES registry (tiered)
--
-- The v1 RPCs (create_cargo_listing, register_vessel,
-- create_vessel_availability) are left untouched so the legacy pages keep
-- working side-by-side until the Broker Ledger pages are signed off.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. IMO check digit ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_imo_check_digit(p_imo text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_imo ~ '^\d{7}$'
     AND (( substr(p_imo,1,1)::int * 7
          + substr(p_imo,2,1)::int * 6
          + substr(p_imo,3,1)::int * 5
          + substr(p_imo,4,1)::int * 4
          + substr(p_imo,5,1)::int * 3
          + substr(p_imo,6,1)::int * 2) % 10) = substr(p_imo,7,1)::int;
$$;
GRANT EXECUTE ON FUNCTION public.fn_imo_check_digit(text) TO anon, authenticated, service_role;

-- ── 2. Require-IMO trigger: TBN rows are identity-withheld by design ────────
CREATE OR REPLACE FUNCTION public.require_imo_for_new_vessel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.imo_number := NULLIF(TRIM(NEW.imo_number), '');

  -- TBN listings carry full particulars but no identity until fixture.
  IF COALESCE(NEW.is_tbn, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.imo_number IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'IMO number is required for new vessels';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. create_cargo_listing_v2 — Broker Ledger cargo post ───────────────────
-- Same auth / profile / ownership / trust-tier routing as create_cargo_listing,
-- plus: single-quantity + tolerance model, required volume, laycan 45-day cap,
-- rate mechanics, and a server-side classification snapshot (ungated internal
-- resolver — the tier gate applies only to the live readout, not to posting).
CREATE OR REPLACE FUNCTION public.create_cargo_listing_v2(payload jsonb)
RETURNS public.cargo_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing     public.cargo_listings;
  v_user_id     uuid := auth.uid();
  v_app_user_id uuid;
  v_tier        public.trust_tier_enum;
  v_has_profile boolean := false;
  v_random      boolean;
  v_qty         integer;
  v_tol         numeric;
  v_qty_min     integer;
  v_qty_max     integer;
  v_from        date;
  v_to          date;
  v_cls         jsonb;
  v_commodity   public.commodities%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, trust_tier INTO v_app_user_id, v_tier
  FROM public.users
  WHERE id = v_user_id OR supabase_user_id = v_user_id
  ORDER BY (id = v_user_id) DESC
  LIMIT 1;

  IF v_app_user_id IS NULL THEN
    RAISE EXCEPTION 'Application user profile not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE account_id = v_app_user_id
      AND profile_type = 'cargo'::public.profile_type_enum
      AND is_active = true
  ) INTO v_has_profile;

  IF NOT public.fn_is_admin() AND NOT v_has_profile THEN
    RAISE EXCEPTION 'Only users with an active Cargo profile may post cargo';
  END IF;

  -- ── minimum-capture validation ──
  IF NULLIF(TRIM(payload->>'commodity_name'), '') IS NULL THEN
    RAISE EXCEPTION 'commodity_name is required';
  END IF;
  IF payload->>'cargo_type' NOT IN ('Dry Bulk', 'Break Bulk') THEN
    RAISE EXCEPTION 'cargo_type must be Dry Bulk or Break Bulk';
  END IF;

  v_qty := NULLIF(payload->>'qty_mt', '')::integer;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'qty_mt is required';
  END IF;
  v_tol := COALESCE(NULLIF(payload->>'tolerance_pct', '')::numeric, 0);
  IF v_tol < 0 OR v_tol > 25 THEN
    RAISE EXCEPTION 'tolerance_pct must be between 0 and 25';
  END IF;
  v_qty_min := GREATEST(1, ROUND(v_qty * (1 - v_tol / 100.0)))::integer;
  v_qty_max := ROUND(v_qty * (1 + v_tol / 100.0))::integer;

  IF NULLIF(payload->>'volume_cbm', '')::numeric IS NULL THEN
    RAISE EXCEPTION 'volume_cbm is required (stow-check against grain/bale capacity)';
  END IF;

  IF NULLIF(TRIM(payload->>'load_port_locode'), '') IS NULL
     OR NULLIF(TRIM(payload->>'disch_port_locode'), '') IS NULL THEN
    RAISE EXCEPTION 'load and discharge ports are required';
  END IF;

  v_from := NULLIF(payload->>'laycan_from', '')::date;
  v_to   := NULLIF(payload->>'laycan_to', '')::date;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'laycan_from is required';
  END IF;
  IF v_to IS NOT NULL AND v_to < v_from THEN
    RAISE EXCEPTION 'laycan_to is before laycan_from';
  END IF;
  IF v_to IS NOT NULL AND (v_to - v_from) > 45 THEN
    RAISE EXCEPTION 'laycan spread exceeds the 45-day cap';
  END IF;

  -- ── classification snapshot (platform resolves; never blocks posting) ──
  v_cls := public.fn_classify_commodity(TRIM(payload->>'commodity_name'));

  SELECT * INTO v_commodity
  FROM public.commodities c
  WHERE c.is_active
    AND (lower(c.canonical_name) = lower(TRIM(payload->>'commodity_name'))
         OR lower(TRIM(payload->>'commodity_name')) = ANY (
              SELECT lower(a) FROM unnest(coalesce(c.display_aliases, '{}')) a))
  LIMIT 1;

  INSERT INTO public.cargo_listings (
    cargo_type, commodity_id, commodity_name, is_dg_cargo, is_grain_cargo,
    qty_min_mt, qty_max_mt, tolerance_pct, tolerance_holder,
    stowage_factor, volume_cbm, volume_m3,
    packaging_type, css_category,
    load_port_locode, disch_port_locode,
    load_rate, disch_rate, rate_mechanism, day_exceptions,
    turn_time_hrs, laytime_reversible,
    laycan_from, laycan_to, is_spot, nor_clause,
    freight_idea_usd_mt, freight_basis, despatch_basis,
    commission_ttl_pct, iac_flag, broker, notes
  ) VALUES (
    (payload->>'cargo_type')::public.cargo_type_enum,
    v_commodity.id,
    TRIM(payload->>'commodity_name'),
    COALESCE((v_cls->>'is_dg')::boolean, v_commodity.is_dg, false),
    COALESCE((v_cls->>'is_grain')::boolean, v_commodity.is_grain, false),
    v_qty_min,
    v_qty_max,
    NULLIF(v_tol, 0)::smallint,
    NULLIF(payload->>'tolerance_holder', ''),
    v_commodity.default_sf_m3t,
    NULLIF(payload->>'volume_cbm', '')::numeric,
    NULLIF(payload->>'volume_cbm', '')::numeric,
    UPPER(TRIM(payload->>'load_port_locode')),
    UPPER(TRIM(payload->>'disch_port_locode')),
    NULLIF(payload->>'load_rate', ''),
    NULLIF(payload->>'disch_rate', ''),
    NULLIF(payload->>'rate_mechanism', ''),
    NULLIF(payload->>'day_exceptions', ''),
    NULLIF(payload->>'turn_time_hrs', '')::numeric,
    NULLIF(payload->>'laytime_reversible', ''),
    v_from,
    v_to,
    COALESCE((payload->>'is_spot')::boolean, false),
    NULLIF(payload->>'nor_clause', ''),
    NULLIF(payload->>'freight_idea_usd_mt', '')::numeric,
    NULLIF(payload->>'freight_basis', ''),
    NULLIF(payload->>'despatch_basis', ''),
    NULLIF(payload->>'commission_ttl_pct', '')::numeric,
    COALESCE((payload->>'iac_flag')::boolean, false),
    NULLIF(TRIM(payload->>'broker'), ''),
    NULLIF(TRIM(payload->>'notes'), '')
  )
  RETURNING * INTO v_listing;

  -- CSS category from the snapshot when the commodity resolves break-bulk
  IF v_cls->>'css_category' IS NOT NULL AND v_listing.css_category IS NULL THEN
    UPDATE public.cargo_listings SET css_category = v_cls->>'css_category'
    WHERE id = v_listing.id
    RETURNING * INTO v_listing;
  END IF;

  INSERT INTO public.listing_ownership
    (listing_type, listing_id, owner_user_id, role, transfer_reason)
  VALUES
    ('cargo', v_listing.id, v_app_user_id, 'primary', 'initial_post');

  v_tier := COALESCE(v_tier, 'NEW'::public.trust_tier_enum);
  v_random := v_tier = 'VERIFIED' AND random() < 0.1;

  IF v_tier = 'VERIFIED' AND NOT v_random THEN
    UPDATE public.cargo_listings
    SET review_status = 'APPROVED', goes_live_at = now()
    WHERE id = v_listing.id
    RETURNING * INTO v_listing;
  ELSE
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by, trust_tier_at_submit,
      is_random_sample, review_reason
    ) VALUES (
      'cargo', v_listing.id, v_app_user_id, v_tier, v_random,
      CASE
        WHEN v_tier = 'FLAGGED' THEN 'Flagged account'
        WHEN v_random THEN 'Random sample check'
        ELSE 'New user'
      END
    );
  END IF;

  RETURN v_listing;
END;
$$;

REVOKE ALL ON FUNCTION public.create_cargo_listing_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cargo_listing_v2(jsonb)
  TO authenticated, service_role;

-- ── 4. create_vessel_position — unified vessel + open position ──────────────
-- One transaction: resolve the vessel (fleet pick / minimal new / TBN),
-- apply user-confirmed particulars, insert the availability, ownership and
-- trust-tier review routing (mirrors create_vessel_availability).
-- Size gate: ≤ 66,000 DWT (QC-13, locked 08 Jul 2026) — hard at post time.
CREATE OR REPLACE FUNCTION public.create_vessel_position(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_size_gate_dwt CONSTANT integer := 66000;

  v_user_id     uuid := auth.uid();
  v_app_role    text;
  v_has_profile boolean := false;
  v_mode        text := COALESCE(payload->>'entry_mode', 'fleet');
  v_vessel      public.vessels%ROWTYPE;
  v_imo         text;
  v_dwt         integer;
  v_av          public.vessel_availability;
  v_arr         jsonb := payload->'arrangement';
  v_gear        jsonb := payload->'gear';
  v_own         jsonb := payload->'ownership';
  v_perf        jsonb := payload->'performance';
  v_avail       jsonb := payload->'availability';
  v_apply_user  boolean;
  v_tier        public.trust_tier_enum;
  v_random      boolean;
  v_yn          text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_app_role
  FROM public.users WHERE supabase_user_id = v_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.profiles p ON p.account_id = u.id
    WHERE u.supabase_user_id = v_user_id
      AND p.profile_type = 'vessel'::public.profile_type_enum
      AND p.is_active = TRUE
  ) INTO v_has_profile;

  IF COALESCE(v_app_role, '') NOT IN ('vessel_owner', 'broker', 'admin')
     AND NOT v_has_profile THEN
    RAISE EXCEPTION 'Only users with an active Vessel profile may post positions';
  END IF;

  IF v_avail IS NULL OR NULLIF(v_avail->>'open_port_locode', '') IS NULL
     OR NULLIF(v_avail->>'open_from', '') IS NULL
     OR NULLIF(v_avail->>'status', '') IS NULL THEN
    RAISE EXCEPTION 'availability status, open_port_locode and open_from are required';
  END IF;

  -- ── resolve the vessel ──
  IF v_mode = 'fleet' THEN
    SELECT * INTO v_vessel FROM public.vessels
    WHERE id = NULLIF(payload->>'vessel_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vessel not found';
    END IF;

  ELSIF v_mode = 'new' THEN
    v_imo := NULLIF(TRIM(payload->'vessel'->>'imo'), '');
    IF v_imo IS NULL OR NOT public.fn_imo_check_digit(v_imo) THEN
      RAISE EXCEPTION 'A valid 7-digit IMO number is required';
    END IF;
    IF NULLIF(TRIM(payload->'vessel'->>'name'), '') IS NULL THEN
      RAISE EXCEPTION 'vessel name is required';
    END IF;

    -- Build once, reuse forever: an existing IMO joins the registry record.
    SELECT * INTO v_vessel FROM public.vessels WHERE imo_number = v_imo;
    IF NOT FOUND THEN
      INSERT INTO public.vessels (
        vessel_name, imo_number, vessel_type,
        dwt_grain, build_year, flag, max_loa_m, gross_tonnage, class_society,
        scope, risk_level, is_sanctioned, is_verified, source_tag
      ) VALUES (
        UPPER(TRIM(payload->'vessel'->>'name')),
        v_imo,
        CASE WHEN payload->'vessel'->>'type' = 'Cargo Ship'
             THEN 'General Cargo' ELSE payload->'vessel'->>'type' END::public.vessel_type_enum,
        NULLIF(payload->'vessel'->>'dwt', '')::integer,
        NULLIF(payload->'vessel'->>'built', '')::smallint,
        NULLIF(TRIM(payload->'vessel'->>'flag'), ''),
        NULLIF(payload->'vessel'->>'loa_m', '')::numeric,
        NULLIF(payload->'vessel'->>'grt', '')::integer,
        NULLIF(TRIM(payload->'vessel'->>'class_society'), ''),
        'In Scope'::public.scope_enum, 'CLEAR'::public.risk_level_enum,
        FALSE, FALSE, 'user'
      )
      RETURNING * INTO v_vessel;
    END IF;

  ELSIF v_mode = 'tbn' THEN
    IF NULLIF(payload->'tbn'->>'type', '') IS NULL
       OR NULLIF(payload->'tbn'->>'dwt', '') IS NULL
       OR NULLIF(TRIM(payload->'tbn'->>'flag'), '') IS NULL THEN
      RAISE EXCEPTION 'TBN requires vessel type, DWT and flag';
    END IF;
    INSERT INTO public.vessels (
      vessel_name, imo_number, vessel_type,
      dwt_grain, build_year, flag, max_loa_m, beam_m, max_draft_m,
      gross_tonnage, class_society,
      scope, risk_level, is_sanctioned, is_tbn, is_verified, source_tag
    ) VALUES (
      'TBN', NULL,
      CASE WHEN payload->'tbn'->>'type' = 'Cargo Ship'
           THEN 'General Cargo' ELSE payload->'tbn'->>'type' END::public.vessel_type_enum,
      NULLIF(payload->'tbn'->>'dwt', '')::integer,
      NULLIF(payload->'tbn'->>'built', '')::smallint,
      NULLIF(TRIM(payload->'tbn'->>'flag'), ''),
      NULLIF(payload->'tbn'->>'loa_m', '')::numeric,
      NULLIF(payload->'tbn'->>'beam_m', '')::numeric,
      NULLIF(payload->'tbn'->>'draft_m', '')::numeric,
      NULLIF(payload->'tbn'->>'grt', '')::integer,
      NULLIF(TRIM(payload->'tbn'->>'class_society'), ''),
      'In Scope'::public.scope_enum, 'CLEAR'::public.risk_level_enum,
      FALSE, TRUE, FALSE, 'user'
    )
    RETURNING * INTO v_vessel;

  ELSE
    RAISE EXCEPTION 'entry_mode must be fleet, new or tbn';
  END IF;

  IF v_vessel.is_sanctioned THEN
    RAISE EXCEPTION 'This vessel is sanctioned and cannot have a position posted.';
  END IF;

  -- ── niche size gate (soft-warned in the UI, hard here) ──
  v_dwt := COALESCE(NULLIF(payload->'vessel'->>'dwt', '')::integer,
                    NULLIF(payload->'tbn'->>'dwt', '')::integer,
                    v_vessel.dwt_grain);
  IF v_dwt IS NOT NULL AND v_dwt > c_size_gate_dwt THEN
    RAISE EXCEPTION 'SIZE_GATE: at % MT this vessel is over the % DWT niche gate',
      v_dwt, c_size_gate_dwt USING ERRCODE = 'P0422';
  END IF;

  -- ── claim (idempotent) — the poster manages this vessel ──
  INSERT INTO public.vessel_claims (vessel_id, user_id, role)
  VALUES (v_vessel.id, v_user_id, 'owner')
  ON CONFLICT (vessel_id, user_id) DO NOTHING;

  -- ── apply user-confirmed particulars to the vessel record ──
  -- _source='user' means typed/adjusted by the poster. Verified registry data
  -- is only back-filled (COALESCE keeps existing), never overwritten;
  -- unverified records take the user's values.
  v_apply_user := (v_arr->>'_source' = 'user') OR v_mode IN ('new', 'tbn');
  IF v_apply_user AND v_arr IS NOT NULL THEN
    -- Verified registry data: back-fill NULLs only. Unverified: user wins,
    -- but a missing payload key never clears an existing value.
    UPDATE public.vessels SET
      vessel_config      = CASE WHEN v_vessel.is_verified THEN COALESCE(vessel_config, NULLIF(v_arr->>'config','')) ELSE COALESCE(NULLIF(v_arr->>'config',''), vessel_config) END,
      num_holds          = CASE WHEN v_vessel.is_verified THEN COALESCE(num_holds, NULLIF(v_arr->>'num_holds','')::smallint) ELSE COALESCE(NULLIF(v_arr->>'num_holds','')::smallint, num_holds) END,
      num_hatches        = CASE WHEN v_vessel.is_verified THEN COALESCE(num_hatches, NULLIF(v_arr->>'num_hatches','')::smallint) ELSE COALESCE(NULLIF(v_arr->>'num_hatches','')::smallint, NULLIF(v_arr->>'num_holds','')::smallint, num_hatches) END,
      box_shaped         = CASE WHEN v_vessel.is_verified THEN COALESCE(box_shaped, (v_arr->>'box_shaped')::boolean) ELSE COALESCE((v_arr->>'box_shaped')::boolean, box_shaped) END,
      hatch_type         = CASE WHEN v_vessel.is_verified THEN COALESCE(hatch_type, NULLIF(v_arr->>'hatch_type','')) ELSE COALESCE(NULLIF(v_arr->>'hatch_type',''), hatch_type) END,
      strengthened_heavy = CASE WHEN v_vessel.is_verified THEN COALESCE(strengthened_heavy, (v_arr->>'strengthened_heavy')::boolean) ELSE COALESCE((v_arr->>'strengthened_heavy')::boolean, strengthened_heavy) END,
      holds_may_be_empty = CASE WHEN v_vessel.is_verified THEN COALESCE(holds_may_be_empty, NULLIF(v_arr->>'holds_may_be_empty','')) ELSE COALESCE(NULLIF(v_arr->>'holds_may_be_empty',''), holds_may_be_empty) END,
      log_fitted         = CASE WHEN v_vessel.is_verified THEN COALESCE(log_fitted, (v_arr->>'log_fitted')::boolean) ELSE COALESCE((v_arr->>'log_fitted')::boolean, log_fitted) END
    WHERE id = v_vessel.id;
  END IF;

  IF ((v_gear->>'_source' = 'user') OR v_mode IN ('new', 'tbn')) AND v_gear IS NOT NULL THEN
    IF NULLIF(v_gear->>'crane_count', '') IS NOT NULL
       AND (v_gear->>'crane_count')::int > 4 THEN
      RAISE EXCEPTION 'Maximum 4 cranes / derricks (Q88 contract cap)';
    END IF;
    IF NULLIF(v_gear->>'num_grabs', '') IS NOT NULL
       AND (v_gear->>'num_grabs')::int > 5 THEN
      RAISE EXCEPTION 'Maximum 5 grabs (Q88 contract cap)';
    END IF;
    UPDATE public.vessels SET
      is_geared    = CASE WHEN v_vessel.is_verified THEN COALESCE(is_geared, (v_gear->>'geared')::boolean) ELSE COALESCE((v_gear->>'geared')::boolean, is_geared) END,
      crane_count  = CASE WHEN v_vessel.is_verified THEN COALESCE(crane_count, NULLIF(v_gear->>'crane_count','')::smallint) ELSE COALESCE(NULLIF(v_gear->>'crane_count','')::smallint, crane_count) END,
      crane_swl_mt = CASE WHEN v_vessel.is_verified THEN COALESCE(crane_swl_mt, NULLIF(v_gear->>'crane_swl','')::numeric) ELSE COALESCE(NULLIF(v_gear->>'crane_swl','')::numeric, crane_swl_mt) END,
      kick_plate   = CASE WHEN v_vessel.is_verified THEN COALESCE(kick_plate, (v_gear->>'kick_plate')::boolean) ELSE COALESCE((v_gear->>'kick_plate')::boolean, kick_plate) END
    WHERE id = v_vessel.id;
  END IF;

  IF v_own IS NOT NULL THEN
    UPDATE public.vessels SET
      registered_owner   = COALESCE(NULLIF(TRIM(v_own->>'registered_owner'), ''), registered_owner),
      parent_group       = COALESCE(NULLIF(TRIM(v_own->>'parent_group'), ''), parent_group),
      technical_operator = COALESCE(NULLIF(TRIM(v_own->>'technical_operator'), ''), technical_operator),
      manager_company    = COALESCE(NULLIF(TRIM(v_own->>'commercial_operator'), ''), manager_company),
      disponent_owner    = COALESCE(NULLIF(TRIM(v_own->>'disponent_owner'), ''), disponent_owner)
    WHERE id = v_vessel.id;
  END IF;

  -- ── the open position ──
  INSERT INTO public.vessel_availability (
    vessel_id, status, charter_type,
    open_port_locode, open_date, is_wog, next_direction, trading_zones,
    service_speed_kn, fuel_type,
    me_consumption_mt_day, me_consumption_port_mt_day, aux_consumption_port_mt_day,
    brob_mt, scrubber_fitted, eca_compliant,
    num_grabs, grab_capacity_mt, notes
  ) VALUES (
    v_vessel.id,
    UPPER(v_avail->>'status')::public.vessel_status_enum,
    NULLIF(v_avail->>'charter_type', ''),
    UPPER(TRIM(v_avail->>'open_port_locode')),
    (v_avail->>'open_from')::date,
    COALESCE((v_avail->>'wog')::boolean, false),
    NULLIF(TRIM(v_avail->>'next_direction'), ''),
    CASE WHEN jsonb_typeof(v_avail->'trading_zones') = 'array'
          AND jsonb_array_length(v_avail->'trading_zones') > 0
      THEN ARRAY(SELECT z::public.zone_enum
                 FROM jsonb_array_elements_text(v_avail->'trading_zones') AS z
                 WHERE NULLIF(TRIM(z), '') IS NOT NULL)
      ELSE NULL END,
    NULLIF(v_perf->>'service_speed_kn', '')::numeric,
    NULLIF(v_perf->>'fuel_type', ''),
    NULLIF(v_perf->>'me_cons_sea', '')::numeric,
    NULLIF(v_perf->>'me_cons_port', '')::numeric,
    NULLIF(v_perf->>'aux_cons_port', '')::numeric,
    NULLIF(v_perf->>'brob_mt', '')::numeric,
    (v_perf->>'scrubber')::boolean,
    (v_perf->>'eca')::boolean,
    NULLIF(v_gear->>'num_grabs', '')::smallint,
    NULLIF(v_gear->>'grab_capacity', '')::numeric,
    NULLIF(TRIM(payload->>'notes'), '')
  )
  RETURNING * INTO v_av;

  INSERT INTO public.listing_ownership (listing_type, listing_id, owner_user_id, role, transfer_reason)
  VALUES ('vessel_availability', v_av.id, v_user_id, 'primary', 'initial_post');

  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_user_id;
  v_random := (random() < 0.1);

  IF v_vessel.risk_level = 'HIGH' OR v_tier IS DISTINCT FROM 'VERIFIED' OR v_random THEN
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by, trust_tier_at_submit, is_random_sample, review_reason
    ) VALUES (
      'vessel_availability', v_av.id, v_user_id, v_tier, v_random,
      CASE
        WHEN v_vessel.risk_level = 'HIGH' THEN 'HIGH risk vessel'
        WHEN v_tier = 'FLAGGED'           THEN 'Flagged account'
        WHEN v_random                     THEN 'Random sample check'
        ELSE                                   'New user'
      END
    );
  ELSE
    UPDATE public.vessel_availability
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = v_av.id;
    SELECT * INTO v_av FROM public.vessel_availability WHERE id = v_av.id;
  END IF;

  RETURN jsonb_build_object(
    'vessel_id', v_vessel.id,
    'availability_id', v_av.id,
    'ref', v_av.ref,
    'review_status', v_av.review_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_vessel_position(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vessel_position(jsonb)
  TO authenticated, service_role;

-- ── 5. Company registry (03_COMPANIES) — search + tier-gated profile ────────
-- The list view exposes only non-contact reference fields; full profiles
-- (address, desk contacts, links) are Tier 3/4 (README_HANDOFF §5, enforced
-- server-side — never rely on the client gate).
CREATE OR REPLACE FUNCTION public.search_companies(p_q text, p_limit int DEFAULT 25)
RETURNS TABLE(id uuid, name text, country text, imo text, fleet_total integer,
              owns_count integer, manages_comm_count integer, ism_manages_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id, o.name, o.country, o.imo, o.fleet_total,
         o.owns_count, o.manages_comm_count, o.ism_manages_count
  FROM public.organizations o
  WHERE length(btrim(coalesce(p_q, ''))) >= 2
    AND o.name ILIKE '%' || btrim(p_q) || '%'
  ORDER BY (lower(o.name) LIKE lower(btrim(p_q)) || '%') DESC, o.name
  LIMIT greatest(1, least(coalesce(p_limit, 25), 60));
$$;

REVOKE ALL ON FUNCTION public.search_companies(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_companies(text, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_company_profile(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tier    public.subscription_tier_enum;
  v_org     public.organizations%ROWTYPE;
  v_full    boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT subscription_tier INTO v_tier
  FROM public.users
  WHERE id = v_user_id OR supabase_user_id = v_user_id
  ORDER BY (id = v_user_id) DESC
  LIMIT 1;

  v_full := public.fn_is_admin() OR coalesce(v_tier::text, 'T1') IN ('T3', 'T4');

  RETURN jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'country', v_org.country,
    'imo', v_org.imo,
    'fleet_total', v_org.fleet_total,
    'owns_count', v_org.owns_count,
    'manages_comm_count', v_org.manages_comm_count,
    'ism_manages_count', v_org.ism_manages_count,
    'gated', NOT v_full
  ) || CASE WHEN v_full THEN jsonb_build_object(
    'address', v_org.address,
    'desk_contact_name', v_org.desk_contact_name,
    'desk_email', v_org.desk_email,
    'desk_phone', v_org.desk_phone,
    'linked_to_imo', v_org.linked_to_imo,
    'link_note', v_org.link_note,
    'link_type', v_org.link_type
  ) ELSE '{}'::jsonb END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_profile(uuid) TO authenticated, service_role;
