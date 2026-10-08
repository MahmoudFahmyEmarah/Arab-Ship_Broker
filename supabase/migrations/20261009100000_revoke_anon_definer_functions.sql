-- ════════════════════════════════════════════════════════════════════════
-- Security · anonymous callers lose SECURITY DEFINER functions they never need (9 Oct 2026)
--
-- An inventory of staging (restored from production, grants = production; 170 migrations) found 34 public-schema
-- SECURITY DEFINER functions that the anon role may execute, each by an explicit grant. Since 10 Sep new functions
-- are private by default (event trigger); these predate it.
--
-- Kept for anon (8) — public pages call them signed out, or an anon-facing policy evaluates them:
--   get_public_stats, get_public_platform_totals (home page), get_latest_market_insights,
--   get_market_insights_archive, get_market_insights_edition (public market report), get_market_visibility,
--   fn_market_insights_subscribe (newsletter sign-up), fn_is_admin (RLS policies for role public on ports,
--   safety_questions, voyage_estimates, sync_* — revoking it would make anon reads of those tables error).
--
-- Revoked from anon (26), after checking each: no policy that applies to anon/public references it, no view or
-- invoker function that anon can reach calls it, and the app calls it only from signed-in or admin code:
--   * 20 helpers and commands for signed-in members/admins (authenticated and service_role keep EXECUTE);
--   * 6 trigger/event-trigger functions: PostgreSQL checks EXECUTE on a trigger function only when the trigger is
--     created, never when it fires, so no API role needs it;
--   * plus resolve_vessel_review, aligned with production (service_role only) — see below.
--
-- Grants only: no data, no function body changes. DOWN: supabase/rollback/20261009100000_revoke_anon_definer_functions_down.sql
-- Proof: supabase/tests/security/anon_definer_allowlist.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

-- signed-in and admin helpers/commands: anon loses EXECUTE; authenticated and service_role keep it
revoke execute on function public.create_account_with_profiles(uuid, text, text, public.profile_type_enum[]) from public, anon;
revoke execute on function public.fn_app_user_id() from public, anon;
revoke execute on function public.fn_billing_bank_details() from public, anon;
revoke execute on function public.fn_build_market_insights(date, date) from public, anon;
revoke execute on function public.fn_is_org_admin(uuid) from public, anon;
revoke execute on function public.fn_market_fresh_ok(uuid, public.listing_type_enum, timestamptz, date) from public, anon;
revoke execute on function public.fn_my_admin_org_id() from public, anon;
revoke execute on function public.fn_my_billing_customer_ids() from public, anon;
revoke execute on function public.fn_my_membership() from public, anon;
revoke execute on function public.fn_my_org_ids() from public, anon;
revoke execute on function public.fn_org_manage_member(uuid, uuid, text) from public, anon;
revoke execute on function public.fn_org_seat_summary(uuid) from public, anon;
revoke execute on function public.fn_org_set_plan_seat(uuid, uuid, boolean) from public, anon;
revoke execute on function public.fn_org_team(uuid) from public, anon;
revoke execute on function public.fn_publish_market_insights_edition(date, date, text, boolean) from public, anon;
revoke execute on function public.fn_request_org_membership(uuid) from public, anon;
revoke execute on function public.fn_search_organizations(text) from public, anon;
revoke execute on function public.fn_set_market_insights_narrative(text, text) from public, anon;
revoke execute on function public.get_admin_ops_stats() from public, anon;
revoke execute on function public.is_admin() from public, anon;

-- repository/production drift: production grants resolve_vessel_review to service_role only (like its siblings
-- resolve_commodity_review and resolve_port_review), but a database rebuilt from the repository also granted it to
-- anon and authenticated — and it takes a caller-supplied p_actor. Align the repository with production (a no-op
-- there); the DOWN does not restore a grant production never had.
revoke execute on function public.resolve_vessel_review(uuid, text, uuid) from public, anon, authenticated;

-- trigger and event-trigger functions: no API role needs EXECUTE
revoke execute on function public.fn_billing_audit() from public, anon, authenticated;
revoke execute on function public.fn_cl_bind_contacts() from public, anon, authenticated;
revoke execute on function public.fn_payment_settle() from public, anon, authenticated;
revoke execute on function public.fn_va_bind_contacts() from public, anon, authenticated;
revoke execute on function public.fn_vrq_bind_contacts() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- the result must be exactly the reviewed allowlist (anything else anon can run is a new finding, so stop here)
do $anon_allowlist$
declare v_extra text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('get_public_stats', 'get_public_platform_totals', 'get_latest_market_insights',
                           'get_market_insights_archive', 'get_market_insights_edition', 'get_market_visibility',
                           'fn_market_insights_subscribe', 'fn_is_admin');
  if v_extra is not null then
    raise exception 'ANON_DEFINER: anon can still execute unreviewed SECURITY DEFINER functions: %', v_extra using errcode = '42501';
  end if;
end $anon_allowlist$;
