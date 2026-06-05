-- ============================================================
-- ARAB SHIPBROKER — Voyage estimator tables (additive)
-- Date: 2026-06-01
--
-- Ports the voyage estimator from the legacy Vite app. Two new tables:
--   • fuel_prices      — bunker price reference (read-active; admin writes)
--   • voyage_estimates — saved estimates, owner-scoped
--
-- Additive only. No existing table or policy is touched. Per-fuel bunker
-- columns on vessel_availability were added earlier (migration ...000100);
-- the estimator reads them for VLSFO/LSMGO sea/port consumption.
-- ============================================================

-- ── 1. fuel_prices ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

ALTER TABLE public.fuel_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_prices: read active" ON public.fuel_prices;
CREATE POLICY "fuel_prices: read active"
  ON public.fuel_prices FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "fuel_prices: admin all" ON public.fuel_prices;
CREATE POLICY "fuel_prices: admin all"
  ON public.fuel_prices FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_fp_active
  ON public.fuel_prices (is_active, updated_at DESC);

GRANT SELECT ON public.fuel_prices TO anon, authenticated;
GRANT ALL ON public.fuel_prices TO service_role;

-- Seed one reference entry (admin maintains thereafter)
INSERT INTO public.fuel_prices (sponsor_name, port_area, vlsfo_usd_mt, lsmgo_usd_mt, vlsfo_direction, lsmgo_direction)
VALUES ('O Bunkering', 'Sohar / Salalah', 582, 648, 'up', 'flat')
ON CONFLICT DO NOTHING;

-- ── 2. voyage_estimates ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voyage_estimates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id         UUID REFERENCES public.vessels(id) ON DELETE SET NULL,
  cargo_id          UUID REFERENCES public.cargo_listings(id) ON DELETE SET NULL,
  vessel_name       TEXT,
  cargo_name        TEXT,
  pol_locode        TEXT,
  pod_locode        TEXT,

  -- Distances + speed
  ballast_nm        NUMERIC(8,1),
  laden_nm          NUMERIC(8,1),
  service_speed_kn  NUMERIC(4,1),

  -- Bunker consumption (per fuel, sea/port) + prices
  vlsfo_sea_mt_day  NUMERIC(5,2),
  vlsfo_port_mt_day NUMERIC(5,2),
  lsmgo_sea_mt_day  NUMERIC(5,2),
  lsmgo_port_mt_day NUMERIC(5,2),
  vlsfo_price       NUMERIC(8,2),
  lsmgo_price       NUMERIC(8,2),

  -- Cargo economics
  quantity_mt       INTEGER,
  freight_usd_mt    NUMERIC(8,2),
  commission_pct    NUMERIC(5,2),
  load_rate_mt_day  NUMERIC(8,0),
  disch_rate_mt_day NUMERIC(8,0),

  -- Port DAs + Suez
  pol_da_usd        NUMERIC(12,2),
  pod_da_usd        NUMERIC(12,2),
  suez_usd          NUMERIC(12,2),

  -- Computed totals (snapshot at save time)
  sea_days          NUMERIC(6,2),
  port_days         NUMERIC(6,2),
  total_bunker_cost NUMERIC(12,2),
  gross_freight     NUMERIC(12,2),
  voyage_result     NUMERIC(12,2),

  created_by        UUID NOT NULL DEFAULT auth.uid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.voyage_estimates ENABLE ROW LEVEL SECURITY;

-- Owner-scoped: a user only ever sees and writes their OWN estimates.
DROP POLICY IF EXISTS "ve: owner select" ON public.voyage_estimates;
CREATE POLICY "ve: owner select"
  ON public.voyage_estimates FOR SELECT TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "ve: owner insert" ON public.voyage_estimates;
CREATE POLICY "ve: owner insert"
  ON public.voyage_estimates FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "ve: owner delete" ON public.voyage_estimates;
CREATE POLICY "ve: owner delete"
  ON public.voyage_estimates FOR DELETE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "ve: admin all" ON public.voyage_estimates;
CREATE POLICY "ve: admin all"
  ON public.voyage_estimates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_ve_owner ON public.voyage_estimates (created_by, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.voyage_estimates TO authenticated;
GRANT ALL ON public.voyage_estimates TO service_role;
