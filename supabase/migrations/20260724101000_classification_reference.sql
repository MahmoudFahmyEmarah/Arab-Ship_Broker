-- ════════════════════════════════════════════════════════════════════════
-- Broker Ledger phase 1b: cargo-classification reference layer
--
-- Recreates the classification tables that existed pre-baseline
-- (_archive_pre_baseline/20260601000700) but were lost in the remote-baseline
-- squash, extended with the 24-Jul UNIFIED workbook columns, plus the
-- market-name resolver layer (sheet 05_CLASS_MARKET_NAME) and the
-- classification RPC the Broker Ledger commodity step reads.
--
-- Source-of-truth sheets (per README_HANDOFF §6):
--   dry bulk  = 06_CLASS_GRAIN (Grain Code) + 07_CLASS_IMSBC (258 BCSN)
--   break-bulk = 08_CLASS_CSS (12 categories)
--   resolver   = 05_CLASS_MARKET_NAME (market/trade names → regime + code)
--
-- Rows are seeded separately (supabase/seed/reference_dataset.sql).
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE public.cargo_regime_enum AS ENUM ('GRAIN','IMSBC','CSS','UNMAPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. grain_list — Grain Code commodities (sheet 06) ───────────────────────
CREATE TABLE IF NOT EXISTS public.grain_list (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_name text NOT NULL UNIQUE,      -- grain_name in the workbook
  family      text,                      -- e.g. cereal / oilseed / pulse
  requirement text,                      -- Grain Code requirement note
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. imsbc_codes — 258 BCSN, solid bulk other than grain (sheet 07) ───────
-- imsbc_group kept as TEXT (verbatim) to support combined groups ("A and B").
CREATE TABLE IF NOT EXISTS public.imsbc_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bcsn        text NOT NULL UNIQUE,      -- Bulk Cargo Shipping Name (verbatim)
  imsbc_group text NOT NULL,             -- "A" | "B" | "C" | "A and B" | ...
  un_number   text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 3. css_categories — the 12 CSS break-bulk categories (sheet 08) ─────────
CREATE TABLE IF NOT EXISTS public.css_categories (
  code             text PRIMARY KEY,     -- CSS-01 … CSS-12
  name             text NOT NULL,
  annex            text,                 -- CSS Code annex reference
  definition       text,
  securing_trigger text,
  market_aliases   text[],
  sort_order       smallint NOT NULL DEFAULT 100,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 4. market_names — trade-name resolver layer (sheet 05) ──────────────────
-- Between the official (BCSN / Grain / CSS) name and the user sits the market
-- name. Resolution: market_names → regime table row.
CREATE TABLE IF NOT EXISTS public.market_names (
  market_name  text PRIMARY KEY,
  regime       public.cargo_regime_enum NOT NULL,
  code         text,                     -- official name / CSS code in the regime table
  group_or_cat text,                     -- IMSBC group / CSS category / GRAIN
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_names_lower
  ON public.market_names (lower(market_name));

-- ── RLS: world-readable reference data; writes via service-role only ────────
ALTER TABLE public.grain_list     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imsbc_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.css_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_names   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "grain_list read"     ON public.grain_list;
DROP POLICY IF EXISTS "imsbc_codes read"    ON public.imsbc_codes;
DROP POLICY IF EXISTS "css_categories read" ON public.css_categories;
DROP POLICY IF EXISTS "market_names read"   ON public.market_names;
CREATE POLICY "grain_list read"     ON public.grain_list     FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "imsbc_codes read"    ON public.imsbc_codes    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "css_categories read" ON public.css_categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "market_names read"   ON public.market_names   FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.grain_list, public.imsbc_codes, public.css_categories,
                public.market_names TO anon, authenticated;
GRANT ALL ON public.grain_list, public.imsbc_codes, public.css_categories,
             public.market_names TO service_role;

-- ── 5. fn_classify_commodity — internal resolver (NOT tier-gated) ───────────
-- Mirrors the design's classify(): regime + group + UN number + DG / MHB /
-- liquefaction flags. Used by create_cargo_listing_v2 for the classification
-- snapshot regardless of tier; the user-facing readout goes through the
-- tier-gated classify_commodity wrapper below.
CREATE OR REPLACE FUNCTION public.fn_classify_commodity(p_name text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_q        text := lower(btrim(coalesce(p_name, '')));
  v_regime   text := NULL;
  v_official text := NULL;
  v_market   text := NULL;
  v_group    text := NULL;
  v_un       text := NULL;
  v_css_code text := NULL;
  v_note     text := NULL;
  r          record;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  -- 1) market-name resolver layer (exact, case-insensitive)
  SELECT * INTO r FROM public.market_names mn WHERE lower(mn.market_name) = v_q LIMIT 1;
  IF FOUND THEN
    v_market := r.market_name; v_regime := r.regime::text;
    v_official := r.code; v_group := r.group_or_cat; v_note := r.note;
  END IF;

  -- 2) direct hit in the regime tables (also enriches a resolver hit)
  IF v_regime IS NULL OR v_regime = 'GRAIN' THEN
    SELECT * INTO r FROM public.grain_list g
    WHERE lower(g.market_name) = lower(coalesce(v_official, p_name)) AND g.is_active LIMIT 1;
    IF FOUND THEN
      v_regime := 'GRAIN'; v_official := r.market_name;
      v_group := coalesce(v_group, 'GRAIN'); v_note := coalesce(v_note, r.requirement);
    END IF;
  END IF;

  IF v_regime IS NULL OR v_regime = 'IMSBC' THEN
    SELECT * INTO r FROM public.imsbc_codes i
    WHERE lower(i.bcsn) = lower(coalesce(v_official, p_name)) AND i.is_active LIMIT 1;
    IF NOT FOUND AND v_regime IS NULL THEN
      SELECT * INTO r FROM public.imsbc_codes i
      WHERE lower(i.bcsn) LIKE lower(p_name) || '%' AND i.is_active
      ORDER BY length(i.bcsn) LIMIT 1;
    END IF;
    IF r.bcsn IS NOT NULL THEN
      v_regime := 'IMSBC'; v_official := r.bcsn;
      v_group := r.imsbc_group; v_un := r.un_number; v_note := coalesce(v_note, r.notes);
    END IF;
  END IF;

  IF v_regime IS NULL OR v_regime = 'CSS' THEN
    SELECT * INTO r FROM public.css_categories c
    WHERE (c.code = coalesce(v_official, '') OR lower(c.name) = v_q
           OR v_q = ANY (SELECT lower(a) FROM unnest(coalesce(c.market_aliases, '{}')) a))
      AND c.is_active
    ORDER BY c.sort_order LIMIT 1;
    IF FOUND THEN
      v_regime := 'CSS'; v_css_code := r.code;
      v_official := coalesce(v_official, r.name); v_group := coalesce(v_group, r.code);
      v_note := coalesce(v_note, r.definition);
    END IF;
  END IF;

  IF v_regime IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'regime', 'UNMAPPED');
  END IF;

  -- UN number may also be embedded in the shipping name ("… UN 1395")
  IF v_un IS NULL THEN
    v_un := (SELECT (regexp_match(coalesce(v_official, p_name), 'UN\s?(\d{4})', 'i'))[1]);
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'regime', v_regime,
    'official_name', v_official,
    'market_name', v_market,
    'group_or_cat', v_group,
    'css_category', v_css_code,
    'un_number', v_un,
    'is_dg', v_un IS NOT NULL,
    -- MHB: flagged in the shipping name, or group B without a UN listing
    'is_mhb', (coalesce(v_official, p_name) ~* '\mMHB\M')
              OR (v_regime = 'IMSBC' AND coalesce(v_group,'') ~ 'B' AND v_un IS NULL),
    -- Group A solid bulk may liquefy (TML/moisture certificate at load)
    'liquefaction', v_regime = 'IMSBC' AND coalesce(v_group,'') ~ 'A',
    'is_grain', v_regime = 'GRAIN',
    'is_break_bulk', v_regime = 'CSS',
    'note', v_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_classify_commodity(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_classify_commodity(text) TO service_role;

-- ── 6. classify_commodity — tier-gated user-facing readout (T3/T4) ──────────
-- The live classification panel is a Subscriber feature (README_HANDOFF §6:
-- "Tiers 1/2 get the standard picker … enforce the gate server-side").
CREATE OR REPLACE FUNCTION public.classify_commodity(p_name text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tier    public.subscription_tier_enum;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT subscription_tier INTO v_tier
  FROM public.users
  WHERE id = v_user_id OR supabase_user_id = v_user_id
  ORDER BY (id = v_user_id) DESC
  LIMIT 1;

  IF NOT public.fn_is_admin() AND coalesce(v_tier::text, 'T1') NOT IN ('T3', 'T4') THEN
    RAISE EXCEPTION 'TIER_GATED: live cargo classification is a Subscriber (T3+) feature'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN public.fn_classify_commodity(p_name);
END;
$$;

REVOKE ALL ON FUNCTION public.classify_commodity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_commodity(text) TO authenticated, service_role;

-- ── 7. search_commodity_names — merged typeahead (ungated) ──────────────────
-- One round trip powering both the T1/T2 plain picker and the T3/T4 smart
-- list: canonical commodities + market names + IMSBC BCSN + grain + CSS
-- aliases, deduped by display name, ranked prefix-first.
CREATE OR REPLACE FUNCTION public.search_commodity_names(p_q text, p_limit int DEFAULT 25)
RETURNS TABLE(display_name text, source text, regime text, group_or_cat text, form text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q AS (SELECT lower(btrim(coalesce(p_q, ''))) AS s),
  hits AS (
    SELECT mn.market_name AS display_name, 'market'::text AS source, mn.regime::text AS regime,
           mn.group_or_cat,
           CASE WHEN mn.regime = 'CSS' THEN 'break-bulk' ELSE 'dry-bulk' END AS form
    FROM public.market_names mn, q WHERE q.s <> '' AND lower(mn.market_name) LIKE '%' || q.s || '%'
    UNION ALL
    SELECT g.market_name, 'grain', 'GRAIN', 'GRAIN', 'dry-bulk'
    FROM public.grain_list g, q WHERE q.s <> '' AND g.is_active AND lower(g.market_name) LIKE '%' || q.s || '%'
    UNION ALL
    SELECT i.bcsn, 'imsbc', 'IMSBC', i.imsbc_group, 'dry-bulk'
    FROM public.imsbc_codes i, q WHERE q.s <> '' AND i.is_active AND lower(i.bcsn) LIKE '%' || q.s || '%'
    UNION ALL
    SELECT c.name, 'css', 'CSS', c.code, 'break-bulk'
    FROM public.css_categories c, q
    WHERE q.s <> '' AND c.is_active
      AND (lower(c.name) LIKE '%' || q.s || '%'
           OR EXISTS (SELECT 1 FROM unnest(coalesce(c.market_aliases,'{}')) a WHERE lower(a) LIKE '%' || q.s || '%'))
    UNION ALL
    SELECT co.canonical_name, 'commodity',
           CASE WHEN co.is_grain THEN 'GRAIN'
                WHEN co.cargo_type = 'Break Bulk' THEN 'CSS' ELSE 'IMSBC' END,
           co.imsbc_category::text,
           CASE WHEN co.cargo_type = 'Break Bulk' THEN 'break-bulk' ELSE 'dry-bulk' END
    FROM public.commodities co, q
    WHERE q.s <> '' AND co.is_active
      AND (lower(co.canonical_name) LIKE '%' || q.s || '%'
           OR EXISTS (SELECT 1 FROM unnest(coalesce(co.display_aliases,'{}')) a WHERE lower(a) LIKE '%' || q.s || '%'))
  )
  SELECT t.display_name, t.source, t.regime, t.group_or_cat, t.form
  FROM (
    SELECT DISTINCT ON (lower(h.display_name))
           h.display_name, h.source, h.regime, h.group_or_cat, h.form,
           (CASE WHEN lower(h.display_name) = q.s THEN 0
                 WHEN lower(h.display_name) LIKE q.s || '%' THEN 1 ELSE 2 END) AS rank
    FROM hits h, q
    ORDER BY lower(h.display_name),
             (CASE WHEN lower(h.display_name) = q.s THEN 0
                   WHEN lower(h.display_name) LIKE q.s || '%' THEN 1 ELSE 2 END)
  ) t
  ORDER BY t.rank, lower(t.display_name)
  LIMIT greatest(1, least(coalesce(p_limit, 25), 60));
$$;

REVOKE ALL ON FUNCTION public.search_commodity_names(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_commodity_names(text, int) TO authenticated, service_role;
