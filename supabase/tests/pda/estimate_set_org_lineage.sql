-- PDA · a superseding estimate set keeps its predecessor's organisation (20261018140000, Codex C2O-159 P1-5).
--   L1  a first version takes the caller's organisation (a current seat)
--   L2  a member with two active seats cannot move a new version into the other organisation
--   L3  a set saved without an organisation stays without one when superseded
begin;

do $$
declare
  owner uuid := gen_random_uuid();
  org_a uuid := gen_random_uuid();
  org_b uuid := gen_random_uuid();
  pol text; pod text;
  load_req jsonb; dis_req jsonb; leg_res jsonb; route jsonb; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000'::uuid, owner, 'authenticated', 'authenticated', 'pda-lin-owner@example.test',
          crypt('PdaLineage1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier)
  values (owner, owner, 'pda-lin-owner@example.test', 'Lineage Owner', 'cargo_owner', true, null, 'T3');
  insert into public.organizations (id, name) values (org_a, 'Lineage Org A'), (org_b, 'Lineage Org B');
  insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
    (org_a, owner, 'admin', true, 'active'), (org_b, owner, 'admin', true, 'active');
  select locode into pol from public.ports where is_active and is_verified order by locode limit 1;
  select locode into pod from public.ports where is_active and is_verified and locode <> pol order by locode limit 1;
  load_req := jsonb_build_object('portLocode', pol, 'callDate', '2026-11-01', 'vessel', jsonb_build_object('vesselName','MV LINEAGE'),
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

  -- L1
  r1 := public.pda_save_estimate_set(owner, org_a, load_req, leg_res, dis_req, leg_res, route, null);
  if (select owner_org_id from public.pda_estimate_sets where id = (r1->>'id')::uuid) is distinct from org_a then
    raise exception 'L1: a first version takes the caller''s organisation'; end if;
  raise notice 'L1 ok: a first version takes the caller''s organisation';

  -- L2: the caller asks for org B; the new version stays in org A, legs included
  r2 := public.pda_save_estimate_set(owner, org_b, load_req, jsonb_set(jsonb_set(leg_res, '{totals,native}', '1100'), '{lines,0,amount}', '1100'),
                                     dis_req, leg_res, jsonb_set(route, '{totals,allInKnown}', '2100'), (r1->>'id')::uuid);
  if (select owner_org_id from public.pda_estimate_sets where id = (r2->>'id')::uuid) is distinct from org_a
     or (select owner_org_id from public.pda_estimates where id = (r2->>'loadEstimateId')::uuid) is distinct from org_a then
    raise exception 'L2: a superseding version must stay in its predecessor''s organisation: %', r2; end if;
  raise notice 'L2 ok: a member with two seats cannot move a new version into the other organisation';

  -- L3: no organisation stays no organisation
  r3 := public.pda_save_estimate_set(owner, null, load_req, jsonb_set(jsonb_set(leg_res, '{totals,native}', '1200'), '{lines,0,amount}', '1200'),
                                     dis_req, leg_res, jsonb_set(jsonb_set(route, '{totals,allInKnown}', '2200'), '{canonical,cargoId}', to_jsonb(gen_random_uuid())), null);
  r4 := public.pda_save_estimate_set(owner, org_b, load_req, jsonb_set(jsonb_set(leg_res, '{totals,native}', '1300'), '{lines,0,amount}', '1300'),
                                     dis_req, leg_res, jsonb_set(jsonb_set(route, '{totals,allInKnown}', '2300'), '{canonical,cargoId}',
                                     (select to_jsonb(cargo_id) from public.pda_estimate_sets where id = (r3->>'id')::uuid)), (r3->>'id')::uuid);
  if (select owner_org_id from public.pda_estimate_sets where id = (r4->>'id')::uuid) is not null then
    raise exception 'L3: a set without an organisation stays without one: %', r4; end if;
  raise notice 'L3 ok: a set without an organisation stays without one when superseded';
end $$;

do $m$ begin raise notice 'PDA ESTIMATE SET ORG LINEAGE: ALL ASSERTIONS PASSED'; end $m$;
rollback;
