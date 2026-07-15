-- Phase 3: additive enum values (STATUS + ZONE combine decisions from the
-- 12-Jul workbook reconciliation). ADD VALUE is non-breaking and the new values
-- are not used within this migration, so it is safe in one transaction.
--
--   • vessel_status_enum: + BALLAST, OFF-HIRE  (workbook adds these; kept
--     uppercase to match the existing OPEN/FIXED/ON SUBS/INACTIVE convention;
--     INACTIVE retained — superset, nothing removed).
--   • zone_enum: + R.SEA.N, R.SEA.S (field spec: Red Sea N & S are SEPARATE
--     zones) and BALTIC (QC-03). Existing single R.SEA retained for legacy rows.

ALTER TYPE public.vessel_status_enum ADD VALUE IF NOT EXISTS 'BALLAST';
ALTER TYPE public.vessel_status_enum ADD VALUE IF NOT EXISTS 'OFF-HIRE';

ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'R.SEA.N';
ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'R.SEA.S';
ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'BALTIC';
