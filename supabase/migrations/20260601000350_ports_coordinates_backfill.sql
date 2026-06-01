-- ════════════════════════════════════════════════════════════════════
-- Ports coordinate backfill (Phase 5 — shared map)
-- The original ports seed populated locode/name/zone but left
-- latitude/longitude NULL, so the Leaflet map had nothing to plot.
-- Backfill approximate port coordinates for every seeded port.
-- Values are display-grade (port-city/terminal centroids), not WGS84
-- berth-precise. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

UPDATE public.ports AS p
SET latitude  = c.lat,
    longitude = c.lon
FROM (VALUES
  ('UA ODS', 46.490, 30.740),   -- Odessa
  ('UA ILK', 46.300, 30.660),   -- Chornomorsk
  ('UA YUZ', 46.620, 31.000),   -- Pivdennyi
  ('UA IZM', 45.350, 28.840),   -- Izmail
  ('RO CND', 44.170, 28.660),   -- Constanta
  ('BG VAR', 43.200, 27.920),   -- Varna
  ('RU NOI', 44.720, 37.790),   -- Novorossiysk
  ('TR ISK', 36.580, 36.170),   -- Iskenderun
  ('TR MRA', 40.610, 27.550),   -- Marmara Adasi
  ('TR MER', 36.800, 34.630),   -- Mersin
  ('EG ALY', 31.200, 29.870),   -- Alexandria
  ('EG DAM', 31.420, 31.820),   -- Damietta
  ('EG PSD', 31.260, 32.300),   -- Port Said
  ('SY LTK', 35.520, 35.780),   -- Lattakia
  ('JO AQB', 29.520, 35.000),   -- Aqaba
  ('AE JEA', 25.010, 55.060),   -- Jebel Ali
  ('GR KLM', 37.910, 23.700),   -- Kalamaki
  ('GR FLS', 38.040, 23.540),   -- Eleusis
  ('IT RAN', 44.420, 12.200),   -- Ravenna
  ('TN BIZ', 37.270, 9.870),    -- Bizerte
  ('MA CAS', 33.600, -7.620),   -- Casablanca
  ('GH TEM', 5.620, -0.010),    -- Tema
  ('LY BEN', 32.120, 20.070),   -- Benghazi
  ('SA KAC', 22.500, 39.100),   -- King Abdullah Port
  ('TR ERE', 41.280, 31.420)    -- Eregli (Kdz)
) AS c(locode, lat, lon)
WHERE p.locode = c.locode;
