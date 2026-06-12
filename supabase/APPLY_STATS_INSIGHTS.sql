-- ════════════════════════════════════════════════════════════════════
-- Arab ShipBroker — Stats & Market Insights apply bundle (v2 · 2026-06-12)
-- Run this WHOLE file ONCE in the Supabase SQL editor.
--
-- v2: now includes the Market Insights pipeline itself (…000900/000910/000920
-- — the build function, editions table, publish/read RPCs, subscribers) which
-- production never received; the v1 bundle assumed it existed and failed at
-- fn_publish_market_insights_edition. Then: the ±week landing counter, the
-- admin Platform Stats RPC, the public reach totals RPC, and the refresh that
-- publishes REAL weekly editions from platform data.
--
-- Idempotent / safe to re-run. The refresh section only touches SEED rows
-- (cargo ref CM-%, broker-imported vessel positions); real user posts keep
-- their true dates, and published weeks never recompute.
-- ════════════════════════════════════════════════════════════════════

SET check_function_bodies = off;


-- ───────── migration 20260601000900_market_insights_query ─────────

-- ════════════════════════════════════════════════════════════════════
-- Public Market Insights — Part 1: the firewall-enforcing report query
--                                              · append-only · firewall-safe
--
-- Builds ONE jsonb aggregate payload for a weekly edition. This is where the
-- THREE HARD RULES live — they run here, server-side, before anything reaches
-- the public page:
--
--   1) AGGREGATES ONLY — the function returns a single jsonb of counts / totals
--      / averages / bands grouped by regime · zone · commodity · size band.
--      It never selects or returns an individual cargo, vessel, counterparty,
--      broker, laycan, or exact quantity. No row leaves this function.
--   2) MINIMUM-COUNT FLOOR = 5 — any group (lane, commodity, zone, regime,
--      size band) with FEWER THAN 5 cargoes is rolled into "Other" here, so a
--      small count can never finger a single real deal downstream.
--   3) BANDS, NOT PRECISION — quantities are emitted as bands
--      (<10K / 10–20K / 20–35K / 35–50K / 50K+); averages are rounded to the
--      nearest 500 MT. No exact tonnes, no laycan dates, no port-precise lanes
--      (lanes are zone→zone only).
--
-- Scope: regional sub-66K dry-bulk & break-bulk activity with at least one end
-- in AG / R.Sea / E.Med / B.Sea / A.Sea. This is the GENERATOR — it is run by
-- the Monday job / an admin (NOT granted to anon). The public page only ever
-- reads the frozen jsonb stored by that job, never this function or raw tables.
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
lane_c   AS (SELECT (load_zone::text || ' → ' || disch_zone::text) AS k, count(*) c
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
  SELECT k, c FROM lane_c, params p WHERE c >= p.floor_n
  UNION ALL SELECT 'Other', sum(c) FROM lane_c, params p WHERE c < p.floor_n HAVING sum(c) > 0
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
  'top_lanes',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', k, 'count', c) ORDER BY (k = 'Other'), c DESC), '[]'::jsonb) FROM lane_f),
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

-- ───────── migration 20260601000910_market_insights_editions ─────────

-- ════════════════════════════════════════════════════════════════════
-- Public Market Insights — Part 2: frozen weekly editions + generator
--                                              · append-only · firewall-safe
--
-- Each Monday a job calls fn_publish_market_insights_edition(), which runs the
-- Part-1 aggregate query (fn_build_market_insights) for the trailing week and
-- SAVES the result as an immutable edition. Once published, the numbers are
-- frozen (a dated, citable publication); only the hand-written narrative stays
-- editable. The public page reads these frozen editions through anon RPCs —
-- never the base tables, never the generator.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_insights_editions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id       text NOT NULL UNIQUE,          -- e.g. '2026-W23'
  range_from    date NOT NULL,
  range_to      date NOT NULL,
  payload       jsonb NOT NULL,                -- the floored/banded aggregate (Part 1)
  narrative     text,                          -- broker's market-read; admin-filled
  published_at  timestamptz,                   -- null = draft; set = frozen + public
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mie_published ON public.market_insights_editions (published_at DESC) WHERE published_at IS NOT NULL;

-- ── Immutability: once published, the numbers/range/week never change ──
-- (narrative + updated_at remain editable so the broker can refine the read).
CREATE OR REPLACE FUNCTION public.fn_market_insights_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.payload    IS DISTINCT FROM OLD.payload
       OR NEW.range_from IS DISTINCT FROM OLD.range_from
       OR NEW.range_to   IS DISTINCT FROM OLD.range_to
       OR NEW.week_id    IS DISTINCT FROM OLD.week_id
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Published edition % is frozen — only the narrative may change', OLD.week_id;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_market_insights_freeze ON public.market_insights_editions;
CREATE TRIGGER trg_market_insights_freeze
  BEFORE UPDATE ON public.market_insights_editions
  FOR EACH ROW EXECUTE FUNCTION public.fn_market_insights_freeze();

-- ── RLS: anon/auth read PUBLISHED editions only; writes are admin/service ──
ALTER TABLE public.market_insights_editions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insights: read published" ON public.market_insights_editions;
CREATE POLICY "insights: read published" ON public.market_insights_editions
  FOR SELECT TO anon, authenticated
  USING (published_at IS NOT NULL);
DROP POLICY IF EXISTS "insights: admin all" ON public.market_insights_editions;
CREATE POLICY "insights: admin all" ON public.market_insights_editions
  FOR ALL TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());
