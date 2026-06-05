ALTER TABLE public.cargo_listings
  ALTER COLUMN load_rate TYPE NUMERIC
    USING (
      CASE
        WHEN load_rate ~ '^\s*[0-9]+(\.[0-9]+)?'
        THEN (regexp_match(load_rate, '^\s*([0-9]+(\.[0-9]+)?)'))[1]::NUMERIC
        ELSE NULL
      END
    ),
  ALTER COLUMN disch_rate TYPE NUMERIC
    USING (
      CASE
        WHEN disch_rate ~ '^\s*[0-9]+(\.[0-9]+)?'
        THEN (regexp_match(disch_rate, '^\s*([0-9]+(\.[0-9]+)?)'))[1]::NUMERIC
        ELSE NULL
      END
    );

-- 1b. Drop old constraints before re-adding
ALTER TABLE public.cargo_listings
  DROP CONSTRAINT IF EXISTS cargo_listings_qty_min_mt_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_qty_max_mt_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_volume_cbm_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_stowage_factor_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_load_rate_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_disch_rate_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_freight_idea_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_commission_pct_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_commission_ttl_pct_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_despatch_rate_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_laycan_window_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_ports_differ_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_tolerance_pct_check,
  DROP CONSTRAINT IF EXISTS cargo_listings_bag_weight_check;

-- 1c. Quantity: 100–250,000 MT (ROW 13)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_qty_min_mt_check
    CHECK (qty_min_mt BETWEEN 100 AND 250000),
  ADD CONSTRAINT cargo_listings_qty_max_mt_check
    CHECK (qty_max_mt BETWEEN 100 AND 250000);

-- 1d. Volume CBM: 100–150,000 (ROW 12)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_volume_cbm_check
    CHECK (volume_cbm IS NULL OR (volume_cbm BETWEEN 100 AND 150000));

-- 1e. Stowage factor stored as ft³/LT: 10–90 (ROW 14/83)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_stowage_factor_check
    CHECK (stowage_factor IS NULL OR (stowage_factor BETWEEN 10 AND 90));

-- 1f. Load/discharge rate: 200–8,000 MT/day (ROW 20/21/81/82)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_load_rate_check
    CHECK (load_rate IS NULL OR (load_rate BETWEEN 200 AND 8000)),
  ADD CONSTRAINT cargo_listings_disch_rate_check
    CHECK (disch_rate IS NULL OR (disch_rate BETWEEN 200 AND 8000));

-- 1g. Freight idea: 1–500 USD/MT (ROW 24)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_freight_idea_check
    CHECK (freight_idea_usd_mt IS NULL OR (freight_idea_usd_mt BETWEEN 1 AND 500));

-- 1h. Despatch rate: 0–10,000 USD/day (ROW 91)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_despatch_rate_check
    CHECK (despatch_rate IS NULL OR (despatch_rate BETWEEN 0 AND 10000));

-- 1i. Laycan window ≤ 45 days (ROW 63)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_laycan_window_check
    CHECK (
      laycan_from IS NULL OR laycan_to IS NULL
      OR (laycan_to - laycan_from) <= 45
    );

-- 1j. POL ≠ POD (ROW 16)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_ports_differ_check
    CHECK (
      load_port_locode IS NULL OR disch_port_locode IS NULL
      OR load_port_locode <> disch_port_locode
    );


-- ── New columns on cargo_listings ────────────────────────────────────────────

-- ROW 93 — Commission TTL % (0–5, step 0.25)
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS commission_ttl_pct NUMERIC(5,2)
    CHECK (commission_ttl_pct IS NULL OR (commission_ttl_pct BETWEEN 0 AND 5));

-- ROW 89 — Laytime basis
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'laytime_basis_enum') THEN
    CREATE TYPE public.laytime_basis_enum AS ENUM (
      'PWWD SHINC','PWWD SHEX','PWWD FHEX','PDPR'
    );
  END IF;
END $$;
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS laytime_basis public.laytime_basis_enum;

-- ROW 90 — Freight basis
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'freight_basis_enum') THEN
    CREATE TYPE public.freight_basis_enum AS ENUM (
      'Per MT','Per Revenue Tonne','Lumpsum','BSS 1/1','To be agreed'
    );
  END IF;
END $$;
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS freight_basis public.freight_basis_enum;

-- ROW 92 — Despatch basis
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'despatch_basis_enum') THEN
    CREATE TYPE public.despatch_basis_enum AS ENUM (
      'DHDATSBE','DHWTSBE','FDA','FDATE'
    );
  END IF;
END $$;
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS despatch_basis public.despatch_basis_enum;

-- ROW 23 — NOR clause
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nor_clause_enum') THEN
    CREATE TYPE public.nor_clause_enum AS ENUM (
      'WIBON','WIPON','WCCON','EIU','EIUU'
    );
  END IF;
END $$;
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS nor_clause public.nor_clause_enum;

-- ROW 94 — IAC flag
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS iac_flag BOOLEAN DEFAULT FALSE;

-- ROW 62 — Disport status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disport_status_enum') THEN
    CREATE TYPE public.disport_status_enum AS ENUM (
      'Confirmed','Indicated','TBA'
    );
  END IF;
