-- ════════════════════════════════════════════════════════════════════
-- Ports — seaward bearing · append-only (09_pre_final_polish §7)
--
-- Compass direction (degrees, 0 = North) from the port toward open water.
-- Drives geographic marker anchoring on every map: cargo is placed LANDWARD
-- (opposite the bearing — goods at the terminal, never floating), vessels
-- SEAWARD (in the approaches, never on land); same-port jitter runs along
-- the coast-parallel axis only so it can never flip a marker across the
-- coastline. Per the spec, this belongs in the ports table beside lat/lng —
-- not hardcoded in the UI.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS seaward_bearing SMALLINT
    CHECK (seaward_bearing IS NULL OR (seaward_bearing BETWEEN 0 AND 359));

GRANT SELECT (seaward_bearing) ON public.ports TO authenticated;

-- Surveyed bearings from the design registry (asb/map.jsx PORTS). Ports not
-- listed keep NULL → the UI falls back to plain coordinate jitter.
UPDATE public.ports SET seaward_bearing = v.b
FROM (VALUES
  ('Constanta', 110), ('Istanbul', 180), ('Novorossiysk', 225), ('Odessa', 135),
  ('Izmir', 270), ('Piraeus', 200), ('Mersin', 180), ('Iskenderun', 225),
  ('Beirut', 270), ('Alexandria', 0), ('Damietta', 0), ('Port Said', 0),
  ('Aqaba', 180), ('Yanbu', 250), ('Jeddah', 270), ('Jebel Ali', 315),
  ('Sohar', 45), ('Fujairah', 90), ('Mumbai', 250), ('Dar es Salaam', 90)
) AS v(name, b)
WHERE public.ports.trade_name = v.name;
