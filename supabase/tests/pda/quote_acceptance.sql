-- PDA · accept an agency quote into a new estimate version (20261019110000, O2ALL-009 A4). BEGIN … ROLLBACK; run as the owner.
--   A1  the service context reaches only the requester and carries the saved route input (service only)
--   A2  the quoted leg must BE the quote: a changed amount, label, service, attribution, currency or total is refused;
--       the other port may not carry agency_quote lines
--   A3  acceptance saves a set that supersedes the request's set, records the acceptance and marks the quote accepted
--   A4  one acceptance per request; an older revision, another member and a withdrawn request are refused
--   A5  the agency staff are notified; acceptances are never edited or deleted
--   A6  grants: no table grant; both functions service-only
--   A12 the symmetric lineage (C2O-162 nb): discharge accepted first, then load, then a replacement load quote keeps
--       the discharge quote accepted two versions back
begin;

do $$
declare
  owner_admin uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  staff_a uuid := gen_random_uuid();
  member_org uuid := gen_random_uuid();
  agency_a uuid := gen_random_uuid();
  pol text; pod text;
  load_req jsonb; dis_req jsonb; leg_res jsonb; route jsonb; quoted jsonb; good jsonb;
  set1 jsonb; req jsonb; req2 jsonb; q1 jsonb; q2 jsonb; ctx jsonb; saved jsonb; mine jsonb; e text; v_core boolean;
  route2 jsonb; s_d jsonb; s_dl jsonb; s_dll jsonb; dq jsonb; lq jsonb; good_d jsonb; good_l jsonb;
