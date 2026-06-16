DO $$ BEGIN
  CREATE TYPE public.profile_type_enum AS ENUM ('cargo', 'vessel');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Links to public.users.id (NOT supabase_user_id — one level of indirection)
  account_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_type     public.profile_type_enum NOT NULL,

  -- Profile-level display name (can differ between cargo and vessel persona)
  display_name     TEXT,
  company          TEXT,
  phone            TEXT,   -- PII — encrypt at app layer
  notes            TEXT,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One profile of each type per account
  UNIQUE (account_id, profile_type)
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_account   ON public.profiles (account_id);
CREATE INDEX IF NOT EXISTS idx_profiles_type      ON public.profiles (profile_type);
CREATE INDEX IF NOT EXISTS idx_profiles_active    ON public.profiles (account_id, is_active);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profiles
DROP POLICY IF EXISTS "Users read own profiles" ON public.profiles;
CREATE POLICY "Users read own profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT id FROM public.users WHERE supabase_user_id = auth.uid()
    )
  );

-- Users can update their own profiles
DROP POLICY IF EXISTS "Users update own profiles" ON public.profiles;
CREATE POLICY "Users update own profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT id FROM public.users WHERE supabase_user_id = auth.uid()
    )
  );

-- Insert is done via RPC (SECURITY DEFINER) — no direct user insert policy needed
-- Admins can do everything
DROP POLICY IF EXISTS "Admins manage profiles" ON public.profiles;
CREATE POLICY "Admins manage profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;


-- ── 2. MIGRATE EXISTING USERS TO PROFILES ─────────────────────
-- All existing users get a profile based on their current role column.
-- Users with role = 'cargo_owner' get a cargo profile.
-- Users with role = 'vessel_owner' get a vessel profile.
-- Users with role = 'broker' get BOTH profiles (full broker).
-- Users with role = 'admin' get no profile (they operate via admin UI).

INSERT INTO public.profiles (account_id, profile_type, display_name, company)
SELECT
  u.id,
  'cargo'::public.profile_type_enum,
  u.full_name,
  u.company
FROM public.users u
WHERE u.role IN ('cargo_owner', 'broker')
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.account_id = u.id AND p.profile_type = 'cargo'
  )
ON CONFLICT (account_id, profile_type) DO NOTHING;

INSERT INTO public.profiles (account_id, profile_type, display_name, company)
SELECT
  u.id,
  'vessel'::public.profile_type_enum,
  u.full_name,
  u.company
FROM public.users u
WHERE u.role IN ('vessel_owner', 'broker')
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.account_id = u.id AND p.profile_type = 'vessel'
  )
ON CONFLICT (account_id, profile_type) DO NOTHING;


-- ── 3. RPC: create_account_with_profiles ──────────────────────
-- Used by the signup flow. Creates the users row and one or two
-- profile rows atomically. Replaces the direct users INSERT in sdk/auth.ts.

