-- ════════════════════════════════════════════════════════════════════════
-- Restore the Post-Position subsystem (Phase 2)
--
-- Companion to Phase 1 (20260713165215). The "Post Position" flow
-- (AvailabilityForm → submitVesselAvailability → create_vessel_availability)
-- was dropped in the rebuild: the RPC is missing and vessel_availability lacks
-- ballast / port-consumption / fuel_type / grab / brob / ref columns the code
-- references. This restores them, faithfully to the archived definitions, with
-- the grab/brob fields wired through (the form already collects them).
--
-- Ownership uses listing_ownership ('vessel_availability','primary') — the live
-- model — NOT vessel_claims (which is vessel-master ownership, Phase 1). This
-- keeps the two ownership concepts cleanly separate and consistent.
--
-- Verified present on live before authoring: listing_ownership
-- (ownership_role_enum{primary,…}, is_current default true, owned_from now()),
-- review_queue (status default PENDING), users.trust_tier, trust_tier_enum
-- {NEW,VERIFIED,FLAGGED}, review_status_enum, ports, fn_va_port_autofill (which
-- did NOT yet handle ballast — replaced below).
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. New columns (ballast, split port consumption, fuel, grab, brob, ref) ──
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS ballast_port_locode         TEXT REFERENCES public.ports(locode),
  ADD COLUMN IF NOT EXISTS ballast_port_name           TEXT,
  ADD COLUMN IF NOT EXISTS me_consumption_port_mt_day  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS aux_consumption_port_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS fuel_type                   TEXT,
  ADD COLUMN IF NOT EXISTS grab_type                   TEXT,
  ADD COLUMN IF NOT EXISTS grab_capacity_mt            NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS num_grabs                   SMALLINT,
  ADD COLUMN IF NOT EXISTS brob_mt                     NUMERIC(7,1),
  ADD COLUMN IF NOT EXISTS ref                         TEXT;

CREATE INDEX IF NOT EXISTS idx_va_ballast_port_locode
  ON public.vessel_availability (ballast_port_locode)
  WHERE ballast_port_locode IS NOT NULL;

-- fuel_type check: UNION of the code set and the workbook 10_ENUMS set
-- (FUEL_TYPE union decision) — de-duped (VLSFO, MGO shared).
ALTER TABLE public.vessel_availability DROP CONSTRAINT IF EXISTS vessel_availability_fuel_type_chk;
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_fuel_type_chk
  CHECK (
    fuel_type IS NULL
    OR fuel_type IN ('VLSFO','HSFO','MGO','MDO','LNG','Biofuel blend','LSMGO','HFO 380','Dual')
  );

-- ── 2. ref minting: VA-0001, VA-0002, … ─────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.seq_vessel_ref;

ALTER TABLE public.vessel_availability
  DROP CONSTRAINT IF EXISTS vessel_availability_ref_key;
ALTER TABLE public.vessel_availability
  ADD CONSTRAINT vessel_availability_ref_key UNIQUE (ref);

CREATE OR REPLACE FUNCTION public.fn_generate_va_ref()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ref IS NULL THEN
    NEW.ref := 'VA-' || LPAD(nextval('public.seq_vessel_ref')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_ref ON public.vessel_availability;
CREATE TRIGGER trg_va_ref
  BEFORE INSERT ON public.vessel_availability
  FOR EACH ROW EXECUTE FUNCTION public.fn_generate_va_ref();

-- ── 3. Port autofill — replace with the ballast-aware version ────────────────
CREATE OR REPLACE FUNCTION public.fn_va_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_open_port    public.ports%ROWTYPE;
  v_ballast_port public.ports%ROWTYPE;
BEGIN
  IF NEW.open_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.open_port_locode IS DISTINCT FROM NEW.open_port_locode) THEN
    SELECT * INTO v_open_port FROM public.ports WHERE locode = NEW.open_port_locode;
    IF FOUND THEN
      NEW.open_port_name := v_open_port.trade_name;
      NEW.open_zone      := v_open_port.zone;
    END IF;
  ELSIF NEW.open_port_locode IS NULL THEN
    NEW.open_port_name := NULL;
    NEW.open_zone      := NULL;
  END IF;

  IF NEW.ballast_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.ballast_port_locode IS DISTINCT FROM NEW.ballast_port_locode) THEN
    SELECT * INTO v_ballast_port FROM public.ports WHERE locode = NEW.ballast_port_locode;
    IF FOUND THEN
      NEW.ballast_port_name := v_ballast_port.trade_name;
    END IF;
  ELSIF NEW.ballast_port_locode IS NULL THEN
    NEW.ballast_port_name := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_port_autofill ON public.vessel_availability;
