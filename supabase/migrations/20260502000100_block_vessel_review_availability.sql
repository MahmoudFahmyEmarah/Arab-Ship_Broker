CREATE OR REPLACE FUNCTION public.create_vessel_availability(
  payload jsonb
) RETURNS public.vessel_availability
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec              public.vessel_availability;
  v_user_id          uuid := auth.uid();
  v_vessel_id        uuid := (payload->>'vessel_id')::uuid;
  v_sanctioned       boolean;
  v_review_status    text;
  v_risk             public.risk_level_enum;
  v_tier             public.trust_tier_enum;
  v_random           boolean;
BEGIN
  SELECT is_sanctioned, risk_level, vessel_review_status 
    INTO v_sanctioned, v_risk, v_review_status
  FROM public.vessels 
  WHERE id = v_vessel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel not found: %', v_vessel_id;
  END IF;

  IF v_sanctioned THEN
    RAISE EXCEPTION 'This vessel is sanctioned and cannot have availability posted.';
  END IF;

  IF v_review_status = 'IN_REVIEW' THEN
    RAISE EXCEPTION 'This vessel is under review and cannot have new positions posted at this time. Please contact Arab ShipBroker.';
  END IF;

  INSERT INTO public.vessel_availability (
    vessel_id,
    open_port_locode,
    ballast_port_locode,
    open_date,
    open_date_range_days,
    last_cargo,
    service_speed_kn,
    me_consumption_mt_day,
    me_consumption_port_mt_day,
    aux_consumption_mt_day,
    aux_consumption_port_mt_day,
    fuel_type,
    freight_idea_usd_mt,
    accepts_part_cargo,
    notes
  ) VALUES (
    v_vessel_id,
    payload->>'open_port_locode',
    NULLIF(payload->>'ballast_port_locode', ''),
    (payload->>'open_date')::date,
    COALESCE((payload->>'open_date_range_days')::smallint, 7),
    payload->>'last_cargo',
    (payload->>'service_speed_kn')::numeric,
    (payload->>'me_consumption_mt_day')::numeric,
    (payload->>'me_consumption_port_mt_day')::numeric,
    (payload->>'aux_consumption_mt_day')::numeric,
    (payload->>'aux_consumption_port_mt_day')::numeric,
    NULLIF(payload->>'fuel_type', ''),
    (payload->>'freight_idea_usd_mt')::numeric,
    COALESCE((payload->>'accepts_part_cargo')::boolean, false),
    payload->>'notes'
  )
  RETURNING * INTO v_rec;

  INSERT INTO public.listing_ownership (
    listing_type, listing_id, owner_user_id, role, transfer_reason
  ) VALUES (
    'vessel_availability', v_rec.id, v_user_id, 'primary', 'initial_post'
  );

  SELECT trust_tier INTO v_tier FROM public.users WHERE supabase_user_id = v_user_id;
  v_random := (RANDOM() < 0.1);

  IF v_risk = 'HIGH' OR v_tier != 'VERIFIED' OR v_random THEN
    INSERT INTO public.review_queue (
      listing_type, listing_id, submitted_by,
      trust_tier_at_submit, is_random_sample, review_reason
    ) VALUES (
      'vessel_availability', v_rec.id, v_user_id, v_tier, v_random,
      CASE
        WHEN v_risk = 'HIGH'    THEN 'HIGH risk vessel'
        WHEN v_tier = 'FLAGGED' THEN 'Flagged account'
        WHEN v_random            THEN 'Random sample check'
        ELSE                          'New user'
      END
    );
  ELSE
    UPDATE public.vessel_availability
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = v_rec.id;
    SELECT * INTO v_rec FROM public.vessel_availability WHERE id = v_rec.id;
  END IF;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_vessel_availability(jsonb) TO authenticated;