END $$;
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS disport_status public.disport_status_enum;

-- ROW 64 — Packaging type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'packaging_type_enum') THEN
    CREATE TYPE public.packaging_type_enum AS ENUM (
      'Bulk','Bagged','Breakbulk','Containerised','Other'
    );
  END IF;
END $$;
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS packaging_type public.packaging_type_enum;

-- ROW 65 — Bag weight (kg)
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS bag_weight_kg NUMERIC(8,2);

-- ROW 86 — Tolerance (2 fields)
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS tolerance_pct SMALLINT,
  ADD COLUMN IF NOT EXISTS tolerance_holder TEXT
    CHECK (tolerance_holder IS NULL OR tolerance_holder IN ('MOLOO','MOLCHOPT'));

-- 1k. Tolerance 0–10% (ROW 86)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_tolerance_pct_check
    CHECK (tolerance_pct IS NULL OR (tolerance_pct BETWEEN 0 AND 10));

-- 1l. Bag weight 10–1,500 kg (ROW 65)
ALTER TABLE public.cargo_listings
  ADD CONSTRAINT cargo_listings_bag_weight_check
    CHECK (bag_weight_kg IS NULL OR (bag_weight_kg BETWEEN 10 AND 1500));


-- ── 2. VESSELS ───────────────────────────────────────────────────────────────

ALTER TABLE public.vessels
  DROP CONSTRAINT IF EXISTS vessels_dwt_grain_check,
  DROP CONSTRAINT IF EXISTS vessels_dwt_bale_check,
  DROP CONSTRAINT IF EXISTS vessels_dwcc_check,
  DROP CONSTRAINT IF EXISTS vessels_grain_cbm_check,
  DROP CONSTRAINT IF EXISTS vessels_bale_cbm_check,
  DROP CONSTRAINT IF EXISTS vessels_gross_tonnage_check,
  DROP CONSTRAINT IF EXISTS vessels_beam_check,
  DROP CONSTRAINT IF EXISTS vessels_build_year_check,
  DROP CONSTRAINT IF EXISTS vessels_max_loa_m_check,
  DROP CONSTRAINT IF EXISTS vessels_max_draft_m_check,
  DROP CONSTRAINT IF EXISTS vessels_crane_swl_check,
  DROP CONSTRAINT IF EXISTS vessels_crane_count_check,
  DROP CONSTRAINT IF EXISTS vessels_dwcc_lt_dwt_check;

-- Ensure columns exist before applying constraints
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS gross_tonnage INTEGER,
  ADD COLUMN IF NOT EXISTS bale_cbm INTEGER;

-- ROW 27 — DWT 500–15,000
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_dwt_grain_check
    CHECK (dwt_grain IS NULL OR (dwt_grain BETWEEN 500 AND 15000)),
  ADD CONSTRAINT vessels_dwt_bale_check
    CHECK (dwt_bale IS NULL OR (dwt_bale BETWEEN 500 AND 15000));

-- ROW 28/84 — Grain/bale CBM 500–20,000
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_grain_cbm_check
    CHECK (grain_cbm IS NULL OR (grain_cbm BETWEEN 500 AND 20000)),
  ADD CONSTRAINT vessels_bale_cbm_check
    CHECK (bale_cbm IS NULL OR (bale_cbm BETWEEN 500 AND 20000));

-- ROW 29 — GRT 200–15,000
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_gross_tonnage_check
    CHECK (gross_tonnage IS NULL OR (gross_tonnage BETWEEN 200 AND 15000));

-- ROW 35 — Beam 6–40 m
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS beam_m NUMERIC(5,2);
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_beam_check
    CHECK (beam_m IS NULL OR (beam_m BETWEEN 6 AND 40));

-- ROW 68 — DWCC + cross-field < DWT
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS dwcc INTEGER;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_dwcc_check
    CHECK (dwcc IS NULL OR dwcc > 0),
  ADD CONSTRAINT vessels_dwcc_lt_dwt_check
    CHECK (dwcc IS NULL OR dwt_grain IS NULL OR dwcc < dwt_grain);

-- ROW 34 — Build year 1970–current
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_build_year_check
    CHECK (build_year IS NULL
           OR (build_year BETWEEN 1970 AND EXTRACT(YEAR FROM NOW())::INT + 1));

-- ROW 30 — LOA 40–200 m
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_max_loa_m_check
    CHECK (max_loa_m IS NULL OR (max_loa_m BETWEEN 40 AND 200));

-- ROW 73 — Draft 2–14 m
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_max_draft_m_check
    CHECK (max_draft_m IS NULL OR (max_draft_m BETWEEN 2 AND 14));

-- ROW 75 — Crane SWL 5–50 t
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_crane_swl_check
    CHECK (crane_swl_mt IS NULL OR (crane_swl_mt BETWEEN 5 AND 50));

-- ROW 76 — Crane count 1–6
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_crane_count_check
    CHECK (crane_count IS NULL OR (crane_count BETWEEN 1 AND 6));


-- ── 3. VESSEL AVAILABILITY ───────────────────────────────────────────────────

