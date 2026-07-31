-- Port enrichment metadata (26 Jul). After two rounds of hand-validating
-- codes against the official UNECE UN/LOCODE registry, persist that
-- validation on the row so data quality is inspectable at any time:
--   unlocode_status   — registry Status (AA/AI/AC = adopted, RQ = requested,
--                       RL = recognised location, QQ = original entry, …);
--                       NULL = code not found in the registry.
--   unlocode_function — registry Function string (e.g. "1--45---");
--                       a leading "1" marks an official seaport.
-- Coordinates (latitude/longitude, columns already present) are back-filled
-- by scripts/enrich-ports.mjs from the registry with reference-list
-- fallbacks — write-once, never overwriting existing values.

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS unlocode_status   text,
  ADD COLUMN IF NOT EXISTS unlocode_function text;

COMMENT ON COLUMN public.ports.unlocode_status   IS 'UNECE UN/LOCODE Status at last enrichment (NULL = code absent from the official registry).';
COMMENT ON COLUMN public.ports.unlocode_function IS 'UNECE UN/LOCODE Function digits; leading 1 = official seaport.';
