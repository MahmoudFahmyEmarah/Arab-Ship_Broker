-- ── 1. vessel_claims ───────────────────────────────────────────
-- Lightweight ownership record: which user registered this vessel.
-- Distinct from listing_ownership (which tracks availability posts).

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

-- Users can see their own claims
CREATE POLICY "Users see own vessel claims"
  ON public.vessel_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins manage all
CREATE POLICY "Admins manage vessel claims"
  ON public.vessel_claims FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.vessel_claims TO authenticated;
GRANT ALL    ON public.vessel_claims TO service_role;

-- ── 2. register_vessel RPC ─────────────────────────────────────
-- Allows authenticated vessel_owner users to self-register a vessel.
-- Bypasses the admin-only RLS on the vessels table via SECURITY DEFINER.
-- Enforces:
--   • Duplicate IMO guard
--   • Safe defaults: risk_level='CLEAR', scope='In Scope', is_sanctioned=false
--   • Writes a vessel_claims row linking user → vessel

CREATE OR REPLACE FUNCTION public.register_vessel(payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_vessel_id  UUID;
  v_imo        TEXT;
  v_app_role   TEXT;
BEGIN
  -- Auth guard
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Role guard: only vessel_owner role may self-register
  SELECT role INTO v_app_role
  FROM public.users
  WHERE supabase_user_id = v_user_id;

  IF v_app_role NOT IN ('vessel_owner', 'admin') THEN
    RAISE EXCEPTION 'Only vessel owners may register vessels';
  END IF;

  -- Validate required field
  IF NULLIF(TRIM(payload->>'vessel_name'), '') IS NULL THEN
    RAISE EXCEPTION 'vessel_name is required';
  END IF;

  IF NULLIF(payload->>'vessel_type', '') IS NULL THEN
    RAISE EXCEPTION 'vessel_type is required';
  END IF;

  -- Duplicate IMO guard
  v_imo := NULLIF(TRIM(payload->>'imo_number'), '');
  IF v_imo IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.vessels WHERE imo_number = v_imo) THEN
      RAISE EXCEPTION 'A vessel with IMO number % already exists in the register. If this is your vessel, please contact Arab ShipBroker to claim it.', v_imo;
    END IF;
  END IF;

  -- Insert vessel with safe defaults (admin promotes risk/scope later)
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
    notes,
    -- Risk defaults — admin will update after verification
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
    NULLIF(TRIM(payload->>'pi_club'),         ''),
    NULLIF(TRIM(payload->>'owner_company'),   ''),
    NULLIF(TRIM(payload->>'owner_country'),   ''),
    NULLIF(TRIM(payload->>'manager_company'), ''),
    NULLIF(TRIM(payload->>'manager_country'), ''),
    NULLIF(TRIM(payload->>'notes'),           ''),
    'In Scope'::public.scope_enum,
    'CLEAR'::public.risk_level_enum,
    FALSE
  )
  RETURNING id INTO v_vessel_id;

  -- Create ownership claim
  INSERT INTO public.vessel_claims (vessel_id, user_id, role)
  VALUES (v_vessel_id, v_user_id, 'owner');

  RETURN v_vessel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_vessel(JSONB) TO authenticated;

-- ── 3. get_my_vessels helper view ─────────────────────────────
-- Returns vessels the authenticated user has claimed, joined with
-- a summary of their active availability postings.

CREATE OR REPLACE VIEW public.v_my_vessels AS
SELECT
  v.id,
  v.vessel_name,
  v.imo_number,
  v.vessel_type,
  v.dwt_grain,
  v.build_year,
  v.flag,
  v.scope,
  v.risk_level,
  v.is_geared,
  v.grain_certified,
  v.dg_certified,
  v.is_sanctioned,
  v.owner_company,
  vc.user_id,
  vc.role        AS claim_role,
  vc.created_at  AS claimed_at,
  -- Count of currently OPEN availability postings for this vessel
  COUNT(va.id) FILTER (WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED')
               AS open_availability_count
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN public.vessel_availability va ON va.vessel_id = v.id
WHERE vc.user_id = auth.uid()
GROUP BY v.id, v.vessel_name, v.imo_number, v.vessel_type, v.dwt_grain,
         v.build_year, v.flag, v.scope, v.risk_level, v.is_geared,
         v.grain_certified, v.dg_certified, v.is_sanctioned, v.owner_company,
         vc.user_id, vc.role, vc.created_at;

GRANT SELECT ON public.v_my_vessels TO authenticated;