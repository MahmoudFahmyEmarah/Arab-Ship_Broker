-- ════════════════════════════════════════════════════════════════════
-- Market Insights — one-time rebalance of IMPORTED post-dates (2026-06-12)
--
-- WHY: the weekly distribution showed W22 with 425 cargo vs ~90 in the other
-- weeks. The seed rows (ref CM-%) spread evenly; the spike is ~330
-- pre-existing imported rows whose created_at is their BULK-IMPORT timestamp
-- (late May), not a real post date. An import timestamp is as artificial as
-- the seed's, so it gets the same treatment.
--
-- RULE: a row is "imported" iff it has NO listing_ownership row. Real organic
-- posts always have one (create_cargo_listing / create_vessel_availability
-- insert it), and those keep their true dates — never touched here.
--
-- Re-dating uses the SAME deterministic hash as refresh_market_insights.sql,
-- so already-spread seed rows land on identical dates (idempotent), and the
-- imported extras join the same uniform W21..W24 spread.
--
-- Editions W21..W23 are then rebuilt ONCE from the corrected dates: this is a
-- deliberate one-time bootstrap correction (delete + republish) before the
-- weekly cron takes over; from then on the freeze rule holds as designed.
--
-- RUN ONCE in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Spread ALL imported cargo (no ownership row) across W21..W24 ──
UPDATE public.cargo_listings cl
SET created_at = (DATE '2026-05-18'
                   + ((abs(hashtext(cl.id::text)) % 4) * 7)
                   + (abs(hashtext(cl.id::text || 'd')) % 7))::timestamptz
                 + interval '10 hours'
WHERE NOT EXISTS (
  SELECT 1 FROM public.listing_ownership lo
  WHERE lo.listing_id = cl.id AND lo.listing_type = 'cargo'
);

-- ── 2. Same for imported vessel positions ──
UPDATE public.vessel_availability va
SET created_at = (DATE '2026-05-18'
                   + ((abs(hashtext(va.id::text)) % 4) * 7)
                   + (abs(hashtext(va.id::text || 'd')) % 7))::timestamptz
                 + interval '10 hours'
WHERE NOT EXISTS (
  SELECT 1 FROM public.listing_ownership lo
  WHERE lo.listing_id = va.id AND lo.listing_type = 'vessel_availability'
);

-- ── 3. Rebuild the three bootstrap editions from the corrected dates ──
DELETE FROM public.market_insights_editions WHERE week_id IN ('2026-W21','2026-W22','2026-W23');
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-18', DATE '2026-05-24', '2026-W21', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-05-25', DATE '2026-05-31', '2026-W22', true);
SELECT public.fn_publish_market_insights_edition(DATE '2026-06-01', DATE '2026-06-07', '2026-W23', true);

-- ── 4. Sanity: weekly distribution should now be roughly even ──
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
