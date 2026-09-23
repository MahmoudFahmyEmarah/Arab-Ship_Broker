-- ════════════════════════════════════════════════════════════════════════
-- Suez transit — geography is the final word (12 Sep 2026)
--
-- The 9 Sep fix tightened the chokepoint boxes and recomputed every measured
-- route; the owner's Sfax → Port Said case has been clean since. This adds the
-- guarantees that keep it clean for every FUTURE row:
--
--   fn_suez_side(lat, lon)      which side of the canal a point lies on — the
--                               same rule as lib/portal/risk-areas.ts
--                               suezSideOf(); one truth for both layers.
--   trg_port_routes_suez_guard  strips SUEZ from chokepoints whenever the two
--                               ports sit on the SAME side (a Med → Med or
--                               Red Sea → Gulf pair can never have transited),
--                               on insert and on update. A tag can only be
--                               removed here, never added.
--   fn_port_routes_recompute_chokepoints()
--                               the 9 Sep box test as a callable function, so
--                               the importer (or an admin) can re-tag new
--                               measured rows instead of waiting for a migration.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_suez_side(p_lat numeric, p_lon numeric)
 returns text language sql immutable set search_path to ''
as $$
  -- "S" = the Red Sea and every sea reached through it (Gulf of Aden, East
  -- Africa, the Gulf up to Shatt al-Arab, Indian Ocean, Far East); otherwise
  -- "N" (Med, Black Sea, Atlantic, N Europe, Americas, W Africa).
  select case
    when p_lat is null or p_lon is null then null
    when p_lon >= 60 then 'S'
    when p_lon >= 44 and p_lat <= 31 then 'S'
    when p_lon >= 32.3 and p_lat <= 30.0 then 'S'
    else 'N' end;
$$;
revoke all on function public.fn_suez_side(numeric, numeric) from public, anon, authenticated;
grant execute on function public.fn_suez_side(numeric, numeric) to service_role;

create or replace function public.fn_port_routes_suez_guard()
 returns trigger language plpgsql set search_path to ''
as $$
declare a text; b text;
begin
  if new.chokepoints is null or not ('SUEZ' = any(new.chokepoints)) then return new; end if;
  select public.fn_suez_side(p.latitude, p.longitude) into a from public.ports p where p.locode = new.pol_locode limit 1;
  select public.fn_suez_side(p.latitude, p.longitude) into b from public.ports p where p.locode = new.pod_locode limit 1;
  if a is not null and b is not null and a = b then
    new.chokepoints := array_remove(new.chokepoints, 'SUEZ');
  end if;
  return new;
end $$;

drop trigger if exists trg_port_routes_suez_guard on public.port_routes;
create trigger trg_port_routes_suez_guard
  before insert or update of chokepoints, pol_locode, pod_locode on public.port_routes
  for each row execute function public.fn_port_routes_suez_guard();

-- The 9 Sep box test, callable. Returns the number of rows whose tags changed.
create or replace function public.fn_port_routes_recompute_chokepoints()
 returns integer language plpgsql security definer set search_path to ''
as $$
declare n integer;
begin
  with boxes(cp, lat0, lat1, lon0, lon1) as (
    values ('SUEZ',          30.15, 31.05,  32.20,  32.70),
           ('BOSPHORUS',     41.07, 41.22,  28.98,  29.18),
           ('DARDANELLES',   40.20, 40.45,  26.45,  26.75),
           ('BAB_EL_MANDEB', 12.30, 13.20,  43.00,  43.80),
           ('HORMUZ',        26.30, 26.75,  56.20,  56.80),
           ('GIBRALTAR',     35.85, 36.05,  -5.72,  -5.52)
  ), seg as (
    select w.route_id, w.latitude lat_a, w.longitude lon_a,
           lead(w.latitude)  over (partition by w.route_id order by w.seq) lat_b,
           lead(w.longitude) over (partition by w.route_id order by w.seq) lon_b
    from public.port_route_waypoints w
  ), dense as (
    select s.route_id,
           s.lat_a + (s.lat_b - s.lat_a) * g.k / n.n as lat,
           s.lon_a + (s.lon_b - s.lon_a) * g.k / n.n as lon
    from seg s
    cross join lateral (select greatest(1, ceil(greatest(abs(s.lat_b - s.lat_a), abs(s.lon_b - s.lon_a)) / 0.05))::int as n) n
    cross join lateral generate_series(0, n.n) g(k)
    where s.lat_b is not null and abs(s.lon_b - s.lon_a) < 180
  ), hits as (
    select d.route_id, array_agg(distinct b.cp order by b.cp) as cps
    from dense d join boxes b on d.lat between b.lat0 and b.lat1 and d.lon between b.lon0 and b.lon1
    group by d.route_id
  )
  update public.port_routes r
     set chokepoints = coalesce(hits.cps, '{}'::text[])
    from (select id from public.port_routes where waypoint_count >= 3) g
    left join hits on hits.route_id = g.id
   where r.id = g.id
     and r.chokepoints is distinct from coalesce(hits.cps, '{}'::text[]);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.fn_port_routes_recompute_chokepoints() from public, anon, authenticated;
grant execute on function public.fn_port_routes_recompute_chokepoints() to service_role;

-- One-off: apply the side guard to every existing row (expected: 0 changes —
-- verified clean on 12 Sep — but the trigger fires through this update anyway).
update public.port_routes set chokepoints = chokepoints where 'SUEZ' = any(chokepoints);