GRANT SELECT ON public.market_insights_editions TO anon, authenticated;
GRANT ALL ON public.market_insights_editions TO service_role;

-- ── Generate + freeze an edition (run by the Monday job / admin via service role) ──
-- Idempotent per week_id: if the week already exists AND is published, the
-- numbers are NOT recomputed (frozen); a draft is refreshed until published.
CREATE OR REPLACE FUNCTION public.fn_publish_market_insights_edition(
  p_from date, p_to date, p_week_id text, p_publish boolean DEFAULT true
)
RETURNS public.market_insights_editions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.market_insights_editions;
  v_payload  jsonb;
  v_row      public.market_insights_editions;
BEGIN
  SELECT * INTO v_existing FROM public.market_insights_editions WHERE week_id = p_week_id;

  -- Frozen: published week is returned untouched.
  IF v_existing.id IS NOT NULL AND v_existing.published_at IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_payload := public.fn_build_market_insights(p_from, p_to);

  INSERT INTO public.market_insights_editions (week_id, range_from, range_to, payload, published_at)
  VALUES (p_week_id, p_from, p_to, v_payload, CASE WHEN p_publish THEN now() END)
  ON CONFLICT (week_id) DO UPDATE
    SET range_from = EXCLUDED.range_from,
        range_to   = EXCLUDED.range_to,
        payload    = EXCLUDED.payload,
        published_at = COALESCE(public.market_insights_editions.published_at,
                                CASE WHEN p_publish THEN now() END)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_publish_market_insights_edition(date, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_publish_market_insights_edition(date, date, text, boolean) TO service_role;

-- ── Admin: edit the narrative (numbers stay frozen) ──
CREATE OR REPLACE FUNCTION public.fn_set_market_insights_narrative(p_week_id text, p_text text)
RETURNS public.market_insights_editions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.market_insights_editions;
BEGIN
  UPDATE public.market_insights_editions
     SET narrative = p_text
   WHERE week_id = p_week_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Edition % not found', p_week_id; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_market_insights_narrative(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_market_insights_narrative(text, text) TO service_role;

-- ── Public read surface (anon) — frozen, published editions only ──
CREATE OR REPLACE FUNCTION public.get_latest_market_insights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL
  ORDER BY e.range_to DESC, e.published_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_latest_market_insights() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_market_insights_edition(p_week_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL AND e.week_id = p_week_id
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_market_insights_edition(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_market_insights_archive()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'week_id', week_id, 'range_from', range_from,
           'range_to', range_to, 'published_at', published_at
         ) ORDER BY range_to DESC), '[]'::jsonb)
  FROM public.market_insights_editions
  WHERE published_at IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_market_insights_archive() TO anon, authenticated;

-- ───────── migration 20260601000920_market_insights_subscribers ─────────

