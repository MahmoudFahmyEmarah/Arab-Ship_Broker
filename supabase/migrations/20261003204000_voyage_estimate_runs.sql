-- Immutable voyage estimate runs (Voyage Economics, Stream S; plan r2 item 3).
--
-- A saved estimate is a snapshot: the engine input, its output, the four
-- cross-module snapshots (fuel index, route/ECA classification, Suez cost,
-- port costs) each with status + versions + SHA-256, the algorithm version
-- and the settings hash. Rows never change; a new estimate is a new row.
-- The legacy public.voyage_estimates table is left untouched (nothing wrote
-- to it) for a later retirement.
--
-- Access: the actor (public.users.id) who saved it, members of its owner org,
-- and admins may read; writes go through save_voyage_estimate (service role,
-- p_actor) from the server action after the session check.

create table if not exists public.voyage_estimate_runs (
  id                  uuid primary key default gen_random_uuid(),
  actor_user_id       uuid not null references public.users(id) on delete cascade,
  owner_org_id        uuid references public.organizations(id) on delete set null,
  vessel_id           uuid references public.vessels(id) on delete set null,
  availability_id     uuid references public.vessel_availability(id) on delete set null,
  cargo_listing_id    uuid references public.cargo_listings(id) on delete set null,
  label               text,
  algorithm_version   text not null,
  settings_hash       text not null,
  input_snapshot      jsonb not null,
  result_snapshot     jsonb not null,
  fuel_index_snapshot jsonb,
  route_eca_snapshot  jsonb,
  suez_cost_snapshot  jsonb,
  port_cost_snapshot  jsonb,
  totals              jsonb not null,
  warnings            jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  constraint voyage_estimate_runs_label_ck check (label is null or length(trim(label)) between 1 and 200),
  constraint voyage_estimate_runs_algo_ck check (algorithm_version ~ '^[a-z0-9_-]+/[0-9]+$'),
  constraint voyage_estimate_runs_hash_ck check (settings_hash ~ '^[a-f0-9]{64}$'),
  constraint voyage_estimate_runs_json_ck check (
    jsonb_typeof(input_snapshot) = 'object' and jsonb_typeof(result_snapshot) = 'object'
    and jsonb_typeof(totals) = 'object' and jsonb_typeof(warnings) = 'array'
    and (fuel_index_snapshot is null or jsonb_typeof(fuel_index_snapshot) = 'object')
    and (route_eca_snapshot is null or jsonb_typeof(route_eca_snapshot) = 'object')
    and (suez_cost_snapshot is null or jsonb_typeof(suez_cost_snapshot) = 'object')
    and (port_cost_snapshot is null or jsonb_typeof(port_cost_snapshot) = 'object'))
);

create table if not exists public.voyage_estimate_lines (
  run_id       uuid not null references public.voyage_estimate_runs(id) on delete cascade,
  seq          integer not null check (seq >= 0),
  kind         text not null check (kind in ('leg','fuel','cost','revenue')),
  code         text not null check (code ~ '^[a-z][a-z0-9_]{0,79}$'),
  label        text not null,
  quantity     numeric(14,3),
  unit         text,
  rate         numeric(14,4),
  amount_usd   numeric(14,2),
  explanation  text,
  primary key (run_id, seq)
);

create index if not exists voyage_estimate_runs_actor_idx on public.voyage_estimate_runs (actor_user_id, created_at desc);
create index if not exists voyage_estimate_runs_org_idx on public.voyage_estimate_runs (owner_org_id, created_at desc) where owner_org_id is not null;

create or replace function public.fn_voyage_run_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $immutable$
begin
  raise exception 'VOYAGE_IMMUTABLE: a saved voyage estimate never changes; save a new estimate' using errcode = '55000';
end;
$immutable$;
revoke all on function public.fn_voyage_run_immutable() from public, anon, authenticated;
drop trigger if exists trg_voyage_run_immutable on public.voyage_estimate_runs;
create trigger trg_voyage_run_immutable before update on public.voyage_estimate_runs for each row execute function public.fn_voyage_run_immutable();
drop trigger if exists trg_voyage_lines_immutable on public.voyage_estimate_lines;
create trigger trg_voyage_lines_immutable before update on public.voyage_estimate_lines for each row execute function public.fn_voyage_run_immutable();

alter table public.voyage_estimate_runs enable row level security;
alter table public.voyage_estimate_lines enable row level security;
revoke all on table public.voyage_estimate_runs, public.voyage_estimate_lines from public, anon, authenticated;
grant all on table public.voyage_estimate_runs, public.voyage_estimate_lines to service_role;

create or replace function public.fn_can_read_voyage_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $can_read$
  select public.fn_is_admin()
      or exists (
           select 1 from public.voyage_estimate_runs r
            where r.id = p_run_id
              and (r.actor_user_id = public.fn_market_actor()
                   or (r.owner_org_id is not null and exists (
                        select 1 from public.organization_members om
                         where om.org_id = r.owner_org_id and om.user_id = public.fn_market_actor()
                           and om.is_current and om.status = 'active'))));
$can_read$;
revoke all on function public.fn_can_read_voyage_run(uuid) from public, anon, authenticated, service_role;

