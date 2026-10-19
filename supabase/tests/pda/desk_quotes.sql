-- PDA · the desk records an agency's emailed quote (20261019120000, Agents phase 4). BEGIN … ROLLBACK; run as the owner.
--   D1  only an owner-tier admin lists the waiting requests; only agencies WITHOUT an active account appear
--   D2  recording: owner-tier admin only; never for an agency with an account; source required; lines validated; revisions
--   D3  the member sees the quote as recorded by the desk (enteredVia 'desk'), never the source text
--   D4  an accepted request takes no desk quote either; desk quotes are append-only and keep their marker
--   D5  grants: both functions service-only; the new helper private
begin;

do $$
declare
  owner_admin uuid := gen_random_uuid();
  sub_admin uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  staff_b uuid := gen_random_uuid();
  member_org uuid := gen_random_uuid();
  agency_a uuid := gen_random_uuid();   -- no portal account: answers by email
  agency_b uuid := gen_random_uuid();   -- has an account: answers in its inbox
  pol text; pod text;
  load_req jsonb; dis_req jsonb; leg_res jsonb; route jsonb;
  set1 jsonb; req jsonb; q jsonb; list jsonb; mine jsonb; e text; v_core boolean;
begin
  v_core := to_regclass('public.notifications') is not null;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaDesk1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (owner_admin, 'pda-dq-admin@example.test'), (sub_admin, 'pda-dq-sub@example.test'), (member, 'pda-dq-member@example.test'),
               (staff_b, 'pda-dq-staff@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (owner_admin, owner_admin, 'pda-dq-admin@example.test', 'DQ Admin', 'admin', true, null, 'T4'),
    (sub_admin, sub_admin, 'pda-dq-sub@example.test', 'DQ Sub', 'admin', true, 'sub', 'T4'),
    (member, member, 'pda-dq-member@example.test', 'DQ Member', 'cargo_owner', true, null, 'T3'),
    (staff_b, staff_b, 'pda-dq-staff@example.test', 'DQ Staff', 'broker', true, null, 'T1');
  insert into public.organizations (id, name) values (member_org, 'DQ Charterers'), (agency_a, 'Email Agency SAE'), (agency_b, 'Portal Agency SAE');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (member_org, member, 'admin', true, 'active'), (agency_b, staff_b, 'admin', true, 'active');
  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;
  perform public.pda_admin_upsert_agency(owner_admin, agency_a, '{"displayName":"Email Agency"}');
  perform public.pda_admin_upsert_agency(owner_admin, agency_b, '{"displayName":"Portal Agency"}');
  perform public.pda_admin_set_port_agent(owner_admin, agency_a, pol, array['agency','cargo_handling'], true);
  perform public.pda_admin_set_port_agent(owner_admin, agency_b, pol, array['agency','cargo_handling'], true);

  load_req := jsonb_build_object('portLocode', pol, 'callDate', '2026-11-01', 'vessel', jsonb_build_object('vesselName', 'MV DESK SECRET', 'dwt', 28000),
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
  req := public.create_pda_quote_request((set1->>'id')::uuid, 'load', array[agency_a, agency_b], array['agency','cargo_handling']);
  perform set_config('request.jwt.claim.sub', '', true);

  -- D1 · the waiting list
  begin perform public.pda_admin_list_quote_requests(sub_admin); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'D1: a sub-admin must be refused, got %', e; end if;
  list := public.pda_admin_list_quote_requests(owner_admin);
  if jsonb_array_length(list) <> 1 or list->0->>'agencyId' <> agency_a::text or list->0->>'requestId' <> req->>'requestId'
     or list::text ~* 'DESK SECRET' then
    raise exception 'D1: only the agency without an account waits for the desk, masked: %', list; end if;
  raise notice 'D1 ok: owner-tier only; only agencies without an account; the snapshot stays masked';

  -- D2 · recording
  begin perform public.pda_admin_record_agency_quote(sub_admin, (req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1200"}]', current_date + 20, 'Email from ops, 19 Oct'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'D2: a sub-admin must be refused, got %', e; end if;
  begin perform public.pda_admin_record_agency_quote(owner_admin, (req->>'requestId')::uuid, agency_b, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1200"}]', current_date + 20, 'Email from ops, 19 Oct'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'D2: an agency with an account answers itself, got %', e; end if;
  begin perform public.pda_admin_record_agency_quote(owner_admin, (req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1200"}]', current_date + 20, 'x'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'D2: a source is required, got %', e; end if;
  begin perform public.pda_admin_record_agency_quote(owner_admin, (req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Towage","serviceCode":"towage","amount":"5"}]', current_date + 20, 'Email from ops, 19 Oct'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_VALIDATION' then raise exception 'D2: a service not requested must be refused, got %', e; end if;
  q := public.pda_admin_record_agency_quote(owner_admin, (req->>'requestId')::uuid, agency_a, 'usd',
         '[{"label":"Agency fee","serviceCode":"agency","amount":"1200"},{"label":"Stevedoring","serviceCode":"cargo_handling","amount":"650.25"}]',
         current_date + 20, 'Email from ops@emailagency.example, 19 Oct 10:42', 'EA-7');
  if (q->>'revision')::int <> 1 or (q->>'total')::numeric <> 1850.25
     or (select entered_via || '|' || desk_source || '|' || submitted_by::text from public.pda_agency_quotes where id = (q->>'quoteId')::uuid)
        <> 'desk|Email from ops@emailagency.example, 19 Oct 10:42|' || owner_admin::text
     or (select status from public.pda_quote_request_recipients where request_id = (req->>'requestId')::uuid and agency_org_id = agency_a) <> 'quoted' then
    raise exception 'D2: the desk quote is recorded with its marker, source and recorder: %', q; end if;
  q := public.pda_admin_record_agency_quote(owner_admin, (req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1150"}]', current_date + 20, 'Email from ops, revised 19 Oct 14:00');
  if (q->>'revision')::int <> 2 then raise exception 'D2: a second desk quote is revision 2: %', q; end if;
  raise notice 'D2 ok: owner-tier only, never for an agency with an account, source required, lines validated, revisions append';

  -- D3 · the member's view
  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  mine := (select a from jsonb_array_elements(public.list_my_pda_quote_requests((set1->>'id')::uuid)->0->'agencies') a where a->>'agencyId' = agency_a::text);
  if mine->>'status' <> 'quoted' or mine->'quotes'->0->>'enteredVia' <> 'desk' or (mine->'quotes'->0->>'revision')::int <> 2
     or mine::text ~* 'emailagency|Email from' then
    raise exception 'D3: the member sees a desk-recorded quote without its source: %', mine; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if v_core and not exists (select 1 from public.notifications n where n.recipient_user_id = member and n.kind = 'pda.quote_received' and n.body ~ 'recorded by Arab ShipBroker') then
    raise exception 'D3: the member is notified that the desk recorded the quote'; end if;
  raise notice 'D3 ok: the member sees the quote as recorded by the desk, never the source text';

  -- D4 · closed after acceptance; append-only; marker kept
  insert into public.pda_quote_acceptances (quote_id, request_id, agency_org_id, set_id, accepted_by)
  values ((q->>'quoteId')::uuid, (req->>'requestId')::uuid, agency_a,
          ((public.pda_save_estimate_set(member, member_org, load_req, leg_res, dis_req, jsonb_set(jsonb_set(leg_res, '{totals,native}', '1001'), '{lines,0,amount}', '1001'),
                                         jsonb_set(route, '{totals,allInKnown}', '2001'), (set1->>'id')::uuid))->>'id')::uuid, member);
  begin perform public.pda_admin_record_agency_quote(owner_admin, (req->>'requestId')::uuid, agency_a, 'USD', '[{"label":"Agency fee","serviceCode":"agency","amount":"1"}]', current_date + 20, 'Email from ops, later'); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_STATE' then raise exception 'D4: an accepted request takes no desk quote, got %', e; end if;
  begin update public.pda_agency_quotes set entered_via = 'agency', desk_source = null where id = (q->>'quoteId')::uuid; e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'D4: a desk quote is never re-marked, got %', e; end if;
  begin insert into public.pda_agency_quotes (request_id, agency_org_id, revision, submitted_by, currency, lines, total, valid_until, entered_via)
        values (gen_random_uuid(), agency_a, 9, owner_admin, 'USD', '[{"label":"x","amount":1}]', 1, current_date, 'desk'); e := null;
  exception when check_violation then e := 'CHECK'; when others then e := 'OTHER:' || sqlstate; end;
  if e is distinct from 'CHECK' then raise exception 'D4: a desk quote without a source must violate the check, got %', e; end if;
  raise notice 'D4 ok: an accepted request takes no desk quote; desk quotes are append-only; the marker needs a source';

  -- D5 · grants
  if has_function_privilege('authenticated', 'public.pda_admin_record_agency_quote(uuid, uuid, uuid, text, jsonb, date, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.pda_admin_list_quote_requests(uuid)', 'execute')
     or has_function_privilege('anon', 'public.pda_admin_list_quote_requests(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.pda_admin_record_agency_quote(uuid, uuid, uuid, text, jsonb, date, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_pda_agency_has_staff(uuid)', 'execute') then
    raise exception 'D5: grants are not as designed'; end if;
  raise notice 'D5 ok: both functions service-only; the helper private';
end $$;

do $m$ begin raise notice 'PDA DESK QUOTES: ALL ASSERTIONS PASSED'; end $m$;
rollback;
