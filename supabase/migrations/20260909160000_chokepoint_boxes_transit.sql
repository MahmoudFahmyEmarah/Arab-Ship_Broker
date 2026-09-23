-- ════════════════════════════════════════════════════════════════════════
-- Chokepoint boxes: transit-only (09 Sep 2026)
--
-- The 4 Sep boxes were drawn around the whole passage, so the terminal
-- ports sat inside them: Port Said / Port Said East (north end of the Suez
-- Canal), Adabiya (south end), Istanbul (Bosphorus), Canakkale (Dardanelles),
-- Tangier (Gibraltar) and Mina Saqr (Hormuz). Any ECDIS track that merely
-- CALLED at one of those ports was stamped as a transit — the owner saw a
-- "Suez Canal transit" alert on Sfax → Port Said (1,132 NM, entirely in the
-- Mediterranean; searoute-py gives the same track with and without the canal).
--
-- Fix: boxes now cover only the inner part of each passage, with no port
-- inside, and the test densifies every segment so a sparse track (one
-- waypoint per canal end) still registers. Geometry rows are recomputed;
-- distance-only MARNET rows keep the zone inference from 4 Sep.
-- Same boxes as lib/portal/risk-areas.ts CHOKEPOINT_BOXES — one truth.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

with boxes(cp, lat0, lat1, lon0, lon1) as (
  values ('SUEZ',          30.15, 31.05,  32.20,  32.70),   -- El Qantara → Great Bitter Lake; Port Said 31.27 / Adabiya 29.87 outside
         ('BOSPHORUS',     41.07, 41.22,  28.98,  29.18),   -- Rumeli Hisarı → north entrance; Istanbul 41.02 outside
         ('DARDANELLES',   40.20, 40.45,  26.45,  26.75),   -- Nara Burnu → Gelibolu; Canakkale 40.15 outside
         ('BAB_EL_MANDEB', 12.30, 13.20,  43.00,  43.80),
         ('HORMUZ',        26.30, 26.75,  56.20,  56.80),   -- the TSS off Musandam; Mina Saqr 25.97 / Khasab 26.20 outside
         ('GIBRALTAR',     35.85, 36.05,  -5.72,  -5.52)    -- Tarifa narrows; Tangier -5.82 outside
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
  from dense d
  join boxes b on d.lat between b.lat0 and b.lat1 and d.lon between b.lon0 and b.lon1
  group by d.route_id
)
update public.port_routes r
   set chokepoints = coalesce(hits.cps, '{}'::text[])
  from (select id from public.port_routes where waypoint_count >= 3) g
  left join hits on hits.route_id = g.id
 where r.id = g.id
   and r.chokepoints is distinct from coalesce(hits.cps, '{}'::text[]);
