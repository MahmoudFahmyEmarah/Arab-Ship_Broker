-- ════════════════════════════════════════════════════════════════════
-- Arab ShipBroker — pending migrations bundle (generated 2026-06-12)
-- Paste this WHOLE file into the Supabase SQL editor and click Run ONCE.
-- Every statement is idempotent: safe to re-run if some were applied.
-- Order: …000950 → 000960 → 000970 → 000990 → 001000 → 001010 → 001020 → 001030
-- ════════════════════════════════════════════════════════════════════

-- ───────────────────────── 20260601000950_public_stats_totals ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Landing live counters — WIDENED to platform totals · append-only · firewall-safe
--
-- Redefines get_public_stats() so the public hero reflects the REAL platform
-- figures (matching the unified master dataset: 731 cargo, 88 vessels, 16 trade
-- zones) instead of the narrow ±7-day open window — which read as a dead "0"
-- whenever nothing happened to fall inside that window.
--
-- New definitions (still aggregate-only — three integers, no rows, no PII,
-- no service-role key; SECURITY DEFINER so the counts are correct under RLS):
--   cargo_count  = total cargo listings held (every record, "Cargo Records").
--   vessel_count = total vessels in the register ("Vessels Tracked").
--   zone_count   = distinct trade zones the platform covers (ports.zone,
--                  excluding the 'Unknown' sentinel).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
SELECT jsonb_build_object(
  'cargo_count',  (SELECT count(*)::int FROM public.cargo_listings),
  'vessel_count', (SELECT count(*)::int FROM public.vessels),
  'zone_count',   (SELECT count(DISTINCT zone)::int
                   FROM public.ports
                   WHERE zone IS NOT NULL AND zone <> 'Unknown')
);
$$;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;

-- ───────────────────────── 20260601000960_zone_enum_additions ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Zone enum additions — append-only
--
-- The unified master dataset covers two trade zones not yet in zone_enum:
--   ECSA — East Coast South America
--   WCI  — West Coast India
-- Add them so ports / cargo / vessel positions in those zones import cleanly
-- and the public zone counter reflects the real 16-zone coverage.
-- (ADD VALUE IF NOT EXISTS is idempotent; must be committed before any seed
--  that references the new values can use them.)
-- ════════════════════════════════════════════════════════════════════

ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'ECSA';
ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'WCI';

-- ───────────────────────── 20260601000970_profile_market_fields ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Market Profile fields — append-only
--
-- The Settings "Market Profile" card showed Operating zones / Preferred cargo
-- / DWT range focus as "Not set" because they had no storage. Add them to the
-- per-account profile so members can declare their trading focus (visible to
-- Arab ShipBroker only — same row the owner already updates via RLS).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS operating_zones public.zone_enum[],
  ADD COLUMN IF NOT EXISTS preferred_cargo TEXT[],
  ADD COLUMN IF NOT EXISTS dwt_min INTEGER CHECK (dwt_min IS NULL OR dwt_min >= 0),
  ADD COLUMN IF NOT EXISTS dwt_max INTEGER CHECK (dwt_max IS NULL OR dwt_max >= 0);

-- Owners already have UPDATE on their own profiles (RLS "Users update own
-- profiles"); make sure the new columns are grantable.
GRANT SELECT (operating_zones, preferred_cargo, dwt_min, dwt_max),
      UPDATE (operating_zones, preferred_cargo, dwt_min, dwt_max)
  ON public.profiles TO authenticated;

-- ───────────────────────── 20260601000990_ports_seaward_bearing ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Ports — seaward bearing · append-only (09_pre_final_polish §7)
--
-- Compass direction (degrees, 0 = North) from the port toward open water.
-- Drives geographic marker anchoring on every map: cargo is placed LANDWARD
-- (opposite the bearing — goods at the terminal, never floating), vessels
-- SEAWARD (in the approaches, never on land); same-port jitter runs along
-- the coast-parallel axis only so it can never flip a marker across the
-- coastline. Per the spec, this belongs in the ports table beside lat/lng —
-- not hardcoded in the UI.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS seaward_bearing SMALLINT
    CHECK (seaward_bearing IS NULL OR (seaward_bearing BETWEEN 0 AND 359));

GRANT SELECT (seaward_bearing) ON public.ports TO authenticated;

-- Surveyed bearings from the design registry (asb/map.jsx PORTS). Ports not
-- listed keep NULL → the UI falls back to plain coordinate jitter.
UPDATE public.ports SET seaward_bearing = v.b
FROM (VALUES
  ('Constanta', 110), ('Istanbul', 180), ('Novorossiysk', 225), ('Odessa', 135),
  ('Izmir', 270), ('Piraeus', 200), ('Mersin', 180), ('Iskenderun', 225),
  ('Beirut', 270), ('Alexandria', 0), ('Damietta', 0), ('Port Said', 0),
  ('Aqaba', 180), ('Yanbu', 250), ('Jeddah', 270), ('Jebel Ali', 315),
  ('Sohar', 45), ('Fujairah', 90), ('Mumbai', 250), ('Dar es Salaam', 90)
) AS v(name, b)
WHERE public.ports.trade_name = v.name;

-- ───────────────────────── 20260601001000_declared_role ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Onboarding taxonomy — declared role · append-only
--
-- The signup now offers the design's account taxonomy (Principal Vessel
-- Owner / Principal Cargo Owner–Charterer / Broker with a cargo, vessel or
-- dual desk). The legacy user_role enum is NEVER changed (platform
-- principle: enums only widen); the precise declaration is captured here,
-- while user_role keeps driving the existing personas
-- (vessel_owner / cargo_owner / broker) exactly as before.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS declared_role text
    CHECK (declared_role IS NULL OR declared_role IN
      ('principal_owner','principal_charterer','broker_cargo','broker_vessel','broker_dual'));

