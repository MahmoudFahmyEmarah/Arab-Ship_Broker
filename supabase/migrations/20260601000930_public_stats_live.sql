-- ════════════════════════════════════════════════════════════════════
-- Landing live counters — exact definitions  · append-only · firewall-safe
--
-- Redefines get_public_stats() (was: count of ALL cargo, ALL vessels, all
-- zones — which is why the hero looked wrong). New, precise definitions, all
-- computed server-side against CURRENT_DATE so the ±7-day window rolls daily.
-- Returns ONLY the three integers — no rows, no PII, no service-role key.
--
--   cargo_count  = active cargo listings whose laycan OVERLAPS [today-7, today+7]
--                  (laycan_from <= today+7 AND laycan_to >= today-7).
--   vessel_count = OPEN vessel-availability listings (live tonnage), not the
--                  whole vessels table.
--   zone_count   = distinct zones (load or disch) holding >= 5 such in-window
--                  cargoes. The >=5 is significance AND a hard privacy floor.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH live_cargo AS (
  SELECT id, load_zone, disch_zone
  FROM public.cargo_listings
  WHERE review_status = 'APPROVED'
    AND status IN ('IN','PARTIAL')
    AND laycan_from IS NOT NULL AND laycan_to IS NOT NULL
    AND laycan_from <= (CURRENT_DATE + 7)
    AND laycan_to   >= (CURRENT_DATE - 7)
),
zone_cells AS (
  SELECT id, load_zone  AS zone FROM live_cargo WHERE load_zone  IS NOT NULL
  UNION
  SELECT id, disch_zone AS zone FROM live_cargo WHERE disch_zone IS NOT NULL
)
SELECT jsonb_build_object(
  'cargo_count',  (SELECT count(*)::int FROM live_cargo),
  'vessel_count', (SELECT count(*)::int FROM public.vessel_availability
                   WHERE status = 'OPEN' AND review_status = 'APPROVED'),
  'zone_count',   (SELECT count(*)::int FROM (
                     SELECT zone FROM zone_cells GROUP BY zone HAVING count(*) >= 5
                   ) z)
);
$$;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
