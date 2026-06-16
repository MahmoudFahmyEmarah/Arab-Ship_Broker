-- Add open_port_locode to v_my_vessels so VesselCard can render a
-- clickable port link (href="/dashboard/ports/:locode").
DROP VIEW IF EXISTS public.v_my_vessels;
CREATE VIEW public.v_my_vessels AS
WITH latest_open AS (
  SELECT DISTINCT ON (va.vessel_id)
    va.vessel_id,
    va.open_port_name,
    va.open_port_locode,
    va.open_zone,
    va.open_date
  FROM public.vessel_availability va
  WHERE va.status = 'OPEN'
    AND va.review_status = 'APPROVED'
  ORDER BY va.vessel_id, va.created_at DESC
),
open_counts AS (
  SELECT
    va.vessel_id,
    COUNT(*) FILTER (
      WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED'
    ) AS open_availability_count
  FROM public.vessel_availability va
  GROUP BY va.vessel_id
)
SELECT
  v.*,
  vc.user_id,
  vc.role        AS claim_role,
  vc.created_at  AS claimed_at,
  COALESCE(oc.open_availability_count, 0)::BIGINT AS open_availability_count,
  lo.open_port_name,
  lo.open_port_locode,
  lo.open_zone,
  lo.open_date
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN open_counts oc ON oc.vessel_id = v.id
LEFT JOIN latest_open lo  ON lo.vessel_id = v.id
WHERE vc.user_id = auth.uid();

GRANT SELECT ON public.v_my_vessels TO authenticated;