GRANT SELECT (declared_role) ON public.users TO authenticated;

-- ───────────────────────── 20260601001010_org_admin_team ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Org-admin team management · append-only · firewall-safe
--
-- The existing fn_decide_org_membership is PLATFORM-admin only. For the
-- enterprise model, a company's OWN admin must manage its team (approve the
-- pending seats teammates created at signup, set broker/admin, remove). These
-- RPCs gate on the caller being an active 'admin' seat of that org (or a
-- platform admin), and only ever expose the caller's own org's members.
-- ════════════════════════════════════════════════════════════════════

-- The org the caller administers (active admin seat), or NULL.
CREATE OR REPLACE FUNCTION public.fn_my_admin_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = auth.uid() AND member_role = 'admin'
    AND is_current = TRUE AND status = 'active'
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_my_admin_org_id() TO authenticated;

-- The team of an org the caller administers (active + pending seats).
CREATE OR REPLACE FUNCTION public.fn_org_team(p_org_id uuid)
RETURNS TABLE (
  user_id uuid, full_name text, email text, member_role text,
  status text, added_at timestamptz, requested_email_domain text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id, u.full_name, u.email, m.member_role, m.status,
         m.added_at, m.requested_email_domain
  FROM public.organization_members m
  JOIN public.users u ON u.id = m.user_id
  WHERE m.org_id = p_org_id
    AND (public.fn_is_admin() OR p_org_id = public.fn_my_admin_org_id())
  ORDER BY (m.status = 'pending') DESC, (m.status = 'active') DESC, u.full_name;
$$;
GRANT EXECUTE ON FUNCTION public.fn_org_team(uuid) TO authenticated;

-- Approve / reject a pending seat, change role, or remove — org-admin gated.
CREATE OR REPLACE FUNCTION public.fn_org_manage_member(
  p_org_id uuid, p_user_id uuid, p_action text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.fn_is_admin() OR p_org_id = public.fn_my_admin_org_id()) THEN
    RAISE EXCEPTION 'Not an admin of this company';
  END IF;
  IF p_user_id = auth.uid() AND p_action IN ('remove', 'reject', 'make_broker') THEN
    RAISE EXCEPTION 'You cannot change your own admin seat';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.organization_members SET status = 'active', is_current = TRUE,
      decided_at = now(), decided_by = auth.uid()
      WHERE org_id = p_org_id AND user_id = p_user_id;
  ELSIF p_action = 'reject' THEN
    UPDATE public.organization_members SET status = 'rejected', is_current = FALSE,
      decided_at = now(), decided_by = auth.uid()
      WHERE org_id = p_org_id AND user_id = p_user_id;
  ELSIF p_action = 'remove' THEN
    DELETE FROM public.organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  ELSIF p_action = 'make_admin' THEN
    UPDATE public.organization_members SET member_role = 'admin'
      WHERE org_id = p_org_id AND user_id = p_user_id AND status = 'active';
  ELSIF p_action = 'make_broker' THEN
    UPDATE public.organization_members SET member_role = 'broker'
      WHERE org_id = p_org_id AND user_id = p_user_id AND status = 'active';
  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_org_manage_member(uuid, uuid, text) TO authenticated;

-- ───────────────────────── 20260601001020_admin_tiers ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Sub-admin authorization model · append-only (design admin-roles.js)
--
-- Superior Admin ('super') + permission-scoped sub-admins ('sub').
-- Sub-admins keep user_role 'admin' so every existing RLS admin policy
-- works unchanged; the per-section view/edit authorization is enforced at
-- the app layer (nav filtering, page bounce, action edit-checks) exactly
-- per the design ("Enforced at the data/role layer (nav filtering, page
-- rendering, and a bounce)"). Owner-only sections (ETA, Admins) are never
-- exposed to subs regardless of perms.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_tier text
    CHECK (admin_tier IS NULL OR admin_tier IN ('super','sub')),
  ADD COLUMN IF NOT EXISTS admin_perms jsonb;

-- Every existing admin predates the sub model — they are the owner(s).
UPDATE public.users SET admin_tier = 'super'
WHERE role = 'admin' AND admin_tier IS NULL;

-- Each admin can read their own tier/perms (the sidebar filters with it).
GRANT SELECT (admin_tier, admin_perms) ON public.users TO authenticated;

-- ───────────────────────── 20260601001030_canonical_user_resolution ─────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- Canonical user resolution · append-only · CRITICAL consistency fix
--
-- ROOT CAUSE of "bounced to login / stuck in tier / org features dead":
-- public.users has id = gen_random_uuid() and supabase_user_id = auth.uid()
-- (create_account_with_profiles inserts that way), but many functions and app
-- lookups compared users-keyed columns directly to auth.uid(). For every real
-- signed-up account the row was simply never found.
--
-- ONE resolver from here on: fn_app_user_id() — auth.uid() → users.id,
-- matching supabase_user_id first and falling back to id (legacy rows where
-- they were created equal). Every org-layer function is re-created on top of
-- it. (is_admin()/fn_is_admin already used supabase_user_id correctly.)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_app_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM public.users WHERE supabase_user_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.users WHERE id = auth.uid() LIMIT 1)
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_app_user_id() TO authenticated;

