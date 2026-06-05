-- ============================================================
-- MIGRATION 009 — vessels + vessel_availability
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.vessel_type_enum AS ENUM ('Bulk Carrier','General Cargo','Other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.flag_category_enum AS ENUM ('FOC','Domestic');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.scope_enum AS ENUM ('In Scope','Marginal','Out of Scope');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.risk_level_enum AS ENUM ('CLEAR','LOW','MEDIUM','HIGH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.vessel_status_enum AS ENUM ('OPEN','FIXED','ON SUBS','INACTIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── vessels (admin-managed intelligence register) ─────────────
-- Vessel owners do NOT create rows here.
-- They post availability AGAINST an existing row.

CREATE TABLE IF NOT EXISTS public.vessels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_name       TEXT NOT NULL,
  imo_number        TEXT UNIQUE,
  vessel_type       public.vessel_type_enum NOT NULL,
  dwt_grain         INTEGER,
  dwt_bale          INTEGER,
  build_year        SMALLINT,
  flag              TEXT,
  flag_category     public.flag_category_enum,
  scope             public.scope_enum NOT NULL DEFAULT 'In Scope',
  risk_level        public.risk_level_enum NOT NULL DEFAULT 'CLEAR',
  risk_notes        TEXT,
  preferred_zones   public.zone_enum[],
  trading_zone_raw  TEXT,

  is_geared         BOOLEAN,
  crane_count       SMALLINT,
  crane_swl_mt      NUMERIC(6,2),
  grain_certified   BOOLEAN,
  dg_certified      BOOLEAN,
  max_loa_m         NUMERIC(6,2),
  max_draft_m       NUMERIC(5,2),
  pi_club           TEXT,
  is_sanctioned     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Current contact snapshot (PII — encrypt at app layer)
  owner_company     TEXT,
  owner_country     TEXT,
  manager_company   TEXT,
  manager_country   TEXT,
  pic_name          TEXT,
  website           TEXT,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_vessels_updated_at ON public.vessels;
CREATE TRIGGER trg_vessels_updated_at
  BEFORE UPDATE ON public.vessels
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_vessels_imo        ON public.vessels (imo_number) WHERE imo_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vessels_name       ON public.vessels USING GIN (to_tsvector('english', vessel_name));
CREATE INDEX IF NOT EXISTS idx_vessels_scope      ON public.vessels (scope);
CREATE INDEX IF NOT EXISTS idx_vessels_risk       ON public.vessels (risk_level);
CREATE INDEX IF NOT EXISTS idx_vessels_sanctioned ON public.vessels (is_sanctioned);
CREATE INDEX IF NOT EXISTS idx_vessels_dwt        ON public.vessels (dwt_grain) WHERE dwt_grain IS NOT NULL;

ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read non-sanctioned vessels
DROP POLICY IF EXISTS "Authenticated read vessels" ON public.vessels;
CREATE POLICY "Authenticated read vessels"
  ON public.vessels FOR SELECT TO authenticated
  USING (is_sanctioned = FALSE);

-- Admins can do everything
DROP POLICY IF EXISTS "Admins manage vessels" ON public.vessels;
CREATE POLICY "Admins manage vessels"
  ON public.vessels FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.vessels TO authenticated;
GRANT ALL ON public.vessels TO service_role;

-- ── vessel_availability ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vessel_availability (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id             UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,

  -- Port (locode FK → auto-fill via trigger)
  open_port_locode      TEXT REFERENCES public.ports(locode),
  open_port_name        TEXT,
  open_zone             public.zone_enum,

  open_date             DATE,
  open_date_range_days  SMALLINT DEFAULT 7,
  last_cargo            TEXT,
  service_speed_kn      NUMERIC(4,1),
  me_consumption_mt_day NUMERIC(5,2),
  aux_consumption_mt_day NUMERIC(5,2),
  freight_idea_usd_mt   NUMERIC(8,2),
  accepts_part_cargo    BOOLEAN NOT NULL DEFAULT FALSE,

  status                public.vessel_status_enum NOT NULL DEFAULT 'OPEN',
  review_status         public.review_status_enum NOT NULL DEFAULT 'PENDING',
  goes_live_at          TIMESTAMPTZ,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_va_updated_at ON public.vessel_availability;
CREATE TRIGGER trg_va_updated_at
  BEFORE UPDATE ON public.vessel_availability
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_va_vessel    ON public.vessel_availability (vessel_id);
CREATE INDEX IF NOT EXISTS idx_va_zone      ON public.vessel_availability (open_zone);
CREATE INDEX IF NOT EXISTS idx_va_open_date ON public.vessel_availability (open_date) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_va_status    ON public.vessel_availability (status, review_status);

-- ── Port autofill trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_va_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_port public.ports%ROWTYPE;
BEGIN
  IF NEW.open_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.open_port_locode IS DISTINCT FROM NEW.open_port_locode) THEN
    SELECT * INTO v_port FROM public.ports WHERE locode = NEW.open_port_locode;
    IF FOUND THEN
      NEW.open_port_name := v_port.trade_name;
      NEW.open_zone      := v_port.zone;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_port_autofill ON public.vessel_availability;
CREATE TRIGGER trg_va_port_autofill
  BEFORE INSERT OR UPDATE ON public.vessel_availability
  FOR EACH ROW EXECUTE FUNCTION public.fn_va_port_autofill();

-- ── Submission routing trigger ────────────────────────────────
-- Same trust-tier logic as cargo: NEW/FLAGGED → review queue,
-- VERIFIED → go live immediately (1-in-10 spot check).
-- HIGH risk vessel → always goes to queue regardless of tier.

CREATE OR REPLACE FUNCTION public.fn_submission_route_vessel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_owner_id   UUID;
  v_tier       public.trust_tier_enum;
  v_risk       public.risk_level_enum;
  v_sanctioned BOOLEAN;
  v_random     BOOLEAN;
BEGIN
  -- Get vessel risk data
  SELECT risk_level, is_sanctioned
  INTO v_risk, v_sanctioned
  FROM public.vessels
  WHERE id = NEW.vessel_id;

  -- Sanctioned vessel — hard block (should never reach here via RPC, but defensive)
  IF v_sanctioned THEN
    RAISE EXCEPTION 'Sanctioned vessel cannot have availability posted.';
  END IF;

  -- Get owner from listing_ownership
  SELECT lo.owner_user_id INTO v_owner_id
  FROM public.listing_ownership lo
  WHERE lo.listing_id = NEW.id
    AND lo.listing_type = 'vessel_availability'
    AND lo.is_current = TRUE
  LIMIT 1;

  IF v_owner_id IS NULL THEN RETURN NEW; END IF;

  SELECT trust_tier INTO v_tier
  FROM public.users
  WHERE supabase_user_id = v_owner_id;

  v_random := (RANDOM() < 0.1);

  -- HIGH risk vessels always go to queue regardless of trust tier
  IF v_risk = 'HIGH' OR v_tier != 'VERIFIED' OR v_random THEN
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by,
      trust_tier_at_submit, is_random_sample, review_reason
    ) VALUES (
      'vessel_availability', NEW.id, v_owner_id, v_tier, v_random,
      CASE
        WHEN v_risk = 'HIGH'        THEN 'HIGH risk vessel'
        WHEN v_tier = 'FLAGGED'     THEN 'Flagged account'
        WHEN v_random               THEN 'Random sample check'
        ELSE                             'New user'
      END
    );
  ELSE
    UPDATE public.vessel_availability
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_submission_route ON public.vessel_availability;
CREATE TRIGGER trg_va_submission_route
  AFTER INSERT ON public.vessel_availability
  FOR EACH ROW EXECUTE FUNCTION public.fn_submission_route_vessel();

-- ── Update fn_rq_on_review to handle vessel_availability ─────

CREATE OR REPLACE FUNCTION public.fn_rq_on_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PENDING' AND NEW.status != 'PENDING' THEN
    NEW.reviewed_at := NOW();

    IF NEW.listing_type = 'cargo' THEN
      IF NEW.status = 'APPROVED' THEN
        UPDATE public.cargo_listings
          SET review_status = 'APPROVED', goes_live_at = NOW()
          WHERE id = NEW.listing_id;
        UPDATE public.users SET clean_posts = clean_posts + 1
          WHERE supabase_user_id = NEW.submitted_by;
      ELSIF NEW.status IN ('REJECTED','FLAGGED') THEN
        UPDATE public.cargo_listings
          SET review_status = NEW.status
          WHERE id = NEW.listing_id;
        UPDATE public.users SET strike_count = strike_count + 1
          WHERE supabase_user_id = NEW.submitted_by;
      END IF;

    ELSIF NEW.listing_type = 'vessel_availability' THEN
      IF NEW.status = 'APPROVED' THEN
        UPDATE public.vessel_availability
          SET review_status = 'APPROVED', goes_live_at = NOW()
          WHERE id = NEW.listing_id;
        UPDATE public.users SET clean_posts = clean_posts + 1
          WHERE supabase_user_id = NEW.submitted_by;
      ELSIF NEW.status IN ('REJECTED','FLAGGED') THEN
        UPDATE public.vessel_availability
          SET review_status = NEW.status
          WHERE id = NEW.listing_id;
        UPDATE public.users SET strike_count = strike_count + 1
          WHERE supabase_user_id = NEW.submitted_by;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-attach the updated function to the existing trigger
DROP TRIGGER IF EXISTS trg_rq_on_review ON public.review_queue;
CREATE TRIGGER trg_rq_on_review
  BEFORE UPDATE ON public.review_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_rq_on_review();

-- ── RLS on vessel_availability ────────────────────────────────

ALTER TABLE public.vessel_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Browse approved availability" ON public.vessel_availability;
CREATE POLICY "Browse approved availability"
  ON public.vessel_availability FOR SELECT TO authenticated
  USING (review_status = 'APPROVED' AND status = 'OPEN');

DROP POLICY IF EXISTS "Owners see own availability" ON public.vessel_availability;
CREATE POLICY "Owners see own availability"
  ON public.vessel_availability FOR SELECT TO authenticated
  USING (id IN (
    SELECT listing_id FROM public.listing_ownership
    WHERE owner_user_id = auth.uid()
      AND listing_type = 'vessel_availability'
      AND is_current = TRUE
  ));

DROP POLICY IF EXISTS "Primary owner update availability" ON public.vessel_availability;
CREATE POLICY "Primary owner update availability"
  ON public.vessel_availability FOR UPDATE TO authenticated
  USING (id IN (
    SELECT listing_id FROM public.listing_ownership
    WHERE owner_user_id = auth.uid()
      AND listing_type = 'vessel_availability'
      AND role = 'primary'
      AND is_current = TRUE
  ));

DROP POLICY IF EXISTS "Authenticated insert availability" ON public.vessel_availability;
CREATE POLICY "Authenticated insert availability"
  ON public.vessel_availability FOR INSERT TO authenticated
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Admins full access availability" ON public.vessel_availability;
CREATE POLICY "Admins full access availability"
  ON public.vessel_availability FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.vessel_availability TO authenticated;
GRANT ALL ON public.vessel_availability TO service_role;

-- ── RPC: create_vessel_availability ──────────────────────────
-- Atomic insert of availability + listing_ownership in one call.
-- Mirrors create_cargo_listing pattern exactly.

CREATE OR REPLACE FUNCTION public.create_vessel_availability(
  payload jsonb
) RETURNS public.vessel_availability
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec       public.vessel_availability;
  v_user_id   uuid := auth.uid();
  v_vessel_id uuid := (payload->>'vessel_id')::uuid;
  v_sanctioned boolean;
BEGIN
  -- Hard block: sanctioned vessels cannot have availability posted
  SELECT is_sanctioned INTO v_sanctioned
  FROM public.vessels WHERE id = v_vessel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel not found: %', v_vessel_id;
  END IF;

  IF v_sanctioned THEN
    RAISE EXCEPTION 'This vessel is sanctioned and cannot have availability posted.';
  END IF;

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

  INSERT INTO public.listing_ownership (
    listing_type, listing_id, owner_user_id, role, transfer_reason
  ) VALUES (
    'vessel_availability', v_rec.id, v_user_id, 'primary', 'initial_post'
  );

  RETURN v_rec;
END;
$$;

-- ── RPC: get_matches_for_availability ────────────────────────
-- Runs the 7-stage match funnel from a vessel's perspective.
-- Returns matching cargo_listings ranked by DWT proximity.

CREATE OR REPLACE FUNCTION public.get_matches_for_availability(
  p_availability_id uuid
) RETURNS TABLE (
  cargo_id            uuid,
  ref                 text,
  commodity_name      text,
  cargo_type          public.cargo_type_v2_enum,
  qty_min_mt          integer,
  qty_max_mt          integer,
  load_port_name      text,
  load_zone           public.zone_enum,
  disch_port_name     text,
  disch_zone          public.zone_enum,
  laycan_from         date,
  laycan_to           date,
  is_spot             boolean,
  is_grain_cargo      boolean,
  is_dg_cargo         boolean,
  load_terms          public.load_terms_enum,
  freight_idea_usd_mt numeric,
  requires_geared     boolean,
  max_vessel_age_yr   smallint,
  max_draft_m         numeric,
  is_rate_aligned     boolean,
  dwt_delta           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_va       public.vessel_availability%ROWTYPE;
  v_vessel   public.vessels%ROWTYPE;
  v_current_year integer := EXTRACT(YEAR FROM NOW())::integer;
  v_vessel_age   integer;
  v_tol_low  numeric;
  v_tol_high numeric;
BEGIN
  -- Load the availability record
  SELECT * INTO v_va
  FROM public.vessel_availability
  WHERE id = p_availability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Availability record not found: %', p_availability_id;
  END IF;

  -- Load vessel intelligence
  SELECT * INTO v_vessel
  FROM public.vessels
  WHERE id = v_va.vessel_id AND is_sanctioned = FALSE;

  IF NOT FOUND THEN
    RETURN; -- Sanctioned or non-existent vessel — no matches
  END IF;

  v_vessel_age := v_current_year - COALESCE(v_vessel.build_year, 0);

  RETURN QUERY
  SELECT
    cl.id,
    cl.ref,
    cl.commodity_name,
    cl.cargo_type,
    cl.qty_min_mt,
    cl.qty_max_mt,
    cl.load_port_name,
    cl.load_zone,
    cl.disch_port_name,
    cl.disch_zone,
    cl.laycan_from,
    cl.laycan_to,
    cl.is_spot,
    cl.is_grain_cargo,
    cl.is_dg_cargo,
    cl.load_terms,
    cl.freight_idea_usd_mt,
    cl.requires_geared,
    cl.max_vessel_age_yr,
    cl.max_draft_m,
    -- Rate-aligned: both have freight_idea and gap ≤ $5/MT
    (
      cl.freight_idea_usd_mt IS NOT NULL
      AND v_va.freight_idea_usd_mt IS NOT NULL
      AND ABS(cl.freight_idea_usd_mt - v_va.freight_idea_usd_mt) <= 5.0
    ) AS is_rate_aligned,
    ABS(COALESCE(v_vessel.dwt_grain, 0) - cl.qty_max_mt) AS dwt_delta
  FROM public.cargo_listings cl
  WHERE
    -- Stage 2: Status filter
    cl.review_status = 'APPROVED'
    AND cl.status IN ('IN', 'PARTIAL')

    -- Stage 3: Geography — vessel open zone matches cargo load or discharge zone
    AND (
      v_va.open_zone = cl.load_zone
      OR v_va.open_zone = cl.disch_zone
    )

    -- Stage 4: Capacity (±10% standard, ±20% if accepts_part_cargo)
    AND v_vessel.dwt_grain IS NOT NULL
    AND v_vessel.dwt_grain >= cl.qty_min_mt
    AND v_vessel.dwt_grain <= cl.qty_max_mt * (
      CASE WHEN v_va.accepts_part_cargo THEN 1.20 ELSE 1.10 END
    )
    AND v_vessel.dwt_grain >= cl.qty_max_mt * (
      CASE WHEN v_va.accepts_part_cargo THEN 0.80 ELSE 0.90 END
    )

    -- Stage 5: Vessel type — Dry Bulk requires Bulk Carrier or General Cargo
    AND (
      cl.cargo_type = 'Break Bulk'
      OR v_vessel.vessel_type IN ('Bulk Carrier', 'General Cargo')
    )

    -- Stage 6: Timing — vessel open date fits cargo laycan
    AND (
      cl.is_spot = TRUE
      OR (
        v_va.open_date IS NOT NULL
        AND cl.laycan_from IS NOT NULL
        AND v_va.open_date BETWEEN (cl.laycan_from - INTERVAL '21 days')::date
                                AND (cl.laycan_from + INTERVAL '14 days')::date
      )
    )

    -- Stage 7a: Geared requirement
    AND (
      cl.requires_geared IS NULL
      OR cl.requires_geared = FALSE
      OR v_vessel.is_geared = TRUE
    )

    -- Stage 7b: Grain certification
    AND (
      cl.is_grain_cargo = FALSE
      OR v_vessel.grain_certified = TRUE
    )

    -- Stage 7c: Max vessel age
    AND (
      cl.max_vessel_age_yr IS NULL
      OR v_vessel.build_year IS NULL
      OR v_vessel_age <= cl.max_vessel_age_yr
    )

    -- Stage 7d: Max draft
    AND (
      cl.max_draft_m IS NULL
      OR v_vessel.max_draft_m IS NULL
      OR v_vessel.max_draft_m <= cl.max_draft_m
    )

  ORDER BY
    is_rate_aligned DESC,   -- Rate-aligned matches first
    dwt_delta ASC;          -- Then closest DWT fit
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_vessel_availability(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches_for_availability(uuid) TO authenticated;