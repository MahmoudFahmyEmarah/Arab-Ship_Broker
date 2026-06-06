-- ════════════════════════════════════════════════════════════════════
-- Zone enum additions — append-only
--
-- The unified master dataset covers two trade zones not yet in zone_enum:
--   ECSA — East Coast South America
--   WCI  — West Coast India
-- Add them so ports / cargo / vessel positions in those zones import cleanly
-- and the public zone counter reflects the real 16-zone coverage.
-- (ADD VALUE IF NOT EXISTS is idempotent; must be committed before any seed
--  that references the new values can use them.)
-- ════════════════════════════════════════════════════════════════════

ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'ECSA';
ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'WCI';
