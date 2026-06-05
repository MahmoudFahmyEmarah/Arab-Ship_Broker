-- ============================================================
-- ARAB SHIPBROKER — Persist the owner's circulation choice
-- Date: 2026-06-01
--
-- The Post Cargo / Post Position flows let an owner choose "In circulation"
-- (visible to the market) vs "Private to Arab ShipBroker" (worked privately).
-- for_circulation already exists (migration ...000100) and defaults TRUE, and
-- the browse policies already honour it — but nothing persisted the owner's
-- choice. This small, ownership-checked RPC closes that, without rewriting the
-- large create_* insert functions.
--
-- It NEVER affects contact visibility — contact stays admin/owner-only via the
-- firewall regardless. for_circulation only controls whether the (non-contact)
-- particulars are broadcast to the other side of the market.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_listing_circulation(
  p_type  text,
  p_id    uuid,
  p_value boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  IF p_type NOT IN ('cargo', 'vessel_availability') THEN
    RAISE EXCEPTION 'Invalid listing type: %', p_type;
  END IF;

  -- Caller must be the current primary owner of the listing.
  SELECT EXISTS (
    SELECT 1 FROM public.listing_ownership lo
    WHERE lo.listing_id     = p_id
      AND lo.listing_type   = p_type
      AND lo.owner_user_id  = auth.uid()
      AND lo.is_current     = TRUE
      AND lo.role           = 'primary'
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Not authorized to change circulation for this listing';
  END IF;

  IF p_type = 'cargo' THEN
    UPDATE public.cargo_listings
       SET for_circulation = p_value
     WHERE id = p_id;
  ELSE
    UPDATE public.vessel_availability
       SET for_circulation = p_value
     WHERE id = p_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_listing_circulation(text, uuid, boolean) TO authenticated;
