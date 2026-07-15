-- ════════════════════════════════════════════════════════════════════════
-- Restore the vessel-registration subsystem (Phase 1)
--
-- When the DB was rebuilt around the workbook / Intelligence-Register model,
-- the self-service vessel-registration subsystem was dropped, but the app code
-- (VesselCreateForm → createVessel → register_vessel, "My Vessels", vessel
-- detail) still expects it. This migration restores it faithfully:
--   1. the ~17 commercial/charter/risk columns on vessels
--   2. vessel_claims  (ownership of a registered vessel)
--   3. vessel_contacts (persons-in-charge) + RLS + firewall
--   4. register_vessel(jsonb) RPC  (+ Cargo Ship → General Cargo normalisation)
--   5. v_my_vessels view (port-aware)
--   6. v_vessel_detail masking view + base-table PII lockdown (contact firewall,
--      replicated EXACTLY from the archived 20260601000200 definition)
--
-- All dependencies verified present on the live DB before authoring:
--   fn_set_updated_at(), is_admin(), profiles(account_id,profile_type,is_active),
--   profile_type_enum, scope_enum, risk_level_enum, vessel_type_enum('Cargo Ship').
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE) — re-runnable.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. vessels: commercial / charter / risk-preference columns ──────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS gross_tonnage              INTEGER,
  ADD COLUMN IF NOT EXISTS scnrt                      INTEGER,
  ADD COLUMN IF NOT EXISTS commercial_manager_company TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_country TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_contact TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_email   TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager_phone   TEXT,
  ADD COLUMN IF NOT EXISTS charter_status             TEXT,
  ADD COLUMN IF NOT EXISTS tc_charterer_name          TEXT,
  ADD COLUMN IF NOT EXISTS tc_expiry                  DATE,
  ADD COLUMN IF NOT EXISTS bbc_charterer_name         TEXT,
  ADD COLUMN IF NOT EXISTS bbc_expiry                 DATE,
  ADD COLUMN IF NOT EXISTS pi_ig_member               BOOLEAN,
  ADD COLUMN IF NOT EXISTS pi_coverage_types          TEXT[],
  ADD COLUMN IF NOT EXISTS war_risk_trading           TEXT,
  ADD COLUMN IF NOT EXISTS war_risk_conditions        TEXT,
  ADD COLUMN IF NOT EXISTS preferred_trading_areas    TEXT[];

-- Sane bounds for the two tonnages (mirrors the archived checks).
ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_gross_tonnage_check;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_gross_tonnage_check
    CHECK (gross_tonnage IS NULL OR (gross_tonnage BETWEEN 200 AND 80000));
ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_scnrt_check;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_scnrt_check
    CHECK (scnrt IS NULL OR (scnrt BETWEEN 100 AND 80000));

-- ── 2. vessel_claims — which user registered/owns this vessel ───────────────
CREATE TABLE IF NOT EXISTS public.vessel_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id   UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'owner'
                CHECK (role IN ('owner', 'operator', 'manager')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vessel_id, user_id)
);

ALTER TABLE public.vessel_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own vessel claims" ON public.vessel_claims;
CREATE POLICY "Users see own vessel claims"
  ON public.vessel_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage vessel claims" ON public.vessel_claims;
CREATE POLICY "Admins manage vessel claims"
  ON public.vessel_claims FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.vessel_claims TO authenticated;
GRANT ALL    ON public.vessel_claims TO service_role;

-- ── 3. vessel_contacts — persons-in-charge (owner/admin-gated) ──────────────
CREATE TABLE IF NOT EXISTS public.vessel_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id  UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
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
      SELECT 1 FROM public.vessel_claims vc
      WHERE vc.vessel_id = vessel_contacts.vessel_id
        AND vc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage vessel contacts" ON public.vessel_contacts;
CREATE POLICY "Admins manage vessel contacts"
  ON public.vessel_contacts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.vessel_contacts TO authenticated;
GRANT ALL    ON public.vessel_contacts TO service_role;

