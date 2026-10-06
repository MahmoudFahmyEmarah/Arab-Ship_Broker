-- Stream R: versioned matchmaking rules and one canonical SQL evaluator.
--
-- The active pointer is the only authority.  app_settings.matching_rules is
-- maintained atomically as a read-only compatibility mirror for older code.
-- Rule publication performs a complete, synchronous candidate rebuild while
-- the source/cache tables are locked against concurrent writes.  The cache,
-- active pointer and compatibility mirror switch in the same transaction.

-- On first installation, preserve the result of the deployed matcher before
-- this migration replaces its RPC.  Bootstrap must prove that the governed
-- default produces the identical pair set and ranking facts; a mismatch aborts
-- the migration instead of silently changing production behaviour.
do $capture_deployed_matching$
begin
  if to_regclass('public.matching_rule_state') is null then
    if to_regclass('public.v_eligible_matches') is null then
      raise exception 'MATCHING_EQUIVALENCE: deployed eligibility view is missing'
        using errcode = '55000';
    end if;
    begin
      lock table public.cargo_listings in share mode nowait;
      lock table public.vessel_availability in share mode nowait;
      lock table public.vessels in share mode nowait;
      lock table public.matches in share mode nowait;
    exception when lock_not_available then
      raise exception 'MATCHING_BUSY: matching sources are being updated; retry migration'
        using errcode = '55P03';
    end;
    create temporary table matching_deployed_default on commit preserve rows as
    select
      em.cargo_id,
      em.vessel_avail_id,
      (
        case
          when cl.qty_max_mt::numeric / nullif(v.dwt_grain, 0)::numeric between 0.9 and 1.0 then 2
          when cl.qty_max_mt::numeric / nullif(v.dwt_grain, 0)::numeric between 0.8 and 1.1 then 1
          else 0
        end
        + case when va.open_zone::text = cl.load_zone::text then 2
               when va.open_zone::text = cl.disch_zone::text then 1 else 0 end
        + case when cl.requires_geared is not true or coalesce(v.is_geared, false) then 1 else 0 end
      )::integer as score,
      em.score_label,
      coalesce(
        cl.freight_idea_usd_mt is not null and va.freight_idea_usd_mt is not null
          and abs(cl.freight_idea_usd_mt - va.freight_idea_usd_mt) <= 5.0,
        false
      ) as is_rate_aligned,
      abs(v.dwt_grain - cl.qty_max_mt)::integer as dwt_delta
    from public.v_eligible_matches em
    join public.cargo_listings cl on cl.id = em.cargo_id
    join public.vessel_availability va on va.id = em.vessel_avail_id
    join public.vessels v on v.id = va.vessel_id;
    create unique index on matching_deployed_default(cargo_id, vessel_avail_id);
  end if;
end;
$capture_deployed_matching$;

-- The DOWN owns these five cache columns.  Refuse a first installation over a
-- differently customised cache instead of later deleting pre-existing data
-- or schema that did not belong to this module.
do $assert_clean_cache_baseline$
begin
  if to_regclass('public.matching_rule_state') is null then
    if to_regclass('public.matching_rule_rollback_catalog') is not null
       or to_regprocedure('public.fn_matching_params()') is not null
       or to_regprocedure('public.get_matching_rules_snapshot()') is not null
       or exists (
         select 1 from pg_trigger
         where tgname like 'trg_matching_%' and not tgisinternal
       ) then
      raise exception 'MATCHING_BASELINE: partial matching-rules objects already exist without active state'
        using errcode = '55000';
    end if;
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'matches'
        and column_name = any(array[
          'matching_rule_version_id', 'match_score', 'is_rate_aligned',
          'dwt_delta', 'matching_as_of_year'
        ])
    ) then
      raise exception 'MATCHING_BASELINE: governed cache columns already exist without matching rule state'
        using errcode = '55000';
    end if;
  end if;
end;
$assert_clean_cache_baseline$;

-- Keep the exact deployed definitions needed by the DOWN.  Matching objects
-- pre-date migration history on some installations (they are bootstrapped by
-- supabase/baseline/30_matching_layer.sql), so hard-coding one historical body
-- in the rollback would not faithfully restore every supported baseline.
-- This private, single-row catalogue is removed by the DOWN after restoration.
create or replace function public.fn_matching_rollback_source_sha256()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select encode(
    extensions.digest(
      jsonb_build_object(
        'cargoListings', (
          select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
          from public.cargo_listings c
        ),
        'vesselAvailability', (
          select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)
          from public.vessel_availability a
        ),
        'vessels', (
          select coalesce(jsonb_agg(to_jsonb(v) order by v.id), '[]'::jsonb)
          from public.vessels v
        )
      )::text,
      'sha256'
    ),
    'hex'
  );
$function$;

-- This helper exists only so the DOWN can distinguish an unchanged source
-- universe (where the byte-for-byte cache snapshot is authoritative) from a
-- changed one (where the restored legacy matcher must rebuild the cache).
revoke all on function public.fn_matching_rollback_source_sha256()
  from public, anon, authenticated, service_role;

create table if not exists public.matching_rule_rollback_catalog (
  singleton boolean primary key default true check (singleton),
  legacy_view_ddl text not null,
  legacy_function_ddls jsonb not null,
  legacy_view_acl_ddls jsonb not null,
  legacy_function_acl_ddls jsonb not null,
  matches_acl_ddls jsonb not null,
  matches_rows jsonb not null,
  matches_rows_sha256 text not null check (matches_rows_sha256 ~ '^[a-f0-9]{64}$'),
  source_rows_sha256 text not null check (source_rows_sha256 ~ '^[a-f0-9]{64}$'),
  setting_existed boolean not null,
  setting_value jsonb,
  setting_updated_at timestamptz
);

alter table public.matching_rule_rollback_catalog enable row level security;
revoke all on table public.matching_rule_rollback_catalog
  from public, anon, authenticated, service_role;
grant select on table public.matching_rule_rollback_catalog to service_role;

insert into public.matching_rule_rollback_catalog(
  singleton, legacy_view_ddl, legacy_function_ddls,
  legacy_view_acl_ddls, legacy_function_acl_ddls,
  matches_acl_ddls, matches_rows, matches_rows_sha256,
  source_rows_sha256,
  setting_existed, setting_value, setting_updated_at
)
select
  true,
  format(
    'create or replace view public.v_eligible_matches as %s',
    pg_get_viewdef('public.v_eligible_matches'::regclass, true)
  ),
  jsonb_build_array(
    pg_get_functiondef('public.fn_refresh_matches_for_cargo(uuid)'::regprocedure),
    pg_get_functiondef('public.fn_refresh_matches_for_availability(uuid)'::regprocedure),
    pg_get_functiondef('public.fn_refresh_matches()'::regprocedure),
    pg_get_functiondef('public.trg_refresh_matches_cargo()'::regprocedure),
    pg_get_functiondef('public.trg_refresh_matches_availability()'::regprocedure),
    pg_get_functiondef('public.trg_refresh_matches_vessel()'::regprocedure),
    pg_get_functiondef('public.get_matches_for_cargo(uuid)'::regprocedure),
    pg_get_functiondef('public.get_matches_for_availability(uuid)'::regprocedure)
  ),
  (
    select coalesce(jsonb_agg(format(
      'grant %s on table public.v_eligible_matches to %s%s',
      upper(a.privilege_type),
      case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' with grant option' else '' end
    ) order by a.grantee, a.privilege_type), '[]'::jsonb)
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.v_eligible_matches'::regclass
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) = any(array['anon','authenticated','service_role']))
  ),
  (
    select coalesce(jsonb_agg(format(
      'grant %s on function %I.%I(%s) to %s%s',
      upper(a.privilege_type), n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid),
      case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' with grant option' else '' end
    ) order by p.proname, pg_get_function_identity_arguments(p.oid), a.grantee, a.privilege_type), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = any(array[
      'public.fn_refresh_matches_for_cargo(uuid)'::regprocedure,
      'public.fn_refresh_matches_for_availability(uuid)'::regprocedure,
      'public.fn_refresh_matches()'::regprocedure,
      'public.trg_refresh_matches_cargo()'::regprocedure,
      'public.trg_refresh_matches_availability()'::regprocedure,
      'public.trg_refresh_matches_vessel()'::regprocedure,
      'public.get_matches_for_cargo(uuid)'::regprocedure,
      'public.get_matches_for_availability(uuid)'::regprocedure
    ])
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) = any(array['anon','authenticated','service_role']))
  ),
  (
    select coalesce(jsonb_agg(format(
      'grant %s on table public.matches to %s%s',
      upper(a.privilege_type),
      case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' with grant option' else '' end
    ) order by a.grantee, a.privilege_type), '[]'::jsonb)
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.matches'::regclass
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) = any(array['anon','authenticated','service_role']))
  ),
  (
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    from public.matches m
  ),
  (
    select encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)::text,
      'sha256'
    ), 'hex')
    from public.matches m
  ),
  public.fn_matching_rollback_source_sha256(),
  exists(select 1 from public.app_settings where key = 'matching_rules'),
  (select value from public.app_settings where key = 'matching_rules'),
  (select updated_at from public.app_settings where key = 'matching_rules')
on conflict (singleton) do nothing;