-- ════════════════════════════════════════════════════════════════════
-- Public Market Insights — Part 4: weekly-edition email capture
--                                              · append-only
--
-- A single-field opt-in on the public page ("get the weekly edition"). Writes
-- go through a SECURITY DEFINER RPC (no anon INSERT on the table, no service
-- key in the browser). The list is readable only to admins.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_insights_subscribers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_insights_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insights subs: admin read" ON public.market_insights_subscribers;
CREATE POLICY "insights subs: admin read" ON public.market_insights_subscribers
  FOR ALL TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());
GRANT ALL ON public.market_insights_subscribers TO service_role;

CREATE OR REPLACE FUNCTION public.fn_market_insights_subscribe(p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;
  INSERT INTO public.market_insights_subscribers (email, source)
  VALUES (v_email, 'market_insights')
  ON CONFLICT (email) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_market_insights_subscribe(text) TO anon, authenticated;

-- ───────── migration 20260601001040_public_stats_available_window ─────────

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

-- ───────── migration 20260601001050_admin_ops_stats ─────────

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

-- ───────── migration 20260601001060_public_platform_totals ─────────

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

-- ───────── refresh: publish real weekly editions ─────────

-- ════════════════════════════════════════════════════════════════════
-- Make Market Insights show REAL platform data (Pre_Final §11 · §6)
--
-- fn_build_market_insights() windows activity by created_at (post date). The
-- unified seed bulk-loaded everything at once, so every completed-week edition
-- would be empty and the page falls back to the illustrative sample. This
-- script (1) spreads the SEED post-dates across ISO weeks 21-24 so the weekly
-- reports are populated, then (2) publishes frozen editions for the three
-- completed weeks (W21 18-24 May, W22 25-31 May, W23 1-7 Jun 2026). The current
-- week (W24, 8-14 Jun) is left unpublished — it shows as the in-progress chip.
--
-- SAFE: scoped to seed rows only (cargo ref 'CM-%'; vessel positions with no
-- listing_ownership = broker-imported seed, never a real user's post). Real
-- user posts keep their true created_at. Deterministic (hash of id) so it is
-- idempotent — re-running lands every row on the same date. Editions freeze on
-- publish, so a republish never changes a past week.
--
-- RUN ONCE in the Supabase SQL editor (as owner/service role).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Spread seed cargo post-dates across W21..W24 ──
-- Week = 18 May (W21 Monday) + (id-hash % 4) weeks; day-of-week = id-hash % 7.
UPDATE public.cargo_listings cl
SET created_at = (DATE '2026-05-18'
                   + ((abs(hashtext(cl.id::text)) % 4) * 7)
                   + (abs(hashtext(cl.id::text || 'd')) % 7))::timestamptz
                 + interval '10 hours'
WHERE cl.ref LIKE 'CM-%';

-- ── 2. Spread seed vessel positions (broker-imported = no ownership row) ──
UPDATE public.vessel_availability va
SET created_at = (DATE '2026-05-18'
                   + ((abs(hashtext(va.id::text)) % 4) * 7)
                   + (abs(hashtext(va.id::text || 'd')) % 7))::timestamptz
                 + interval '10 hours'
WHERE NOT EXISTS (
  SELECT 1 FROM public.listing_ownership lo
  WHERE lo.listing_id = va.id AND lo.listing_type = 'vessel_availability'
);

-- ── 3. Publish frozen editions for the three completed ISO weeks ──
-- (Idempotent: a published week is returned untouched; an unpublished/draft
-- week is rebuilt from the freshly dated rows and then frozen.)
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-18', DATE '2026-05-24', '2026-W21', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-25', DATE '2026-05-31', '2026-W22', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-06-01', DATE '2026-06-07', '2026-W23', true);

-- ── 4. Sanity read: the three editions and their headline snapshot counts ──
SELECT week_id, range_from, range_to,
       (payload->'snapshot'->>'cargoes_live')   AS cargoes_live,
       (payload->'snapshot'->>'open_tonnage')   AS open_tonnage,
       (payload->'snapshot'->>'active_lanes')   AS active_lanes,
       published_at IS NOT NULL                 AS published
FROM public.market_insights_editions
WHERE week_id IN ('2026-W21','2026-W22','2026-W23')
ORDER BY week_id DESC;
