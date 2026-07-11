-- ---------------------------------------------------------------------------
-- get_public_stats(): age out stale open-ended vessels (companion to the spot
-- cargo window in 20260703120000_spot_active_window.sql).
--
-- The vessel branch counted an open vessel if `open_date IS NULL` OR its open
-- date fell in a ±7-day window. The NULL branch had no date bound, so vessels
-- posted with no open date counted toward "open this week" forever (e.g. 38
-- stale rows). They now age out after an admin-configurable window measured from
-- created_at; vessels that carry an open_date still use the ±7-day date window.
--
-- Both windows (spot cargo + vessel) are read regex-guarded from the
-- platform_settings blob (admin → Administration → Marketplace defaults) and
-- each defaults to 14. Anon-safe: this RPC must never throw. Keep the defaults
-- in sync with DEFAULT_SPOT_ACTIVE_DAYS / DEFAULT_VESSEL_ACTIVE_DAYS in
-- lib/app-settings.ts.
--
-- "Active zones" (zone_count) is derived from the two sets above — a zone is
-- active when it has at least one available cargo or vessel. No change is needed
-- there; once cargo and vessels age out correctly, the zone count follows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH cfg AS (
  SELECT
    COALESCE(
      (SELECT CASE
                WHEN value->'marketplace'->>'spotActiveDays' ~ '^[0-9]+$'
                     AND (value->'marketplace'->>'spotActiveDays')::int > 0
                THEN (value->'marketplace'->>'spotActiveDays')::int
              END
       FROM public.app_settings WHERE key = 'platform_settings'),
      14
    ) AS spot_days,
    COALESCE(
      (SELECT CASE
                WHEN value->'marketplace'->>'vesselActiveDays' ~ '^[0-9]+$'
                     AND (value->'marketplace'->>'vesselActiveDays')::int > 0
                THEN (value->'marketplace'->>'vesselActiveDays')::int
              END
       FROM public.app_settings WHERE key = 'platform_settings'),
      14
    ) AS vessel_days
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
  SELECT v.open_zone AS zone
  FROM public.vessel_availability v, cfg
  WHERE v.status = 'OPEN'
    AND v.review_status = 'APPROVED'
    AND (
      (
        v.open_date IS NULL
        AND v.created_at >= (now() - make_interval(days => cfg.vessel_days))
      )
      OR v.open_date BETWEEN (CURRENT_DATE - 7) AND (CURRENT_DATE + 7)
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
