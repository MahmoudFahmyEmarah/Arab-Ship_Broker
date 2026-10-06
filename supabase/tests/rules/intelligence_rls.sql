-- Transactional Stream R Intelligence RLS/ACL/member-response proof.
begin;

do $rls$
declare
  v_table text;
  v_member uuid := gen_random_uuid();
  v_member_auth uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_inactive_auth uuid := gen_random_uuid();
  v_unmapped_auth uuid := gen_random_uuid();
  v_out jsonb;
  v_denied boolean;
begin
  foreach v_table in array array[
    'intelligence_rule_field_catalogue','intelligence_rule_sets','intelligence_rule_groups',
    'intelligence_rules','intelligence_rule_provenance','intelligence_rule_state',
    'intelligence_rule_requests','intelligence_rule_events'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relrowsecurity
    ) then raise exception 'INTELLIGENCE RLS: % missing or RLS disabled', v_table; end if;
    if has_table_privilege('authenticated',format('public.%I',v_table),'select,insert,update,delete')
       or has_table_privilege('service_role',format('public.%I',v_table),'select,insert,update,delete') then
      raise exception 'INTELLIGENCE RLS: direct table privilege leaked on %', v_table;
    end if;
  end loop;

  if not has_function_privilege('authenticated','public.get_intelligence_rules()','execute') then
    raise exception 'INTELLIGENCE RLS: authenticated active-read grant missing';
  end if;
  if has_function_privilege('anon','public.get_intelligence_rules()','execute') then
    raise exception 'INTELLIGENCE RLS: anonymous active-read grant leaked';
  end if;
  if has_function_privilege('authenticated','public.admin_intelligence_create_rule_set(uuid,jsonb,jsonb,text,text,uuid,uuid)','execute')
     or has_function_privilege('authenticated','public.admin_intelligence_activate_rule_set(uuid,uuid,bigint,uuid,text)','execute')
     or has_function_privilege('authenticated','public.admin_intelligence_get_rule_set(uuid,uuid)','execute') then
    raise exception 'INTELLIGENCE RLS: administration RPC leaked to authenticated';
  end if;
  if not has_function_privilege('service_role','public.admin_intelligence_create_rule_set(uuid,jsonb,jsonb,text,text,uuid,uuid)','execute')
     or not has_function_privilege('service_role','public.admin_intelligence_activate_rule_set(uuid,uuid,bigint,uuid,text)','execute') then
    raise exception 'INTELLIGENCE RLS: service-role administration grant missing';
  end if;
  if has_function_privilege('service_role','public.fn_intelligence_rule_set_document(uuid)','execute')
     or has_function_privilege('authenticated','public.fn_intelligence_rule_set_document(uuid)','execute')
     or has_function_privilege('authenticated','public.fn_intelligence_jsonb_integer_between(jsonb,integer,integer)','execute')
     or has_function_privilege('authenticated','public.fn_intelligence_effective_document(uuid)','execute') then
    raise exception 'INTELLIGENCE RLS: internal document helper is executable';
  end if;

  insert into auth.users(id,email)
  values
    (v_member, 'intel-rls-'||v_member||'@example.test'),
    (v_inactive, 'intel-rls-inactive-'||v_inactive||'@example.test');

  insert into public.users(id,supabase_user_id,email,full_name,role,is_active,subscription_tier)
  values
    (v_member,v_member_auth,'intel-rls-'||v_member||'@example.test','Intelligence RLS Member','member',true,'T3'),
    (v_inactive,v_inactive_auth,'intel-rls-inactive-'||v_inactive||'@example.test','Inactive Intelligence Member','member',false,'T3');
  perform set_config('request.jwt.claim.sub',v_member_auth::text,true);
  perform set_config('request.jwt.claims',json_build_object(
    'sub',v_member_auth,'role','authenticated','app_metadata',json_build_object('role','member')
  )::text,true);
  execute 'set local role authenticated';

  v_out := public.get_intelligence_rules();
  if v_out is null or v_out->'document' is null or jsonb_array_length(v_out->'document'->'rules') <> 9 then
    raise exception 'INTELLIGENCE RLS: member active read is incomplete';
  end if;
  if exists (select 1 from jsonb_array_elements(v_out->'document'->'rules') r
      where not (r->>'active')::boolean or r->>'code'='R-010')
     or exists (select 1 from jsonb_array_elements(v_out->'document'->'groups') g
      where not (g->>'active')::boolean or g->>'scope'='framework') then
    raise exception 'INTELLIGENCE RLS: inactive rules/framework placeholders leaked in member response';
  end if;
  if coalesce(v_out->>'effectiveContentHash','') !~ '^[a-f0-9]{64}$'
     or coalesce(v_out->>'ruleSetContentHash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'INTELLIGENCE RLS: member response hashes are missing';
  end if;
  if v_out::text ilike '%provenance%'
     or v_out::text ilike '%originalMessage%'
     or v_out::text ilike '%sourceRef%'
     or v_out::text ilike '%createdBy%'
     or v_out::text ilike '%changeNote%'
     or v_out::text ilike '%auto-fill 0.5%'
     or v_out::text ilike '%below-market%'
     or v_out::text ilike '%above-average%' then
    raise exception 'INTELLIGENCE RLS: private/internal wording leaked in active response';
  end if;

  v_denied := false;
  begin execute 'select 1 from public.intelligence_rules limit 1';
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'INTELLIGENCE RLS: member selected private rules table'; end if;
  v_denied := false;
  begin perform public.admin_intelligence_list_rule_sets(v_member);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'INTELLIGENCE RLS: member executed admin history RPC'; end if;

  execute 'reset role';
  if public.fn_intelligence_sha256(v_out->'document') <> v_out->>'effectiveContentHash' then
    raise exception 'INTELLIGENCE RLS: effective member document hash mismatch';
  end if;

  perform set_config('request.jwt.claim.sub',v_inactive_auth::text,true);
  perform set_config('request.jwt.claims',json_build_object(
    'sub',v_inactive_auth,'role','authenticated','app_metadata',json_build_object('role','member')
  )::text,true);
  execute 'set local role authenticated';
  v_denied := false;
  begin perform public.get_intelligence_rules();
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'INTELLIGENCE RLS: inactive member read active rules'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',v_unmapped_auth::text,true);
  perform set_config('request.jwt.claims',json_build_object(
    'sub',v_unmapped_auth,'role','authenticated','app_metadata',json_build_object('role','member')
  )::text,true);
  execute 'set local role authenticated';
  v_denied := false;
  begin perform public.get_intelligence_rules();
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'INTELLIGENCE RLS: unmapped auth identity read active rules'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
end;
$rls$;

do $marker$ begin
  raise notice 'INTELLIGENCE RLS: ALL ASSERTIONS PASSED';
end $marker$;
rollback;
