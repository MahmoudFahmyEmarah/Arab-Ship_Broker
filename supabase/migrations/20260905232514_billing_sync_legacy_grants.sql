-- Tier sync must not touch legacy grants (tiers the owner set by hand before
-- billing existed). It now only manages users the billing layer knows about:
-- holders of a personal billing profile, members flagged with a plan seat, or
-- members of a company that has a billing profile. Everyone else keeps
-- whatever tier they have. Also restores the one legacy T4 grant the first
-- sync run lowered (admin.local@arabshipbroker.com).
create or replace function public.fn_billing_sync_tiers()
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_changed integer := 0;
begin
  with active_subs as (
    select s.id, s.customer_id, s.seats, p.tier, c.org_id, c.user_id
    from public.subscriptions s
    join public.plans p on p.code = s.plan_code
    join public.billing_customers c on c.id = s.customer_id
    where s.status in ('trialing', 'active', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  ),
  seats as (
    select m.user_id, a.tier,
           row_number() over (partition by a.id order by m.added_at, m.user_id) as rn, a.seats
    from active_subs a
    join public.organization_members m on m.org_id = a.org_id and m.is_current and m.status = 'active' and m.plan_seat
    where a.org_id is not null
  ),
  personal as (
    select a.user_id, a.tier from active_subs a where a.user_id is not null
  ),
  entitled as (
    select user_id, max(tier) as tier from (
      select user_id, tier from seats where rn <= seats
      union all
      select user_id, tier from personal
    ) x group by user_id
  ),
  managed as (
    -- users whose tier the billing layer owns
    select c.user_id from public.billing_customers c where c.user_id is not null
    union
    select m.user_id from public.organization_members m where m.plan_seat
    union
    select m.user_id from public.organization_members m
    join public.billing_customers c on c.org_id = m.org_id
    where m.is_current and m.status = 'active'
  ),
  target as (
    select u.id, coalesce(e.tier, 'T1'::public.subscription_tier_enum) as tier
    from public.users u
    left join entitled e on e.user_id = u.id
    where u.role <> 'admin' and (e.user_id is not null or u.id in (select user_id from managed))
  ),
  upd as (
    update public.users u set subscription_tier = t.tier
    from target t where t.id = u.id and u.subscription_tier is distinct from t.tier
    returning 1
  )
  select count(*) into v_changed from upd;
  return v_changed;
end $$;

update public.users set subscription_tier = 'T4' where email = 'admin.local@arabshipbroker.com' and role <> 'admin' and subscription_tier = 'T1';
