-- Commodity search cleanup (user-reported):
--   1. Drop the legacy commodities-table branch. README_HANDOFF §6: the ONLY
--      valid classification sources are the workbook sheets (05 market names,
--      06 grain, 07 IMSBC, 08 CSS). The legacy table surfaced stale names
--      like "Sugar BB" that exist nowhere in the workbook.
--   2. CSS categories now match on their NAME only. Alias matching let a
--      commodity term surface a category (searching "sugar" returned
--      "Unit loads" because CSS-12's alias blob mentions sugar bags); the
--      market-name resolver (05) already maps commodity → CSS category.
-- The legacy commodities table remains in use by the old form's picker and by
-- the classification snapshot in create_cargo_listing_v2 — only this search
-- changes.

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

-- Data repair: the seed split CSS market_aliases on ';' only, leaving whole
-- comma lists as single alias blobs (breaking exact-match alias resolution in
-- fn_classify_commodity too). Re-split on commas and semicolons.
UPDATE public.css_categories
SET market_aliases = (
  SELECT array_agg(btrim(part)) FILTER (WHERE btrim(part) <> '')
  FROM unnest(market_aliases) AS blob,
       LATERAL regexp_split_to_table(blob, '[;,]') AS part
)
WHERE market_aliases IS NOT NULL;
