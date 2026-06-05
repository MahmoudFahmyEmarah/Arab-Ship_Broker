-- Fix cargo_safety_answers writeback type mismatch.
-- Previous implementation mixed BOOLEAN/NUMERIC/TEXT in a single CASE expression,
-- which causes PostgreSQL error: "CASE types text and boolean cannot be matched".

CREATE OR REPLACE FUNCTION public.fn_csa_matchmaking_writeback()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_col TEXT;
  v_answer TEXT;
  v_bool BOOLEAN;
  v_age SMALLINT;
  v_num NUMERIC;
BEGIN
  SELECT matchmaking_column
    INTO v_col
  FROM public.safety_questions
  WHERE question_key = NEW.question_key
    AND is_matchmaking_field = TRUE;

  IF v_col IS NULL THEN
    RETURN NEW;
  END IF;

  v_answer := NULLIF(BTRIM(NEW.answer_value), '');

  IF v_col = 'requires_geared' THEN
    IF v_answer IS NULL THEN
      v_bool := NULL;
    ELSIF LOWER(v_answer) IN ('true', '1', 'yes') THEN
      v_bool := TRUE;
    ELSIF LOWER(v_answer) IN ('false', '0', 'no') THEN
      v_bool := FALSE;
    ELSE
      v_bool := NULL;
    END IF;

    UPDATE public.cargo_listings
       SET requires_geared = v_bool
     WHERE id = NEW.cargo_listing_id;

  ELSIF v_col = 'max_vessel_age_yr' THEN
    IF v_answer ~ '^-?[0-9]+$' THEN
      v_age := v_answer::SMALLINT;
    ELSE
      v_age := NULL;
    END IF;

    UPDATE public.cargo_listings
       SET max_vessel_age_yr = v_age
     WHERE id = NEW.cargo_listing_id;

  ELSIF v_col = 'max_loa_m' THEN
    IF v_answer ~ '^[-+]?[0-9]*\.?[0-9]+$' THEN
      v_num := v_answer::NUMERIC;
    ELSE
      v_num := NULL;
    END IF;

    UPDATE public.cargo_listings
       SET max_loa_m = v_num
     WHERE id = NEW.cargo_listing_id;

  ELSIF v_col = 'max_draft_m' THEN
    IF v_answer ~ '^[-+]?[0-9]*\.?[0-9]+$' THEN
      v_num := v_answer::NUMERIC;
    ELSE
      v_num := NULL;
    END IF;

    UPDATE public.cargo_listings
       SET max_draft_m = v_num
     WHERE id = NEW.cargo_listing_id;

  ELSE
    -- Fallback for any future text-like matchmaking fields.
    EXECUTE format(
      'UPDATE public.cargo_listings SET %I = $1 WHERE id = $2',
      v_col
    ) USING v_answer, NEW.cargo_listing_id;
  END IF;

  RETURN NEW;
END;
$$;
