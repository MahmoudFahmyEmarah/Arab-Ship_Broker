-- ════════════════════════════════════════════════════════════════════
-- Arab ShipBroker — FOUNDATION bundle for production (generated 2026-06-12)
--
-- WHY: the production database has the marketplace core (users, vessels,
-- cargo_listings, ports) but is MISSING the account/company layer entirely:
-- no public.profiles, no public.organizations, no public.organization_members.
-- Signup personas, the Account page, vessel registration gating and the whole
-- Team/Company feature have nowhere to live until these exist.
--
-- HOW TO APPLY (Supabase SQL editor):
--   1. Run THIS file once.
--   2. Then run APPLY_PENDING.sql once more (idempotent) — its org/profile
--      sections that were skipped before now apply against the new tables.
--
-- Safe by construction: idempotent (re-runnable), additive only, and column-
-- agnostic where prod's users table may differ from the repo schema. Nothing
-- here weakens the contact firewall — desk contact stays behind RLS, and the
-- new owner checks are backward-compatible with owner_user_id.
-- ════════════════════════════════════════════════════════════════════

SET check_function_bodies = off;

-- ── 1. users.supabase_user_id — make every row resolvable from auth.uid() ──
-- Legacy rows were created with id = auth.uid(); newer rows key auth identity
-- in supabase_user_id. Backfilling id into NULL supabase_user_id makes ONE
-- lookup column valid for both generations.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS supabase_user_id uuid;
UPDATE public.users SET supabase_user_id = id WHERE supabase_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_supabase_user_id ON public.users (supabase_user_id);

-- ── 2. fn_app_user_id — THE canonical auth.uid() → users.id resolver ──
-- (Same definition as APPLY_PENDING …001030; defined here too so this bundle
-- is self-sufficient whichever order they run in.)
CREATE OR REPLACE FUNCTION public.fn_app_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM public.users WHERE supabase_user_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.users WHERE id = auth.uid() LIMIT 1)
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_app_user_id() TO authenticated;

-- ── 3. fn_set_updated_at — create only if this database doesn't have it ──
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_set_updated_at'
  ) THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.fn_set_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $fn$;
    $ddl$;
  END IF;
END $mig$;

-- ── 4. Admin predicates — create ONLY the missing one(s), never replace ──
-- Policies below reference fn_is_admin(); profiles policy mirrors is_admin().
-- The shim reads users via to_jsonb so it works whatever columns prod has.
DO $mig$
DECLARE
  has_fn  boolean;
  has_old boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'fn_is_admin') INTO has_fn;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'is_admin') INTO has_old;

  IF NOT has_fn AND has_old THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.fn_is_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
        SELECT public.is_admin();
      $fn$;
    $ddl$;
  ELSIF NOT has_fn THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.fn_is_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
        SELECT EXISTS (
          SELECT 1 FROM public.users u
          WHERE (u.supabase_user_id = auth.uid() OR u.id = auth.uid())
            AND (to_jsonb(u) ->> 'role') = 'admin'
        );
      $fn$;
    $ddl$;
  END IF;

  IF NOT has_old THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.is_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
        SELECT public.fn_is_admin();
      $fn$;
    $ddl$;
  END IF;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated';
END $mig$;

-- ── 5. profiles — the cargo/vessel persona layer (from …000010) ──
DO $$ BEGIN
  CREATE TYPE public.profile_type_enum AS ENUM ('cargo', 'vessel');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Links to public.users.id (NOT supabase_user_id — one level of indirection)
  account_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_type     public.profile_type_enum NOT NULL,
  display_name     TEXT,
  company          TEXT,
  phone            TEXT,   -- PII — encrypt at app layer
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, profile_type)
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_account ON public.profiles (account_id);
CREATE INDEX IF NOT EXISTS idx_profiles_type    ON public.profiles (profile_type);
CREATE INDEX IF NOT EXISTS idx_profiles_active  ON public.profiles (account_id, is_active);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Own-row policies key off fn_app_user_id() (SECURITY DEFINER) — resolves
-- BOTH user generations and needs no users-table grant for the caller.
DROP POLICY IF EXISTS "Users read own profiles" ON public.profiles;
CREATE POLICY "Users read own profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (account_id = public.fn_app_user_id());

