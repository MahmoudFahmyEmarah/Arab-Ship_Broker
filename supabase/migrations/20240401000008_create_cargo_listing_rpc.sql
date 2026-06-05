CREATE OR REPLACE FUNCTION public.create_cargo_listing(
  payload jsonb
) RETURNS public.cargo_listings
LANGUAGE plpgsql
SECURITY DEFINER -- Elevates privileges to bypass the Catch-22
SET search_path = public
AS $$
DECLARE
  v_listing public.cargo_listings;
  v_user_id uuid := auth.uid();
BEGIN
  -- 1. Insert the cargo listing mapping ALL fields from the frontend payload
  INSERT INTO public.cargo_listings (
    cargo_type, 
    commodity_id, 
    commodity_name, 
    is_dg_cargo,
    is_grain_cargo,
    qty_min_mt, 
    qty_max_mt, 
    stowage_factor,
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

  -- 2. Insert the ownership record securely so RLS and triggers work
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

  -- 3. Return the fully created listing to the frontend
  RETURN v_listing;
END;
$$;