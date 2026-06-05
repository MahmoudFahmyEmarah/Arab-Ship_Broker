-- 1) Extend vessels with commercial/charter/risk preference fields
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS commercial_manager_company TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_country TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_contact TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_email TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_phone TEXT,
  ADD COLUMN IF NOT EXISTS charter_status TEXT,
  ADD COLUMN IF NOT EXISTS tc_charterer_name TEXT,
  ADD COLUMN IF NOT EXISTS tc_expiry DATE,
  ADD COLUMN IF NOT EXISTS bbc_charterer_name TEXT,
  ADD COLUMN IF NOT EXISTS bbc_expiry DATE,
  ADD COLUMN IF NOT EXISTS pi_ig_member BOOLEAN,
  ADD COLUMN IF NOT EXISTS pi_coverage_types TEXT[],
  ADD COLUMN IF NOT EXISTS war_risk_trading TEXT,
  ADD COLUMN IF NOT EXISTS war_risk_conditions TEXT,
  ADD COLUMN IF NOT EXISTS preferred_trading_areas TEXT[];

-- 2) Contacts table for persons-in-charge at vessel level
CREATE TABLE IF NOT EXISTS public.vessel_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vessel_contacts_vessel_id
  ON public.vessel_contacts (vessel_id);

DROP TRIGGER IF EXISTS trg_vessel_contacts_updated_at ON public.vessel_contacts;
CREATE TRIGGER trg_vessel_contacts_updated_at
  BEFORE UPDATE ON public.vessel_contacts
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.vessel_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own vessel contacts" ON public.vessel_contacts;
CREATE POLICY "Users see own vessel contacts"
  ON public.vessel_contacts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vessel_claims vc
      WHERE vc.vessel_id = vessel_contacts.vessel_id
        AND vc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage vessel contacts" ON public.vessel_contacts;
CREATE POLICY "Admins manage vessel contacts"
  ON public.vessel_contacts FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.vessel_contacts TO authenticated;
GRANT ALL ON public.vessel_contacts TO service_role;