DROP POLICY IF EXISTS "Users insert own profiles" ON public.profiles;
CREATE POLICY "Users insert own profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (account_id = public.fn_app_user_id());

DROP POLICY IF EXISTS "Users update own profiles" ON public.profiles;
CREATE POLICY "Users update own profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (account_id = public.fn_app_user_id());

DROP POLICY IF EXISTS "Admins manage profiles" ON public.profiles;
CREATE POLICY "Admins manage profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- ── 6. Backfill: every existing user gets profiles matching their role ──
-- to_jsonb keeps this column-agnostic (works whether role is enum or text,
-- and whether full_name/company exist on this database's users table).
INSERT INTO public.profiles (account_id, profile_type, display_name, company)
SELECT u.id, 'cargo'::public.profile_type_enum,
       COALESCE(to_jsonb(u) ->> 'full_name', to_jsonb(u) ->> 'name'),
       to_jsonb(u) ->> 'company'
FROM public.users u
WHERE (to_jsonb(u) ->> 'role') IN ('cargo_owner', 'broker')
ON CONFLICT (account_id, profile_type) DO NOTHING;

INSERT INTO public.profiles (account_id, profile_type, display_name, company)
SELECT u.id, 'vessel'::public.profile_type_enum,
       COALESCE(to_jsonb(u) ->> 'full_name', to_jsonb(u) ->> 'name'),
       to_jsonb(u) ->> 'company'
FROM public.users u
WHERE (to_jsonb(u) ->> 'role') IN ('vessel_owner', 'broker')
ON CONFLICT (account_id, profile_type) DO NOTHING;

-- ── 7. create_account_with_profiles — the signup RPC (service-role only) ──
-- Inserts the users row + persona profiles atomically. The users INSERT is
-- built dynamically from the columns THIS database actually has, with %L
-- literals so values assignment-cast to enum or text alike; anything not
-- listed (trust_tier, is_active, …) takes the table default.
CREATE OR REPLACE FUNCTION public.create_account_with_profiles(
  p_supabase_user_id UUID,
  p_name             TEXT,
  p_email            TEXT,
  p_profiles         public.profile_type_enum[]
)
RETURNS public.users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user public.users;
  v_pt   public.profile_type_enum;
  v_cols text := 'id, supabase_user_id, email';
  v_vals text;
  v_role text := CASE
    WHEN 'cargo'::public.profile_type_enum  = ANY (p_profiles)
     AND 'vessel'::public.profile_type_enum = ANY (p_profiles) THEN 'broker'
    WHEN 'cargo'::public.profile_type_enum  = ANY (p_profiles) THEN 'cargo_owner'
    ELSE 'vessel_owner'
  END;
BEGIN
  v_vals := format('%L, %L, %L', p_supabase_user_id, p_supabase_user_id, p_email);

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name') THEN
    v_cols := v_cols || ', name';
    v_vals := v_vals || format(', %L', p_name);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'full_name') THEN
    v_cols := v_cols || ', full_name';
    v_vals := v_vals || format(', %L', p_name);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') THEN
    v_cols := v_cols || ', role';
    v_vals := v_vals || format(', %L', v_role);
  END IF;

  EXECUTE format('INSERT INTO public.users (%s) VALUES (%s) RETURNING *', v_cols, v_vals)
    INTO v_user;

  FOREACH v_pt IN ARRAY p_profiles LOOP
    INSERT INTO public.profiles (account_id, profile_type, display_name)
    VALUES (v_user.id, v_pt, p_name)
    ON CONFLICT (account_id, profile_type) DO NOTHING;
  END LOOP;

  RETURN v_user;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_account_with_profiles(uuid, text, text, public.profile_type_enum[]) TO service_role;

-- ── 8. organizations + organization_members (…000800 + …000880 + …000890) ──
CREATE TABLE IF NOT EXISTS public.organizations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  org_type          text NOT NULL DEFAULT 'other'
                      CHECK (org_type IN ('owner','charterer','broker','operator','manager','other')),
  subscription_tier text,
  country           text,
  imo               text,
  fleet_total       integer,
  address           text,
  -- the marketplace contact channel — the firm's desk, never an individual
  desk_contact_name text,
  desk_email        text,
  desk_phone        text,
  email_domains     text[],
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'broker'
                CHECK (member_role IN ('admin','broker','viewer')),
  is_current  boolean NOT NULL DEFAULT true,
  added_at    timestamptz NOT NULL DEFAULT now(),
  -- claim-on-signup lifecycle (…000880/…000890)
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('pending','active','rejected')),
  requested_company_name text,
  requested_email_domain text,
  decided_at             timestamptz,
  decided_by             uuid REFERENCES public.users(id),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id) WHERE is_current;

