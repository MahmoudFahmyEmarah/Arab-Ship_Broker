-- ============================================================
-- ARAB SHIPBROKER — MATCH RECOMPUTE FUNCTION
-- Database-side helper to flush + refresh match counts.
-- ============================================================
-- Note: The full scoring logic lives in TypeScript (src/lib/matching.ts).
-- This SQL function is a fast convenience that the app or admin can call
-- to clear stale matches when a cargo/vessel goes off-market.
-- ============================================================

-- Clear matches that reference closed cargo or fixed vessels
CREATE OR REPLACE FUNCTION fn_match_cleanup()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  removed INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM matches m
    USING cargo_listings c, vessel_availability v
    WHERE m.cargo_id = c.id
      AND m.vessel_avail_id = v.id
      AND (
        c.status NOT IN ('IN','PARTIAL')
        OR v.status != 'OPEN'
        OR c.review_status != 'APPROVED'
        OR v.review_status != 'APPROVED'
      )
    RETURNING m.id
  )
  SELECT COUNT(*) INTO removed FROM deleted;
  RETURN removed;
END;
$$;

-- View — match count per cargo (used by cargo cards)
CREATE OR REPLACE VIEW v_cargo_match_counts AS
SELECT
  c.id AS cargo_id,
  COUNT(m.id) AS total_matches,
  COUNT(*) FILTER (WHERE m.score_label = 'Strong')   AS strong,
  COUNT(*) FILTER (WHERE m.score_label = 'Good')     AS good,
  COUNT(*) FILTER (WHERE m.score_label = 'Possible') AS possible,
  COUNT(*) FILTER (WHERE m.score_label = 'Weak')     AS weak
FROM cargo_listings c
LEFT JOIN matches m ON m.cargo_id = c.id
WHERE c.review_status = 'APPROVED'
  AND c.status IN ('IN','PARTIAL')
GROUP BY c.id;

-- View — match count per vessel availability
CREATE OR REPLACE VIEW v_vessel_match_counts AS
SELECT
  v.id AS vessel_avail_id,
  COUNT(m.id) AS total_matches,
  COUNT(*) FILTER (WHERE m.score_label = 'Strong')   AS strong,
  COUNT(*) FILTER (WHERE m.score_label = 'Good')     AS good,
  COUNT(*) FILTER (WHERE m.score_label = 'Possible') AS possible,
  COUNT(*) FILTER (WHERE m.score_label = 'Weak')     AS weak
FROM vessel_availability v
LEFT JOIN matches m ON m.vessel_avail_id = v.id
WHERE v.review_status = 'APPROVED'
  AND v.status = 'OPEN'
GROUP BY v.id;

-- Auto-cleanup trigger: when cargo or vessel status changes, drop stale matches
CREATE OR REPLACE FUNCTION fn_match_auto_cleanup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'cargo_listings' THEN
    IF NEW.status NOT IN ('IN','PARTIAL') OR NEW.review_status != 'APPROVED' THEN
      DELETE FROM matches WHERE cargo_id = NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'vessel_availability' THEN
    IF NEW.status != 'OPEN' OR NEW.review_status != 'APPROVED' THEN
      DELETE FROM matches WHERE vessel_avail_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cl_match_cleanup ON cargo_listings;
CREATE TRIGGER trg_cl_match_cleanup
  AFTER UPDATE OF status, review_status ON cargo_listings
  FOR EACH ROW EXECUTE FUNCTION fn_match_auto_cleanup();

DROP TRIGGER IF EXISTS trg_va_match_cleanup ON vessel_availability;
CREATE TRIGGER trg_va_match_cleanup
  AFTER UPDATE OF status, review_status ON vessel_availability
  FOR EACH ROW EXECUTE FUNCTION fn_match_auto_cleanup();
