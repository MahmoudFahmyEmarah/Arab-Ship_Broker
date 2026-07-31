-- Day-type & exceptions list expanded to the full standard laytime set
-- (owner request, 31 Jul 2026). The original Concept 4 / workbook 10_ENUMS
-- list carried only 7 values and missed the Friday-included family (FHINC)
-- used across the Gulf, plus the EIU/UU and Saturday variants. The column is
-- free text with no CHECK constraint — this comment documents the UI presets
-- (components/ledger/defs.ts LEDGER_ENUMS.dayExceptions is the live list).
--
-- Rollback: restore the previous comment (no data or schema change).

COMMENT ON COLUMN public.cargo_listings.day_exceptions IS
  'Which days count toward laytime. UI presets: WWD FHINC | WWD FHEX | WWD SHINC | WWD SHEX | FHINC | FHEX | FHEX EIU | FHEX UU | SHINC | SHEX | SHEX EIU | SHEX UU | SSHINC | SSHEX | CQD.';
