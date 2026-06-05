-- ════════════════════════════════════════════════════════════════════
-- Organization (company) model — Part 1: schema + membership + firewall
--                                  · append-only · additive · safe to apply
--
-- "Ownership, subscription tier and the marketplace contact channel live on the
--  COMPANY, not the person. One company per person; a company has many people."
-- (CLAUDE_CODE_MAP/POST_CARGO handoff §6.)
--
-- This lays the backend foundation only — it is additive and changes NO existing
-- behaviour until orgs/members are seeded and owner_org_id is populated:
--   • organizations / organization_members + the desk contact channel
--   • fn_my_org_ids()  — the one helper the firewall keys off
--   • listing_ownership.owner_org_id  — durable company-level ownership
--   • fn_owns_vessel()/fn_owns_cargo() extended to accept org membership
--     (backward-compatible: still true for the row's own owner_user_id)
--
-- NOT here (deferred until orgs are seeded): re-pointing the masked detail views
-- to return the ORG desk contact + handled_by — that needs owner_org_id populated,
-- else it would null every contact. Tracked in POST_CARGO_STATUS.md §6.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. organizations — the company (carries tier + desk contact channel) ──
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
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 2. organization_members — a person's seat in a company ──
-- One company per person in the product UX, but the table stays many-to-many at
-- zero cost (an independent broker working two firms can be added later).
CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'broker'
                CHECK (member_role IN ('admin','broker','viewer')),
  is_current  boolean NOT NULL DEFAULT true,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id) WHERE is_current;

-- ── 3. fn_my_org_ids() — the orgs the caller belongs to (firewall key) ──
-- SECURITY DEFINER so it can read membership while only ever testing auth.uid().
CREATE OR REPLACE FUNCTION public.fn_my_org_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(org_id), '{}')
  FROM public.organization_members
  WHERE user_id = auth.uid() AND is_current;
$$;
GRANT EXECUTE ON FUNCTION public.fn_my_org_ids() TO authenticated;

-- ── 4. listing_ownership.owner_org_id — durable company-level ownership ──
-- owner_user_id stays as the *attribution* (who claimed/handles it); owner_org_id
-- is the binding owner so the listing stays with the firm if a person leaves.
ALTER TABLE public.listing_ownership
  ADD COLUMN IF NOT EXISTS owner_org_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_listing_ownership_org ON public.listing_ownership (owner_org_id) WHERE is_current;

-- ── 5. RLS — members read their own org + co-members; admin manages ──
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
                 AND m.user_id = auth.uid() AND m.member_role = 'admin' AND m.is_current)
  )
  WITH CHECK (
    public.fn_is_admin()
    OR EXISTS (SELECT 1 FROM public.organization_members m
               WHERE m.org_id = organization_members.org_id
                 AND m.user_id = auth.uid() AND m.member_role = 'admin' AND m.is_current)
  );

-- ── 6. Firewall: owner check accepts org membership (backward-compatible) ──
-- Unchanged where owner_org_id is NULL (still true for the row's own owner_user_id),
-- so applying this before any org is seeded changes nothing.
CREATE OR REPLACE FUNCTION public.fn_owns_vessel(p_vessel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.fn_owns_vessel(uuid) TO authenticated;

-- Cargo equivalent (new) — same shape, for the cargo masked surface.
CREATE OR REPLACE FUNCTION public.fn_owns_cargo(p_cargo_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.fn_owns_cargo(uuid) TO authenticated;