-- Service role + explicit actor: the server action has already verified the session.
create or replace function public.save_voyage_estimate(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $save$
declare
  v_id uuid;
  v_line jsonb;
  v_seq integer := 0;
  v_org uuid;
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor) then
    raise exception 'VOYAGE_INVALID: unknown actor' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload -> 'input') <> 'object'
     or jsonb_typeof(p_payload -> 'result') <> 'object' or jsonb_typeof(p_payload -> 'totals') <> 'object' then
    raise exception 'VOYAGE_INVALID: payload needs input, result and totals objects' using errcode = '22023';
  end if;
  -- The actor's current org, if any, so colleagues can read the estimate.
  select om.org_id into v_org
    from public.organization_members om
   where om.user_id = p_actor and om.is_current and om.status = 'active'
   order by om.created_at asc nulls last limit 1;

  insert into public.voyage_estimate_runs (
    actor_user_id, owner_org_id, vessel_id, availability_id, cargo_listing_id, label,
    algorithm_version, settings_hash, input_snapshot, result_snapshot,
    fuel_index_snapshot, route_eca_snapshot, suez_cost_snapshot, port_cost_snapshot, totals, warnings)
  values (
    p_actor, v_org,
    nullif(p_payload ->> 'vesselId', '')::uuid,
    nullif(p_payload ->> 'availabilityId', '')::uuid,
    nullif(p_payload ->> 'cargoListingId', '')::uuid,
    nullif(p_payload ->> 'label', ''),
    coalesce(p_payload ->> 'algorithmVersion', 'voyage-engine/1'),
    p_payload ->> 'settingsHash',
    p_payload -> 'input', p_payload -> 'result',
    p_payload -> 'fuelIndexSnapshot', p_payload -> 'routeEcaSnapshot',
    p_payload -> 'suezCostSnapshot', p_payload -> 'portCostSnapshot',
    p_payload -> 'totals', coalesce(p_payload -> 'warnings', '[]'::jsonb))
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb)) loop
    insert into public.voyage_estimate_lines (run_id, seq, kind, code, label, quantity, unit, rate, amount_usd, explanation)
    values (v_id, v_seq, v_line ->> 'kind', v_line ->> 'code', coalesce(v_line ->> 'label', v_line ->> 'code'),
            nullif(v_line ->> 'quantity', '')::numeric, v_line ->> 'unit', nullif(v_line ->> 'rate', '')::numeric,
            nullif(v_line ->> 'amountUsd', '')::numeric, v_line ->> 'explanation');
    v_seq := v_seq + 1;
  end loop;
  return v_id;
end;
$save$;
revoke all on function public.save_voyage_estimate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_voyage_estimate(uuid, jsonb) to service_role;

create or replace function public.get_voyage_estimate(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $get$
declare
  r public.voyage_estimate_runs%rowtype;
  v_lines jsonb;
begin
  if p_run_id is null or not coalesce(public.fn_can_read_voyage_run(p_run_id), false) then
    raise exception 'VOYAGE_NOT_FOUND: estimate was not found' using errcode = 'P0002';
  end if;
  select * into r from public.voyage_estimate_runs where id = p_run_id;
  select coalesce(jsonb_agg(jsonb_build_object('seq', l.seq, 'kind', l.kind, 'code', l.code, 'label', l.label, 'quantity', l.quantity,
           'unit', l.unit, 'rate', l.rate, 'amountUsd', l.amount_usd, 'explanation', l.explanation) order by l.seq), '[]'::jsonb)
    into v_lines from public.voyage_estimate_lines l where l.run_id = p_run_id;
  return jsonb_build_object(
    'id', r.id, 'label', r.label, 'createdAt', r.created_at, 'actorUserId', r.actor_user_id,
    'vesselId', r.vessel_id, 'availabilityId', r.availability_id, 'cargoListingId', r.cargo_listing_id,
    'algorithmVersion', r.algorithm_version, 'settingsHash', r.settings_hash,
    'input', r.input_snapshot, 'result', r.result_snapshot, 'totals', r.totals, 'warnings', r.warnings,
    'fuelIndexSnapshot', r.fuel_index_snapshot, 'routeEcaSnapshot', r.route_eca_snapshot,
    'suezCostSnapshot', r.suez_cost_snapshot, 'portCostSnapshot', r.port_cost_snapshot, 'lines', v_lines);
end;
$get$;
revoke all on function public.get_voyage_estimate(uuid) from public, anon;
grant execute on function public.get_voyage_estimate(uuid) to authenticated, service_role;

create or replace function public.list_my_voyage_estimates(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $list$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'label', r.label, 'createdAt', r.created_at, 'vesselId', r.vessel_id,
           'cargoListingId', r.cargo_listing_id, 'totals', r.totals, 'algorithmVersion', r.algorithm_version)
           order by r.created_at desc), '[]'::jsonb)
    from (
      select * from public.voyage_estimate_runs r
       where r.actor_user_id = public.fn_market_actor()
          or (r.owner_org_id is not null and exists (
                select 1 from public.organization_members om
                 where om.org_id = r.owner_org_id and om.user_id = public.fn_market_actor()
                   and om.is_current and om.status = 'active'))
       order by r.created_at desc
       limit greatest(1, least(coalesce(p_limit, 20), 100))
    ) r;
$list$;
revoke all on function public.list_my_voyage_estimates(integer) from public, anon;
grant execute on function public.list_my_voyage_estimates(integer) to authenticated, service_role;

comment on table public.voyage_estimate_runs is 'Immutable voyage estimate snapshots with cross-module snapshots and hashes (Voyage Economics, Stream S).';
