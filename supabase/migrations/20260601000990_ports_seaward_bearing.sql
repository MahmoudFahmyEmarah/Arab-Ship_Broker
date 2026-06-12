-- ════════════════════════════════════════════════════════════════════
-- Ports — seaward bearing · append-only · existence-guarded (09 §7)
--
-- Compass direction (0 = North) from the port toward open water; drives the
-- land/sea marker anchoring. Guarded: skips cleanly if public.ports is absent.
-- ════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.ports') IS NULL THEN
    RAISE NOTICE 'public.ports not present — skipping seaward_bearing';
    RETURN;
  END IF;

  ALTER TABLE public.ports
    ADD COLUMN IF NOT EXISTS seaward_bearing SMALLINT;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ports_seaward_bearing_chk') THEN
    ALTER TABLE public.ports ADD CONSTRAINT ports_seaward_bearing_chk
      CHECK (seaward_bearing IS NULL OR (seaward_bearing BETWEEN 0 AND 359));
  END IF;
  EXECUTE 'GRANT SELECT (seaward_bearing) ON public.ports TO authenticated';

  UPDATE public.ports SET seaward_bearing = v.b
  FROM (VALUES
    ('Constanta', 110), ('Istanbul', 180), ('Novorossiysk', 225), ('Odessa', 135),
    ('Izmir', 270), ('Piraeus', 200), ('Mersin', 180), ('Iskenderun', 225),
    ('Beirut', 270), ('Alexandria', 0), ('Damietta', 0), ('Port Said', 0),
    ('Aqaba', 180), ('Yanbu', 250), ('Jeddah', 270), ('Jebel Ali', 315),
    ('Sohar', 45), ('Fujairah', 90), ('Mumbai', 250), ('Dar es Salaam', 90)
  ) AS v(name, b)
  WHERE public.ports.trade_name = v.name AND public.ports.seaward_bearing IS NULL;
END $$;