create table if not exists public.matching_rule_versions (
  id uuid primary key default gen_random_uuid(),
  version_no bigint generated always as identity unique not null,
  schema_version integer not null check (schema_version = 1),
  evaluator_version text not null check (evaluator_version = 'matching-v1'),
  params jsonb not null,
  params_sha256 text not null check (params_sha256 ~ '^[a-f0-9]{64}$'),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.matching_rule_state (
  singleton boolean primary key default true check (singleton),
  active_version_id uuid not null references public.matching_rule_versions(id),
  previous_version_id uuid references public.matching_rule_versions(id),
  activation_sequence bigint not null default 1 check (activation_sequence > 0),
  activated_by uuid references public.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  cache_as_of_year integer not null check (cache_as_of_year between 1900 and 3000),
  check (previous_version_id is distinct from active_version_id)
);

create table if not exists public.matching_rule_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('version_created', 'version_activated', 'version_rolled_back')),
  version_id uuid not null references public.matching_rule_versions(id),
  prior_version_id uuid references public.matching_rule_versions(id),
  request_id uuid unique,
  actor_id uuid references public.users(id) on delete set null,
  params_sha256 text not null check (params_sha256 ~ '^[a-f0-9]{64}$'),
  candidate_count integer check (candidate_count is null or candidate_count >= 0),
  candidate_sha256 text check (candidate_sha256 is null or candidate_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  evaluation_as_of_year integer check (evaluation_as_of_year is null or evaluation_as_of_year between 1900 and 3000),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (
    (event_type = 'version_created' and evaluation_as_of_year is null)
    or (event_type in ('version_activated', 'version_rolled_back') and evaluation_as_of_year is not null)
  )
);

create table if not exists public.matching_rule_requests (
  request_id uuid primary key,
  operation text not null check (operation in ('create_version', 'activate_version', 'rollback_version')),
  actor_id uuid references public.users(id) on delete set null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  completed_at timestamptz not null default now()
);

create table if not exists public.matching_candidates (
  version_id uuid not null references public.matching_rule_versions(id) on delete cascade,
  cargo_id uuid not null references public.cargo_listings(id) on delete cascade,
  vessel_avail_id uuid not null references public.vessel_availability(id) on delete cascade,
  score integer not null check (score >= 0),
  score_label text not null check (score_label in ('Strong', 'Good', 'Possible')),
  is_rate_aligned boolean not null,
  dwt_delta integer not null check (dwt_delta >= 0),
  as_of_year integer not null check (as_of_year between 1900 and 3000),
  computed_at timestamptz not null default now(),
  primary key (version_id, cargo_id, vessel_avail_id)
);

create index if not exists matching_candidates_cargo_idx
  on public.matching_candidates(version_id, cargo_id, is_rate_aligned desc, dwt_delta, vessel_avail_id);
create index if not exists matching_candidates_availability_idx
  on public.matching_candidates(version_id, vessel_avail_id, is_rate_aligned desc, dwt_delta, cargo_id);

