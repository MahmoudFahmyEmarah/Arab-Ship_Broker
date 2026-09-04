-- The poster line shows WHO PUT THE LISTING ON THE MARKET — a platform
-- account — never the circular's sender (owner decision, 3 Sep 2026).
-- Resolution order: the member who owns the listing → the admin who committed
-- the sync batch that wrote it (cargo) / resolved the review (vessels) → the
-- platform itself ("Arab ShipBroker", company seat, admin) when the batch has
-- no recorded actor. source_contact / source_company stay on the tables for
-- back-office use only.
create or replace function public.get_listing_posters(p_type text, p_ids uuid[])
returns table (
  listing_id uuid,
  poster_name text,
  poster_company text,
  poster_kind text,
  is_admin boolean,
  org_id uuid
)
language sql stable security definer
set search_path to ''
as $$
  with own as (
    select distinct on (lo.listing_id)
           lo.listing_id, lo.owner_user_id as user_id
    from public.listing_ownership lo
    where lo.listing_type = p_type::public.listing_type_enum
      and lo.is_current
      and lo.listing_id = any (p_ids)
    order by lo.listing_id, (lo.role = 'primary') desc, lo.owned_from desc
  ),
  -- admin who committed the batch that last wrote this cargo REF
  synced_cargo as (
    select distinct on (c.id) c.id as listing_id, b.started_by as user_id
    from public.cargo_listings c
    join public.sync_staged_row s on s.business_key = c.ref and s.sheet = 'cargo' and s.committed
    join public.sync_batch b on b.id = s.batch_id
    where p_type = 'cargo' and c.id = any (p_ids)
    order by c.id, s.created_at desc
  ),
  -- admin who resolved the review that posted this vessel position
  synced_vessel as (
    select distinct on (q.resolved_availability_id) q.resolved_availability_id as listing_id, q.resolved_by as user_id
    from public.vessel_review_queue q
    where p_type = 'vessel_availability' and q.resolved_availability_id = any (p_ids)
    order by q.resolved_availability_id, q.resolved_at desc
  ),
  actor as (
    select listing_id, user_id from own
    union all
    select sc.listing_id, sc.user_id from synced_cargo sc where not exists (select 1 from own o where o.listing_id = sc.listing_id)
    union all
    select sv.listing_id, sv.user_id from synced_vessel sv where not exists (select 1 from own o where o.listing_id = sv.listing_id)
  ),
  resolved as (
    select a.listing_id,
           u.full_name,
           coalesce(o.name, u.company) as company,
           case when o.id is not null then (case when om.member_role = 'admin' then 'company' else 'employee' end)
                else 'individual' end as kind,
           (u.role = 'admin') as is_admin,
           o.id as org_id
    from actor a
    join public.users u on u.id = a.user_id
    left join public.organization_members om
           on om.user_id = u.id and om.is_current and om.status = 'active'
    left join public.organizations o on o.id = om.org_id
  )
  select r.listing_id, r.full_name, r.company, r.kind, r.is_admin, r.org_id from resolved r
  union all
  -- everything else on the market was placed there by the platform
  select x.id, null::text, 'Arab ShipBroker'::text, 'company'::text, true, null::uuid
  from unnest(p_ids) as x(id)
  where not exists (select 1 from resolved r where r.listing_id = x.id);
$$;
revoke all on function public.get_listing_posters(text, uuid[]) from public, anon;
grant execute on function public.get_listing_posters(text, uuid[]) to authenticated, service_role;
