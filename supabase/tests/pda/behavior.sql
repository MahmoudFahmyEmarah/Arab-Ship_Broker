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

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','broken_tier','label','Broken tier','basis','tiered_rate','unit','gt','priority',10,'sourceId',source,'sourcePage','4',
    'bands',jsonb_build_array(
      jsonb_build_object('order',1,'lowerBound',0,'upperBound',100,'rate',1),
      jsonb_build_object('order',2,'lowerBound',90,'rate',1)
    )
  )));
  exception when others then
    if sqlerrm like 'PDA_BANDS:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: malformed tariff bands were accepted'; end if;

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','bad_range','label','Bad range','basis','per_call','amount',1,'priority',10,'sourceId',source,'sourcePage','4',
    'applicability',jsonb_build_object('minGt',10000,'maxGt',5000)
  )));
  exception when others then if sqlerrm like 'PDA_APPLICABILITY:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA TEST: inverted applicability range was accepted'; end if;

  perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','port_dues','label','Port dues','basis','per_call','amount',100,'priority',10,
    'sourceId',untrusted_source,'sourcePage','4','sourceExcerpt','Untrusted extraction'
  )));
  denied := false;
  begin perform public.pda_submit_tariff_version(maker, version);
  exception when others then if sqlerrm like 'PDA_SOURCE:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA TEST: rule-level untrusted evidence passed submission'; end if;

  perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','port_dues','label','Port dues','basis','per_call','amount',100,'priority',10,
    'sourceId',source,'sourcePage','4','sourceExcerpt','Port dues per call'
  )));
  select id into rule from public.port_tariff_rules where tariff_version_id = version and code = 'port_dues';
  perform public.pda_submit_tariff_version(maker, version);

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','port_dues','label','Changed','basis','per_call','amount',1,'priority',10,'sourceId',source,'sourcePage','4'
  )));
  exception when others then
    if sqlerrm like 'PDA_IMMUTABLE:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: submitted rules remained mutable'; end if;

  perform public.pda_return_tariff_version(checker, version, 'Correct the evidence wording');
  if (select status from public.port_tariff_versions where id = version) <> 'draft' then
    raise exception 'PDA TEST: checker return did not restore the draft';
  end if;
  perform public.pda_submit_tariff_version(maker, version);

  denied := false;
  begin perform public.pda_publish_tariff_version(maker, version);
  exception when others then
    if sqlerrm like 'PDA_CHECKER:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: maker approved own tariff'; end if;
  perform public.pda_publish_tariff_version(checker, version);

  terminal_version := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'terminalId',terminal,'publisherId',publisher,'name','PDA Test Terminal Tariff','scope','terminal',
    'versionNo',1,'currency','USD','effectiveFrom','2026-01-01','roundingMode','half_up',
    'decimalPlaces',2,'primarySourceId',source
  ));
  perform public.pda_replace_tariff_rules(maker, terminal_version, jsonb_build_array(jsonb_build_object(
    'code','terminal_fee','label','Terminal fee','basis','per_call','amount',250,'priority',10,
    'sourceId',source,'sourcePage','5','sourceExcerpt','Terminal fee per call'
  )));
  select id into terminal_rule from public.port_tariff_rules where tariff_version_id = terminal_version and code = 'terminal_fee';
  perform public.pda_submit_tariff_version(maker, terminal_version);
  perform public.pda_publish_tariff_version(checker, terminal_version);

  denied := false;
  begin perform public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'publisherId',publisher,'name','Duplicate port set','scope','towage',
    'versionNo',1,'currency','USD','effectiveFrom','2026-01-01','primarySourceId',source
  ));
  exception when others then if sqlerrm like 'PDA_SET:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA TEST: a second active consolidated port-wide set was accepted'; end if;

  perform set_config('request.jwt.claim.sub', member_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member_auth,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  context := public.get_pda_calculation_context(port_code, terminal, '2026-06-01');
  if context->>'coverage' <> 'published' or context#>>'{tariffVersion,id}' <> terminal_version::text then
    raise exception 'PDA TEST: exact terminal tariff did not outrank the port-wide fallback';
  end if;

  denied := false;
  begin perform public.get_pda_calculation_context(port_code, other_terminal, '2026-06-01');
  exception when others then
    if sqlerrm like 'PDA_TERMINAL:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: cross-port terminal was accepted'; end if;

  estimate := public.pda_save_estimate(member, null, jsonb_build_object(
    'portLocode',port_code,'terminalId',terminal,'callDate','2026-06-01',
    'vessel',jsonb_build_object('vesselName','PDA TEST'),'call',jsonb_build_object('days',1,'requestedServices',jsonb_build_array('port_dues'))
  ), jsonb_build_object(
    'coverage','published','tariffVersionId',terminal_version,'nativeCurrency','USD','totals',jsonb_build_object('native',250),
    'warnings','[]'::jsonb,'generatedAt',now(),
    'lines',jsonb_build_array(jsonb_build_object(
      'ruleId',terminal_rule,'ruleCode','terminal_fee','label','Terminal fee','basis','per_call','quantity',1,'rate',250,'amount',250,
      'explanation','Terminal fee per call','inputs',jsonb_build_object('quantity',1,'rate',250),'manual',false,
      'evidence',jsonb_build_object('sourceId',source,'title','PDA Test Tariff 2026','page','5')
    ))
  ), null);
  if not public.fn_can_read_pda_estimate(estimate) then raise exception 'PDA TEST: owner cannot read estimate'; end if;
  header := public.fn_pda_estimate_header(estimate);
  if header->>'terminalName' <> 'PDA Test Terminal' or header->>'callDate' <> '2026-06-01'
     or header->>'lineCount' <> '1' or header ? 'input' or header ? 'lines' then
    raise exception 'PDA TEST: minimal estimate header is incomplete or leaks private detail';
  end if;

  denied := false;
  begin perform public.pda_save_estimate(member, null, jsonb_build_object(
    'portLocode',port_code,'terminalId',terminal,'callDate','2026-06-01','vessel','{}'::jsonb,
    'call',jsonb_build_object('days',1,'requestedServices','[]'::jsonb)
  ), jsonb_build_object(
    'coverage','published','tariffVersionId',terminal_version,'nativeCurrency','USD','totals',jsonb_build_object('native',0),
    'warnings','[]'::jsonb,'generatedAt',now(),'lines','[]'::jsonb
  ), null);
  exception when others then if sqlerrm like 'PDA_COVERAGE:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'PDA TEST: a zero-line estimate reported published coverage'; end if;

  denied := false;
  begin update public.pda_estimates set native_total = 1 where id = estimate;
  exception when others then
    if sqlerrm like 'PDA_IMMUTABLE:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: saved estimate was mutable'; end if;

  perform set_config('request.jwt.claim.sub', outsider_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider_auth,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  if public.fn_can_read_pda_estimate(estimate) then raise exception 'PDA TEST: outsider can read estimate'; end if;
  update public.users set subscription_tier = 'T2' where id = outsider;
  basic := outsider;
  denied := false;
  begin perform public.get_pda_estimate(estimate);
  exception when others then
    if sqlerrm like 'PDA_AUTH:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: governed estimate read leaked to outsider'; end if;

  denied := false;
  begin perform public.pda_save_estimate(basic, null, jsonb_build_object(
    'portLocode',port_code,'callDate','2026-06-01','vessel','{}'::jsonb,'call',jsonb_build_object('days',1,'requestedServices','[]'::jsonb)
  ), jsonb_build_object(
    'coverage','manual_required','tariffVersionId',null,'nativeCurrency','USD','totals',jsonb_build_object('native',0),
    'warnings','[]'::jsonb,'generatedAt',now(),'lines','[]'::jsonb
  ), null);
  exception when others then
    if sqlerrm like 'PDA_TIER:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: T2 actor saved an estimate'; end if;

  -- A service-managed market-partner flag is equivalent to Subscriber
  -- entitlement even when the account remains T1/T2.  The migration that
  -- adds the column follows the PDA migration, so the function itself reads
  -- it through to_jsonb and remains valid both before and after that addition.
  update public.users set subscription_tier = 'T1', is_market_partner = true where id = outsider;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA TEST: flagged T1 market partner was refused by the PDA read gate';
  end if;
  context := public.get_pda_calculation_context(port_code, terminal, '2026-06-01');
  if context#>>'{tariffVersion,id}' <> terminal_version::text then
    raise exception 'PDA TEST: flagged T1 market partner could not load calculation context';
  end if;
  estimate := public.pda_save_estimate(outsider, null, jsonb_build_object(
    'portLocode',port_code,'terminalId',terminal,'callDate','2026-06-01',
    'vessel',jsonb_build_object('vesselName','PDA MARKET PARTNER'),
    'call',jsonb_build_object('days',1,'requestedServices',jsonb_build_array('terminal_fee'))
  ), jsonb_build_object(
    'coverage','published','tariffVersionId',terminal_version,'nativeCurrency','USD','totals',jsonb_build_object('native',250),
    'warnings','[]'::jsonb,'generatedAt',now(),
    'lines',jsonb_build_array(jsonb_build_object(
      'ruleId',terminal_rule,'ruleCode','terminal_fee','label','Terminal fee','basis','per_call','quantity',1,'rate',250,'amount',250,
      'explanation','Terminal fee per call','inputs',jsonb_build_object('quantity',1,'rate',250),'manual',false,
      'evidence',jsonb_build_object('sourceId',source,'title','PDA Test Tariff 2026','page','5')
    ))
  ), null);
  if estimate is null then raise exception 'PDA TEST: flagged T1 market partner could not save an estimate'; end if;

  select count(*) into before_versions from public.port_tariff_versions where status = 'published';
  batch := public.pda_stage_tariff_import(maker, source, 'behavior-test', jsonb_build_array(jsonb_build_object(
    'rawText','Towage subject to agent quote','sourcePage','8','confidence',0.9,'portLocode',port_code,
    'normalizedProposal',jsonb_build_object('code','towage','basis','manual_quote'),'validationErrors','[]'::jsonb
  )), jsonb_build_object('test',true));
  if not exists (select 1 from public.tariff_import_batches where id = batch and status = 'review') then
    raise exception 'PDA TEST: source extraction was not staged';
  end if;
  if (select count(*) from public.port_tariff_versions where status = 'published') <> before_versions then
    raise exception 'PDA TEST: staging changed published tariffs';
  end if;
end;
$$;

select 'PDA DATABASE BEHAVIOR: ALL ASSERTIONS PASSED' as result;
rollback;
