-- ════════════════════════════════════════════════════════════════════
-- Arab ShipBroker — REMAINING SQL to run (generated 2026-06-13)
-- Paste this WHOLE file into the Supabase SQL editor and Run ONCE.
--
-- Idempotent and safe to re-run. Contains only what is still pending after
-- the editions you already published (W21/W22/W23 stay intact / get rebuilt
-- with the new lane "typical band"):
--   1) get_public_stats          — landing "available this week" counter
--   2) get_admin_ops_stats       — /admin/stats page
--   3) get_public_platform_totals— public reach stats bar
--   4) lane "typical band" generator + rebuild of the 3 editions
--   5) position check-in         — ETA fields + ownership-checked RPC
-- Assumes the Market Insights pipeline + the foundation bundle are already
-- applied (they are — your editions published successfully).
-- ════════════════════════════════════════════════════════════════════

SET check_function_bodies = off;


-- ═════════ 20260601001040_public_stats_available_window ═════════

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


-- ═════════ 20260601001050_admin_ops_stats ═════════

-- ════════════════════════════════════════════════════════════════════
-- Admin operational stats — cargo-wise & vessel-wise · append-only · admin-only
--
-- One jsonb of REAL platform aggregates for the /admin/stats overview: live
-- counts and breakdowns straight from the canonical tables. SECURITY DEFINER
-- so it can read across the firewall, but it returns ONLY counts/labels (no
-- row, no PII, no contact) and hard-refuses any non-admin caller.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_admin_ops_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'cargo', jsonb_build_object(
      'total',          (SELECT count(*)::int FROM public.cargo_listings),
      'live',           (SELECT count(*)::int FROM public.cargo_listings
                           WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED'),
      'pending',        (SELECT count(*)::int FROM public.cargo_listings WHERE review_status = 'PENDING'),
      'posted_7d',      (SELECT count(*)::int FROM public.cargo_listings WHERE created_at >= now() - interval '7 days'),
      'spot',           (SELECT count(*)::int FROM public.cargo_listings
                           WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED' AND is_spot = true),
      'by_status',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY c DESC), '[]')
                           FROM (SELECT status::text AS label, count(*)::int c FROM public.cargo_listings GROUP BY status) s),
      'by_regime',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY c DESC), '[]')
                           FROM (SELECT CASE WHEN is_grain_cargo THEN 'Grain & agri'
                                             WHEN cargo_type = 'Break Bulk' THEN 'Break-bulk'
                                             ELSE 'Solid bulk cargo except grain' END AS label,
                                        count(*)::int c
                                   FROM public.cargo_listings
                                   WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED'
                                   GROUP BY 1) r),
      'by_load_zone',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY c DESC), '[]')
                           FROM (SELECT COALESCE(load_zone::text, 'Unknown') AS label, count(*)::int c
                                   FROM public.cargo_listings
                                   WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED'
                                   GROUP BY 1) z),
      'by_size_band',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY ord), '[]')
                           FROM (SELECT band AS label, count(*)::int c, ord FROM (
                                   SELECT CASE
                                            WHEN qty_max_mt < 10000 THEN '<10K'
                                            WHEN qty_max_mt < 20000 THEN '10-20K'
                                            WHEN qty_max_mt < 35000 THEN '20-35K'
                                            WHEN qty_max_mt < 50000 THEN '35-50K'
                                            ELSE '50K+' END AS band,
                                          CASE
                                            WHEN qty_max_mt < 10000 THEN 1
                                            WHEN qty_max_mt < 20000 THEN 2
                                            WHEN qty_max_mt < 35000 THEN 3
                                            WHEN qty_max_mt < 50000 THEN 4
                                            ELSE 5 END AS ord
                                     FROM public.cargo_listings
                                     WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED'
                                   ) q GROUP BY band, ord) b)
    ),
    'vessels', jsonb_build_object(
      'total',          (SELECT count(*)::int FROM public.vessels),
      'sanctioned',     (SELECT count(*)::int FROM public.vessels WHERE is_sanctioned = true),
      'geared',         (SELECT count(*)::int FROM public.vessels WHERE is_geared = true),
      'open_positions', (SELECT count(*)::int FROM public.vessel_availability
                           WHERE status = 'OPEN' AND review_status = 'APPROVED'),
      'positions_pending', (SELECT count(*)::int FROM public.vessel_availability WHERE review_status = 'PENDING'),
      'posted_7d',      (SELECT count(*)::int FROM public.vessel_availability WHERE created_at >= now() - interval '7 days'),
      'by_type',        (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY c DESC), '[]')
                           FROM (SELECT COALESCE(vessel_type::text, 'Unknown') AS label, count(*)::int c
                                   FROM public.vessels GROUP BY 1) t),
      'by_open_zone',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY c DESC), '[]')
                           FROM (SELECT COALESCE(open_zone::text, 'Unknown') AS label, count(*)::int c
                                   FROM public.vessel_availability
                                   WHERE status = 'OPEN' AND review_status = 'APPROVED'
                                   GROUP BY 1) z),
      'by_age_band',    (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', c) ORDER BY ord), '[]')
                           FROM (SELECT band AS label, count(*)::int c, ord FROM (
                                   SELECT CASE
                                            WHEN build_year IS NULL THEN 'Unknown'
                                            WHEN (extract(year FROM now())::int - build_year) <= 5 THEN '0-5 yrs'
                                            WHEN (extract(year FROM now())::int - build_year) <= 10 THEN '6-10 yrs'
                                            WHEN (extract(year FROM now())::int - build_year) <= 15 THEN '11-15 yrs'
                                            WHEN (extract(year FROM now())::int - build_year) <= 20 THEN '16-20 yrs'
                                            ELSE '20+ yrs' END AS band,
                                          CASE
                                            WHEN build_year IS NULL THEN 9
                                            WHEN (extract(year FROM now())::int - build_year) <= 5 THEN 1
                                            WHEN (extract(year FROM now())::int - build_year) <= 10 THEN 2
                                            WHEN (extract(year FROM now())::int - build_year) <= 15 THEN 3
                                            WHEN (extract(year FROM now())::int - build_year) <= 20 THEN 4
                                            ELSE 5 END AS ord
                                     FROM public.vessels
                                   ) q GROUP BY band, ord) b)
    )
  ) INTO v;

  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_ops_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_ops_stats() TO authenticated;


