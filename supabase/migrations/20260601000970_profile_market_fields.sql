-- ════════════════════════════════════════════════════════════════════
-- Market Profile fields · append-only · existence-guarded
--
-- Adds operating_zones / preferred_cargo / dwt_min / dwt_max to profiles so
-- members can declare their trading focus. Guarded: if this database has no
-- public.profiles table (some environments derive personas from users.role
-- instead), the migration logs a notice and skips rather than failing.
-- ════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE NOTICE 'public.profiles not present — skipping market-profile columns';
    RETURN;
  END IF;

  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS operating_zones public.zone_enum[],
    ADD COLUMN IF NOT EXISTS preferred_cargo TEXT[],
    ADD COLUMN IF NOT EXISTS dwt_min INTEGER,
    ADD COLUMN IF NOT EXISTS dwt_max INTEGER;

  -- CHECK constraints (added separately so IF NOT EXISTS column guard stays clean)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_dwt_min_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_dwt_min_chk CHECK (dwt_min IS NULL OR dwt_min >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_dwt_max_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_dwt_max_chk CHECK (dwt_max IS NULL OR dwt_max >= 0);
  END IF;

  EXECUTE 'GRANT SELECT (operating_zones, preferred_cargo, dwt_min, dwt_max),
                 UPDATE (operating_zones, preferred_cargo, dwt_min, dwt_max)
             ON public.profiles TO authenticated';
END $$;
