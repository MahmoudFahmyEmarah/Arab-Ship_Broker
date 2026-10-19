-- PDA · immutable paired save and history (20261018120000, O2ALL-008 increment A). BEGIN … ROLLBACK; run as the owner.
--   E1  a set saves both legs (through pda_save_estimate) and itself in one transaction; the hash is the database's
--   E2  the same content again (even with a different generation time) returns the same set — nothing new is written
--   E3  a failure in either leg leaves nothing behind (no orphan leg estimate, no set)
--   E4  a new version supersedes the previous set; superseding twice, by another member, or for another cargo is refused
--   E5  a saved set is never edited or deleted
--   E6  reads: the owner and an active colleague of the owning organisation list and open it; an outsider cannot; T2 refused
--   E7  grants: the save is service_role only; the table has no API grant; the reads are authenticated + service_role
--   E8  H1: erasing the owner's account (fn_anonymize_account) keeps the saved set and its legs intact
begin;

do $$
declare
  owner uuid := gen_random_uuid();
  colleague uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  org uuid := gen_random_uuid();
  pol text; pod text;
  vessel_av uuid := gen_random_uuid();
  cargo uuid := gen_random_uuid();
  other_cargo uuid := gen_random_uuid();
  load_req jsonb; dis_req jsonb; load_res jsonb; dis_res jsonb; route jsonb;
  r1 jsonb; r2 jsonb; r3 jsonb; e text; n_est int; n_set int; lst jsonb; one jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaSets1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (owner, 'pda-set-owner@example.test'), (colleague, 'pda-set-colleague@example.test'),
               (outsider, 'pda-set-outsider@example.test'), (basic, 'pda-set-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (owner, owner, 'pda-set-owner@example.test', 'Set Owner', 'cargo_owner', true, null, 'T3'),
    (colleague, colleague, 'pda-set-colleague@example.test', 'Set Colleague', 'cargo_owner', true, null, 'T3'),
    (outsider, outsider, 'pda-set-outsider@example.test', 'Set Outsider', 'cargo_owner', true, null, 'T4'),
    (basic, basic, 'pda-set-basic@example.test', 'Set Basic', 'cargo_owner', true, null, 'T2');
  insert into public.organizations (id, name) values (org, 'PDA Set Org') on conflict do nothing;
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (org, owner, 'admin', true, 'active'), (org, colleague, 'broker', true, 'active');

  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;

  -- two manual-quote legs (no tariff needed): one attributed line each, totals equal the line sums
  load_req := jsonb_build_object('portLocode', pol, 'callDate', '2026-11-01', 'vessel', jsonb_build_object('vesselName','MV SET TEST'),
                                 'call', jsonb_build_object('days', 3, 'cargoQuantityMt', 26000, 'requestedServices', jsonb_build_array('agency')));
  dis_req := jsonb_build_object('portLocode', pod, 'callDate', '2026-11-09', 'vessel', jsonb_build_object('vesselName','MV SET TEST'),
                                'call', jsonb_build_object('days', 3, 'cargoQuantityMt', 26000, 'requestedServices', jsonb_build_array('agency')));
  load_res := jsonb_build_object('coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','warnings','[]'::jsonb,
                                 'totals', jsonb_build_object('native', 1200),
                                 'generatedAt', '2026-10-18T10:00:00Z',
                                 'lines', jsonb_build_array(jsonb_build_object('label','Agency fee','basis','manual','amount',1200,
                                   'explanation','Authorized manual quotation: Agent quote A-1','manual',true,'manualReason','Agent quote A-1','enteredBy','@owner')));
  dis_res := jsonb_set(jsonb_set(load_res, '{totals,native}', '1500'), '{lines,0,amount}', '1500');
  route := jsonb_build_object(
    'title', pol || ' → ' || pod || ' · MV SET TEST · 26,000 MT',
    'canonical', jsonb_build_object('vesselAvailabilityId', vessel_av, 'vesselId', null, 'cargoId', cargo, 'quantityMt', 26000),
    'routeInput', jsonb_build_object('load', jsonb_build_object('portLocode', pol), 'discharge', jsonb_build_object('portLocode', pod)),
    'timeline', jsonb_build_object('loadPortDays', 3), 'transits', '[]'::jsonb,
    'totals', jsonb_build_object('allInKnown', 2700, 'allInComplete', null),
    'notSourced', '[]'::jsonb, 'allocation', 'vessel', 'displayCurrency', 'USD');

  -- E1 · save
  select count(*) into n_est from public.pda_estimates;
  r1 := public.pda_save_estimate_set(owner, org, load_req, load_res, dis_req, dis_res, route, null);
  if r1->>'replayed' <> 'false' or (r1->>'contentHash') !~ '^[0-9a-f]{64}$'
     or (select count(*) from public.pda_estimates) <> n_est + 2
     or not exists (select 1 from public.pda_estimate_sets where id = (r1->>'id')::uuid and load_estimate_id = (r1->>'loadEstimateId')::uuid
                    and discharge_estimate_id = (r1->>'dischargeEstimateId')::uuid and owner_org_id = org and cargo_id = cargo) then
    raise exception 'E1: a set with both legs expected: %', r1; end if;
  raise notice 'E1 ok: both legs and the set saved in one call; the content hash is computed by the database';

  -- E2 · the same content (another generation time) returns the same set
  r2 := public.pda_save_estimate_set(owner, org, load_req, jsonb_set(load_res, '{generatedAt}', '"2026-10-18T11:00:00Z"'), dis_req, dis_res, route, null);
  if r2->>'replayed' <> 'true' or r2->>'id' <> r1->>'id' or (select count(*) from public.pda_estimates) <> n_est + 2 then
    raise exception 'E2: an unchanged save must return the existing set: %', r2; end if;
  raise notice 'E2 ok: the same content returns the existing set; nothing new is written';

  -- E3 · a broken discharge leg (total ≠ line sum) leaves no orphan
  select count(*) into n_est from public.pda_estimates;
  select count(*) into n_set from public.pda_estimate_sets;
  begin
    perform public.pda_save_estimate_set(owner, org, load_req, jsonb_set(load_res, '{totals,native}', '999'),
                                         dis_req, jsonb_set(dis_res, '{totals,native}', '1'), route, null);
    e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TOTAL' or (select count(*) from public.pda_estimates) <> n_est or (select count(*) from public.pda_estimate_sets) <> n_set then
    raise exception 'E3: a failed leg must leave nothing behind (got %)', e; end if;
  raise notice 'E3 ok: a failure in a leg rolls back both legs and the set';

  -- E4 · supersede
  r3 := public.pda_save_estimate_set(owner, org, load_req, load_res, dis_req, jsonb_set(jsonb_set(dis_res, '{totals,native}', '1600'), '{lines,0,amount}', '1600'),
                                     jsonb_set(route, '{totals,allInKnown}', '2800'), (r1->>'id')::uuid);
  if r3->>'replayed' <> 'false' or (select supersedes_id from public.pda_estimate_sets where id = (r3->>'id')::uuid) <> (r1->>'id')::uuid then
    raise exception 'E4: a new version must supersede the first: %', r3; end if;
  begin perform public.pda_save_estimate_set(owner, org, load_req, load_res, dis_req, jsonb_set(jsonb_set(dis_res, '{totals,native}', '1700'), '{lines,0,amount}', '1700'),
                                             jsonb_set(route, '{totals,allInKnown}', '2900'), (r1->>'id')::uuid); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_CONFLICT' then raise exception 'E4: superseding an already superseded set must be PDA_CONFLICT, got %', e; end if;
  begin perform public.pda_save_estimate_set(outsider, null, load_req, load_res, dis_req, dis_res, jsonb_set(route, '{totals,allInKnown}', '3000'), (r3->>'id')::uuid); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'E4: another member superseding must be PDA_AUTH, got %', e; end if;
  begin perform public.pda_save_estimate_set(owner, org, load_req, load_res, dis_req, dis_res,
                                             jsonb_set(jsonb_set(route, '{canonical,cargoId}', to_jsonb(other_cargo::text)), '{totals,allInKnown}', '3100'), (r3->>'id')::uuid); e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_CONFLICT' then raise exception 'E4: a version for another cargo must be PDA_CONFLICT, got %', e; end if;
  raise notice 'E4 ok: a new version supersedes once; twice, by another member, or for another cargo is refused';

  -- E5 · immutable
  begin update public.pda_estimate_sets set title = 'x' where id = (r1->>'id')::uuid; e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'E5: an edit must be PDA_IMMUTABLE, got %', e; end if;
  begin delete from public.pda_estimate_sets where id = (r1->>'id')::uuid; e := null;
  exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'E5: a delete must be PDA_IMMUTABLE, got %', e; end if;
  raise notice 'E5 ok: a saved set is never edited or deleted';

  -- E6 · reads
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',owner,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  lst := public.list_my_pda_estimate_sets(20, null);
  -- both sets were saved in this one transaction (same created_at), so their order is not asserted here
  if jsonb_array_length(lst) <> 2
     or (select (x->>'isLatest')::boolean from jsonb_array_elements(lst) x where x->>'id' = r3->>'id') is not true
     or (select count(*) from jsonb_array_elements(lst) x where (x->>'isLatest')::boolean is false) <> 1
     or exists (select 1 from jsonb_array_elements(lst) x where (x->>'mine')::boolean is not true) then
    raise exception 'E6: the owner lists both versions, the latest flagged: %', lst; end if;
  one := public.get_pda_estimate_set((r3->>'id')::uuid);
  if one->'load'->>'portLocode' <> pol or one->'discharge'->>'portLocode' <> pod or jsonb_array_length(one->'discharge'->'lines') <> 1 then
    raise exception 'E6: the owner opens the set with both legs: %', one; end if;
  -- B2O-044 P1-1/P1-4: the member view carries no id key at all, and the '@owner' line reads as the owner's name
  if one::text ~ '"(ruleId|sourceId|tariffVersionId|terminalId|input)"\s*:' or one ? 'routeInput'
     or one->'discharge'->'lines'->0->>'enteredBy' is distinct from 'Set Owner' then
    raise exception 'E6: the member projection must hold no internal id and resolve the owner marker: %', one; end if;
  perform set_config('request.jwt.claim.sub', colleague::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',colleague,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  lst := public.list_my_pda_estimate_sets(20, null);
  if jsonb_array_length(lst) <> 2 or (lst->0->>'mine')::boolean is not false then raise exception 'E6: an active colleague lists the org''s sets: %', lst; end if;
  perform public.get_pda_estimate_set((r3->>'id')::uuid);
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  if jsonb_array_length(public.list_my_pda_estimate_sets(20, null)) <> 0 then raise exception 'E6: an outsider lists nothing'; end if;
  begin perform public.get_pda_estimate_set((r3->>'id')::uuid); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'E6: an outsider opening a set must be PDA_AUTH, got %', e; end if;
  begin perform public.get_pda_estimate_set(gen_random_uuid()); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'E6: an unknown id answers like a forbidden one, got %', e; end if;
  perform set_config('request.jwt.claim.sub', basic::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',basic,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.list_my_pda_estimate_sets(20, null); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TIER' then raise exception 'E6: a T2 member must be PDA_TIER, got %', e; end if;
  raise notice 'E6 ok: owner and active colleague read; outsider and unknown id refused alike; T2 refused';

  -- E7 · grants
  if has_function_privilege('authenticated', 'public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid)', 'execute')
     or has_function_privilege('anon', 'public.list_my_pda_estimate_sets(integer, timestamp with time zone)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_pda_estimate_set(uuid)', 'execute')
     or exists (select 1 from unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
                where has_table_privilege(ro, 'public.pda_estimate_sets', pr)) then
    raise exception 'E7: grants are not as designed'; end if;
  raise notice 'E7 ok: save service_role only; no table grant; reads authenticated + service_role';

  -- E8 · H1: erasing the owner keeps the set and both legs
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  select count(*) into n_set from public.pda_estimate_sets where owner_user_id = owner;
  perform public.fn_anonymize_account(owner);
  if (select count(*) from public.pda_estimate_sets where owner_user_id = owner) <> n_set
     or (select erased_at from public.users where id = owner) is null
     or not exists (select 1 from public.pda_estimates where id = (r3->>'loadEstimateId')::uuid) then
    raise exception 'E8: erasure must keep the saved sets and their legs'; end if;
  -- no name was frozen: the colleague now reads "Deleted account" on the owner's manual line (B2O-044 P1-4)
  if exists (select 1 from public.pda_estimate_lines l join public.pda_estimates x on x.id = l.estimate_id
              where x.id in ((r3->>'loadEstimateId')::uuid, (r3->>'dischargeEstimateId')::uuid) and l.entered_by_label <> '@owner') then
    raise exception 'E8: a saved line must hold the owner marker, not a name'; end if;
  perform set_config('request.jwt.claim.sub', colleague::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',colleague,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  one := public.get_pda_estimate_set((r3->>'id')::uuid);
  if one->'discharge'->'lines'->0->>'enteredBy' is distinct from 'Deleted account' then
    raise exception 'E8: after erasure the line must read "Deleted account", got %', one->'discharge'->'lines'->0->>'enteredBy'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin truncate public.pda_estimate_sets cascade; e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_IMMUTABLE' then raise exception 'E8: TRUNCATE must be refused, got %', e; end if;
  raise notice 'E8 ok: erasure keeps every set and leg, no name was frozen (reads "Deleted account"), TRUNCATE refused (H1, B2O-044)';
end $$;

do $m$ begin raise notice 'PDA ESTIMATE SETS: ALL ASSERTIONS PASSED'; end $m$;
rollback;
