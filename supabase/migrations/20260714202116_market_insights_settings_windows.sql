-- Market Insights: stop hardcoding the active-window sizes and read them from
-- app_settings.platform_settings.marketplace, so admins tune them from the
-- Settings page instead of a code change. Three knobs, all previously literal:
--   • spotActiveDays          (14) — spot/no-laycan cargo recency. SHARED with
--                                     get_public_stats() (home "available this week").
--   • vesselActiveDays        (14) — undated open-position recency. SHARED with
--                                     get_public_stats() (home "open this week").
--   • insightsOpenLookbackDays(14) — Insights-only: how far before the report week
--                                     a DATED open_date may fall and still count.
-- Everything else (scope, sub-66K, ≥5 floor, banding, grouping, the dated-cargo
-- laycan-overlap test) is byte-identical to 20260714195953. Values are read with
-- an empty-string/NULL guard and a floor of 1; missing row → the 14 defaults.
CREATE OR REPLACE FUNCTION public.fn_build_market_insights(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH settings AS (
  SELECT value AS v FROM public.app_settings WHERE key = 'platform_settings'
),
params AS (
  SELECT 5::int AS floor_n,
         ARRAY['AG','R.SEA','E.MED','B.SEA','A.SEA']::public.zone_enum[] AS focus,
         GREATEST(COALESCE(
           NULLIF((SELECT v->'marketplace'->>'spotActiveDays' FROM settings), '')::int, 14), 1)
           AS spot_days,
         GREATEST(COALESCE(
           NULLIF((SELECT v->'marketplace'->>'vesselActiveDays' FROM settings), '')::int, 14), 1)
           AS vessel_days,
         GREATEST(COALESCE(
           NULLIF((SELECT v->'marketplace'->>'insightsOpenLookbackDays' FROM settings), '')::int, 14), 1)
           AS open_lookback_days
),
live_cargo AS (
  SELECT
    cl.commodity_name,
    cl.is_grain_cargo,
    cl.cargo_type,
    cl.qty_max_mt,
    cl.load_zone,
    cl.disch_zone,
    CASE
      WHEN cl.is_grain_cargo THEN 'Grain'
      WHEN cl.cargo_type = 'Break Bulk' THEN 'Break-bulk (CSS)'
      ELSE 'Dry bulk (IMSBC)'
    END AS regime,
    CASE
      WHEN cl.qty_max_mt < 10000 THEN '<10K'
      WHEN cl.qty_max_mt < 20000 THEN '10–20K'
      WHEN cl.qty_max_mt < 35000 THEN '20–35K'
      WHEN cl.qty_max_mt < 50000 THEN '35–50K'
      ELSE '50K+'
    END AS size_band
  FROM public.cargo_listings cl, params p
  WHERE cl.review_status = 'APPROVED'
    AND cl.status IN ('IN','PARTIAL')
    AND cl.qty_max_mt < 66000
    AND (cl.load_zone = ANY (p.focus) OR cl.disch_zone = ANY (p.focus))
    AND (
      -- dated cargo: laycan window overlaps the report week
      (cl.laycan_from IS NOT NULL
         AND cl.laycan_from <= p_to
         AND COALESCE(cl.laycan_to, cl.laycan_from) >= p_from)
      -- spot / no-laycan cargo: recently posted (within spot_days ending at week-end)
      OR (cl.laycan_from IS NULL
         AND cl.created_at <  (p_to + 1)::timestamptz
         AND cl.created_at >= (p_to + 1 - p.spot_days)::timestamptz)
    )
),
open_tonnage AS (
  SELECT count(*)::int AS n
  FROM public.vessel_availability va, params p
  WHERE va.review_status = 'APPROVED'
    AND va.status = 'OPEN'
    AND (va.open_zone IS NULL OR va.open_zone = ANY (p.focus))
    AND (
      -- dated open position: opens from open_lookback_days before the week through week-end
      (va.open_date IS NOT NULL
         AND va.open_date <= p_to
         AND va.open_date >= (p_from - p.open_lookback_days))
      -- undated open position: recently posted (within vessel_days ending at week-end)
      OR (va.open_date IS NULL
         AND va.created_at <  (p_to + 1)::timestamptz
         AND va.created_at >= (p_to + 1 - p.vessel_days)::timestamptz)
    )
),
regime_c AS (SELECT regime AS k, count(*) c FROM live_cargo GROUP BY regime),
band_c   AS (SELECT size_band AS k, count(*) c FROM live_cargo GROUP BY size_band),
lane_c   AS (SELECT (load_zone::text || ' → ' || disch_zone::text) AS k, count(*) c,
                    mode() WITHIN GROUP (ORDER BY size_band) AS band
             FROM live_cargo WHERE load_zone IS NOT NULL AND disch_zone IS NOT NULL GROUP BY 1),
comm_c   AS (SELECT commodity_name AS k, count(*) c FROM live_cargo WHERE commodity_name IS NOT NULL GROUP BY 1),
loadz_c  AS (SELECT load_zone::text AS k, count(*) c FROM live_cargo WHERE load_zone IS NOT NULL GROUP BY 1),
dischz_c AS (SELECT disch_zone::text AS k, count(*) c FROM live_cargo WHERE disch_zone IS NOT NULL GROUP BY 1),
regime_f AS (
  SELECT k, c FROM regime_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c) FROM regime_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
),
band_f AS (
  SELECT k, c FROM band_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c) FROM band_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
),
lane_f AS (
  SELECT k, c, band FROM lane_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c), 'Mixed' FROM lane_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
),
comm_f AS (
  SELECT k, c FROM comm_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c) FROM comm_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
),
loadz_f AS (
  SELECT k, c FROM loadz_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c) FROM loadz_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
),
dischz_f AS (
  SELECT k, c FROM dischz_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c) FROM dischz_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
)
SELECT jsonb_build_object(
  'window', jsonb_build_object('from', p_from, 'to', p_to),
  'scope',  'Regional dry bulk & break-bulk, sub-66K — AG / R.Sea / E.Med / B.Sea / A.Sea',
  'snapshot', jsonb_build_object(
    'cargoes_live',  (SELECT count(*)::int FROM live_cargo),
    'open_tonnage',  (SELECT n FROM open_tonnage),
    'active_lanes',  (SELECT count(*)::int FROM lane_c),
    'avg_cargo_size_mt', (
      SELECT CASE WHEN count(*) >= (SELECT floor_n FROM params)
             THEN (round(avg(qty_max_mt) / 500.0) * 500)::int END
      FROM live_cargo)
  ),
  'regime_mix',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM regime_f),
  'size_bands',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM band_f),
  'top_lanes',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c, 'band', band) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM lane_f),
  'top_commodities', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM comm_f),
  'load_zones',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM loadz_f),
  'disch_zones',     (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM dischz_f),
  'floor', (SELECT floor_n FROM params)
);
$function$;
