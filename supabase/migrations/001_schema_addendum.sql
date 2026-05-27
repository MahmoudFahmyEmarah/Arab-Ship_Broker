-- ============================================================
-- ARAB SHIPBROKER — SCHEMA ADDENDUM v1
-- Run AFTER the base schema (arabshipbroker_schema.sql)
-- Date: 27 May 2026
-- ============================================================

-- ── 1. SUBSCRIPTION TIER on users ────────────────────────────
-- Separate from trust_tier (moderation). T1-T4 = commercial access.

CREATE TYPE subscription_tier_enum AS ENUM ('T1','T2','T3','T4');

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_tier subscription_tier_enum NOT NULL DEFAULT 'T1';

CREATE INDEX IF NOT EXISTS idx_users_subscription ON users (subscription_tier);

-- ── 2. DWCC on vessels ────────────────────────────────────────
-- Commercial intake capacity. DWCC is the matchmaking number.

ALTER TABLE vessels
  ADD COLUMN IF NOT EXISTS dwcc INTEGER,
  ADD COLUMN IF NOT EXISTS grain_cbm NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS bale_cbm NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);

CREATE INDEX IF NOT EXISTS idx_vessels_dwcc ON vessels (dwcc) WHERE dwcc IS NOT NULL;

-- ── 3. CARGO LISTING additions ───────────────────────────────
-- WOG flag, circulation, multi-port, volume, laytime qualifier

ALTER TABLE cargo_listings
  ADD COLUMN IF NOT EXISTS is_wog BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS for_circulation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS market_partner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_partner_name TEXT,
  ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS commodity_category TEXT,
  ADD COLUMN IF NOT EXISTS laytime_qualifier TEXT,
  -- Multi-port load
  ADD COLUMN IF NOT EXISTS load_port_2_locode TEXT REFERENCES ports(locode),
  ADD COLUMN IF NOT EXISTS load_port_2_name TEXT,
  ADD COLUMN IF NOT EXISTS load_port_3_locode TEXT REFERENCES ports(locode),
  ADD COLUMN IF NOT EXISTS load_port_3_name TEXT,
  ADD COLUMN IF NOT EXISTS load_port_4_locode TEXT REFERENCES ports(locode),
  ADD COLUMN IF NOT EXISTS load_port_4_name TEXT,
  -- Multi-port discharge
  ADD COLUMN IF NOT EXISTS disch_port_2_locode TEXT REFERENCES ports(locode),
  ADD COLUMN IF NOT EXISTS disch_port_2_name TEXT,
  ADD COLUMN IF NOT EXISTS disch_port_3_locode TEXT REFERENCES ports(locode),
  ADD COLUMN IF NOT EXISTS disch_port_3_name TEXT,
  ADD COLUMN IF NOT EXISTS disch_port_4_locode TEXT REFERENCES ports(locode),
  ADD COLUMN IF NOT EXISTS disch_port_4_name TEXT;

CREATE INDEX IF NOT EXISTS idx_cl_wog         ON cargo_listings (is_wog) WHERE is_wog = TRUE;
CREATE INDEX IF NOT EXISTS idx_cl_circulation ON cargo_listings (for_circulation) WHERE for_circulation = TRUE;
CREATE INDEX IF NOT EXISTS idx_cl_partner     ON cargo_listings (market_partner_id) WHERE market_partner_id IS NOT NULL;

-- ── 4. VESSEL AVAILABILITY — bunker split ────────────────────
ALTER TABLE vessel_availability
  ADD COLUMN IF NOT EXISTS vlsfo_sea_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS lsmgo_sea_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS vlsfo_port_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS lsmgo_port_mt_day NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS broker TEXT,
  ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS for_circulation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS market_partner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_partner_name TEXT;

