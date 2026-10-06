-- Stream R combined DOWN: Intelligence Rules seed/foundation + Matching Rules.
--
-- The matching forward migration stores the exact deployed matcher/view
-- definitions, their member/service ACLs, the legacy cache rows and the prior
-- app_settings row in public.matching_rule_rollback_catalog.  Refuse to run
-- without that catalogue: guessing a historical matcher is not a rollback.
--
-- RELEASE ORDER: this DOWN must run before the market-firewall DOWN, whose
-- legacy_routine_acl_snapshot contains the pre-Stream-R matcher ACLs.

begin; -- RULES_DOWN_TRANSACTION_START

do $require_snapshot$
declare
  v_rows jsonb;
  v_hash text;
  v_source_hash text;
begin
  if to_regclass('public.matching_rule_rollback_catalog') is null then
    raise exception 'MATCHING_ROLLBACK: deployed-definition catalogue is missing'
      using errcode = '55000';
  end if;
  select matches_rows, matches_rows_sha256, source_rows_sha256
    into v_rows, v_hash, v_source_hash
    from public.matching_rule_rollback_catalog where singleton;
  if not found
     or encode(extensions.digest(v_rows::text, 'sha256'), 'hex') <> v_hash
     or v_source_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'MATCHING_ROLLBACK: cache snapshot is missing or corrupt'
      using errcode = '55000';
  end if;
end;
$require_snapshot$;

-- Hold the source universe stable from the rollback decision through either
-- exact snapshot restoration or legacy recomputation.  Without these locks a
-- concurrent listing write could land between the fingerprint and refresh.
lock table public.cargo_listings in share mode;
lock table public.vessel_availability in share mode;
lock table public.vessels in share mode;
lock table public.matches in access exclusive mode;

-- Intelligence: remove public/admin entry points, trigger dependencies, then
-- the private ledger.  The seed has no objects outside this foundation.
drop function if exists public.admin_intelligence_list_events(uuid, integer);
drop function if exists public.admin_intelligence_diff_rule_sets(uuid, uuid, uuid);
drop function if exists public.admin_intelligence_get_clone_input(uuid, uuid);
drop function if exists public.admin_intelligence_get_rule_set(uuid, uuid);
drop function if exists public.admin_intelligence_list_rule_sets(uuid);
drop function if exists public.get_intelligence_rules();
drop function if exists public.admin_intelligence_activate_rule_set(uuid, uuid, bigint, uuid, text);
drop function if exists public.admin_intelligence_activate_rule_set(uuid, uuid, bigint, uuid);
drop function if exists public.admin_intelligence_create_rule_set(uuid, jsonb, jsonb, text, text, uuid, uuid);
drop function if exists public.fn_intelligence_request_finish(uuid, text, uuid, jsonb);
drop function if exists public.fn_intelligence_request_begin(uuid, text, uuid, text);
drop function if exists public.fn_intelligence_effective_document(uuid);
drop function if exists public.fn_intelligence_rule_set_document(uuid);

drop trigger if exists trg_intelligence_catalogue_immutable on public.intelligence_rule_field_catalogue;
drop trigger if exists trg_intelligence_sets_immutable on public.intelligence_rule_sets;
drop trigger if exists trg_intelligence_groups_immutable on public.intelligence_rule_groups;
drop trigger if exists trg_intelligence_rules_immutable on public.intelligence_rules;
drop trigger if exists trg_intelligence_provenance_immutable on public.intelligence_rule_provenance;
drop trigger if exists trg_intelligence_events_immutable on public.intelligence_rule_events;
drop trigger if exists trg_intelligence_group_guard on public.intelligence_rule_groups;
drop trigger if exists trg_intelligence_rule_guard on public.intelligence_rules;

drop function if exists public.fn_intelligence_append_only();
drop function if exists public.fn_intelligence_rule_guard();
drop function if exists public.fn_intelligence_group_guard();
drop function if exists public.fn_intelligence_validate_provenance(jsonb, jsonb);
drop function if exists public.fn_intelligence_validate_document(jsonb);
drop function if exists public.fn_intelligence_threshold_valid(text, text, text, jsonb);
drop function if exists public.fn_intelligence_sha256(jsonb);
drop function if exists public.fn_intelligence_canonical_json(jsonb);
drop function if exists public.fn_intelligence_jsonb_integer_between(jsonb, integer, integer);
drop function if exists public.fn_intelligence_exact_keys(jsonb, text[]);
drop function if exists public.fn_intelligence_assert_admin_actor(uuid, boolean);

drop table if exists public.intelligence_rule_state;
drop table if exists public.intelligence_rule_requests;
drop table if exists public.intelligence_rule_events;
drop table if exists public.intelligence_rule_provenance;
drop table if exists public.intelligence_rules;
drop table if exists public.intelligence_rule_groups;
drop table if exists public.intelligence_rule_sets;
drop table if exists public.intelligence_rule_field_catalogue;

