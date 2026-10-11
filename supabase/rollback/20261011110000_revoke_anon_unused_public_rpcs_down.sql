-- DOWN for 20261011110000_revoke_anon_unused_public_rpcs: restores exactly the two anon grants it removed
-- (the state 20261009100000 left on production).
grant execute on function public.fn_market_insights_subscribe(text) to anon;
grant execute on function public.get_market_visibility() to anon;
