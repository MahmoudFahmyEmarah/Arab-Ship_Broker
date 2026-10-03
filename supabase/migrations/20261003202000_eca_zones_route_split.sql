-- ECA zones and the route ECA split (Voyage Economics, Stream S, 3 Oct 2026).
--
-- Emission control areas as [lat, lon] rings (same convention as risk_areas),
-- and fn_route_eca_split(pol, pod) which walks a measured port route's
-- waypoints and reports how many of its miles lie inside each active ECA.
-- The Voyage estimator prices those miles with 0.10% fuel (LSMGO/ULSFO).
--
-- Seed: the Mediterranean Sea ECA (MARPOL Annex VI, in force 1 May 2025),
-- bounded west by the 5°36'W meridian at Gibraltar and east by the Dardanelles.
-- The ring hugs the coasts coarsely; only sea waypoints are ever tested.

create table if not exists public.eca_zones (
  code              text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,20}$'),
  name              text not null check (length(trim(name)) between 2 and 120),
  polygon           jsonb not null,
  sulphur_limit_pct numeric(4,2) not null default 0.10 check (sulphur_limit_pct > 0 and sulphur_limit_pct <= 0.50),
  effective_from    date not null,
  is_active         boolean not null default true,
  notes             text,
  constraint eca_zones_polygon_ck check (jsonb_typeof(polygon) = 'array' and jsonb_array_length(polygon) >= 3)
);
alter table public.eca_zones enable row level security;
revoke all on table public.eca_zones from public, anon, authenticated;
grant all on table public.eca_zones to service_role;
drop policy if exists "eca: members read active" on public.eca_zones;
create policy "eca: members read active" on public.eca_zones for select to authenticated using (is_active);
grant select on table public.eca_zones to authenticated;

insert into public.eca_zones (code, name, polygon, sulphur_limit_pct, effective_from, notes)
values ('MED', 'Mediterranean Sea ECA (SOx)',
  '[[35.85,-5.6],[36.15,-5.6],[36.7,-4.4],[37.6,-0.6],[38.9,0.3],[40.5,0.6],[41.3,2.3],[42.8,3.3],[43.4,5.0],[43.8,7.5],[44.4,9.0],[43.9,10.4],[41.9,12.3],[40.6,14.8],[39.0,16.5],[40.4,18.5],[41.9,16.2],[43.6,13.5],[45.0,12.4],[45.8,13.5],[44.9,14.0],[43.5,16.0],[42.5,18.5],[40.2,19.7],[37.9,21.0],[36.3,23.0],[38.0,24.5],[39.5,25.5],[40.1,26.2],[39.0,26.6],[37.0,27.5],[36.3,30.0],[36.8,31.5],[36.2,34.2],[35.5,35.9],[33.9,35.5],[32.1,34.8],[31.3,34.3],[31.3,32.3],[31.5,30.0],[31.1,28.0],[32.0,24.0],[32.9,21.5],[30.5,19.0],[32.9,13.2],[33.9,10.9],[36.9,10.3],[37.1,8.5],[36.8,3.0],[35.7,-0.6],[35.3,-3.0]]'::jsonb,
  0.10, date '2025-05-01',
  'MARPOL Annex VI Med SOx ECA, 0.10% from 1 May 2025. Excludes the Marmara/Black Sea and the Suez Canal.')
on conflict (code) do nothing;

-- Ray casting on a [lat, lon] ring. Returns false for degenerate input.
create or replace function public.fn_point_in_ring(p_lat numeric, p_lon numeric, p_ring jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $pir$
declare
  n integer;
  i integer;
  j integer;
  xi numeric; yi numeric; xj numeric; yj numeric;
  inside boolean := false;
begin
  if p_lat is null or p_lon is null or p_ring is null or jsonb_typeof(p_ring) <> 'array' then
    return false;
  end if;
  n := jsonb_array_length(p_ring);
  if n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_ring -> i ->> 0)::numeric; xi := (p_ring -> i ->> 1)::numeric;
    yj := (p_ring -> j ->> 0)::numeric; xj := (p_ring -> j ->> 1)::numeric;
    if ((yi > p_lat) <> (yj > p_lat))
       and (p_lon < (xj - xi) * (p_lat - yi) / nullif(yj - yi, 0) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end;
$pir$;
revoke all on function public.fn_point_in_ring(numeric, numeric, jsonb) from public, anon;
grant execute on function public.fn_point_in_ring(numeric, numeric, jsonb) to authenticated, service_role;

-- Walks the measured route (either direction) and attributes each segment's
-- miles to the ECAs its endpoints fall in: both inside → all, one inside →
-- half, none → none. Distance-only rows (no waypoints) report found=true,
-- ecaNm=null so callers fall back to the zone rule in lib/voyage/eca.ts.
create or replace function public.fn_route_eca_split(p_pol text, p_pod text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $split$
declare
  v_pol text := upper(trim(coalesce(p_pol, '')));
  v_pod text := upper(trim(coalesce(p_pod, '')));
  r public.port_routes%rowtype;
  v_zone record;
  v_prev record;
  v_cur record;
  v_seg numeric;
  v_total numeric := 0;
  v_by jsonb := '{}'::jsonb;
  v_eca numeric := 0;
  v_in_prev boolean;
  v_in_cur boolean;
  v_wp_count integer := 0;
begin
  if v_pol = '' or v_pod = '' then
    return jsonb_build_object('found', false);
  end if;
  select * into r from public.port_routes
   where (pol_locode = v_pol and pod_locode = v_pod) or (pol_locode = v_pod and pod_locode = v_pol)
   order by (pol_locode = v_pol) desc, verified desc, times_traded desc
   limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  if coalesce(r.waypoint_count, 0) < 2 then
    return jsonb_build_object('found', true, 'totalNm', r.total_nm, 'ecaNm', null, 'byZone', '{}'::jsonb, 'method', 'distance_only');
  end if;

  for v_zone in select code, polygon from public.eca_zones where is_active and effective_from <= current_date loop
    v_eca := 0; v_prev := null; v_in_prev := null;
    for v_cur in
      select w.latitude, w.longitude, w.cumulative_nm
        from public.port_route_waypoints w
       where w.route_id = r.id
       order by w.seq
    loop
      v_in_cur := public.fn_point_in_ring(v_cur.latitude, v_cur.longitude, v_zone.polygon);
      if v_prev is not null and v_cur.cumulative_nm is not null and v_prev.cumulative_nm is not null then
        v_seg := greatest(v_cur.cumulative_nm - v_prev.cumulative_nm, 0);
        if v_in_cur and v_in_prev then v_eca := v_eca + v_seg;
        elsif v_in_cur or v_in_prev then v_eca := v_eca + v_seg / 2;
        end if;
      end if;
      v_prev := v_cur; v_in_prev := v_in_cur;
    end loop;
    v_by := v_by || jsonb_build_object(v_zone.code, round(v_eca, 1));
    v_total := v_total + v_eca;
  end loop;

  select count(*) into v_wp_count from public.port_route_waypoints where route_id = r.id;
  return jsonb_build_object(
    'found', true, 'totalNm', r.total_nm,
    'ecaNm', round(least(v_total, r.total_nm), 1),
    'byZone', v_by, 'waypointCount', v_wp_count,
    'chokepoints', to_jsonb(coalesce(r.chokepoints, '{}'::text[])),
    'method', 'waypoints');
end;
$split$;
revoke all on function public.fn_route_eca_split(text, text) from public, anon;
grant execute on function public.fn_route_eca_split(text, text) to authenticated, service_role;
