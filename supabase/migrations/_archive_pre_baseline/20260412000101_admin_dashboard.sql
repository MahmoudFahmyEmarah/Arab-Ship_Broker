-- ── 1. Admin stats RPC ────────────────────────────────────────
-- Returns all top-level metrics in one query.
-- Called once on the admin dashboard home page.
-- SECURITY DEFINER so it can bypass RLS and count everything.

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Only admins may call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    -- ── Review queue ──────────────────────────────────────────
    'queue_pending',          (SELECT COUNT(*) FROM public.review_queue WHERE status = 'PENDING'),
    'queue_oldest_minutes',   (
      SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 60
      FROM public.review_queue
      WHERE status = 'PENDING'
    ),

    -- ── Cargo listings ────────────────────────────────────────
    'cargo_live',             (SELECT COUNT(*) FROM public.cargo_listings WHERE status IN ('IN','PARTIAL') AND review_status = 'APPROVED'),
    'cargo_pending',          (SELECT COUNT(*) FROM public.cargo_listings WHERE review_status = 'PENDING'),
    'cargo_total_30d',        (SELECT COUNT(*) FROM public.cargo_listings WHERE created_at >= NOW() - INTERVAL '30 days'),

    -- ── Vessel availability ───────────────────────────────────
    'vessel_open',            (SELECT COUNT(*) FROM public.vessel_availability WHERE status = 'OPEN' AND review_status = 'APPROVED'),
    'vessel_pending',         (SELECT COUNT(*) FROM public.vessel_availability WHERE review_status = 'PENDING'),

    -- ── Users ─────────────────────────────────────────────────
    'users_total',            (SELECT COUNT(*) FROM public.users WHERE role != 'admin'),
    'users_active',           (SELECT COUNT(*) FROM public.users WHERE is_active = TRUE AND role != 'admin'),
    'users_new_tier',         (SELECT COUNT(*) FROM public.users WHERE trust_tier = 'NEW' AND role != 'admin'),
    'users_verified_tier',    (SELECT COUNT(*) FROM public.users WHERE trust_tier = 'VERIFIED' AND role != 'admin'),
    'users_flagged_tier',     (SELECT COUNT(*) FROM public.users WHERE trust_tier = 'FLAGGED' AND role != 'admin'),
    'users_new_30d',          (SELECT COUNT(*) FROM public.users WHERE created_at >= NOW() - INTERVAL '30 days' AND role != 'admin'),

    -- ── Vessels register ──────────────────────────────────────
    'vessels_total',          (SELECT COUNT(*) FROM public.vessels),
    'vessels_sanctioned',     (SELECT COUNT(*) FROM public.vessels WHERE is_sanctioned = TRUE),
    'vessels_high_risk',      (SELECT COUNT(*) FROM public.vessels WHERE risk_level = 'HIGH'),

    -- ── Ports ─────────────────────────────────────────────────
    'ports_unverified',       (SELECT COUNT(*) FROM public.ports WHERE is_verified = FALSE),

    -- ── Contact messages ──────────────────────────────────────
    'messages_unread',        (SELECT COUNT(*) FROM public.contact_messages WHERE is_read = FALSE)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;


-- ── 2. Admin activity time-series RPC ────────────────────────
-- Returns daily counts for the last N days.
-- Used to draw the activity chart on the dashboard home.

CREATE OR REPLACE FUNCTION public.get_admin_activity(p_days integer DEFAULT 30)
RETURNS TABLE (
  day              date,
  cargo_submitted  bigint,
  vessel_submitted bigint,
  approved         bigint,
  rejected         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      (NOW() - (p_days - 1) * INTERVAL '1 day')::date,
      NOW()::date,
      INTERVAL '1 day'
    )::date AS day
  ),
  cargo_daily AS (
    SELECT created_at::date AS day, COUNT(*) AS cnt
    FROM public.cargo_listings
    WHERE created_at >= NOW() - p_days * INTERVAL '1 day'
    GROUP BY 1
  ),
  vessel_daily AS (
    SELECT created_at::date AS day, COUNT(*) AS cnt
    FROM public.vessel_availability
    WHERE created_at >= NOW() - p_days * INTERVAL '1 day'
    GROUP BY 1
  ),
  approved_daily AS (
    SELECT reviewed_at::date AS day, COUNT(*) AS cnt
    FROM public.review_queue
    WHERE status = 'APPROVED'
      AND reviewed_at >= NOW() - p_days * INTERVAL '1 day'
    GROUP BY 1
  ),
  rejected_daily AS (
    SELECT reviewed_at::date AS day, COUNT(*) AS cnt
    FROM public.review_queue
    WHERE status IN ('REJECTED', 'FLAGGED')
      AND reviewed_at >= NOW() - p_days * INTERVAL '1 day'
    GROUP BY 1
  )
  SELECT
    ds.day,
    COALESCE(cd.cnt, 0) AS cargo_submitted,
    COALESCE(vd.cnt, 0) AS vessel_submitted,
    COALESCE(ad.cnt, 0) AS approved,
    COALESCE(rd.cnt, 0) AS rejected
  FROM date_series ds
  LEFT JOIN cargo_daily   cd ON cd.day = ds.day
  LEFT JOIN vessel_daily  vd ON vd.day = ds.day
  LEFT JOIN approved_daily ad ON ad.day = ds.day
  LEFT JOIN rejected_daily rd ON rd.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_activity(integer) TO authenticated;


