-- PDA · port agency registry (20261018130000, O2ALL-009 Agents phase 1). BEGIN … ROLLBACK; run as the database owner.
--   G1  only an owner-tier admin invites and lists; a sub-admin and a member are refused (PDA_AUTH)
--   G2  validation: unknown organisation, short name, non-https website, unverified port, unknown service, uninvited agency
--   G3  members see ACTIVE agencies at ACTIVE listings only; a port filter narrows; suspend and withdraw hide; T2 refused
--   G4  a member of a listed agency sees its own listing (get_my_pda_agency); anyone else gets null
--   G5  every change is logged; the log is append-only
--   G6  grants: commands and console read service_role only; no table grant; member reads authenticated + service_role
begin;

do $$
declare
  owner uuid := gen_random_uuid();
  sub uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  staff uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  agency_org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  pol text; pod text;
  r jsonb; e text; n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaAgents1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (owner, 'pda-ag-owner@example.test'), (sub, 'pda-ag-sub@example.test'), (member, 'pda-ag-member@example.test'),
               (staff, 'pda-ag-staff@example.test'), (basic, 'pda-ag-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (owner, owner, 'pda-ag-owner@example.test', 'AG Owner', 'admin', true, null, 'T4'),
    (sub, sub, 'pda-ag-sub@example.test', 'AG Sub', 'admin', true, 'sub', 'T4'),
    (member, member, 'pda-ag-member@example.test', 'AG Member', 'cargo_owner', true, null, 'T3'),
    (staff, staff, 'pda-ag-staff@example.test', 'AG Staff', 'broker', true, null, 'T3'),
    (basic, basic, 'pda-ag-basic@example.test', 'AG Basic', 'cargo_owner', true, null, 'T2');
  insert into public.organizations (id, name) values (agency_org, 'Seaside Shipping Agency SAE'), (other_org, 'Other Org');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values (agency_org, staff, 'admin', true, 'active');
  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;

  -- G1 · who may curate
  begin perform public.pda_admin_upsert_agency(sub, agency_org, '{"displayName":"Seaside Agency"}'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'G1: a sub-admin must be refused, got %', e; end if;
  begin perform public.pda_admin_upsert_agency(member, agency_org, '{"displayName":"Seaside Agency"}'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'G1: a member must be refused, got %', e; end if;
  r := public.pda_admin_upsert_agency(owner, agency_org, jsonb_build_object('displayName', 'Seaside Agency', 'website', 'https://seaside.example'));
  if r->>'status' <> 'active' then raise exception 'G1: the owner invites: %', r; end if;
  raise notice 'G1 ok: only an owner-tier admin invites and lists agencies';

  -- G2 · validation
  begin perform public.pda_admin_upsert_agency(owner, gen_random_uuid(), '{"displayName":"Ghost"}'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AGENCY' then raise exception 'G2: an unknown organisation, got %', e; end if;
  begin perform public.pda_admin_upsert_agency(owner, other_org, '{"displayName":"X"}'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'G2: a one-letter name, got %', e; end if;
  begin perform public.pda_admin_upsert_agency(owner, other_org, '{"displayName":"Other","website":"http://plain.example"}'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'G2: a non-https website, got %', e; end if;
  begin perform public.pda_admin_set_port_agent(owner, other_org, pol, array['agency'], true); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AGENCY' then raise exception 'G2: listing an uninvited agency, got %', e; end if;
  begin perform public.pda_admin_set_port_agent(owner, agency_org, 'ZZNOP', array['agency'], true); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'G2: an unknown port, got %', e; end if;
  begin perform public.pda_admin_set_port_agent(owner, agency_org, pol, array['agency','bunkers'], true); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'G2: an unknown service, got %', e; end if;
  -- C2O-159 P1-2: an active listing names at least one service (a withdrawal may carry none)
  begin perform public.pda_admin_set_port_agent(owner, agency_org, pol, '{}'::text[], true); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'G2: an active listing without services, got %', e; end if;
  raise notice 'G2 ok: organisation, name, website, port, service and invitation are all validated';

  r := public.pda_admin_set_port_agent(owner, agency_org, lower(pol), array['agency','agency','pilotage'], true);
  if r->'services' <> '["agency", "pilotage"]'::jsonb then raise exception 'G2: services are de-duplicated and ordered: %', r; end if;
  perform public.pda_admin_set_port_agent(owner, agency_org, pod, array['agency'], true);

  -- G3 · what members see
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  r := (select x from jsonb_array_elements(public.list_pda_port_agents(null)) x where x->>'agencyId' = agency_org::text);
  if r is null or r->>'displayName' <> 'Seaside Agency' or jsonb_array_length(r->'ports') <> 2 or r ? 'organisation' or r ? 'members' then
    raise exception 'G3: the member sees the agency, its two ports and nothing internal: %', r; end if;
  r := (select x from jsonb_array_elements(public.list_pda_port_agents(pod)) x where x->>'agencyId' = agency_org::text);
  if r is null or jsonb_array_length(r->'ports') <> 1 or r->'ports'->0->>'portLocode' <> pod then
    raise exception 'G3: a port filter keeps the agency and returns only that port in its ports (C2O-159 nb 2): %', r; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.pda_admin_set_port_agent(owner, agency_org, pod, array['agency'], false);
  perform set_config('request.jwt.claim.sub', member::text, true);
  if exists (select 1 from jsonb_array_elements(public.list_pda_port_agents(pod)) x where x->>'agencyId' = agency_org::text) then
    raise exception 'G3: a withdrawn listing must disappear from that port'; end if;
  perform public.pda_admin_upsert_agency(owner, agency_org, '{"displayName":"Seaside Agency","status":"suspended"}');
  if exists (select 1 from jsonb_array_elements(public.list_pda_port_agents(null)) x where x->>'agencyId' = agency_org::text) then
    raise exception 'G3: a suspended agency must disappear'; end if;
  perform public.pda_admin_upsert_agency(owner, agency_org, '{"displayName":"Seaside Agency","status":"active","website":"https://seaside.example"}');
  perform set_config('request.jwt.claim.sub', basic::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',basic,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.list_pda_port_agents(null); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TIER' then raise exception 'G3: a T2 member must be PDA_TIER, got %', e; end if;
  raise notice 'G3 ok: members see active agencies at active listings; withdraw and suspend hide; T2 refused';

  -- G4 · an agency member sees its own listing
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  r := public.get_my_pda_agency();
  if r->>'agencyId' <> agency_org::text or jsonb_array_length(r->'ports') <> 1 or r->>'memberRole' <> 'admin' then
    raise exception 'G4: agency staff see their own listing (one active port): %', r; end if;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  if public.get_my_pda_agency() is not null then raise exception 'G4: a non-member must get null'; end if;
  -- C2O-159 P1-1: an inactive account keeps no agency view, though its seat remains; it returns on reactivation
  perform set_config('request.jwt.claim.sub', '', true);
  update public.users set is_active = false where id = staff;
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  begin r := public.get_my_pda_agency(); e := null; exception when others then e := split_part(sqlerrm, ':', 1); r := null; end;
  if r is not null then raise exception 'G4: an inactive staff account must not see the agency: %', r; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.users set is_active = true where id = staff;
  -- C2O-159 nb 1: the own listing names only active, verified ports
  update public.ports set is_verified = false where locode = pol;
  perform set_config('request.jwt.claim.sub', staff::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  r := public.get_my_pda_agency();
  if r->>'agencyId' <> agency_org::text or jsonb_array_length(r->'ports') <> 0 then
    raise exception 'G4: reactivated staff see the agency again, without the unverified port: %', r; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.ports set is_verified = true where locode = pol;
  raise notice 'G4 ok: agency staff see their own listing (active verified ports only); inactive accounts and non-members get null';

  -- G5 · log
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from public.pda_agency_events where org_id = agency_org;
  if n < 6 then raise exception 'G5: every change must be logged (got %)', n; end if;
  begin update public.pda_agency_events set action = 'port_set' where org_id = agency_org; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'G5: the log must be append-only, got %', e; end if;
  begin truncate public.pda_agency_events cascade; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'G5: TRUNCATE of the log must be refused, got %', e; end if;
  raise notice 'G5 ok: % registry changes logged; the log is append-only (TRUNCATE refused)', n;

  -- G6 · grants
  if has_function_privilege('authenticated', 'public.pda_admin_upsert_agency(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.pda_admin_set_port_agent(uuid, uuid, text, text[], boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.pda_admin_list_agencies(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.pda_admin_list_agencies(uuid)', 'execute')
     or has_function_privilege('anon', 'public.list_pda_port_agents(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_pda_agency()', 'execute')
     or exists (select 1 from unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr,
                     unnest(array['public.pda_agencies','public.pda_port_agents','public.pda_agency_events']) t
                where has_table_privilege(ro, t, pr)) then
    raise exception 'G6: grants are not as designed'; end if;
  raise notice 'G6 ok: commands and the console read are service-only; no table grant; member reads authenticated';
end $$;

do $m$ begin raise notice 'PDA AGENCIES: ALL ASSERTIONS PASSED'; end $m$;
rollback;
