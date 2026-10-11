-- DOWN for 20261011100000: restores the baseline bodies (to_jsonb(row) - 'id'). Bodies only; safe at any time.
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_latest_market_insights()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL
  ORDER BY e.range_to DESC, e.published_at DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_market_insights_edition(p_week_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL AND e.week_id = p_week_id
  LIMIT 1;
$function$;
