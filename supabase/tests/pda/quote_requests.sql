-- PDA · quote requests answered by agencies (20261019100000, O2ALL-009 phase 2). BEGIN … ROLLBACK; run as the owner.
--   Q1  a request from a saved set carries a MASKED snapshot (no vessel name, IMO, ids or member); reveal adds the company only
--   Q2  only agencies listed at that port, only the latest set, only the member who SAVED the set (not a colleague); services validated
--   Q3  each agency's staff see only the requests addressed to their agency; a non-staff member sees none
--   Q4  agency staff quote: total computed, revisions append, invalid lines refused, a non-addressed agency refused
--   Q5  a decline needs a reason; the requester sees every agency's answer
--   Q6  only the requester withdraws; nobody quotes a withdrawn request
--   Q7  quotes are never edited or deleted; a request only moves open → withdrawn
--   Q8  notifications reach the agency staff on a request and the requester on a quote (when the core is installed)
--   Q9  grants: no table grant; the RPCs are authenticated + service_role, never anon
begin;

do $$
declare
  owner_admin uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  colleague uuid := gen_random_uuid();
  staff_a uuid := gen_random_uuid();
  staff_b uuid := gen_random_uuid();
  member_org uuid := gen_random_uuid();
  agency_a uuid := gen_random_uuid();
  agency_b uuid := gen_random_uuid();
  agency_c uuid := gen_random_uuid();
  pol text; pod text;
  load_req jsonb; dis_req jsonb; leg_res jsonb; route jsonb;
  set1 jsonb; set2 jsonb;
  req jsonb; req2 jsonb; inbox jsonb; mine jsonb; q jsonb; e text; v_core boolean;