-- ── 9. fn_my_org_ids — the firewall key (canonical, via fn_app_user_id) ──
CREATE OR REPLACE FUNCTION public.fn_my_org_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(org_id), '{}')
  FROM public.organization_members
  WHERE user_id = public.fn_app_user_id() AND is_current;
$$;
GRANT EXECUTE ON FUNCTION public.fn_my_org_ids() TO authenticated;

-- ── 10. Org RLS — members read their own org + co-members; admin manages ──
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orgs readable to own members" ON public.organizations;
CREATE POLICY "orgs readable to own members" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.fn_is_admin() OR id = ANY (public.fn_my_org_ids()));

DROP POLICY IF EXISTS "orgs admin writes" ON public.organizations;
CREATE POLICY "orgs admin writes" ON public.organizations
  FOR ALL TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

DROP POLICY IF EXISTS "members read own org" ON public.organization_members;
CREATE POLICY "members read own org" ON public.organization_members
  FOR SELECT TO authenticated
  USING (public.fn_is_admin() OR org_id = ANY (public.fn_my_org_ids()));

DROP POLICY IF EXISTS "members managed by org admin" ON public.organization_members;
CREATE POLICY "members managed by org admin" ON public.organization_members
  FOR ALL TO authenticated
  USING (
    public.fn_is_admin()
    OR EXISTS (SELECT 1 FROM public.organization_members m
               WHERE m.org_id = organization_members.org_id
                 AND m.user_id = public.fn_app_user_id()
                 AND m.member_role = 'admin' AND m.is_current)
  )
  WITH CHECK (
    public.fn_is_admin()
    OR EXISTS (SELECT 1 FROM public.organization_members m
               WHERE m.org_id = organization_members.org_id
                 AND m.user_id = public.fn_app_user_id()
                 AND m.member_role = 'admin' AND m.is_current)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.organization_members TO authenticated;
GRANT ALL ON public.organizations, public.organization_members TO service_role;

-- ── 11. Company-level ownership + org-aware owner checks (…000800) ──
-- Guarded: only where this database has the ownership/availability tables.
DO $mig$
BEGIN
  IF to_regclass('public.listing_ownership') IS NULL THEN
    RAISE NOTICE 'public.listing_ownership not present — skipping owner_org_id + org-aware owner checks';
    RETURN;
  END IF;

  ALTER TABLE public.listing_ownership
    ADD COLUMN IF NOT EXISTS owner_org_id uuid REFERENCES public.organizations(id);
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_listing_ownership_org ON public.listing_ownership (owner_org_id) WHERE is_current';

  -- Backward-compatible: unchanged where owner_org_id is NULL (still true for
  -- the row's own owner_user_id — prod stores auth.uid() there).
  IF to_regclass('public.vessel_availability') IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.fn_owns_vessel(p_vessel_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
        SELECT EXISTS (
          SELECT 1
          FROM public.listing_ownership lo
          JOIN public.vessel_availability va ON va.id = lo.listing_id
          WHERE va.vessel_id = p_vessel_id
            AND lo.listing_type = 'vessel_availability'
            AND lo.is_current = true
            AND lo.role = 'primary'
            AND (
              lo.owner_user_id = auth.uid()
              OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
            )
        );
      $fn$;
    $ddl$;
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.fn_owns_vessel(uuid) TO authenticated';
  END IF;

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.fn_owns_cargo(p_cargo_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT EXISTS (
        SELECT 1
        FROM public.listing_ownership lo
        WHERE lo.listing_id = p_cargo_id
          AND lo.listing_type = 'cargo'
          AND lo.is_current = true
          AND lo.role = 'primary'
          AND (
            lo.owner_user_id = auth.uid()
            OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
          )
      );
    $fn$;
  $ddl$;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fn_owns_cargo(uuid) TO authenticated';
END $mig$;

-- ── 12. Registry search — public facts only, no desk contact (firewall) ──
CREATE OR REPLACE FUNCTION public.fn_search_organizations(q text)
RETURNS TABLE (id uuid, name text, org_type text, country text, fleet_total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name, o.org_type, o.country, o.fleet_total
  FROM public.organizations o
  WHERE length(btrim(coalesce(q, ''))) >= 2
    AND o.name ILIKE '%' || btrim(q) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;
GRANT EXECUTE ON FUNCTION public.fn_search_organizations(text) TO authenticated;

-- ── 13. Company registry seed (…000840 — 80 real owner/manager firms) ──
-- Idempotent (ON CONFLICT DO NOTHING); no fabricated desk contacts.


CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_key ON public.organizations (name);

INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ORIENT SEAS LTD CO', 'owner', 'T2', 'Saudi Arabia', '6285232', 5, '6th Floor, Al Falih Building, 2491 Taweriq, Al-Saddad District, Jeddah, Saudi Arabia', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('THALATTA SHIPPING MANAGEMENT', 'manager', 'T2', NULL, '0067951', 5, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('KAREWOOD MANAGEMENT OU', 'manager', 'T2', NULL, '6362654', 4, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SUEZ SHIP MANAGEMENT', 'manager', 'T2', 'Egypt', NULL, 4, 'Shop 1, 359, 23rd July Street, Suez 35923, Egypt', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ADRIATIC FOR MANAGEMENT', 'manager', 'T2', 'Egypt', NULL, 2, '20 Mahmoud Hamdy Street, Alexandria 21514, Egypt', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('CAPITAL SEA FLEET INC', 'owner', 'T2', NULL, '6477421', 2, NULL, 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('GENCO GEMI ISLETMECILIGI', 'manager', 'T2', NULL, '0352051', 2, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('GMZ SHIP MANAGEMENT CO HELLAS', 'manager', 'T2', 'Greece', NULL, 2, '1 Charilaou Trikoupi Street, 185 36, Piraeus, Greece', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('OCEAN SOUL SHIP MANAGEMENT', 'manager', 'T2', NULL, '0419817', 2, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('TRIMPEX UNION LTD', 'manager', 'T2', NULL, '1552211', 2, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ABK SHIPPING CO', 'owner', 'T2', 'Lebanon', '5901913', 1, 'C/O Cedar Marine Services SAL, Apartment 3/A, 3rd Floor, Sofi Plaza, Achier el-Daya Street, Tripoli, Lebanon', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('AISLING MARITIME AB LLC', 'owner', 'T2', 'Lebanon', NULL, 1, 'C/O Safe Sea Services Sarl, 3rd Floor, Dina 11 Building, Mar Doumit Street, Sahel Aalma, Jounieh, Lebanon', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('AL TAWFEEQ SHIPPING CO LTD', 'owner', 'T2', 'Lebanon', NULL, 1, 'C/O Rabunion Maritime Agency Sarl, 1st Floor, Agha Building, Charles de Gaulle Avenue, Raouche, Beirut', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ALBANYASIA MARINE SERVICES', 'owner', 'T2', 'Egypt', '6116687', 1, 'C/O Sena Ship Management SA, 4th Floor, 25 Reda Street, Ismailia, Egypt', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ALMARASI SHIPPING CO LTD', 'owner', 'T2', 'Saudi Arabia', NULL, 1, 'Issa al-Adawi, al-Baghdadiyah, Jeddah 22231, Saudi Arabia', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ALODAYNI BROTHERS', 'owner', 'T2', 'Egypt', '6082809', 1, 'C/O Adriatic for Management & Services Marine Ltd, 20 Mahmoud Hamdy Street, Alexandria 21514, Egypt', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('AQUAMAR SHIP MANAGEMENT SL', 'manager', 'T2', NULL, '0437637', 1, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ARIAZ WORLD WIDE SHIPPING CORP', 'manager', 'T2', 'UAE', NULL, 1, 'Unit 801, Bays Tower, Business Bay, Bur Dubai, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ARIS SHIPPING LTD-MAI', 'owner', 'T2', NULL, '6393373', 1, NULL, 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('AWAD AEED AL-OADINI EST', 'manager', 'T2', 'Saudi Arabia', NULL, 1, 'PO Box 16818, Jeddah, Saudi Arabia', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('AYATI SHIPPING CO LLC', 'owner', 'T2', 'Belize', NULL, 1, '3301 Chetumal Street, Belize City, Belize', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('BOS SHIPPING SA-LIB', 'manager', 'T2', 'UAE', NULL, 1, 'Industrial Area 4, Sharjah, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('CAESAR MARITIME CO SA', 'manager', 'T2', 'UAE', NULL, 1, 'Room 9, 37G, Leased Offices Building, Hamriyah Free Zone, PO Box 49097, Sharjah, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('CEDAR MARINE SERVICES SAL', 'manager', 'T2', 'Lebanon', NULL, 1, 'Apartment 3/A, 3rd Floor, Sofi Plaza, Achier el-Daya Street, Tripoli, Lebanon', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('CHINA UNITED LINES LTD (CU Lines)', 'manager', 'T2', 'China', NULL, 1, 'Building 12, 706 Wuxing Lu, Pudong Xinqu, Shanghai 201204, China', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('CU LINES LTD', 'owner', 'T2', 'China', NULL, 1, 'C/O China United Lines Ltd (CU Lines), Building 12, 706 Wuxing Lu, Pudong Xinqu, Shanghai 201204', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('DENIZ ID MARITIME LTD', 'owner', 'T2', 'Turkey', NULL, 1, 'C/O Overseas Marine Ltd, Vatan Caddesi, Merkez Mah, 12/13, Mezitli, Mersin, Turkey', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('DJIBOUTI SHIPPING CO FZE', 'owner', 'T2', 'Djibouti', NULL, 1, 'LOB-027, rue de Venise, Djibouti Free Zone, Djibouti', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('DOLPHIN SEAMARINE LTD', 'owner', 'T2', 'Liberia', NULL, 1, '80 Broad Street, Monrovia, Liberia', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('EAST SHIPPING LINES LTD', 'owner', 'T2', 'Jordan', '5974603', 1, 'Office 1003, King Hussein Street 264, Amman, Jordan', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('EL REEDY SHIPPING AGENCY', 'manager', 'T2', 'Egypt', NULL, 1, 'Villa No 1, Street 39, Ras El Bar, Damietta, Egypt', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ELREEDY STARS FOR OWNING', 'owner', 'T2', 'Egypt', NULL, 1, 'C/O El Reedy Shipping Agency, Villa No 1, Street 39, Ras El Bar, Damietta, Egypt', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ETHIOPIAN SHIPPING & LOGISTICS', 'owner', 'T2', 'Ethiopia', NULL, 1, 'Kirkos District, Woreda 07, Addis Ababa, Ethiopia', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('EURO WEST SHIPPING LTD-MAI', 'owner', 'T2', NULL, '0059876', 1, NULL, 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('FADAK MARINE SHIPPING LLC', 'owner', 'T2', 'UAE', NULL, 1, 'al-Majaz, PO Box 38156, Sharjah, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('FAIRNESS MARITIME COMPANY SA', 'owner', 'T2', 'Panama', NULL, 1, '3rd Floor, Omega Building, Avenida Samuel Lewis, Calle 53 Este, Panama City, Panama', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('FRIENDS SHIPPING CO', 'manager', 'T2', 'UAE', NULL, 1, 'Unit 802, Makateb Building, Port Saeed, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('GHAZAL BA', 'owner', 'T2', 'UAE', NULL, 1, 'PO Box 11398, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('GUANGXI HONGXIANG SHIPPING CO', 'owner', 'T2', 'China', '4189663', 1, 'Shop 1, Building C1, Hongsheng Garden, 136 Qinzhougang Dadao, Qinnan Qu, Qinzhou, Guangxi, China', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('HARBOR SHIPHOLDING LTD', 'owner', 'T2', 'Marshall Islands', '0045421', 1, 'Trust Company Complex, Ajeltake Road, Ajeltake, Majuro MH 96960, Marshall Islands', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('HELLENIC GLAMOR SHIP MGMT LLC', 'manager', 'T2', 'UAE', NULL, 1, 'Office 504, Ahli House 1, Amman Street, Al Nahda, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('INVICTUS TRADING FZE', 'owner', 'T2', 'UAE', '6416924', 1, 'Office LB01015, Building LB01, Jebel Ali Free Zone, Jebel Ali, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('JADROPLOV INTERNATIONAL MTME', 'manager', 'T2', 'Croatia', NULL, 1, 'Obala Kneza Branimira 16, HR-21000 Split, Croatia', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('JNS PEACE SHIPPING LTD', 'owner', 'T2', 'British Virgin Islands', '0119671', 1, 'Road Town, Tortola, British Virgin Islands', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('KHARTOUM TRADING & SHIPPING CO', 'owner', 'T2', 'Sudan', NULL, 1, 'Port Sudan, Sudan', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('LABIRINTA HOLDING LTD', 'owner', 'T2', 'Seychelles', NULL, 1, 'Suite 1, 2nd Floor, Sound & Vision House, Francis Rachel Street, Victoria, Mahe Island, Seychelles', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('LADOM SHIPPING LTD', 'owner', 'T2', 'Turkey', NULL, 1, 'Sehit Hikmet Alp Caddesi 31/12, Feyzullah Mah, Maltepe 34843, Istanbul, Turkey', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('LEVANT SHIPPING LTD-MAI', 'owner', 'T2', 'Marshall Islands', NULL, 1, 'Trust Company Complex, Ajeltake Road, Ajeltake, Majuro MH 96960, Marshall Islands', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('LIANYUNGANG JIANHONG SHIPPING', 'owner', 'T2', 'China', NULL, 1, 'Room B2202, Sunshine International Center, 2 Haibin Dadao, Lianyun Qu, Lianyungang, Jiangsu, China', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('MANTA DENIZCILIK NAKLIYAT', 'manager', 'T2', 'Turkey', NULL, 1, 'Salacak Iskele Sokak, Uskudar 14, Istanbul, Turkey', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('MARSA ZENITH INC', 'owner', 'T2', 'UAE', NULL, 1, 'C/O Petra Shipping Services LLC, Office 1807, 18th Floor, Churchill Office Tower, Business Bay, Bur Dubai, PO Box 50026, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('MERRY ENTERPRISES DENIZCILIK', 'manager', 'T2', 'Turkey', NULL, 1, 'Aydinli Yolu Caddesi 10/45, Icmeler Mah, Tuzla 34957, Istanbul, Turkey', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('NAN LIAN SHIP MANAGEMENT LLC', 'manager', 'T2', 'UAE', NULL, 1, 'The Atrium Centre, 307, Khalid Bin Waleed Road (Bank Street), PO Box 82289, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('NEW SPIRIT SHIPPING LTD', 'owner', 'T2', 'Greece', NULL, 1, 'C/O GMZ Ship Management Co (Hellas) SA, 1 Charilaou Trikoupi Street, 185 36, Piraeus, Greece', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('NOATUM CSM FZCO', 'manager', 'T2', 'UAE', NULL, 1, 'Building 04, Bay Square, Al-Asayel Street, Business Bay, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('OCEAN FREIGHT ENTERPRISES SA', 'owner', 'T2', 'UAE', '6182556', 1, 'C/O Ariaz World Wide Shipping Corp, Unit 801, Bays Tower, Business Bay, Bur Dubai, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('OMRC SHIPPING INC', 'owner', 'T2', 'Turkey', NULL, 1, 'C/O Manta Denizcilik Nakliyat, Salacak Iskele Sokak, Uskudar 14, Istanbul, Turkey', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('OVERSEAS MARINE LTD', 'manager', 'T2', 'Turkey', NULL, 1, 'Vatan Caddesi, Merkez Mah, 12/13, Mezitli, Mersin, Turkey', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('PETRA SHIPPING SERVICES LLC', 'manager', 'T2', 'UAE', NULL, 1, 'Office 1807, 18th Floor, Churchill Office Tower, Business Bay, Bur Dubai, PO Box 50026, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('PRIMAVERA SHIPPING LLC', 'owner', 'T2', 'Greece', NULL, 1, 'C/O Starbulk SA, 40 Agiou Konstantinou Street, Marousi, 151 24, Athens, Greece', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('PRINCESS HIYAM SHIPPING SA', 'owner', 'T2', 'Saudi Arabia', '6082809', 1, 'C/O Awad Aeed Al-Oadini Est, PO Box 16818, Jeddah, Saudi Arabia', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('PROMAR-K LTD', 'manager', 'T2', NULL, '0049251', 1, NULL, 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('RABUNION MARITIME AGENCY SARL', 'manager', 'T2', 'Lebanon', NULL, 1, '1st Floor, Agha Building, Charles de Gaulle Avenue, Raouche, Beirut, Lebanon', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('ROXETTE SHIPPING ENTERPRISES', 'owner', 'T2', 'Turkey', '5919742', 1, 'C/O Merry Enterprises Denizcilik, Aydinli Yolu Caddesi 10/45, Icmeler Mah, Tuzla, Istanbul', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('RWS SHIPPING & TRADING SA', 'owner', 'T2', 'UAE', NULL, 1, 'C/O Friends Shipping Co, Unit 802, Makateb Building, Port Saeed, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SAFE SEA SERVICES SARL', 'manager', 'T2', 'Lebanon', NULL, 1, '3rd Floor, Dina 11 Building, Mar Doumit Street, Sahel Aalma, Jounieh, Lebanon', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SAFEEN FEEDERS 1 LTD', 'owner', 'T2', 'UAE', NULL, 1, 'C/O GFS Ship Management FZE, Office FZJOB1015, Jafza One, Jebel Ali Free Zone, Jebel Ali, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SEA EXPRESS LINE LTD', 'owner', 'T2', 'UAE', NULL, 1, 'C/O Nan Lian Ship Management LLC, The Atrium Centre, 307, Khalid Bin Waleed Road, PO Box 82289, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SEA STAR MARE LTD', 'owner', 'T2', 'UAE', '5515962', 1, 'C/O Caesar Maritime Co SA, Room 9, 37G, Leased Offices Building, Hamriyah Free Zone, PO Box 49097, Sharjah, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SENA SHIP MANAGEMENT SA', 'manager', 'T2', 'Egypt', NULL, 1, '4th Floor, 25 Reda Street, Ismailia, Egypt', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SHARP LANE SHIP CORP', 'owner', 'T2', 'China', NULL, 1, 'Room 101, Unit 1, Building 21, Mingzeyuan, Zhongshan Qu, Dalian, Liaoning, China', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SIERRA GOLD LTD', 'owner', 'T2', 'Greece', NULL, 1, 'C/O GMZ Ship Management Co (Hellas) SA, 1 Charilaou Trikoupi Street, 185 36, Piraeus, Greece', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SLA MARITIME CO SA', 'owner', 'T2', 'Turkey', NULL, 1, 'Kat 3, Karli Plaza, Bogazici Caddesi 7, Cubuklu Mah, Beykoz 34805, Istanbul, Turkey', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SOUTH STAR CARGO & SHIPPING', 'owner', 'T2', 'UAE', NULL, 1, 'Office 505, 5th Floor, Al Nokhitha Building, Al Khaleej Road, Deira, PO Box 171712, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('STARBULK SA', 'manager', 'T2', 'Greece', NULL, 1, '40 Agiou Konstantinou Street, Marousi, 151 24, Athens, Greece', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('SULTAN INTERNATIONAL CO', 'owner', 'T2', 'Qatar', NULL, 1, '690 Al Canarri Street, Zone 53, Al Rayyan, Qatar', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('TOWER SHIPPING CO SA', 'manager', 'T2', 'UAE', NULL, 1, 'Flat 202, Block A, Sheikha Latifa Building, Baniyas Road, Deira, Dubai, UAE', 'Operations Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('TROGIR MARITIME INC-MAJURO', 'owner', 'T2', 'Croatia', NULL, 1, 'C/O Jadroplov International Maritime Transport Ltd, Obala Kneza Branimira 16, HR-21000 Split, Croatia', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('VALENTINA BULKERS SA', 'owner', 'T2', 'UAE', NULL, 1, 'C/O BOS Shipping SA, Industrial Area 4, Sharjah, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.organizations (name, org_type, subscription_tier, country, imo, fleet_total, address, desk_contact_name) VALUES ('VALIANT OCEANWAY LTD', 'owner', 'T2', 'UAE', '6387613', 1, 'C/O Hellenic Glamor Ship Management LLC, Office 504, Ahli House 1, Amman Street, Al Nahda, Dubai, UAE', 'Owner''s Desk') ON CONFLICT (name) DO NOTHING;
