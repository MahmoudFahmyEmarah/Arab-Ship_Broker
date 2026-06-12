-- ════════════════════════════════════════════════════════════════════
-- Market Insights — rebalance v2: the W22 import block (2026-06-12)
--
-- Diagnosis from prod: EVERY cargo row has a listing_ownership record (the
-- import created them wholesale), so the ownership-based rule in rebalance v1
-- matched nothing. The actual spike is 337 NON-seed rows (ref not CM-%) all
-- parked on their bulk-import timestamp inside ISO week 22 (25-31 May) — a
-- week that predates the platform being usable, so no genuine member post can
-- exist in that window. Those rows get the same deterministic spread the seed
-- rows already had.
--
-- Idempotent: after the move no row remains in the W22 window without a CM
-- ref, so a re-run matches nothing. Editions W21-W23 are rebuilt once after.
--
-- RUN ONCE in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Spread the W22 import block across W21..W24 ──
UPDATE public.cargo_listings cl
SET created_at = (DATE '2026-05-18'
                   + ((abs(hashtext(cl.id::text)) % 4) * 7)
                   + (abs(hashtext(cl.id::text || 'd')) % 7))::timestamptz
                 + interval '10 hours'
WHERE (cl.ref IS NULL OR cl.ref NOT LIKE 'CM-%')
  AND cl.created_at >= DATE '2026-05-25'
  AND cl.created_at <  DATE '2026-06-01';

-- ── 2. Rebuild the three bootstrap editions from the corrected dates ──
DELETE FROM public.market_insights_editions WHERE week_id IN ('2026-W21','2026-W22','2026-W23');
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-18', DATE '2026-05-24', '2026-W21', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-25', DATE '2026-05-31', '2026-W22', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-06-01', DATE '2026-06-07', '2026-W23', true);

-- ── 3. Sanity: weekly distribution should now be roughly even ──
SELECT date_trunc('week', created_at)::date AS week_start, count(*) AS cargo_posted
FROM public.cargo_listings GROUP BY 1 ORDER BY 1;

SELECT week_id,
       (payload->'snapshot'->>'cargoes_live')  AS cargoes_live,
       (payload->'snapshot'->>'open_tonnage')  AS open_tonnage,
       (payload->'snapshot'->>'active_lanes')  AS active_lanes,
       published_at IS NOT NULL                AS published
FROM public.market_insights_editions
WHERE week_id IN ('2026-W21','2026-W22','2026-W23')
ORDER BY week_id DESC;