CREATE OR REPLACE FUNCTION public.create_account_with_profiles(
  p_supabase_user_id UUID,
  p_name             TEXT,
  p_email            TEXT,
  p_profiles         public.profile_type_enum[]  -- e.g. ARRAY['cargo'] or ARRAY['cargo','vessel']
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    public.users;
  v_profile_type public.profile_type_enum;
BEGIN
  -- 1. Create the account row
  INSERT INTO public.users (supabase_user_id, name, full_name, email, role, trust_tier, is_active)
  VALUES (
    p_supabase_user_id,
    p_name,
    p_name,
    p_email,
    -- Legacy role: if both profiles selected → 'broker', else map accordingly
    CASE
      WHEN 'cargo'::public.profile_type_enum = ANY(p_profiles)
       AND 'vessel'::public.profile_type_enum = ANY(p_profiles)
      THEN 'broker'::public.user_role
      WHEN 'cargo'::public.profile_type_enum = ANY(p_profiles)
      THEN 'cargo_owner'::public.user_role
      ELSE 'vessel_owner'::public.user_role
    END,
    'NEW'::public.trust_tier_enum,
    TRUE
  )
  RETURNING * INTO v_user;

  -- 2. Create profile rows
  FOREACH v_profile_type IN ARRAY p_profiles
  LOOP
    INSERT INTO public.profiles (account_id, profile_type, display_name)
    VALUES (v_user.id, v_profile_type, p_name)
    ON CONFLICT (account_id, profile_type) DO NOTHING;
  END LOOP;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_account_with_profiles(uuid, text, text, public.profile_type_enum[]) TO service_role;


-- ── 4. FIX BUG-09: Commodity flags in fn_cl_port_autofill ─────
-- Add commodity flag autofill (is_dg_cargo, is_grain_cargo) to the
-- existing port autofill trigger for cargo_listings.

CREATE OR REPLACE FUNCTION public.fn_cl_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_load_port   public.ports%ROWTYPE;
  v_disch_port  public.ports%ROWTYPE;
  v_commodity   public.commodities%ROWTYPE;
BEGIN
  -- Port autofill: load port
  IF NEW.load_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.load_port_locode IS DISTINCT FROM NEW.load_port_locode) THEN
    SELECT * INTO v_load_port FROM public.ports WHERE locode = NEW.load_port_locode;
    IF FOUND THEN
      NEW.load_port_name := v_load_port.trade_name;
      NEW.load_zone      := v_load_port.zone;
      NEW.load_country   := v_load_port.country;
    END IF;
  END IF;

  -- Port autofill: discharge port
  IF NEW.disch_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.disch_port_locode IS DISTINCT FROM NEW.disch_port_locode) THEN
    SELECT * INTO v_disch_port FROM public.ports WHERE locode = NEW.disch_port_locode;
    IF FOUND THEN
      NEW.disch_port_name := v_disch_port.trade_name;
      NEW.disch_zone      := v_disch_port.zone;
      NEW.disch_country   := v_disch_port.country;
    END IF;
  END IF;

  -- Commodity flag autofill (BUG-09 fix)
  -- Ensures is_dg_cargo and is_grain_cargo are always in sync with the selected commodity,
  -- even if someone bypasses the frontend.
  IF NEW.commodity_id IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.commodity_id IS DISTINCT FROM NEW.commodity_id) THEN
    SELECT * INTO v_commodity FROM public.commodities WHERE id = NEW.commodity_id;
    IF FOUND THEN
      NEW.is_dg_cargo    := v_commodity.is_dg;
      NEW.is_grain_cargo := v_commodity.is_grain;
      -- Also populate commodity_name from canonical_name as a safety net
      IF NEW.commodity_name IS NULL OR NEW.commodity_name = '' THEN
        NEW.commodity_name := v_commodity.canonical_name;
      END IF;
    END IF;
  END IF;

  -- Spot flag
  NEW.is_spot := (NEW.laycan_from IS NULL);

  RETURN NEW;
END;
$$;

-- Trigger already exists from migration 006 — no need to re-create it.
-- The OR REPLACE above updates the function body in place.


-- ── 5. FIX BUG-10/11: Auto-generate ref on listings ──────────

-- Sequence for cargo listings
CREATE SEQUENCE IF NOT EXISTS public.seq_cargo_ref START 1 INCREMENT 1;

-- Sequence for vessel availability
CREATE SEQUENCE IF NOT EXISTS public.seq_vessel_ref START 1 INCREMENT 1;