-- ── 4. register_vessel(jsonb) — self-service registration ───────────────────
-- Faithful to the archived 20260601000940 definition, with ONE addition:
-- 'Cargo Ship' (workbook term) is normalised to the stored canon 'General
-- Cargo' so manual and synced rows never fragment (VESSEL_TYPE alias decision).
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
  ) INTO v_has_active_vessel_profile;

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
      RAISE EXCEPTION
        'A vessel with IMO number % already exists in the register. '
        'If this is your vessel, please contact Arab ShipBroker to claim it.',
        v_imo;
    END IF;
  END IF;

  INSERT INTO public.vessels (
    vessel_name, imo_number, vessel_type,
    dwt_grain, dwt_bale, gross_tonnage, scnrt, grain_cbm, bale_cbm,
    build_year, flag, flag_category,
    is_geared, crane_count, crane_swl_mt, grain_certified, dg_certified,
    max_loa_m, max_draft_m, pi_club,
    owner_company, owner_country, manager_company, manager_country,
    commercial_manager_company, commercial_manager_country,
    commercial_manager_contact, commercial_manager_email, commercial_manager_phone,
    charter_status, tc_charterer_name, tc_expiry, bbc_charterer_name, bbc_expiry,
    pi_ig_member, pi_coverage_types, war_risk_trading, war_risk_conditions,
    preferred_trading_areas, preferred_zones, notes,
    scope, risk_level, is_sanctioned
  ) VALUES (
    TRIM(payload->>'vessel_name'),
    v_imo,
    CASE WHEN payload->>'vessel_type' = 'Cargo Ship'
         THEN 'General Cargo' ELSE payload->>'vessel_type' END::public.vessel_type_enum,
    NULLIF(payload->>'dwt_grain',     '')::INTEGER,
    NULLIF(payload->>'dwt_bale',      '')::INTEGER,
    NULLIF(payload->>'gross_tonnage', '')::INTEGER,
    NULLIF(payload->>'scnrt',         '')::INTEGER,
    NULLIF(payload->>'grain_cbm',     '')::INTEGER,
    NULLIF(payload->>'bale_cbm',      '')::INTEGER,
    NULLIF(payload->>'build_year',    '')::SMALLINT,
    NULLIF(TRIM(payload->>'flag'), ''),
    NULLIF(payload->>'flag_category', '')::public.flag_category_enum,
    CASE WHEN payload->>'is_geared' = 'true' THEN TRUE
         WHEN payload->>'is_geared' = 'false' THEN FALSE ELSE NULL END,
    NULLIF(payload->>'crane_count',  '')::SMALLINT,
    NULLIF(payload->>'crane_swl_mt', '')::NUMERIC,
    CASE WHEN payload->>'grain_certified' = 'true' THEN TRUE
         WHEN payload->>'grain_certified' = 'false' THEN FALSE ELSE NULL END,
    CASE WHEN payload->>'dg_certified' = 'true' THEN TRUE
         WHEN payload->>'dg_certified' = 'false' THEN FALSE ELSE NULL END,
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
    CASE WHEN payload->>'pi_ig_member' = 'true' THEN TRUE
         WHEN payload->>'pi_ig_member' = 'false' THEN FALSE ELSE NULL END,
    CASE WHEN jsonb_typeof(payload->'pi_coverage_types') = 'array'
          AND jsonb_array_length(payload->'pi_coverage_types') > 0
      THEN ARRAY(SELECT TRIM(v) FROM jsonb_array_elements_text(payload->'pi_coverage_types') AS v
                 WHERE NULLIF(TRIM(v), '') IS NOT NULL)
      ELSE NULL END,
    NULLIF(TRIM(payload->>'war_risk_trading'), ''),
    NULLIF(TRIM(payload->>'war_risk_conditions'), ''),
    CASE WHEN jsonb_typeof(payload->'preferred_trading_areas') = 'array'
          AND jsonb_array_length(payload->'preferred_trading_areas') > 0
      THEN ARRAY(SELECT TRIM(v) FROM jsonb_array_elements_text(payload->'preferred_trading_areas') AS v
                 WHERE NULLIF(TRIM(v), '') IS NOT NULL)
      ELSE NULL END,
    CASE WHEN jsonb_typeof(payload->'preferred_zones') = 'array'
          AND jsonb_array_length(payload->'preferred_zones') > 0
      THEN ARRAY(SELECT z::public.zone_enum FROM jsonb_array_elements_text(payload->'preferred_zones') AS z
                 WHERE NULLIF(TRIM(z), '') IS NOT NULL)
      ELSE NULL END,
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
    SELECT v_vessel_id,
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

REVOKE ALL ON FUNCTION public.register_vessel(JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_vessel(JSONB) TO authenticated, service_role;

-- ── 5. v_my_vessels — the user's claimed fleet + latest open position ────────
DROP VIEW IF EXISTS public.v_my_vessels;
CREATE VIEW public.v_my_vessels AS
WITH latest_open AS (
  SELECT DISTINCT ON (va.vessel_id)
    va.vessel_id, va.open_port_name, va.open_port_locode, va.open_zone, va.open_date
  FROM public.vessel_availability va
  WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED'
  ORDER BY va.vessel_id, va.created_at DESC
),
open_counts AS (
  SELECT va.vessel_id,
         COUNT(*) FILTER (WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED')
           AS open_availability_count
  FROM public.vessel_availability va
  GROUP BY va.vessel_id
)
SELECT
  v.*,
  vc.user_id,
  vc.role       AS claim_role,
  vc.created_at AS claimed_at,
  COALESCE(oc.open_availability_count, 0)::BIGINT AS open_availability_count,
  lo.open_port_name, lo.open_port_locode, lo.open_zone, lo.open_date
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN open_counts oc ON oc.vessel_id = v.id
LEFT JOIN latest_open lo ON lo.vessel_id = v.id
WHERE vc.user_id = auth.uid();

GRANT SELECT ON public.v_my_vessels TO authenticated;

-- ── 6. Contact firewall — replicated EXACTLY from archived 20260601000200 ────
-- 6a. Owner-check helper.
CREATE OR REPLACE FUNCTION public.fn_is_vessel_owner(p_vessel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vessel_claims vc
    WHERE vc.vessel_id = p_vessel_id AND vc.user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_is_vessel_owner(uuid) TO authenticated;

-- 6b. Base-table PII lockdown: revoke blanket SELECT, re-grant non-PII columns.
DO $$
DECLARE
  pii text[] := ARRAY[
    'owner_company','owner_country',
    'manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country',
    'commercial_manager_contact','commercial_manager_email','commercial_manager_phone',
    'pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'
  ];
  col text;
BEGIN
  EXECUTE 'REVOKE SELECT ON public.vessels FROM anon, authenticated';
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vessels'
      AND column_name <> ALL (pii)
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.vessels TO anon, authenticated', col);
  END LOOP;
END $$;

-- 6c. Masked read view (PII → NULL unless admin or the vessel's own owner).
DROP VIEW IF EXISTS public.v_vessel_detail;
DO $$
DECLARE
  pii text[] := ARRAY[
    'owner_company','owner_country',
    'manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country',
    'commercial_manager_contact','commercial_manager_email','commercial_manager_phone',
    'pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'
  ];
  sel text := '';
  col text;
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vessels'
    ORDER BY ordinal_position
  LOOP
    IF sel <> '' THEN sel := sel || ', '; END IF;
    IF col = ANY (pii) THEN
      sel := sel || format(
        'CASE WHEN public.is_admin() OR public.fn_is_vessel_owner(v.id) '
        || 'THEN v.%I ELSE NULL END AS %I', col, col);
    ELSE
      sel := sel || format('v.%I', col);
    END IF;
  END LOOP;

  EXECUTE format(
    'CREATE VIEW public.v_vessel_detail AS SELECT %s FROM public.vessels v '
    || 'WHERE v.is_sanctioned = FALSE '
    || 'OR public.is_admin() OR public.fn_is_vessel_owner(v.id)',
    sel);
END $$;

GRANT SELECT ON public.v_vessel_detail TO authenticated;
