-- ════════════════════════════════════════════════════════════════════════
-- Security · the public market-insights reads name their fields (C2O-103 P2-3, 9 Oct 2026)
--
-- get_latest_market_insights and get_market_insights_edition are anon-callable SECURITY DEFINER reads that returned
-- to_jsonb(row) - 'id': any column later added to market_insights_editions would have become public automatically.
-- They now return exactly the fields the public page reads (lib/market-insights.ts InsightEdition): week_id,
-- range_from, range_to, payload, narrative, published_at. created_at and updated_at are no longer exposed (no reader).
-- get_market_insights_archive already builds an explicit object and is unchanged. Bodies only: grants are untouched
-- (CREATE OR REPLACE keeps them). Independent of 20261009100000.
-- DOWN: supabase/rollback/20261011100000_market_insights_public_projection_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create or replace function public.get_latest_market_insights()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('week_id', e.week_id, 'range_from', e.range_from, 'range_to', e.range_to,
                            'payload', e.payload, 'narrative', e.narrative, 'published_at', e.published_at)
  from public.market_insights_editions e
  where e.published_at is not null
  order by e.range_to desc, e.published_at desc
  limit 1;
$function$;

create or replace function public.get_market_insights_edition(p_week_id text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('week_id', e.week_id, 'range_from', e.range_from, 'range_to', e.range_to,
                            'payload', e.payload, 'narrative', e.narrative, 'published_at', e.published_at)
  from public.market_insights_editions e
  where e.published_at is not null and e.week_id = p_week_id
  limit 1;
$function$;
