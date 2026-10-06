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

  select locode into port_code from public.ports where is_active and is_verified order by locode limit 1;
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
    'portLocode',port_code,'publisherId',publisher,'name','PDA Test Port Call','scope','port_call',
    'versionNo',1,'currency','USD','effectiveFrom','2026-01-01','roundingMode','half_up',
    'decimalPlaces',2,'primarySourceId',source
  ));

  -- ── PR-10a: compound bases, duration rounding, settlement mode ────────────
  perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(
    jsonb_build_object('code','berthing_dues','label','Berthing dues','basis','per_gt_day','rate',0.02,
      'rounding','started','priority',10,'sourceId',source,'sourcePage','6','sourceExcerpt','0.02 per GRT per day'),
    jsonb_build_object('code','site_occupation','label','Site occupation','basis','per_loa_day','rate',12,
      'rounding','started','unitSize',1,'priority',20,'sourceId',source,'sourcePage','7'),
    jsonb_build_object('code','berth_hourly','label','Berth hourly','basis','per_loa_hour','rate',0.1,
      'rounding','started','unitSize',1,'priority',30,'sourceId',source,'sourcePage','8'),
    jsonb_build_object('code','agency_account','label','Agency on account','basis','per_call','amount',50,
      'priority',40,'applicability',jsonb_build_object('settlementModes',jsonb_build_array('agent_account')),
      'sourceId',source,'sourcePage','9'),
    jsonb_build_object('code','legacy_day','label','Legacy per day','basis','per_day','rate',10,
      'priority',50,'sourceId',source,'sourcePage','10')
  ));
  if (select duration_rounding || '/' || unit_size::text from public.port_tariff_rules where tariff_version_id = version and code = 'berthing_dues') <> 'started/1.000000' then
    raise exception 'PDA PR10 TEST: started rounding not stored';
  end if;
  if (select duration_rounding || '/' || unit_size::text from public.port_tariff_rules where tariff_version_id = version and code = 'legacy_day') <> 'exact/1.000000' then
    raise exception 'PDA PR10 TEST: an existing-style rule did not default to exact, unit 1';
  end if;

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','bad_round','label','Bad rounding','basis','per_day','rate',1,'rounding','nearest','priority',10,'sourceId',source,'sourcePage','4')));
  exception when others then if sqlerrm like 'PDA_ROUNDING:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA PR10 TEST: an unknown rounding was accepted'; end if;

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','bad_unit','label','Bad unit','basis','per_day','rate',1,'rounding','started','unitSize',0,'priority',10,'sourceId',source,'sourcePage','4')));
  exception when others then if sqlerrm like 'PDA_ROUNDING:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA PR10 TEST: a zero unit size was accepted'; end if;

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','no_rate','label','No rate','basis','per_gt_day','priority',10,'sourceId',source,'sourcePage','4')));
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'PDA PR10 TEST: a compound basis without a rate was accepted'; end if;

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','bad_mode','label','Bad mode','basis','per_call','amount',1,'priority',10,
    'applicability',jsonb_build_object('settlementModes',jsonb_build_array('credit')),'sourceId',source,'sourcePage','4')));
  exception when others then if sqlerrm like 'PDA_APPLICABILITY:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA PR10 TEST: an unknown settlement mode was accepted'; end if;

  -- the failed calls rolled back their own subtransactions: the good rules are still there
  if (select count(*) from public.port_tariff_rules where tariff_version_id = version) <> 5 then
    raise exception 'PDA PR10 TEST: the accepted rule set changed after refused replacements';
  end if;
  perform public.pda_submit_tariff_version(maker, version);
  perform public.pda_publish_tariff_version(checker, version);

  perform set_config('request.jwt.claim.sub', member_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member_auth,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  context := public.get_pda_calculation_context(port_code, null, '2026-06-01');
  if context->>'coverage' <> 'published' then raise exception 'PDA PR10 TEST: the compound tariff did not publish: %', context->>'coverage'; end if;
  if (select r->>'rounding' || '/' || (r->>'unitSize') from jsonb_array_elements(context#>'{tariffVersion,rules}') r where r->>'code' = 'berthing_dues') is distinct from 'started/1.000000' then
    raise exception 'PDA PR10 TEST: the context does not carry rounding and unit size: %', context#>'{tariffVersion,rules}';
  end if;
  if not exists (select 1 from jsonb_array_elements(context#>'{tariffVersion,rules}') r
                  where r->>'code' = 'agency_account' and r#>'{applicability,settlementModes}' = '["agent_account"]'::jsonb) then
    raise exception 'PDA PR10 TEST: settlementModes did not reach the context';
  end if;
end $$;

select 'PDA PR-10a COMPOUND BASES: ALL ASSERTIONS PASSED' as result;
rollback;
