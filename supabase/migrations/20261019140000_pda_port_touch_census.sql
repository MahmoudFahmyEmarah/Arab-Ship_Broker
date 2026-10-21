-- ════════════════════════════════════════════════════════════════════════
-- PDA · the port touch census (the design's Ports module hub, directory and map; owner B2ALL-061, build step 11)
--
-- How many live listings touch each port today: a cargo "touches" its load and discharge ports (the effective port
-- and any alternate slot), an open vessel touches the port it opens at. The census counts ONLY what a member can
-- already see on the market boards — live, approved cargo (status IN or PARTIAL) and open, approved vessel
-- availability — so it reveals nothing the boards do not. The cohort rule (the bunker reads' k = 3, O2B-003) counts
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
  v_result jsonb;
begin
  if public.fn_app_user_id() is null then raise exception 'PDA_AUTH: sign in required' using errcode = '42501'; end if;
  if not public.fn_pda_member_entitled() then raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501'; end if;

  with cargo_slots as (
    select c.id as listing_id, s.locode, s.role
    from public.cargo_listings c
    cross join lateral (values
      (public.fn_cl_effective_locode(c.load_port_locode, c.load_ref_locode, c.load_port_2_locode), 'load'),
      (c.load_port_2_locode, 'load'), (c.load_port_3_locode, 'load'), (c.load_port_4_locode, 'load'),
      (public.fn_cl_effective_locode(c.disch_port_locode, c.disch_ref_locode, c.disch_port_2_locode), 'discharge'),
      (c.disch_port_2_locode, 'discharge'), (c.disch_port_3_locode, 'discharge'), (c.disch_port_4_locode, 'discharge')) as s(locode, role)
    where c.status in ('IN', 'PARTIAL') and c.review_status = 'APPROVED' and nullif(btrim(s.locode), '') is not null
  ),
  cargo_touches as (select distinct listing_id, btrim(locode) as locode, role from cargo_slots),
  vessel_touches as (
    -- one touch per vessel, however many open positions it holds at the port
    select distinct a.vessel_id as entity_id, btrim(a.open_port_locode) as locode
    from public.vessel_availability a
    where a.status = 'OPEN' and a.review_status = 'APPROVED' and nullif(btrim(a.open_port_locode), '') is not null
  ),
  per_port as (
    select p.locode, p.trade_name, p.country, p.zone::text as zone, p.latitude, p.longitude,
           (select count(*) from cargo_touches t where t.locode = p.locode) as cargo_n,
           (select count(*) from cargo_touches t where t.locode = p.locode and t.role = 'load') as loads,
           (select count(*) from cargo_touches t where t.locode = p.locode and t.role = 'discharge') as discharges,
           (select count(*) from vessel_touches v where v.locode = p.locode) as vessels,
           -- the cohort counts distinct listings and distinct vessels, never touches: a listing that loads and
           -- discharges here is one listing, a vessel with three open positions is one vessel
           (select count(distinct t.listing_id) from cargo_touches t where t.locode = p.locode)
             + (select count(*) from vessel_touches v where v.locode = p.locode) as entities
    from public.ports p
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
