-- Security · SECURITY DEFINER functions anon may execute (20261009100000). BEGIN … ROLLBACK; run as the owner.
--   A1  anon can execute exactly the reviewed allowlist (8), nothing else
--   A2  anon still reads what the public site reads (ports via policies that evaluate fn_is_admin; public stats)
--   A3  anon is refused an admin RPC; a signed-in member keeps the member helpers; service_role keeps the admin RPC
--   A4  the triggers that use the revoked trigger functions stay enabled (EXECUTE is checked only at CREATE TRIGGER)
begin;

do $a1$
declare v_set text;
begin
  select string_agg(p.proname, ',' order by p.proname) into v_set
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if v_set is distinct from 'fn_is_admin,fn_market_insights_subscribe,get_latest_market_insights,get_market_insights_archive,get_market_insights_edition,get_market_visibility,get_public_platform_totals,get_public_stats' then
    raise exception 'A1: anon-executable SECURITY DEFINER set is %', v_set;
  end if;
  raise notice 'A1 ok: anon can execute exactly the 8 reviewed SECURITY DEFINER functions';
end $a1$;

set local role anon;
select count(*) >= 0 as a2_ports from public.ports;
select public.get_public_stats() is not null as a2_stats;
reset role;
do $a2$ begin raise notice 'A2 ok: anon still reads ports (policies evaluate fn_is_admin) and the public stats'; end $a2$;

do $a3$
begin
  if has_function_privilege('anon', 'public.get_admin_ops_stats()', 'execute')
     or has_function_privilege('anon', 'public.fn_org_manage_member(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.fn_my_membership()', 'execute')
     or has_function_privilege('anon', 'public.resolve_vessel_review(uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.resolve_vessel_review(uuid, text, uuid)', 'execute') then
    raise exception 'A3: anon must not execute admin or member commands';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_my_membership()', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_app_user_id()', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_my_org_ids()', 'execute')
     or not has_function_privilege('service_role', 'public.get_admin_ops_stats()', 'execute')
     or not has_function_privilege('service_role', 'public.fn_publish_market_insights_edition(date, date, text, boolean)', 'execute') then
    raise exception 'A3: members and service_role must keep their functions';
  end if;
  raise notice 'A3 ok: anon refused admin/member commands; authenticated and service_role keep theirs';
end $a3$;

set local role anon;
do $a3b$
begin
  begin
    perform public.get_admin_ops_stats();
    raise exception 'A3: anon executed get_admin_ops_stats';
  exception when insufficient_privilege then null;
  end;
  raise notice 'A3b ok: an anonymous call of an admin RPC is refused with insufficient_privilege';
end $a3b$;
reset role;

do $a4$
begin
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
              where p.proname in ('fn_billing_audit', 'fn_cl_bind_contacts', 'fn_payment_settle', 'fn_va_bind_contacts', 'fn_vrq_bind_contacts')
                and t.tgenabled = 'D') then
    raise exception 'A4: a trigger using a revoked function is disabled';
  end if;
  raise notice 'A4 ok: the triggers that use the revoked functions remain enabled (EXECUTE is checked only at CREATE TRIGGER)';
end $a4$;

do $done$ begin raise notice 'ANON DEFINER ALLOWLIST: ALL ASSERTIONS PASSED'; end $done$;
rollback;
