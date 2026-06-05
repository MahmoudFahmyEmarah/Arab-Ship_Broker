-- ============================================================
-- Firewall proof harness — replicates Supabase auth scaffolding + the
-- EXACT firewall SQL from the migrations, then seeds admin/member/owner.
-- PostgREST runs queries as these roles with request.jwt.claims set, so
-- proving behaviour here = proving it at the API layer.
-- ============================================================

-- Supabase-style roles
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

-- auth.uid() reads the JWT 'sub' claim, exactly like Supabase
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── public.users (app profile + tiers) ───────────────────────
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid UNIQUE,
  email text,
  role text DEFAULT 'broker',
  access_tier text DEFAULT 'guest',
  trust_tier text DEFAULT 'NEW'
);
GRANT SELECT ON public.users TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE supabase_user_id = auth.uid() AND role = 'admin');
$$;
CREATE OR REPLACE FUNCTION public.fn_is_admin() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$ SELECT public.is_admin(); $$;

-- ── vessels (subset incl. all PII families) ──────────────────
CREATE TABLE public.vessels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_name text NOT NULL,
  imo_number text,
  dwt_grain integer,
  flag text,
  is_geared boolean,
  is_sanctioned boolean NOT NULL DEFAULT false,
  pi_club text,
  -- PII / counterparty identity
  owner_company text, owner_country text,
  manager_company text, manager_country text,
  commercial_manager_company text, commercial_manager_country text,
  commercial_manager_contact text, commercial_manager_email text, commercial_manager_phone text,
  pic_name text, website text,
  tc_charterer_name text, bbc_charterer_name text,
  -- intel (not locked)
  charter_status text
);
ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read vessels" ON public.vessels FOR SELECT TO authenticated
  USING (is_sanctioned = false);
CREATE POLICY "Admins manage vessels" ON public.vessels FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.vessels TO authenticated;          -- (will be revoked by firewall)
GRANT ALL ON public.vessels TO service_role;

CREATE TABLE public.vessel_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id uuid NOT NULL REFERENCES public.vessels(id),
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner'
);
ALTER TABLE public.vessel_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own vessel claims" ON public.vessel_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.vessel_claims TO authenticated;

-- ── cargos + legacy access view (contact tightened) ──────────
CREATE TABLE public.cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  load_port text, discharge_port text, status text DEFAULT 'IN',
  contact_name text, contact_email text, contact_phone text, contact_role text
);
GRANT SELECT ON public.cargos TO anon, authenticated;

-- =============== FIREWALL SQL (copied from migrations) ===============

-- fn_is_vessel_owner (from 20260601000200)
CREATE OR REPLACE FUNCTION public.fn_is_vessel_owner(p_vessel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.vessel_claims vc
                 WHERE vc.vessel_id = p_vessel_id AND vc.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.fn_is_vessel_owner(uuid) TO authenticated;

-- Base-table column lockdown (dynamic) — from 20260601000200
DO $$
DECLARE
  pii text[] := ARRAY['owner_company','owner_country','manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country','commercial_manager_contact',
    'commercial_manager_email','commercial_manager_phone','pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'];
  col text;
BEGIN
  EXECUTE 'REVOKE SELECT ON public.vessels FROM anon, authenticated';
  FOR col IN SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vessels' AND column_name <> ALL(pii)
  LOOP EXECUTE format('GRANT SELECT (%I) ON public.vessels TO anon, authenticated', col); END LOOP;
END $$;

-- Masked view v_vessel_detail (dynamic) — from 20260601000200
DROP VIEW IF EXISTS public.v_vessel_detail;
DO $$
DECLARE
  pii text[] := ARRAY['owner_company','owner_country','manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country','commercial_manager_contact',
    'commercial_manager_email','commercial_manager_phone','pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'];
  sel text := ''; col text;
BEGIN
  FOR col IN SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vessels' ORDER BY ordinal_position
  LOOP
    IF sel <> '' THEN sel := sel || ', '; END IF;
    IF col = ANY(pii) THEN
      sel := sel || format('CASE WHEN public.is_admin() OR public.fn_is_vessel_owner(v.id) THEN v.%I ELSE NULL END AS %I', col, col);
    ELSE sel := sel || format('v.%I', col); END IF;
  END LOOP;
  EXECUTE format('CREATE VIEW public.v_vessel_detail AS SELECT %s FROM public.vessels v WHERE v.is_sanctioned = FALSE OR public.is_admin() OR public.fn_is_vessel_owner(v.id)', sel);
END $$;
GRANT SELECT ON public.v_vessel_detail TO authenticated;

-- Tightened cargos_access_view contact (from 20260601000100)
CREATE OR REPLACE VIEW public.cargos_access_view AS
 SELECT c.id, c.load_port, c.discharge_port, c.status,
   case when public.is_admin() OR c.user_id = auth.uid() then c.contact_name  else null end as contact_name,
   case when public.is_admin() OR c.user_id = auth.uid() then c.contact_email else null end as contact_email,
   case when public.is_admin() OR c.user_id = auth.uid() then c.contact_phone else null end as contact_phone,
   case when public.is_admin() OR c.user_id = auth.uid() then c.contact_role  else null end as contact_role
 from public.cargos c where c.status = 'IN';
GRANT SELECT ON public.cargos_access_view TO anon, authenticated;

-- =============== SEED ACTORS & DATA ===============
INSERT INTO auth.users (id, email) VALUES
 ('11111111-1111-1111-1111-111111111111','admin@asb.test'),
 ('22222222-2222-2222-2222-222222222222','member@asb.test'),
 ('33333333-3333-3333-3333-333333333333','owner@asb.test');
INSERT INTO public.users (supabase_user_id, email, role, access_tier) VALUES
 ('11111111-1111-1111-1111-111111111111','admin@asb.test','admin','member'),
 ('22222222-2222-2222-2222-222222222222','member@asb.test','broker','member'),
 ('33333333-3333-3333-3333-333333333333','owner@asb.test','vessel_owner','member');

INSERT INTO public.vessels (id, vessel_name, imo_number, dwt_grain, flag, is_geared, owner_company,
  owner_country, manager_company, commercial_manager_email, commercial_manager_phone, pic_name,
  website, tc_charterer_name, charter_status, pi_club)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','MV FIREWALL TEST','9000001',8200,'Panama',true,
  'Poseidon Shipping Ltd','Greece','Triton Mgmt','ceo@poseidon.example','+30 555 0001',
  'Capt. Nikos','poseidon.example','Cargill','TC until Dec','Gard P&I');

-- owner (user 3) claims the vessel
INSERT INTO public.vessel_claims (vessel_id, user_id, role)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','owner');

-- a cargo owned by the MEMBER (user 2) — they should see their OWN contact
INSERT INTO public.cargos (id, user_id, load_port, discharge_port, status, contact_name, contact_email, contact_phone, contact_role)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','Alexandria','Jeddah','IN','My Own Self','me@member.test','+1 555 9',  'broker');
-- a cargo owned by SOMEONE ELSE (user 3) — member must NOT see its contact
INSERT INTO public.cargos (id, user_id, load_port, discharge_port, status, contact_name, contact_email, contact_phone, contact_role)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','33333333-3333-3333-3333-333333333333','Constanta','Sohar','IN','Counterparty Contact','secret@owner.test','+99 000 1','shipper');