-- Matching: remove module-only guards and public/admin APIs first.  The eight
-- pre-existing matcher functions and the eligibility view are restored below
-- from their captured pg_get_* definitions rather than a hard-coded baseline.
drop trigger if exists trg_matching_settings_mirror_guard on public.app_settings;
drop trigger if exists trg_matching_versions_immutable on public.matching_rule_versions;
drop trigger if exists trg_matching_events_immutable on public.matching_rule_events;
drop trigger if exists trg_matching_requests_immutable on public.matching_rule_requests;
drop trigger if exists trg_matching_snapshots_immutable on public.matching_candidate_snapshots;
alter table public.matching_rule_versions
  drop constraint if exists matching_rule_versions_canonical_ck;
drop function if exists public.fn_matching_immutable_guard();
drop function if exists public.fn_matching_guard_settings_mirror();

drop function if exists public.matching_rollback_rule_version(uuid, uuid, uuid, text);
drop function if exists public.matching_activate_rule_version(uuid, uuid, uuid, uuid, text);
drop function if exists public.matching_activate_rule_version(uuid, uuid, uuid, uuid);
drop function if exists public.matching_create_rule_version(uuid, uuid, jsonb, text);
drop function if exists public.admin_matching_preview(uuid, jsonb);
drop function if exists public.admin_matching_rules_dashboard(uuid);
drop function if exists public.get_matching_rules_snapshot();
drop function if exists public.fn_matching_params();
drop function if exists public.fn_matching_replace_candidate_snapshot(uuid, integer, text, text, integer, uuid);
drop function if exists public.fn_matching_write_settings_mirror(jsonb);
drop function if exists public.fn_matching_candidate_digest(uuid);
drop function if exists public.fn_matching_evaluate(jsonb, integer, uuid, uuid);
drop function if exists public.fn_matching_validate_as_of_year(integer);
drop function if exists public.fn_matching_source_sha256(integer);
drop function if exists public.fn_matching_lock_sources_nowait();
drop function if exists public.fn_matching_assert_super_actor(uuid);
drop function if exists public.fn_matching_params_sha256(jsonb);
drop function if exists public.fn_matching_canonical_params_text(jsonb);
drop function if exists public.fn_matching_validate_params(jsonb);

do $restore_legacy_definitions$
declare
  v_catalog public.matching_rule_rollback_catalog%rowtype;
  v_ddl text;
begin
  select * into strict v_catalog
    from public.matching_rule_rollback_catalog where singleton;
  execute v_catalog.legacy_view_ddl;
  for v_ddl in select value from jsonb_array_elements_text(v_catalog.legacy_function_ddls)
  loop
    execute v_ddl;
  end loop;
  if format(
       'create or replace view public.v_eligible_matches as %s',
       pg_get_viewdef('public.v_eligible_matches'::regclass, true)
     ) is distinct from v_catalog.legacy_view_ddl
     or jsonb_build_array(
       pg_get_functiondef('public.fn_refresh_matches_for_cargo(uuid)'::regprocedure),
       pg_get_functiondef('public.fn_refresh_matches_for_availability(uuid)'::regprocedure),
       pg_get_functiondef('public.fn_refresh_matches()'::regprocedure),
       pg_get_functiondef('public.trg_refresh_matches_cargo()'::regprocedure),
       pg_get_functiondef('public.trg_refresh_matches_availability()'::regprocedure),
       pg_get_functiondef('public.trg_refresh_matches_vessel()'::regprocedure),
       pg_get_functiondef('public.get_matches_for_cargo(uuid)'::regprocedure),
       pg_get_functiondef('public.get_matches_for_availability(uuid)'::regprocedure)
     ) is distinct from v_catalog.legacy_function_ddls then
    raise exception 'MATCHING_ROLLBACK: deployed matcher definitions were not restored exactly'
      using errcode = '55000';
  end if;
end;
$restore_legacy_definitions$;

-- Restore the legacy cache shape.  When the source universe is unchanged, the
-- exact pre-migration rows (including ids and computed_at) remain authoritative.
-- When any cargo, availability or vessel changed while this module was live,
-- restoring that old cache would create a stale/incomplete result set; restore
-- the legacy functions/schema first and ask the restored full refresh to
-- derive the cache from the current sources instead.
alter table public.matches drop constraint if exists matches_governed_values_ck;
alter table public.matches drop constraint if exists matches_matching_rule_version_id_fkey;
delete from public.matches;
alter table public.matches drop column if exists matching_rule_version_id;
alter table public.matches drop column if exists match_score;
alter table public.matches drop column if exists is_rate_aligned;
alter table public.matches drop column if exists dwt_delta;
alter table public.matches drop column if exists matching_as_of_year;

