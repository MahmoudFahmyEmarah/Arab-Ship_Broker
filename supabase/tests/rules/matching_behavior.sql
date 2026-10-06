-- Transactional Stream R matching behavior proof. Intended for isolated asb_rules.
begin;

do $behavior$
declare
  v_maker uuid := gen_random_uuid();
  v_checker uuid := gen_random_uuid();
  v_sub_admin uuid := gen_random_uuid();
  v_cargo uuid := gen_random_uuid();
  v_vessel_aligned uuid := gen_random_uuid();
  v_vessel_closer uuid := gen_random_uuid();
  v_vessel_lower uuid := gen_random_uuid();
  v_vessel_part uuid := gen_random_uuid();
  v_vessel_late uuid := gen_random_uuid();
  v_avail_aligned uuid := gen_random_uuid();
  v_avail_closer uuid := gen_random_uuid();
  v_avail_lower uuid := gen_random_uuid();
  v_avail_part uuid := gen_random_uuid();
  v_avail_late uuid := gen_random_uuid();
  v_create_request uuid := gen_random_uuid();
  v_activate_request uuid := gen_random_uuid();
  v_version3_request uuid := gen_random_uuid();
  v_rollback_request uuid := gen_random_uuid();
  v_redo_request uuid := gen_random_uuid();
  v_active1 uuid;
  v_active2 uuid;
  v_version3 uuid;
  v_result jsonb;
  v_replay jsonb;
  v_params jsonb;
  v_params3 jsonb;
  v_first uuid;
  v_denied boolean;
  v_count integer;
  v_snapshot_count integer;
  v_as_of_year integer;
  v_source_before text;
  v_source_after text;
