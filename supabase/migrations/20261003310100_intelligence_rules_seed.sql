-- Stream R: v1 Intelligence Rules bootstrap.
--
-- R-001..R-010 retain the prototype identifiers and thresholds. R-010 remains
-- inactive. R-005/R-007/R-008 use evidence-neutral published copy; the exact
-- prototype wording is retained only in the private provenance table.

do $migration$
declare
  v_set_id constant uuid := '31010000-0000-4000-8000-000000000001';
  v_document jsonb := jsonb_build_object(
    'schemaVersion', 1,
    'evaluatorVersion', 'intelligence-v1',
    'groups', jsonb_build_array(
      jsonb_build_object('code','core','name','Core card intelligence','description','Prototype R-001 through R-010, translated into typed read-only rules.','scope','both','active',true,'priority',10),
      jsonb_build_object('code','compat','name','Compatibility framework','description','Reserved; no rules are published in v1.','scope','framework','active',false,'priority',100),
      jsonb_build_object('code','portres','name','Port restrictions framework','description','Reserved; no rules are published in v1.','scope','framework','active',false,'priority',110),
      jsonb_build_object('code','agecrg','name','Age and cargo framework','description','Reserved; no rules are published in v1.','scope','framework','active',false,'priority',120),
      jsonb_build_object('code','freight','name','Freight framework','description','Reserved for a governed market reference; no rules are published in v1.','scope','framework','active',false,'priority',130),
      jsonb_build_object('code','comm','name','Commission framework','description','Reserved; no rules are published in v1.','scope','framework','active',false,'priority',140)
    ),
    'rules', jsonb_build_array(
      jsonb_build_object('code','R-001','group','core','entity','cargo','field','stowage_sf','operator','lt','threshold',0.4,'severity','warning','tag','Heavy','message','Heavy cargo, weight limits before volume.','signalKey','cargo.core.stowage','active',true,'priority',10),
      jsonb_build_object('code','R-002','group','core','entity','cargo','field','stowage_sf','operator','gt','threshold',1.4,'severity','info','tag','Light','message','Light cargo, volume check vs vessel hold cap.','signalKey','cargo.core.stowage','active',true,'priority',20),
      jsonb_build_object('code','R-003','group','core','entity','cargo','field','load_rate_mt_day','operator','gt','threshold',5000,'severity','good','tag','Fast load','message','High load rate, short port time, helps TCE.','signalKey','cargo.core.load_rate','active',true,'priority',30),
      jsonb_build_object('code','R-004','group','core','entity','cargo','field','laycan_days_remaining','operator','lt','threshold',3,'severity','danger','tag','Urgent','message','Laycan window closing, confirm vessel ASAP.','signalKey','cargo.core.laycan','active',true,'priority',40),
      jsonb_build_object('code','R-005','group','core','entity','cargo','field','freight_idea_usd_mt','operator','lt','threshold',25,'severity','warning','tag','Rate review','message','Freight idea is below the configured review threshold; verify it against an approved current market reference.','signalKey','cargo.core.freight','active',true,'priority',50),
      jsonb_build_object('code','R-006','group','core','entity','vessel','field','age_years','operator','gt','threshold',20,'severity','info','tag','Older tonnage','message','Charterer vetting may require attention.','signalKey','vessel.core.age','active',true,'priority',60),
      jsonb_build_object('code','R-007','group','core','entity','vessel','field','vlsfo_sea_mt_day','operator','gt','threshold',28,'severity','warning','tag','Consumption review','message','Declared VLSFO sea consumption exceeds the configured review threshold; confirm the figure and operating basis.','signalKey','vessel.core.vlsfo','active',true,'priority',70),
      jsonb_build_object('code','R-008','group','core','entity','vessel','field','lsmgo_sea_mt_day','operator','missing','threshold',null,'severity','warning','tag','Not declared','message','LSMGO sea consumption is not declared; request and confirm the value before estimating.','signalKey','vessel.core.lsmgo','active',true,'priority',80),
      jsonb_build_object('code','R-009','group','core','entity','vessel','field','open_days_delta','operator','lt','threshold',0,'severity','danger','tag','Overdue','message','Open date passed, verify vessel still available.','signalKey','vessel.core.open_date','active',true,'priority',90),
      jsonb_build_object('code','R-010','group','core','entity','cargo','field','commission_pct','operator','gt','threshold',4,'severity','info','tag','High comm','message','Higher than typical, confirm if IAC or separate.','signalKey','cargo.core.commission','active',false,'priority',100)
    )
  );
  v_provenance jsonb := jsonb_build_array(
    jsonb_build_object('ruleCode','R-005','sourceRef','prototype:R-005','originalMessage','Below-market rate, confirm vs current TC index.','note','Published copy is evidence-neutral until a governed current market reference is available.'),
    jsonb_build_object('ruleCode','R-007','sourceRef','prototype:R-007','originalMessage','Above-average burn, check ECO speed option.','note','Published copy describes only the configured threshold and makes no unsupported market-average claim.'),
    jsonb_build_object('ruleCode','R-008','sourceRef','prototype:R-008','originalMessage','Owner did not declare, auto-fill 0.5 MT/day.','note','Published copy requests confirmation. The evaluator never invents or mutates a vessel fact.')
  );
  v_version bigint;
  v_hash text;