-- Function to generate cargo ref: CL-0001, CL-0002, ...
CREATE OR REPLACE FUNCTION public.fn_generate_cargo_ref()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ref IS NULL THEN
    NEW.ref := 'CL-' || LPAD(nextval('public.seq_cargo_ref')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cargo_ref ON public.cargo_listings;
CREATE TRIGGER trg_cargo_ref
  BEFORE INSERT ON public.cargo_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_generate_cargo_ref();

-- Function to generate vessel availability ref: VA-0001, VA-0002, ...
CREATE OR REPLACE FUNCTION public.fn_generate_va_ref()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ref IS NULL THEN
    NEW.ref := 'VA-' || LPAD(nextval('public.seq_vessel_ref')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- vessel_availability doesn't have a ref column yet in migration 009
-- Add it now:
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

DROP TRIGGER IF EXISTS trg_va_ref ON public.vessel_availability;
CREATE TRIGGER trg_va_ref
  BEFORE INSERT ON public.vessel_availability
  FOR EACH ROW EXECUTE FUNCTION public.fn_generate_va_ref();


-- ── 6. FIX BUG-03: Submission routing race condition ──────────
-- Remove the AFTER INSERT triggers that race against listing_ownership.
-- Submission routing is now called from the end of the RPCs instead.

DROP TRIGGER IF EXISTS trg_cl_submission_route ON public.cargo_listings;
DROP TRIGGER IF EXISTS trg_va_submission_route ON public.vessel_availability;

-- We keep the functions (they are still called by the RPCs directly).
-- The RPCs are replaced below.


-- ── 7. FIX BUG-03: Replace create_cargo_listing RPC ──────────
-- Now calls submission routing explicitly after ownership insert.

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
  -- 1. Insert the cargo listing
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

  -- 2. Insert ownership record
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

  -- 3. NOW run submission routing (after ownership exists — fixes BUG-03)
  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_user_id;
  v_random := (RANDOM() < 0.1);

  IF v_tier = 'VERIFIED' AND NOT v_random THEN
    UPDATE public.cargo_listings
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = v_listing.id;
    -- Refresh our local copy
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


-- ── 8. FIX BUG-03: Replace create_vessel_availability RPC ─────

CREATE OR REPLACE FUNCTION public.create_vessel_availability(
  payload jsonb
) RETURNS public.vessel_availability
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec        public.vessel_availability;
  v_user_id    uuid := auth.uid();
  v_vessel_id  uuid := (payload->>'vessel_id')::uuid;
  v_sanctioned boolean;
  v_risk       public.risk_level_enum;
  v_tier       public.trust_tier_enum;
  v_random     boolean;
BEGIN
  -- Hard block: sanctioned vessels cannot have availability posted
  SELECT is_sanctioned, risk_level INTO v_sanctioned, v_risk
  FROM public.vessels WHERE id = v_vessel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel not found: %', v_vessel_id;
  END IF;

  IF v_sanctioned THEN
    RAISE EXCEPTION 'This vessel is sanctioned and cannot have availability posted.';
  END IF;

  -- 1. Insert availability
  INSERT INTO public.vessel_availability (
    vessel_id,
    open_port_locode,
    open_date,
    open_date_range_days,
    last_cargo,
    service_speed_kn,
    me_consumption_mt_day,
    aux_consumption_mt_day,
    freight_idea_usd_mt,
    accepts_part_cargo,
    notes
  ) VALUES (
    v_vessel_id,
    payload->>'open_port_locode',
    (payload->>'open_date')::date,
    COALESCE((payload->>'open_date_range_days')::smallint, 7),
    payload->>'last_cargo',
    (payload->>'service_speed_kn')::numeric,
    (payload->>'me_consumption_mt_day')::numeric,
    (payload->>'aux_consumption_mt_day')::numeric,
    (payload->>'freight_idea_usd_mt')::numeric,
    COALESCE((payload->>'accepts_part_cargo')::boolean, false),
    payload->>'notes'
  )
  RETURNING * INTO v_rec;

  -- 2. Insert ownership record
  INSERT INTO public.listing_ownership (
    listing_type, listing_id, owner_user_id, role, transfer_reason
  ) VALUES (
    'vessel_availability', v_rec.id, v_user_id, 'primary', 'initial_post'
  );

  -- 3. Run submission routing AFTER ownership exists (fixes BUG-03)
  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_user_id;
  v_random := (RANDOM() < 0.1);

  IF v_risk = 'HIGH' OR v_tier != 'VERIFIED' OR v_random THEN
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by,
      trust_tier_at_submit, is_random_sample, review_reason
    ) VALUES (
      'vessel_availability', v_rec.id, v_user_id, v_tier, v_random,
      CASE
        WHEN v_risk = 'HIGH'    THEN 'HIGH risk vessel'
        WHEN v_tier = 'FLAGGED' THEN 'Flagged account'
        WHEN v_random            THEN 'Random sample check'
        ELSE                          'New user'
      END
    );
  ELSE
    UPDATE public.vessel_availability
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = v_rec.id;
    SELECT * INTO v_rec FROM public.vessel_availability WHERE id = v_rec.id;
  END IF;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_vessel_availability(jsonb) TO authenticated;


-- ── 9. FIX BUG-01: update_cargo_safety_answers RPC ───────────
-- Upserts safety answers and triggers the matchmaking writeback.

CREATE OR REPLACE FUNCTION public.update_cargo_safety_answers(
  p_cargo_id UUID,
  p_answers  JSONB  -- {"question_key": "answer_value", ...}
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key   TEXT;
  v_val   TEXT;
  v_uid   UUID := auth.uid();
BEGIN
  -- Verify the caller owns this listing
  IF NOT EXISTS (
    SELECT 1 FROM public.listing_ownership
    WHERE listing_id = p_cargo_id
      AND listing_type = 'cargo'
      AND owner_user_id = v_uid
      AND is_current = TRUE
      AND role = 'primary'
  ) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: you do not own this cargo listing.';
  END IF;

  -- Upsert each answer — ON CONFLICT triggers the writeback trigger
  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_answers)
  LOOP
    INSERT INTO public.cargo_safety_answers (
      cargo_listing_id, question_key, answer_value, answered_by,
      question_id
    )
    VALUES (
      p_cargo_id,
      v_key,
      v_val,
      v_uid,
      (SELECT id FROM public.safety_questions WHERE question_key = v_key LIMIT 1)
    )
    ON CONFLICT (cargo_listing_id, question_key)
    DO UPDATE SET
      answer_value = EXCLUDED.answer_value,
      answered_by  = EXCLUDED.answered_by;
    -- The trg_csa_writeback trigger fires on each upsert automatically.
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_cargo_safety_answers(uuid, jsonb) TO authenticated;


-- ── 10. FIX BUG-02: get_matches_for_cargo RPC ─────────────────
-- The cargo→vessel direction of matchmaking. Mirrors the vessel→cargo
-- RPC but runs the funnel from the cargo listing's perspective.

CREATE OR REPLACE FUNCTION public.get_matches_for_cargo(
  p_cargo_id UUID
) RETURNS TABLE (
  availability_id       uuid,
  vessel_ref            text,
  vessel_id             uuid,
  vessel_name           text,
  vessel_type           public.vessel_type_enum,
  dwt_grain             integer,
  build_year            smallint,
  flag                  text,
  scope                 public.scope_enum,
  risk_level            public.risk_level_enum,
  is_geared             boolean,
  grain_certified       boolean,
  dg_certified          boolean,
  open_port_name        text,
  open_zone             public.zone_enum,
  open_date             date,
  open_date_range_days  smallint,
  accepts_part_cargo    boolean,
  freight_idea_usd_mt   numeric,
  is_rate_aligned       boolean,
  dwt_delta             integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cl           public.cargo_listings%ROWTYPE;
  v_current_year integer := EXTRACT(YEAR FROM NOW())::integer;
BEGIN
  -- Load the cargo listing
  SELECT * INTO v_cl
  FROM public.cargo_listings
  WHERE id = p_cargo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cargo listing not found: %', p_cargo_id;
  END IF;

  RETURN QUERY
  SELECT
    va.id                   AS availability_id,
    va.ref                  AS vessel_ref,
    v.id                    AS vessel_id,
    v.vessel_name,
    v.vessel_type,
    v.dwt_grain,
    v.build_year,
    v.flag,
    v.scope,
    v.risk_level,
    v.is_geared,
    v.grain_certified,
    v.dg_certified,
    va.open_port_name,
    va.open_zone,
    va.open_date,
    va.open_date_range_days,
    va.accepts_part_cargo,
    va.freight_idea_usd_mt,
    -- Rate-aligned: both have freight_idea and gap ≤ $5/MT
    (
      v_cl.freight_idea_usd_mt IS NOT NULL
      AND va.freight_idea_usd_mt IS NOT NULL
      AND ABS(v_cl.freight_idea_usd_mt - va.freight_idea_usd_mt) <= 5.0
    ) AS is_rate_aligned,
    ABS(COALESCE(v.dwt_grain, 0) - v_cl.qty_max_mt) AS dwt_delta

  FROM public.vessel_availability va
  JOIN public.vessels v ON v.id = va.vessel_id

  WHERE
    -- Stage 1: Sanctions hard block
    v.is_sanctioned = FALSE

    -- Stage 2: Status filter
    AND va.status = 'OPEN'
    AND va.review_status = 'APPROVED'

    -- Stage 3: Geography — vessel open zone matches cargo load or discharge zone
    AND (
      va.open_zone = v_cl.load_zone
      OR va.open_zone = v_cl.disch_zone
    )

    -- Stage 4: Capacity
    AND v.dwt_grain IS NOT NULL
    AND v.dwt_grain >= v_cl.qty_min_mt
    AND v.dwt_grain <= v_cl.qty_max_mt * (
      CASE WHEN va.accepts_part_cargo THEN 1.20 ELSE 1.10 END
    )
    AND v.dwt_grain >= v_cl.qty_max_mt * (
      CASE WHEN va.accepts_part_cargo THEN 0.80 ELSE 0.90 END
    )

    -- Stage 5: Vessel type
    AND (
      v_cl.cargo_type = 'Break Bulk'
      OR v.vessel_type IN ('Bulk Carrier', 'General Cargo')
    )

    -- Stage 6: Timing
    AND (
      v_cl.is_spot = TRUE
      OR (
        va.open_date IS NOT NULL
        AND v_cl.laycan_from IS NOT NULL
        AND va.open_date BETWEEN (v_cl.laycan_from - INTERVAL '21 days')::date
                              AND (v_cl.laycan_from + INTERVAL '14 days')::date
      )
    )

    -- Stage 7a: Geared requirement
    AND (
      v_cl.requires_geared IS NULL
      OR v_cl.requires_geared = FALSE
      OR v.is_geared = TRUE
    )

    -- Stage 7b: Grain certification
    AND (
      v_cl.is_grain_cargo = FALSE
      OR v.grain_certified = TRUE
    )

    -- Stage 7c: Max vessel age
    AND (
      v_cl.max_vessel_age_yr IS NULL
      OR v.build_year IS NULL
      OR (v_current_year - v.build_year) <= v_cl.max_vessel_age_yr
    )

    -- Stage 7d: Max draft
    AND (
      v_cl.max_draft_m IS NULL
      OR v.max_draft_m IS NULL
      OR v.max_draft_m <= v_cl.max_draft_m
    )

  ORDER BY
    is_rate_aligned DESC,
    dwt_delta ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_matches_for_cargo(uuid) TO authenticated;


-- ── 11. FIX BUG-04: Clean up the dangling cargos_access_view ──
-- Migration 004 dropped it with a TODO to recreate it.
-- The view is no longer used anywhere in the codebase.
-- Formally close this out.

DROP VIEW IF EXISTS public.cargos_access_view;


-- ── 12. VIEW: v_account_profiles ──────────────────────────────
-- Convenient read for the frontend — returns a user's profiles
-- alongside their account info in one query.

CREATE OR REPLACE VIEW public.v_account_profiles AS
SELECT
  u.id                  AS account_id,
  u.supabase_user_id,
  u.full_name,
  u.email,
  u.trust_tier,
  u.is_active,
  -- Aggregated profile info
  ARRAY_AGG(p.profile_type ORDER BY p.profile_type) FILTER (WHERE p.id IS NOT NULL)
                        AS active_profiles,
  BOOL_OR(p.profile_type = 'cargo'  AND p.is_active)  AS has_cargo_profile,
  BOOL_OR(p.profile_type = 'vessel' AND p.is_active)  AS has_vessel_profile
FROM public.users u
LEFT JOIN public.profiles p ON p.account_id = u.id AND p.is_active = TRUE
GROUP BY u.id, u.supabase_user_id, u.full_name, u.email, u.trust_tier, u.is_active;

GRANT SELECT ON public.v_account_profiles TO authenticated;