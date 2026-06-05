-- ════════════════════════════════════════════════════════════════════
-- Org membership — email-domain auto-match hint + distributed approval
--                                              · append-only · firewall-safe
--
-- Two improvements to the claim flow (…000880) so the platform admin isn't the
-- sole approver forever:
--   1) capture the requester's email domain and surface a "domain matches"
--      HINT to whoever reviews the request (matches the company's declared
--      domains OR the domain of an existing verified member). It is only a
--      hint — approval is still an explicit human action, never automatic.
--   2) let a company's own ACTIVE admin review/approve requests for THEIR org
--      (fn_is_org_admin), in addition to the platform admin. Membership still
--      means firewall access, so only an already-trusted admin can grant it.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS email_domains text[];           -- admin-declared, e.g. {'navigrains.com'}
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS requested_email_domain text;    -- captured at request time for the hint

-- ── is the caller an active admin of this org? ──
CREATE OR REPLACE FUNCTION public.fn_is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
      AND member_role = 'admin' AND is_current AND status = 'active'
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_is_org_admin(uuid) TO authenticated;

-- ── request to join — now also records the requester's email domain ──
CREATE OR REPLACE FUNCTION public.fn_request_org_membership(p_org_id uuid)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
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
GRANT EXECUTE ON FUNCTION public.fn_request_org_membership(uuid) TO authenticated;

-- ── pending requests — visible to platform admin OR the org's own admin ──
-- Adds domain_match: true when the requester's email domain matches a declared
-- company domain or an existing active member's domain.
CREATE OR REPLACE FUNCTION public.fn_pending_membership_requests()
RETURNS TABLE (
  org_id     uuid,
  org_name   text,
  user_id    uuid,
  full_name  text,
  email      text,
  requested_company_name text,
  requested_email_domain text,
  domain_match boolean,
  requested_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.org_id, o.name, m.user_id, u.full_name, u.email,
         m.requested_company_name, m.requested_email_domain,
         (
           m.requested_email_domain IS NOT NULL AND (
             m.requested_email_domain = ANY (COALESCE(o.email_domains, '{}'))
             OR EXISTS (
               SELECT 1 FROM public.organization_members am
               JOIN public.users au ON au.id = am.user_id
               WHERE am.org_id = o.id AND am.status = 'active' AND am.is_current
                 AND lower(split_part(au.email, '@', 2)) = m.requested_email_domain
             )
           )
         ) AS domain_match,
         m.added_at
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.org_id
  JOIN public.users u ON u.id = m.user_id
  WHERE m.status = 'pending'
    AND (public.fn_is_admin() OR public.fn_is_org_admin(m.org_id))
  ORDER BY m.added_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_pending_membership_requests() TO authenticated;

-- ── decide — platform admin OR the org's own active admin ──
CREATE OR REPLACE FUNCTION public.fn_decide_org_membership(
  p_org_id uuid, p_user_id uuid, p_approve boolean, p_make_admin boolean DEFAULT false
)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.organization_members;
BEGIN
  IF NOT (public.fn_is_admin() OR public.fn_is_org_admin(p_org_id)) THEN
    RAISE EXCEPTION 'Not authorised to decide this request';
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

  IF v_row.org_id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_decide_org_membership(uuid, uuid, boolean, boolean) TO authenticated;
