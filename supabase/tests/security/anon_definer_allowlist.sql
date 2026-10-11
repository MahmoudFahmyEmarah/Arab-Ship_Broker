-- Security · SECURITY DEFINER functions anon may execute (20261009100000 + 20261011110000, C2O-103). BEGIN … ROLLBACK; run as the owner.
--   A1  anon can execute exactly the reviewed allowlist (6, by exact signature), nothing else
--   A2  every retained function really runs as anon; anon still reads ports (policies evaluate fn_is_admin)
--   A3  anon holds none of the 29 revoked functions (exact signatures); an anonymous admin call is refused
--   A4  authenticated keeps all 22 member/admin helpers; service_role keeps them too
--   A5  resolve_vessel_review is service_role only (no PUBLIC, anon or authenticated)
--   A6  trigger functions: no API role holds them, their triggers stay enabled, the event trigger stays enabled
--   A7  (when 20261011100000 is applied) the public insight reads return exactly the six named fields
begin;

create temp table acl_retained(sig text primary key) on commit drop;
insert into acl_retained values
  ('fn_is_admin()'), ('get_latest_market_insights()'), ('get_market_insights_archive()'),
  ('get_market_insights_edition(text)'), ('get_public_platform_totals()'), ('get_public_stats()');

create temp table acl_member(sig text primary key) on commit drop;
insert into acl_member values
  ('create_account_with_profiles(uuid, text, text, profile_type_enum[])'), ('fn_app_user_id()'),
  ('fn_billing_bank_details()'), ('fn_build_market_insights(date, date)'), ('fn_is_org_admin(uuid)'),
  ('fn_market_fresh_ok(uuid, listing_type_enum, timestamp with time zone, date)'), ('fn_my_admin_org_id()'),
  ('fn_my_billing_customer_ids()'), ('fn_my_membership()'), ('fn_my_org_ids()'),
  ('fn_org_manage_member(uuid, uuid, text)'), ('fn_org_seat_summary(uuid)'), ('fn_org_set_plan_seat(uuid, uuid, boolean)'),
  ('fn_org_team(uuid)'), ('fn_publish_market_insights_edition(date, date, text, boolean)'),
  ('fn_request_org_membership(uuid)'), ('fn_search_organizations(text)'), ('fn_set_market_insights_narrative(text, text)'),
  ('get_admin_ops_stats()'), ('is_admin()'), ('fn_market_insights_subscribe(text)'), ('get_market_visibility()');

create temp table acl_trigger(sig text primary key) on commit drop;
insert into acl_trigger values
  ('fn_billing_audit()'), ('fn_cl_bind_contacts()'), ('fn_payment_settle()'), ('fn_va_bind_contacts()'),
  ('fn_vrq_bind_contacts()'), ('rls_auto_enable()');

create temp view acl_fn as
  select p.oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f';
grant select on acl_retained, acl_member, acl_trigger, acl_fn to anon, authenticated;

do $a1$
declare v_set text; v_missing text;
begin
  select string_agg(f.sig, ', ' order by f.sig) into v_set
    from acl_fn f join pg_proc p on p.oid = f.oid
   where p.prosecdef and has_function_privilege('anon', f.oid, 'execute');
  if v_set is distinct from (select string_agg(sig, ', ' order by sig) from acl_retained) then
    raise exception 'A1: anon-executable SECURITY DEFINER set is %', v_set;
  end if;
  -- every reviewed signature must exist (a renamed or re-typed function is a finding, not a silent pass)
  select string_agg(l.sig, ', ') into v_missing
    from (select sig from acl_retained union all select sig from acl_member union all select sig from acl_trigger
          union all select 'resolve_vessel_review(uuid, text, uuid)') l
   where not exists (select 1 from acl_fn f where f.sig = l.sig);
  if v_missing is not null then raise exception 'A1: reviewed signatures not found: %', v_missing; end if;
  raise notice 'A1 ok: anon can execute exactly the 6 reviewed SECURITY DEFINER functions (exact signatures)';
end $a1$;

set local role anon;
select count(*) >= 0 as a2_ports from public.ports;
select public.get_public_stats() is not null as a2_stats;
select public.get_public_platform_totals() is not null as a2_totals;
select public.get_market_insights_archive() is not null as a2_archive;
select public.get_latest_market_insights() is null or true as a2_latest;
select public.get_market_insights_edition('1900-W01') is null as a2_edition;
select public.fn_is_admin() = false as a2_is_admin;
reset role;
do $a2$ begin raise notice 'A2 ok: all 6 retained functions run as anon; anon still reads ports'; end $a2$;

