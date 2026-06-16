CREATE OR REPLACE FUNCTION public.admin_amend_user_counters(
  p_user_id UUID  -- auth.users(id) = supabase_user_id
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins may call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.users
  SET
    -- Undo the clean_posts +1 the trigger just applied for APPROVED
    clean_posts  = GREATEST(0, clean_posts - 1),
    -- Apply the amendment strike
    strike_count = strike_count + 1
  WHERE supabase_user_id = p_user_id;

  -- The fn_users_auto_upgrade trigger will fire automatically
  -- and downgrade VERIFIED → FLAGGED if strike_count reaches 2.
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_amend_user_counters(uuid) TO authenticated;


-- ── Vessel availability admin SELECT grant ────────────────────
-- Admins need to see ALL vessel_availability records regardless of
-- review_status (the existing "Admins full access availability" policy
-- covers ALL for authenticated, but let's be explicit).

DROP POLICY IF EXISTS "Admins full access availability" ON public.vessel_availability;
CREATE POLICY "Admins full access availability"
  ON public.vessel_availability FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());