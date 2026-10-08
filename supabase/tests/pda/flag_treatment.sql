begin;

do $$
declare
  maker uuid;
  checker uuid;
  sub_admin uuid;
  member uuid;
  outsider uuid;
  basic uuid;
  member_auth uuid;
  outsider_auth uuid;
  port_code text;
  other_port text;
  publisher uuid;
  source uuid;
  untrusted_source uuid;
  version uuid;
  terminal_version uuid;
  terminal uuid;
  other_terminal uuid;
  rule uuid;
  terminal_rule uuid;
  estimate uuid;
  batch uuid;
  context jsonb;
  header jsonb;
  denied boolean;
  before_versions integer;
begin
  maker := gen_random_uuid();
  checker := gen_random_uuid();
  sub_admin := gen_random_uuid();
  member := gen_random_uuid();
  outsider := gen_random_uuid();
  member_auth := member;
  outsider_auth := outsider;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    fixture.id,
    'authenticated',
    'authenticated',
    fixture.email,
    crypt('PdaBehavior1!', gen_salt('bf')),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  from (values
    (maker, 'pda-maker@example.test'),
    (checker, 'pda-checker@example.test'),
    (sub_admin, 'pda-sub-admin@example.test'),
    (member, 'pda-member@example.test'),
    (outsider, 'pda-outsider@example.test')
  ) as fixture(id, email);

  insert into public.users (
    id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier
  ) values
    (maker, maker, 'pda-maker@example.test', 'PDA Maker', 'admin', true, null, 'T4'),
    (checker, checker, 'pda-checker@example.test', 'PDA Checker', 'admin', true, null, 'T4'),
    (sub_admin, sub_admin, 'pda-sub-admin@example.test', 'PDA Sub Admin', 'admin', true, 'sub', 'T4'),
    (member, member, 'pda-member@example.test', 'PDA Member', 'cargo_owner', true, null, 'T3'),
    (outsider, outsider, 'pda-outsider@example.test', 'PDA Outsider', 'cargo_owner', true, null, 'T3');

  select locode into port_code from public.ports where is_active and is_verified order by (locode = 'EGALY') desc, locode limit 1;
  select locode into other_port from public.ports where is_active and is_verified and locode <> port_code order by locode limit 1;
  if port_code is null or other_port is null then raise exception 'PDA TEST: two verified ports required'; end if;

  denied := false;
  begin perform public.pda_upsert_tariff_publisher(sub_admin, jsonb_build_object('name','Denied publisher','publisherType','agent'));
  exception when others then
    if sqlerrm like 'PDA_AUTH:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: sub-admin unexpectedly passed owner-only gate'; end if;

  publisher := public.pda_upsert_tariff_publisher(maker, jsonb_build_object(
    'name','PDA Test Port Authority','publisherType','port_authority','country','Test'
  ));
  source := public.pda_register_tariff_source(maker, jsonb_build_object(
    'publisherId',publisher,'title','PDA Test Tariff 2026','sourceFilename','pda-test.pdf',
    'mimeType','application/pdf','sha256',repeat('a',64),'authority','official',
    'effectiveFrom','2026-01-01','currentnessNote','Transactional smoke fixture'
  ));
  untrusted_source := public.pda_register_tariff_source(maker, jsonb_build_object(
    'publisherId',publisher,'title','PDA Untrusted Extraction','sourceFilename','pda-untrusted.txt',
    'mimeType','text/plain','sha256',repeat('b',64),'authority','unverified',
    'effectiveFrom','2026-01-01','currentnessNote','Must never pass publication gate'
  ));

  terminal := public.pda_upsert_port_terminal(maker, jsonb_build_object('portLocode',port_code,'name','PDA Test Terminal'));
  denied := false;
  begin perform public.pda_verify_port_terminal(maker, terminal);
  exception when others then if sqlerrm like 'PDA_CHECKER:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA TEST: terminal maker verified own terminal'; end if;
  perform public.pda_verify_port_terminal(checker, terminal);
  other_terminal := public.pda_upsert_port_terminal(maker, jsonb_build_object('portLocode',other_port,'name','PDA Other Terminal'));
  perform public.pda_verify_port_terminal(checker, other_terminal);

  version := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'publisherId',publisher,'name','PDA Wave 2 Egypt 488 load','scope','port_call',
    'versionNo',1,'currency','USD','effectiveFrom','2026-01-01','roundingMode','half_up',
    'decimalPlaces',2,'primarySourceId',source
  ));

  -- ── PDA Wave 2: flag treatment + the real Egypt 488/2015 foreign-USD package ──
  -- The 17 rules are docs/data/pda-tariffs/egypt-488-2015/rules.foreign-usd.json verbatim
  -- (regenerate this file when the package changes); their placeholder source ids are
  -- mapped to this transaction's registered source.
  perform public.pda_replace_tariff_rules(maker, version, (
    select jsonb_agg(r || jsonb_build_object('sourceId', source) order by ord)
    from jsonb_array_elements($json$[{"code": "port_dues", "label": "Port dues (foreign, per GRT per call)", "basis": "per_gt", "rate": 0.35, "priority": 10, "applicability": {"requestedServices": ["port_dues"], "flagTreatments": ["foreign"]}, "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §6-1", "sourceExcerpt": "Port dues: 35 cents per GRT (foreign vessels, §6)"}, {"code": "light_dues", "label": "Light dues (foreign, per GRT; full rate — may be 10–25 % lower when the call is combined with a Suez Canal transit, Decree 416/2019)", "basis": "per_gt", "rate": 0.15, "priority": 11, "applicability": {"requestedServices": ["port_dues"], "flagTreatments": ["foreign"]}, "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §6-5", "sourceExcerpt": "Light dues 15 cents per GRT. Full rate; the 416/2019 reductions for calls combined with a Suez transit are not applied."}, {"code": "berthing_dues", "label": "Berthing dues (USD 0.02 per GRT per day)", "basis": "manual_quote", "priority": 12, "applicability": {"requestedServices": ["port_dues"], "flagTreatments": ["foreign"]}, "manualInstructions": "USD 0.02 x GRT x days alongside or at anchorage/buoy. Part of a day counts as a day; the day starts at midnight. (The engine has no GT x days basis yet.)", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §6-2", "sourceExcerpt": "Berthing dues 2 cents per GRT per day"}, {"code": "stay_fee", "label": "Stay fee (USD 0.02 per GRT per day, conditional)", "basis": "manual_quote", "priority": 13, "applicability": {"requestedServices": ["port_dues"], "flagTreatments": ["foreign"]}, "manualInstructions": "USD 0.02 x GRT x days, from day 16 of berthing OR from the day after cargo operations end, whichever is first. Enter 0 when neither applies.", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §6-3", "sourceExcerpt": "Stay fee 2 cents per GRT per day from the 16th day or the day after operations end"}, {"code": "pilotage_arrival", "label": "Pilotage in (outer anchorage to berth)", "basis": "tiered_flat", "unit": "gt", "priority": 20, "applicability": {"requestedServices": ["pilotage"], "flagTreatments": ["foreign"]}, "bands": [{"order": 1, "lowerBound": 0, "upperBound": 999, "flatAmount": 167}, {"order": 2, "lowerBound": 999, "upperBound": 4999, "flatAmount": 273}, {"order": 3, "lowerBound": 4999, "upperBound": 9999, "flatAmount": 381}, {"order": 4, "lowerBound": 9999, "upperBound": 19999, "flatAmount": 802}, {"order": 5, "lowerBound": 19999, "upperBound": 29999, "flatAmount": 1055}, {"order": 6, "lowerBound": 29999, "upperBound": 39999, "flatAmount": 1870}, {"order": 7, "lowerBound": 39999, "upperBound": 49999, "flatAmount": 2627}, {"order": 8, "lowerBound": 49999, "upperBound": 59999, "flatAmount": 2772}, {"order": 9, "lowerBound": 59999, "upperBound": null, "flatAmount": 3261}], "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §4-1", "sourceExcerpt": "Pilotage, foreign vessels, outer anchorage <-> berth, USD per movement by GRT band"}, {"code": "pilotage_departure", "label": "Pilotage out (berth to outer anchorage)", "basis": "tiered_flat", "unit": "gt", "priority": 21, "applicability": {"requestedServices": ["pilotage"], "flagTreatments": ["foreign"]}, "bands": [{"order": 1, "lowerBound": 0, "upperBound": 999, "flatAmount": 167}, {"order": 2, "lowerBound": 999, "upperBound": 4999, "flatAmount": 273}, {"order": 3, "lowerBound": 4999, "upperBound": 9999, "flatAmount": 381}, {"order": 4, "lowerBound": 9999, "upperBound": 19999, "flatAmount": 802}, {"order": 5, "lowerBound": 19999, "upperBound": 29999, "flatAmount": 1055}, {"order": 6, "lowerBound": 29999, "upperBound": 39999, "flatAmount": 1870}, {"order": 7, "lowerBound": 39999, "upperBound": 49999, "flatAmount": 2627}, {"order": 8, "lowerBound": 49999, "upperBound": 59999, "flatAmount": 2772}, {"order": 9, "lowerBound": 59999, "upperBound": null, "flatAmount": 3261}], "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §4-1", "sourceExcerpt": "Pilotage, foreign vessels, outer anchorage <-> berth, USD per movement by GRT band"}, {"code": "towage", "label": "Towage (USD per tug per hour)", "basis": "manual_quote", "priority": 30, "applicability": {"requestedServices": ["towage"], "flagTreatments": ["foreign"]}, "manualInstructions": "USD per tug per hour by GT: <=300 500; 301-999 650 (on request); 1,000-4,999 700 (min 1 tug); 5,000-9,999 750; 10,000-19,999 800; 20,000-29,999 850; 30,000-39,999 900; 40,000-49,999 950; 50,000-59,999 1,000; 60,000-79,999 1,200; 80,000-99,999 1,400; 100,000-119,999 1,600; 120,000-139,999 1,800; 140,000-159,999 2,000; 160,000-179,999 2,200; 180,000-199,999 2,400; >=200,000 2,600. From 5,000 GT minimum 2 tugs per movement. Compulsory above 999 GT. Part hour = hour; minimum hours Port Tawfik/El-Zeitiat 2, Adabiya/Safaga 3, East Port Said 2. +100% outside the port; +30% sunset-sunrise, weekends, official holidays. Multiply by tugs x hours x movements.", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 5", "sourceExcerpt": "Towage for pilotage, foreign vessels, USD per tug per hour"}, {"code": "mooring", "label": "Mooring boats (USD per boat per hour)", "basis": "manual_quote", "priority": 31, "applicability": {"requestedServices": ["mooring"], "flagTreatments": ["foreign"]}, "manualInstructions": "USD per mooring boat per hour by GT: <=300 15; 301-999 20; 1,000-4,999 30; 5,000-9,999 50; 10,000-19,999 75; 20,000-29,999 100; 30,000-39,999 125; 40,000-49,999 160; 50,000-59,999 200; >=60,000 240. Same +100% / +30% surcharges and minimum hours as towage. Multiply by boats x hours x operations (mooring and unmooring).", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 6", "sourceExcerpt": "Mooring, foreign vessels, USD per mooring boat per hour"}, {"code": "cleanliness_fee", "label": "Cleanliness (garbage) fee, by GT and tariff cargo class", "basis": "manual_quote", "priority": 40, "manualInstructions": "USD per call by GT band (<=300 | 301-999 | 1,000-4,999 | 5,000-9,999 | 10,000-19,999 | 20,000-29,999 | 30,000-39,999 | 40,000-49,999 | 50,000-59,999 | >=60,000). container: 50, 60, 70, 80, 90, 100, 110, 120, 130, 140; general cargo: 120, 140, 160, 180, 200, 220, 240, 260, 280, 300; clean bulk: 150, 175, 200, 225, 250, 275, 300, 325, 350, 375; unclean bulk: 200, 225, 250, 275, 300, 325, 350, 375, 400, 425. Choose the column for the cargo actually carried (container / general cargo / clean bulk / unclean bulk).", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 7", "sourceExcerpt": "Cleanliness fee, foreign vessels, USD per call, by GT band and cargo type", "applicability": {"flagTreatments": ["foreign"]}}, {"code": "waste_reception", "label": "Waste reception (USD 25 per ton, min 10 t)", "basis": "manual_quote", "priority": 50, "applicability": {"requestedServices": ["waste"], "flagTreatments": ["foreign"]}, "manualInstructions": "Port-authority waste reception: USD 25 per ton, minimum 10 tons (USD 250). Incinerator USD 150/t; garbage truck USD 75/h. Add the 15% Chapter 2 administration charge.", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Ch. 2 §1-8-1", "sourceExcerpt": "Waste reception USD 25/ton foreign, minimum 10 tons"}, {"code": "sailing_permit", "label": "Sailing permit", "basis": "flat", "amount": 30, "priority": 60, "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §6-6", "sourceExcerpt": "Sailing permit USD 30 (other vessels)", "applicability": {"flagTreatments": ["foreign"]}}, {"code": "berthing_form", "label": "Berthing form", "basis": "flat", "amount": 5, "priority": 61, "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 2 §6", "sourceExcerpt": "Berthing form USD 5", "applicability": {"flagTreatments": ["foreign"]}}, {"code": "site_occupation", "label": "Site occupation (USD 12 per LOA metre per day, conditional)", "basis": "manual_quote", "priority": 62, "applicability": {"requestedServices": ["port_dues"], "flagTreatments": ["foreign"]}, "manualInstructions": "Only when berthed without commercial work for reasons not attributable to the port authority, or in bad weather: USD 12 x LOA (m, part metre = metre) x days. Enter 0 otherwise.", "sourceId": "00000000-0000-4000-9000-000000000488", "sourcePage": "Art. 4", "sourceExcerpt": "Site-occupation charge USD 12 per metre LOA per day (foreign)"}, {"code": "seamens_club", "label": "Seamen's Club contribution (Decree 800/2016)", "basis": "flat", "amount": 25, "priority": 70, "sourceId": "00000000-0000-4000-9000-000000000800", "sourcePage": "Art. 9(4-2)", "sourceExcerpt": "Seamen's Club USD 25 per foreign vessel call, collected by the agent", "applicability": {"flagTreatments": ["foreign"]}}, {"code": "agency_fee", "label": "Agency fee, one port, first 5 days (Decree 800/2016)", "basis": "tiered_flat", "unit": "gt", "priority": 80, "applicability": {"requestedServices": ["agency"], "maxGt": 300000, "flagTreatments": ["foreign"]}, "bands": [{"order": 1, "lowerBound": 0, "upperBound": 3000, "flatAmount": 500}, {"order": 2, "lowerBound": 3000, "upperBound": 5000, "flatAmount": 600}, {"order": 3, "lowerBound": 5000, "upperBound": 10000, "flatAmount": 800}, {"order": 4, "lowerBound": 10000, "upperBound": 20000, "flatAmount": 1000}, {"order": 5, "lowerBound": 20000, "upperBound": 40000, "flatAmount": 1200}, {"order": 6, "lowerBound": 40000, "upperBound": 50000, "flatAmount": 1400}, {"order": 7, "lowerBound": 50000, "upperBound": 60000, "flatAmount": 1600}, {"order": 8, "lowerBound": 60000, "upperBound": 70000, "flatAmount": 1800}, {"order": 9, "lowerBound": 70000, "upperBound": 80000, "flatAmount": 2000}, {"order": 10, "lowerBound": 80000, "upperBound": 90000, "flatAmount": 2200}, {"order": 11, "lowerBound": 90000, "upperBound": 100000, "flatAmount": 2400}, {"order": 12, "lowerBound": 100000, "upperBound": 110000, "flatAmount": 2600}, {"order": 13, "lowerBound": 110000, "upperBound": 120000, "flatAmount": 2800}, {"order": 14, "lowerBound": 120000, "upperBound": 130000, "flatAmount": 3000}, {"order": 15, "lowerBound": 130000, "upperBound": 140000, "flatAmount": 3200}, {"order": 16, "lowerBound": 140000, "upperBound": 150000, "flatAmount": 3400}, {"order": 17, "lowerBound": 150000, "upperBound": 160000, "flatAmount": 3600}, {"order": 18, "lowerBound": 160000, "upperBound": 170000, "flatAmount": 3800}, {"order": 19, "lowerBound": 170000, "upperBound": 180000, "flatAmount": 4000}, {"order": 20, "lowerBound": 180000, "upperBound": 190000, "flatAmount": 4200}, {"order": 21, "lowerBound": 190000, "upperBound": 200000, "flatAmount": 4400}, {"order": 22, "lowerBound": 200000, "upperBound": 210000, "flatAmount": 4600}, {"order": 23, "lowerBound": 210000, "upperBound": 220000, "flatAmount": 4800}, {"order": 24, "lowerBound": 220000, "upperBound": 230000, "flatAmount": 5000}, {"order": 25, "lowerBound": 230000, "upperBound": 240000, "flatAmount": 5200}, {"order": 26, "lowerBound": 240000, "upperBound": 250000, "flatAmount": 5400}, {"order": 27, "lowerBound": 250000, "upperBound": 260000, "flatAmount": 5600}, {"order": 28, "lowerBound": 260000, "upperBound": 270000, "flatAmount": 5800}, {"order": 29, "lowerBound": 270000, "upperBound": 280000, "flatAmount": 6000}, {"order": 30, "lowerBound": 280000, "upperBound": 290000, "flatAmount": 6200}, {"order": 31, "lowerBound": 290000, "upperBound": 300000, "flatAmount": 6400}, {"order": 32, "lowerBound": 300000, "upperBound": null, "flatAmount": 6600}], "sourceId": "00000000-0000-4000-9000-000000000800", "sourcePage": "Art. 45", "sourceExcerpt": "Shipping agency fees, USD per foreign vessel, one port, first 5 days, by GRT band; +200 per additional 10,000 GRT above 40,000"}, {"code": "agency_fee_above_300000_gt", "label": "Agency fee above 300,000 GT (Decree 800/2016)", "basis": "manual_quote", "priority": 81, "applicability": {"requestedServices": ["agency"], "minGt": 300001, "flagTreatments": ["foreign"]}, "manualInstructions": "One port, first 5 days: USD 1,200 + 200 per started 10,000 GRT above 40,000 (e.g. 300,001-310,000 GT = 6,600).", "sourceId": "00000000-0000-4000-9000-000000000800", "sourcePage": "Art. 45", "sourceExcerpt": "Shipping agency fees: +200 per additional 10,000 GRT above 40,000, without upper limit"}, {"code": "agency_fee_adjustments", "label": "Agency fee: two ports, Suez transit or extra days", "basis": "manual_quote", "priority": 82, "applicability": {"requestedServices": ["agency"], "flagTreatments": ["foreign"]}, "manualInstructions": "Enter 0 for a one-port call of up to 5 days. Two ports or a Suez transit: replace the one-port fee with the other column (800, 900, 1,200, 1,500, 1,800, then +250 per started 10,000 GRT) and enter the difference here. Each additional day (or part) after day 5: +10% of the band rate, unless the delay is due to repair or force majeure.", "sourceId": "00000000-0000-4000-9000-000000000800", "sourcePage": "Art. 45", "sourceExcerpt": "Two-port / Suez-transit column and +10% per additional day after the first 5 days"}]$json$::jsonb) with ordinality as x(r, ord)
  ));
  if (select count(*) from public.port_tariff_rules where tariff_version_id = version) <> 17 then
    raise exception 'PDA WAVE2 TEST: the Egypt package did not load all 17 rules';
  end if;
  if exists (select 1 from public.port_tariff_rules where tariff_version_id = version
              and applicability->'flagTreatments' is distinct from '["foreign"]'::jsonb) then
    raise exception 'PDA WAVE2 TEST: a stored Egypt rule is not foreign-only';
  end if;

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','bad_flag','label','Bad flag','basis','per_call','amount',1,'priority',10,
    'applicability',jsonb_build_object('flagTreatments',jsonb_build_array('domestic')),'sourceId',source,'sourcePage','4')));
  exception when others then if sqlerrm like 'PDA_APPLICABILITY:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA WAVE2 TEST: an unknown flag treatment was accepted'; end if;
  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','dup_flag','label','Duplicate flag','basis','per_call','amount',1,'priority',10,
    'applicability',jsonb_build_object('flagTreatments',jsonb_build_array('foreign','foreign')),'sourceId',source,'sourcePage','4')));
  exception when others then if sqlerrm like 'PDA_APPLICABILITY:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA WAVE2 TEST: a duplicated flag treatment was accepted'; end if;
  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','flag_text','label','Flag as text','basis','per_call','amount',1,'priority',10,
    'applicability',jsonb_build_object('flagTreatments','foreign'),'sourceId',source,'sourcePage','4')));
  exception when others then if sqlerrm like 'PDA_APPLICABILITY:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA WAVE2 TEST: a non-array flag treatment was accepted'; end if;

  if (select count(*) from public.port_tariff_rules where tariff_version_id = version) <> 17 then
    raise exception 'PDA WAVE2 TEST: the accepted Egypt rule set changed after refused replacements';
  end if;
  perform public.pda_submit_tariff_version(maker, version);
  perform public.pda_publish_tariff_version(checker, version);

  perform set_config('request.jwt.claim.sub', member_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member_auth,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  context := public.get_pda_calculation_context(port_code, null, '2026-10-07');
  if context->>'coverage' <> 'published' then raise exception 'PDA WAVE2 TEST: the Egypt tariff did not publish: %', context->>'coverage'; end if;
  if jsonb_array_length(context#>'{tariffVersion,rules}') <> 17
     or exists (select 1 from jsonb_array_elements(context#>'{tariffVersion,rules}') r
                 where r#>'{applicability,flagTreatments}' is distinct from '["foreign"]'::jsonb) then
    raise exception 'PDA WAVE2 TEST: flagTreatments did not reach the member context';
  end if;
end $$;

do $m$ begin raise notice 'PDA WAVE 2 FLAG TREATMENT + EGYPT 488 LOAD: ALL ASSERTIONS PASSED'; end $m$;
rollback;
