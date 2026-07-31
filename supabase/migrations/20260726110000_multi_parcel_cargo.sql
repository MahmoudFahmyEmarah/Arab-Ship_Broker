-- Multi-parcel cargo postings (Option C, user-approved 26 Jul).
-- Doctrine per the workbook QC rules: each parcel is its own cargo listing so
-- the platform classifies and matches every parcel independently. A posting
-- with N parcels inserts N cargo_listings rows in ONE transaction sharing a
-- freshly minted cargo_group_id (uuid column + partial index already in the
-- baseline), with the lane / laycan / commercial terms copied to every row
-- and per-parcel commodity / quantity / tolerance / volume / packaging /
-- classification snapshot.
--
-- Backward compatible: a payload without `parcels` (or with one entry)
-- behaves exactly as before — single row, cargo_group_id stays NULL.
-- Function returns the FIRST parcel's row (unchanged return type).

CREATE OR REPLACE FUNCTION public.create_cargo_listing_v2(payload jsonb)
RETURNS public.cargo_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first       public.cargo_listings;
  v_listing     public.cargo_listings;
  v_user_id     uuid := auth.uid();
  v_app_user_id uuid;
  v_tier        public.trust_tier_enum;
  v_has_profile boolean := false;
  v_random      boolean;
  v_parcels     jsonb;
  v_parcel      jsonb;
  v_group_id    uuid;
  v_idx         integer := 0;
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

  -- ── shared (posting-level) validation ──
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

  -- ── parcels: explicit array, or a single parcel from the legacy keys ──
  IF jsonb_typeof(payload->'parcels') = 'array' AND jsonb_array_length(payload->'parcels') > 0 THEN
    v_parcels := payload->'parcels';
  ELSE
    v_parcels := jsonb_build_array(jsonb_build_object(
      'commodity_name',   payload->>'commodity_name',
      'cargo_type',       payload->>'cargo_type',
      'qty_mt',           payload->>'qty_mt',
      'tolerance_pct',    payload->>'tolerance_pct',
      'tolerance_holder', payload->>'tolerance_holder',
      'volume_cbm',       payload->>'volume_cbm',
      'packaging_type',   payload->>'packaging_type'
    ));
  END IF;

  IF jsonb_array_length(v_parcels) > 12 THEN
    RAISE EXCEPTION 'A posting may carry at most 12 parcels';
  END IF;
  IF jsonb_array_length(v_parcels) > 1 THEN
    v_group_id := gen_random_uuid();
  END IF;

  v_tier := COALESCE(v_tier, 'NEW'::public.trust_tier_enum);

  FOR v_parcel IN SELECT * FROM jsonb_array_elements(v_parcels) LOOP
    -- ── per-parcel validation ──
    IF NULLIF(TRIM(v_parcel->>'commodity_name'), '') IS NULL THEN
      RAISE EXCEPTION 'Parcel %: commodity_name is required', v_idx + 1;
    END IF;
    IF v_parcel->>'cargo_type' NOT IN ('Dry Bulk', 'Break Bulk') THEN
      RAISE EXCEPTION 'Parcel %: cargo_type must be Dry Bulk or Break Bulk', v_idx + 1;
    END IF;
    v_qty := NULLIF(v_parcel->>'qty_mt', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Parcel %: qty_mt is required', v_idx + 1;
    END IF;
    v_tol := COALESCE(NULLIF(v_parcel->>'tolerance_pct', '')::numeric, 0);
    IF v_tol < 0 OR v_tol > 25 THEN
      RAISE EXCEPTION 'Parcel %: tolerance_pct must be between 0 and 25', v_idx + 1;
    END IF;
    v_qty_min := GREATEST(1, ROUND(v_qty * (1 - v_tol / 100.0)))::integer;
    v_qty_max := ROUND(v_qty * (1 + v_tol / 100.0))::integer;
    IF NULLIF(v_parcel->>'volume_cbm', '')::numeric IS NULL THEN
      RAISE EXCEPTION 'Parcel %: volume_cbm is required (stow-check)', v_idx + 1;
    END IF;

    -- ── per-parcel classification snapshot (never blocks posting) ──
    v_cls := public.fn_classify_commodity(TRIM(v_parcel->>'commodity_name'));

    v_commodity := NULL;
    SELECT * INTO v_commodity
    FROM public.commodities c
    WHERE c.is_active
      AND lower(c.canonical_name) = lower(TRIM(v_parcel->>'commodity_name'))
    LIMIT 1;
    IF v_commodity.id IS NULL THEN
      SELECT * INTO v_commodity
      FROM public.commodities c
      WHERE c.is_active
        AND lower(TRIM(v_parcel->>'commodity_name')) = ANY (
              SELECT lower(a) FROM unnest(coalesce(c.display_aliases, '{}')) a)
      LIMIT 1;
    END IF;

    INSERT INTO public.cargo_listings (
      cargo_group_id,
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
      v_group_id,
      (v_parcel->>'cargo_type')::public.cargo_type_enum,
      v_commodity.id,
      TRIM(v_parcel->>'commodity_name'),
      COALESCE((v_cls->>'is_dg')::boolean, v_commodity.is_dg, false),
      COALESCE((v_cls->>'is_grain')::boolean, v_commodity.is_grain, false),
      v_qty_min,
      v_qty_max,
      NULLIF(v_tol, 0),
      NULLIF(v_parcel->>'tolerance_holder', ''),
      v_commodity.default_sf_m3t,
      NULLIF(v_parcel->>'volume_cbm', '')::numeric,
      NULLIF(v_parcel->>'volume_cbm', '')::numeric,
      NULLIF(v_parcel->>'packaging_type', ''),
      v_cls->>'css_category',
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

    INSERT INTO public.listing_ownership
      (listing_type, listing_id, owner_user_id, role, transfer_reason)
    VALUES
      ('cargo', v_listing.id, v_app_user_id, 'primary', 'initial_post');

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

    IF v_idx = 0 THEN
      v_first := v_listing;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_first;
END;
$$;

REVOKE ALL ON FUNCTION public.create_cargo_listing_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cargo_listing_v2(jsonb)
  TO authenticated, service_role;
