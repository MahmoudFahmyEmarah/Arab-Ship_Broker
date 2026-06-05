-- ════════════════════════════════════════════════════════════════════
-- Subscription tier (T1–T4) + market-partner flag
-- Drives the "upgrade to see the full record" wall for non-subscribers.
--
-- IMPORTANT — this does NOT change the contact firewall. Counterparty
-- identity/contact remains admin/owner-only (v_vessel_detail is untouched).
-- The tier only decides whether a non-owner sees the upgrade teaser
-- (T1/T2) or the "brokered by Arab ShipBroker" locked card (T3/T4/partner).
-- Admin sets these via admin tooling (service role); no self-service grant.
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE public.subscription_tier_enum AS ENUM ('T1', 'T2', 'T3', 'T4');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_tier public.subscription_tier_enum
    NOT NULL DEFAULT 'T1',
  ADD COLUMN IF NOT EXISTS is_market_partner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.subscription_tier IS
  'Subscription ladder T1–T4. T1/T2 = free/promoted (see upgrade wall); '
  'T3/T4 = subscriber. Does NOT grant counterparty contact — that stays '
  'admin/owner-only per the contact firewall.';
COMMENT ON COLUMN public.users.is_market_partner IS
  'Arab ShipBroker market partner. Treated as a subscriber for the upgrade '
  'wall. Does NOT grant counterparty contact.';
