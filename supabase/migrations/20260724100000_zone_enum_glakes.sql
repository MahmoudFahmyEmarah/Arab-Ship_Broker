-- Broker Ledger phase 1a: GLAKES zone.
-- The 24-Jul UNIFIED workbook 04_PORTS carries one Great Lakes port; QC-03
-- lists GLAKES among the valid out-zones. R.SEA.N / R.SEA.S / BALTIC were
-- already added by 20260713171045.
--
-- ADD VALUE must commit before any other migration/seed references the value,
-- so this lives alone in its own migration.

ALTER TYPE public.zone_enum ADD VALUE IF NOT EXISTS 'GLAKES';
