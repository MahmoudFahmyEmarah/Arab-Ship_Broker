-- DOWN for 20261009100000: restores exactly the grants it removed (explicit anon grants, as before; the trigger
-- functions' anon and authenticated grants too). Grants only; safe to run at any time.
set local lock_timeout = '5s';

grant execute on function public.create_account_with_profiles(uuid, text, text, public.profile_type_enum[]) to anon;
grant execute on function public.fn_app_user_id() to anon;
grant execute on function public.fn_billing_bank_details() to anon;
grant execute on function public.fn_build_market_insights(date, date) to anon;
grant execute on function public.fn_is_org_admin(uuid) to anon;
grant execute on function public.fn_market_fresh_ok(uuid, public.listing_type_enum, timestamptz, date) to anon;
grant execute on function public.fn_my_admin_org_id() to anon;
grant execute on function public.fn_my_billing_customer_ids() to anon;
grant execute on function public.fn_my_membership() to anon;
grant execute on function public.fn_my_org_ids() to anon;
grant execute on function public.fn_org_manage_member(uuid, uuid, text) to anon;
grant execute on function public.fn_org_seat_summary(uuid) to anon;
grant execute on function public.fn_org_set_plan_seat(uuid, uuid, boolean) to anon;
grant execute on function public.fn_org_team(uuid) to anon;
grant execute on function public.fn_publish_market_insights_edition(date, date, text, boolean) to anon;
grant execute on function public.fn_request_org_membership(uuid) to anon;
grant execute on function public.fn_search_organizations(text) to anon;
grant execute on function public.fn_set_market_insights_narrative(text, text) to anon;
grant execute on function public.get_admin_ops_stats() to anon;
grant execute on function public.is_admin() to anon;

grant execute on function public.fn_billing_audit() to anon, authenticated;
grant execute on function public.fn_cl_bind_contacts() to anon, authenticated;
grant execute on function public.fn_payment_settle() to anon, authenticated;
grant execute on function public.fn_va_bind_contacts() to anon, authenticated;
grant execute on function public.fn_vrq_bind_contacts() to anon, authenticated;
grant execute on function public.rls_auto_enable() to anon, authenticated;
