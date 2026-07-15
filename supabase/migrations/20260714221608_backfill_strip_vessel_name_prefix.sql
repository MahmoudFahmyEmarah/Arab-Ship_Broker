-- DQ-V01 backfill: strip the "MV" / "M/V" / "M.V" / "MT" / "M/T" motor-vessel
-- prefix from already-stored vessel names, matching the app-side
-- stripVesselNamePrefix() util (lib/schemas/vessel.ts) and the sync ingestion
-- transform. Idempotent — re-running changes nothing once names are clean.
-- The Postgres pattern mirrors the JS regex: it only strips when the V/T sits on
-- a word boundary followed by a separator, so "MVMARILOU" and "MS FIREFLY" are
-- left alone, and it never blanks a name to '' (guarded in the WHERE clause).
UPDATE public.vessels
SET vessel_name = btrim(regexp_replace(vessel_name, '^\s*M[./]?\s?[VT]\y[\s.:-]*', '', 'i'))
WHERE vessel_name ~* '^\s*M[./]?\s?[VT]\y'
  AND btrim(regexp_replace(vessel_name, '^\s*M[./]?\s?[VT]\y[\s.:-]*', '', 'i')) <> '';
