-- ════════════════════════════════════════════════════════════════════
-- Landing live counters — AVAILABLE-THIS-WEEK window · append-only · firewall-safe
--
-- Redefines get_public_stats() so the public hero shows ONLY what is genuinely
-- available on the market right now, matching the portal boards exactly (no
-- discrepancy) plus a ±7-day freshness window:
--
--   cargo_count  = cargo the portal cargo board would show
--                  (status IN ('IN','PARTIAL') AND review_status = 'APPROVED')
--                  whose laycan falls within ±7 days of today, OR is spot
--                  (prompt — laycan_from NULL, available now).
--   vessel_count = open tonnage the portal vessel board would show
--                  (status = 'OPEN' AND review_status = 'APPROVED') opening
--                  within ±7 days of today, OR prompt (open_date NULL).
--   zone_count   = distinct trade zones across that same available set.
--
-- Still aggregate-only (three integers, no rows, no PII, no service-role key);
-- SECURITY DEFINER so the counts are correct under RLS. The status/approval
-- predicates are byte-for-byte the portal's (sdk/app/cargos.ts getCargos and
-- sdk/app/vessels.ts getOpenVesselAvailability) so the hero can never disagree
-- with what a signed-in user sees on the boards.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH avail_cargo AS (
  SELECT load_zone AS zone
  FROM public.cargo_listings
  WHERE status IN ('IN','PARTIAL')
    AND review_status = 'APPROVED'
    AND (
      is_spot = TRUE
      OR (
        laycan_from <= (CURRENT_DATE + 7)
        AND COALESCE(laycan_to, laycan_from) >= (CURRENT_DATE - 7)
      )
    )
),
avail_vessel AS (
  SELECT open_zone AS zone
  FROM public.vessel_availability
  WHERE status = 'OPEN'
    AND review_status = 'APPROVED'
    AND (
      open_date IS NULL
      OR open_date BETWEEN (CURRENT_DATE - 7) AND (CURRENT_DATE + 7)
    )
)
SELECT jsonb_build_object(
  'cargo_count',  (SELECT count(*)::int FROM avail_cargo),
  'vessel_count', (SELECT count(*)::int FROM avail_vessel),
  'zone_count',   (
    SELECT count(DISTINCT zone)::int
    FROM (
      SELECT zone FROM avail_cargo
      UNION
      SELECT zone FROM avail_vessel
    ) z
    WHERE zone IS NOT NULL AND zone::text <> 'Unknown'
  )
);
$$;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
