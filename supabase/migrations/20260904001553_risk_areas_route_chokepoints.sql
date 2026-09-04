-- ════════════════════════════════════════════════════════════════════════
-- Route intelligence: canal transits + risk areas (04 Sep 2026)
--
-- 1. port_routes.chokepoints — which straits/canals a stored route transits
--    (SUEZ, BOSPHORUS, DARDANELLES, BAB_EL_MANDEB, HORMUZ, GIBRALTAR).
--    Measured ECDIS tracks are classified from their waypoints; distance-only
--    MARNET rows (no geometry) from the trading zones of their two ports.
--    get_port_route() returns the list so the map can raise the Suez alert
--    (canal tolls) from the stored flag, as the owner asked.
-- 2. risk_areas — admin-drawn polygons ([lat,lon] rings) with a severity
--    (war_zone / high_risk / advisory) and alert text. Any drawn route that
--    crosses an active area raises an insurance-premium alert on the chart.
--    Seeded with approximations of the JWC listed areas; editable in
--    Admin → Risk areas.
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · chokepoints ─────────────────────────────────────────────────────────
alter table public.port_routes
  add column if not exists chokepoints text[] not null default '{}'::text[];
comment on column public.port_routes.chokepoints is
  'Straits/canals the route transits: SUEZ, BOSPHORUS, DARDANELLES, BAB_EL_MANDEB, HORMUZ, GIBRALTAR. From waypoints (ECDIS) or port zones (MARNET distance rows).';

-- a) geometry-backed rows: a waypoint inside a chokepoint box
with boxes(cp, lat0, lat1, lon0, lon1) as (
  values ('SUEZ', 29.85, 31.30, 32.20, 32.70),
         ('BOSPHORUS', 40.95, 41.30, 28.90, 29.30),
         ('DARDANELLES', 40.00, 40.50, 26.10, 26.80),
         ('BAB_EL_MANDEB', 12.30, 13.20, 43.00, 43.80),
         ('HORMUZ', 25.80, 26.90, 55.70, 56.90),
         ('GIBRALTAR', 35.70, 36.20, -6.00, -5.20)
), hits as (
  select w.route_id, array_agg(distinct b.cp order by b.cp) as cps
  from public.port_route_waypoints w
  join boxes b on w.latitude between b.lat0 and b.lat1 and w.longitude between b.lon0 and b.lon1
  group by w.route_id
)
update public.port_routes r set chokepoints = hits.cps
from hits where hits.route_id = r.id and r.waypoint_count >= 3;

-- b) distance-only rows: infer from the two ports' trading zones
with z as (
  select r.id,
         (select p.zone::text from public.ports p where p.locode = r.pol_locode limit 1) as za,
         (select p.zone::text from public.ports p where p.locode = r.pod_locode limit 1) as zb
  from public.port_routes r
  where r.waypoint_count < 3
), cls as (
  select id, za, zb,
    (za in ('W.MED','C.MED','E.MED','ADRIATIC','B.SEA','NCONT','BALTIC')) as a_west,
    (zb in ('W.MED','C.MED','E.MED','ADRIATIC','B.SEA','NCONT','BALTIC')) as b_west,
    (za in ('R.SEA','R.SEA.N','R.SEA.S','AG','A.SEA','ECI','WCI','F.EAST','ECAF')) as a_east,
    (zb in ('R.SEA','R.SEA.N','R.SEA.S','AG','A.SEA','ECI','WCI','F.EAST','ECAF')) as b_east,
    (za in ('R.SEA','R.SEA.N','R.SEA.S')) as a_red, (zb in ('R.SEA','R.SEA.N','R.SEA.S')) as b_red,
    (za in ('W.MED','C.MED','E.MED','ADRIATIC','B.SEA')) as a_med, (zb in ('W.MED','C.MED','E.MED','ADRIATIC','B.SEA')) as b_med,
    (za in ('NCONT','BALTIC','WCAF','CARIB','ECSA')) as a_atl, (zb in ('NCONT','BALTIC','WCAF','CARIB','ECSA')) as b_atl
  from z where za is not null and zb is not null
), derived as (
  select id,
    array_remove(array[
      case when (a_west and b_east) or (a_east and b_west) then 'SUEZ' end,
      case when (za = 'B.SEA') <> (zb = 'B.SEA') then 'BOSPHORUS' end,
      case when (za = 'B.SEA') <> (zb = 'B.SEA') then 'DARDANELLES' end,
      case when ((a_west or a_red) and (b_east and not b_red)) or ((b_west or b_red) and (a_east and not a_red)) then 'BAB_EL_MANDEB' end,
      case when (za = 'AG') <> (zb = 'AG') then 'HORMUZ' end,
      case when (a_med and b_atl) or (b_med and a_atl) then 'GIBRALTAR' end
    ], null) as cps
  from cls
)
update public.port_routes r set chokepoints = derived.cps
from derived where derived.id = r.id and cardinality(derived.cps) > 0;