begin
  perform public.fn_intelligence_validate_document(v_document);
  perform public.fn_intelligence_validate_provenance(v_provenance, v_document);
  v_hash := public.fn_intelligence_sha256(v_document);

  insert into public.intelligence_rule_sets(
    id, schema_version, evaluator_version, content_hash, label, change_note, based_on_id, created_by
  ) values (
    v_set_id, 1, 'intelligence-v1', v_hash, 'Intelligence Rules v1',
    'System bootstrap: prototype identifiers and thresholds with reviewed evidence-neutral copy', null, null
  ) returning version_no into v_version;

  insert into public.intelligence_rule_groups(rule_set_id, code, name, description, scope, active, priority)
  select v_set_id, x->>'code', x->>'name', nullif(x->>'description',''), x->>'scope',
         (x->>'active')::boolean, (x->>'priority')::integer
  from jsonb_array_elements(v_document->'groups') x;

  insert into public.intelligence_rules(
    rule_set_id, rule_code, group_code, entity, field, operator, threshold,
    severity, tag, message, signal_key, active, priority
  )
  select v_set_id, x->>'code', x->>'group', x->>'entity', x->>'field', x->>'operator', x->'threshold',
         x->>'severity', x->>'tag', x->>'message', x->>'signalKey',
         (x->>'active')::boolean, (x->>'priority')::integer
  from jsonb_array_elements(v_document->'rules') x;

  insert into public.intelligence_rule_provenance(rule_set_id, rule_code, source_ref, original_message, note)
  select v_set_id, x->>'ruleCode', x->>'sourceRef', x->>'originalMessage', nullif(x->>'note','')
  from jsonb_array_elements(v_provenance) x;

  if public.fn_intelligence_rule_set_document(v_set_id) is distinct from v_document
     or public.fn_intelligence_sha256(public.fn_intelligence_rule_set_document(v_set_id)) <> v_hash then
    raise exception 'INTELLIGENCE_STATE: bootstrap persistence/hash mismatch' using errcode = '55000';
  end if;

  update public.intelligence_rule_state
     set active_rule_set_id = v_set_id, revision = 1, activated_by = null, activated_at = now()
   where singleton;

  insert into public.intelligence_rule_events(
    action, rule_set_id, version_no, actor_user_id, request_id, before_state, after_state, metadata
  ) values (
    'version.bootstrap_activated', v_set_id, v_version, null, null,
    jsonb_build_object('ruleSetId',null,'revision',0),
    jsonb_build_object('ruleSetId',v_set_id,'version',v_version,'contentHash',v_hash,'revision',1),
    jsonb_build_object('governedRules',10,'provenanceRows',3)
  );
end;
$migration$;