-- ── 3. Admin queue with full listing detail ───────────────────
-- Extends the existing v_admin_queue view to include listing previews.
-- Admin needs to see cargo/vessel details without opening each item.

CREATE OR REPLACE VIEW public.v_admin_queue_detail AS
SELECT
  rq.id,
  rq.listing_type,
  rq.listing_id,
  rq.submitted_by,
  rq.trust_tier_at_submit,
  rq.is_random_sample,
  rq.review_reason,
  rq.status,
  rq.action_taken,
  rq.amendment_detail,
  rq.reviewed_by,
  rq.reviewed_at,
  rq.created_at,
  rq.updated_at,
  -- Submitter info
  u.full_name        AS submitter_name,
  u.email            AS submitter_email,
  u.trust_tier       AS submitter_trust_tier,
  u.clean_posts      AS submitter_clean_posts,
  u.strike_count     AS submitter_strike_count,
  -- Cargo listing preview (null if vessel)
  cl.ref             AS cargo_ref,
  cl.commodity_name,
  cl.cargo_type,
  cl.qty_min_mt,
  cl.qty_max_mt,
  cl.load_port_name,
  cl.load_zone,
  cl.disch_port_name,
  cl.disch_zone,
  cl.laycan_from,
  cl.laycan_to,
  cl.is_spot,
  cl.status          AS cargo_status,
  cl.review_status   AS cargo_review_status,
  -- Vessel availability preview (null if cargo)
  va.vessel_id,
  v.vessel_name,
  v.vessel_type,
  v.dwt_grain,
  v.risk_level,
  v.is_sanctioned,
  va.open_port_name,
  va.open_zone,
  va.open_date,
  va.status          AS vessel_status,
  va.review_status   AS vessel_review_status
FROM public.review_queue rq
JOIN public.users u ON u.supabase_user_id = rq.submitted_by
LEFT JOIN public.cargo_listings cl
  ON cl.id = rq.listing_id AND rq.listing_type = 'cargo'
LEFT JOIN public.vessel_availability va
  ON va.id = rq.listing_id AND rq.listing_type = 'vessel_availability'
LEFT JOIN public.vessels v ON v.id = va.vessel_id;

GRANT SELECT ON public.v_admin_queue_detail TO authenticated;


-- ── 4. Ensure admin can UPDATE users table ────────────────────
-- The existing RLS grants SELECT via is_admin(), but UPDATE was
-- never explicitly granted for trust_tier / is_active changes.

DROP POLICY IF EXISTS "Admins can update all users" ON public.users;
CREATE POLICY "Admins can update all users"
  ON public.users FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admin can also delete users (suspend flow)
DROP POLICY IF EXISTS "Admins can delete users" ON public.users;
CREATE POLICY "Admins can delete users"
  ON public.users FOR DELETE TO authenticated
  USING (public.is_admin());

-- Admin can insert new users directly (e.g. creating sub-admin accounts)
DROP POLICY IF EXISTS "Admins can insert users" ON public.users;
CREATE POLICY "Admins can insert users"
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- ── 5. Admin full access to ports and commodities ────────────
-- These are already covered by existing admin policies in migration 005,
-- but add explicit UPDATE/DELETE in case they were missed.

DROP POLICY IF EXISTS "Admins manage ports full" ON public.ports;
CREATE POLICY "Admins manage ports full"
  ON public.ports FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage commodities full" ON public.commodities;
CREATE POLICY "Admins manage commodities full"
  ON public.commodities FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage safety questions full" ON public.safety_questions;
CREATE POLICY "Admins manage safety questions full"
  ON public.safety_questions FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());