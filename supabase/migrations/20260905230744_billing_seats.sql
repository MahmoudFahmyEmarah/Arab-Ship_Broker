-- Billing seats on company memberships (06 Sep 2026)
-- A company admin decides which active members hold a purchased seat; the
-- tier sync (fn_billing_sync_tiers) then grants the plan tier to the first N
-- flagged members. fn_org_team now reports the flag so My Company can show it.

create or replace function public.fn_org_set_plan_seat(p_org_id uuid, p_user_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_seats integer; v_used integer;
begin
  if not (public.fn_is_admin() or p_org_id = public.fn_my_admin_org_id()) then
    raise exception 'Not an admin of this company';
  end if;
  if p_on then
    select coalesce(max(s.seats), 0) into v_seats
    from public.subscriptions s join public.billing_customers c on c.id = s.customer_id
    where c.org_id = p_org_id and s.status in ('trialing','active','past_due') and (s.current_period_end is null or s.current_period_end > now());
    select count(*) into v_used from public.organization_members where org_id = p_org_id and is_current and status = 'active' and plan_seat and user_id <> p_user_id;
    if v_seats = 0 then raise exception 'No active subscription on this company yet'; end if;
    if v_used >= v_seats then raise exception 'All % seat(s) are assigned — free one first or buy more seats', v_seats; end if;
  end if;
  update public.organization_members set plan_seat = p_on where org_id = p_org_id and user_id = p_user_id and is_current and status = 'active';
  perform public.fn_billing_sync_tiers();
end $$;
grant execute on function public.fn_org_set_plan_seat(uuid, uuid, boolean) to authenticated;

drop function if exists public.fn_org_team(uuid);
create function public.fn_org_team(p_org_id uuid)
returns table (user_id uuid, full_name text, email text, member_role text, status text, added_at timestamptz, requested_email_domain text, plan_seat boolean, tier text)
language sql stable security definer set search_path to 'public'
as $$
  select m.user_id, u.full_name, u.email, m.member_role, m.status, m.added_at, m.requested_email_domain, m.plan_seat, u.subscription_tier::text
  from public.organization_members m
  join public.users u on u.id = m.user_id
  where m.org_id = p_org_id
    and (public.fn_is_admin() or p_org_id = public.fn_my_admin_org_id())
  order by (m.status = 'pending') desc, (m.status = 'active') desc, u.full_name;
$$;
grant execute on function public.fn_org_team(uuid) to authenticated;

-- seats available to a company (for the My Company header)
create or replace function public.fn_org_seat_summary(p_org_id uuid)
returns table (seats integer, used integer, plan_code text, period_end timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(max(s.seats), 0)::int,
         (select count(*)::int from public.organization_members m where m.org_id = p_org_id and m.is_current and m.status = 'active' and m.plan_seat),
         (select s2.plan_code from public.subscriptions s2 join public.billing_customers c2 on c2.id = s2.customer_id where c2.org_id = p_org_id and s2.status in ('trialing','active','past_due') order by s2.created_at desc limit 1),
         max(s.current_period_end)
  from public.subscriptions s join public.billing_customers c on c.id = s.customer_id
  where c.org_id = p_org_id and s.status in ('trialing','active','past_due') and (s.current_period_end is null or s.current_period_end > now())
    and (public.fn_is_admin() or exists (select 1 from public.organization_members m where m.org_id = p_org_id and m.user_id = public.fn_app_user_id() and m.is_current and m.status = 'active'));
$$;
grant execute on function public.fn_org_seat_summary(uuid) to authenticated;
