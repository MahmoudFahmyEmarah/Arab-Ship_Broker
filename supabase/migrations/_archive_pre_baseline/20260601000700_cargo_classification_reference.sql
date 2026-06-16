-- ════════════════════════════════════════════════════════════════════
-- Cargo classification — Part 1: reference tables  ·  append-only, additive
--
-- Builds the engine's lookup layer. The existing public.commodities table
-- (already seeded, classified by cargo_type/imsbc_category/is_grain/un_number)
-- IS the commodity map — this EXTENDS it rather than duplicating it, and adds
-- the three reference tables.
--
-- Firewall: untouched. None of these tables carry counterparty contact —
-- they are world-readable reference/lookup data (admin-writable via the
-- service-role client, which bypasses RLS).
--
-- ⚠️ SEED STATUS: grain_list + the commodities regime/plausible columns are
-- seeded here (derived from the already-authoritative commodities data — not
-- guessed). imsbc_codes (258 BCSN) and css_categories (12) are created EMPTY:
-- their authoritative rows must come from the master classification workbook
-- (not attached). Per spec, classification data is not invented.
-- ════════════════════════════════════════════════════════════════════

-- Regime enum: the three mutually-exclusive classifier regimes (+ unmapped).
DO $$ BEGIN
  CREATE TYPE public.cargo_regime_enum AS ENUM ('GRAIN','IMSBC','CSS','UNMAPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. grain_list — Grain Code commodities ──────────────────────────
CREATE TABLE IF NOT EXISTS public.grain_list (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_name text NOT NULL UNIQUE,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. imsbc_codes — the 258 BCSN reference (solid bulk) ─────────────
-- imsbc_group kept as TEXT (verbatim) to support combined groups
-- (e.g. "A and B") that the enum can't express. SEED FROM WORKBOOK.
CREATE TABLE IF NOT EXISTS public.imsbc_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bcsn        text NOT NULL UNIQUE,        -- Bulk Cargo Shipping Name (verbatim)
  imsbc_group text NOT NULL,               -- "A" | "B" | "C" | "A and B" | ...
  un_number   text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 3. css_categories — the 12 CSS categories (break-bulk) ──────────
-- SEED FROM WORKBOOK (CSS-01 … CSS-12 + definition + securing trigger).
CREATE TABLE IF NOT EXISTS public.css_categories (
  code             text PRIMARY KEY,       -- CSS-01 … CSS-12
  name             text NOT NULL,
  definition       text,
  securing_trigger text,
  sort_order       smallint NOT NULL DEFAULT 100,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 4. commodity_map — extend commodities into the classification dict ──
-- regime + css_category + dual_form + the PLAUSIBLE sets that drive the guard.
ALTER TABLE public.commodities
  ADD COLUMN IF NOT EXISTS regime            public.cargo_regime_enum,
  ADD COLUMN IF NOT EXISTS css_category      text REFERENCES public.css_categories(code),
  ADD COLUMN IF NOT EXISTS is_dual_form      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plausible_regimes public.cargo_regime_enum[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS plausible_imsbc   public.imsbc_category_enum[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS plausible_css     text[]                       NOT NULL DEFAULT '{}';

-- Derive regime from the already-authoritative is_grain / cargo_type
-- (data-driven, not guessed). GRAIN if grain; CSS if break-bulk; else IMSBC.
UPDATE public.commodities SET regime = CASE
    WHEN is_grain                 THEN 'GRAIN'::public.cargo_regime_enum
    WHEN cargo_type = 'Break Bulk' THEN 'CSS'::public.cargo_regime_enum
    ELSE 'IMSBC'::public.cargo_regime_enum
  END
WHERE regime IS NULL;

-- Baseline plausible set = the commodity's own authoritative classification.
-- (The workbook seed extends these — e.g. a commodity legitimately A *or* B,
--  or a dual-form commodity gaining its CSS class.)
UPDATE public.commodities SET
  plausible_regimes = ARRAY[regime],
  plausible_imsbc = CASE WHEN regime = 'IMSBC'
                         THEN ARRAY[imsbc_category]
                         ELSE '{}'::public.imsbc_category_enum[] END
WHERE plausible_regimes = '{}';

-- ── RLS: reference data is world-readable; writes via service-role only ──
ALTER TABLE public.grain_list     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imsbc_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.css_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "grain_list read"     ON public.grain_list;
DROP POLICY IF EXISTS "imsbc_codes read"    ON public.imsbc_codes;
DROP POLICY IF EXISTS "css_categories read" ON public.css_categories;
CREATE POLICY "grain_list read"     ON public.grain_list     FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "imsbc_codes read"    ON public.imsbc_codes    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "css_categories read" ON public.css_categories FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.grain_list, public.imsbc_codes, public.css_categories TO anon, authenticated;

-- ── Seed: grain_list (common Grain Code commodities; extend via workbook) ──
INSERT INTO public.grain_list (market_name) VALUES
  ('Wheat'), ('Maize (Corn)'), ('Barley'), ('Rice'), ('Sorghum'), ('Oats'),
  ('Rye'), ('Triticale'), ('Soybeans'), ('Rapeseed'), ('Canola'),
  ('Sunflower Seed'), ('Linseed'), ('Peas'), ('Beans'), ('Lentils'),
  ('Chickpeas'), ('Lupins')
ON CONFLICT (market_name) DO NOTHING;
