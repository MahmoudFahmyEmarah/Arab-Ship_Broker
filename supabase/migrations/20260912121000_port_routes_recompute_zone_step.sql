-- fn_port_routes_recompute_chokepoints(): also re-derive the tags of
-- distance-only rows (waypoint_count < 3) from the two ports' trading zones —
-- the 4 Sep 2026 inference, now callable — so a wholesale re-import by
-- scripts/import-port-routes.mjs (which writes no chokepoints) does not lose the
-- Suez / Bosphorus / Hormuz / Gibraltar tags on the ~37k MARNET rows. The
-- trg_port_routes_suez_guard trigger still fires on every row this touches, so
-- a same-side SUEZ can never survive either step. Returns rows changed.
create or replace function public.fn_port_routes_recompute_chokepoints()
 returns integer language plpgsql security definer set search_path to ''
as $$
declare n1 integer := 0; n2 integer := 0;
begin
  -- a) measured rows: densified box test on the stored track
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
  get diagnostics n1 = row_count;

  -- b) distance-only rows: infer from the two ports' trading zones (4 Sep rule)
  with z as (
    select r.id,
           (select p.zone::text from public.ports p where p.locode = r.pol_locode limit 1) as za,
           (select p.zone::text from public.ports p where p.locode = r.pod_locode limit 1) as zb
    from public.port_routes r
    where coalesce(r.waypoint_count, 0) < 3
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
  update public.port_routes r
     set chokepoints = derived.cps
    from derived
   where r.id = derived.id
     and r.chokepoints is distinct from derived.cps;
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;
revoke all on function public.fn_port_routes_recompute_chokepoints() from public, anon, authenticated;
grant execute on function public.fn_port_routes_recompute_chokepoints() to service_role;