do $a3$
declare v_bad text;
begin
  select string_agg(f.sig, ', ') into v_bad from acl_fn f
   where f.sig in (select sig from acl_member union all select sig from acl_trigger union all select 'resolve_vessel_review(uuid, text, uuid)')
     and has_function_privilege('anon', f.oid, 'execute');
  if v_bad is not null then raise exception 'A3: anon still executes revoked functions: %', v_bad; end if;
  raise notice 'A3 ok: anon holds none of the 29 revoked functions';
end $a3$;

set local role anon;
do $a3b$
begin
  begin
    perform public.get_admin_ops_stats();
    raise exception 'A3: anon executed get_admin_ops_stats';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fn_market_insights_subscribe('probe@example.test');
    raise exception 'A3: anon executed fn_market_insights_subscribe';
  exception when insufficient_privilege then null;
  end;
  raise notice 'A3b ok: anonymous calls of an admin RPC and of the subscribe writer are refused';
end $a3b$;
reset role;

do $a4$
declare v_bad text;
begin
  select string_agg(f.sig, ', ') into v_bad from acl_fn f
   where f.sig in (select sig from acl_member)
     and not (has_function_privilege('authenticated', f.oid, 'execute') and has_function_privilege('service_role', f.oid, 'execute'));
  if v_bad is not null then raise exception 'A4: authenticated/service_role lost: %', v_bad; end if;
  raise notice 'A4 ok: authenticated and service_role keep all 22 member/admin helpers';
end $a4$;

do $a5$
declare v_oid oid := 'public.resolve_vessel_review(uuid, text, uuid)'::regprocedure;
begin
  if has_function_privilege('anon', v_oid, 'execute') or has_function_privilege('authenticated', v_oid, 'execute')
     or not has_function_privilege('service_role', v_oid, 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = v_oid and a.grantee = 0) then
    raise exception 'A5: resolve_vessel_review must be service_role only';
  end if;
  raise notice 'A5 ok: resolve_vessel_review is service_role only (no PUBLIC, anon or authenticated)';
end $a5$;

do $a6$
declare v_bad text;
begin
  select string_agg(f.sig, ', ') into v_bad from acl_fn f
   where f.sig in (select sig from acl_trigger)
     and (has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute'));
  if v_bad is not null then raise exception 'A6: an API role still holds a trigger function: %', v_bad; end if;
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
              where p.proname in ('fn_billing_audit', 'fn_cl_bind_contacts', 'fn_payment_settle', 'fn_va_bind_contacts', 'fn_vrq_bind_contacts')
                and t.tgenabled = 'D') then
    raise exception 'A6: a trigger using a revoked function is disabled';
  end if;
  if exists (select 1 from pg_event_trigger e where e.evtfoid = 'public.rls_auto_enable()'::regprocedure and e.evtenabled = 'D') then
    raise exception 'A6: the rls_auto_enable event trigger is disabled';
  end if;
  raise notice 'A6 ok: no API role holds a trigger function; % trigger(s) and % event trigger(s) on them stay enabled',
    (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where p.proname in ('fn_billing_audit', 'fn_cl_bind_contacts', 'fn_payment_settle', 'fn_va_bind_contacts', 'fn_vrq_bind_contacts')),
    (select count(*) from pg_event_trigger e where e.evtfoid = 'public.rls_auto_enable()'::regprocedure);
end $a6$;

do $a7$
declare v jsonb; v_keys text;
begin
  if (select prosrc from pg_proc where oid = 'public.get_latest_market_insights()'::regprocedure) like '%to_jsonb(e)%' then
    raise notice 'A7 skipped: 20261011100000 (explicit projection) is not applied here';
    return;
  end if;
  insert into public.market_insights_editions (week_id, range_from, range_to, payload, narrative, published_at)
  values ('2999-W01', date '2999-01-01', date '2999-01-07', '{}'::jsonb, 'probe', now());
  foreach v in array array[public.get_latest_market_insights(), public.get_market_insights_edition('2999-W01')] loop
    select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(v) k;
    if v->>'week_id' <> '2999-W01' or v_keys <> 'narrative,payload,published_at,range_from,range_to,week_id' then
      raise exception 'A7: a public insight read returned %', v_keys;
    end if;
  end loop;
  raise notice 'A7 ok: the public insight reads return exactly week_id, range_from, range_to, payload, narrative, published_at';
end $a7$;

do $done$ begin raise notice 'ANON DEFINER ALLOWLIST: ALL ASSERTIONS PASSED'; end $done$;
rollback;
