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
