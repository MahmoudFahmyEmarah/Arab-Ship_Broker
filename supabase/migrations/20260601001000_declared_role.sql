-- ════════════════════════════════════════════════════════════════════
-- Onboarding taxonomy — declared role · append-only
--
-- The signup now offers the design's account taxonomy (Principal Vessel
-- Owner / Principal Cargo Owner–Charterer / Broker with a cargo, vessel or
-- dual desk). The legacy user_role enum is NEVER changed (platform
-- principle: enums only widen); the precise declaration is captured here,
-- while user_role keeps driving the existing personas
-- (vessel_owner / cargo_owner / broker) exactly as before.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS declared_role text
    CHECK (declared_role IS NULL OR declared_role IN
      ('principal_owner','principal_charterer','broker_cargo','broker_vessel','broker_dual'));

GRANT SELECT (declared_role) ON public.users TO authenticated;