create table if not exists public.matching_candidate_snapshots (
  version_id uuid primary key references public.matching_rule_versions(id) on delete cascade,
  candidate_count integer not null check (candidate_count >= 0),
  candidate_sha256 text not null check (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  as_of_year integer not null check (as_of_year between 1900 and 3000),
  built_by uuid references public.users(id) on delete set null,
  built_at timestamptz not null default now()
);

alter table public.matching_rule_versions enable row level security;
alter table public.matching_rule_state enable row level security;
alter table public.matching_rule_events enable row level security;
alter table public.matching_rule_requests enable row level security;
alter table public.matching_candidates enable row level security;
alter table public.matching_candidate_snapshots enable row level security;

revoke all on table public.matching_rule_versions from public, anon, authenticated;
revoke all on table public.matching_rule_state from public, anon, authenticated;
revoke all on table public.matching_rule_events from public, anon, authenticated;
revoke all on table public.matching_rule_requests from public, anon, authenticated;
revoke all on table public.matching_candidates from public, anon, authenticated;
revoke all on table public.matching_candidate_snapshots from public, anon, authenticated;
revoke all on table public.matching_rule_versions from service_role;
revoke all on table public.matching_rule_state from service_role;
revoke all on table public.matching_rule_events from service_role;
revoke all on table public.matching_rule_requests from service_role;
revoke all on table public.matching_candidates from service_role;
revoke all on table public.matching_candidate_snapshots from service_role;
grant select on table public.matching_rule_versions to service_role;
grant select on table public.matching_rule_state to service_role;
grant select on table public.matching_rule_events to service_role;
grant select on table public.matching_rule_requests to service_role;
grant select on table public.matching_candidates to service_role;
grant select on table public.matching_candidate_snapshots to service_role;

create or replace function public.fn_matching_validate_params(p_params jsonb)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_score jsonb;
  v_schema numeric;
  v_dwt numeric;
  v_part numeric;
  v_before numeric;
  v_after numeric;
  v_rate numeric;
  v_dwt_tight numeric;
  v_dwt_loose numeric;
  v_zone_load numeric;
  v_zone_disch numeric;
  v_gear numeric;
  v_label text;
  v_dwt_options integer[];
  v_possible_reachable boolean;
  v_good_reachable boolean;
  v_strong_reachable boolean;
begin
  if p_params is null or jsonb_typeof(p_params) <> 'object' then
    raise exception 'MATCHING_INPUT: params must be an object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_params)) <> 8
     or exists (
       select 1 from jsonb_object_keys(p_params) k
       where k not in (
         'schemaVersion', 'dwtTolerancePct', 'partCargoTolerancePct',
         'laycanBeforeDays', 'laycanAfterDays', 'rateAlignmentUsd',
         'minScoreLabel', 'score'
       )
     ) then
    raise exception 'MATCHING_INPUT: params must contain exactly the canonical v1 fields' using errcode = '22023';
  end if;

  if jsonb_typeof(p_params->'schemaVersion') <> 'number'
     or jsonb_typeof(p_params->'dwtTolerancePct') <> 'number'
     or jsonb_typeof(p_params->'partCargoTolerancePct') <> 'number'
     or jsonb_typeof(p_params->'laycanBeforeDays') <> 'number'
     or jsonb_typeof(p_params->'laycanAfterDays') <> 'number'
     or jsonb_typeof(p_params->'rateAlignmentUsd') <> 'number'
     or jsonb_typeof(p_params->'minScoreLabel') <> 'string'
     or jsonb_typeof(p_params->'score') <> 'object' then
    raise exception 'MATCHING_INPUT: canonical v1 field types are invalid' using errcode = '22023';
  end if;

  v_score := p_params->'score';
  if (select count(*) from jsonb_object_keys(v_score)) <> 5
     or exists (
       select 1 from jsonb_object_keys(v_score) k
       where k not in ('dwtTight', 'dwtLoose', 'zoneLoad', 'zoneDisch', 'gear')
     )
     or exists (
       select 1 from jsonb_each(v_score) e where jsonb_typeof(e.value) <> 'number'
     ) then
    raise exception 'MATCHING_INPUT: score must contain exactly the five canonical numeric weights' using errcode = '22023';
  end if;

  v_schema := (p_params->>'schemaVersion')::numeric;
  v_dwt := (p_params->>'dwtTolerancePct')::numeric;
  v_part := (p_params->>'partCargoTolerancePct')::numeric;
  v_before := (p_params->>'laycanBeforeDays')::numeric;
  v_after := (p_params->>'laycanAfterDays')::numeric;
  v_rate := (p_params->>'rateAlignmentUsd')::numeric;
  v_dwt_tight := (v_score->>'dwtTight')::numeric;
  v_dwt_loose := (v_score->>'dwtLoose')::numeric;
  v_zone_load := (v_score->>'zoneLoad')::numeric;
  v_zone_disch := (v_score->>'zoneDisch')::numeric;
  v_gear := (v_score->>'gear')::numeric;
  v_label := p_params->>'minScoreLabel';

  if v_schema <> 1 then
    raise exception 'MATCHING_INPUT: schemaVersion must be 1' using errcode = '22023';
  end if;
  if v_dwt < 0 or v_dwt > 50 or v_part < 0 or v_part > 50
     or v_dwt <> trunc(v_dwt) or v_part <> trunc(v_part)
     or v_part < v_dwt then
    raise exception 'MATCHING_INPUT: DWT tolerances must be whole percentages from 0 to 50, with part cargo not lower than standard' using errcode = '22023';
  end if;
  if v_before < 0 or v_before > 90 or v_after < 0 or v_after > 90
     or v_before <> trunc(v_before) or v_after <> trunc(v_after) then
    raise exception 'MATCHING_INPUT: laycan buffers must be whole days between 0 and 90' using errcode = '22023';
  end if;
  if v_rate < 0 or v_rate > 1000 or v_rate <> round(v_rate, 2) then
    raise exception 'MATCHING_INPUT: rateAlignmentUsd must be between 0 and 1000 with at most two decimal places' using errcode = '22023';
  end if;
  if v_label not in ('Possible', 'Good', 'Strong') then
    raise exception 'MATCHING_INPUT: minScoreLabel is invalid' using errcode = '22023';
  end if;
  if v_dwt_tight <> trunc(v_dwt_tight) or v_dwt_loose <> trunc(v_dwt_loose)
     or v_zone_load <> trunc(v_zone_load) or v_zone_disch <> trunc(v_zone_disch)
     or v_gear <> trunc(v_gear)
     or least(v_dwt_tight, v_dwt_loose, v_zone_load, v_zone_disch, v_gear) < 0
     or greatest(v_dwt_tight, v_dwt_loose, v_zone_load, v_zone_disch, v_gear) > 20 then
    raise exception 'MATCHING_INPUT: score weights must be whole numbers between 0 and 20' using errcode = '22023';
  end if;
  if v_dwt_tight < v_dwt_loose or v_zone_load < v_zone_disch then
    raise exception 'MATCHING_INPUT: tight/load weights cannot be lower than loose/discharge weights' using errcode = '22023';
  end if;
  v_dwt_options := array[v_dwt_tight::integer];
  if v_part > 0 then v_dwt_options := array_append(v_dwt_options, v_dwt_loose::integer); end if;
  if v_part >= 10 then v_dwt_options := array_append(v_dwt_options, 0); end if;
  select
    coalesce(bool_or(x.total < 3), false),
    coalesce(bool_or(x.total >= 3 and x.total < 4), false),
    coalesce(bool_or(x.total >= 4), false)
  into v_possible_reachable, v_good_reachable, v_strong_reachable
  from (
    select d.value + z.value + v_gear::integer as total
    from unnest(v_dwt_options) d(value)
    cross join unnest(array[v_zone_disch::integer, v_zone_load::integer]) z(value)
  ) x;
  if not v_possible_reachable or not v_good_reachable or not v_strong_reachable then
    raise exception 'MATCHING_INPUT: score weights must keep Possible, Good and Strong reachable' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'schemaVersion', 1,
    'dwtTolerancePct', v_dwt::integer,
    'partCargoTolerancePct', v_part::integer,
    'laycanBeforeDays', v_before::integer,
    'laycanAfterDays', v_after::integer,
    'rateAlignmentUsd', round(v_rate, 2),
    'minScoreLabel', v_label,
    'score', jsonb_build_object(
      'dwtTight', v_dwt_tight::integer,
      'dwtLoose', v_dwt_loose::integer,
      'zoneLoad', v_zone_load::integer,
      'zoneDisch', v_zone_disch::integer,
      'gear', v_gear::integer
    )
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'MATCHING_INPUT: canonical v1 numbers are invalid' using errcode = '22023';
end;
$function$;

create or replace function public.fn_matching_canonical_params_text(p_params jsonb)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  p jsonb := public.fn_matching_validate_params(p_params);
begin
  -- Alphabetical object keys, compact separators and normalised finite numeric
  -- values intentionally match the TypeScript canonical JSON implementation.
  return '{'
    || '"dwtTolerancePct":' || trim_scale((p->>'dwtTolerancePct')::numeric)::text || ','
    || '"laycanAfterDays":' || (p->>'laycanAfterDays') || ','
    || '"laycanBeforeDays":' || (p->>'laycanBeforeDays') || ','
    || '"minScoreLabel":' || to_json(p->>'minScoreLabel')::text || ','
    || '"partCargoTolerancePct":' || trim_scale((p->>'partCargoTolerancePct')::numeric)::text || ','
    || '"rateAlignmentUsd":' || trim_scale((p->>'rateAlignmentUsd')::numeric)::text || ','
    || '"schemaVersion":1,'
    || '"score":{'
      || '"dwtLoose":' || (p#>>'{score,dwtLoose}') || ','
      || '"dwtTight":' || (p#>>'{score,dwtTight}') || ','
      || '"gear":' || (p#>>'{score,gear}') || ','
      || '"zoneDisch":' || (p#>>'{score,zoneDisch}') || ','
      || '"zoneLoad":' || (p#>>'{score,zoneLoad}')
    || '}}';
end;
$function$;

create or replace function public.fn_matching_params_sha256(p_params jsonb)
returns text
language sql
immutable
set search_path to ''
as $function$
  select encode(extensions.digest(public.fn_matching_canonical_params_text(p_params), 'sha256'), 'hex');
$function$;

do $canonical_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matching_rule_versions'::regclass
      and conname = 'matching_rule_versions_canonical_ck'
  ) then
    alter table public.matching_rule_versions
      add constraint matching_rule_versions_canonical_ck check (
        params = public.fn_matching_validate_params(params)
        and params_sha256 = public.fn_matching_params_sha256(params)
        and schema_version = (params->>'schemaVersion')::integer
      );
  end if;
end;
$canonical_constraint$;

create or replace function public.fn_matching_assert_super_actor(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if p_actor is null or not exists (
    select 1
    from public.users u
    where u.id = p_actor
      and u.is_active
      and lower(coalesce(u.role, '')) = 'admin'
      and coalesce(u.admin_tier::text, 'super') = 'super'
  ) then
    raise exception 'MATCHING_AUTH: active super-admin actor required' using errcode = '42501';
  end if;
end;
$function$;

-- Fail rather than wait while acquiring the three source locks.  Writers in
-- older code paths may lock the same tables in a different order; NOWAIT makes
-- that condition a retryable publication failure, never a deadlock.
create or replace function public.fn_matching_lock_sources_nowait()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    lock table public.cargo_listings in share mode nowait;
    lock table public.vessel_availability in share mode nowait;
    lock table public.vessels in share mode nowait;
  exception
    when lock_not_available then
      raise exception 'MATCHING_BUSY: matching sources are being updated; retry publication'
        using errcode = '55P03';
  end;
end;
$function$;

create or replace function public.fn_matching_source_sha256(p_as_of_year integer)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_digest text;
begin
  if p_as_of_year is null or p_as_of_year not between 1900 and 3000 then
    raise exception 'MATCHING_INPUT: as-of year must be between 1900 and 3000'
      using errcode = '22023';
  end if;
  with source_rows as (
    select 'Y|' || p_as_of_year::text as material
    union all
    select 'C|' || cl.id::text || '|' || jsonb_build_object(
      'status', cl.status::text, 'reviewStatus', cl.review_status::text,
      'cargoType', cl.cargo_type::text, 'qtyMinMt', cl.qty_min_mt,
      'qtyMaxMt', cl.qty_max_mt, 'loadZone', cl.load_zone::text,
      'dischZone', cl.disch_zone::text, 'laycanFrom', cl.laycan_from,
      'isSpot', cl.is_spot, 'requiresGeared', cl.requires_geared,
      'isGrainCargo', cl.is_grain_cargo, 'isDgCargo', cl.is_dg_cargo,
      'maxVesselAgeYr', cl.max_vessel_age_yr, 'maxDraftM', cl.max_draft_m,
      'maxLoaM', cl.max_loa_m, 'freightIdeaUsdMt', cl.freight_idea_usd_mt
    )::text as material
    from public.cargo_listings cl
    union all
    select 'A|' || va.id::text || '|' || jsonb_build_object(
      'vesselId', va.vessel_id, 'openZone', va.open_zone::text,
      'openDate', va.open_date, 'acceptsPartCargo', va.accepts_part_cargo,
      'status', va.status::text, 'reviewStatus', va.review_status::text,
      'freightIdeaUsdMt', va.freight_idea_usd_mt
    )::text
    from public.vessel_availability va
    union all
    select 'V|' || v.id::text || '|' || jsonb_build_object(
      'vesselType', v.vessel_type::text, 'dwtGrain', v.dwt_grain,
      'buildYear', v.build_year, 'isGeared', v.is_geared,
      'grainCertified', v.grain_certified, 'dgCertified', v.dg_certified,
      'maxDraftM', v.max_draft_m, 'maxLoaM', v.max_loa_m,
      'isSanctioned', v.is_sanctioned
    )::text
    from public.vessels v
  )
  select encode(
    extensions.digest(coalesce(string_agg(material, E'\n' order by material), ''), 'sha256'),
    'hex'
  ) into v_digest
  from source_rows;
  return v_digest;
end;
$function$;

create or replace function public.fn_matching_validate_as_of_year(p_as_of_year integer)
returns integer
language plpgsql
immutable
set search_path to ''
as $function$
begin
  if p_as_of_year is null or p_as_of_year not between 1900 and 3000 then
    raise exception 'MATCHING_INPUT: as-of year must be between 1900 and 3000'
      using errcode = '22023';
  end if;
  return p_as_of_year;
end;
$function$;

create or replace function public.fn_matching_evaluate(
  p_params jsonb,
  p_as_of_year integer,
  p_cargo_id uuid default null,
  p_availability_id uuid default null
)
returns table (
  cargo_id uuid,
  vessel_avail_id uuid,
  score integer,
  score_label text,
  is_rate_aligned boolean,
  dwt_delta integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  with p as materialized (
    select public.fn_matching_validate_params(p_params) as v,
           public.fn_matching_validate_as_of_year(p_as_of_year) as as_of_year
  ), scored as (
    select
      cl.id as cargo_id,
      va.id as vessel_avail_id,
      (
        case
          when cl.qty_max_mt::numeric / nullif(v.dwt_grain, 0)::numeric
                 between 0.9 and 1.0
            then (p.v#>>'{score,dwtTight}')::integer
          when cl.qty_max_mt::numeric / nullif(v.dwt_grain, 0)::numeric
                 between 0.8 and 1.1
            then (p.v#>>'{score,dwtLoose}')::integer
          else 0
        end
        + case
            when va.open_zone::text = cl.load_zone::text then (p.v#>>'{score,zoneLoad}')::integer
            when va.open_zone::text = cl.disch_zone::text then (p.v#>>'{score,zoneDisch}')::integer
            else 0
          end
        + case
            when cl.requires_geared is not true or coalesce(v.is_geared, false)
              then (p.v#>>'{score,gear}')::integer
            else 0
          end
      )::integer as score,
      coalesce(
        cl.freight_idea_usd_mt is not null
        and va.freight_idea_usd_mt is not null
        and abs(cl.freight_idea_usd_mt - va.freight_idea_usd_mt)
              <= (p.v->>'rateAlignmentUsd')::numeric,
        false
      ) as is_rate_aligned,
      abs(v.dwt_grain - cl.qty_max_mt)::integer as dwt_delta,
      p.v as params
    from public.cargo_listings cl
    join public.vessel_availability va
      on va.open_zone is not null
     and (va.open_zone::text = cl.load_zone::text or va.open_zone::text = cl.disch_zone::text)
    join public.vessels v on v.id = va.vessel_id
    cross join p
    where (p_cargo_id is null or cl.id = p_cargo_id)
      and (p_availability_id is null or va.id = p_availability_id)
      and cl.review_status::text = 'APPROVED'
      and cl.status::text in ('IN', 'PARTIAL')
      and va.status::text = 'OPEN'
      and va.review_status::text = 'APPROVED'
      and not v.is_sanctioned
      and v.dwt_grain is not null
      and case
        when coalesce(va.accepts_part_cargo, false) then
          v.dwt_grain >= cl.qty_min_mt
          and v.dwt_grain::numeric <= cl.qty_max_mt::numeric * (1 + (p.v->>'partCargoTolerancePct')::numeric / 100)
          and v.dwt_grain::numeric >= cl.qty_max_mt::numeric * (1 - (p.v->>'partCargoTolerancePct')::numeric / 100)
        else
          v.dwt_grain >= cl.qty_min_mt
          and v.dwt_grain::numeric <= cl.qty_max_mt::numeric * (1 + (p.v->>'dwtTolerancePct')::numeric / 100)
          and v.dwt_grain::numeric >= cl.qty_max_mt::numeric * (1 - (p.v->>'dwtTolerancePct')::numeric / 100)
      end
      and (cl.cargo_type::text = 'Break Bulk' or v.vessel_type::text in ('Bulk Carrier', 'General Cargo'))
      and (
        cl.is_spot
        or (
          va.open_date is not null and cl.laycan_from is not null
          and va.open_date between
            (cl.laycan_from - ((p.v->>'laycanBeforeDays')::integer * interval '1 day'))::date
            and
            (cl.laycan_from + ((p.v->>'laycanAfterDays')::integer * interval '1 day'))::date
        )
      )
      and (cl.requires_geared is null or not cl.requires_geared or v.is_geared)
      and (not cl.is_grain_cargo or coalesce(v.grain_certified, false))
      and (not cl.is_dg_cargo or coalesce(v.dg_certified, false))
      and (
        cl.max_vessel_age_yr is null or v.build_year is null
        or p.as_of_year - v.build_year::integer <= cl.max_vessel_age_yr
      )
      and (cl.max_draft_m is null or v.max_draft_m is null or v.max_draft_m <= cl.max_draft_m)
      and (cl.max_loa_m is null or v.max_loa_m is null or v.max_loa_m <= cl.max_loa_m)
  ), labelled as (
    select
      s.*,
      case when s.score >= 4 then 'Strong' when s.score >= 3 then 'Good' else 'Possible' end as label
    from scored s
  )
  select
    l.cargo_id, l.vessel_avail_id, l.score, l.label,
    l.is_rate_aligned, l.dwt_delta
  from labelled l
  where case l.params->>'minScoreLabel'
    when 'Strong' then l.score >= 4
    when 'Good' then l.score >= 3
    else true
  end;
$function$;

create or replace function public.fn_matching_candidate_digest(p_version_id uuid)
returns table(candidate_count integer, candidate_sha256 text)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    count(*)::integer,
    encode(extensions.digest(coalesce(string_agg(
      c.cargo_id::text || '|' || c.vessel_avail_id::text || '|' || c.score::text || '|'
      || c.score_label || '|' || c.is_rate_aligned::text || '|' || c.dwt_delta::text || '|'
      || c.as_of_year::text,
      E'\n' order by c.cargo_id, c.vessel_avail_id
    ), ''), 'sha256'), 'hex')
  from public.matching_candidates c
  where c.version_id = p_version_id;
$function$;

-- Bootstrap the current production literals exactly once.  Empty databases
-- may legitimately bootstrap with zero candidates; later admin activations
-- fail closed when a proposed result set is empty.
do $bootstrap$
declare
  v_params jsonb := jsonb_build_object(
    'schemaVersion', 1,
    'dwtTolerancePct', 10,
    'partCargoTolerancePct', 20,
    'laycanBeforeDays', 21,
    'laycanAfterDays', 14,
    'rateAlignmentUsd', 5,
    'minScoreLabel', 'Possible',
    'score', jsonb_build_object('dwtTight', 2, 'dwtLoose', 1, 'zoneLoad', 2, 'zoneDisch', 1, 'gear', 1)
  );
  v_version uuid;
  v_count integer;
  v_digest text;
  v_source_digest text;
  v_as_of_year integer := extract(year from (current_timestamp at time zone 'UTC'))::integer;
begin
  if not exists (select 1 from public.matching_rule_state where singleton) then
    perform public.fn_matching_lock_sources_nowait();
    v_source_digest := public.fn_matching_source_sha256(v_as_of_year);
    v_params := public.fn_matching_validate_params(v_params);
    insert into public.matching_rule_versions(
      schema_version, evaluator_version, params, params_sha256, note
    ) values (
      1, 'matching-v1', v_params, public.fn_matching_params_sha256(v_params),
      'Bootstrap from deployed matcher literals'
    ) returning id into v_version;

    insert into public.matching_candidates(
      version_id, cargo_id, vessel_avail_id, score, score_label,
      is_rate_aligned, dwt_delta, as_of_year
    )
    select v_version, e.cargo_id, e.vessel_avail_id, e.score, e.score_label,
           e.is_rate_aligned, e.dwt_delta, v_as_of_year
    from public.fn_matching_evaluate(v_params, v_as_of_year, null, null) e;

    select d.candidate_count, d.candidate_sha256
      into v_count, v_digest
    from public.fn_matching_candidate_digest(v_version) d;

    insert into public.matching_candidate_snapshots(
      version_id, candidate_count, candidate_sha256, source_sha256, as_of_year
    ) values (v_version, v_count, v_digest, v_source_digest, v_as_of_year);

    insert into public.matching_rule_state(singleton, active_version_id, cache_as_of_year)
    values (true, v_version, v_as_of_year);

    insert into public.matching_rule_events(
      event_type, version_id, params_sha256, candidate_count,
      candidate_sha256, source_sha256, evaluation_as_of_year, detail
    ) values (
      'version_activated', v_version, public.fn_matching_params_sha256(v_params),
      v_count, v_digest, v_source_digest, v_as_of_year,
      jsonb_build_object(
        'bootstrap', true, 'evaluatorVersion', 'matching-v1', 'asOfYear', v_as_of_year
      )
    );
  end if;
end;
$bootstrap$;

do $assert_deployed_equivalence$
declare
  v_legacy_count integer;
  v_governed_count integer;
begin
  if to_regclass('pg_temp.matching_deployed_default') is not null then
    select count(*) into v_legacy_count from matching_deployed_default;
    select count(*) into v_governed_count
    from public.matching_candidates c
    join public.matching_rule_state s
      on s.singleton and s.active_version_id = c.version_id;

    if v_legacy_count <> v_governed_count or exists (
      select 1
      from matching_deployed_default d
      full join (
        select c.cargo_id, c.vessel_avail_id, c.score, c.score_label,
               c.is_rate_aligned, c.dwt_delta
        from public.matching_candidates c
        join public.matching_rule_state s
          on s.singleton and s.active_version_id = c.version_id
      ) g using (cargo_id, vessel_avail_id)
      where d.cargo_id is null or g.cargo_id is null
         or d.score is distinct from g.score
         or d.score_label is distinct from g.score_label
         or d.is_rate_aligned is distinct from g.is_rate_aligned
         or d.dwt_delta is distinct from g.dwt_delta
    ) then
      raise exception 'MATCHING_EQUIVALENCE: governed defaults differ from deployed matcher (% legacy, % governed)',
        v_legacy_count, v_governed_count using errcode = '55000';
    end if;
  end if;
end;
$assert_deployed_equivalence$;

-- The compatibility cache is a governed projection: partial or unversioned
-- rows are structurally impossible, including for service-role callers.
alter table public.matches add column if not exists matching_rule_version_id uuid;
alter table public.matches add column if not exists match_score integer;
alter table public.matches add column if not exists is_rate_aligned boolean;
alter table public.matches add column if not exists dwt_delta integer;
alter table public.matches add column if not exists matching_as_of_year integer;

do $matches_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_matching_rule_version_id_fkey'
  ) then
    alter table public.matches
      add constraint matches_matching_rule_version_id_fkey
      foreign key (matching_rule_version_id) references public.matching_rule_versions(id);
  end if;
end;
$matches_fk$;

delete from public.matches where true;
insert into public.matches(
  cargo_id, vessel_avail_id, score_label, computed_at,
  matching_rule_version_id, match_score, is_rate_aligned, dwt_delta, matching_as_of_year
)
select c.cargo_id, c.vessel_avail_id, c.score_label, c.computed_at,
       c.version_id, c.score, c.is_rate_aligned, c.dwt_delta, c.as_of_year
from public.matching_candidates c
join public.matching_rule_state s on s.active_version_id = c.version_id and s.singleton;

alter table public.matches alter column matching_rule_version_id set not null;
alter table public.matches alter column match_score set not null;
alter table public.matches alter column is_rate_aligned set not null;
alter table public.matches alter column dwt_delta set not null;
alter table public.matches alter column matching_as_of_year set not null;

do $matches_governance_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_governed_values_ck'
  ) then
    alter table public.matches add constraint matches_governed_values_ck check (
      match_score >= 0
      and dwt_delta >= 0
      and matching_as_of_year between 1900 and 3000
      and score_label in ('Strong', 'Good', 'Possible')
      and score_label = case
        when match_score >= 4 then 'Strong'
        when match_score >= 3 then 'Good'
        else 'Possible'
      end
    );
  end if;
end;
$matches_governance_constraints$;

revoke all on table public.matches from public, anon, authenticated, service_role;
grant select on table public.matches to service_role;

create or replace function public.fn_matching_write_settings_mirror(p_params jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform set_config('asb.matching_mirror_write', 'on', true);
  insert into public.app_settings(key, value, updated_at)
  values ('matching_rules', p_params, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;
  perform set_config('asb.matching_mirror_write', 'off', true);
exception
  when others then
    perform set_config('asb.matching_mirror_write', 'off', true);
    raise;
end;
$function$;

revoke all on function public.fn_matching_write_settings_mirror(jsonb)
  from public, anon, authenticated, service_role;

do $mirror_seed$
declare
  v_params jsonb;
begin
  select v.params into v_params
  from public.matching_rule_state s
  join public.matching_rule_versions v on v.id = s.active_version_id
  where s.singleton;
  perform public.fn_matching_write_settings_mirror(v_params);
end;
$mirror_seed$;

create or replace function public.fn_matching_guard_settings_mirror()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_touches_mirror boolean := case tg_op
    when 'INSERT' then new.key = 'matching_rules'
    when 'DELETE' then old.key = 'matching_rules'
    else old.key = 'matching_rules' or new.key = 'matching_rules'
  end;
  v_writer_owner name;
begin
  select pg_get_userbyid(p.proowner)::name into v_writer_owner
  from pg_proc p
  where p.oid = 'public.fn_matching_write_settings_mirror(jsonb)'::regprocedure;
  if v_touches_mirror
     and (
       coalesce(current_setting('asb.matching_mirror_write', true), '') <> 'on'
       or current_user <> v_writer_owner
     ) then
    raise exception 'MATCHING_MIRROR: matching_rules is generated from the active rule version'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_matching_settings_mirror_guard on public.app_settings;
create trigger trg_matching_settings_mirror_guard
before insert or update or delete on public.app_settings
for each row execute function public.fn_matching_guard_settings_mirror();

create or replace function public.fn_matching_immutable_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_rebuilder_owner name;
begin
  if tg_table_name = 'matching_candidate_snapshots' then
    select pg_get_userbyid(p.proowner)::name into v_rebuilder_owner
    from pg_proc p
    where p.oid = to_regprocedure('public.fn_matching_replace_candidate_snapshot(uuid,integer,text,text,integer,uuid)');
    if coalesce(current_setting('asb.matching_snapshot_rebuild', true), '') = 'on'
       and current_user = v_rebuilder_owner then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'MATCHING_IMMUTABLE: governed history cannot be deleted' using errcode = '55000';
  end if;
  -- Permit only FK-driven actor tombstoning.  Every governed value remains.
  if (to_jsonb(new) - array['created_by', 'actor_id', 'built_by'])
       = (to_jsonb(old) - array['created_by', 'actor_id', 'built_by'])
     and (
       (to_jsonb(old)->>'created_by' is not null and to_jsonb(new)->>'created_by' is null)
       or (to_jsonb(old)->>'actor_id' is not null and to_jsonb(new)->>'actor_id' is null)
       or (to_jsonb(old)->>'built_by' is not null and to_jsonb(new)->>'built_by' is null)
     ) then
    return new;
  end if;
  raise exception 'MATCHING_IMMUTABLE: governed history cannot be edited' using errcode = '55000';
end;
$function$;

drop trigger if exists trg_matching_versions_immutable on public.matching_rule_versions;
create trigger trg_matching_versions_immutable
before update or delete on public.matching_rule_versions
for each row execute function public.fn_matching_immutable_guard();

drop trigger if exists trg_matching_events_immutable on public.matching_rule_events;
create trigger trg_matching_events_immutable
before update or delete on public.matching_rule_events
for each row execute function public.fn_matching_immutable_guard();

drop trigger if exists trg_matching_requests_immutable on public.matching_rule_requests;
create trigger trg_matching_requests_immutable
before update or delete on public.matching_rule_requests
for each row execute function public.fn_matching_immutable_guard();

drop trigger if exists trg_matching_snapshots_immutable on public.matching_candidate_snapshots;
create trigger trg_matching_snapshots_immutable
before update or delete on public.matching_candidate_snapshots
for each row execute function public.fn_matching_immutable_guard();

-- A version that becomes the rollback target already has an activation-time
-- snapshot. Rollback must rebuild it from today's locked source universe, not
-- reuse stale candidate rows. Only this non-executable definer helper may
-- replace that snapshot; the append-only event preserves both build records.
create or replace function public.fn_matching_replace_candidate_snapshot(
  p_version_id uuid,
  p_candidate_count integer,
  p_candidate_sha256 text,
  p_source_sha256 text,
  p_as_of_year integer,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform set_config('asb.matching_snapshot_rebuild', 'on', true);
  insert into public.matching_candidate_snapshots(
    version_id, candidate_count, candidate_sha256, source_sha256,
    as_of_year, built_by, built_at
  ) values (
    p_version_id, p_candidate_count, p_candidate_sha256, p_source_sha256,
    p_as_of_year, p_actor, now()
  )
  on conflict (version_id) do update
    set candidate_count = excluded.candidate_count,
        candidate_sha256 = excluded.candidate_sha256,
        source_sha256 = excluded.source_sha256,
        as_of_year = excluded.as_of_year,
        built_by = excluded.built_by,
        built_at = excluded.built_at;
  perform set_config('asb.matching_snapshot_rebuild', 'off', true);
exception
  when others then
    perform set_config('asb.matching_snapshot_rebuild', 'off', true);
    raise;
end;
$function$;

revoke all on function public.fn_matching_replace_candidate_snapshot(
  uuid, integer, text, text, integer, uuid
) from public, anon, authenticated, service_role;

create or replace function public.fn_matching_params()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select v.params
  from public.matching_rule_state s
  join public.matching_rule_versions v on v.id = s.active_version_id
  where s.singleton;
$function$;

-- Member-safe read model for clients that must evaluate the same temporal
-- context as the authoritative cache.  The flat params document remains the
-- only rule schema; this envelope adds version/hash/year evidence without
-- exposing candidate rows or raw listing identifiers.
create or replace function public.get_matching_rules_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_result jsonb;
begin
  v_actor := public.fn_app_user_id();
  if v_actor is null or not exists (
    select 1 from public.users u where u.id = v_actor and u.is_active
  ) then
    raise exception 'MATCHING_AUTH: active authenticated application user required'
      using errcode = '42501';
  end if;
  select jsonb_build_object(
    'schemaVersion', v.schema_version,
    'params', v.params,
    'asOfYear', s.cache_as_of_year,
    'activeVersionId', s.active_version_id,
    'paramsSha256', v.params_sha256
  ) into v_result
  from public.matching_rule_state s
  join public.matching_rule_versions v on v.id = s.active_version_id
  where s.singleton;
  return v_result;
end;
$function$;

create or replace function public.admin_matching_rules_dashboard(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  perform public.fn_matching_assert_super_actor(p_actor);
  select jsonb_build_object(
    'state', jsonb_build_object(
      'activeVersionId', s.active_version_id,
      'previousVersionId', s.previous_version_id,
      'activationSequence', s.activation_sequence,
      'activatedBy', s.activated_by,
      'activatedAt', s.activated_at,
      'asOfYear', s.cache_as_of_year
    ),
    'activeVersion', (
      select jsonb_build_object(
        'id', v.id, 'versionNo', v.version_no, 'schemaVersion', v.schema_version,
        'evaluatorVersion', v.evaluator_version, 'params', v.params,
        'paramsSha256', v.params_sha256, 'note', v.note,
        'createdBy', v.created_by, 'createdAt', v.created_at
      )
      from public.matching_rule_versions v where v.id = s.active_version_id
    ),
    'previousVersion', (
      select jsonb_build_object(
        'id', v.id, 'versionNo', v.version_no, 'schemaVersion', v.schema_version,
        'evaluatorVersion', v.evaluator_version, 'params', v.params,
        'paramsSha256', v.params_sha256, 'note', v.note,
        'createdBy', v.created_by, 'createdAt', v.created_at
      )
      from public.matching_rule_versions v where v.id = s.previous_version_id
    ),
    'versionHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'versionNo', h.version_no, 'schemaVersion', h.schema_version,
        'evaluatorVersion', h.evaluator_version, 'params', h.params,
        'paramsSha256', h.params_sha256, 'note', h.note,
        'createdBy', h.created_by, 'createdAt', h.created_at
      ) order by h.version_no desc)
      from (
        select * from public.matching_rule_versions order by version_no desc limit 100
      ) h
    ), '[]'::jsonb),
    'recentEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'eventType', e.event_type, 'versionId', e.version_id,
        'priorVersionId', e.prior_version_id, 'requestId', e.request_id,
        'actorId', e.actor_id, 'paramsSha256', e.params_sha256,
        'candidateCount', e.candidate_count, 'candidateSha256', e.candidate_sha256,
        'sourceSha256', e.source_sha256, 'asOfYear', e.evaluation_as_of_year,
        'detail', e.detail, 'occurredAt', e.occurred_at
      ) order by e.id desc)
      from (
        select * from public.matching_rule_events order by id desc limit 100
      ) e
    ), '[]'::jsonb)
  ) into v_result
  from public.matching_rule_state s
  where s.singleton;
  if v_result is null then
    raise exception 'MATCHING_STATE: active rule state is missing' using errcode = '55000';
  end if;
  return v_result;
end;
$function$;

create or replace function public.admin_matching_preview(p_actor uuid, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_params jsonb;
  v_as_of_year integer := extract(year from (current_timestamp at time zone 'UTC'))::integer;
  v_result jsonb;
begin
  perform public.fn_matching_assert_super_actor(p_actor);
  v_params := public.fn_matching_validate_params(p_params);
  with active as materialized (
    select s.active_version_id, v.params
    from public.matching_rule_state s
    join public.matching_rule_versions v on v.id = s.active_version_id
    where s.singleton
  ), current_candidates as materialized (
    select e.cargo_id, e.vessel_avail_id
    from active a
    cross join lateral public.fn_matching_evaluate(a.params, v_as_of_year, null, null) e
  ), proposed_candidates as materialized (
    select e.cargo_id, e.vessel_avail_id
    from public.fn_matching_evaluate(v_params, v_as_of_year, null, null) e
  )
  select jsonb_build_object(
    'activeVersionId', a.active_version_id,
    'asOfYear', v_as_of_year,
    'activeParamsSha256', public.fn_matching_params_sha256(a.params),
    'proposedParams', v_params,
    'proposedParamsSha256', public.fn_matching_params_sha256(v_params),
    'currentCandidateCount', (select count(*) from current_candidates),
    'proposedCandidateCount', (select count(*) from proposed_candidates),
    'addedCount', (select count(*) from (
      select * from proposed_candidates except select * from current_candidates
    ) added),
    'removedCount', (select count(*) from (
      select * from current_candidates except select * from proposed_candidates
    ) removed)
  ) into v_result
  from active a;
  if v_result is null then
    raise exception 'MATCHING_STATE: active rule state is missing' using errcode = '55000';
  end if;
  return v_result;
end;
$function$;

create or replace function public.fn_refresh_matches_for_cargo(p_cargo_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version uuid;
  v_params jsonb;
  v_as_of_year integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('matching-cache-write', 0));
  select s.active_version_id, v.params, s.cache_as_of_year
    into v_version, v_params, v_as_of_year
  from public.matching_rule_state s
  join public.matching_rule_versions v on v.id = s.active_version_id
  where s.singleton;

  delete from public.matching_candidates
  where version_id = v_version and cargo_id = p_cargo_id;
  insert into public.matching_candidates(
    version_id, cargo_id, vessel_avail_id, score, score_label, is_rate_aligned, dwt_delta, as_of_year
  )
  select v_version, e.cargo_id, e.vessel_avail_id, e.score, e.score_label,
         e.is_rate_aligned, e.dwt_delta, v_as_of_year
  from public.fn_matching_evaluate(v_params, v_as_of_year, p_cargo_id, null) e;

  delete from public.matches where cargo_id = p_cargo_id;
  insert into public.matches(
    cargo_id, vessel_avail_id, score_label, computed_at,
    matching_rule_version_id, match_score, is_rate_aligned, dwt_delta, matching_as_of_year
  )
  select c.cargo_id, c.vessel_avail_id, c.score_label, c.computed_at,
         c.version_id, c.score, c.is_rate_aligned, c.dwt_delta, c.as_of_year
  from public.matching_candidates c
  where c.version_id = v_version and c.cargo_id = p_cargo_id;
end;
$function$;

create or replace function public.fn_refresh_matches_for_availability(p_availability_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version uuid;
  v_params jsonb;
  v_as_of_year integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('matching-cache-write', 0));
  select s.active_version_id, v.params, s.cache_as_of_year
    into v_version, v_params, v_as_of_year
  from public.matching_rule_state s
  join public.matching_rule_versions v on v.id = s.active_version_id
  where s.singleton;

  delete from public.matching_candidates
  where version_id = v_version and vessel_avail_id = p_availability_id;
  insert into public.matching_candidates(
    version_id, cargo_id, vessel_avail_id, score, score_label, is_rate_aligned, dwt_delta, as_of_year
  )
  select v_version, e.cargo_id, e.vessel_avail_id, e.score, e.score_label,
         e.is_rate_aligned, e.dwt_delta, v_as_of_year
  from public.fn_matching_evaluate(v_params, v_as_of_year, null, p_availability_id) e;

  delete from public.matches where vessel_avail_id = p_availability_id;
  insert into public.matches(
    cargo_id, vessel_avail_id, score_label, computed_at,
    matching_rule_version_id, match_score, is_rate_aligned, dwt_delta, matching_as_of_year
  )
  select c.cargo_id, c.vessel_avail_id, c.score_label, c.computed_at,
         c.version_id, c.score, c.is_rate_aligned, c.dwt_delta, c.as_of_year
  from public.matching_candidates c
  where c.version_id = v_version and c.vessel_avail_id = p_availability_id;
end;
$function$;

create or replace function public.fn_refresh_matches()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version uuid;
  v_params jsonb;
  v_count integer;
  v_as_of_year integer;
begin
  select s.active_version_id, v.params, s.cache_as_of_year
    into v_version, v_params, v_as_of_year
  from public.matching_rule_state s
  join public.matching_rule_versions v on v.id = s.active_version_id
  where s.singleton for update of s;

  perform public.fn_matching_lock_sources_nowait();
  perform pg_advisory_xact_lock(hashtextextended('matching-cache-write', 0));

  delete from public.matching_candidates where version_id = v_version;
  insert into public.matching_candidates(
    version_id, cargo_id, vessel_avail_id, score, score_label, is_rate_aligned, dwt_delta, as_of_year
  )
  select v_version, e.cargo_id, e.vessel_avail_id, e.score, e.score_label,
         e.is_rate_aligned, e.dwt_delta, v_as_of_year
  from public.fn_matching_evaluate(v_params, v_as_of_year, null, null) e;
  get diagnostics v_count = row_count;

  delete from public.matches where true;
  insert into public.matches(
    cargo_id, vessel_avail_id, score_label, computed_at,
    matching_rule_version_id, match_score, is_rate_aligned, dwt_delta, matching_as_of_year
  )
  select c.cargo_id, c.vessel_avail_id, c.score_label, c.computed_at,
         c.version_id, c.score, c.is_rate_aligned, c.dwt_delta, c.as_of_year
  from public.matching_candidates c where c.version_id = v_version;
  return v_count;
end;
$function$;

create or replace function public.trg_refresh_matches_cargo()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.matches where cargo_id = old.id;
    return old;
  end if;
  perform public.fn_refresh_matches_for_cargo(new.id);
  return new;
end;
$function$;

create or replace function public.trg_refresh_matches_availability()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.matches where vessel_avail_id = old.id;
    return old;
  end if;
  perform public.fn_refresh_matches_for_availability(new.id);
  return new;
end;
$function$;

create or replace function public.trg_refresh_matches_vessel()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
begin
  for r in select id from public.vessel_availability where vessel_id = new.id loop
    perform public.fn_refresh_matches_for_availability(r.id);
  end loop;
  return new;
end;
$function$;

create or replace view public.v_eligible_matches as
select c.cargo_id, c.vessel_avail_id, c.score_label
from public.matching_candidates c
join public.matching_rule_state s on s.singleton and s.active_version_id = c.version_id;

revoke all on table public.v_eligible_matches from public, anon, authenticated;
grant select on table public.v_eligible_matches to service_role;

create or replace function public.get_matches_for_cargo(p_cargo_id uuid)
returns table (
  availability_id uuid, vessel_ref text, vessel_id uuid, vessel_name text,
  vessel_type text, dwt_grain integer, build_year smallint, flag text,
  scope text, risk_level text, is_geared boolean, grain_certified boolean,
  dg_certified boolean, open_port_name text, open_zone text, open_date date,
  open_date_range_days smallint, accepts_part_cargo boolean,
  freight_idea_usd_mt numeric, is_rate_aligned boolean, dwt_delta integer
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.cargo_listings where id = p_cargo_id) then
    raise exception 'Cargo listing not found: %', p_cargo_id;
  end if;
  return query
  select
    va.id, v.imo_number, v.id, v.vessel_name, v.vessel_type::text,
    v.dwt_grain, v.build_year, v.flag, v.scope::text, v.risk_level::text,
    v.is_geared, v.grain_certified, v.dg_certified, va.open_port_name,
    va.open_zone::text, va.open_date, va.open_date_range_days,
    va.accepts_part_cargo, va.freight_idea_usd_mt,
    c.is_rate_aligned, c.dwt_delta
  from public.matching_candidates c
  join public.matching_rule_state s on s.singleton and s.active_version_id = c.version_id
  join public.vessel_availability va on va.id = c.vessel_avail_id
  join public.vessels v on v.id = va.vessel_id
  where c.cargo_id = p_cargo_id
  order by c.is_rate_aligned desc, c.dwt_delta, c.vessel_avail_id;
end;
$function$;

create or replace function public.get_matches_for_availability(p_availability_id uuid)
returns table (
  cargo_id uuid, ref text, commodity_name text, cargo_type text,
  qty_min_mt integer, qty_max_mt integer, load_port_name text, load_zone text,
  disch_port_name text, disch_zone text, laycan_from date, laycan_to date,
  is_spot boolean, is_grain_cargo boolean, is_dg_cargo boolean,
  load_terms text, freight_idea_usd_mt numeric, requires_geared boolean,
  max_vessel_age_yr smallint, max_draft_m numeric, max_loa_m numeric,
  is_rate_aligned boolean, dwt_delta integer
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.vessel_availability where id = p_availability_id) then
    raise exception 'Availability record not found: %', p_availability_id;
  end if;
  return query
  select
    cl.id, cl.ref, cl.commodity_name, cl.cargo_type::text,
    cl.qty_min_mt, cl.qty_max_mt, cl.load_port_name, cl.load_zone::text,
    cl.disch_port_name, cl.disch_zone::text, cl.laycan_from, cl.laycan_to,
    cl.is_spot, cl.is_grain_cargo, cl.is_dg_cargo, cl.load_terms::text,
    cl.freight_idea_usd_mt, cl.requires_geared, cl.max_vessel_age_yr,
    cl.max_draft_m, cl.max_loa_m, c.is_rate_aligned, c.dwt_delta
  from public.matching_candidates c
  join public.matching_rule_state s on s.singleton and s.active_version_id = c.version_id
  join public.cargo_listings cl on cl.id = c.cargo_id
  where c.vessel_avail_id = p_availability_id
  order by c.is_rate_aligned desc, c.dwt_delta, c.vessel_avail_id, c.cargo_id;
end;
$function$;

create or replace function public.matching_create_rule_version(
  p_actor uuid,
  p_request_id uuid,
  p_params jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_params jsonb;
  v_request_hash text;
  v_existing public.matching_rule_requests%rowtype;
  v_version public.matching_rule_versions%rowtype;
  v_result jsonb;
begin
  perform public.fn_matching_assert_super_actor(p_actor);
  if p_request_id is null then
    raise exception 'MATCHING_INPUT: request id is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('matching-request:' || p_request_id::text, 0));
  v_params := public.fn_matching_validate_params(p_params);
  v_request_hash := encode(extensions.digest(
    'create_version|' || public.fn_matching_canonical_params_text(v_params) || '|'
      || coalesce(nullif(trim(p_note), ''), ''), 'sha256'), 'hex');

  select * into v_existing from public.matching_rule_requests where request_id = p_request_id;
  if found then
    if v_existing.operation <> 'create_version'
       or v_existing.actor_id is distinct from p_actor
       or v_existing.request_sha256 <> v_request_hash then
      raise exception 'MATCHING_IDEMPOTENCY: request id was used with different input' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  insert into public.matching_rule_versions(
    schema_version, evaluator_version, params, params_sha256, note, created_by
  ) values (
    1, 'matching-v1', v_params, public.fn_matching_params_sha256(v_params),
    nullif(trim(p_note), ''), p_actor
  ) returning * into v_version;

  v_result := jsonb_build_object(
    'requestId', p_request_id, 'versionId', v_version.id,
    'versionNo', v_version.version_no, 'schemaVersion', v_version.schema_version,
    'evaluatorVersion', v_version.evaluator_version,
    'paramsSha256', v_version.params_sha256
  );
  insert into public.matching_rule_requests(request_id, operation, actor_id, request_sha256, result)
  values (p_request_id, 'create_version', p_actor, v_request_hash, v_result);
  insert into public.matching_rule_events(
    event_type, version_id, request_id, actor_id, params_sha256, detail
  ) values (
    'version_created', v_version.id, p_request_id, p_actor, v_version.params_sha256,
    jsonb_build_object('versionNo', v_version.version_no, 'note', v_version.note)
  );
  return v_result;
end;
$function$;

create or replace function public.matching_activate_rule_version(
  p_actor uuid,
  p_request_id uuid,
  p_version_id uuid,
  p_expected_active_version_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request_hash text;
  v_existing public.matching_rule_requests%rowtype;
  v_target public.matching_rule_versions%rowtype;
  v_current public.matching_rule_versions%rowtype;
  v_state public.matching_rule_state%rowtype;
  v_expected_count integer;
  v_expected_digest text;
  v_actual_count integer;
  v_actual_digest text;
  v_source_digest text;
  v_as_of_year integer;
  v_result jsonb;
begin
  perform public.fn_matching_assert_super_actor(p_actor);
  if p_request_id is null or p_version_id is null then
    raise exception 'MATCHING_INPUT: request id and version id are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('matching-request:' || p_request_id::text, 0));
  v_request_hash := encode(extensions.digest(
    'activate_version|' || p_version_id::text || '|'
      || coalesce(p_expected_active_version_id::text, 'null') || '|'
      || coalesce(p_confirmation, 'null'), 'sha256'), 'hex');

  select * into v_existing from public.matching_rule_requests where request_id = p_request_id;
  if found then
    if v_existing.operation <> 'activate_version'
       or v_existing.actor_id is distinct from p_actor
       or v_existing.request_sha256 <> v_request_hash then
      raise exception 'MATCHING_IDEMPOTENCY: request id was used with different input' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  select * into v_state from public.matching_rule_state where singleton for update;
  if not found then
    raise exception 'MATCHING_STATE: active rule state is missing' using errcode = '55000';
  end if;
  if v_state.active_version_id is distinct from p_expected_active_version_id then
    raise exception 'MATCHING_CAS: active version changed; reload before activation' using errcode = '40001';
  end if;
  select * into v_target from public.matching_rule_versions where id = p_version_id;
  if not found then
    raise exception 'MATCHING_NOT_FOUND: rule version not found' using errcode = 'P0002';
  end if;
  if p_confirmation is distinct from ('ACTIVATE v' || v_target.version_no::text) then
    raise exception 'MATCHING_CONFIRMATION: type ACTIVATE v% exactly', v_target.version_no
      using errcode = '22023';
  end if;
  select * into v_current from public.matching_rule_versions where id = v_state.active_version_id;
  if v_target.version_no <= v_current.version_no then
    raise exception 'MATCHING_DIRECTION: only a newer version may be activated' using errcode = '55000';
  end if;
  v_as_of_year := extract(year from (current_timestamp at time zone 'UTC'))::integer;
  -- An identical rules document may be republished only after the calendar
  -- year changes, so age gates advance through a new immutable publication.
  if v_target.params_sha256 = v_current.params_sha256
     and v_state.cache_as_of_year = v_as_of_year then
    raise exception 'MATCHING_NO_CHANGE: target parameters and as-of year equal the active publication'
      using errcode = '55000';
  end if;
  if exists (select 1 from public.matching_candidate_snapshots where version_id = p_version_id)
     or exists (select 1 from public.matching_candidates where version_id = p_version_id) then
    raise exception 'MATCHING_STATE: target version already has a governed build' using errcode = '55000';
  end if;

  -- These locks make both digest passes and the insert observe one stable source
  -- state. Contention is reported as MATCHING_BUSY rather than risking a lock-
  -- order deadlock with a mixed source writer.
  perform public.fn_matching_lock_sources_nowait();
  perform pg_advisory_xact_lock(hashtextextended('matching-cache-write', 0));
  v_source_digest := public.fn_matching_source_sha256(v_as_of_year);

  select
    count(*)::integer,
    encode(extensions.digest(coalesce(string_agg(
      e.cargo_id::text || '|' || e.vessel_avail_id::text || '|' || e.score::text || '|'
      || e.score_label || '|' || e.is_rate_aligned::text || '|' || e.dwt_delta::text || '|'
      || v_as_of_year::text,
      E'\n' order by e.cargo_id, e.vessel_avail_id
    ), ''), 'sha256'), 'hex')
  into v_expected_count, v_expected_digest
  from public.fn_matching_evaluate(v_target.params, v_as_of_year, null, null) e;

  if v_expected_count = 0 then
    raise exception 'MATCHING_EMPTY: activation would publish zero candidates' using errcode = '55000';
  end if;

  insert into public.matching_candidates(
    version_id, cargo_id, vessel_avail_id, score, score_label, is_rate_aligned, dwt_delta, as_of_year
  )
  select p_version_id, e.cargo_id, e.vessel_avail_id, e.score, e.score_label,
         e.is_rate_aligned, e.dwt_delta, v_as_of_year
  from public.fn_matching_evaluate(v_target.params, v_as_of_year, null, null) e;

  select d.candidate_count, d.candidate_sha256
    into v_actual_count, v_actual_digest
  from public.fn_matching_candidate_digest(p_version_id) d;
  if v_actual_count <> v_expected_count or v_actual_digest <> v_expected_digest then
    raise exception 'MATCHING_COMPLETENESS: candidate build does not match the deterministic evaluator'
      using errcode = '55000';
  end if;

  insert into public.matching_candidate_snapshots(
    version_id, candidate_count, candidate_sha256, source_sha256, as_of_year, built_by
  ) values (
    p_version_id, v_actual_count, v_actual_digest, v_source_digest, v_as_of_year, p_actor
  );

  -- Cache replacement and pointer switch are deliberately in this transaction.
  delete from public.matches where true;
  delete from public.matching_candidates
  where version_id not in (p_version_id, v_state.active_version_id);
  insert into public.matches(
    cargo_id, vessel_avail_id, score_label, computed_at,
    matching_rule_version_id, match_score, is_rate_aligned, dwt_delta, matching_as_of_year
  )
  select c.cargo_id, c.vessel_avail_id, c.score_label, c.computed_at,
         c.version_id, c.score, c.is_rate_aligned, c.dwt_delta, c.as_of_year
  from public.matching_candidates c where c.version_id = p_version_id;

  update public.matching_rule_state
  set previous_version_id = v_state.active_version_id,
      active_version_id = p_version_id,
      activation_sequence = activation_sequence + 1,
      activated_by = p_actor,
      activated_at = now(),
      cache_as_of_year = v_as_of_year
  where singleton and active_version_id = p_expected_active_version_id;
  if not found then
    raise exception 'MATCHING_CAS: active version changed during activation' using errcode = '40001';
  end if;

  perform public.fn_matching_write_settings_mirror(v_target.params);

  v_result := jsonb_build_object(
    'requestId', p_request_id, 'versionId', p_version_id,
    'previousVersionId', v_state.active_version_id,
    'versionNo', v_target.version_no,
    'candidateCount', v_actual_count,
    'candidateSha256', v_actual_digest,
    'sourceSha256', v_source_digest,
    'asOfYear', v_as_of_year,
    'paramsSha256', v_target.params_sha256
  );
  insert into public.matching_rule_requests(request_id, operation, actor_id, request_sha256, result)
  values (p_request_id, 'activate_version', p_actor, v_request_hash, v_result);
  insert into public.matching_rule_events(
    event_type, version_id, prior_version_id, request_id, actor_id,
    params_sha256, candidate_count, candidate_sha256, source_sha256,
    evaluation_as_of_year, detail
  ) values (
    'version_activated', p_version_id, v_state.active_version_id,
    p_request_id, p_actor, v_target.params_sha256, v_actual_count,
    v_actual_digest, v_source_digest, v_as_of_year,
    jsonb_build_object(
      'versionNo', v_target.version_no,
      'expectedActiveVersionId', p_expected_active_version_id,
      'evaluatorVersion', v_target.evaluator_version,
      'asOfYear', v_as_of_year
    )
  );
  return v_result;
end;
$function$;

create or replace function public.matching_rollback_rule_version(
  p_actor uuid,
  p_request_id uuid,
  p_expected_active_version_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request_hash text;
  v_existing public.matching_rule_requests%rowtype;
  v_target public.matching_rule_versions%rowtype;
  v_current public.matching_rule_versions%rowtype;
  v_state public.matching_rule_state%rowtype;
  v_expected_count integer;
  v_expected_digest text;
  v_actual_count integer;
  v_actual_digest text;
  v_source_digest text;
  v_as_of_year integer;
  v_result jsonb;
begin
  perform public.fn_matching_assert_super_actor(p_actor);
  if p_request_id is null or p_expected_active_version_id is null then
    raise exception 'MATCHING_INPUT: request id and expected active version id are required'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('matching-request:' || p_request_id::text, 0));
  v_request_hash := encode(extensions.digest(
    'rollback_version|' || p_expected_active_version_id::text || '|'
      || coalesce(p_confirmation, 'null'), 'sha256'), 'hex');

  select * into v_existing
  from public.matching_rule_requests
  where request_id = p_request_id;
  if found then
    if v_existing.operation <> 'rollback_version'
       or v_existing.actor_id is distinct from p_actor
       or v_existing.request_sha256 <> v_request_hash then
      raise exception 'MATCHING_IDEMPOTENCY: request id was used with different input'
        using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  select * into v_state
  from public.matching_rule_state
  where singleton
  for update;
  if not found then
    raise exception 'MATCHING_STATE: active rule state is missing' using errcode = '55000';
  end if;
  if v_state.active_version_id is distinct from p_expected_active_version_id then
    raise exception 'MATCHING_CAS: active version changed; reload before rollback'
      using errcode = '40001';
  end if;
  if v_state.previous_version_id is null then
    raise exception 'MATCHING_STATE: there is no previous version to roll back to'
      using errcode = '55000';
  end if;

  select * into v_current
  from public.matching_rule_versions
  where id = v_state.active_version_id;
  select * into v_target
  from public.matching_rule_versions
  where id = v_state.previous_version_id;
  if not found then
    raise exception 'MATCHING_STATE: previous rule version is missing' using errcode = '55000';
  end if;
  if p_confirmation is distinct from ('ROLLBACK v' || v_target.version_no::text) then
    raise exception 'MATCHING_CONFIRMATION: type ROLLBACK v% exactly', v_target.version_no
      using errcode = '22023';
  end if;

  v_as_of_year := extract(year from (current_timestamp at time zone 'UTC'))::integer;
  perform public.fn_matching_lock_sources_nowait();
  perform pg_advisory_xact_lock(hashtextextended('matching-cache-write', 0));
  v_source_digest := public.fn_matching_source_sha256(v_as_of_year);

  select
    count(*)::integer,
    encode(extensions.digest(coalesce(string_agg(
      e.cargo_id::text || '|' || e.vessel_avail_id::text || '|' || e.score::text || '|'
      || e.score_label || '|' || e.is_rate_aligned::text || '|' || e.dwt_delta::text || '|'
      || v_as_of_year::text,
      E'\n' order by e.cargo_id, e.vessel_avail_id
    ), ''), 'sha256'), 'hex')
  into v_expected_count, v_expected_digest
  from public.fn_matching_evaluate(v_target.params, v_as_of_year, null, null) e;

  -- Per-row source refreshes intentionally maintain only the active version.
  -- Rebuild the rollback target in full from the same locked source snapshot.
  delete from public.matching_candidates where version_id = v_target.id;
  insert into public.matching_candidates(
    version_id, cargo_id, vessel_avail_id, score, score_label,
    is_rate_aligned, dwt_delta, as_of_year
  )
  select v_target.id, e.cargo_id, e.vessel_avail_id, e.score, e.score_label,
         e.is_rate_aligned, e.dwt_delta, v_as_of_year
  from public.fn_matching_evaluate(v_target.params, v_as_of_year, null, null) e;

  select d.candidate_count, d.candidate_sha256
    into v_actual_count, v_actual_digest
  from public.fn_matching_candidate_digest(v_target.id) d;
  if v_actual_count <> v_expected_count or v_actual_digest <> v_expected_digest then
    raise exception 'MATCHING_COMPLETENESS: rollback build does not match the deterministic evaluator'
      using errcode = '55000';
  end if;

  perform public.fn_matching_replace_candidate_snapshot(
    v_target.id, v_actual_count, v_actual_digest,
    v_source_digest, v_as_of_year, p_actor
  );

  delete from public.matches where true;
  delete from public.matching_candidates
  where version_id not in (v_target.id, v_current.id);
  insert into public.matches(
    cargo_id, vessel_avail_id, score_label, computed_at,
    matching_rule_version_id, match_score, is_rate_aligned,
    dwt_delta, matching_as_of_year
  )
  select c.cargo_id, c.vessel_avail_id, c.score_label, c.computed_at,
         c.version_id, c.score, c.is_rate_aligned, c.dwt_delta, c.as_of_year
  from public.matching_candidates c
  where c.version_id = v_target.id;

  update public.matching_rule_state
  set previous_version_id = v_current.id,
      active_version_id = v_target.id,
      activation_sequence = activation_sequence + 1,
      activated_by = p_actor,
      activated_at = now(),
      cache_as_of_year = v_as_of_year
  where singleton
    and active_version_id = p_expected_active_version_id
    and previous_version_id = v_target.id;
  if not found then
    raise exception 'MATCHING_CAS: active or previous version changed during rollback'
      using errcode = '40001';
  end if;

  perform public.fn_matching_write_settings_mirror(v_target.params);

  v_result := jsonb_build_object(
    'requestId', p_request_id,
    'versionId', v_target.id,
    'rolledBackFromVersionId', v_current.id,
    'previousVersionId', v_current.id,
    'versionNo', v_target.version_no,
    'candidateCount', v_actual_count,
    'candidateSha256', v_actual_digest,
    'sourceSha256', v_source_digest,
    'asOfYear', v_as_of_year,
    'paramsSha256', v_target.params_sha256
  );
  insert into public.matching_rule_requests(
    request_id, operation, actor_id, request_sha256, result
  ) values (
    p_request_id, 'rollback_version', p_actor, v_request_hash, v_result
  );
  insert into public.matching_rule_events(
    event_type, version_id, prior_version_id, request_id, actor_id,
    params_sha256, candidate_count, candidate_sha256, source_sha256,
    evaluation_as_of_year, detail
  ) values (
    'version_rolled_back', v_target.id, v_current.id, p_request_id, p_actor,
    v_target.params_sha256, v_actual_count, v_actual_digest, v_source_digest,
    v_as_of_year,
    jsonb_build_object(
      'versionNo', v_target.version_no,
      'expectedActiveVersionId', p_expected_active_version_id,
      'evaluatorVersion', v_target.evaluator_version,
      'asOfYear', v_as_of_year
    )
  );
  return v_result;
end;
$function$;

-- Private-by-default function ACLs.  The only member-visible contract is the
-- active canonical parameter document; raw listing-id matchers stay behind the
-- market/Fixture server-side firewalls.
revoke all on function public.fn_matching_validate_params(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_canonical_params_text(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_params_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_assert_super_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_lock_sources_nowait() from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_source_sha256(integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_validate_as_of_year(integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_evaluate(jsonb, integer, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_candidate_digest(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_guard_settings_mirror() from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_immutable_guard() from public, anon, authenticated, service_role;
revoke all on function public.fn_refresh_matches() from public, anon, authenticated, service_role;
revoke all on function public.fn_refresh_matches_for_cargo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_refresh_matches_for_availability(uuid) from public, anon, authenticated, service_role;
revoke all on function public.trg_refresh_matches_cargo() from public, anon, authenticated, service_role;
revoke all on function public.trg_refresh_matches_availability() from public, anon, authenticated, service_role;
revoke all on function public.trg_refresh_matches_vessel() from public, anon, authenticated, service_role;
revoke all on function public.get_matches_for_cargo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_matches_for_availability(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_matching_rules_dashboard(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_matching_preview(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.matching_create_rule_version(uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.matching_activate_rule_version(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.matching_rollback_rule_version(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.fn_matching_params() from public, anon, service_role;
revoke all on function public.get_matching_rules_snapshot() from public, anon, service_role;

revoke all on sequence public.matching_rule_versions_version_no_seq
  from public, anon, authenticated, service_role;
revoke all on sequence public.matching_rule_events_id_seq
  from public, anon, authenticated, service_role;

grant execute on function public.fn_matching_params() to authenticated, service_role;
grant execute on function public.get_matching_rules_snapshot() to authenticated, service_role;
grant execute on function public.fn_matching_validate_params(jsonb) to service_role;
grant execute on function public.fn_matching_canonical_params_text(jsonb) to service_role;
grant execute on function public.fn_matching_params_sha256(jsonb) to service_role;
grant execute on function public.fn_matching_source_sha256(integer) to service_role;
grant execute on function public.fn_matching_validate_as_of_year(integer) to service_role;
grant execute on function public.fn_matching_evaluate(jsonb, integer, uuid, uuid) to service_role;
grant execute on function public.fn_matching_candidate_digest(uuid) to service_role;
grant execute on function public.fn_refresh_matches() to service_role;
grant execute on function public.fn_refresh_matches_for_cargo(uuid) to service_role;
grant execute on function public.fn_refresh_matches_for_availability(uuid) to service_role;
grant execute on function public.get_matches_for_cargo(uuid) to service_role;
grant execute on function public.get_matches_for_availability(uuid) to service_role;
grant execute on function public.admin_matching_rules_dashboard(uuid) to service_role;
grant execute on function public.admin_matching_preview(uuid, jsonb) to service_role;
grant execute on function public.matching_create_rule_version(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.matching_activate_rule_version(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.matching_rollback_rule_version(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
