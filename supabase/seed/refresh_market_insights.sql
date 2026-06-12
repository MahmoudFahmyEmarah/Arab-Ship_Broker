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
