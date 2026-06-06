-- ════════════════════════════════════════════════════════════════════
-- Market Profile fields — append-only
--
-- The Settings "Market Profile" card showed Operating zones / Preferred cargo
-- / DWT range focus as "Not set" because they had no storage. Add them to the
-- per-account profile so members can declare their trading focus (visible to
-- Arab ShipBroker only — same row the owner already updates via RLS).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS operating_zones public.zone_enum[],
  ADD COLUMN IF NOT EXISTS preferred_cargo TEXT[],
  ADD COLUMN IF NOT EXISTS dwt_min INTEGER CHECK (dwt_min IS NULL OR dwt_min >= 0),
  ADD COLUMN IF NOT EXISTS dwt_max INTEGER CHECK (dwt_max IS NULL OR dwt_max >= 0);

-- Owners already have UPDATE on their own profiles (RLS "Users update own
-- profiles"); make sure the new columns are grantable.
GRANT SELECT (operating_zones, preferred_cargo, dwt_min, dwt_max),
      UPDATE (operating_zones, preferred_cargo, dwt_min, dwt_max)
  ON public.profiles TO authenticated;
