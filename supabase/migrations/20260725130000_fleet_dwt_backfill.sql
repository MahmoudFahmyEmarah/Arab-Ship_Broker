-- Fleet-mode DWT backfill for create_vessel_position (user-reported dead
-- end): 18 legacy registry vessels have no DWT and their card is read-only,
-- so the Vessel section could never complete. The ledger now shows a
-- fill-the-gap DWT input for such picks; this migration accepts
-- payload.dwt_backfill_mt, writes it to vessels.dwt_grain ONLY when the
-- stored value is NULL, and includes it in the 66k size-gate check.
-- Function otherwise identical to 20260724103000.

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

  -- Fill-the-gap: a registry record without DWT can be completed at post time
  -- (DWT is THE matching figure; 18 legacy rows lack it). Backfill only when
  -- the stored value is NULL — a recorded DWT is never overwritten.
  IF v_mode = 'fleet' AND v_vessel.dwt_grain IS NULL
     AND NULLIF(payload->>'dwt_backfill_mt', '') IS NOT NULL THEN
    UPDATE public.vessels
    SET dwt_grain = (payload->>'dwt_backfill_mt')::integer
    WHERE id = v_vessel.id AND dwt_grain IS NULL;
    v_vessel.dwt_grain := (payload->>'dwt_backfill_mt')::integer;
  END IF;

  -- ── niche size gate (soft-warned in the UI, hard here) ──
  v_dwt := COALESCE(NULLIF(payload->'vessel'->>'dwt', '')::integer,
                    NULLIF(payload->'tbn'->>'dwt', '')::integer,
                    NULLIF(payload->>'dwt_backfill_mt', '')::integer,
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
