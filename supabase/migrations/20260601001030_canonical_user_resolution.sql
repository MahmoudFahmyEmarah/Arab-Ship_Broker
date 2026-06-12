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
