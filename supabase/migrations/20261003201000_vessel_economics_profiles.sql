-- Vessel economics profile (Voyage Economics, Stream S, 3 Oct 2026).
--
-- The figures the Suez calculator and the Voyage estimator need that the vessel
-- master does not hold: Suez tonnages and certificate facts, laden/ballast
-- speeds, consumption per operating state and fuel family, scrubber, and the
-- A/B/C cost class. A side table keyed by vessel so public.vessels (closed to
-- members by the market firewall) is not touched.
--
-- Who may read/write: admins, holders of a vessel claim, and primary owners of
-- any availability on the vessel (the same allow rule as get_managed_vessel).
-- Everyone else sees nothing and uses Manual mode in the calculators.

create table if not exists public.vessel_economics_profiles (
  vessel_id             uuid primary key references public.vessels(id) on delete cascade,
  scgt                  integer check (scgt is null or scgt between 100 and 300000),
  scnt                  integer check (scnt is null or scnt between 100 and 300000),
  gt                    integer check (gt is null or gt between 100 and 300000),
  suez_category         text check (suez_category is null or suez_category ~ '^[a-z][a-z0-9_]{1,40}$'),
  last_suez_transit     date,
  first_transit         boolean not null default false,
  searchlight_compliant boolean,
  mooring_cranes_ok     boolean,
  speed_laden_kn        numeric(5,2) check (speed_laden_kn is null or speed_laden_kn between 3 and 40),
  speed_ballast_kn      numeric(5,2) check (speed_ballast_kn is null or speed_ballast_kn between 3 and 40),
  consumption           jsonb not null default '{}'::jsonb,
  has_scrubber          boolean not null default false,
  vessel_class          text check (vessel_class is null or vessel_class in ('A','B','C')),
  source                text not null default 'member' check (source in ('member','admin','sync')),
  updated_by            uuid references public.users(id) on delete set null,
  updated_at            timestamptz not null default now(),
  constraint vessel_economics_consumption_ck check (jsonb_typeof(consumption) = 'object')
);
comment on table public.vessel_economics_profiles is
  'Per-vessel economics facts for the Suez calculator and Voyage estimator. consumption = {state: {residual, distillate}} in MT/day for sea_laden, sea_ballast, port_working, port_idle, anchorage, eca_sea.';

alter table public.vessel_economics_profiles enable row level security;
revoke all on table public.vessel_economics_profiles from public, anon, authenticated;
grant all on table public.vessel_economics_profiles to service_role;

-- Allow rule shared by the two RPCs.
create or replace function public.fn_vessel_economics_allowed(p_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $allowed$
  select public.fn_is_admin()
      or exists (
           select 1 from public.vessel_claims vc
            where vc.vessel_id = p_vessel_id
              and vc.user_id in (auth.uid(), public.fn_market_actor()))
      or exists (
           select 1 from public.vessel_availability a
            where a.vessel_id = p_vessel_id
              and public.fn_market_owns_listing(public.fn_market_actor(), 'vessel_availability', a.id));
$allowed$;
revoke all on function public.fn_vessel_economics_allowed(uuid) from public, anon, authenticated, service_role;

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
    'updatedAt', v_row.updated_at);
end;
$get_profile$;
revoke all on function public.get_vessel_economics_profile(uuid) from public, anon;
grant execute on function public.get_vessel_economics_profile(uuid) to authenticated, service_role;

-- Upsert from the member session (claim holder / availability owner) or an admin.
-- Validation mirrors lib/voyage/schemas.ts; unknown keys are dropped.
create or replace function public.upsert_vessel_economics_profile(p_vessel_id uuid, p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $upsert_profile$
declare
  v_actor uuid := coalesce(auth.uid(), public.fn_market_actor());
  v_states text[] := array['sea_laden','sea_ballast','port_working','port_idle','anchorage','eca_sea'];
  v_cons jsonb := '{}'::jsonb;
  v_state text;
  v_entry jsonb;
  v_res numeric;
  v_dis numeric;
begin
  if p_vessel_id is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'VE_INVALID: vessel id and a profile object are required' using errcode = '22023';
  end if;
  if not coalesce(public.fn_vessel_economics_allowed(p_vessel_id), false) then
    raise exception 'VE_FORBIDDEN: you do not manage this vessel' using errcode = '42501';
  end if;

  foreach v_state in array v_states loop
    v_entry := p_profile -> 'consumption' -> v_state;
    if v_entry is not null and jsonb_typeof(v_entry) = 'object' then
      v_res := nullif(v_entry ->> 'residual', '')::numeric;
      v_dis := nullif(v_entry ->> 'distillate', '')::numeric;
      if (v_res is not null and (v_res < 0 or v_res > 500)) or (v_dis is not null and (v_dis < 0 or v_dis > 500)) then
        raise exception 'VE_INVALID: consumption for % out of range (0–500 MT/day)', v_state using errcode = '22023';
      end if;
      v_cons := v_cons || jsonb_build_object(v_state, jsonb_strip_nulls(jsonb_build_object('residual', v_res, 'distillate', v_dis)));
    end if;
  end loop;

  insert into public.vessel_economics_profiles as p (
    vessel_id, scgt, scnt, gt, suez_category, last_suez_transit, first_transit,
    searchlight_compliant, mooring_cranes_ok, speed_laden_kn, speed_ballast_kn,
    consumption, has_scrubber, vessel_class, source, updated_by, updated_at)
  values (
    p_vessel_id,
    nullif(p_profile ->> 'scgt', '')::integer,
    nullif(p_profile ->> 'scnt', '')::integer,
    nullif(p_profile ->> 'gt', '')::integer,
    nullif(p_profile ->> 'suezCategory', ''),
    nullif(p_profile ->> 'lastSuezTransit', '')::date,
    coalesce((p_profile ->> 'firstTransit')::boolean, false),
    (p_profile ->> 'searchlightCompliant')::boolean,
    (p_profile ->> 'mooringCranesOk')::boolean,
    nullif(p_profile ->> 'speedLadenKn', '')::numeric,
    nullif(p_profile ->> 'speedBallastKn', '')::numeric,
    v_cons,
    coalesce((p_profile ->> 'hasScrubber')::boolean, false),
    nullif(p_profile ->> 'vesselClass', ''),
    case when public.fn_is_admin() then 'admin' else 'member' end,
    v_actor, now())
  on conflict (vessel_id) do update set
    scgt = excluded.scgt, scnt = excluded.scnt, gt = excluded.gt,
    suez_category = excluded.suez_category, last_suez_transit = excluded.last_suez_transit,
    first_transit = excluded.first_transit, searchlight_compliant = excluded.searchlight_compliant,
    mooring_cranes_ok = excluded.mooring_cranes_ok, speed_laden_kn = excluded.speed_laden_kn,
    speed_ballast_kn = excluded.speed_ballast_kn, consumption = excluded.consumption,
    has_scrubber = excluded.has_scrubber, vessel_class = excluded.vessel_class,
    source = excluded.source, updated_by = excluded.updated_by, updated_at = now();

  return public.get_vessel_economics_profile(p_vessel_id);
end;
$upsert_profile$;
revoke all on function public.upsert_vessel_economics_profile(uuid, jsonb) from public, anon;
grant execute on function public.upsert_vessel_economics_profile(uuid, jsonb) to authenticated, service_role;