-- 3) Extend register_vessel RPC to write all new vessel fields + contacts
CREATE OR REPLACE FUNCTION public.register_vessel(payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id                    UUID := auth.uid();
  v_vessel_id                  UUID;
  v_imo                        TEXT;
  v_app_role                   TEXT;
  v_has_active_vessel_profile  BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_app_role
  FROM public.users
  WHERE supabase_user_id = v_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.profiles p ON p.account_id = u.id
    WHERE u.supabase_user_id = v_user_id
      AND p.profile_type = 'vessel'::public.profile_type_enum
      AND p.is_active = TRUE
  )
  INTO v_has_active_vessel_profile;

  IF COALESCE(v_app_role, '') NOT IN ('vessel_owner', 'broker', 'admin')
     AND NOT v_has_active_vessel_profile THEN
    RAISE EXCEPTION 'Only users with an active Vessel profile may register vessels';
  END IF;

  IF NULLIF(TRIM(payload->>'vessel_name'), '') IS NULL THEN
    RAISE EXCEPTION 'vessel_name is required';
  END IF;

  IF NULLIF(payload->>'vessel_type', '') IS NULL THEN
    RAISE EXCEPTION 'vessel_type is required';
  END IF;

  v_imo := NULLIF(TRIM(payload->>'imo_number'), '');
  IF v_imo IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.vessels WHERE imo_number = v_imo) THEN
      RAISE EXCEPTION 'A vessel with IMO number % already exists in the register. If this is your vessel, please contact Arab ShipBroker to claim it.', v_imo;
    END IF;
  END IF;

  INSERT INTO public.vessels (
    vessel_name,
    imo_number,
    vessel_type,
    dwt_grain,
    dwt_bale,
    build_year,
    flag,
    flag_category,
    is_geared,
    crane_count,
    crane_swl_mt,
    grain_certified,
    dg_certified,
    max_loa_m,
    max_draft_m,
    pi_club,
    owner_company,
    owner_country,
    manager_company,
    manager_country,
    commercial_manager_company,
    commercial_manager_country,
    commercial_manager_contact,
    commercial_manager_email,
    commercial_manager_phone,
    charter_status,
    tc_charterer_name,
    tc_expiry,
    bbc_charterer_name,
    bbc_expiry,
    pi_ig_member,
    pi_coverage_types,
    war_risk_trading,
    war_risk_conditions,
    preferred_trading_areas,
    notes,
    scope,
    risk_level,
    is_sanctioned
  ) VALUES (
    TRIM(payload->>'vessel_name'),
    v_imo,
    (payload->>'vessel_type')::public.vessel_type_enum,
    NULLIF(payload->>'dwt_grain',  '')::INTEGER,
    NULLIF(payload->>'dwt_bale',   '')::INTEGER,
    NULLIF(payload->>'build_year', '')::SMALLINT,
    NULLIF(TRIM(payload->>'flag'), ''),
    NULLIF(payload->>'flag_category', '')::public.flag_category_enum,
    CASE
      WHEN payload->>'is_geared' = 'true'  THEN TRUE
      WHEN payload->>'is_geared' = 'false' THEN FALSE
      ELSE NULL
    END,
    NULLIF(payload->>'crane_count',  '')::SMALLINT,
    NULLIF(payload->>'crane_swl_mt', '')::NUMERIC,
    CASE
      WHEN payload->>'grain_certified' = 'true'  THEN TRUE
      WHEN payload->>'grain_certified' = 'false' THEN FALSE
      ELSE NULL
    END,
    CASE
      WHEN payload->>'dg_certified' = 'true'  THEN TRUE
      WHEN payload->>'dg_certified' = 'false' THEN FALSE
      ELSE NULL
    END,
    NULLIF(payload->>'max_loa_m',  '')::NUMERIC,
    NULLIF(payload->>'max_draft_m','')::NUMERIC,
    NULLIF(TRIM(payload->>'pi_club'), ''),
    NULLIF(TRIM(payload->>'owner_company'), ''),
    NULLIF(TRIM(payload->>'owner_country'), ''),
    NULLIF(TRIM(payload->>'manager_company'), ''),
    NULLIF(TRIM(payload->>'manager_country'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_company'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_country'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_contact'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_email'), ''),
    NULLIF(TRIM(payload->>'commercial_manager_phone'), ''),
    NULLIF(TRIM(payload->>'charter_status'), ''),
    NULLIF(TRIM(payload->>'tc_charterer_name'), ''),
    NULLIF(payload->>'tc_expiry', '')::DATE,
    NULLIF(TRIM(payload->>'bbc_charterer_name'), ''),
    NULLIF(payload->>'bbc_expiry', '')::DATE,
    CASE
      WHEN payload->>'pi_ig_member' = 'true'  THEN TRUE
      WHEN payload->>'pi_ig_member' = 'false' THEN FALSE
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(payload->'pi_coverage_types') = 'array'
       AND jsonb_array_length(payload->'pi_coverage_types') > 0
      THEN ARRAY(
        SELECT TRIM(v)
        FROM jsonb_array_elements_text(payload->'pi_coverage_types') AS v
        WHERE NULLIF(TRIM(v), '') IS NOT NULL
      )
      ELSE NULL
    END,
    NULLIF(TRIM(payload->>'war_risk_trading'), ''),
    NULLIF(TRIM(payload->>'war_risk_conditions'), ''),
    CASE
      WHEN jsonb_typeof(payload->'preferred_trading_areas') = 'array'
       AND jsonb_array_length(payload->'preferred_trading_areas') > 0
      THEN ARRAY(
        SELECT TRIM(v)
        FROM jsonb_array_elements_text(payload->'preferred_trading_areas') AS v
        WHERE NULLIF(TRIM(v), '') IS NOT NULL
      )
      ELSE NULL
    END,
    NULLIF(TRIM(payload->>'notes'), ''),
    'In Scope'::public.scope_enum,
    'CLEAR'::public.risk_level_enum,
    FALSE
  )
  RETURNING id INTO v_vessel_id;

  INSERT INTO public.vessel_claims (vessel_id, user_id, role)
  VALUES (v_vessel_id, v_user_id, 'owner');

  IF jsonb_typeof(payload->'persons_in_charge') = 'array' THEN
    INSERT INTO public.vessel_contacts (vessel_id, name, role, email, phone)
    SELECT
      v_vessel_id,
      NULLIF(TRIM(pic->>'name'), ''),
      COALESCE(NULLIF(TRIM(pic->>'role'), ''), 'Other'),
      NULLIF(TRIM(pic->>'email'), ''),
      NULLIF(TRIM(pic->>'phone'), '')
    FROM jsonb_array_elements(payload->'persons_in_charge') AS pic
    WHERE NULLIF(TRIM(pic->>'name'), '') IS NOT NULL;
  END IF;

  RETURN v_vessel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_vessel(JSONB) TO authenticated;

