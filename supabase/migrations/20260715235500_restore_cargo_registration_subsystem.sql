-- Restore portal cargo posting against the post-baseline schema.
-- All additions are nullable so existing cargo rows remain valid and unchanged.

ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS volume_cbm numeric(10,2),
  ADD COLUMN IF NOT EXISTS packaging_type text,
  ADD COLUMN IF NOT EXISTS css_category text,
  ADD COLUMN IF NOT EXISTS bag_weight_kg numeric(8,2),
  ADD COLUMN IF NOT EXISTS tolerance_pct smallint,
  ADD COLUMN IF NOT EXISTS tolerance_holder text,
  ADD COLUMN IF NOT EXISTS laytime_basis text,
  ADD COLUMN IF NOT EXISTS commission_ttl_pct numeric(4,2),
  ADD COLUMN IF NOT EXISTS load_ports jsonb,
  ADD COLUMN IF NOT EXISTS disch_ports jsonb;

CREATE OR REPLACE FUNCTION public.create_cargo_listing(payload jsonb)
RETURNS public.cargo_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing                  public.cargo_listings;
  v_user_id                  uuid := auth.uid();
  v_app_user_id              uuid;
  v_tier                     public.trust_tier_enum;
  v_has_active_cargo_profile boolean := false;
  v_random                   boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, trust_tier
    INTO v_app_user_id, v_tier
  FROM public.users
  WHERE id = v_user_id OR supabase_user_id = v_user_id
  ORDER BY (id = v_user_id) DESC
  LIMIT 1;

  IF v_app_user_id IS NULL THEN
    RAISE EXCEPTION 'Application user profile not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE account_id = v_app_user_id
      AND profile_type = 'cargo'::public.profile_type_enum
      AND is_active = true
  ) INTO v_has_active_cargo_profile;

  IF NOT public.fn_is_admin() AND NOT v_has_active_cargo_profile THEN
    RAISE EXCEPTION 'Only users with an active Cargo profile may post cargo';
  END IF;

  IF NULLIF(TRIM(payload->>'commodity_name'), '') IS NULL THEN
    RAISE EXCEPTION 'commodity_name is required';
  END IF;
  IF NULLIF(payload->>'cargo_type', '') IS NULL THEN
    RAISE EXCEPTION 'cargo_type is required';
  END IF;
  IF NULLIF(payload->>'qty_min_mt', '') IS NULL
     OR NULLIF(payload->>'qty_max_mt', '') IS NULL THEN
    RAISE EXCEPTION 'cargo quantity range is required';
  END IF;
  IF NULLIF(TRIM(payload->>'load_port_locode'), '') IS NULL
     OR NULLIF(TRIM(payload->>'disch_port_locode'), '') IS NULL THEN
    RAISE EXCEPTION 'load and discharge ports are required';
  END IF;

  INSERT INTO public.cargo_listings (
    cargo_type, commodity_id, commodity_name, is_dg_cargo, is_grain_cargo,
    qty_min_mt, qty_max_mt, stowage_factor, volume_cbm, volume_m3,
    load_port_locode, disch_port_locode, load_ports, disch_ports,
    laycan_from, laycan_to, load_rate, disch_rate, load_terms,
    laytime_basis, laytime_structure, freight_idea_usd_mt,
    commission_pct, commission_ttl_pct, demurrage_rate, despatch_rate,
    tolerance_pct, tolerance_holder, packaging_type, css_category,
    bag_weight_kg, broker, notes
  ) VALUES (
    (payload->>'cargo_type')::public.cargo_type_enum,
    NULLIF(payload->>'commodity_id', '')::uuid,
    TRIM(payload->>'commodity_name'),
    COALESCE(NULLIF(payload->>'is_dg_cargo', '')::boolean, false),
    COALESCE(NULLIF(payload->>'is_grain_cargo', '')::boolean, false),
    (payload->>'qty_min_mt')::integer,
    (payload->>'qty_max_mt')::integer,
    NULLIF(payload->>'stowage_factor', '')::numeric,
    NULLIF(payload->>'volume_cbm', '')::numeric,
    NULLIF(payload->>'volume_cbm', '')::numeric,
    UPPER(TRIM(payload->>'load_port_locode')),
    UPPER(TRIM(payload->>'disch_port_locode')),
    CASE WHEN jsonb_typeof(payload->'load_ports') = 'array'
         THEN payload->'load_ports' ELSE NULL END,
    CASE WHEN jsonb_typeof(payload->'disch_ports') = 'array'
         THEN payload->'disch_ports' ELSE NULL END,
    NULLIF(payload->>'laycan_from', '')::date,
    NULLIF(payload->>'laycan_to', '')::date,
    NULLIF(payload->>'load_rate', ''),
    NULLIF(payload->>'disch_rate', ''),
    NULLIF(payload->>'load_terms', '')::public.load_terms_enum,
    NULLIF(payload->>'laytime_basis', ''),
    NULLIF(payload->>'laytime_structure', ''),
    NULLIF(payload->>'freight_idea_usd_mt', '')::numeric,
    NULLIF(payload->>'commission_pct', '')::numeric,
    NULLIF(payload->>'commission_ttl_pct', '')::numeric,
    NULLIF(payload->>'demurrage_rate', '')::numeric,
    NULLIF(payload->>'despatch_rate', '')::numeric,
    NULLIF(payload->>'tolerance_pct', '')::smallint,
    NULLIF(payload->>'tolerance_holder', ''),
    NULLIF(payload->>'packaging_type', ''),
    NULLIF(payload->>'css_category', ''),
    NULLIF(payload->>'bag_weight_kg', '')::numeric,
    NULLIF(TRIM(payload->>'broker'), ''),
    NULLIF(TRIM(payload->>'notes'), '')
  )
  RETURNING * INTO v_listing;

  INSERT INTO public.listing_ownership
    (listing_type, listing_id, owner_user_id, role, transfer_reason)
  VALUES
    ('cargo', v_listing.id, v_app_user_id, 'primary', 'initial_post');

  -- The baseline AFTER INSERT routing trigger runs before ownership exists, so
  -- route here after creating ownership. This preserves the established trust
  -- tier and random-review behaviour without changing existing triggers.
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

REVOKE ALL ON FUNCTION public.create_cargo_listing(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cargo_listing(jsonb)
  TO authenticated, service_role;
