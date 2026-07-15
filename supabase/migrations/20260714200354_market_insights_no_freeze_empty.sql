-- Market Insights (issue C): never FREEZE an empty edition. The weekly cron
-- publishes+freezes a week; if it ran before that week's data was approved it
-- locked in zeros (and the freeze trigger then blocks any correction). Now the
-- edition only gets published_at when it actually has activity — otherwise it is
-- stored as a regenerable DRAFT (published_at NULL, excluded from "latest"), and
-- a later run publishes it once the week has data. Combined with the sync
-- commit's auto-approve, editions no longer freeze empty.
CREATE OR REPLACE FUNCTION public.fn_publish_market_insights_edition(
  p_from date, p_to date, p_week_id text, p_publish boolean DEFAULT true
)
RETURNS market_insights_editions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing   public.market_insights_editions;
  v_payload    jsonb;
  v_publish_at timestamptz;
  v_row        public.market_insights_editions;
BEGIN
  SELECT * INTO v_existing FROM public.market_insights_editions WHERE week_id = p_week_id;

  -- Frozen: a published week is returned untouched.
  IF v_existing.id IS NOT NULL AND v_existing.published_at IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_payload := public.fn_build_market_insights(p_from, p_to);

  -- Only stamp published_at when the week has real activity.
  v_publish_at := CASE
    WHEN p_publish AND COALESCE((v_payload->'snapshot'->>'cargoes_live')::int, 0) > 0
    THEN now()
  END;

  INSERT INTO public.market_insights_editions (week_id, range_from, range_to, payload, published_at)
  VALUES (p_week_id, p_from, p_to, v_payload, v_publish_at)
  ON CONFLICT (week_id) DO UPDATE
    SET range_from   = EXCLUDED.range_from,
        range_to     = EXCLUDED.range_to,
        payload      = EXCLUDED.payload,
        published_at = COALESCE(public.market_insights_editions.published_at, EXCLUDED.published_at)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
