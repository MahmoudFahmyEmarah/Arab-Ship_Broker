-- Require an IMO for newly-created vessels while preserving legacy rows.
-- An INSERT trigger lets existing IMO-less vessels remain readable/editable.
CREATE OR REPLACE FUNCTION public.require_imo_for_new_vessel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.imo_number := NULLIF(TRIM(NEW.imo_number), '');

  IF NEW.imo_number IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'IMO number is required for new vessels';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_imo_for_new_vessel ON public.vessels;
CREATE TRIGGER require_imo_for_new_vessel
BEFORE INSERT ON public.vessels
FOR EACH ROW
EXECUTE FUNCTION public.require_imo_for_new_vessel();

REVOKE ALL ON FUNCTION public.require_imo_for_new_vessel() FROM PUBLIC;
