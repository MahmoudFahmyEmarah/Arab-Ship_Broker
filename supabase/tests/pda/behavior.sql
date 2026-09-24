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
  version uuid;
  terminal uuid;
  other_terminal uuid;
  rule uuid;
  estimate uuid;
  batch uuid;
  context jsonb;
  denied boolean;
  before_versions integer;
begin
  select id into maker from public.users where is_active and lower(coalesce(role,'')) = 'admin' order by id limit 1;
  select id into checker from public.users where is_active and lower(coalesce(role,'')) = 'admin' and id <> maker order by id limit 1;
  select id into sub_admin from public.users where is_active and lower(coalesce(role,'')) = 'admin' and id not in (maker, checker) order by id limit 1;
  select id, supabase_user_id into member, member_auth from public.users
    where is_active and lower(coalesce(role,'')) <> 'admin' and subscription_tier::text in ('T3','T4') order by id limit 1;
  select id, supabase_user_id into outsider, outsider_auth from public.users
    where is_active and lower(coalesce(role,'')) <> 'admin' and subscription_tier::text in ('T3','T4') and id <> member order by id limit 1;
  if maker is null or checker is null or sub_admin is null or member is null or outsider is null
     or member_auth is null or outsider_auth is null then
    raise exception 'PDA TEST: local E2E fixture requires three admins and two T3/T4 members';
  end if;
  update public.users set admin_tier = null where id in (maker, checker);
  update public.users set admin_tier = 'sub' where id = sub_admin;

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

  insert into public.port_terminals(port_locode,name,normalized_name,is_active,is_verified,verified_by,verified_at,created_by)
  values (port_code,'PDA Test Terminal','pda test terminal',true,true,maker,now(),maker) returning id into terminal;
  insert into public.port_terminals(port_locode,name,normalized_name,is_active,is_verified,verified_by,verified_at,created_by)
  values (other_port,'PDA Other Terminal','pda other terminal',true,true,maker,now(),maker) returning id into other_terminal;

  version := public.pda_create_tariff_draft(maker, jsonb_build_object(
    'portLocode',port_code,'publisherId',publisher,'name','PDA Test Port Call','scope','port_call',
    'versionNo',1,'currency','USD','effectiveFrom','2026-01-01','roundingMode','half_up',
    'decimalPlaces',2,'primarySourceId',source
  ));

  denied := false;
  begin perform public.pda_replace_tariff_rules(maker, version, jsonb_build_array(jsonb_build_object(
    'code','broken_tier','label','Broken tier','basis','tiered_rate','priority',10,'sourceId',source,'sourcePage','4',
    'bands',jsonb_build_array(
      jsonb_build_object('order',1,'lowerBound',0,'upperBound',100,'rate',1),
      jsonb_build_object('order',2,'lowerBound',90,'rate',1)
    )
  )));
  exception when others then
    if sqlerrm like 'PDA_BANDS:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: malformed tariff bands were accepted'; end if;

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

  denied := false;
  begin perform public.pda_publish_tariff_version(maker, version);
  exception when others then
    if sqlerrm like 'PDA_CHECKER:%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'PDA TEST: maker approved own tariff'; end if;
  perform public.pda_publish_tariff_version(checker, version);

  perform set_config('request.jwt.claim.sub', member_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member_auth,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  context := public.get_pda_calculation_context(port_code, terminal, '2026-06-01');
  if context->>'coverage' <> 'published' or context#>>'{tariffVersion,id}' <> version::text then
    raise exception 'PDA TEST: port-wide tariff did not cover verified terminal';
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
    'coverage','published','tariffVersionId',version,'nativeCurrency','USD','totals',jsonb_build_object('native',100),
    'warnings','[]'::jsonb,'generatedAt',now(),
    'lines',jsonb_build_array(jsonb_build_object(
      'ruleId',rule,'ruleCode','port_dues','label','Port dues','basis','per_call','quantity',1,'rate',100,'amount',100,
      'explanation','Port dues per call','inputs','{}'::jsonb,'manual',false,
      'evidence',jsonb_build_object('sourceId',source,'title','PDA Test Tariff 2026','page','4')
    ))
  ), null);
  if not public.fn_can_read_pda_estimate(estimate) then raise exception 'PDA TEST: owner cannot read estimate'; end if;

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
