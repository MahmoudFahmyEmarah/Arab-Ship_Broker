ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS priority           TEXT,
  ADD COLUMN IF NOT EXISTS nor_clause         TEXT,
  ADD COLUMN IF NOT EXISTS congestion         TEXT,
  ADD COLUMN IF NOT EXISTS demurrage_tbar     TEXT,
  ADD COLUMN IF NOT EXISTS laytime_structure  TEXT;

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS dwcc               INTEGER,
  ADD COLUMN IF NOT EXISTS beam_m             NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS grain_cbm          INTEGER,
  ADD COLUMN IF NOT EXISTS vessel_class       TEXT,
  ADD COLUMN IF NOT EXISTS direction_pref     TEXT,
  ADD COLUMN IF NOT EXISTS charter_type       TEXT,
  ADD COLUMN IF NOT EXISTS source_channel     TEXT;

ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS ref                TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_ref
  ON public.vessel_availability (ref)
  WHERE ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cargo_priority
  ON public.cargo_listings (priority);