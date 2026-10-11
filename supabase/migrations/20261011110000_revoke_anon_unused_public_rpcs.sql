-- ════════════════════════════════════════════════════════════════════════
-- Security · two more SECURITY DEFINER functions leave the anon role (C2O-103, 9 Oct 2026)
--
-- Forward fix: 20261009100000 is already applied on production (8 kept for anon), so its file stays as released and
-- the C2O-103 corrections ship here instead (Opus `73055fc` content, Tier B by Opus B):
--   * P1 fn_market_insights_subscribe(text): the public newsletter form is gone and the function inserts unbounded
--     subscriber rows (no length, rate, caller or quota bound). Re-grant only with database bounds and server-side
--     abuse controls. authenticated and service_role keep EXECUTE.
--   * P2 get_market_visibility(): its only caller is the signed-in dashboard hook (lib/portal/useMarketVisibility.ts,
--     which falls back safely). authenticated and service_role keep EXECUTE.
-- Afterwards anon may execute exactly 6 SECURITY DEFINER functions, matched by exact signature.
-- Grants only. DOWN: supabase/rollback/20261011110000_revoke_anon_unused_public_rpcs_down.sql
-- Proof: supabase/tests/security/anon_definer_allowlist.sql (A1–A7)
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

revoke execute on function public.fn_market_insights_subscribe(text) from public, anon;
revoke execute on function public.get_market_visibility() from public, anon;

-- the result must be exactly the reviewed allowlist, by exact signature (anything else is a new finding: stop here)
do $anon_allowlist$
declare v_extra text;
begin
  select string_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || ')', ', ' order by p.proname) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname || '(' || oidvectortypes(p.proargtypes) || ')' not in ('get_public_stats()', 'get_public_platform_totals()',
                           'get_latest_market_insights()', 'get_market_insights_archive()',
                           'get_market_insights_edition(text)', 'fn_is_admin()');
  if v_extra is not null then
    raise exception 'ANON_DEFINER: anon can still execute unreviewed SECURITY DEFINER functions: %', v_extra using errcode = '42501';
  end if;
end $anon_allowlist$;
