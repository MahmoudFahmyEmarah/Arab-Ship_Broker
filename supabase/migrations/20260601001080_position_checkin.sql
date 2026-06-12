-- ════════════════════════════════════════════════════════════════════
-- Vessel position check-in (Pre_Final §13) · append-only · firewall-safe
--
-- Backs the routine check-in popup: the vessel persona confirms (one tap) or
-- updates (4 fields) the position on file. Confirm AND update both stamp
-- position_confirmed_at — the owner's confirmation is the trust signal, AIS
-- may prefill later but never replaces it.
--
-- fn_position_checkin is SECURITY DEFINER and verifies the caller actually
-- owns the availability (current primary listing_ownership, the prod
-- ownership model, with the org-membership extension) or is an admin; it
-- updates ONLY the position fields, nothing else.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS eta_port_locode        TEXT,
  ADD COLUMN IF NOT EXISTS eta_date               DATE,
  ADD COLUMN IF NOT EXISTS eta_time               TIME,
  ADD COLUMN IF NOT EXISTS position_confirmed_at  TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.fn_position_checkin(
  p_availability_id uuid,
  p_eta_port_locode text DEFAULT NULL,
  p_eta_date        date DEFAULT NULL,
  p_eta_time        time DEFAULT NULL,
  p_open_date       date DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owned boolean;
  v_now   timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.listing_ownership lo
    WHERE lo.listing_id = p_availability_id
      AND lo.listing_type = 'vessel_availability'
      AND lo.is_current = true
      AND lo.role = 'primary'
      AND (
        lo.owner_user_id = auth.uid()
        OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
      )
  ) INTO v_owned;

  IF NOT (v_owned OR public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Not the owner of this position';
  END IF;

  -- Confirm path: no ETA args → just stamp freshness.
  -- Update path: write the supplied fields, then stamp.
  UPDATE public.vessel_availability
  SET eta_port_locode       = COALESCE(p_eta_port_locode, eta_port_locode),
      eta_date              = COALESCE(p_eta_date, eta_date),
      eta_time              = COALESCE(p_eta_time, eta_time),
      open_date             = COALESCE(p_open_date, open_date),
      position_confirmed_at = v_now
  WHERE id = p_availability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  RETURN v_now;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_position_checkin(uuid, text, date, time, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_position_checkin(uuid, text, date, time, date) TO authenticated;

-- Surface the freshness to readers (cards/map "confirmed Nd ago" signal).
GRANT SELECT (eta_port_locode, eta_date, eta_time, position_confirmed_at)
  ON public.vessel_availability TO authenticated;
