-- ════════════════════════════════════════════════════════════════════
-- Cargo classification — Part 2 (resolver) + Part 3 (guard)  · append-only
-- Both run SERVER-SIDE (SECURITY DEFINER RPCs), data-driven from commodity_map
-- / imsbc_codes / css_categories. Firewall untouched (no contact).
-- ════════════════════════════════════════════════════════════════════

-- ── PART 2 — RESOLVER ───────────────────────────────────────────────
-- market_name + is_bulk + is_grain → regime + code + group_or_category +
-- plausible set. Bagged → CSS (even bagged grain). Bulk+grain → GRAIN.
-- Bulk+non-grain → IMSBC + group. Dual-form resolves by is_bulk. Unknown
-- market_name → UNMAPPED (UI falls back to manual). Never guesses.
CREATE OR REPLACE FUNCTION public.resolve_cargo_classification(
  p_market_name text,
  p_is_bulk     boolean,
  p_is_grain    boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m        public.commodity_map%ROWTYPE;
  v_regime public.cargo_regime_enum;
  v_code   text;
  v_cat    text;
BEGIN
  SELECT * INTO m FROM public.commodity_map
   WHERE market_name ILIKE btrim(p_market_name) LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'regime','UNMAPPED','code',NULL,'group_or_category',NULL,
      'plausible_regimes', to_jsonb(ARRAY['UNMAPPED']::text[]),
      'is_dual_form', false, 'mapped', false);
  END IF;

  IF p_is_bulk IS FALSE THEN
    -- Bagged / break-bulk → CSS regime. Use the map's CSS code if present,
    -- else the unit-load default (CSS-12).
    v_regime := 'CSS';
    v_code   := CASE WHEN m.code ILIKE 'CSS-%' THEN m.code ELSE 'CSS-12' END;
    v_cat    := v_code;
  ELSIF COALESCE(p_is_grain, m.regime = 'GRAIN') THEN
    v_regime := 'GRAIN';
    v_code   := 'Grain Code';
    v_cat    := NULL;
  ELSE
    v_regime := 'IMSBC';
    v_code   := m.code;
    v_cat    := COALESCE(
      NULLIF(m.group_cat, ''),
      (SELECT imsbc_group FROM public.imsbc_codes
        WHERE bcsn ILIKE m.code OR bcsn ILIKE btrim(p_market_name) LIMIT 1));
  END IF;

  RETURN jsonb_build_object(
    'regime', v_regime, 'code', v_code, 'group_or_category', v_cat,
    'plausible_regimes', to_jsonb(m.plausible_regimes),
    'is_dual_form', m.is_dual_form, 'mapped', true, 'note', m.note);
END $$;
GRANT EXECUTE ON FUNCTION public.resolve_cargo_classification(text,boolean,boolean)
  TO anon, authenticated;

-- ── PART 3 — GUARD ──────────────────────────────────────────────────
-- A submitted (regime, code) must be plausible for that market_name.
-- Changing FORM (bulk↔bagged → IMSBC↔CSS for dual-form) is allowed.
-- Changing HAZARD CLASS to something implausible is REJECTED
-- (e.g. Wheat → IMSBC Group A: wheat's plausible regimes = {GRAIN}).
-- Reads the plausible set from DATA — extend the map, no code change.
CREATE OR REPLACE FUNCTION public.validate_cargo_classification(
  p_market_name text,
  p_regime      public.cargo_regime_enum,
  p_code        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m        public.commodity_map%ROWTYPE;
  v_groups text[];
  v_sub    text;
BEGIN
  SELECT * INTO m FROM public.commodity_map
   WHERE market_name ILIKE btrim(p_market_name) LIMIT 1;

  -- Unknown commodity → manual entry allowed (UI flags it); nothing to check.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'unmapped', true);
  END IF;

  -- Regime-level plausibility (accepts bulk↔bagged; rejects wheat→IMSBC etc.)
  IF NOT (p_regime = ANY (m.plausible_regimes)) THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      format('Classification doesn''t match this cargo: %s is not plausible for %s (allowed: %s)',
             p_regime, m.market_name, array_to_string(m.plausible_regimes, ' / ')));
  END IF;

  -- Hazard-class plausibility for IMSBC: the submitted group letter must be
  -- among the commodity's allowed groups (mapped group_cat, or its BCSN group,
  -- which may be combined like "A and B").
  IF p_regime = 'IMSBC' AND p_code IS NOT NULL THEN
    v_sub := upper(btrim(replace(p_code, 'Cat_', '')));
    IF v_sub IN ('A','B','C') THEN
      v_groups := regexp_split_to_array(
        upper(coalesce(
          nullif(m.group_cat, ''),
          (SELECT imsbc_group FROM public.imsbc_codes WHERE bcsn ILIKE m.code LIMIT 1),
          '')),
        '\s*(?:AND|,|/|\+)\s*');
      IF array_length(v_groups, 1) IS NOT NULL
         AND NOT (v_sub = ANY (SELECT btrim(g) FROM unnest(v_groups) g)) THEN
        RETURN jsonb_build_object('ok', false, 'reason',
          format('Classification doesn''t match this cargo: IMSBC group %s is not plausible for %s (allowed: %s)',
                 v_sub, m.market_name, array_to_string(v_groups, ' / ')));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.validate_cargo_classification(text,public.cargo_regime_enum,text)
  TO anon, authenticated;
