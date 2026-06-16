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
