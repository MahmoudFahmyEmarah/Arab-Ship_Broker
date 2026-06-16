CREATE OR REPLACE FUNCTION public.get_archive_cutoff()
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_admin()
      THEN NULL
    WHEN (
      SELECT trust_tier FROM public.users
      WHERE supabase_user_id = auth.uid()
    ) = 'VERIFIED'
      THEN (NOW() - INTERVAL '3 months')::DATE
    ELSE
      (NOW() - INTERVAL '1 month')::DATE
  END;
$$;

GRANT EXECUTE ON FUNCTION public.get_archive_cutoff() TO authenticated;


CREATE OR REPLACE FUNCTION public.is_within_temporal_access(check_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    check_date IS NULL
    OR public.get_archive_cutoff() IS NULL
    OR check_date >= public.get_archive_cutoff();
$$;

GRANT EXECUTE ON FUNCTION public.is_within_temporal_access(DATE) TO authenticated;
