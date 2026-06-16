-- ════════════════════════════════════════════════════════════════════
-- Org membership claim-on-signup  · append-only · firewall-safe
--
-- Lets a person from a pre-boarded company attach themselves to that company's
-- profile (organization_members) — the missing link that turns the seeded
-- registry (…000840) into live, person-backed companies.
--
-- SECURITY (NON-NEGOTIABLE): membership = firewall access to that company's
-- vessels (fn_owns_vessel keys off owner_org_id = ANY fn_my_org_ids(), and
-- fn_my_org_ids gates on is_current). So a self-claim must NEVER auto-grant
-- access — it creates a PENDING request (is_current = false → fn_my_org_ids
-- excludes it → zero access) that a platform admin (or, later, the company's
-- own admin) approves. Approval flips is_current = true and opens the fleet.
--
-- Search is exposed through a dedicated RPC that returns ONLY public registry
-- facts (name/type/country/fleet) — never desk contact — so a non-member can
-- find their company without the orgs RLS leaking anything.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Request lifecycle metadata on the membership row ──
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS status                  text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','rejected')),
  ADD COLUMN IF NOT EXISTS requested_company_name  text,
  ADD COLUMN IF NOT EXISTS decided_at              timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by              uuid REFERENCES public.users(id);

-- ── 2. Registry search — public facts only, no desk contact (firewall) ──
CREATE OR REPLACE FUNCTION public.fn_search_organizations(q text)
RETURNS TABLE (id uuid, name text, org_type text, country text, fleet_total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id, o.name, o.org_type, o.country, o.fleet_total
  FROM public.organizations o
  WHERE length(btrim(coalesce(q, ''))) >= 2
    AND o.name ILIKE '%' || btrim(q) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;
GRANT EXECUTE ON FUNCTION public.fn_search_organizations(text) TO authenticated;

-- ── 3. My membership — what the account "Company" panel shows ──
CREATE OR REPLACE FUNCTION public.fn_my_membership()
RETURNS TABLE (
  org_id      uuid,
  org_name    text,
  org_type    text,
  member_role text,
  status      text,
  requested_company_name text,
  added_at    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.org_id, o.name, o.org_type, m.member_role, m.status,
         m.requested_company_name, m.added_at
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid()
  ORDER BY (m.status = 'active') DESC, (m.status = 'pending') DESC, m.added_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_my_membership() TO authenticated;

-- ── 4. Self-request to join a company (creates a PENDING, no-access row) ──
-- One company per person: blocked while the caller already has an ACTIVE seat.
CREATE OR REPLACE FUNCTION public.fn_request_org_membership(p_org_id uuid)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_row public.organization_members;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT name INTO v_name FROM public.organizations WHERE id = p_org_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Unknown company';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_uid AND status = 'active' AND org_id <> p_org_id
  ) THEN
    RAISE EXCEPTION 'You already belong to a company. Leave it before joining another.';
  END IF;

  INSERT INTO public.organization_members
    (org_id, user_id, member_role, is_current, status, requested_company_name)
  VALUES
    (p_org_id, v_uid, 'broker', false, 'pending', v_name)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET status = CASE WHEN public.organization_members.status = 'active'
                      THEN 'active' ELSE 'pending' END,
        is_current = (public.organization_members.status = 'active'),
        requested_company_name = EXCLUDED.requested_company_name
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_request_org_membership(uuid) TO authenticated;

-- ── 5. Admin: list pending requests for the approval queue ──
CREATE OR REPLACE FUNCTION public.fn_pending_membership_requests()
RETURNS TABLE (
  org_id     uuid,
  org_name   text,
  user_id    uuid,
  full_name  text,
  email      text,
  requested_company_name text,
  requested_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.org_id, o.name, m.user_id, u.full_name, u.email,
         m.requested_company_name, m.added_at
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.org_id
  JOIN public.users u ON u.id = m.user_id
  WHERE m.status = 'pending' AND public.fn_is_admin()
  ORDER BY m.added_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pending_membership_requests() TO authenticated;

-- ── 6. Admin: approve / reject a request ──
-- Approve → status='active', is_current=true (firewall opens). p_make_admin
-- promotes the seat to the company 'admin' (the first member usually is).
CREATE OR REPLACE FUNCTION public.fn_decide_org_membership(
  p_org_id uuid, p_user_id uuid, p_approve boolean, p_make_admin boolean DEFAULT false
)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.organization_members;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.organization_members
     SET status      = CASE WHEN p_approve THEN 'active' ELSE 'rejected' END,
         is_current  = p_approve,
         member_role = CASE WHEN p_approve AND p_make_admin THEN 'admin'
                            ELSE member_role END,
         decided_at  = now(),
         decided_by  = auth.uid()
   WHERE org_id = p_org_id AND user_id = p_user_id
  RETURNING * INTO v_row;

  IF v_row.org_id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_decide_org_membership(uuid, uuid, boolean, boolean) TO authenticated;
