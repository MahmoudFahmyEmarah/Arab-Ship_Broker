-- Port dedupe round 2 — variant-spelling duplicates (user-reported: Jazan vs
-- Jizan) + resolutions VALIDATED against the official UNECE UN/LOCODE
-- registry (datasets/un-locode mirror of the UNECE code list, checked
-- 26 Jul 2026: Status/Function columns arbitrate real seaport codes).
--
-- A. Same-port variant codes — keep the used/official one, retire the other:
--   SAJAZ  Jazan            → duplicate spelling of Jizan (see also below)
--   TRZMT  Izmit (Kocaeli)  → TRIZT is the official Izmit
--   UAPIV  Pivdenniy        → UAYUZ official (Yuzhny/Pivdennyi)
--   GRELE  Eleusis          → same port as GRFLS (0 km), GRFLS carries usage
--   TNBIA  Bizerta          → spelling variant of TNBIZ (official)
--   DJDJI  Djibouti City    → duplicate of DJJIB
--   ITGHE  Porto Marghera   → duplicate of ITPMA (official)
--   ITORI  Oristano (Sard.) → duplicate of ITQOS (real code)
--   TREGS  Eregli/Zonguldak → same port as TRERE (Kdz Eregli, official)
--   GRSNC  Nea Karvali/Kav. → duplicate of GRNKV (official)
--   VEPJO  Jose             → duplicate of VEJOT (official)
--   ITCAR  Marina di Carrara→ workbook itself marks it "alt code" of ITCAA
--
-- B. UN/LOCODE-validated corrections (codes that are simply WRONG):
--   EGSFW, EGSFG  "Safaga"  → do not exist in the registry; EG SGA is the
--                             official Safaga seaport (QQ, function 1)
--   INMOR "Mangalore"       → IN MOR is Moradabad, an inland UP rail town
--                             (functions 2/3/6); the port is IN IXE (AA, 1)
--   GRATH "Athens/Piraeus"  → GR ATH has NO seaport function (4/5 = airport/
--                             postal); the seaport is GR PIR (function 1)
--   ITTER, ITTMI "Termini Imerese" → IT TER is Terni (inland, RL) and IT TMI
--                             is Termoli (different Adriatic port); the real
--                             Termini Imerese is IT TRI (AI, function 1)
--   SAJIZ, SAJAZ "Jizan/Jazan" → neither exists in the registry; the official
--                             Jizan seaport is SA GIZ (AI, functions 1+4)
--
-- Retired rows keep their FKs (existing listings unaffected) and the search
-- layers already suppress inactive codes, including the UN/LOCODE backstop.

UPDATE public.ports
SET is_active = false
WHERE locode IN (
  -- A: variant duplicates
  'SAJAZ','TRZMT','UAPIV','GRELE','TNBIA','DJDJI','ITGHE','ITORI','TREGS','GRSNC','VEPJO','ITCAR',
  -- B: registry-invalid codes
  'EGSFW','EGSFG','INMOR','GRATH','ITTER','ITTMI','SAJIZ'
);

-- Correct rows for the two ports whose every stored code was wrong.
INSERT INTO public.ports (locode, trade_name, country, zone, port_type, notes, is_verified, is_active)
VALUES
  ('SAGIZ', 'Jizan', 'Saudi Arabia', 'R.SEA', 'Sea Port',
   'Official UN/LOCODE SA GIZ (replaces retired SAJIZ/SAJAZ variants)', true, true),
  ('ITTRI', 'Termini Imerese', 'Italy', 'C.MED', 'Sea Port',
   'N Sicily bulk/industrial port. Official UN/LOCODE IT TRI (replaces retired ITTER=Terni / ITTMI=Termoli miscodes)', true, true)
ON CONFLICT (locode) DO UPDATE
SET trade_name = EXCLUDED.trade_name, is_active = true, is_verified = true;