do $restore_cache$
declare
  v_catalog public.matching_rule_rollback_catalog%rowtype;
  v_restored jsonb;
  v_current_source_hash text;
begin
  select * into strict v_catalog
    from public.matching_rule_rollback_catalog where singleton;
  v_current_source_hash := public.fn_matching_rollback_source_sha256();

  if v_current_source_hash = v_catalog.source_rows_sha256 then
    insert into public.matches
    select * from jsonb_populate_recordset(null::public.matches, v_catalog.matches_rows);

    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
      into v_restored from public.matches m;
    if encode(extensions.digest(v_restored::text, 'sha256'), 'hex')
         <> v_catalog.matches_rows_sha256
       or v_restored is distinct from v_catalog.matches_rows then
      raise exception 'MATCHING_ROLLBACK: restored cache does not equal the captured cache'
        using errcode = '55000';
    end if;
  else
    perform public.fn_refresh_matches();
    if exists (
      (select m.cargo_id, m.vessel_avail_id, m.score_label
         from public.matches m
       except all
       select e.cargo_id, e.vessel_avail_id, e.score_label
         from public.v_eligible_matches e)
      union all
      (select e.cargo_id, e.vessel_avail_id, e.score_label
         from public.v_eligible_matches e
       except all
       select m.cargo_id, m.vessel_avail_id, m.score_label
         from public.matches m)
    ) then
      raise exception 'MATCHING_ROLLBACK: restored legacy refresh did not reproduce current eligible matches'
        using errcode = '55000';
    end if;
  end if;
end;
$restore_cache$;

drop function public.fn_matching_rollback_source_sha256();

-- Restore the compatibility setting with its original timestamp, including
-- the distinction between a missing row and a JSON null value.
do $restore_setting$
declare
  v_catalog public.matching_rule_rollback_catalog%rowtype;
begin
  select * into strict v_catalog
    from public.matching_rule_rollback_catalog where singleton;
  if v_catalog.setting_existed then
    insert into public.app_settings(key, value, updated_at)
    values ('matching_rules', v_catalog.setting_value, v_catalog.setting_updated_at)
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  else
    delete from public.app_settings where key = 'matching_rules';
  end if;
  if v_catalog.setting_existed and not exists (
       select 1 from public.app_settings s
       where s.key = 'matching_rules'
         and s.value is not distinct from v_catalog.setting_value
         and s.updated_at is not distinct from v_catalog.setting_updated_at
     ) then
    raise exception 'MATCHING_ROLLBACK: compatibility setting was not restored exactly'
      using errcode = '55000';
  elsif not v_catalog.setting_existed
        and exists (select 1 from public.app_settings where key = 'matching_rules') then
    raise exception 'MATCHING_ROLLBACK: compatibility setting should be absent'
      using errcode = '55000';
  end if;
end;
$restore_setting$;

-- Clear only the principals changed by the forward migration, then replay the
-- captured grants (including PUBLIC defaults and WITH GRANT OPTION).
revoke all on table public.matches from public, anon, authenticated, service_role;
revoke all on table public.v_eligible_matches from public, anon, authenticated, service_role;
revoke all on function public.fn_refresh_matches_for_cargo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_refresh_matches_for_availability(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_refresh_matches() from public, anon, authenticated, service_role;
revoke all on function public.trg_refresh_matches_cargo() from public, anon, authenticated, service_role;
revoke all on function public.trg_refresh_matches_availability() from public, anon, authenticated, service_role;
revoke all on function public.trg_refresh_matches_vessel() from public, anon, authenticated, service_role;
revoke all on function public.get_matches_for_cargo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_matches_for_availability(uuid) from public, anon, authenticated, service_role;

do $restore_acls$
declare
  v_catalog public.matching_rule_rollback_catalog%rowtype;
  v_ddl text;
begin
  select * into strict v_catalog
    from public.matching_rule_rollback_catalog where singleton;
  for v_ddl in
    select value from jsonb_array_elements_text(
      v_catalog.matches_acl_ddls
      || v_catalog.legacy_view_acl_ddls
      || v_catalog.legacy_function_acl_ddls
    )
  loop
    execute v_ddl;
  end loop;
end;
$restore_acls$;

drop table if exists public.matching_candidate_snapshots;
drop table if exists public.matching_candidates;
drop table if exists public.matching_rule_state;
drop table if exists public.matching_rule_requests;
drop table if exists public.matching_rule_events;
drop table if exists public.matching_rule_versions;

-- Keep this last: every restoration value above is sourced from it.
drop table public.matching_rule_rollback_catalog;

notify pgrst, 'reload schema';
commit; -- RULES_DOWN_TRANSACTION_END
