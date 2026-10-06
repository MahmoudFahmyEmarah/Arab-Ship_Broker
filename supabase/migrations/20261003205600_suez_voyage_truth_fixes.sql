-- ════════════════════════════════════════════════════════════════════════
-- Stream S · truth-boundary fixes (6 Oct 2026) — answers C2O-050 (audit of 03ef680)
--
--   #5  the escort-tug facts and the rest of the Suez vessel facts are governed:
--       vessel_economics_profiles gains build_year, crane_count, crane_swl_mt,
--       beam_ft and double_bottom; the read and the upsert carry them. Arrival
--       draft stays a voyage fact (a broker input), never a profile fact.
--   P2  escort_tugs and contingent params are validated structurally in SQL.
--   #6  legacy event origin: before 20261003205500 the version trigger read the
--       SESSION actor, which is null under the service role the admin RPCs run
--       with, so real admin actions were stored without an actor and the 205500
--       backfill labelled them 'system'. Events of a version (or SDR rate) that a
--       person created are 'command'; only seed / migration events stay 'system'.
--   #6  a forced DOWN leaves durable evidence: public.schema_rollback_evidence is
--       NOT part of Stream S and survives its DOWN.
--
-- Additive; idempotent. DOWN: supabase/rollback/20261003_suez_voyage_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · governed Suez vessel facts (C2O-050 #1, #5) ────────────────────────
alter table public.vessel_economics_profiles
  add column if not exists build_year   smallint check (build_year is null or build_year between 1900 and 2100),
  add column if not exists crane_count  smallint check (crane_count is null or crane_count between 0 and 20),
  add column if not exists crane_swl_mt numeric(6,1) check (crane_swl_mt is null or crane_swl_mt between 0 and 1000),
  add column if not exists beam_ft      numeric(5,1) check (beam_ft is null or beam_ft between 10 and 300),
  add column if not exists double_bottom boolean;
comment on column public.vessel_economics_profiles.beam_ft is 'Moulded beam in feet (escort-tug triggers). Arrival draft is a voyage fact, not stored here.';
comment on column public.vessel_economics_profiles.double_bottom is 'Double-bottom tanks (escort-tug trigger for laden tankers/bulkers under 70,000 SCNT); null = unknown.';

-- ── 1b · version validator: escort / contingent structure (C2O-050 P2) ─────
create or replace function public.fn_suez_validate_version(p_version_id uuid)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $validate$
declare
  it record;
  prev_to numeric;
  n integer;
  t jsonb;
  v_regime text;
begin
  select surcharge_regime into v_regime from public.suez_tariff_versions where id = p_version_id;
  if v_regime is null then raise exception 'SUEZ_NOT_FOUND: version %', p_version_id using errcode = 'P0002'; end if;

  select count(*) into n from public.suez_tariff_items where version_id = p_version_id and is_active;
  if n = 0 then raise exception 'SUEZ_INVALID: a version needs at least one active item' using errcode = '23514'; end if;
  select count(*) into n from public.suez_tariff_version_sources where version_id = p_version_id;
  if n = 0 then raise exception 'SUEZ_INVALID: a version cites no source record; register and cite the circular it is built from' using errcode = '23514'; end if;

  for it in select * from public.suez_tariff_items where version_id = p_version_id and is_active loop
    if it.layer = 'conditional' and it.condition_key is null then
      raise exception 'SUEZ_INVALID: item % is conditional without a condition key', it.code using errcode = '23514';
    end if;
    if it.layer = 'toll' and it.basis <> 'toll_tiered_scnt' then
      raise exception 'SUEZ_INVALID: item % in the toll layer must use toll_tiered_scnt', it.code using errcode = '23514';
    end if;
    if it.layer = 'surcharge' and (it.category_scope is null or jsonb_typeof(it.params -> 'pct') is distinct from 'number'
                                    or (it.params ->> 'pct')::numeric < 0 or (it.params ->> 'pct')::numeric > 1000) then
      raise exception 'SUEZ_INVALID: surcharge % needs a category scope and a pct between 0 and 1000', it.code using errcode = '23514';
    end if;
    case it.basis
      when 'flat' then
        if jsonb_typeof(it.params -> 'amount') is distinct from 'number' or (it.params ->> 'amount')::numeric < 0 then
          raise exception 'SUEZ_INVALID: item % (flat) needs a non-negative numeric amount', it.code using errcode = '23514';
        end if;
      when 'pct_of_toll' then
        if not coalesce(jsonb_typeof(it.params -> 'pct') = 'number', false)
           and not coalesce(jsonb_typeof(it.params -> 'pctPerUnit') = 'number', false)
           and not coalesce(jsonb_typeof(it.params -> 'bands') = 'array' and jsonb_array_length(it.params -> 'bands') > 0, false) then
          raise exception 'SUEZ_INVALID: item % (pct_of_toll) needs pct, pctPerUnit or bands', it.code using errcode = '23514';
        end if;
      when 'tier_by_scnt' then
        if jsonb_typeof(it.params -> 'tiers') is distinct from 'array' or jsonb_array_length(it.params -> 'tiers') = 0 then
          raise exception 'SUEZ_INVALID: item % (tier_by_scnt) needs tiers', it.code using errcode = '23514';
        end if;
        prev_to := 0;
        for t in select value from jsonb_array_elements(it.params -> 'tiers') loop
          if prev_to is null then
            raise exception 'SUEZ_INVALID: item % has a band after an open-ended band', it.code using errcode = '23514';
          end if;
          if jsonb_typeof(t -> 'from') is distinct from 'number' or (t ->> 'from')::numeric is distinct from prev_to then
            raise exception 'SUEZ_INVALID: item % tiers must be contiguous from 0 (band starting at % after %)', it.code, coalesce(t ->> 'from', 'null'), prev_to using errcode = '23514';
          end if;
          if jsonb_typeof(t -> 'amount') is distinct from 'number' or jsonb_typeof(t -> 'includedUnits') is distinct from 'number' then
            raise exception 'SUEZ_INVALID: item % tier needs numeric amount and includedUnits', it.code using errcode = '23514';
          end if;
          if t -> 'to' is null or jsonb_typeof(t -> 'to') = 'null' then prev_to := null; continue; end if;
          if jsonb_typeof(t -> 'to') is distinct from 'number' then
            raise exception 'SUEZ_INVALID: item % tier upper bound must be a number or null', it.code using errcode = '23514';
          end if;
          prev_to := (t ->> 'to')::numeric;
        end loop;
        if prev_to is not null then
          raise exception 'SUEZ_INVALID: item % (tier_by_scnt) needs an open-ended last band', it.code using errcode = '23514';
        end if;
      when 'per_unit' then
        if jsonb_typeof(it.params -> 'rate') is distinct from 'number' or jsonb_typeof(it.params -> 'unit') is distinct from 'string' then
          raise exception 'SUEZ_INVALID: item % (per_unit) needs rate and unit', it.code using errcode = '23514';
        end if;
      when 'gt_threshold' then
        if jsonb_typeof(it.params -> 'threshold') is distinct from 'number' or jsonb_typeof(it.params -> 'below') is distinct from 'number' or jsonb_typeof(it.params -> 'atOrAbove') is distinct from 'number' then
          raise exception 'SUEZ_INVALID: item % (gt_threshold) needs threshold, below, atOrAbove', it.code using errcode = '23514';
        end if;
      else null;
    end case;
    if it.condition_key = 'no_mooring_cranes' and (jsonb_typeof(it.params -> 'gtThreshold') is distinct from 'number' or jsonb_typeof(it.params -> 'swlMt') is distinct from 'number' or jsonb_typeof(it.params -> 'boats') is distinct from 'number') then
      raise exception 'SUEZ_INVALID: item % needs gtThreshold, swlMt and boats in params', it.code using errcode = '23514';
    end if;
    if it.condition_key = 'overage' and jsonb_typeof(it.params -> 'ageYears') is distinct from 'number' then
      raise exception 'SUEZ_INVALID: item % needs ageYears in params', it.code using errcode = '23514';
    end if;
    -- C2O-050 P2: escort and contingent params are validated structurally in SQL, not only by the TS schema
    if it.condition_key in ('escort_tugs', 'contingent') and (it.layer <> 'conditional' or it.basis <> 'flag_only') then
      raise exception 'SUEZ_INVALID: item % (%) must be a conditional flag_only item', it.code, it.condition_key using errcode = '23514';
    end if;
    if it.condition_key = 'escort_tugs' then
      if jsonb_typeof(it.params -> 'rules') is distinct from 'array' or jsonb_array_length(it.params -> 'rules') not between 1 and 30 then
        raise exception 'SUEZ_INVALID: item % needs params.rules (1-30 escort rules)', it.code using errcode = '23514';
      end if;
      if exists (select 1 from jsonb_object_keys(it.params) k where k <> 'rules') then
        raise exception 'SUEZ_INVALID: item % escort params carry only rules', it.code using errcode = '23514';
      end if;
      for t in select value from jsonb_array_elements(it.params -> 'rules') loop
        if jsonb_typeof(t) <> 'object'
           or exists (select 1 from jsonb_object_keys(t) k where k not in ('status','categories','excludeCategories','scntMin','scntBelow','draftFtOver','beamFtOver','beamFtMax','doubleBottom','tugs'))
           or jsonb_typeof(t -> 'tugs') is distinct from 'number' or (t ->> 'tugs')::numeric not in (1, 2, 3, 4)
           or (t ? 'status' and coalesce(t ->> 'status', '') not in ('laden', 'ballast'))
           or (t ? 'doubleBottom' and (t -> 'doubleBottom') is distinct from 'false'::jsonb)
           or exists (select 1 from unnest(array['scntMin','scntBelow','draftFtOver','beamFtOver','beamFtMax']) k
                       where t ? k and (jsonb_typeof(t -> k) <> 'number' or (t ->> k)::numeric < 0))
           or exists (select 1 from unnest(array['categories','excludeCategories']) k
                       where t ? k and (jsonb_typeof(t -> k) <> 'array' or jsonb_array_length(t -> k) = 0
                                        or exists (select 1 from jsonb_array_elements(t -> k) c where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^[a-z][a-z0-9_]{1,40}$'))) then
          raise exception 'SUEZ_INVALID: item % has a malformed escort rule: %', it.code, t using errcode = '23514';
        end if;
      end loop;
    end if;
    if it.condition_key = 'contingent' then
      if exists (select 1 from jsonb_object_keys(it.params) k where k not in ('amount', 'currency'))
         or (it.params ? 'amount' and (jsonb_typeof(it.params -> 'amount') <> 'number' or (it.params ->> 'amount')::numeric < 0))
         or (it.params ? 'currency' and coalesce(it.params ->> 'currency', '') not in ('USD', 'SDR')) then
        raise exception 'SUEZ_INVALID: contingent item % carries only a non-negative amount and a USD/SDR currency', it.code using errcode = '23514';
      end if;
    end if;
  end loop;

  select count(*) into n from public.suez_tariff_items where version_id = p_version_id and is_active and layer = 'surcharge';
  if v_regime = 'modelled' and n = 0 then
    raise exception 'SUEZ_INVALID: the surcharge regime is "modelled" but the version has no surcharge item' using errcode = '23514';
  end if;
  if v_regime = 'none' and n > 0 then
    raise exception 'SUEZ_INVALID: the surcharge regime is "none" but the version carries % surcharge item(s)', n using errcode = '23514';
  end if;

  perform public.fn_suez_validate_tiers(p_version_id);
end;
$validate$;
revoke all on function public.fn_suez_validate_version(uuid) from public, anon, authenticated;
grant execute on function public.fn_suez_validate_version(uuid) to service_role;

-- ── 2 · profile read + upsert carry the new facts ─────────────────────────
create or replace function public.get_vessel_economics_profile(p_vessel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $get_profile$
declare
  v_row public.vessel_economics_profiles%rowtype;
begin
  if p_vessel_id is null or not coalesce(public.fn_vessel_economics_allowed(p_vessel_id), false) then
    return jsonb_build_object('found', false, 'allowed', false);
  end if;
  select * into v_row from public.vessel_economics_profiles where vessel_id = p_vessel_id;
  if not found then
    return jsonb_build_object('found', false, 'allowed', true, 'vesselId', p_vessel_id);
  end if;
  return jsonb_build_object(
    'found', true, 'allowed', true, 'vesselId', v_row.vessel_id,
    'scgt', v_row.scgt, 'scnt', v_row.scnt, 'gt', v_row.gt,
    'suezCategory', v_row.suez_category, 'lastSuezTransit', v_row.last_suez_transit,
    'firstTransit', v_row.first_transit, 'searchlightCompliant', v_row.searchlight_compliant,
    'mooringCranesOk', v_row.mooring_cranes_ok,
    'speedLadenKn', v_row.speed_laden_kn, 'speedBallastKn', v_row.speed_ballast_kn,
    'consumption', v_row.consumption, 'hasScrubber', v_row.has_scrubber,
    'vesselClass', v_row.vessel_class, 'source', v_row.source,
    'buildYear', v_row.build_year, 'craneCount', v_row.crane_count, 'craneSwlMt', v_row.crane_swl_mt,
    'beamFt', v_row.beam_ft, 'doubleBottom', v_row.double_bottom,
    'updatedAt', v_row.updated_at);
end;
$get_profile$;
revoke all on function public.get_vessel_economics_profile(uuid) from public, anon;
grant execute on function public.get_vessel_economics_profile(uuid) to authenticated, service_role;

create or replace function public.upsert_vessel_economics_profile(p_vessel_id uuid, p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $upsert_profile$
declare
  v_actor uuid := public.fn_market_actor();
  v_states text[] := array['sea_laden','sea_ballast','port_working','port_idle','anchorage','eca_sea'];
  v_cons jsonb := '{}'::jsonb;
  v_state text;
  v_entry jsonb;
  v_res numeric;
  v_dis numeric;
  v_before jsonb;
  v_after jsonb;
  v_speed_l numeric; v_speed_b numeric;
  v_scnt numeric; v_scgt numeric; v_gt integer;
  v_build integer; v_cranes integer; v_swl numeric; v_beam numeric;
begin
  if v_actor is null then
    raise exception 'VE_FORBIDDEN: no application actor for this session' using errcode = '42501';
  end if;
  if p_vessel_id is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'VE_INVALID: vessel id and a profile object are required' using errcode = '22023';
  end if;
  if not coalesce(public.fn_vessel_economics_allowed(p_vessel_id), false) then
    raise exception 'VE_FORBIDDEN: you do not manage this vessel' using errcode = '42501';
  end if;

  v_speed_l := nullif(p_profile ->> 'speedLadenKn', '')::numeric;
  v_speed_b := nullif(p_profile ->> 'speedBallastKn', '')::numeric;
  v_scnt := nullif(p_profile ->> 'scnt', '')::numeric;
  v_scgt := nullif(p_profile ->> 'scgt', '')::numeric;
  v_gt := nullif(p_profile ->> 'gt', '')::integer;
  v_build := nullif(p_profile ->> 'buildYear', '')::integer;
  v_cranes := nullif(p_profile ->> 'craneCount', '')::integer;
  v_swl := nullif(p_profile ->> 'craneSwlMt', '')::numeric;
  v_beam := nullif(p_profile ->> 'beamFt', '')::numeric;
  if (v_build is not null and (v_build < 1900 or v_build > 2100)) or (v_cranes is not null and (v_cranes < 0 or v_cranes > 20))
     or (v_swl is not null and (v_swl < 0 or v_swl > 1000)) or (v_beam is not null and (v_beam < 10 or v_beam > 300)) then
    raise exception 'VE_INVALID: build year 1900-2100, cranes 0-20, crane SWL 0-1000 MT, beam 10-300 ft' using errcode = '22023';
  end if;
  if (v_speed_l is not null and (v_speed_l < 3 or v_speed_l > 40)) or (v_speed_b is not null and (v_speed_b < 3 or v_speed_b > 40)) then
    raise exception 'VE_INVALID: speeds must be between 3 and 40 knots' using errcode = '22023';
  end if;
  if (v_scnt is not null and v_scnt <= 0) or (v_scgt is not null and v_scgt <= 0) or (v_gt is not null and v_gt <= 0) then
    raise exception 'VE_INVALID: tonnages must be positive' using errcode = '22023';
  end if;
  if (v_scnt is not null and v_scnt <> round(v_scnt, 2)) or (v_scgt is not null and v_scgt <> round(v_scgt, 2)) then
    raise exception 'VE_INVALID: SCNT and SCGT carry at most two decimals' using errcode = '22023';
  end if;
  foreach v_state in array v_states loop
    v_entry := p_profile -> 'consumption' -> v_state;
    if v_entry is not null and jsonb_typeof(v_entry) = 'object' then
      v_res := nullif(v_entry ->> 'residual', '')::numeric;
      v_dis := nullif(v_entry ->> 'distillate', '')::numeric;
      if (v_res is not null and (v_res < 0 or v_res > 500)) or (v_dis is not null and (v_dis < 0 or v_dis > 500)) then
        raise exception 'VE_INVALID: consumption for % out of range (0–500 MT/day)', v_state using errcode = '22023';
      end if;
      if v_res is not null or v_dis is not null then
        v_cons := v_cons || jsonb_build_object(v_state, jsonb_strip_nulls(jsonb_build_object('residual', v_res, 'distillate', v_dis)));
      end if;
    end if;
  end loop;

  select to_jsonb(p) - 'updated_by' - 'updated_at' into v_before from public.vessel_economics_profiles p where p.vessel_id = p_vessel_id;

  insert into public.vessel_economics_profiles as p (
    vessel_id, scgt, scnt, gt, suez_category, last_suez_transit, first_transit,
    searchlight_compliant, mooring_cranes_ok, speed_laden_kn, speed_ballast_kn,
    consumption, has_scrubber, vessel_class, build_year, crane_count, crane_swl_mt, beam_ft, double_bottom, source, updated_by, updated_at)
  values (
    p_vessel_id, v_scgt, v_scnt, v_gt,
    nullif(p_profile ->> 'suezCategory', ''),
    nullif(p_profile ->> 'lastSuezTransit', '')::date,
    (p_profile ->> 'firstTransit')::boolean,
    (p_profile ->> 'searchlightCompliant')::boolean,
    (p_profile ->> 'mooringCranesOk')::boolean,
    v_speed_l, v_speed_b, v_cons,
    (p_profile ->> 'hasScrubber')::boolean,
    nullif(p_profile ->> 'vesselClass', ''),
    v_build, v_cranes, v_swl, v_beam, (p_profile ->> 'doubleBottom')::boolean,
    case when public.fn_is_admin() then 'admin' else 'member' end,
    v_actor, now())
  on conflict (vessel_id) do update set
    scgt = excluded.scgt, scnt = excluded.scnt, gt = excluded.gt,
    suez_category = excluded.suez_category, last_suez_transit = excluded.last_suez_transit,
    first_transit = excluded.first_transit, searchlight_compliant = excluded.searchlight_compliant,
    mooring_cranes_ok = excluded.mooring_cranes_ok, speed_laden_kn = excluded.speed_laden_kn,
    speed_ballast_kn = excluded.speed_ballast_kn, consumption = excluded.consumption,
    has_scrubber = excluded.has_scrubber, vessel_class = excluded.vessel_class,
    build_year = excluded.build_year, crane_count = excluded.crane_count, crane_swl_mt = excluded.crane_swl_mt,
    beam_ft = excluded.beam_ft, double_bottom = excluded.double_bottom,
    source = excluded.source, updated_by = excluded.updated_by, updated_at = now();

  select to_jsonb(p) - 'updated_by' - 'updated_at' into v_after from public.vessel_economics_profiles p where p.vessel_id = p_vessel_id;
  insert into public.vessel_economics_profile_events (vessel_id, actor_user_id, action, before, after)
  values (p_vessel_id, v_actor, case when v_before is null then 'created' else 'updated' end, v_before, v_after);

  return public.get_vessel_economics_profile(p_vessel_id);
end;
$upsert_profile$;
revoke all on function public.upsert_vessel_economics_profile(uuid, jsonb) from public, anon;
grant execute on function public.upsert_vessel_economics_profile(uuid, jsonb) to authenticated, service_role;

-- ── 3 · legacy event origin (C2O-050 #6) ───────────────────────────────────
-- Only rows stored as 'system' without an actor are reconsidered. A row is a
-- person's command when it belongs to a version or SDR rate a person created;
-- seed rows (entity seed, a migration marker, or a seed version created by no
-- one) stay 'system'. Done once under the append-only guard's own trigger switch.
alter table public.suez_tariff_events disable trigger trg_suez_events_append_only;
update public.suez_tariff_events e
   set origin = 'command'
 where e.origin = 'system' and e.actor_user_id is null
   and e.entity <> 'seed' and not (e.details ? 'migration')
   and (exists (select 1 from public.suez_tariff_versions v where v.id = coalesce(e.version_id, e.entity_id) and v.created_by is not null)
        or (e.entity = 'sdr_rate' and exists (select 1 from public.sdr_rates s where s.id = e.entity_id and s.created_by is not null)));
alter table public.suez_tariff_events enable trigger trg_suez_events_append_only;

-- ── 4 · durable rollback evidence (C2O-050 #6) ─────────────────────────────
-- Outside every module: a forced DOWN records who forced it, when, and what it
-- discarded; the table is never dropped by a module DOWN.
create table if not exists public.schema_rollback_evidence (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  module      text not null,
  db_user     text not null default current_user,
  confirmation text not null,
  used_state  jsonb not null default '{}'::jsonb
);
alter table public.schema_rollback_evidence enable row level security;
revoke all on table public.schema_rollback_evidence from public, anon, authenticated, service_role;
grant select on table public.schema_rollback_evidence to service_role;
comment on table public.schema_rollback_evidence is
  'Evidence of DOWN files run over a used state (who, when, the confirmation token, the counts discarded). Not owned by any module; never dropped by a DOWN.';
