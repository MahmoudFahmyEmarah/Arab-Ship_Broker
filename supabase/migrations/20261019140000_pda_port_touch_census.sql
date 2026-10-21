-- ════════════════════════════════════════════════════════════════════════
-- PDA · the port touch census (the design's Ports module hub, directory and map; owner B2ALL-061, build step 11)
--
-- How many live listings touch each port today: a cargo "touches" its load and discharge ports (the effective port
-- and any alternate slot), an open vessel touches the port it opens at. The census counts ONLY what a member can
-- already see on the market boards — live, approved cargo (status IN or PARTIAL) and open, approved vessel
-- availability — so it reveals nothing the boards do not. A port touched by fewer than 3 listings is SUPPRESSED (the
-- cohort rule of the bunker reads, O2B-003): its counts are null and `suppressed` is true, so a figure never points at
-- one or two listings. Zero is not sensitive and is reported. Ports are the active, verified ones; no internal id
-- leaves the database.
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
    select distinct a.id as listing_id, btrim(a.open_port_locode) as locode
    from public.vessel_availability a
    where a.status = 'OPEN' and a.review_status = 'APPROVED' and nullif(btrim(a.open_port_locode), '') is not null
  ),
  per_port as (
    select p.locode, p.trade_name, p.country, p.zone::text as zone, p.latitude, p.longitude,
           (select count(*) from cargo_touches t where t.locode = p.locode) as cargo_n,
           (select count(*) from cargo_touches t where t.locode = p.locode and t.role = 'load') as loads,
           (select count(*) from cargo_touches t where t.locode = p.locode and t.role = 'discharge') as discharges,
           (select count(*) from vessel_touches v where v.locode = p.locode) as vessels
    from public.ports p
    where p.is_active and p.is_verified
  )
  select jsonb_build_object(
    'asOf', current_date,
    'minimumCohort', v_min,
    'ports', coalesce(jsonb_agg(jsonb_build_object(
      'locode', pp.locode, 'name', pp.trade_name, 'country', pp.country, 'zone', pp.zone, 'latitude', pp.latitude, 'longitude', pp.longitude,
      'suppressed', (pp.cargo_n + pp.vessels) between 1 and v_min - 1,
      'touches',    case when (pp.cargo_n + pp.vessels) = 0 or (pp.cargo_n + pp.vessels) >= v_min then pp.cargo_n + pp.vessels end,
      'loads',      case when (pp.cargo_n + pp.vessels) = 0 or (pp.cargo_n + pp.vessels) >= v_min then pp.loads end,
      'discharges', case when (pp.cargo_n + pp.vessels) = 0 or (pp.cargo_n + pp.vessels) >= v_min then pp.discharges end,
      'vessels',    case when (pp.cargo_n + pp.vessels) = 0 or (pp.cargo_n + pp.vessels) >= v_min then pp.vessels end
    ) order by (pp.cargo_n + pp.vessels) desc, pp.trade_name, pp.locode), '[]'::jsonb)
  ) into v_result
  from per_port pp;
  return v_result;
end $$;
revoke all on function public.get_port_touch_census() from public, anon;
grant execute on function public.get_port_touch_census() to authenticated, service_role;
