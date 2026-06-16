-- ════════════════════════════════════════════════════════════════════
-- Cargo multi-port — up to 4 POL / 4 POD with call status  · append-only
--
-- Adds load_ports / disch_ports jsonb to cargo_listings and redefines
-- create_cargo_listing() to persist them. Each is an ordered array
--   [{ "locode","name","zone","country","status" }, …]  (index 0 = primary).
-- The existing single load_port_locode / disch_port_locode (+ load_zone /
-- disch_zone) stay as the PRIMARY port, so existing matching / map / zone logic
-- is unchanged; the jsonb carries the full range. Byte-identical to …000830
-- except the two new columns.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.cargo_listings ADD COLUMN IF NOT EXISTS load_ports  jsonb;
ALTER TABLE public.cargo_listings ADD COLUMN IF NOT EXISTS disch_ports jsonb;

CREATE OR REPLACE FUNCTION public.create_cargo_listing(payload jsonb)
RETURNS public.cargo_listings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_listing public.cargo_listings;
  v_user_id uuid := auth.uid();
  v_tier    public.trust_tier_enum;
  v_random  boolean;
BEGIN
  INSERT INTO public.cargo_listings (
    cargo_type, commodity_id, commodity_name, is_dg_cargo, is_grain_cargo,
    qty_min_mt, qty_max_mt, stowage_factor, volume_cbm,
    load_port_locode, disch_port_locode,
    load_ports, disch_ports,
    laycan_from, laycan_to,
    nor_clause,
    load_rate, disch_rate, load_terms,
    laytime_basis, laytime_structure,
    freight_basis, freight_idea_usd_mt,
    commission_pct, commission_ttl_pct, iac_flag,
    demurrage_rate, despatch_rate, despatch_basis,
    tolerance_pct, tolerance_holder,
    disport_status, packaging_type, css_category, bag_weight_kg,
    broker, notes
  ) VALUES (
    (payload->>'cargo_type')::public.cargo_type_v2_enum,
    (payload->>'commodity_id')::uuid,
     payload->>'commodity_name',
    COALESCE((payload->>'is_dg_cargo')::boolean,  false),
    COALESCE((payload->>'is_grain_cargo')::boolean, false),
    (payload->>'qty_min_mt')::integer,
    (payload->>'qty_max_mt')::integer,
    NULLIF(payload->>'stowage_factor', '')::numeric,
    NULLIF(payload->>'volume_cbm',     '')::integer,
     payload->>'load_port_locode',
     payload->>'disch_port_locode',
     payload->'load_ports',
     payload->'disch_ports',
    (payload->>'laycan_from')::date,
    (payload->>'laycan_to')::date,
    NULLIF(payload->>'nor_clause',       '')::public.nor_clause_enum,
    NULLIF(payload->>'load_rate',        '')::numeric,
    NULLIF(payload->>'disch_rate',       '')::numeric,
    NULLIF(payload->>'load_terms',       '')::public.load_terms_enum,
    NULLIF(payload->>'laytime_basis',    '')::public.laytime_basis_enum,
     payload->>'laytime_structure',
    NULLIF(payload->>'freight_basis',    '')::public.freight_basis_enum,
    NULLIF(payload->>'freight_idea_usd_mt', '')::numeric,
    NULLIF(payload->>'commission_pct',      '')::numeric,
    NULLIF(payload->>'commission_ttl_pct',  '')::numeric,
    COALESCE((payload->>'iac_flag')::boolean, false),
    NULLIF(payload->>'demurrage_rate',   '')::numeric,
    NULLIF(payload->>'despatch_rate',    '')::numeric,
    NULLIF(payload->>'despatch_basis',   '')::public.despatch_basis_enum,
    NULLIF(payload->>'tolerance_pct',    '')::smallint,
    NULLIF(payload->>'tolerance_holder', ''),
    NULLIF(payload->>'disport_status',   '')::public.disport_status_enum,
    NULLIF(payload->>'packaging_type',   '')::public.packaging_type_enum,
    NULLIF(payload->>'css_category',     ''),
    NULLIF(payload->>'bag_weight_kg',    '')::numeric,
     payload->>'broker',
     payload->>'notes'
  ) RETURNING * INTO v_listing;

  INSERT INTO public.listing_ownership
    (listing_type, listing_id, owner_user_id, role, transfer_reason)
  VALUES ('cargo', v_listing.id, v_user_id, 'primary', 'initial_post');

  SELECT trust_tier INTO v_tier
    FROM public.users WHERE id = v_user_id;
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
        WHEN v_random           THEN 'Random sample check'
        ELSE                        'New user'
      END
    );
  END IF;

  RETURN v_listing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_cargo_listing(jsonb) TO authenticated;