begin
  v_core := to_regclass('public.notifications') is not null;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaAccept1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (owner_admin, 'pda-qa-admin@example.test'), (member, 'pda-qa-member@example.test'), (outsider, 'pda-qa-outsider@example.test'),
               (staff_a, 'pda-qa-staff@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (owner_admin, owner_admin, 'pda-qa-admin@example.test', 'QA Admin', 'admin', true, null, 'T4'),
    (member, member, 'pda-qa-member@example.test', 'QA Member', 'cargo_owner', true, null, 'T3'),
    (outsider, outsider, 'pda-qa-outsider@example.test', 'QA Outsider', 'cargo_owner', true, null, 'T3'),
    (staff_a, staff_a, 'pda-qa-staff@example.test', 'QA Staff', 'broker', true, null, 'T1');
  insert into public.organizations (id, name) values (member_org, 'QA Charterers'), (agency_a, 'QA Agency SAE');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (member_org, member, 'admin', true, 'active'), (agency_a, staff_a, 'admin', true, 'active');
  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;
  perform public.pda_admin_upsert_agency(owner_admin, agency_a, '{"displayName":"QA Agency"}');
  perform public.pda_admin_set_port_agent(owner_admin, agency_a, pol, array['agency','cargo_handling'], true);

  load_req := jsonb_build_object('portLocode', pol, 'callDate', '2026-11-01', 'vessel', jsonb_build_object('vesselName', 'MV QA', 'dwt', 28000),
    'call', jsonb_build_object('days', 3, 'cargoQuantityMt', 26000, 'requestedServices', jsonb_build_array('agency')));
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
  req := public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a], array['agency','cargo_handling']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  q1 := public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD',
         '[{"label":"Agency fee","serviceCode":"agency","amount":"1300"},{"label":"Stevedoring","serviceCode":"cargo_handling","amount":"700.50"}]', current_date + 30, 'QA-1');
  q2 := public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD',
         '[{"label":"Agency fee","serviceCode":"agency","amount":"1250.50"},{"label":"Stevedoring","serviceCode":"cargo_handling","amount":"700"}]', current_date + 30, 'QA-2');
  perform set_config('request.jwt.claim.sub', '', true);

  -- A1 · context (service only, requester only)
  begin perform public.pda_quote_acceptance_context(outsider, (q2->>'quoteId')::uuid); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'A1: another member must be refused, got %', e; end if;
  ctx := public.pda_quote_acceptance_context(member, (q2->>'quoteId')::uuid);
  if ctx->>'leg' <> 'load' or (ctx->>'setIsLatest')::boolean is not true or (ctx->>'latestRevision')::boolean is not true
     or (ctx->>'accepted')::boolean or ctx->'routeInput' is null or ctx->>'agencyName' <> 'QA Agency' or (ctx->>'total')::numeric <> 1950.50 then
    raise exception 'A1: context for the requester: %', ctx; end if;
  if (public.pda_quote_acceptance_context(member, (q1->>'quoteId')::uuid)->>'latestRevision')::boolean then
    raise exception 'A1: revision 1 is not the latest'; end if;
  raise notice 'A1 ok: the context reaches only the requester and carries the saved route input';

  -- the quoted leg, exactly as the server builds it
  quoted := jsonb_build_object('coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','warnings',
    jsonb_build_array(jsonb_build_object('code','AGENCY_QUOTE','message','priced from an accepted agency quote')),
    'totals', jsonb_build_object('native', 1950.50),
    'lines', jsonb_build_array(
      jsonb_build_object('ruleId',null,'ruleCode','agency','label','Agency fee','basis','agency_quote','amount',1250.50,'explanation','Agency quote from QA Agency','manual',true,'manualReason','Agency quote','enteredBy','QA Agency','serviceCodes',jsonb_build_array('agency'),'inputs','{}'::jsonb,'evidence',jsonb_build_object('title','Agency quote · QA Agency')),
      jsonb_build_object('ruleId',null,'ruleCode','cargo_handling','label','Stevedoring','basis','agency_quote','amount',700,'explanation','Agency quote from QA Agency','manual',true,'manualReason','Agency quote','enteredBy','QA Agency','serviceCodes',jsonb_build_array('cargo_handling'),'inputs','{}'::jsonb,'evidence',jsonb_build_object('title','Agency quote · QA Agency'))));
  good := jsonb_set(route, '{totals,allInKnown}', '2950.5');

  -- A2 · the leg must be the quote
  begin perform public.pda_accept_agency_quote(member, member_org, (q2->>'quoteId')::uuid, load_req,
          jsonb_set(jsonb_set(quoted, '{lines,1,amount}', '600'), '{totals,native}', '1850.5'), dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A2: a changed amount must be refused, got %', e; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (q2->>'quoteId')::uuid, load_req, jsonb_set(quoted, '{lines,0,enteredBy}', '"Someone else"'), dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A2: a changed attribution must be refused, got %', e; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (q2->>'quoteId')::uuid, load_req, jsonb_set(quoted, '{nativeCurrency}', '"EUR"'), dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A2: another currency must be refused, got %', e; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (q2->>'quoteId')::uuid, load_req, quoted, dis_req, jsonb_set(leg_res, '{lines,0,basis}', '"agency_quote"'), good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A2: agency_quote lines on the other port must be refused, got %', e; end if;
  raise notice 'A2 ok: the accepted port must be the quote line by line; the other port cannot pose as one';

  -- A4 (before) · older revision, another member
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, quoted, dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'A4: an older revision must be refused, got %', e; end if;
  begin perform public.pda_accept_agency_quote(outsider, null, (q2->>'quoteId')::uuid, load_req, quoted, dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'A4: another member must be refused, got %', e; end if;

  -- A3 · accept
  saved := public.pda_accept_agency_quote(member, member_org, (q2->>'quoteId')::uuid, load_req, quoted, dis_req, leg_res, good);
  if (saved->>'replayed')::boolean or (select supersedes_id from public.pda_estimate_sets where id = (saved->>'id')::uuid) <> (set1->>'id')::uuid
     or (select count(*) from public.pda_quote_acceptances where quote_id = (q2->>'quoteId')::uuid and set_id = (saved->>'id')::uuid) <> 1
     or (select count(*) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.load_estimate_id = l.estimate_id
          where s.id = (saved->>'id')::uuid and l.basis = 'agency_quote' and l.entered_by_label = 'QA Agency') <> 2 then
    raise exception 'A3: the new set supersedes the request set, carries the two quote lines and is recorded: %', saved; end if;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  mine := public.list_my_pda_quote_requests((set1->>'id')::uuid)->0->'agencies'->0->'quotes';
  if (mine->0->>'accepted')::boolean is not true or (mine->1->>'accepted')::boolean then
    raise exception 'A3: only revision 2 reads as accepted: %', mine; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'A3 ok: the accepted quote becomes a new version superseding the request set; the quote reads accepted';

  -- A4 (after) · once per request; withdrawn requests
  begin perform public.pda_accept_agency_quote(member, member_org, (q2->>'quoteId')::uuid, load_req, quoted, dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_CONFLICT' then raise exception 'A4: a second acceptance must be PDA_CONFLICT, got %', e; end if;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  req2 := public.create_pda_quote_request((saved->>'id')::uuid, 'load', array[agency_a], array['agency']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  q1 := public.submit_pda_agency_quote((req2->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1"}]', current_date + 30);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  perform public.withdraw_pda_quote_request((req2->>'requestId')::uuid);
  perform set_config('request.jwt.claim.sub', '', true);
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, quoted, dis_req, leg_res, good); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'A4: a withdrawn request must be refused, got %', e; end if;
  raise notice 'A4 ok: once per request; older revisions, other members and withdrawn requests refused';

  -- A7 · a request with an accepted quote is closed (pre-audit P1-1)
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  begin perform public.submit_pda_agency_quote((req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1"}]', current_date + 30); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'A7: a new revision after acceptance must be refused, got %', e; end if;
  if (select x->>'requestStatus' from jsonb_array_elements(public.list_agency_pda_quote_requests()) x where x->>'requestId' = req->>'requestId') <> 'accepted' then
    raise exception 'A7: the agency inbox must say accepted'; end if;
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.withdraw_pda_quote_request((req->>'requestId')::uuid); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'A7: withdrawing an accepted request must be refused, got %', e; end if;
  raise notice 'A7 ok: once a quote is accepted the request is closed: no new revision or withdraw; the inbox says accepted';

  -- A8 · accepting the other port keeps the first acceptance (pre-audit P1-2); suspended agency, route input, FX figures
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.pda_admin_set_port_agent(owner_admin, agency_a, pod, array['agency'], true);
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  req2 := public.create_pda_quote_request((saved->>'id')::uuid, 'discharge', array[agency_a], array['agency']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  q1 := public.submit_pda_agency_quote((req2->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"900"}]', current_date + 30);
  perform set_config('request.jwt.claim.sub', '', true);
  ctx := public.pda_quote_acceptance_context(member, (q1->>'quoteId')::uuid);
  if ctx#>>'{carried,leg}' <> 'load' or (ctx#>>'{carried,total}')::numeric <> 1950.50 or (ctx->>'agencyActive')::boolean is not true then
    raise exception 'A8: the context carries the accepted load quote forward: %', ctx; end if;
  good := jsonb_build_object('coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','warnings','[]'::jsonb,
    'totals', jsonb_build_object('native', 900),
    'lines', jsonb_build_array(jsonb_build_object('ruleId',null,'ruleCode','agency','label','Agency fee','basis','agency_quote','amount',900,'explanation','Agency quote from QA Agency','manual',true,'manualReason','Agency quote','enteredBy','QA Agency','serviceCodes',jsonb_build_array('agency'),'inputs','{}'::jsonb,'evidence',jsonb_build_object('title','Agency quote · QA Agency'))));
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, leg_res, dis_req, good, route); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A8: dropping the accepted load quote must be refused, got %', e; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, quoted, dis_req, good,
          jsonb_set(route, '{routeInput,load,portLocode}', to_jsonb(pod))); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A8: a changed route input must be refused, got %', e; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, quoted, dis_req,
          jsonb_set(jsonb_set(jsonb_set(good, '{convertedCurrency}', '"EUR"'), '{totals,converted}', '850'), '{lines,0,convertedAmount}', '850'), route); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A8: converted figures without a governed rate must be refused, got %', e; end if;
  perform public.pda_admin_upsert_agency(owner_admin, agency_a, '{"displayName":"QA Agency","status":"suspended"}');
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, quoted, dis_req, good, route); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'A8: a suspended agency''s quote must be refused, got %', e; end if;
  perform public.pda_admin_upsert_agency(owner_admin, agency_a, '{"displayName":"QA Agency","status":"active"}');
  mine := public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, quoted, dis_req, good, route);
  if (select supersedes_id from public.pda_estimate_sets where id = (mine->>'id')::uuid) <> (saved->>'id')::uuid
     or (select count(*) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.load_estimate_id = l.estimate_id
          where s.id = (mine->>'id')::uuid and l.basis = 'agency_quote') <> 2
     or (select count(*) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.discharge_estimate_id = l.estimate_id
          where s.id = (mine->>'id')::uuid and l.basis = 'agency_quote') <> 1 then
    raise exception 'A8: the new version keeps the load quote and adds the discharge quote: %', mine; end if;
  raise notice 'A8 ok: a second port''s acceptance keeps the first; route input, governed FX figures and a suspended agency are checked';

  -- A10 · a THIRD acceptance (a replacement discharge quote) keeps the load quote accepted two versions back (C2O-159 P1-4)
  --        and A11 · a member with two seats cannot move the accepted version into the other organisation (P1-5)
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  req2 := public.create_pda_quote_request((mine->>'id')::uuid, 'discharge', array[agency_a], array['agency']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  q1 := public.submit_pda_agency_quote((req2->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"950"}]', current_date + 30);
  perform set_config('request.jwt.claim.sub', '', true);
  ctx := public.pda_quote_acceptance_context(member, (q1->>'quoteId')::uuid);
  if ctx#>>'{carried,leg}' <> 'load' or (ctx#>>'{carried,total}')::numeric <> 1950.50 then
    raise exception 'A10: the load quote accepted on an earlier version is still carried: %', ctx; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (q1->>'quoteId')::uuid, load_req, leg_res, dis_req,
          jsonb_set(jsonb_set(good, '{totals,native}', '950'), '{lines,0,amount}', '950'), route); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A10: dropping the still-effective load quote must be refused, got %', e; end if;
  insert into public.organizations (id, name) values ('00000000-0000-4000-8000-00000000a0b2', 'QA Second Org');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values ('00000000-0000-4000-8000-00000000a0b2', member, 'admin', true, 'active');
  saved := public.pda_accept_agency_quote(member, '00000000-0000-4000-8000-00000000a0b2', (q1->>'quoteId')::uuid, load_req, quoted, dis_req,
             jsonb_set(jsonb_set(good, '{totals,native}', '950'), '{lines,0,amount}', '950'), route);
  if (select supersedes_id from public.pda_estimate_sets where id = (saved->>'id')::uuid) <> (mine->>'id')::uuid
     or (select owner_org_id from public.pda_estimate_sets where id = (saved->>'id')::uuid) is distinct from member_org
     or (select count(*) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.load_estimate_id = l.estimate_id
          where s.id = (saved->>'id')::uuid and l.basis = 'agency_quote') <> 2
     or (select sum(l.amount) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.discharge_estimate_id = l.estimate_id
          where s.id = (saved->>'id')::uuid and l.basis = 'agency_quote') <> 950 then
    raise exception 'A10/A11: the third version keeps the load quote, takes the replacement discharge quote and stays in org A: %', saved; end if;
  raise notice 'A10 ok: a third acceptance keeps the opposite leg''s quote through the supersede lineage';
  raise notice 'A11 ok: a two-seat member cannot move the accepted version into the other organisation';

  -- A9 · an expired request takes no acceptance (C2O-159 P1-3): a request seeded already expired, with a valid quote
  insert into public.pda_quote_requests (id, set_id, leg, port_locode, requester_user_id, requester_org_id, snapshot, services, expires_at)
  values ('00000000-0000-4000-8000-0000000000e9', (saved->>'id')::uuid, 'load', pol, member, member_org, '{}'::jsonb, array['agency'], now() - interval '1 hour');
  insert into public.pda_quote_request_recipients (request_id, agency_org_id) values ('00000000-0000-4000-8000-0000000000e9', agency_a);
  insert into public.pda_agency_quotes (id, request_id, agency_org_id, revision, submitted_by, currency, lines, total, valid_until)
  values ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000000e9', agency_a, 1, staff_a, 'USD',
          '[{"label":"Agency fee","serviceCode":"agency","amount":1}]', 1, current_date + 30);
  if public.pda_quote_acceptance_context(member, '00000000-0000-4000-8000-0000000000f9')->>'requestStatus' <> 'expired' then
    raise exception 'A9: the context reports the expired request'; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, '00000000-0000-4000-8000-0000000000f9', load_req, quoted, dis_req, good, route); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'A9: an expired request must not take an acceptance, got %', e; end if;
  raise notice 'A9 ok: an expired request takes no acceptance';

  -- A12 · the symmetric lineage (C2O-162 nb): a new estimate for another cargo; discharge accepted first (800), then load
  --        (600), then a replacement load quote (650) must still carry the discharge quote accepted two versions back
  route2 := jsonb_set(route, '{canonical,cargoId}', to_jsonb(gen_random_uuid()));
  set1 := public.pda_save_estimate_set(member, member_org, load_req, leg_res, dis_req, leg_res, route2, null);
  good_d := jsonb_set(jsonb_set(good, '{totals,native}', '800'), '{lines,0,amount}', '800');
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  req2 := public.create_pda_quote_request((set1->>'id')::uuid, 'discharge', array[agency_a], array['agency']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  dq := public.submit_pda_agency_quote((req2->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"800"}]', current_date + 30);
  perform set_config('request.jwt.claim.sub', '', true);
  s_d := public.pda_accept_agency_quote(member, member_org, (dq->>'quoteId')::uuid, load_req, leg_res, dis_req, good_d, route2);

  good_l := jsonb_set(jsonb_set(good, '{totals,native}', '600'), '{lines,0,amount}', '600');
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  req2 := public.create_pda_quote_request((s_d->>'id')::uuid, 'load', array[agency_a], array['agency']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  lq := public.submit_pda_agency_quote((req2->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"600"}]', current_date + 30);
  perform set_config('request.jwt.claim.sub', '', true);
  ctx := public.pda_quote_acceptance_context(member, (lq->>'quoteId')::uuid);
  if ctx#>>'{carried,leg}' <> 'discharge' or (ctx#>>'{carried,total}')::numeric <> 800 then
    raise exception 'A12: the discharge quote is carried into the load acceptance: %', ctx; end if;
  s_dl := public.pda_accept_agency_quote(member, member_org, (lq->>'quoteId')::uuid, load_req, good_l, dis_req, good_d, route2);

  good_l := jsonb_set(jsonb_set(good, '{totals,native}', '650'), '{lines,0,amount}', '650');
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  req2 := public.create_pda_quote_request((s_dl->>'id')::uuid, 'load', array[agency_a], array['agency']);
  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',staff_a,'app_metadata',jsonb_build_object('role','broker'))::text, true);
  lq := public.submit_pda_agency_quote((req2->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"650"}]', current_date + 30);
  perform set_config('request.jwt.claim.sub', '', true);
  ctx := public.pda_quote_acceptance_context(member, (lq->>'quoteId')::uuid);
  if ctx#>>'{carried,leg}' <> 'discharge' or (ctx#>>'{carried,total}')::numeric <> 800 then
    raise exception 'A12: the discharge quote accepted two versions back is still carried: %', ctx; end if;
  begin perform public.pda_accept_agency_quote(member, member_org, (lq->>'quoteId')::uuid, load_req, good_l, dis_req, leg_res, route2); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'A12: dropping the still-effective discharge quote must be refused, got %', e; end if;
  s_dll := public.pda_accept_agency_quote(member, member_org, (lq->>'quoteId')::uuid, load_req, good_l, dis_req, good_d, route2);
  if (select supersedes_id from public.pda_estimate_sets where id = (s_dll->>'id')::uuid) <> (s_dl->>'id')::uuid
     or (select sum(l.amount) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.load_estimate_id = l.estimate_id
          where s.id = (s_dll->>'id')::uuid and l.basis = 'agency_quote') <> 650
     or (select sum(l.amount) from public.pda_estimate_lines l join public.pda_estimate_sets s on s.discharge_estimate_id = l.estimate_id
          where s.id = (s_dll->>'id')::uuid and l.basis = 'agency_quote') <> 800 then
    raise exception 'A12: the third version takes the replacement load quote and keeps the discharge quote: %', s_dll; end if;
  raise notice 'A12 ok: discharge → load → replacement load keeps the discharge quote through the supersede lineage';

  -- A5 · notification + immutability
  if v_core and not exists (select 1 from public.notifications n where n.recipient_user_id = staff_a and n.kind = 'pda.quote_accepted') then
    raise exception 'A5: the agency staff are told their quote was accepted'; end if;
  begin update public.pda_quote_acceptances set accepted_by = outsider; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'A5: an acceptance edit must be refused, got %', e; end if;
  begin delete from public.pda_quote_acceptances; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'A5: an acceptance delete must be refused, got %', e; end if;
  raise notice 'A5 ok: the agency is notified; acceptances are never edited or deleted';

  -- A6 · grants
  if exists (select 1 from unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
             where has_table_privilege(ro, 'public.pda_quote_acceptances', pr))
     or has_function_privilege('authenticated', 'public.pda_accept_agency_quote(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.pda_quote_acceptance_context(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.pda_quote_acceptance_context(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.pda_accept_agency_quote(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'A6: grants are not as designed'; end if;
  raise notice 'A6 ok: no table grant; both functions service-only';
end $$;

do $m$ begin raise notice 'PDA QUOTE ACCEPTANCE: ALL ASSERTIONS PASSED'; end $m$;
rollback;