-- ═════════ 20260601001060_public_platform_totals ═════════

-- ════════════════════════════════════════════════════════════════════
-- Public platform totals — the "we have something" stats bar · firewall-safe
--
-- Aggregate-only reach figures for an anonymous public stats bar: the live
-- cargo book, vessels tracked, open positions, ports, trade zones and member
-- companies. SECURITY DEFINER so the counts are correct under RLS; returns
-- ONLY integers (no rows, no PII, no contact, no service-role key). Guarded so
-- it still answers on schemas missing the org/ports tables.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_platform_totals()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cargo int := 0; v_vessel int := 0; v_open int := 0;
  v_port int := 0; v_zone int := 0; v_company int := 0;
BEGIN
  IF to_regclass('public.cargo_listings') IS NOT NULL THEN
    SELECT count(*)::int INTO v_cargo FROM public.cargo_listings
      WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED';
  END IF;
  IF to_regclass('public.vessels') IS NOT NULL THEN
    SELECT count(*)::int INTO v_vessel FROM public.vessels;
  END IF;
  IF to_regclass('public.vessel_availability') IS NOT NULL THEN
    SELECT count(*)::int INTO v_open FROM public.vessel_availability
      WHERE status = 'OPEN' AND review_status = 'APPROVED';
  END IF;
  IF to_regclass('public.ports') IS NOT NULL THEN
    SELECT count(*)::int INTO v_port FROM public.ports;
    SELECT count(DISTINCT zone)::int INTO v_zone FROM public.ports
      WHERE zone IS NOT NULL AND zone::text <> 'Unknown';
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL THEN
    SELECT count(*)::int INTO v_company FROM public.organizations;
  END IF;

  RETURN jsonb_build_object(
    'cargo_live',     v_cargo,
    'vessels',        v_vessel,
    'open_positions', v_open,
    'ports',          v_port,
    'zones',          v_zone,
    'companies',      v_company
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_platform_totals() TO anon, authenticated;


-- ═════════ 20260601001070_market_insights_lane_band ═════════

-- ════════════════════════════════════════════════════════════════════
-- Market Insights generator v2 — adds the lane "typical band" (Pre_Final §12)
--
-- Same firewall rules as …000900 (aggregates only · ≥5 floor → "Other" ·
-- bands not precision). One addition: each top lane carries its TYPICAL size
-- band (modal band of the lane's cargoes) so the lanes table can render the
-- design's band chip. "Other" lanes report 'Mixed'. Republish the bootstrap
-- editions after applying to surface the chips in W21–W23.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_build_market_insights(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH params AS (
  SELECT 5::int AS floor_n,
         ARRAY['AG','R.SEA','E.MED','B.SEA','A.SEA']::public.zone_enum[] AS focus
),
-- Live cargo activity in the window, within scope. Only the coarse, non-PII
-- columns are pulled — no broker, notes, ref, laycan, ownership, or exact id use.
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
    AND cl.created_at >= p_from::timestamptz
    AND cl.created_at <  (p_to + 1)::timestamptz
    AND cl.qty_max_mt < 66000
    AND (cl.load_zone = ANY (p.focus) OR cl.disch_zone = ANY (p.focus))
),
open_tonnage AS (
  SELECT count(*)::int AS n
  FROM public.vessel_availability va, params p
  WHERE va.review_status = 'APPROVED'
    AND va.status = 'OPEN'
    AND va.created_at >= p_from::timestamptz
    AND va.created_at <  (p_to + 1)::timestamptz
    AND (va.open_zone IS NULL OR va.open_zone = ANY (p.focus))
),
-- ── grouped counts (raw, pre-floor) ──
regime_c AS (SELECT regime AS k, count(*) c FROM live_cargo GROUP BY regime),
band_c   AS (SELECT size_band AS k, count(*) c FROM live_cargo GROUP BY size_band),
lane_c   AS (SELECT (load_zone::text || ' → ' || disch_zone::text) AS k, count(*) c,
                    mode() WITHIN GROUP (ORDER BY size_band) AS band
             FROM live_cargo WHERE load_zone IS NOT NULL AND disch_zone IS NOT NULL GROUP BY 1),
comm_c   AS (SELECT commodity_name AS k, count(*) c FROM live_cargo WHERE commodity_name IS NOT NULL GROUP BY 1),
loadz_c  AS (SELECT load_zone::text AS k, count(*) c FROM live_cargo WHERE load_zone IS NOT NULL GROUP BY 1),
dischz_c AS (SELECT disch_zone::text AS k, count(*) c FROM live_cargo WHERE disch_zone IS NOT NULL GROUP BY 1),
-- ── apply the floor: <5 in any group folds into "Other" ──
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
    -- average is a population aggregate; rounded to the nearest 500 MT, and only
    -- emitted once the population clears the floor (else null).
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
$$;

-- Generator only — NOT granted to anon. Run by the Monday job (service role) or
-- an admin. The public surface reads frozen editions, never this function.
REVOKE ALL ON FUNCTION public.fn_build_market_insights(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_build_market_insights(date, date) TO service_role;


-- ═════════ 20260601001080_position_checkin ═════════

-- ════════════════════════════════════════════════════════════════════
-- Vessel position check-in (Pre_Final §13) · append-only · firewall-safe
--
-- Backs the routine check-in popup: the vessel persona confirms (one tap) or
-- updates (4 fields) the position on file. Confirm AND update both stamp
-- position_confirmed_at — the owner's confirmation is the trust signal, AIS
-- may prefill later but never replaces it.
--
-- fn_position_checkin is SECURITY DEFINER and verifies the caller actually
-- owns the availability (current primary listing_ownership, the prod
-- ownership model, with the org-membership extension) or is an admin; it
-- updates ONLY the position fields, nothing else.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS eta_port_locode        TEXT,
  ADD COLUMN IF NOT EXISTS eta_date               DATE,
  ADD COLUMN IF NOT EXISTS eta_time               TIME,
  ADD COLUMN IF NOT EXISTS position_confirmed_at  TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.fn_position_checkin(
  p_availability_id uuid,
  p_eta_port_locode text DEFAULT NULL,
  p_eta_date        date DEFAULT NULL,
  p_eta_time        time DEFAULT NULL,
  p_open_date       date DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owned boolean;
  v_now   timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.listing_ownership lo
    WHERE lo.listing_id = p_availability_id
      AND lo.listing_type = 'vessel_availability'
      AND lo.is_current = true
      AND lo.role = 'primary'
      AND (
        lo.owner_user_id = auth.uid()
        OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
      )
  ) INTO v_owned;

  IF NOT (v_owned OR public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Not the owner of this position';
  END IF;

  -- Confirm path: no ETA args → just stamp freshness.
  -- Update path: write the supplied fields, then stamp.
  UPDATE public.vessel_availability
  SET eta_port_locode       = COALESCE(p_eta_port_locode, eta_port_locode),
      eta_date              = COALESCE(p_eta_date, eta_date),
      eta_time              = COALESCE(p_eta_time, eta_time),
      open_date             = COALESCE(p_open_date, open_date),
      position_confirmed_at = v_now
  WHERE id = p_availability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  RETURN v_now;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_position_checkin(uuid, text, date, time, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_position_checkin(uuid, text, date, time, date) TO authenticated;

-- Surface the freshness to readers (cards/map "confirmed Nd ago" signal).
GRANT SELECT (eta_port_locode, eta_date, eta_time, position_confirmed_at)
  ON public.vessel_availability TO authenticated;


-- ═════════ Rebuild the 3 published editions with the lane "typical band" ═════════
-- (One-time: delete + republish from current data so the band chips appear.
--  Frozen-on-publish from here on; the Monday cron owns future weeks.)
DELETE FROM public.market_insights_editions WHERE week_id IN ('2026-W21','2026-W22','2026-W23');
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-18', DATE '2026-05-24', '2026-W21', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-25', DATE '2026-05-31', '2026-W22', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-06-01', DATE '2026-06-07', '2026-W23', true);

-- Sanity: the three editions with their headline counts (and a lane band)
SELECT week_id,
       (payload->'snapshot'->>'cargoes_live')  AS cargoes_live,
       (payload->'snapshot'->>'open_tonnage')  AS open_tonnage,
       (payload->'snapshot'->>'active_lanes')  AS active_lanes,
       payload->'top_lanes'->0->>'band'        AS top_lane_band,
       published_at IS NOT NULL                AS published
FROM public.market_insights_editions
WHERE week_id IN ('2026-W21','2026-W22','2026-W23')
ORDER BY week_id DESC;
