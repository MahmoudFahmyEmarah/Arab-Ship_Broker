-- DOWN for 20261011100000: restores the PRODUCTION bodies of the two public insight reads exactly.
-- On production (and staging, restored from it) both bodies were stored with CRLF line endings
-- (pg_get_functiondef md5 eebc82e7… and 92fcbe82…); without the CRs they equal the repository baseline
-- (to_jsonb(row) - 'id'). The bodies below are written with LF and converted to CRLF in SQL, so the restore
-- is byte-exact whatever line endings this file has. Bodies only; CREATE OR REPLACE keeps the grants.
set local lock_timeout = '5s';

do $down$ begin
  execute 'CREATE OR REPLACE FUNCTION public.get_latest_market_insights() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''public'' AS $function$'
    || replace($b$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL
  ORDER BY e.range_to DESC, e.published_at DESC
  LIMIT 1;
$b$, E'\n', E'\r\n')
    || '$function$';
end $down$;

do $down$ begin
  execute 'CREATE OR REPLACE FUNCTION public.get_market_insights_edition(p_week_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''public'' AS $function$'
    || replace($b$
  SELECT to_jsonb(e) - 'id'
  FROM public.market_insights_editions e
  WHERE e.published_at IS NOT NULL AND e.week_id = p_week_id
  LIMIT 1;
$b$, E'\n', E'\r\n')
    || '$function$';
end $down$;
