-- ---------------------------------------------------------------------------
-- Standardise the load_terms vocabulary (Baltic Exchange convention).
--
-- The canonical set now lives in lib/schemas/cargo.ts (LOAD_TERMS) and drives
-- the cargo form, cargo card, detail panels, the map/board filters and the AI
-- circular parser. This migration brings the DB enum in line by adding the four
-- new codes. Postgres cannot drop enum values without recreating the type (the
-- v_live_cargo view depends on the column), and all cargo_listings.load_terms
-- values are currently NULL, so we ADD the new codes and leave the two legacy
-- values (FIOS LSD, Liner Terms) physically present but unused — the app never
-- offers them again.
-- ---------------------------------------------------------------------------
ALTER TYPE public.load_terms_enum ADD VALUE IF NOT EXISTS 'FO';
ALTER TYPE public.load_terms_enum ADD VALUE IF NOT EXISTS 'FILO';
ALTER TYPE public.load_terms_enum ADD VALUE IF NOT EXISTS 'LIFO';
ALTER TYPE public.load_terms_enum ADD VALUE IF NOT EXISTS 'FLT';