begin
  v_core := to_regclass('public.notifications') is not null;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaQuotes1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (owner_admin, 'pda-q-admin@example.test'), (member, 'pda-q-member@example.test'), (outsider, 'pda-q-outsider@example.test'), (colleague, 'pda-q-colleague@example.test'),
               (staff_a, 'pda-q-staff-a@example.test'), (staff_b, 'pda-q-staff-b@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (owner_admin, owner_admin, 'pda-q-admin@example.test', 'Q Admin', 'admin', true, null, 'T4'),
    (member, member, 'pda-q-member@example.test', 'Q Member', 'cargo_owner', true, null, 'T3'),
    (outsider, outsider, 'pda-q-outsider@example.test', 'Q Outsider', 'cargo_owner', true, null, 'T3'),
    (colleague, colleague, 'pda-q-colleague@example.test', 'Q Colleague', 'cargo_owner', true, null, 'T3'),
    (staff_a, staff_a, 'pda-q-staff-a@example.test', 'Staff A', 'broker', true, null, 'T1'),
    (staff_b, staff_b, 'pda-q-staff-b@example.test', 'Staff B', 'broker', true, null, 'T1');
  insert into public.organizations (id, name) values (member_org, 'Nile Charterers LLC'), (agency_a, 'Agency A SAE'), (agency_b, 'Agency B SAE'), (agency_c, 'Agency C SAE');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (member_org, member, 'admin', true, 'active'), (member_org, colleague, 'broker', true, 'active'), (agency_a, staff_a, 'admin', true, 'active'), (agency_b, staff_b, 'admin', true, 'active');
  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;
  perform public.pda_admin_upsert_agency(owner_admin, agency_a, '{"displayName":"Agency A"}');
  perform public.pda_admin_upsert_agency(owner_admin, agency_b, '{"displayName":"Agency B"}');
  perform public.pda_admin_upsert_agency(owner_admin, agency_c, '{"displayName":"Agency C"}');
  perform public.pda_admin_set_port_agent(owner_admin, agency_a, pol, array['agency','pilotage'], true);
  perform public.pda_admin_set_port_agent(owner_admin, agency_b, pol, array['agency','pilotage'], true);
  perform public.pda_admin_set_port_agent(owner_admin, agency_c, pod, array['agency'], true);   -- at the OTHER port, and
  perform public.pda_admin_set_port_agent(owner_admin, agency_c, pol, array['agency'], true);   -- at pol for agency only

  -- a saved set (two manual-quote legs) with identifying vessel facts that must never leave in a request
  load_req := jsonb_build_object('portLocode', pol, 'callDate', '2026-11-01',
    'vessel', jsonb_build_object('vesselName', 'MV SECRET NAME', 'imo', '9999999', 'vesselType', 'Bulk carrier',
                                 'gt', 17000, 'dwt', 28000, 'loaM', 169.4, 'registeredMaxDraftM', 9.8, 'flagState', 'Malta'),
    'call', jsonb_build_object('days', 3.5, 'cargoQuantityMt', 26000, 'cargoStatus', 'laden', 'voyageScope', 'international', 'location', 'alongside',
                               'requestedServices', jsonb_build_array('agency')));
  dis_req := jsonb_set(load_req, '{portLocode}', to_jsonb(pod));
  leg_res := jsonb_build_object('coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','warnings','[]'::jsonb,
    'totals', jsonb_build_object('native', 1000), 'lines', jsonb_build_array(jsonb_build_object('label','Agency fee','basis','manual','amount',1000,
    'explanation','Authorized manual quotation','manual',true,'manualReason','Desk estimate','enteredBy','@owner')));
  route := jsonb_build_object('title', pol || ' → ' || pod,
    'canonical', jsonb_build_object('vesselAvailabilityId', gen_random_uuid(), 'vesselId', null, 'cargoId', gen_random_uuid(), 'quantityMt', 26000),
    'routeInput', jsonb_build_object('load', jsonb_build_object('portLocode', pol), 'discharge', jsonb_build_object('portLocode', pod)),
    'timeline', '{}'::jsonb, 'transits', '[]'::jsonb, 'totals', jsonb_build_object('allInKnown', 2000), 'notSourced', '[]'::jsonb,
    'allocation', 'vessel', 'displayCurrency', 'USD');
  set1 := public.pda_save_estimate_set(member, member_org, load_req, leg_res, dis_req, leg_res, route, null);

  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);

  -- Q2 · validation before anything is sent
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[gen_random_uuid()], array['agency']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q2: an agency not listed at the port must be refused, got %', e; end if;
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a], array['bunkers']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q2: an unknown service must be refused, got %', e; end if;

  -- Q1 · masked request (identity hidden), then a revealed one
  -- C2O-159 P1-2: every selected agency must quote every requested service (partial and mixed coverage refused)
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_c], array['agency','pilotage']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q2: an agency that does not quote pilotage must be refused, got %', e; end if;
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a, agency_c], array['agency','pilotage']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q2: mixed coverage must be refused, got %', e; end if;
  req := public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a, agency_b], array['agency','pilotage'], 'Please quote alongside.', false);
  if (req->>'agencies')::int <> 2 then raise exception 'Q1: two agencies addressed: %', req; end if;
  q := (select snapshot from public.pda_quote_requests where id = (req->>'requestId')::uuid);
  if q::text ~* 'SECRET NAME|9999999|vesselId|vesselName|"imo"|Malta' or q ? 'requester' or q#>'{vessel}' ? 'flagState'
     or q#>>'{vessel,type}' <> 'Bulk carrier' or (q#>>'{vessel,dwt}')::numeric <> 28000 or (q#>>'{call,cargoQuantityMt}')::numeric <> 26000
     or q#>>'{port,locode}' <> pol or q->>'callDate' <> '2026-11-01' then
    raise exception 'Q1: the snapshot must be masked yet complete for pricing: %', q; end if;
  -- owner ruling 19 Oct: one open request per port of an estimate
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_b], array['agency'], null, true); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_CONFLICT' then raise exception 'Q1: a second open request for the same port must be PDA_CONFLICT, got %', e; end if;
  req2 := public.create_pda_quote_request((set1->>'id')::uuid, 'discharge', array[agency_c], array['agency'], null, true);
  if (select snapshot#>>'{requester,company}' from public.pda_quote_requests where id = (req2->>'requestId')::uuid) is distinct from 'Nile Charterers LLC'
     or (select snapshot#>>'{vessel,flagState}' from public.pda_quote_requests where id = (req2->>'requestId')::uuid) is distinct from 'Malta' then
    raise exception 'Q1: a revealed request carries the company name and the flag'; end if;
  raise notice 'Q1 ok: masked = vessel type and exact size, cargo and call facts, no name, IMO, ids, member or flag; reveal adds company + flag; one open request per port';

  -- Q2 · outsider and superseded set
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a], array['agency']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'Q2: a member who cannot read the set must be refused, got %', e; end if;
  perform set_config('request.jwt.claim.sub', colleague::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',colleague,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a], array['agency']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'Q2: a colleague (who can read the set but not accept into it) must be refused, got %', e; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  set2 := public.pda_save_estimate_set(member, member_org, load_req, leg_res, dis_req, jsonb_set(jsonb_set(leg_res, '{totals,native}', '1100'), '{lines,0,amount}', '1100'),
                                        jsonb_set(route, '{totals,allInKnown}', '2100'), (set1->>'id')::uuid);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a], array['agency']); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_CONFLICT' then raise exception 'Q2: a superseded set must be PDA_CONFLICT, got %', e; end if;
  raise notice 'Q2 ok: only listed agencies, known services, a readable set and its latest version';

  -- Q3 · inboxes
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  inbox := public.list_agency_pda_quote_requests();
  if jsonb_array_length(inbox) <> 1 or inbox->0->>'requestId' <> req->>'requestId' or inbox->0->>'myStatus' <> 'sent'
     or inbox::text ~* 'SECRET NAME|9999999' then
    raise exception 'Q3: agency A staff see only the one request addressed to A, masked: %', inbox; end if;
  perform set_config('request.jwt.claim.sub', staff_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_b,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  if jsonb_array_length(public.list_agency_pda_quote_requests()) <> 1 then raise exception 'Q3: agency B staff see the one request addressed to B'; end if;
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  if jsonb_array_length(public.list_agency_pda_quote_requests()) <> 0 then raise exception 'Q3: a non-staff member sees no request'; end if;
  raise notice 'Q3 ok: each agency sees only its own requests; others see none';

  -- Q4 · quoting
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  begin perform public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_b, 'USD', '[{"label":"Agency","amount":"100"}]', current_date + 30); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'Q4: staff of another agency must be refused, got %', e; end if;
  begin perform public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency","amount":"12.345"}]', current_date + 30); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q4: 3-decimal amount must be refused, got %', e; end if;
  begin perform public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency","amount":"1234567890123"}]', current_date + 30); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q4: a 13-digit amount must be refused, got %', e; end if;
  begin perform public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Towage","serviceCode":"towage","amount":"10"}]', current_date + 30); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q4: a service not requested must be refused, got %', e; end if;
  q := public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'usd',
         '[{"label":"Agency fee","serviceCode":"agency","amount":"1250.50"},{"label":"Pilotage","serviceCode":"pilotage","amount":"800"}]', current_date + 30, 'AQ-17', null);
  if (q->>'revision')::int <> 1 or (q->>'total')::numeric <> 2050.50 then raise exception 'Q4: first quote, total computed: %', q; end if;
  q := public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1200"}]', current_date + 30, 'AQ-17b', 'Revised');
  if (q->>'revision')::int <> 2 or (select count(*) from public.pda_agency_quotes where request_id = (req->>'requestId')::uuid) <> 2 then
    raise exception 'Q4: a revision appends a new quote: %', q; end if;
  raise notice 'Q4 ok: totals computed, revisions append, bad lines and other agencies refused';

  -- Q5 · decline, then what the requester sees
  perform set_config('request.jwt.claim.sub', staff_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_b,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  begin perform public.decline_pda_quote_request((req->>'requestId')::uuid, agency_b, 'no'); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q5: a decline needs a reason, got %', e; end if;
  -- an inactive requester's notification never blocks an agency's answer (pre-audit P2-6)
  update public.users set is_active = false where id = member;
  perform public.decline_pda_quote_request((req->>'requestId')::uuid, agency_b, 'No berth window that week');
  update public.users set is_active = true where id = member;
  -- C2O-159 P1-3: an expired request takes no decline (a request seeded already expired, addressed to agency B)
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.pda_quote_requests (id, set_id, leg, port_locode, requester_user_id, requester_org_id, snapshot, services, expires_at)
  values ('00000000-0000-4000-8000-0000000000e1', (set2->>'id')::uuid, 'discharge', pod, member, member_org, '{}'::jsonb, array['agency'], now() - interval '1 hour');
  insert into public.pda_quote_request_recipients (request_id, agency_org_id) values ('00000000-0000-4000-8000-0000000000e1', agency_b);
  perform set_config('request.jwt.claim.sub', staff_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_b,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  begin perform public.decline_pda_quote_request('00000000-0000-4000-8000-0000000000e1', agency_b, 'Too late for us'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'Q5: an expired request must not take a decline, got %', e; end if;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  mine := (select x from jsonb_array_elements(public.list_my_pda_quote_requests((set1->>'id')::uuid)) x where x->>'requestId' = req->>'requestId');
  if (select count(*) from jsonb_array_elements(mine->'agencies') a where a->>'status' = 'quoted' and (a->'quotes'->0->>'revision')::int = 2) <> 1
     or (select count(*) from jsonb_array_elements(mine->'agencies') a where a->>'status' = 'declined' and a->>'declineReason' = 'No berth window that week') <> 1 then
    raise exception 'Q5: the requester sees the quote (latest revision first) and the decline: %', mine; end if;
  raise notice 'Q5 ok: a decline needs a reason; the requester sees every answer';

  -- Q6 · withdraw
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.withdraw_pda_quote_request((req->>'requestId')::uuid); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'Q6: only the requester withdraws, got %', e; end if;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  perform public.withdraw_pda_quote_request((req->>'requestId')::uuid);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  begin perform public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency","amount":"1"}]', current_date + 30); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'Q6: a withdrawn request takes no quote, got %', e; end if;
  -- owner ruling 19 Oct: at most 20 requests a day per member (18 more rows, withdrawn, make 20 with req and req2)
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.pda_quote_requests (set_id, leg, port_locode, requester_user_id, requester_org_id, snapshot, services, status, withdrawn_at)
  select (set2->>'id')::uuid, 'load', pol, member, member_org, '{}'::jsonb, array['agency'], 'withdrawn', now() from generate_series(1, 18);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.create_pda_quote_request((set2->>'id')::uuid, 'discharge', array[agency_c], array['agency']); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'Q6: the 21st request in a day must be refused, got %', e; end if;
  raise notice 'Q6 ok: only the requester withdraws; a withdrawn request takes no quote; 20 requests a day at most';

  -- Q7 · immutability
  perform set_config('request.jwt.claim.sub', '', true);
  begin update public.pda_agency_quotes set total = 1 where request_id = (req->>'requestId')::uuid; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'Q7: a quote edit must be refused, got %', e; end if;
  begin update public.pda_quote_requests set note = 'x' where id = (req2->>'requestId')::uuid; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'Q7: a request edit must be refused, got %', e; end if;
  begin delete from public.pda_quote_requests where id = (req2->>'requestId')::uuid; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'Q7: a request delete must be refused, got %', e; end if;
  begin truncate public.pda_quote_request_recipients cascade; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'Q7: TRUNCATE of the recipients must be refused, got %', e; end if;
  raise notice 'Q7 ok: quotes never change; a request only moves open → withdrawn; TRUNCATE refused';

  -- Q8 · notifications (when the shared core is installed)
  if v_core then
    if not exists (select 1 from public.notifications n where n.recipient_user_id = staff_a and n.kind = 'pda.quote_request')
       or not exists (select 1 from public.notifications n where n.recipient_user_id = member and n.kind = 'pda.quote_received')
       -- the decline happened while the requester was inactive (Q5): no notification, and the decline still went through
       or exists (select 1 from public.notifications n where n.recipient_user_id = member and n.kind = 'pda.quote_declined')
       or exists (select 1 from public.notifications n where n.kind like 'pda.quote%' and (n.title || n.body) ~* 'SECRET NAME|9999999') then
      raise exception 'Q8: staff hear of a request, the requester of a quote (not of a decline made while inactive); no vessel identity in any notification'; end if;
    raise notice 'Q8 ok: staff notified of the request; the requester of the quote, not of a decline made while inactive; no vessel identity';
  else
    raise notice 'Q8 skipped: the shared notification core is not installed here';
  end if;

  -- Q9 · grants
  if exists (select 1 from unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr,
                  unnest(array['public.pda_quote_requests','public.pda_quote_request_recipients','public.pda_agency_quotes']) t
             where has_table_privilege(ro, t, pr))
     or has_function_privilege('anon', 'public.create_pda_quote_request(uuid, text, uuid[], text[], text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.submit_pda_agency_quote(uuid, uuid, text, jsonb, date, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_agency_pda_quote_requests()', 'execute')
     or has_function_privilege('authenticated', 'public.fn_pda_is_agency_staff(uuid)', 'execute') then
    raise exception 'Q9: grants are not as designed'; end if;
  raise notice 'Q9 ok: no table grant; RPCs authenticated + service_role; helpers private';
end $$;

do $m$ begin raise notice 'PDA QUOTE REQUESTS: ALL ASSERTIONS PASSED'; end $m$;
rollback;