-- 4) Extend my-vessels view with latest approved OPEN posting metadata
DROP VIEW IF EXISTS public.v_my_vessels;
CREATE VIEW public.v_my_vessels AS
WITH latest_open AS (
  SELECT DISTINCT ON (va.vessel_id)
    va.vessel_id,
    va.open_port_name,
    va.open_zone,
    va.open_date
  FROM public.vessel_availability va
  WHERE va.status = 'OPEN'
    AND va.review_status = 'APPROVED'
  ORDER BY va.vessel_id, va.created_at DESC
),
open_counts AS (
  SELECT
    va.vessel_id,
    COUNT(*) FILTER (
      WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED'
    ) AS open_availability_count
  FROM public.vessel_availability va
  GROUP BY va.vessel_id
)
SELECT
  v.*,
  vc.user_id,
  vc.role AS claim_role,
  vc.created_at AS claimed_at,
  COALESCE(oc.open_availability_count, 0)::BIGINT AS open_availability_count,
  lo.open_port_name,
  lo.open_zone,
  lo.open_date
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN open_counts oc ON oc.vessel_id = v.id
LEFT JOIN latest_open lo ON lo.vessel_id = v.id
WHERE vc.user_id = auth.uid();

GRANT SELECT ON public.v_my_vessels TO authenticated;

-- 5) Extend vessel_availability with ballast + split fuel fields
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS ballast_port_locode TEXT REFERENCES public.ports(locode),
  ADD COLUMN IF NOT EXISTS ballast_port_name TEXT,
  ADD COLUMN IF NOT EXISTS me_consumption_port_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS aux_consumption_port_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS fuel_type TEXT;

CREATE INDEX IF NOT EXISTS idx_va_ballast_port_locode
  ON public.vessel_availability (ballast_port_locode)
  WHERE ballast_port_locode IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vessel_availability_fuel_type_chk'
      AND conrelid = 'public.vessel_availability'::regclass
  ) THEN
    ALTER TABLE public.vessel_availability
      ADD CONSTRAINT vessel_availability_fuel_type_chk
      CHECK (
        fuel_type IS NULL
        OR fuel_type IN ('VLSFO', 'HSFO', 'MGO', 'MDO', 'LNG', 'Biofuel blend')
      );
  END IF;
END
$$;

-- 6) Update port-autofill trigger for open and ballast ports
CREATE OR REPLACE FUNCTION public.fn_va_port_autofill()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_port public.ports%ROWTYPE;
  v_ballast_port public.ports%ROWTYPE;
BEGIN
  IF NEW.open_port_locode IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD.open_port_locode IS DISTINCT FROM NEW.open_port_locode) THEN
    SELECT * INTO v_open_port FROM public.ports WHERE locode = NEW.open_port_locode;
    IF FOUND THEN
      NEW.open_port_name := v_open_port.trade_name;
      NEW.open_zone := v_open_port.zone;
    END IF;
  ELSIF NEW.open_port_locode IS NULL THEN
    NEW.open_port_name := NULL;
    NEW.open_zone := NULL;
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

-- 7) Extend create_vessel_availability RPC to accept new fields
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
  SELECT is_sanctioned, risk_level INTO v_sanctioned, v_risk
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
    ballast_port_locode,
    open_date,
    open_date_range_days,
    last_cargo,
    service_speed_kn,
    me_consumption_mt_day,
    me_consumption_port_mt_day,
    aux_consumption_mt_day,
    aux_consumption_port_mt_day,
    fuel_type,
    freight_idea_usd_mt,
    accepts_part_cargo,
    notes
  ) VALUES (
    v_vessel_id,
    payload->>'open_port_locode',
    NULLIF(payload->>'ballast_port_locode', ''),
    (payload->>'open_date')::date,
    COALESCE((payload->>'open_date_range_days')::smallint, 7),
    payload->>'last_cargo',
    (payload->>'service_speed_kn')::numeric,
    (payload->>'me_consumption_mt_day')::numeric,
    (payload->>'me_consumption_port_mt_day')::numeric,
    (payload->>'aux_consumption_mt_day')::numeric,
    (payload->>'aux_consumption_port_mt_day')::numeric,
    NULLIF(payload->>'fuel_type', ''),
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
