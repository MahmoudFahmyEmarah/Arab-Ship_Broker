ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS vessel_review_status TEXT
    NOT NULL DEFAULT 'CLEAR'
    CHECK (vessel_review_status IN ('CLEAR', 'IN_REVIEW')),
  ADD COLUMN IF NOT EXISTS vessel_review_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_vessels_review_status
  ON public.vessels (vessel_review_status)
  WHERE vessel_review_status = 'IN_REVIEW';


DROP VIEW IF EXISTS public.v_my_vessels;
CREATE VIEW public.v_my_vessels AS
WITH latest_open AS (
  SELECT DISTINCT ON (va.vessel_id)
    va.vessel_id,
    va.open_port_name,
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
  lo.open_zone,
  lo.open_date
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN open_counts oc ON oc.vessel_id = v.id
LEFT JOIN latest_open lo  ON lo.vessel_id = v.id
WHERE vc.user_id = auth.uid();

GRANT SELECT ON public.v_my_vessels TO authenticated;

CREATE OR REPLACE FUNCTION public.set_vessel_review_status(
  p_vessel_id     UUID,
  p_status        TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_status NOT IN ('CLEAR', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'Invalid vessel_review_status: %', p_status;
  END IF;

  UPDATE public.vessels
  SET
    vessel_review_status = p_status,
    vessel_review_reason = CASE
      WHEN p_status = 'CLEAR' THEN NULL
      ELSE NULLIF(TRIM(COALESCE(p_reason, '')), '')
    END
  WHERE id = p_vessel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_vessel_review_status(UUID, TEXT, TEXT)
  TO authenticated;