create or replace function public.get_port_route(p_pol text, p_pod text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_pol text := upper(trim(coalesce(p_pol, '')));
  v_pod text := upper(trim(coalesce(p_pod, '')));
  r     public.port_routes%rowtype;
  v_fwd boolean;
  v_wps jsonb;
begin
  if v_pol = '' or v_pod = '' or v_pol = v_pod then
    return jsonb_build_object('found', false);
  end if;
  select coalesce((select canonical from public.port_route_alias where alias = v_pol), v_pol) into v_pol;
  select coalesce((select canonical from public.port_route_alias where alias = v_pod), v_pod) into v_pod;

  select * into r from public.port_routes
  where pair_key = least(v_pol, v_pod) || '|' || greatest(v_pol, v_pod)
  limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_fwd := (r.pol_locode = v_pol);
  if v_fwd then
    select jsonb_agg(jsonb_build_array(w.latitude, w.longitude, w.cumulative_nm) order by w.seq)
      into v_wps from public.port_route_waypoints w where w.route_id = r.id;
  else
    select jsonb_agg(jsonb_build_array(w.latitude, w.longitude,
             case when w.cumulative_nm is null then null
                  else round(greatest(r.total_nm - w.cumulative_nm, 0)::numeric, 1) end)
           order by w.seq desc)
      into v_wps from public.port_route_waypoints w where w.route_id = r.id;
  end if;

  return jsonb_build_object(
    'found', true,
    'total_nm', r.total_nm,
    'verified', r.verified,
    'source', r.source,
    'times_traded', r.times_traded,
    'chokepoints', to_jsonb(coalesce(r.chokepoints, '{}'::text[])),
    'waypoints', coalesce(v_wps, '[]'::jsonb)
  );
end $function$;

-- ── 2 · risk areas ──────────────────────────────────────────────────────────
create table if not exists public.risk_areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  severity    text not null default 'high_risk'
              check (severity in ('war_zone', 'high_risk', 'advisory')),
  alert_text  text,
  polygon     jsonb not null,            -- [[lat, lon], …] ring (≥ 3 points)
  is_active   boolean not null default true,
  notes       text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.risk_areas is
  'Admin-drawn war / high-risk / advisory areas. A route crossing an active area raises an insurance-premium alert on the chart.';

alter table public.risk_areas enable row level security;
drop policy if exists "risk_areas: members read active" on public.risk_areas;
create policy "risk_areas: members read active" on public.risk_areas
  for select to authenticated using (is_active or public.fn_is_admin());
drop policy if exists "risk_areas: admin all" on public.risk_areas;
create policy "risk_areas: admin all" on public.risk_areas
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
grant select on public.risk_areas to authenticated;
grant all on public.risk_areas to service_role;

drop trigger if exists trg_risk_areas_updated_at on public.risk_areas;
create trigger trg_risk_areas_updated_at
  before update on public.risk_areas
  for each row execute function public.fn_set_updated_at();

-- Seed (approximate JWC listed areas; the owner refines the shapes in Admin).
insert into public.risk_areas (name, severity, alert_text, polygon, notes)
select v.name, v.severity, v.alert_text, v.polygon::jsonb, v.notes
from (values
  ('Red Sea & Gulf of Aden', 'war_zone',
   'Transits the Red Sea / Gulf of Aden listed area — additional war-risk premium and possible routing via the Cape.',
   '[[30.0,32.3],[27.7,34.4],[24.0,35.5],[19.0,38.6],[15.0,42.0],[12.8,43.2],[12.0,44.5],[11.6,46.5],[12.2,51.5],[14.8,53.5],[15.8,51.5],[14.5,48.5],[13.9,45.5],[14.0,43.0],[17.5,40.5],[22.0,38.6],[25.5,36.2],[27.5,34.0],[29.3,32.7]]',
   'JWC listed area (approx.). Includes Bab-el-Mandeb.'),
  ('Persian Gulf, Gulf of Oman & Hormuz', 'high_risk',
   'Transits the Gulf / Strait of Hormuz listed area — additional war-risk premium applies.',
   '[[30.3,48.0],[29.8,50.2],[28.0,51.0],[26.6,52.6],[25.6,55.4],[26.6,56.4],[25.6,57.2],[24.4,58.8],[23.0,59.8],[22.2,60.8],[23.8,61.6],[25.4,59.4],[26.8,57.0],[27.8,55.0],[29.0,51.8],[30.0,49.2]]',
   'JWC listed area (approx.).'),
  ('Black Sea & Sea of Azov', 'war_zone',
   'Transits the Black Sea listed area — war-risk premium and port-specific restrictions apply.',
   '[[46.6,30.6],[46.2,32.8],[45.4,36.4],[47.3,39.4],[45.2,38.2],[43.4,41.6],[41.4,41.7],[41.0,36.0],[41.0,31.0],[41.2,28.9],[42.5,27.9],[43.8,28.4],[45.2,29.6]]',
   'JWC listed area (approx.).'),
  ('Gulf of Guinea', 'high_risk',
   'Transits the Gulf of Guinea listed area — piracy / war-risk premium applies.',
   '[[6.8,-5.8],[4.5,-2.0],[5.2,2.0],[6.2,3.5],[6.0,4.6],[4.4,6.6],[4.2,8.2],[2.8,9.6],[0.5,9.2],[-1.6,8.8],[-3.0,5.0],[-1.0,1.0],[1.0,-3.0],[3.6,-6.4]]',
   'JWC listed area (approx.).'),
  ('Somali Basin / Indian Ocean HRA', 'advisory',
   'Crosses the Indian Ocean high-risk area — BMP5 measures and an additional premium may apply.',
   '[[12.2,51.5],[9.0,55.0],[5.0,60.0],[-2.0,60.0],[-5.0,50.0],[-2.5,44.0],[1.8,45.4],[7.0,49.5],[11.0,50.8]]',
   'Industry HRA (approx.).'),
  ('Eastern Mediterranean — Levant coast', 'advisory',
   'Passes the Levant listed waters (Israel / Lebanon / Syria coast) — check current war-risk terms.',
   '[[36.2,35.9],[36.2,34.5],[34.8,34.9],[33.2,33.5],[31.4,33.7],[31.2,34.4],[32.4,34.9],[34.2,35.4],[35.4,35.9]]',
   'JWC listed area (approx.).')
) as v(name, severity, alert_text, polygon, notes)
where not exists (select 1 from public.risk_areas ra where ra.name = v.name);
