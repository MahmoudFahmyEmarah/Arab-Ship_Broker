-- Exact rollback proof after insert/update/delete writes to both governed
-- source listing families.  The DOWN must not resurrect its installation-time
-- cache snapshot; it must run the restored legacy full refresh.
-- Local/isolated only: rules-harness.sh enforces current_database()=asb_rules.
begin;

create temporary table matching_rollback_changed_probe (
  captured_source_sha256 text not null,
  cargo_id uuid not null,
  deleted_cargo_id uuid not null,
  vessel_id uuid not null,
  availability_id uuid not null,
  deleted_availability_id uuid not null
);

do $mutate_sources$
declare
  v_cargo uuid := gen_random_uuid();
  v_deleted_cargo uuid := gen_random_uuid();
  v_vessel uuid := gen_random_uuid();
  v_availability uuid := gen_random_uuid();
  v_deleted_availability uuid := gen_random_uuid();
  v_captured_hash text;
  v_synthetic_cache jsonb;
begin
  insert into public.vessels(
    id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, is_geared,
    grain_certified, dg_certified, max_loa_m, max_draft_m, is_sanctioned
  ) values (
    v_vessel, 'ROLLBACK SOURCE PROBE ' || left(v_vessel::text, 8),
    '9700005', 'Bulk Carrier', 1000, 2020, false, true, true, 150, 8, false
  );

  -- Establish a deterministic synthetic installation-time snapshot containing
  -- rows that the DELETE phase below will remove.  This makes the regression
  -- prove that a stale snapshot cannot be replayed after source deletion.
  insert into public.cargo_listings(
    id, ref, status, cargo_type, commodity_name, qty_min_mt, qty_max_mt,
    load_port_locode, load_zone, disch_port_locode, disch_zone,
    laycan_from, laycan_to, is_spot, requires_geared, review_status
  ) values (
    v_deleted_cargo, 'ROLLBACK-DEL-' || left(v_deleted_cargo::text, 8),
    'IN', 'Dry Bulk', 'Rollback deleted cargo probe', 900, 1000,
    'GRPIR', 'E.MED', 'KWSWK', 'AG',
    current_date, current_date + 2, true, false, 'APPROVED'
  );
  insert into public.vessel_availability(
    id, vessel_id, open_port_name, open_zone, open_date,
    accepts_part_cargo, status, review_status
  ) values (
    v_deleted_availability, v_vessel, 'Rollback Deleted Open Probe',
    'E.MED', current_date, false, 'OPEN', 'APPROVED'
  );

  select coalesce(
    jsonb_agg(
      to_jsonb(m) - array[
        'matching_rule_version_id', 'match_score', 'is_rate_aligned',
        'dwt_delta', 'matching_as_of_year'
      ]::text[]
      order by m.id
    ),
    '[]'::jsonb
  ) into v_synthetic_cache
  from public.matches m;
  v_captured_hash := public.fn_matching_rollback_source_sha256();
  update public.matching_rule_rollback_catalog
     set matches_rows = v_synthetic_cache,
         matches_rows_sha256 = encode(
           extensions.digest(v_synthetic_cache::text, 'sha256'), 'hex'
         ),
         source_rows_sha256 = v_captured_hash
   where singleton;

  -- Insert closed/inactive rows, then update both into an eligible surviving
  -- pair.  This exercises INSERT and UPDATE after the synthetic snapshot.
  insert into public.cargo_listings(
    id, ref, status, cargo_type, commodity_name, qty_min_mt, qty_max_mt,
    load_port_locode, load_zone, disch_port_locode, disch_zone,
    laycan_from, laycan_to, is_spot, requires_geared, review_status
  ) values (
    v_cargo, 'ROLLBACK-' || left(v_cargo::text, 8), 'CLOSED', 'Dry Bulk',
    'Rollback source probe', 900, 1000,
    'GRPIR', 'E.MED', 'KWSWK', 'AG',
    current_date, current_date + 2, true, false, 'APPROVED'
  );
  update public.cargo_listings set status = 'IN' where id = v_cargo;

  insert into public.vessel_availability(
    id, vessel_id, open_port_name, open_zone, open_date,
    accepts_part_cargo, status, review_status
  ) values (
    v_availability, v_vessel, 'Rollback Open Probe', 'AG', current_date,
    false, 'INACTIVE', 'APPROVED'
  );
  update public.vessel_availability
     set status = 'OPEN', open_zone = 'E.MED'
   where id = v_availability;

  -- Exercise DELETE against rows that are present in the captured snapshot.
  delete from public.cargo_listings where id = v_deleted_cargo;
  delete from public.vessel_availability where id = v_deleted_availability;

  insert into matching_rollback_changed_probe values (
    v_captured_hash, v_cargo, v_deleted_cargo, v_vessel,
    v_availability, v_deleted_availability
  );

  if public.fn_matching_rollback_source_sha256() = v_captured_hash then
    raise exception 'MATCHING ROLLBACK TEST: insert/update/delete source writes did not change the fingerprint';
  end if;
  if not exists (
    select 1 from public.matches
    where cargo_id = v_cargo and vessel_avail_id = v_availability
  ) then
    raise exception 'MATCHING ROLLBACK TEST: governed matcher did not materialise the surviving probe pair';
  end if;
end;
$mutate_sources$;

-- @RULES_DOWN@

do $assert_recomputed_legacy_cache$
declare
  v_probe matching_rollback_changed_probe%rowtype;
begin
  select * into strict v_probe from matching_rollback_changed_probe;

  if not exists (select 1 from public.cargo_listings where id = v_probe.cargo_id)
     or not exists (select 1 from public.vessel_availability where id = v_probe.availability_id)
     or exists (select 1 from public.cargo_listings where id = v_probe.deleted_cargo_id)
     or exists (select 1 from public.vessel_availability where id = v_probe.deleted_availability_id) then
    raise exception 'MATCHING ROLLBACK TEST: source rows changed during the DOWN';
  end if;
  if not exists (
    select 1 from public.matches
    where cargo_id = v_probe.cargo_id
      and vessel_avail_id = v_probe.availability_id
  ) then
    raise exception 'MATCHING ROLLBACK TEST: changed-source DOWN restored a stale installation-time snapshot';
  end if;
  if exists (
    select 1 from public.matches
    where cargo_id = v_probe.deleted_cargo_id
       or vessel_avail_id = v_probe.deleted_availability_id
  ) then
    raise exception 'MATCHING ROLLBACK TEST: changed-source DOWN retained a deleted source pair';
  end if;
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
    raise exception 'MATCHING ROLLBACK TEST: recomputed cache is not the exact restored legacy eligible set';
  end if;
  if to_regclass('public.matching_rule_rollback_catalog') is not null
     or to_regprocedure('public.fn_matching_rollback_source_sha256()') is not null then
    raise exception 'MATCHING ROLLBACK TEST: rollback-only catalogue/helper survived the changed-source DOWN';
  end if;
end;
$assert_recomputed_legacy_cache$;

do $marker$ begin
  raise notice 'MATCHING CHANGED-SOURCE ROLLBACK: ALL ASSERTIONS PASSED';
end $marker$;
rollback;