-- ── fn_my_org_ids (…000800) — the firewall key for org visibility ──
CREATE OR REPLACE FUNCTION public.fn_my_org_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(org_id), '{}')
  FROM public.organization_members
  WHERE user_id = public.fn_app_user_id() AND is_current;
$$;

-- ── fn_my_membership (…000880) — the signed-in person's seat ──
CREATE OR REPLACE FUNCTION public.fn_my_membership()
RETURNS TABLE (
  org_id uuid, org_name text, org_type text, member_role text,
  status text, requested_company_name text, added_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.org_id, o.name, o.org_type, m.member_role, m.status,
         m.requested_company_name, m.added_at
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = public.fn_app_user_id()
  ORDER BY (m.status = 'active') DESC, (m.status = 'pending') DESC, m.added_at DESC
  LIMIT 1;
$$;

-- ── fn_is_org_admin (…000890) ──
CREATE OR REPLACE FUNCTION public.fn_is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = p_org_id AND user_id = public.fn_app_user_id()
      AND member_role = 'admin' AND is_current AND status = 'active'
  );
$$;

-- ── fn_request_org_membership (…000890) — same body, canonical user id ──
CREATE OR REPLACE FUNCTION public.fn_request_org_membership(p_org_id uuid)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := public.fn_app_user_id();
  v_name   text;
  v_domain text;
  v_row    public.organization_members;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT name INTO v_name FROM public.organizations WHERE id = p_org_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown company'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_uid AND status = 'active' AND org_id <> p_org_id
  ) THEN
    RAISE EXCEPTION 'You already belong to a company. Leave it before joining another.';
  END IF;

  SELECT lower(nullif(split_part(email, '@', 2), '')) INTO v_domain
    FROM public.users WHERE id = v_uid;

  INSERT INTO public.organization_members
    (org_id, user_id, member_role, is_current, status, requested_company_name, requested_email_domain)
  VALUES
    (p_org_id, v_uid, 'broker', false, 'pending', v_name, v_domain)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET status = CASE WHEN public.organization_members.status = 'active'
                      THEN 'active' ELSE 'pending' END,
        is_current = (public.organization_members.status = 'active'),
        requested_company_name = EXCLUDED.requested_company_name,
        requested_email_domain = EXCLUDED.requested_email_domain
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ── fn_my_admin_org_id + fn_org_manage_member (…001010) ──
CREATE OR REPLACE FUNCTION public.fn_my_admin_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = public.fn_app_user_id() AND member_role = 'admin'
    AND is_current = TRUE AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_org_manage_member(
  p_org_id uuid, p_user_id uuid, p_action text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.fn_is_admin() OR p_org_id = public.fn_my_admin_org_id()) THEN
    RAISE EXCEPTION 'Not an admin of this company';
  END IF;
  IF p_user_id = public.fn_app_user_id() AND p_action IN ('remove', 'reject', 'make_broker') THEN
    RAISE EXCEPTION 'You cannot change your own admin seat';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.organization_members SET status = 'active', is_current = TRUE,
      decided_at = now(), decided_by = public.fn_app_user_id()
      WHERE org_id = p_org_id AND user_id = p_user_id;
  ELSIF p_action = 'reject' THEN
    UPDATE public.organization_members SET status = 'rejected', is_current = FALSE,
      decided_at = now(), decided_by = public.fn_app_user_id()
      WHERE org_id = p_org_id AND user_id = p_user_id;
  ELSIF p_action = 'remove' THEN
    DELETE FROM public.organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  ELSIF p_action = 'make_admin' THEN
    UPDATE public.organization_members SET member_role = 'admin'
      WHERE org_id = p_org_id AND user_id = p_user_id AND status = 'active';
  ELSIF p_action = 'make_broker' THEN
    UPDATE public.organization_members SET member_role = 'broker'
      WHERE org_id = p_org_id AND user_id = p_user_id AND status = 'active';
  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action;
  END IF;
END;
$$;