CREATE TRIGGER trg_va_port_autofill
  BEFORE INSERT OR UPDATE ON public.vessel_availability
  FOR EACH ROW EXECUTE FUNCTION public.fn_va_port_autofill();

-- ── 4. create_vessel_availability(jsonb) ────────────────────────────────────
-- Faithful to archived 20260419000100, with grab_type/grab_capacity_mt/
-- num_grabs/brob_mt wired through (the AvailabilityForm collects them).
CREATE OR REPLACE FUNCTION public.create_vessel_availability(payload jsonb)
RETURNS public.vessel_availability
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT is_sanctioned, risk_level INTO v_sanctioned, v_risk
  FROM public.vessels WHERE id = v_vessel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel not found: %', v_vessel_id;
  END IF;
  IF v_sanctioned THEN
    RAISE EXCEPTION 'This vessel is sanctioned and cannot have availability posted.';
  END IF;

  INSERT INTO public.vessel_availability (
    vessel_id, open_port_locode, ballast_port_locode, open_date, open_date_range_days,
    last_cargo, service_speed_kn,
    me_consumption_mt_day, me_consumption_port_mt_day,
    aux_consumption_mt_day, aux_consumption_port_mt_day,
    fuel_type, grab_type, grab_capacity_mt, num_grabs, brob_mt,
    freight_idea_usd_mt, accepts_part_cargo, notes
  ) VALUES (
    v_vessel_id,
    payload->>'open_port_locode',
    NULLIF(payload->>'ballast_port_locode', ''),
    (payload->>'open_date')::date,
    COALESCE((payload->>'open_date_range_days')::smallint, 7),
    NULLIF(payload->>'last_cargo', ''),
    (payload->>'service_speed_kn')::numeric,
    (payload->>'me_consumption_mt_day')::numeric,
    (payload->>'me_consumption_port_mt_day')::numeric,
    (payload->>'aux_consumption_mt_day')::numeric,
    (payload->>'aux_consumption_port_mt_day')::numeric,
    NULLIF(payload->>'fuel_type', ''),
    NULLIF(payload->>'grab_type', ''),
    (payload->>'grab_capacity_mt')::numeric,
    (payload->>'num_grabs')::smallint,
    (payload->>'brob_mt')::numeric,
    (payload->>'freight_idea_usd_mt')::numeric,
    COALESCE((payload->>'accepts_part_cargo')::boolean, false),
    NULLIF(payload->>'notes', '')
  )
  RETURNING * INTO v_rec;

  INSERT INTO public.listing_ownership (listing_type, listing_id, owner_user_id, role, transfer_reason)
  VALUES ('vessel_availability', v_rec.id, v_user_id, 'primary', 'initial_post');

  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_user_id;
  v_random := (RANDOM() < 0.1);

  IF v_risk = 'HIGH' OR v_tier IS DISTINCT FROM 'VERIFIED' OR v_random THEN
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by, trust_tier_at_submit, is_random_sample, review_reason
    ) VALUES (
      'vessel_availability', v_rec.id, v_user_id, v_tier, v_random,
      CASE
        WHEN v_risk = 'HIGH'    THEN 'HIGH risk vessel'
        WHEN v_tier = 'FLAGGED' THEN 'Flagged account'
        WHEN v_random           THEN 'Random sample check'
        ELSE                         'New user'
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

REVOKE ALL ON FUNCTION public.create_vessel_availability(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_vessel_availability(jsonb) TO authenticated, service_role;