begin
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
    crypt('MatchingBehavior1!', gen_salt('bf')),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  from (values
    (v_maker, 'matching-maker-' || v_maker || '@example.test'),
    (v_checker, 'matching-checker-' || v_checker || '@example.test'),
    (v_sub_admin, 'matching-sub-' || v_sub_admin || '@example.test')
  ) as fixture(id, email);

  insert into public.users(
    id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier
  ) values
    (v_maker, v_maker, 'matching-maker-' || v_maker || '@example.test', 'Matching Maker', 'admin', true, null, 'T4'),
    (v_checker, v_checker, 'matching-checker-' || v_checker || '@example.test', 'Matching Checker', 'admin', true, 'super', 'T4'),
    (v_sub_admin, v_sub_admin, 'matching-sub-' || v_sub_admin || '@example.test', 'Matching Sub Admin', 'admin', true, 'sub', 'T4');

  select active_version_id, cache_as_of_year into v_active1, v_as_of_year
  from public.matching_rule_state where singleton;
  v_params := public.fn_matching_params();

  execute 'set local role service_role';
  if current_user <> 'service_role' then
    raise exception 'MATCHING TEST: service-role invocation setup failed';
  end if;
  v_denied := false;
  begin
    perform public.matching_create_rule_version(
      v_sub_admin, gen_random_uuid(), v_params, 'Sub-admin must not publish'
    );
  exception when others then
    if sqlerrm like 'MATCHING_AUTH:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: sub-admin passed the create gate as service_role'; end if;
  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_sub_admin, gen_random_uuid(), gen_random_uuid(), v_active1, 'ACTIVATE v0'
    );
  exception when others then
    if sqlerrm like 'MATCHING_AUTH:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: sub-admin passed the activation gate as service_role'; end if;
  v_denied := false;
  begin
    perform public.admin_matching_rules_dashboard(v_sub_admin);
  exception when others then
    if sqlerrm like 'MATCHING_AUTH:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: sub-admin read the rules dashboard as service_role'; end if;
  v_denied := false;
  begin
    perform public.admin_matching_preview(v_sub_admin, v_params);
  exception when others then
    if sqlerrm like 'MATCHING_AUTH:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: sub-admin ran a matching preview as service_role'; end if;

  -- A legacy super-admin row with a null tier remains authorised by design.
  v_result := public.admin_matching_rules_dashboard(v_maker);
  if v_result#>>'{state,activeVersionId}' is distinct from v_active1::text
     or jsonb_typeof(v_result->'versionHistory') is distinct from 'array'
     or jsonb_typeof(v_result->'recentEvents') is distinct from 'array' then
    raise exception 'MATCHING TEST: super-admin dashboard result is incomplete';
  end if;
  v_result := public.admin_matching_preview(v_checker, v_params);
  if (v_result->>'activeVersionId')::uuid is distinct from v_active1
     or (v_result->>'asOfYear')::integer is distinct from extract(year from (current_timestamp at time zone 'UTC'))::integer
     or (v_result->>'currentCandidateCount')::integer is distinct from (v_result->>'proposedCandidateCount')::integer
     or (v_result->>'addedCount')::integer <> 0
     or (v_result->>'removedCount')::integer <> 0
     or v_result->>'activeParamsSha256' is distinct from v_result->>'proposedParamsSha256' then
    raise exception 'MATCHING TEST: no-change matching preview is inconsistent: %', v_result;
  end if;
  execute 'set local role none';
  if public.fn_matching_source_sha256(v_as_of_year)
       = public.fn_matching_source_sha256(v_as_of_year + 1) then
    raise exception 'MATCHING TEST: source evidence hash does not bind the explicit as-of year';
  end if;

  insert into public.cargo_listings(
    id, ref, status, cargo_type, commodity_name, qty_min_mt, qty_max_mt,
    load_port_locode, load_port_name, load_zone,
    disch_port_locode, disch_port_name, disch_zone,
    laycan_from, laycan_to, is_spot, freight_idea_usd_mt,
    requires_geared, review_status
  ) values (
    v_cargo, 'MATCH-R-' || left(v_cargo::text, 8), 'IN', 'Dry Bulk',
    'Matching SQL fixture', 800, 1000,
    'GRPIR', 'Load Test', 'E.MED',
    'KWSWK', 'Discharge Test', 'AG',
    '2026-06-01', '2026-06-05', false, 30.25,
    false, 'APPROVED'
  );

  insert into public.vessels(
    id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, is_geared,
    grain_certified, dg_certified, max_loa_m, max_draft_m, is_sanctioned
  ) values
    (v_vessel_aligned, 'MATCH ALIGNED', '9100009', 'Bulk Carrier', 1100, 2018, false, true, true, 150, 8, false),
    (v_vessel_closer, 'MATCH CLOSER', '9200005', 'Bulk Carrier', 1000, 2018, false, true, true, 150, 8, false),
    (v_vessel_lower, 'MATCH LOWER', '9300001', 'Bulk Carrier', 900, 2018, false, true, true, 150, 8, false),
    (v_vessel_part, 'MATCH PART', '9400007', 'Bulk Carrier', 1200, 2018, false, true, true, 150, 8, false),
    (v_vessel_late, 'MATCH LATE', '9500003', 'Bulk Carrier', 1000, 2018, false, true, true, 150, 8, false);

  insert into public.vessel_availability(
    id, vessel_id, open_port_name, open_zone, open_date,
    freight_idea_usd_mt, accepts_part_cargo, status, review_status
  ) values
    (v_avail_aligned, v_vessel_aligned, 'Open Test A', 'E.MED', '2026-05-11', 35.25, false, 'OPEN', 'APPROVED'),
    (v_avail_closer, v_vessel_closer, 'Open Test B', 'E.MED', '2026-06-15', 35.26, false, 'OPEN', 'APPROVED'),
    (v_avail_lower, v_vessel_lower, 'Open Test C', 'E.MED', '2026-06-01', null, false, 'OPEN', 'APPROVED'),
    (v_avail_part, v_vessel_part, 'Open Test D', 'E.MED', '2026-06-01', null, true, 'OPEN', 'APPROVED'),
    (v_avail_late, v_vessel_late, 'Open Test E', 'E.MED', '2026-05-10', 30, false, 'OPEN', 'APPROVED');

  -- Default parity and inclusive boundaries: +10/-10 DWT, +20 part cargo,
  -- laycan -21/+14 all match; day -22 does not.
  if not exists (select 1 from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_aligned)) then
    raise exception 'MATCHING TEST: +10 percent / -21 day boundary was excluded';
  end if;
  if not exists (select 1 from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_closer)) then
    raise exception 'MATCHING TEST: exact DWT / +14 day boundary was excluded';
  end if;
  if not exists (select 1 from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_lower)) then
    raise exception 'MATCHING TEST: -10 percent DWT boundary was excluded';
  end if;
  if not exists (select 1 from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_part)) then
    raise exception 'MATCHING TEST: +20 percent part-cargo boundary was excluded';
  end if;
  if exists (select 1 from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_late)) then
    raise exception 'MATCHING TEST: laycan day -22 was included';
  end if;
  if not coalesce((
    select e.is_rate_aligned
    from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_aligned) e
  ), false) or coalesce((
    select e.is_rate_aligned
    from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, v_avail_closer) e
  ), true) then
    raise exception 'MATCHING TEST: inclusive two-decimal rate boundary drifted';
  end if;
  if exists (
    select 1 from public.fn_matching_evaluate(
      jsonb_set(v_params, '{minScoreLabel}', '"Strong"'::jsonb),
      v_as_of_year, v_cargo, v_avail_lower
    )
  ) or not exists (
    select 1 from public.fn_matching_evaluate(
      jsonb_set(v_params, '{minScoreLabel}', '"Good"'::jsonb),
      v_as_of_year, v_cargo, v_avail_lower
    )
  ) then
    raise exception 'MATCHING TEST: minimum score label thresholds drifted from Good=3/Strong=4';
  end if;

  select availability_id into v_first
  from public.get_matches_for_cargo(v_cargo) limit 1;
  if v_first is distinct from v_avail_aligned then
    raise exception 'MATCHING TEST: default rate-aligned candidate did not rank first';
  end if;
  if exists (
    select 1
    from public.fn_matching_evaluate(v_params, v_as_of_year, v_cargo, null) e
    full join (
      select * from public.matching_candidates
      where version_id = v_active1 and cargo_id = v_cargo
    ) c
      on c.cargo_id = e.cargo_id
     and c.vessel_avail_id = e.vessel_avail_id
    where e.cargo_id is null or c.cargo_id is null
       or e.score is distinct from c.score
       or e.score_label is distinct from c.score_label
       or e.is_rate_aligned is distinct from c.is_rate_aligned
       or e.dwt_delta is distinct from c.dwt_delta
       or c.as_of_year is distinct from v_as_of_year
  ) then
    raise exception 'MATCHING TEST: default evaluator and active cache are not exactly equivalent';
  end if;

  -- Unknown fields and a zero-effective-score configuration fail closed.
  v_denied := false;
  begin
    perform public.fn_matching_validate_params(v_params || jsonb_build_object('unknown', 1));
  exception when others then
    if sqlerrm like 'MATCHING_INPUT:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: unknown params field was accepted'; end if;

  v_denied := false;
  begin
    perform public.fn_matching_validate_params(
      jsonb_set(v_params, '{score}', '{"dwtTight":0,"dwtLoose":0,"zoneLoad":0,"zoneDisch":0,"gear":0}'::jsonb)
    );
  exception when others then
    if sqlerrm like 'MATCHING_INPUT:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: zero-effective score was accepted'; end if;

  -- Widen only the governed rate-alignment ranking threshold.  Creation is
  -- idempotent and the same key cannot be reused with altered input.
  v_params := jsonb_set(v_params, '{rateAlignmentUsd}', '10'::jsonb);
  v_result := public.matching_create_rule_version(
    v_maker, v_create_request, v_params, 'Behavior test rate alignment'
  );
  v_replay := public.matching_create_rule_version(
    v_maker, v_create_request, v_params, 'Behavior test rate alignment'
  );
  if v_replay is distinct from v_result then
    raise exception 'MATCHING TEST: create request replay changed its result';
  end if;
  v_active2 := (v_result->>'versionId')::uuid;

  v_denied := false;
  begin
    perform public.matching_create_rule_version(
      v_maker, v_create_request,
      jsonb_set(v_params, '{rateAlignmentUsd}', '11'::jsonb),
      'Behavior test rate alignment'
    );
  exception when others then
    if sqlerrm like 'MATCHING_IDEMPOTENCY:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: altered create replay was accepted'; end if;

  -- Activation uses compare-and-set and cannot mutate state on a stale caller.
  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_checker, gen_random_uuid(), v_active2, gen_random_uuid(),
      'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_active2)
    );
  exception when others then
    if sqlerrm like 'MATCHING_CAS:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: stale activation CAS succeeded'; end if;

  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_checker, gen_random_uuid(), v_active2, v_active1, 'ACTIVATE v999999'
    );
  exception when others then
    if sqlerrm like 'MATCHING_CONFIRMATION:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied
     or (select active_version_id from public.matching_rule_state where singleton) <> v_active1 then
    raise exception 'MATCHING TEST: invalid typed activation confirmation changed state';
  end if;

  v_result := public.matching_activate_rule_version(
    v_checker, v_activate_request, v_active2, v_active1,
    'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_active2)
  );
  v_as_of_year := (v_result->>'asOfYear')::integer;
  v_replay := public.matching_activate_rule_version(
    v_checker, v_activate_request, v_active2, v_active1,
    'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_active2)
  );
  if v_replay is distinct from v_result then
    raise exception 'MATCHING TEST: activation request replay changed its result';
  end if;
  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_checker, v_activate_request, v_active2, v_active2,
      'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_active2)
    );
  exception when others then
    if sqlerrm like 'MATCHING_IDEMPOTENCY:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'MATCHING TEST: altered activation replay was accepted';
  end if;
  if (select active_version_id from public.matching_rule_state where singleton) <> v_active2
     or (select previous_version_id from public.matching_rule_state where singleton) <> v_active1 then
    raise exception 'MATCHING TEST: activation pointer/previous pointer is wrong';
  end if;
  if (select value from public.app_settings where key = 'matching_rules')
       is distinct from public.fn_matching_params() then
    raise exception 'MATCHING TEST: activation did not switch the compatibility mirror atomically';
  end if;

  select availability_id into v_first
  from public.get_matches_for_cargo(v_cargo) limit 1;
  if v_first is distinct from v_avail_closer then
    raise exception 'MATCHING TEST: governed rate-alignment change did not affect ranking';
  end if;

  select count(*) into v_count from public.matching_candidates where version_id = v_active2;
  select candidate_count into v_snapshot_count
  from public.matching_candidate_snapshots where version_id = v_active2;
  if v_count <> v_snapshot_count
     or v_count = 0
     or v_as_of_year is distinct from (select cache_as_of_year from public.matching_rule_state where singleton)
     or v_as_of_year is distinct from (select as_of_year from public.matching_candidate_snapshots where version_id = v_active2)
     or v_as_of_year is distinct from (
       select evaluation_as_of_year from public.matching_rule_events
       where version_id = v_active2 and event_type = 'version_activated'
       order by id desc limit 1
     )
     or v_count <> (select count(*) from public.matches)
     or exists (
       select 1 from public.matches m
       where m.matching_rule_version_id is null
          or m.matching_rule_version_id <> v_active2
          or m.match_score is null
          or m.is_rate_aligned is null
          or m.dwt_delta is null
          or m.matching_as_of_year is distinct from v_as_of_year
          or m.score_label <> case when m.match_score >= 4 then 'Strong'
                                   when m.match_score >= 3 then 'Good' else 'Possible' end
     ) then
    raise exception 'MATCHING TEST: activation cache count/version/labels are not atomic';
  end if;
  if exists (
    select 1
    from public.matches m
    full join (
      select * from public.matching_candidates where version_id = v_active2
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
    raise exception 'MATCHING TEST: activated compatibility cache differs from governed candidates';
  end if;
  if exists (
    select 1 from public.matching_candidates c
    where c.version_id not in (v_active1, v_active2)
  ) then
    raise exception 'MATCHING TEST: candidate retention exceeded active + previous';
  end if;

  -- Change a governed source after activation. Per-row refresh updates only the
  -- active v2 cache, so v1 is deliberately stale before the rollback command.
  v_source_before := public.fn_matching_source_sha256(v_as_of_year);
  if not coalesce((
    select is_rate_aligned from public.matching_candidates
    where version_id = v_active1
      and cargo_id = v_cargo
      and vessel_avail_id = v_avail_aligned
  ), false) then
    raise exception 'MATCHING TEST: rollback stale-candidate precondition was not established';
  end if;
  update public.cargo_listings
  set freight_idea_usd_mt = 50.25
  where id = v_cargo;
  v_source_after := public.fn_matching_source_sha256(v_as_of_year);
  if v_source_after = v_source_before then
    raise exception 'MATCHING TEST: source mutation did not change rollback evidence';
  end if;
  if not coalesce((
       select is_rate_aligned from public.matching_candidates
       where version_id = v_active1
         and cargo_id = v_cargo
         and vessel_avail_id = v_avail_aligned
     ), false)
     or coalesce((
       select is_rate_aligned
       from public.fn_matching_evaluate(
         (select params from public.matching_rule_versions where id = v_active1),
         v_as_of_year, v_cargo, v_avail_aligned
       )
     ), true) then
    raise exception 'MATCHING TEST: retained v1 candidates were not demonstrably stale before rollback';
  end if;

  v_denied := false;
  begin
    perform public.matching_rollback_rule_version(
      v_checker, gen_random_uuid(), v_active2, 'ROLLBACK v999999'
    );
  exception when others then
    if sqlerrm like 'MATCHING_CONFIRMATION:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied
     or (select active_version_id from public.matching_rule_state where singleton) <> v_active2 then
    raise exception 'MATCHING TEST: invalid typed rollback confirmation changed state';
  end if;

  v_result := public.matching_rollback_rule_version(
    v_checker, v_rollback_request, v_active2,
    'ROLLBACK v' || (select version_no from public.matching_rule_versions where id = v_active1)
  );
  v_replay := public.matching_rollback_rule_version(
    v_checker, v_rollback_request, v_active2,
    'ROLLBACK v' || (select version_no from public.matching_rule_versions where id = v_active1)
  );
  if v_replay is distinct from v_result then
    raise exception 'MATCHING TEST: rollback request replay changed its result';
  end if;
  v_denied := false;
  begin
    perform public.matching_rollback_rule_version(
      v_checker, v_rollback_request, v_active2, 'ROLLBACK v999999'
    );
  exception when others then
    if sqlerrm like 'MATCHING_IDEMPOTENCY:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'MATCHING TEST: altered rollback request replay was accepted';
  end if;
  if (select active_version_id from public.matching_rule_state where singleton) <> v_active1
     or (select previous_version_id from public.matching_rule_state where singleton) <> v_active2
     or (select source_sha256 from public.matching_candidate_snapshots where version_id = v_active1)
          is distinct from v_source_after
     or (v_result->>'sourceSha256') is distinct from v_source_after
     or not exists (
       select 1 from public.matching_rule_events
       where request_id = v_rollback_request
         and event_type = 'version_rolled_back'
         and version_id = v_active1
         and prior_version_id = v_active2
     ) then
    raise exception 'MATCHING TEST: rollback pointer/snapshot/event evidence is incomplete';
  end if;
  if exists (
    select 1
    from public.fn_matching_evaluate(
      (select params from public.matching_rule_versions where id = v_active1),
      v_as_of_year, null, null
    ) e
    full join (
      select * from public.matching_candidates where version_id = v_active1
    ) c on c.cargo_id = e.cargo_id and c.vessel_avail_id = e.vessel_avail_id
    where e.cargo_id is null or c.cargo_id is null
       or e.score is distinct from c.score
       or e.score_label is distinct from c.score_label
       or e.is_rate_aligned is distinct from c.is_rate_aligned
       or e.dwt_delta is distinct from c.dwt_delta
       or c.as_of_year is distinct from v_as_of_year
  ) then
    raise exception 'MATCHING TEST: rollback reused stale candidates instead of rebuilding current sources';
  end if;
  if exists (
    select 1 from public.matches m
    full join (
      select * from public.matching_candidates where version_id = v_active1
    ) c
      on c.cargo_id = m.cargo_id
     and c.vessel_avail_id = m.vessel_avail_id
    where m.id is null or c.cargo_id is null
       or m.match_score is distinct from c.score
       or m.score_label is distinct from c.score_label
       or m.is_rate_aligned is distinct from c.is_rate_aligned
       or m.dwt_delta is distinct from c.dwt_delta
       or m.matching_as_of_year is distinct from c.as_of_year
  ) then
    raise exception 'MATCHING TEST: rollback compatibility cache is not the rebuilt target';
  end if;

  -- The distinct rollback command can also reverse the rollback. This restores
  -- v2 as active for the remaining forward-activation failure checks.
  perform public.matching_rollback_rule_version(
    v_checker, v_redo_request, v_active1,
    'ROLLBACK v' || (select version_no from public.matching_rule_versions where id = v_active2)
  );
  if (select active_version_id from public.matching_rule_state where singleton) <> v_active2
     or (select previous_version_id from public.matching_rule_state where singleton) <> v_active1 then
    raise exception 'MATCHING TEST: second rollback did not restore the prior active version';
  end if;

  -- A newer draft exists, but reverse activation and stale-CAS activation are
  -- both prohibited.
  v_params3 := jsonb_set(v_params, '{rateAlignmentUsd}', '15'::jsonb);
  v_result := public.matching_create_rule_version(
    v_maker, v_version3_request, v_params3, 'Behavior test future version'
  );
  v_version3 := (v_result->>'versionId')::uuid;

  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_checker, gen_random_uuid(), v_active1, v_active2,
      'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_active1)
    );
  exception when others then
    if sqlerrm like 'MATCHING_DIRECTION:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: reverse activation succeeded'; end if;

  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_checker, gen_random_uuid(), v_version3, v_active1,
      'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_version3)
    );
  exception when others then
    if sqlerrm like 'MATCHING_CAS:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: future version ignored stale CAS'; end if;

  v_denied := false;
  begin update public.matching_rule_versions set note = 'mutated' where id = v_active2;
  exception when others then
    if sqlerrm like 'MATCHING_IMMUTABLE:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: immutable rule version was edited'; end if;

  v_denied := false;
  begin update public.app_settings set value = v_params3 where key = 'matching_rules';
  exception when others then
    if sqlerrm like 'MATCHING_MIRROR:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'MATCHING TEST: compatibility mirror accepted a second authority'; end if;

  -- Listing erasure/deletion cascades through both retained candidate versions
  -- and the active public cache; no candidate can block the source delete.
  delete from public.cargo_listings where id = v_cargo;
  if exists (select 1 from public.matching_candidates where cargo_id = v_cargo)
     or exists (select 1 from public.matches where cargo_id = v_cargo) then
    raise exception 'MATCHING TEST: source deletion left candidates/cache rows behind';
  end if;

  -- Fail closed when the stable source snapshot has no eligible candidates;
  -- neither the pointer nor target-version artefacts may move on refusal.
  update public.cargo_listings
  set status = 'OUT'
  where status::text in ('IN', 'PARTIAL');
  v_denied := false;
  begin
    perform public.matching_activate_rule_version(
      v_checker, gen_random_uuid(), v_version3, v_active2,
      'ACTIVATE v' || (select version_no from public.matching_rule_versions where id = v_version3)
    );
  exception when others then
    if sqlerrm like 'MATCHING_EMPTY:%' then v_denied := true; else raise; end if;
  end;
  if not v_denied
     or (select active_version_id from public.matching_rule_state where singleton) <> v_active2
     or exists (select 1 from public.matching_candidates where version_id = v_version3)
     or exists (select 1 from public.matching_candidate_snapshots where version_id = v_version3) then
    raise exception 'MATCHING TEST: zero-candidate activation did not fail atomically';
  end if;
end;
$behavior$;

do $marker$ begin
  raise notice 'MATCHING BEHAVIOR: ALL ASSERTIONS PASSED';
end $marker$;
rollback;
