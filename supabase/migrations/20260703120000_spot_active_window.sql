-- ---------------------------------------------------------------------------
-- get_public_stats(): age out stale spot cargoes.
--
-- Previously a cargo counted toward the public "available this week" hero stat
-- if `is_spot = TRUE` OR its laycan overlapped a ±7-day window. The is_spot
-- branch had NO date bound, so every spot cargo ever approved counted forever —
-- inflating the count (e.g. 594 stale spot rows shown as "available this week").
--
-- Spot cargoes now only count while within an admin-configurable active window,
-- measured from created_at (when the cargo was posted). The window (in days) is
-- read from the platform_settings blob (admin → Administration → Marketplace
-- defaults → "Spot cargo active window"). The public homepage calls this RPC as
-- anon, so the read is regex-guarded and defaults to 14 — it must never throw.
-- Keep the default in sync with DEFAULT_SPOT_ACTIVE_DAYS in lib/app-settings.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH cfg AS (
  SELECT COALESCE(
    (SELECT CASE
              WHEN value->'marketplace'->>'spotActiveDays' ~ '^[0-9]+$'
                   AND (value->'marketplace'->>'spotActiveDays')::int > 0
              THEN (value->'marketplace'->>'spotActiveDays')::int
            END
     FROM public.app_settings
     WHERE key = 'platform_settings'),
    14
  ) AS spot_days
),
avail_cargo AS (
  SELECT c.load_zone AS zone
  FROM public.cargo_listings c, cfg
  WHERE c.status IN ('IN','PARTIAL')
    AND c.review_status = 'APPROVED'
    AND (
      (
        c.is_spot = TRUE
        AND c.created_at >= (now() - make_interval(days => cfg.spot_days))
      )
      OR (
        c.laycan_from <= (CURRENT_DATE + 7)
        AND COALESCE(c.laycan_to, c.laycan_from) >= (CURRENT_DATE - 7)
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
$function$;
