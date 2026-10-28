-- ════════════════════════════════════════════════════════════════════════
-- PDA · the port touch census (the design's Ports module hub, directory and map; owner B2ALL-061, build step 11)
--
-- How many live listings touch each port today: a cargo "touches" its load and discharge ports (the effective port
-- and any alternate slot), an open vessel touches the port it opens at. The census counts ONLY what the calling
-- member can already see on the market boards — live, approved cargo (status IN or PARTIAL) and open, approved
-- vessel availability that pass the boards' own visibility — the bulk predicate the market's board RPCs apply from
-- market_private.market_request_context (posting date within the configured freshness window, or a laycan / open date
-- still ahead when the laycan exception is on; the spot / undated active windows) and never a sanctioned vessel — so
-- it reveals nothing the boards do not. The predicate is evaluated once per listing from the request context (the
-- market's own rule for bulk reads: never a per-row helper call); for a member who owns none of the listings it is
-- exactly public.fn_market_fresh_ok, which the suite proves. One pass, grouped per port: the read stays well inside
-- the API role's statement timeout on a full network (the correlated form did not). The cohort rule (the bunker reads' k = 3, O2B-003) counts
-- DISTINCT listings and vessels, never touches: a port with 1 or 2 of them is SUPPRESSED — every count null,
-- `suppressed` true. A reported port whose breakdown (loads / discharges / vessels) has any cell of 1 or 2 keeps its
-- total and withholds ALL three cells, because hiding one cell alone leaves it to subtraction. Suppressed ports are
-- ordered by name among the untouched ones, never by the count they withhold. Zero is not sensitive and is reported.
-- Ports are the active, verified ones; no internal id leaves the database.
--
--   get_port_touch_census()   member read (estimator gate): {asOf, minimumCohort, ports:[{locode,name,country,zone,
--                             latitude,longitude,touches,loads,discharges,vessels,suppressed}]}, most touched first
-- Plain SQL. DOWN: supabase/rollback/20261019140000_pda_port_touch_census_down.sql (drops the function; no data).
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create or replace function public.get_port_touch_census()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_min constant int := 3;
  v_actor uuid := public.fn_app_user_id();
  v_ctx record;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  if not public.fn_pda_member_entitled() then raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501'; end if;
  -- the boards' request-wide visibility inputs for this member: freshness window, laycan exception, active windows
  select * into v_ctx from market_private.market_request_context(v_actor);

  with cargo_slots as (
    select c.id as listing_id, s.locode, s.role
    from public.cargo_listings c
    cross join lateral (values
      (public.fn_cl_effective_locode(c.load_port_locode, c.load_ref_locode, c.load_port_2_locode), 'load'),
      (c.load_port_2_locode, 'load'), (c.load_port_3_locode, 'load'), (c.load_port_4_locode, 'load'),
      (public.fn_cl_effective_locode(c.disch_port_locode, c.disch_ref_locode, c.disch_port_2_locode), 'discharge'),
      (c.disch_port_2_locode, 'discharge'), (c.disch_port_3_locode, 'discharge'), (c.disch_port_4_locode, 'discharge')) as s(locode, role)
    where c.status in ('IN', 'PARTIAL') and c.review_status = 'APPROVED' and nullif(btrim(s.locode), '') is not null
      -- the boards' bulk visibility, from the request context (= fn_market_fresh_ok for a listing the member does not own)
      and (c.refreshed_at >= v_ctx.fresh_after or (v_ctx.laycan_exception and c.laycan_to is not null and c.laycan_to >= current_date))
      and (not coalesce(c.is_spot, false) or c.created_at::date >= v_ctx.cargo_active_from)
  ),
  cargo_touches as (select distinct listing_id, btrim(locode) as locode, role from cargo_slots),
  vessel_touches as (
    -- one touch per vessel, however many open positions it holds at the port
    select distinct a.vessel_id as entity_id, btrim(a.open_port_locode) as locode
    from public.vessel_availability a
    join public.vessels v on v.id = a.vessel_id
    where a.status = 'OPEN' and a.review_status = 'APPROVED' and nullif(btrim(a.open_port_locode), '') is not null
      and not v.is_sanctioned
      and (a.refreshed_at >= v_ctx.fresh_after or (v_ctx.laycan_exception and a.open_date is not null and a.open_date >= current_date))
      and (a.open_date is not null or a.created_at::date >= v_ctx.vessel_active_from)
  ),
  -- one pass per side, grouped by port (the correlated form re-read the touch sets four times per port)
  cargo_agg as (
    select locode, count(*) as cargo_n, count(*) filter (where role = 'load') as loads, count(*) filter (where role = 'discharge') as discharges,
           count(distinct listing_id) as cargo_entities
    from cargo_touches group by locode
  ),
  vessel_agg as (select locode, count(*) as vessels from vessel_touches group by locode),
  per_port as (
    select p.locode, p.trade_name, p.country, p.zone::text as zone, p.latitude, p.longitude,
           coalesce(ca.cargo_n, 0) as cargo_n, coalesce(ca.loads, 0) as loads, coalesce(ca.discharges, 0) as discharges, coalesce(va.vessels, 0) as vessels,
           -- the cohort counts distinct listings and distinct vessels, never touches: a listing that loads and
           -- discharges here is one listing, a vessel with three open positions is one vessel
           coalesce(ca.cargo_entities, 0) + coalesce(va.vessels, 0) as entities
    from public.ports p
    left join cargo_agg ca on ca.locode = p.locode
    left join vessel_agg va on va.locode = p.locode
    where p.is_active and p.is_verified
  ),
  judged as (
    select pp.*, pp.cargo_n + pp.vessels as total,
           pp.entities between 1 and v_min - 1 as suppressed,
           -- a breakdown cell of 1 or 2 points at one or two listings, and hiding only that cell leaves it to
           -- subtraction from the total: when any cell is small, every cell is withheld and only the total is reported
           (pp.loads between 1 and v_min - 1 or pp.discharges between 1 and v_min - 1 or pp.vessels between 1 and v_min - 1) as small_cell
    from per_port pp
  )
  -- suppressed ports sort with the untouched ones, by name only: the order must never rank what the counts withhold
  select jsonb_build_object(
    'asOf', current_date,
    'minimumCohort', v_min,
    'ports', coalesce(jsonb_agg(jsonb_build_object(
      'locode', j.locode, 'name', j.trade_name, 'country', j.country, 'zone', j.zone, 'latitude', j.latitude, 'longitude', j.longitude,
      'suppressed', j.suppressed,
      'touches',    case when not j.suppressed then j.total end,
      'loads',      case when not j.suppressed and not j.small_cell then j.loads end,
      'discharges', case when not j.suppressed and not j.small_cell then j.discharges end,
      'vessels',    case when not j.suppressed and not j.small_cell then j.vessels end
    ) order by case when j.suppressed then 0 else j.total end desc, j.trade_name, j.locode), '[]'::jsonb)
  ) into v_result
  from judged j;
  return v_result;
end $$;
revoke all on function public.get_port_touch_census() from public, anon;
grant execute on function public.get_port_touch_census() to authenticated, service_role;
