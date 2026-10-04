-- Stream R matchmaking database contract. Run after 20261003300000.
begin;

do $contract$
declare
  v_table text;
begin
  foreach v_table in array array[
    'matching_rule_rollback_catalog',
    'matching_rule_versions', 'matching_rule_state', 'matching_rule_events',
    'matching_rule_requests', 'matching_candidates', 'matching_candidate_snapshots'
  ] loop
    if not exists (
      select 1
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'MATCHING TEST: % is missing or RLS is disabled', v_table;
    end if;
    if has_table_privilege('authenticated', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception 'MATCHING TEST: authenticated has a direct privilege on %', v_table;
    end if;
    if not has_table_privilege('service_role', format('public.%I', v_table), 'select')
       or has_table_privilege('service_role', format('public.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('public.%I', v_table), 'update')
       or has_table_privilege('service_role', format('public.%I', v_table), 'delete') then
      raise exception 'MATCHING TEST: % is not service-read/RPC-write only', v_table;
    end if;
  end loop;
end;
$contract$;

do $grants$
begin
  if not has_function_privilege('authenticated', 'public.fn_matching_params()', 'execute') then
    raise exception 'MATCHING TEST: member params read is missing';
  end if;
  if not has_function_privilege('authenticated', 'public.get_matching_rules_snapshot()', 'execute') then
    raise exception 'MATCHING TEST: member matching snapshot read is missing';
  end if;
  if has_function_privilege('authenticated', 'public.matching_create_rule_version(uuid,uuid,jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.matching_activate_rule_version(uuid,uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_matching_evaluate(jsonb,integer,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_matching_rollback_source_sha256()', 'execute')
     or has_function_privilege('authenticated', 'public.admin_matching_rules_dashboard(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_matching_preview(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.get_matches_for_cargo(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_matches_for_availability(uuid)', 'execute') then
    raise exception 'MATCHING TEST: a private matcher/admin RPC is member-executable';
  end if;
  if has_function_privilege('service_role', 'public.fn_matching_rollback_source_sha256()', 'execute') then
    raise exception 'MATCHING TEST: rollback source fingerprint helper is externally executable';
  end if;
  if not has_function_privilege('service_role', 'public.matching_create_rule_version(uuid,uuid,jsonb,text)', 'execute')
     or not has_function_privilege('service_role', 'public.matching_activate_rule_version(uuid,uuid,uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.fn_matching_evaluate(jsonb,integer,uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_matching_rules_dashboard(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_matching_preview(uuid,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.get_matches_for_cargo(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.get_matches_for_availability(uuid)', 'execute') then
    raise exception 'MATCHING TEST: a required server-only grant is missing';
  end if;
end;
$grants$;

do $shape$
declare
  p jsonb := public.fn_matching_params();
  v_snapshot jsonb := public.get_matching_rules_snapshot();
  v_active uuid;
  v_as_of_year integer;
  v_hash text;
  v_mirror jsonb;
begin
  if (select array_agg(key order by key) from jsonb_object_keys(v_snapshot) as keys(key))
       is distinct from array['activeVersionId','asOfYear','params','paramsSha256','schemaVersion']::text[]
     or v_snapshot->'params' is distinct from p
     or (v_snapshot->>'schemaVersion')::integer <> 1
     or (v_snapshot->>'asOfYear')::integer not between 1900 and 3000
     or (v_snapshot->>'activeVersionId')::uuid is null
     or v_snapshot->>'paramsSha256' <> public.fn_matching_params_sha256(p) then
    raise exception 'MATCHING TEST: member snapshot is incomplete or inconsistent';
  end if;
  if p is distinct from jsonb_build_object(
    'schemaVersion', 1,
    'dwtTolerancePct', 10,
    'partCargoTolerancePct', 20,
    'laycanBeforeDays', 21,
    'laycanAfterDays', 14,
    'rateAlignmentUsd', 5,
    'minScoreLabel', 'Possible',
    'score', jsonb_build_object(
      'dwtTight', 2, 'dwtLoose', 1, 'zoneLoad', 2, 'zoneDisch', 1, 'gear', 1
    )
  ) then
    raise exception 'MATCHING TEST: bootstrap params drifted from deployed semantics: %', p;
  end if;
  if public.fn_matching_canonical_params_text(p) <> '{"dwtTolerancePct":10,"laycanAfterDays":14,"laycanBeforeDays":21,"minScoreLabel":"Possible","partCargoTolerancePct":20,"rateAlignmentUsd":5,"schemaVersion":1,"score":{"dwtLoose":1,"dwtTight":2,"gear":1,"zoneDisch":1,"zoneLoad":2}}' then
    raise exception 'MATCHING TEST: canonical JSON is not the cross-runtime compact form';
  end if;

  select active_version_id, cache_as_of_year into v_active, v_as_of_year
  from public.matching_rule_state where singleton;
  select params_sha256 into v_hash from public.matching_rule_versions where id = v_active;
  if v_hash <> public.fn_matching_params_sha256(p) or v_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'MATCHING TEST: active params SHA-256 is inconsistent';
  end if;
  if v_hash <> '078a127e8292f1cee99d0b3161a00f3daddde7489e1426e681ecf463689d70f1' then
    raise exception 'MATCHING TEST: default cross-runtime SHA-256 fixture drifted: %', v_hash;
  end if;
  select value into v_mirror from public.app_settings where key = 'matching_rules';
  if v_mirror is distinct from p then
    raise exception 'MATCHING TEST: app_settings compatibility mirror is not active params';
  end if;
  if (select count(*) from public.matching_rule_state) <> 1 then
    raise exception 'MATCHING TEST: there must be exactly one active pointer';
  end if;
  if not exists (
    select 1
    from public.matching_candidate_snapshots s
    join lateral (
      select e.* from public.matching_rule_events e
      where e.version_id = v_active and e.event_type = 'version_activated'
      order by e.id desc limit 1
    ) e on true
    where s.version_id = v_active
      and s.as_of_year = v_as_of_year
      and e.evaluation_as_of_year = v_as_of_year
      and s.candidate_count = e.candidate_count
      and s.candidate_sha256 = e.candidate_sha256
      and s.source_sha256 = e.source_sha256
  ) then
    raise exception 'MATCHING TEST: active as-of year/snapshot/event evidence is inconsistent';
  end if;
end;
$shape$;

do $cache$
declare
  v_active uuid;
  v_as_of_year integer;
begin
  select active_version_id, cache_as_of_year into v_active, v_as_of_year
  from public.matching_rule_state where singleton;
  if exists (
    select 1 from public.matches
    where matching_rule_version_id is null
       or matching_rule_version_id <> v_active
       or match_score is null or is_rate_aligned is null or dwt_delta is null
       or matching_as_of_year is null or matching_as_of_year <> v_as_of_year
  ) then
    raise exception 'MATCHING TEST: public.matches contains a mixed/incomplete version';
  end if;
  if (select count(*) from public.matches)
       <> (select count(*) from public.matching_candidates where version_id = v_active) then
    raise exception 'MATCHING TEST: cache/candidate counts disagree';
  end if;
  if exists (
    select 1
    from public.matches m
    full join (
      select * from public.matching_candidates where version_id = v_active
    ) c
      on c.cargo_id = m.cargo_id
     and c.vessel_avail_id = m.vessel_avail_id
    where m.id is null or c.cargo_id is null
       or m.score_label is distinct from c.score_label
       or m.match_score is distinct from c.score
       or m.is_rate_aligned is distinct from c.is_rate_aligned
       or m.dwt_delta is distinct from c.dwt_delta
       or m.matching_as_of_year is distinct from c.as_of_year
  ) then
    raise exception 'MATCHING TEST: cache labels/scores do not equal active candidates';
  end if;
  if exists (
    (select cargo_id, vessel_avail_id, score_label from public.v_eligible_matches
     except all
     select cargo_id, vessel_avail_id, score_label
     from public.matching_candidates where version_id = v_active)
    union all
    (select cargo_id, vessel_avail_id, score_label
     from public.matching_candidates where version_id = v_active
     except all
     select cargo_id, vessel_avail_id, score_label from public.v_eligible_matches)
  ) then
    raise exception 'MATCHING TEST: compatibility view is not the active candidate set';
  end if;
end;
$cache$;

do $catalog$
declare
  v_cascade_count integer;
  v_trigger_count integer;
  v_snapshot public.matching_rule_rollback_catalog%rowtype;
begin
  select * into strict v_snapshot
    from public.matching_rule_rollback_catalog where singleton;
  if jsonb_typeof(v_snapshot.legacy_function_ddls) <> 'array'
     or jsonb_array_length(v_snapshot.legacy_function_ddls) <> 8
     or exists (
       select 1 from jsonb_array_elements(v_snapshot.legacy_function_ddls) x
       where jsonb_typeof(x) <> 'string' or length(x #>> '{}') = 0
     )
     or jsonb_typeof(v_snapshot.legacy_view_acl_ddls) <> 'array'
     or jsonb_array_length(v_snapshot.legacy_view_acl_ddls) = 0
     or jsonb_typeof(v_snapshot.legacy_function_acl_ddls) <> 'array'
     or jsonb_array_length(v_snapshot.legacy_function_acl_ddls) = 0
     or jsonb_typeof(v_snapshot.matches_acl_ddls) <> 'array'
     or jsonb_array_length(v_snapshot.matches_acl_ddls) = 0
     or jsonb_typeof(v_snapshot.matches_rows) <> 'array'
     or encode(extensions.digest(v_snapshot.matches_rows::text, 'sha256'), 'hex')
          <> v_snapshot.matches_rows_sha256
     or v_snapshot.source_rows_sha256 !~ '^[a-f0-9]{64}$'
     or v_snapshot.source_rows_sha256
          <> public.fn_matching_rollback_source_sha256()
     or v_snapshot.legacy_view_ddl not ilike 'create or replace view public.v_eligible_matches as %' then
    raise exception 'MATCHING TEST: exact deployed-definition rollback catalogue is incomplete or corrupt';
  end if;
  if has_table_privilege('service_role', 'public.matches', 'insert')
     or has_table_privilege('service_role', 'public.matches', 'update')
     or has_table_privilege('service_role', 'public.matches', 'delete')
     or not has_table_privilege('service_role', 'public.matches', 'select')
     or has_table_privilege('authenticated', 'public.matches', 'select') then
    raise exception 'MATCHING TEST: public.matches is not service-read/RPC-write only';
  end if;
  if exists (
    select 1
    from (values
      ('matching_rule_version_id', 'uuid'),
      ('match_score', 'integer'),
      ('is_rate_aligned', 'boolean'),
      ('dwt_delta', 'integer'),
      ('matching_as_of_year', 'integer')
    ) expected(column_name, data_type)
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = 'matches'
     and c.column_name = expected.column_name
    where c.column_name is null or c.data_type <> expected.data_type or c.is_nullable <> 'NO'
  ) then
    raise exception 'MATCHING TEST: governed public.matches columns are missing, nullable or mistyped';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_cargo_id_vessel_avail_id_key'
      and contype = 'u'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_matching_rule_version_id_fkey'
      and contype = 'f'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_governed_values_ck'
      and contype = 'c'
  ) then
    raise exception 'MATCHING TEST: governed cache key/version/value constraint is missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('admin_matching_rules_dashboard', 'admin_matching_preview')
        and p.prosecdef and p.provolatile = 's') <> 2 then
    raise exception 'MATCHING TEST: admin dashboard/preview RPCs must be stable security definers';
  end if;

  select count(*) into v_cascade_count
  from pg_constraint
  where conrelid = 'public.matching_candidates'::regclass
    and contype = 'f'
    and confrelid in ('public.cargo_listings'::regclass, 'public.vessel_availability'::regclass)
    and confdeltype = 'c';
  if v_cascade_count <> 2 then
    raise exception 'MATCHING TEST: listing candidate FKs must both cascade on delete';
  end if;

  select count(*) into v_trigger_count
  from pg_trigger
  where not tgisinternal and tgname in (
    'trg_matching_versions_immutable', 'trg_matching_events_immutable',
    'trg_matching_requests_immutable', 'trg_matching_snapshots_immutable',
    'trg_matching_settings_mirror_guard'
  );
  if v_trigger_count <> 5 then
    raise exception 'MATCHING TEST: expected five governance triggers, got %', v_trigger_count;
  end if;
  select count(*) into v_trigger_count
  from pg_trigger
  where not tgisinternal and tgname in (
    'trg_matches_on_cargo', 'trg_matches_on_availability', 'trg_matches_on_vessel'
  );
  if v_trigger_count <> 3 then
    raise exception 'MATCHING TEST: legacy source refresh triggers were not preserved';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matching_rule_versions'::regclass
      and conname = 'matching_rule_versions_canonical_ck'
  ) then
    raise exception 'MATCHING TEST: persisted params/hash canonical constraint is missing';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'matching%'
      and c.relname ~ '(job|queue|claim|lease|manifest|worker)'
  ) then
    raise exception 'MATCHING TEST: asynchronous v1 machinery is present';
  end if;
end;
$catalog$;

select 'MATCHING DATABASE CONTRACT: ALL ASSERTIONS PASSED' as result;
rollback;
