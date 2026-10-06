-- Transactional Stream R Intelligence schema/lifecycle proof.
-- Run after 20261003310000 and 20261003310100 on the isolated asb_rules DB.
begin;

do $contract$
declare
  v_admin uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_inactive_admin uuid := gen_random_uuid();
  v_view_admin uuid := gen_random_uuid();
  v_edit_admin uuid := gen_random_uuid();
  v_no_access_admin uuid := gen_random_uuid();
  v_active_id uuid;
  v_revision bigint;
  v_clone jsonb;
  v_document jsonb;
  v_provenance jsonb;
  v_changed_provenance jsonb;
  v_changed jsonb;
  v_zero jsonb;
  v_create_request uuid := gen_random_uuid();
  v_zero_request uuid := gen_random_uuid();
  v_activate_request uuid := gen_random_uuid();
  v_rollback_request uuid := gen_random_uuid();
  v_created_id uuid;
  v_created_version bigint;
  v_active_version bigint;
  v_result jsonb;
  v_replay jsonb;
  v_zero_result jsonb;
  v_detail jsonb;
  v_diff jsonb;
  v_denied boolean;
  v_bad boolean;
  v_bad_actor uuid;
  v_permission_result jsonb;
begin
  insert into auth.users(id,email)
  values
    (v_admin, 'intel-admin-' || v_admin || '@example.test'),
    (v_member, 'intel-member-' || v_member || '@example.test'),
    (v_inactive_admin, 'intel-inactive-' || v_inactive_admin || '@example.test'),
    (v_view_admin, 'intel-view-' || v_view_admin || '@example.test'),
    (v_edit_admin, 'intel-edit-' || v_edit_admin || '@example.test'),
    (v_no_access_admin, 'intel-none-' || v_no_access_admin || '@example.test');

  insert into public.users(id,email,full_name,role,is_active,admin_tier,admin_perms,subscription_tier)
  values
    (v_admin, 'intel-admin-' || v_admin || '@example.test', 'Intelligence Admin', 'admin', true, 'super', null, 'T4'),
    (v_member, 'intel-member-' || v_member || '@example.test', 'Intelligence Member', 'member', true, null, null, 'T3'),
    (v_inactive_admin, 'intel-inactive-' || v_inactive_admin || '@example.test', 'Inactive Admin', 'admin', false, 'super', null, 'T4'),
    (v_view_admin, 'intel-view-' || v_view_admin || '@example.test', 'Intelligence View Admin', 'admin', true, 'sub', '{"intelligence":"view"}'::jsonb, 'T4'),
    (v_edit_admin, 'intel-edit-' || v_edit_admin || '@example.test', 'Intelligence Edit Admin', 'admin', true, 'sub', '{"intelligence":"edit"}'::jsonb, 'T4'),
    (v_no_access_admin, 'intel-none-' || v_no_access_admin || '@example.test', 'Intelligence No Access', 'admin', true, 'sub', '{}'::jsonb, 'T4');

  select active_rule_set_id, revision into v_active_id, v_revision
  from public.intelligence_rule_state where singleton;
  select version_no into v_active_version
  from public.intelligence_rule_sets where id = v_active_id;
  if v_active_id is null or v_revision <> 1 then
    raise exception 'INTELLIGENCE TEST: bootstrap pointer/revision missing';
  end if;
  if not exists (select 1 from public.intelligence_rule_sets
      where id=v_active_id and schema_version=1 and evaluator_version='intelligence-v1') then
    raise exception 'INTELLIGENCE TEST: schema/evaluator version was not persisted';
  end if;
  select public.admin_intelligence_get_clone_input(v_admin, v_active_id) into v_clone;
  v_document := v_clone->'document';
  v_provenance := v_clone->'provenance';

  -- SQL repeats the same section-level view/edit boundary as requireAdmin().
  perform public.admin_intelligence_list_rule_sets(v_view_admin);
  perform public.admin_intelligence_list_rule_sets(v_edit_admin);
  v_denied := false;
  begin
    perform public.admin_intelligence_list_rule_sets(v_no_access_admin);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'INTELLIGENCE TEST: sub-admin without section access could read'; end if;
  v_denied := false;
  begin
    perform public.admin_intelligence_create_rule_set(
      v_view_admin, v_document, v_provenance, 'View-only refusal',
      'A view-only seat must not create a version', v_active_id, gen_random_uuid()
    );
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'INTELLIGENCE TEST: view-only sub-admin could create'; end if;
  v_permission_result := public.admin_intelligence_create_rule_set(
    v_edit_admin, v_document, v_provenance, 'Edit permission proof',
    'An edit seat may create a reviewable version', v_active_id, gen_random_uuid()
  );
  if (v_permission_result->>'ruleSetId') is null then
    raise exception 'INTELLIGENCE TEST: edit sub-admin could not create';
  end if;

  -- Seed contract and evidence-neutral publication.
  if (select count(*) from public.intelligence_rules where rule_set_id = v_active_id and rule_code like 'R-%') <> 10 then
    raise exception 'INTELLIGENCE TEST: expected R-001 through R-010';
  end if;
  if (select active from public.intelligence_rules where rule_set_id = v_active_id and rule_code = 'R-010') then
    raise exception 'INTELLIGENCE TEST: R-010 must remain inactive';
  end if;
  if not exists (
    select 1 from public.intelligence_rules
    where rule_set_id = v_active_id and rule_code = 'R-008'
      and operator = 'missing' and threshold = 'null'::jsonb
  ) then raise exception 'INTELLIGENCE TEST: R-008 must be missing/null'; end if;
  if exists (
    select 1 from public.intelligence_rules
    where rule_set_id = v_active_id and rule_code in ('R-005','R-007','R-008')
      and (message ilike '%below-market%' or message ilike '%above-average%' or message ilike '%auto-fill%')
  ) then raise exception 'INTELLIGENCE TEST: unsupported prototype claims leaked into published copy'; end if;
  if (select count(*) from public.intelligence_rule_provenance where rule_set_id = v_active_id and rule_code in ('R-005','R-007','R-008')) <> 3 then
    raise exception 'INTELLIGENCE TEST: private prototype provenance missing';
  end if;
  if not exists (select 1 from public.intelligence_rule_groups where rule_set_id=v_active_id and code='core' and active)
     or exists (select 1 from public.intelligence_rule_groups where rule_set_id=v_active_id and code='card_tooltips')
     or exists (select 1 from public.intelligence_rule_groups where rule_set_id=v_active_id and scope='framework' and active) then
    raise exception 'INTELLIGENCE TEST: governed/future group state is wrong';
  end if;

  -- Persisted-shape identity must be reproducible from historical detail.
  select public.admin_intelligence_get_rule_set(v_admin, v_active_id) into v_detail;
  if public.fn_intelligence_sha256(v_detail->'document') <> v_detail->>'contentHash' then
    raise exception 'INTELLIGENCE TEST: seed hash does not identify persisted document';
  end if;

  v_bad := false;
  begin
    update public.intelligence_rules set message = 'tampered'
    where rule_set_id = v_active_id and rule_code = 'R-001';
  exception when sqlstate '55000' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: immutable published rule was updated'; end if;

  -- Exact schemas: unknown nested keys, unsupported fields/operators,
  -- bad thresholds and cross-scope rules all fail closed.
  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(
      v_document, '{rules,0}', (v_document->'rules'->0) || '{"expression":"return true"}'::jsonb
    ));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: executable/unknown rule key accepted'; end if;

  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(v_document, '{rules,0,field}', '"not_a_fact"'::jsonb));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: unknown field accepted'; end if;

  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(v_document, '{rules,0,operator}', '"contains"'::jsonb));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: unknown operator accepted'; end if;

  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(v_document, '{rules,0,threshold}', '999999'::jsonb));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: out-of-range threshold accepted'; end if;

  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(v_document, '{rules,0,threshold}', '0.4000001'::jsonb));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: cross-runtime-unsafe threshold precision accepted'; end if;

  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(v_document, '{rules,0,entity}', '"vessel"'::jsonb));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: field/group scope mismatch accepted'; end if;

  v_bad := false;
  begin
    perform public.fn_intelligence_validate_document(jsonb_set(v_document, '{groups,0,scope}', '"cargo"'::jsonb));
  exception when sqlstate '22023' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: vessel rules were accepted inside a cargo-only group'; end if;

  -- Create/replay uses one request identity; a changed replay is rejected.
  v_changed := jsonb_set(v_document, '{rules,0,message}', to_jsonb('Heavy cargo threshold reached; verify weight and volume.'::text));
  v_changed_provenance := jsonb_set(
    v_provenance, '{0,note}', to_jsonb('Changed private provenance note for diff proof.'::text)
  );
  v_result := public.admin_intelligence_create_rule_set(
    v_admin, v_changed, v_changed_provenance, 'Contract clone', 'Contract/idempotency proof', v_active_id, v_create_request
  );
  v_created_id := (v_result->>'ruleSetId')::uuid;
  v_created_version := (v_result->>'version')::bigint;
  v_replay := public.admin_intelligence_create_rule_set(
    v_admin, v_changed, v_changed_provenance, 'Contract clone', 'Contract/idempotency proof', v_active_id, v_create_request
  );
  if v_replay is distinct from v_result then
    raise exception 'INTELLIGENCE TEST: same request did not replay the original result';
  end if;
  if (select count(*) from public.intelligence_rule_sets where created_by=v_admin and label='Contract clone') <> 1 then
    raise exception 'INTELLIGENCE TEST: idempotent create wrote more than one version';
  end if;
  v_bad := false;
  begin
    perform public.admin_intelligence_create_rule_set(
      v_admin, v_changed, v_changed_provenance, 'Changed replay', 'Contract/idempotency proof', v_active_id, v_create_request
    );
  exception when others then
    if sqlerrm like 'INTELLIGENCE_IDEMPOTENCY:%' then v_bad := true; else raise; end if;
  end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: changed replay was accepted'; end if;
  v_detail := public.admin_intelligence_get_rule_set(v_admin, (v_result->>'ruleSetId')::uuid);
  if public.fn_intelligence_sha256(v_detail->'document') <> v_result->>'contentHash' then
    raise exception 'INTELLIGENCE TEST: created hash does not match persisted shape';
  end if;

  -- Historical diff and clone data remain available after publication.
  v_diff := public.admin_intelligence_diff_rule_sets(v_admin, v_active_id, (v_result->>'ruleSetId')::uuid);
  if not ((v_diff->'rules'->'changed') ? 'R-001')
     or not ((v_diff->'provenance'->'changed') ? 'R-005') then
    raise exception 'INTELLIGENCE TEST: historical diff did not report rule/provenance changes';
  end if;
  v_clone := public.admin_intelligence_get_clone_input(v_admin, (v_result->>'ruleSetId')::uuid);
  if v_clone->'document' is distinct from v_detail->'document' or jsonb_array_length(v_clone->'provenance') <> 3 then
    raise exception 'INTELLIGENCE TEST: clone input is incomplete';
  end if;

  -- A syntactically valid but zero-effective version may be saved for review,
  -- but activation must fail without changing the pointer/revision.
  select jsonb_set(v_document, '{rules}', coalesce(jsonb_agg(jsonb_set(x, '{active}', 'false'::jsonb)), '[]'::jsonb))
    into v_zero from jsonb_array_elements(v_document->'rules') x;
  v_zero_result := public.admin_intelligence_create_rule_set(
    v_admin, v_zero, v_provenance, 'Zero effective', 'Activation refusal proof', v_active_id, v_zero_request
  );
  v_bad := false;
  begin
    perform public.admin_intelligence_activate_rule_set(
      v_admin, (v_zero_result->>'ruleSetId')::uuid, v_revision, gen_random_uuid(),
      'ACTIVATE v' || (v_zero_result->>'version')
    );
  exception when others then
    if sqlerrm like 'INTELLIGENCE_STATE:%' then v_bad := true; else raise; end if;
  end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: zero-effective version activated'; end if;
  if (select revision from public.intelligence_rule_state where singleton) <> v_revision then
    raise exception 'INTELLIGENCE TEST: failed activation moved the revision';
  end if;

  -- CAS activation and idempotent activation replay.
  v_bad := false;
  begin
    perform public.admin_intelligence_activate_rule_set(
      v_admin, v_created_id, v_revision, gen_random_uuid(), 'ACTIVATE v999999'
    );
  exception when others then
    if sqlerrm like 'INTELLIGENCE_CONFIRMATION:%' then v_bad := true; else raise; end if;
  end;
  if not v_bad
     or (select revision from public.intelligence_rule_state where singleton) <> v_revision then
    raise exception 'INTELLIGENCE TEST: invalid typed activation confirmation changed state';
  end if;
  v_result := public.admin_intelligence_activate_rule_set(
    v_admin, v_created_id, v_revision, v_activate_request,
    'ACTIVATE v' || v_created_version::text
  );
  v_replay := public.admin_intelligence_activate_rule_set(
    v_admin, v_created_id, v_revision, v_activate_request,
    'ACTIVATE v' || v_created_version::text
  );
  if v_replay is distinct from v_result or (v_result->>'revision')::bigint <> v_revision + 1 then
    raise exception 'INTELLIGENCE TEST: activation replay/revision failed';
  end if;
  v_bad := false;
  begin
    perform public.admin_intelligence_activate_rule_set(
      v_admin, v_active_id, v_revision, gen_random_uuid(),
      'ROLLBACK v' || v_active_version::text
    );
  exception when sqlstate '40001' then v_bad := true; end;
  if not v_bad then raise exception 'INTELLIGENCE TEST: stale CAS activation was accepted'; end if;

  v_bad := false;
  begin
    perform public.admin_intelligence_activate_rule_set(
      v_admin, v_active_id, v_revision + 1, gen_random_uuid(), 'ROLLBACK v999999'
    );
  exception when others then
    if sqlerrm like 'INTELLIGENCE_CONFIRMATION:%' then v_bad := true; else raise; end if;
  end;
  if not v_bad
     or (select active_rule_set_id from public.intelligence_rule_state where singleton) <> v_created_id then
    raise exception 'INTELLIGENCE TEST: invalid typed rollback confirmation changed state';
  end if;
  v_result := public.admin_intelligence_activate_rule_set(
    v_admin, v_active_id, v_revision + 1, v_rollback_request,
    'ROLLBACK v' || v_active_version::text
  );
  if (select active_rule_set_id from public.intelligence_rule_state where singleton) <> v_active_id
     or not exists (
       select 1 from public.intelligence_rule_events
       where request_id = v_rollback_request and action = 'version.rolled_back'
     ) then
    raise exception 'INTELLIGENCE TEST: typed rollback did not switch pointer/audit event';
  end if;

  -- Canonical actor check is server-side, independent of UI permission checks.
  foreach v_bad_actor in array array[v_member, v_inactive_admin] loop
    v_denied := false;
    begin
      perform public.admin_intelligence_list_rule_sets(v_bad_actor);
    exception when insufficient_privilege then v_denied := true; end;
    if not v_denied then raise exception 'INTELLIGENCE TEST: non-active-admin actor accepted'; end if;
  end loop;

  if jsonb_array_length(public.admin_intelligence_list_events(v_admin,100)) < 3 then
    raise exception 'INTELLIGENCE TEST: expected durable create/activate history';
  end if;
end;
$contract$;

do $marker$ begin
  raise notice 'INTELLIGENCE CONTRACT: ALL ASSERTIONS PASSED';
end $marker$;
rollback;
