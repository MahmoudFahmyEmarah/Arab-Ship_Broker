-- Badge counts for the market boards: how many LIVE counterparts each listing
-- matches. "Live" = still on the market (approved, IN/PARTIAL and laycan not
-- passed for a cargo; OPEN + approved for a vessel position). Deliberately
-- ignores the viewer's freshness/archive window — a match the viewer cannot
-- see under the current filters still counts (owner's rule, 4 Sep 2026); an
-- expired cargo never does. Reads the precomputed `matches` cache.
create or replace function public.count_live_matches(p_type text, p_ids uuid[])
returns table (listing_id uuid, n integer)
language sql stable security definer
set search_path to ''
as $$
  select m.cargo_id as listing_id, count(*)::int as n
  from public.matches m
  join public.vessel_availability va on va.id = m.vessel_avail_id
  where p_type = 'cargo'
    and m.cargo_id = any (p_ids)
    and va.status = 'OPEN' and va.review_status = 'APPROVED'
  group by m.cargo_id
  union all
  select m.vessel_avail_id, count(*)::int
  from public.matches m
  join public.cargo_listings c on c.id = m.cargo_id
  where p_type = 'vessel_availability'
    and m.vessel_avail_id = any (p_ids)
    and c.review_status = 'APPROVED'
    and c.status in ('IN', 'PARTIAL')
    and (coalesce(c.is_spot, false) or c.laycan_to is null or c.laycan_to >= current_date)
  group by m.vessel_avail_id;
$$;
revoke all on function public.count_live_matches(text, uuid[]) from public, anon;
grant execute on function public.count_live_matches(text, uuid[]) to authenticated, service_role;
