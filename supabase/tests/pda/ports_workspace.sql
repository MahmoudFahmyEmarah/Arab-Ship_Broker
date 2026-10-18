-- PDA · Ports workspace read (20261018100000, O2ALL-008 increment C). BEGIN … ROLLBACK; run as the database owner.
--   W1  a member sees every active, verified port, with its verified terminals and the tariffs in force
--   W2  "prices a service" follows the estimator: the rule code, or a SINGLE requestedServices entry — never a
--       multi-service OR list; only the nine route services count; the charge-line count is exact
--   W3  edition label, publisher and source authority are shown; no internal id is returned anywhere
--   W4  a draft version and a version not yet in force on the call date are not shown
--   W5  gates: signed out → PDA_AUTH; T2 → PDA_TIER; null date → PDA_VALIDATION; anon holds no EXECUTE
begin;

do $$
declare
  maker uuid := gen_random_uuid();
  checker uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  port_code text;
  publisher uuid;
  source uuid;
  version uuid;
  future_version uuid;
  terminal uuid;
  terminal_version uuid;
  ws jsonb;
  p jsonb;
  t jsonb;
  e text;
  v_ports int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaPorts1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (maker, 'pda-ws-maker@example.test'), (checker, 'pda-ws-checker@example.test'),
               (member, 'pda-ws-member@example.test'), (basic, 'pda-ws-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (maker, maker, 'pda-ws-maker@example.test', 'WS Maker', 'admin', true, null, 'T4'),
    (checker, checker, 'pda-ws-checker@example.test', 'WS Checker', 'admin', true, null, 'T4'),
    (member, member, 'pda-ws-member@example.test', 'WS Member', 'cargo_owner', true, null, 'T3'),
    (basic, basic, 'pda-ws-basic@example.test', 'WS Basic', 'cargo_owner', true, null, 'T2');

  -- a verified port with no PUBLISHED port-wide set yet (the test adds one)
  select p2.locode into port_code from public.ports p2
   where p2.is_active and p2.is_verified
     and not exists (select 1 from public.port_tariff_sets s where s.port_locode = p2.locode and s.terminal_id is null and s.is_active)
   order by p2.locode limit 1;
  if port_code is null then raise exception 'W0: a verified port without an active port-wide tariff set is required'; end if;

  publisher := public.pda_upsert_tariff_publisher(maker, jsonb_build_object('name','WS Test Port Authority','publisherType','port_authority','country','Test'));
  source := public.pda_register_tariff_source(maker, jsonb_build_object(
    'publisherId',publisher,'title','WS Test Tariff 2026','sourceFilename','ws-test.pdf','mimeType','application/pdf',
    'sha256',repeat('c',64),'authority','official','effectiveFrom','2026-01-01','currentnessNote','Ports workspace fixture'));
  terminal := public.pda_upsert_port_terminal(maker, jsonb_build_object('portLocode',port_code,'name','WS Test Terminal'));
  perform public.pda_verify_port_terminal(checker, terminal);

  -- port-wide edition in force from 2026-01-01: port_dues (code), towage (single applicability), and one rule whose
  -- applicability is an OR list of two services (must NOT count as pricing either)
  version := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'publisherId',publisher,'name','WS Port Call','scope','port_call','versionNo',1,'currency','USD',
    'effectiveFrom','2026-01-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source));
  perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(
    jsonb_build_object('code','port_dues','label','Port dues','basis','per_call','amount',100,'priority',10,
                       'sourceId',source,'sourcePage','4','sourceExcerpt','Port dues per call'),
    jsonb_build_object('code','tug_assist','label','Tug assistance','basis','per_call','amount',300,'priority',20,
                       'applicability',jsonb_build_object('requestedServices',jsonb_build_array('towage')),
                       'sourceId',source,'sourcePage','5','sourceExcerpt','Towage per call'),
    jsonb_build_object('code','marine_bundle','label','Marine bundle','basis','per_call','amount',200,'priority',30,
                       'applicability',jsonb_build_object('requestedServices',jsonb_build_array('pilotage','mooring')),
                       'sourceId',source,'sourcePage','6','sourceExcerpt','Pilotage or mooring')));
  perform public.pda_submit_tariff_version(maker, version);
  perform public.pda_publish_tariff_version(checker, version);

  -- a terminal edition, published but in force only from 2027 (W4: not shown in 2026)
  terminal_version := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'terminalId',terminal,'publisherId',publisher,'name','WS Terminal Tariff','scope','terminal',
    'versionNo',1,'currency','USD','effectiveFrom','2027-01-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source));
  perform public.pda_replace_tariff_rules(maker, terminal_version, jsonb_build_array(
    jsonb_build_object('code','cargo_handling','label','Cargo handling','basis','per_call','amount',500,'priority',10,
                       'sourceId',source,'sourcePage','7','sourceExcerpt','Cargo handling per call')));
  perform public.pda_submit_tariff_version(maker, terminal_version);
  perform public.pda_publish_tariff_version(checker, terminal_version);

  -- a version 2 of the port-wide set, still a draft (W4: never shown)
  future_version := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'publisherId',publisher,'name','WS Port Call','scope','port_call','versionNo',2,'currency','USD',
    'effectiveFrom','2026-03-01','roundingMode','half_up','decimalPlaces',2,'primarySourceId',source));

  -- W5 · signed out
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin perform public.list_pda_ports_workspace('2026-06-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'W5: signed out must be PDA_AUTH, got %', e; end if;

  -- W5 · T2 member
  perform set_config('request.jwt.claim.sub', basic::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',basic,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.list_pda_ports_workspace('2026-06-01'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TIER' then raise exception 'W5: a T2 member must be PDA_TIER, got %', e; end if;

  -- the T3 member
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.list_pda_ports_workspace(null); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'W5: a null date must be PDA_VALIDATION, got %', e; end if;

  ws := public.list_pda_ports_workspace('2026-06-01');

  -- W1 · every active, verified port, once
  select count(*) into v_ports from public.ports where is_active and is_verified;
  if jsonb_array_length(ws->'ports') <> v_ports or ws->>'callDate' <> '2026-06-01' then
    raise exception 'W1: % verified ports expected, got % (callDate %)', v_ports, jsonb_array_length(ws->'ports'), ws->>'callDate'; end if;
  select x into p from jsonb_array_elements(ws->'ports') x where x->>'locode' = port_code;
  if p is null or not (p->'terminals') ? 'WS Test Terminal' then raise exception 'W1: the port and its verified terminal must be listed: %', p; end if;

  -- W4 · only the port-wide v1 is in force on 2026-06-01 (v2 is a draft, the terminal edition starts in 2027)
  if jsonb_array_length(p->'tariffs') <> 1 then raise exception 'W4: exactly one tariff in force expected, got %', p->'tariffs'; end if;
  t := p->'tariffs'->0;

  -- W2 · services and charge lines
  if t->'services' <> '["port_dues", "towage"]'::jsonb then
    raise exception 'W2: priced services must be [port_dues, towage] (an OR list prices nothing), got %', t->'services'; end if;
  if (t->>'ruleCount')::int <> 3 then raise exception 'W2: three charge lines expected, got %', t->>'ruleCount'; end if;

  -- W3 · what a member sees, and no internal id
  if t->>'editionLabel' is distinct from (select edition_label from public.port_tariff_versions where id = version)
     or t->>'publisherName' <> 'WS Test Port Authority' or t->>'publisherType' <> 'port_authority'
     or t->>'sourceAuthority' <> 'official' or t->>'currency' <> 'USD' or t->>'scope' <> 'port_call'
     or t->>'terminalName' is not null or t->>'effectiveFrom' <> '2026-01-01' then
    raise exception 'W3: the tariff summary is wrong: %', t; end if;
  if ws::text ~ '"[A-Za-z]*[iI]d"\s*:' then raise exception 'W3: an internal id key is exposed'; end if;
  if position(version::text in ws::text) > 0 or position(publisher::text in ws::text) > 0
     or position(source::text in ws::text) > 0 or position(terminal::text in ws::text) > 0 then
    raise exception 'W3: an internal id value is exposed'; end if;

  -- W4 · in 2027 the terminal edition is in force too, named by its terminal
  ws := public.list_pda_ports_workspace('2027-06-01');
  select x into p from jsonb_array_elements(ws->'ports') x where x->>'locode' = port_code;
  if jsonb_array_length(p->'tariffs') <> 2
     or not exists (select 1 from jsonb_array_elements(p->'tariffs') y where y->>'terminalName' = 'WS Test Terminal' and y->'services' = '["cargo_handling"]'::jsonb) then
    raise exception 'W4: in 2027 the terminal edition must be listed: %', p->'tariffs'; end if;
  -- …and before 2026 nothing is in force
  ws := public.list_pda_ports_workspace('2025-06-01');
  select x into p from jsonb_array_elements(ws->'ports') x where x->>'locode' = port_code;
  if jsonb_array_length(p->'tariffs') <> 0 then raise exception 'W4: nothing is in force before 2026: %', p->'tariffs'; end if;

  -- W5 · grants
  if has_function_privilege('anon', 'public.list_pda_ports_workspace(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_pda_ports_workspace(date)', 'execute')
     or not has_function_privilege('service_role', 'public.list_pda_ports_workspace(date)', 'execute') then
    raise exception 'W5: grants must be authenticated + service_role only'; end if;

  raise notice 'W1–W5 ok: every verified port, terminals, tariffs in force by date, estimator-exact service coverage, no internal id, gated';
end $$;

do $m$ begin raise notice 'PDA PORTS WORKSPACE: ALL ASSERTIONS PASSED'; end $m$;
rollback;