-- ── 5. FUEL PRICES table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_prices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sponsor_name    TEXT NOT NULL,
  port_area       TEXT NOT NULL,
  vlsfo_usd_mt    NUMERIC(8,2),
  lsmgo_usd_mt    NUMERIC(8,2),
  mgo_usd_mt      NUMERIC(8,2),
  ifo380_usd_mt   NUMERIC(8,2),
  vlsfo_direction TEXT CHECK (vlsfo_direction IN ('up','down','flat')),
  lsmgo_direction TEXT CHECK (lsmgo_direction IN ('up','down','flat')),
  mgo_direction   TEXT CHECK (mgo_direction IN ('up','down','flat')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fuel_prices: all read active" ON fuel_prices
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "fuel_prices: admin all" ON fuel_prices
  FOR ALL USING (fn_is_admin());

CREATE INDEX IF NOT EXISTS idx_fp_active ON fuel_prices (is_active, updated_at DESC);

-- Seed initial O Bunkering / Sohar entry
INSERT INTO fuel_prices (sponsor_name, port_area, vlsfo_usd_mt, lsmgo_usd_mt, vlsfo_direction, lsmgo_direction)
VALUES ('O Bunkering', 'Sohar / Salalah', 582, 648, 'up', 'flat')
ON CONFLICT DO NOTHING;

-- ── 6. VOYAGE ESTIMATES table ────────────────────────────────
CREATE TABLE IF NOT EXISTS voyage_estimates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_id         UUID REFERENCES vessels(id) ON DELETE SET NULL,
  cargo_id          UUID REFERENCES cargo_listings(id) ON DELETE SET NULL,
  vessel_name       TEXT,
  cargo_name        TEXT,
  pol_locode        TEXT,
  pod_locode        TEXT,
  -- Port DAs
  pol_port_dues     NUMERIC(10,2),
  pol_agency_fee    NUMERIC(10,2),
  pol_pilotage      NUMERIC(10,2),
  pod_port_dues     NUMERIC(10,2),
  pod_agency_fee    NUMERIC(10,2),
  pod_pilotage      NUMERIC(10,2),
  -- Bunker
  vlsfo_sea_rate    NUMERIC(6,2),
  lsmgo_port_rate   NUMERIC(6,2),
  vlsfo_price       NUMERIC(8,2),
  lsmgo_price       NUMERIC(8,2),
  sea_days          NUMERIC(5,1),
  port_days         NUMERIC(5,1),
  -- Load/Disch
  load_rate_mt_day  NUMERIC(8,0),
  disch_rate_mt_day NUMERIC(8,0),
  quantity_mt       INTEGER,
  load_terms        TEXT,
  -- Suez
  suez_direction    TEXT,
  sca_dues          NUMERIC(10,2),
  suez_mooring      NUMERIC(8,2),
  transit_days      NUMERIC(4,1),
  -- Totals
  total_port_das    NUMERIC(12,2),
  total_bunker_cost NUMERIC(12,2),
  total_suez_cost   NUMERIC(12,2),
  total_opex        NUMERIC(12,2),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE voyage_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ve: owner see own" ON voyage_estimates
  FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "ve: owner insert" ON voyage_estimates
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "ve: admin all" ON voyage_estimates
  FOR ALL USING (fn_is_admin());

CREATE INDEX IF NOT EXISTS idx_ve_user    ON voyage_estimates (created_by);
CREATE INDEX IF NOT EXISTS idx_ve_vessel  ON voyage_estimates (vessel_id);
CREATE INDEX IF NOT EXISTS idx_ve_cargo   ON voyage_estimates (cargo_id);

-- ── 7. ANNOUNCEMENTS table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general'
                CHECK (category IN ('general','port_da','bunker','version','security','notice')),
  link_url      TEXT,
  link_label    TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  target_tiers  TEXT[] NOT NULL DEFAULT ARRAY['T1','T2','T3','T4'],
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ann: auth read active" ON announcements
  FOR SELECT USING (
    active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
  );
CREATE POLICY "ann: admin all" ON announcements
  FOR ALL USING (fn_is_admin());

CREATE INDEX IF NOT EXISTS idx_ann_active ON announcements (active, expires_at);

-- ── 8. COMMODITY additions ───────────────────────────────────
ALTER TABLE commodities
  ADD COLUMN IF NOT EXISTS category_label TEXT;

-- ── 9. MATCHES table (for match count badges) ────────────────
CREATE TABLE IF NOT EXISTS matches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_id        UUID NOT NULL REFERENCES cargo_listings(id) ON DELETE CASCADE,
  vessel_avail_id UUID NOT NULL REFERENCES vessel_availability(id) ON DELETE CASCADE,
  score_label     TEXT NOT NULL DEFAULT 'Possible'
                  CHECK (score_label IN ('Strong','Good','Possible','Weak')),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cargo_id, vessel_avail_id)
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches: auth read" ON matches FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "matches: admin all" ON matches FOR ALL USING (fn_is_admin());

CREATE INDEX IF NOT EXISTS idx_matches_cargo  ON matches (cargo_id);
CREATE INDEX IF NOT EXISTS idx_matches_vessel ON matches (vessel_avail_id);

-- ── Done ─────────────────────────────────────────────────────
-- Run: supabase db push  OR  paste into Supabase SQL editor