ALTER TABLE public.vessel_availability
  DROP CONSTRAINT IF EXISTS vessel_availability_open_date_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_open_date_range_days_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_service_speed_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_me_consumption_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_aux_consumption_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_grab_capacity_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_num_grabs_check,
  DROP CONSTRAINT IF EXISTS vessel_availability_brob_check;

-- ROW 38 — open_date >= today
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_open_date_check
    CHECK (open_date IS NULL OR open_date >= CURRENT_DATE);

-- ROW 39 — flexibility 0–30 days
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_open_date_range_days_check
    CHECK (open_date_range_days BETWEEN 0 AND 30);

-- ROW 41 — service speed 6–18 kn
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_service_speed_check
    CHECK (service_speed_kn IS NULL OR (service_speed_kn BETWEEN 6 AND 18));

-- ROW 42 — M/E consumption 1–40 MT/day
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_me_consumption_check
    CHECK (me_consumption_mt_day IS NULL OR (me_consumption_mt_day BETWEEN 1 AND 40));

-- ROW 74 — Aux consumption 0.5–8 MT/day
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_aux_consumption_check
    CHECK (aux_consumption_mt_day IS NULL OR (aux_consumption_mt_day BETWEEN 0.5 AND 8));

-- ROW 95 — Grab type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grab_type_enum') THEN
    CREATE TYPE public.grab_type_enum AS ENUM (
      'Mechanical Clamshell','Orange Peel','None'
    );
  END IF;
END $$;
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS grab_type public.grab_type_enum;

-- ROW 96 — Grab capacity 3–20 t
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS grab_capacity_mt NUMERIC(5,1);
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_grab_capacity_check
    CHECK (grab_capacity_mt IS NULL OR (grab_capacity_mt BETWEEN 3 AND 20));

-- ROW 97 — Number of grabs 1–4
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS num_grabs SMALLINT;
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_num_grabs_check
    CHECK (num_grabs IS NULL OR (num_grabs BETWEEN 1 AND 4));

-- ROW 77 — BROB 0–2,000 MT
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS brob_mt NUMERIC(8,2);
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_brob_check
    CHECK (brob_mt IS NULL OR (brob_mt BETWEEN 0 AND 2000));


-- ── 4. PORTS ─────────────────────────────────────────────────────────────────

-- ROW 47 — port max_draft 2–20 m
ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS max_draft NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS water_density NUMERIC(5,3);

ALTER TABLE public.ports
  DROP CONSTRAINT IF EXISTS ports_max_draft_check;
ALTER TABLE public.ports
  ADD CONSTRAINT ports_max_draft_check
    CHECK (max_draft IS NULL OR (max_draft BETWEEN 2 AND 20));

-- ROW 48 — water density 1.000–1.030
ALTER TABLE public.ports
  DROP CONSTRAINT IF EXISTS ports_water_density_check;
ALTER TABLE public.ports
  ADD CONSTRAINT ports_water_density_check
    CHECK (water_density IS NULL OR (water_density BETWEEN 1.000 AND 1.030));


-- ── 5. v_account_profiles — strip admin-only fields ──────────────────────────

DROP VIEW IF EXISTS public.v_account_profiles;

CREATE OR REPLACE VIEW public.v_account_profiles AS
SELECT
  u.id               AS account_id,
  u.supabase_user_id,
  u.full_name,
  u.email,
  u.trust_tier,   -- kept internally for auto-approval; NOT shown in regular user UI
  u.is_active,
  -- clean_posts and strike_count deliberately EXCLUDED (admin-only)
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.account_id = u.id AND p.profile_type = 'cargo' AND p.is_active = TRUE
  ) AS has_cargo_profile,
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.account_id = u.id AND p.profile_type = 'vessel' AND p.is_active = TRUE
  ) AS has_vessel_profile,
  ARRAY(
    SELECT p.profile_type FROM public.profiles p
    WHERE p.account_id = u.id AND p.is_active = TRUE
    ORDER BY p.profile_type
  ) AS active_profiles
FROM public.users u;

GRANT SELECT ON public.v_account_profiles TO authenticated;


-- ── 6. create_cargo_listing RPC — add all new fields ─────────────────────────

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
    laycan_from, laycan_to,
    nor_clause,
    load_rate, disch_rate, load_terms,
    laytime_basis, laytime_structure,
    freight_basis, freight_idea_usd_mt,
    commission_pct, commission_ttl_pct, iac_flag,
    demurrage_rate, despatch_rate, despatch_basis,
    tolerance_pct, tolerance_holder,
    disport_status, packaging_type, bag_weight_kg,
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
    NULLIF(payload->>'bag_weight_kg',    '')::numeric,
     payload->>'broker',
     payload->>'notes'
  ) RETURNING * INTO v_listing;

  INSERT INTO public.listing_ownership
    (listing_type, listing_id, owner_user_id, role, transfer_reason)
  VALUES ('cargo', v_listing.id, v_user_id, 'primary', 'initial_post');

  SELECT trust_tier INTO v_tier
    FROM public.users WHERE supabase_user_id = v_user_id;
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