-- ════════════════════════════════════════════════════════════════════
-- Arab ShipBroker — Stats & Market Insights apply bundle (2026-06-12)
-- Run this WHOLE file ONCE in the Supabase SQL editor.
--
-- Brings prod up to date for: the landing "available this week" counter, the
-- admin Platform Stats page, the public reach stats bar, and REAL weekly
-- Market Insights editions (replaces the sample with live platform data).
--
-- All parts are idempotent / safe to re-run. The refresh section only touches
-- SEED rows (cargo ref CM-%, broker-imported vessel positions); real user
-- posts keep their true dates, and published weeks never recompute.
-- ════════════════════════════════════════════════════════════════════


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
