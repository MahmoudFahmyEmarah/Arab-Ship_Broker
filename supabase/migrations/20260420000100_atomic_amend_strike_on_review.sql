-- Make review_queue processing atomic for amended approvals.
-- Amendments should count as strikes without relying on a second app-layer RPC.

CREATE OR REPLACE FUNCTION public.fn_rq_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'PENDING' AND NEW.status != 'PENDING' THEN
    NEW.reviewed_at := NOW();

    IF NEW.listing_type = 'cargo' THEN
      IF NEW.status = 'APPROVED' THEN
        UPDATE public.cargo_listings
          SET review_status = 'APPROVED', goes_live_at = NOW()
          WHERE id = NEW.listing_id;

        IF NEW.action_taken = 'amended' THEN
          UPDATE public.users
            SET strike_count = strike_count + 1
            WHERE supabase_user_id = NEW.submitted_by;
        ELSE
          UPDATE public.users
            SET clean_posts = clean_posts + 1
            WHERE supabase_user_id = NEW.submitted_by;
        END IF;
      ELSIF NEW.status IN ('REJECTED','FLAGGED') THEN
        UPDATE public.cargo_listings
          SET review_status = NEW.status
          WHERE id = NEW.listing_id;

        UPDATE public.users
          SET strike_count = strike_count + 1
          WHERE supabase_user_id = NEW.submitted_by;
      END IF;

    ELSIF NEW.listing_type = 'vessel_availability' THEN
      IF NEW.status = 'APPROVED' THEN
        UPDATE public.vessel_availability
          SET review_status = 'APPROVED', goes_live_at = NOW()
          WHERE id = NEW.listing_id;

        IF NEW.action_taken = 'amended' THEN
          UPDATE public.users
            SET strike_count = strike_count + 1
            WHERE supabase_user_id = NEW.submitted_by;
        ELSE
          UPDATE public.users
            SET clean_posts = clean_posts + 1
            WHERE supabase_user_id = NEW.submitted_by;
        END IF;
      ELSIF NEW.status IN ('REJECTED','FLAGGED') THEN
        UPDATE public.vessel_availability
          SET review_status = NEW.status
          WHERE id = NEW.listing_id;

        UPDATE public.users
          SET strike_count = strike_count + 1
          WHERE supabase_user_id = NEW.submitted_by;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rq_on_review ON public.review_queue;
CREATE TRIGGER trg_rq_on_review
  BEFORE UPDATE ON public.review_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_rq_on_review();
