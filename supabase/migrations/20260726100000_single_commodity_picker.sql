-- Commodity picker must offer SINGLE commodities only (user decision 26 Jul).
-- The workbook's 05_CLASS_MARKET_NAME sheet carries MULTI-PARCEL advisory rows
-- ("Corn + Soybean Meal", "Sugar + Rice", …) which were imported as
-- market_names with regime UNMAPPED and surfaced in the picker. A combined
-- cargo is not a commodity — parcels are posted individually — so the search
-- now excludes UNMAPPED resolver rows. They stay in market_names as
-- documentation and for the classifier's multi-parcel detection.
-- Function otherwise identical to 20260725100000.

CREATE OR REPLACE FUNCTION public.search_commodity_names(p_q text, p_limit int DEFAULT 25)
RETURNS TABLE(display_name text, source text, regime text, group_or_cat text, form text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q AS (SELECT lower(btrim(coalesce(p_q, ''))) AS s),
  hits AS (
    SELECT mn.market_name AS display_name, 'market'::text AS source, mn.regime::text AS regime,
           mn.group_or_cat,
           CASE WHEN mn.regime = 'CSS' THEN 'break-bulk' ELSE 'dry-bulk' END AS form
    FROM public.market_names mn, q
    WHERE q.s <> '' AND mn.regime <> 'UNMAPPED'
      AND lower(mn.market_name) LIKE '%' || q.s || '%'
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
      AND lower(c.name) LIKE '%' || q.s || '%'
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
