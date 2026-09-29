-- Governed market RPC performance gate: 200 cargo x 200 vessel positions.
--
-- IMPORTANT: run only on an empty disposable database whose name contains
-- "market_perf", after all market privacy migrations have been applied.
-- The entire fixture is transactional and rolls back, but ANALYZE statistics
-- are not a production-safe side effect; the database must still be disposable.
-- Run with psql -v ON_ERROR_STOP=1 -f this-file.sql.

begin;

do $guard$
declare
  v_live_cargo bigint;
  v_live_vessels bigint;
begin
  if current_database() not like '%market_perf%' then
    raise exception
      'PERF_GUARD: database name must contain market_perf (got %)',
      current_database();
  end if;

  select count(*) into v_live_cargo
    from public.cargo_listings
   where review_status::text = 'APPROVED'
     and status::text in ('IN', 'PARTIAL');
  select count(*) into v_live_vessels
    from public.vessel_availability
   where review_status::text = 'APPROVED'
     and status::text = 'OPEN';

  if v_live_cargo <> 0 or v_live_vessels <> 0 then
    raise exception
      'PERF_GUARD: benchmark needs an empty market (cargo %, vessels %)',
      v_live_cargo, v_live_vessels;
  end if;
end
$guard$;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local session_replication_role = replica;

create temp table mp_perf_cargo (
  n integer primary key,
  id uuid not null
) on commit drop;
create temp table mp_perf_vessel (
  n integer primary key,
  vessel_id uuid not null,
  availability_id uuid not null
) on commit drop;
create temp table mp_perf_results (
  endpoint text not null,
  run_no integer not null,
  elapsed_ms numeric not null,
  returned_rows integer not null,
  tagged_rows integer not null,
  primary key (endpoint, run_no)
) on commit drop;

insert into mp_perf_cargo (n, id)
select n, gen_random_uuid() from generate_series(1, 200) n;
insert into mp_perf_vessel (n, vessel_id, availability_id)
select n, gen_random_uuid(), gen_random_uuid()
  from generate_series(1, 200) n;

insert into auth.users (id, email, aud, role, raw_app_meta_data)
values (
  '20000000-0000-4000-8000-000000000001',
  'actor@market-perf.test',
  'authenticated',
  'authenticated',
  '{"role":"member"}'::jsonb
)
on conflict (id) do nothing;

insert into public.users (
  id, supabase_user_id, email, full_name, company, role,
  subscription_tier, is_active
)
values (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'actor@market-perf.test',
  'Market Performance Actor',
  'Market Performance Test',
  'broker',
  'T3',
  true
)
on conflict (id) do nothing;

insert into public.ports (
  locode, trade_name, country, zone, port_type, is_active, is_verified
)
values
  ('ZZPFA', 'Performance Load Port', 'Egypt', 'E.MED', 'Sea Port', true, true),
  ('ZZPFB', 'Performance Discharge Port', 'Turkey', 'E.MED', 'Sea Port', true, true)
on conflict do nothing;

insert into public.cargo_listings (
  id, ref, status, review_status, cargo_type, commodity_name,
  is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
  load_port_locode, load_port_name, load_zone,
  disch_port_locode, disch_port_name, disch_zone,
  laycan_from, laycan_to, is_spot, load_terms,
  freight_idea_usd_mt, created_at, refreshed_at
)
select
  p.id,
  'MPERF-C-' || lpad(p.n::text, 4, '0'),
  'IN',
  'APPROVED',
  'Dry Bulk',
  'PERF CARGO ' || lpad(p.n::text, 4, '0'),
  false,
  false,
  29000,
  31000,
  'ZZPFA',
  'Performance Load Port',
  'E.MED',
  'ZZPFB',
  'Performance Discharge Port',
  'E.MED',
  current_date + 10,
  current_date + 20,
  true,
  'FIOST',
  25.00,
  now() + interval '1 day' + p.n * interval '1 second',
  now()
from mp_perf_cargo p;

insert into public.vessels (
  id, vessel_name, imo_number, vessel_type, dwt_grain, build_year,
  flag, is_geared, grain_certified, dg_certified, max_draft_m,
  is_sanctioned, is_tbn
)
select
  p.vessel_id,
  'PERF VESSEL ' || lpad(p.n::text, 4, '0'),
  'MPF' || lpad(p.n::text, 7, '0'),
  'Bulk Carrier',
  30000,
  2015,
  'Malta',
  true,
  true,
  true,
  10.5,
  false,
  false
from mp_perf_vessel p;

insert into public.vessel_availability (
  id, vessel_id, open_port_locode, open_port_name, open_zone,
  open_date, status, review_status, freight_idea_usd_mt,
  accepts_part_cargo, created_at, refreshed_at
)
select
  p.availability_id,
  p.vessel_id,
  'ZZPFA',
  'Performance Load Port',
  'E.MED',
  current_date - 30000 + p.n,
  'OPEN',
  'APPROVED',
  26.00,
  false,
  now() + interval '1 day' + p.n * interval '1 second',
  now()
from mp_perf_vessel p;

-- Worst-case dense cache. This is the path that exposed the old per-payload,
-- per-edge liveness expansion: 40,000 edges for only 400 board rows.
insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
select c.id, v.availability_id, 'Strong', now()
  from mp_perf_cargo c
 cross join mp_perf_vessel v
on conflict (cargo_id, vessel_avail_id) do nothing;

insert into public.app_settings (key, value)
values
  (
    'market_visibility',
    '{"freshDays":7,"archiveDaysByTier":{"T1":0,"T2":0,"T3":30,"T4":60},"laycanException":true}'::jsonb
  ),
  (
    'platform_settings',
    '{"marketplace":{"spotActiveDays":14,"vesselActiveDays":14}}'::jsonb
  )
on conflict (key) do update set value = excluded.value;

set local session_replication_role = origin;

-- Statistics are intentionally refreshed only in the disposable database.
analyze public.cargo_listings;
analyze public.vessels;
analyze public.vessel_availability;
analyze public.matches;
analyze market_private.listing_handles;

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"member"}}',
  true
);

do $bench$
declare
  v_rows jsonb;
  v_matches jsonb;
  v_detail jsonb;
  v_cargo_key uuid;
  v_match_key uuid;
  v_t0 timestamptz;
  v_elapsed numeric;
  v_run integer;
  v_returned integer;
  v_tagged integer;
begin
  -- Warm caches, plans, and actor handles. The warm-up is deliberately not
  -- recorded; five subsequent samples feed the p95 release gate.
  perform public.list_market_cargo(null, null);
  perform public.list_market_vessels(null, null);

  for v_run in 1..5 loop
    v_t0 := clock_timestamp();
    v_rows := public.list_market_cargo(null, null);
    v_elapsed := extract(epoch from (clock_timestamp() - v_t0)) * 1000;
    select count(*)::integer,
           count(*) filter (where x->>'ref' like 'MPERF-C-%')::integer
      into v_returned, v_tagged
      from jsonb_array_elements(v_rows) x;
    insert into mp_perf_results values
      ('cargo_board_200', v_run, v_elapsed, v_returned, v_tagged);

    select (x->>'listing_key')::uuid
      into v_cargo_key
      from jsonb_array_elements(v_rows) x
     where x->>'ref' = 'MPERF-C-0001';
    if v_cargo_key is null then
      raise exception 'PERF_FIXTURE: tagged cargo key was not returned';
    end if;

    v_t0 := clock_timestamp();
    v_rows := public.list_market_vessels(null, null);
    v_elapsed := extract(epoch from (clock_timestamp() - v_t0)) * 1000;
    select count(*)::integer,
           count(*) filter (
             where x->'vessel'->>'vessel_name' like 'PERF VESSEL %'
           )::integer
      into v_returned, v_tagged
      from jsonb_array_elements(v_rows) x;
    insert into mp_perf_results values
      ('vessel_board_200', v_run, v_elapsed, v_returned, v_tagged);

    v_t0 := clock_timestamp();
    v_matches := public.list_market_matches(v_cargo_key);
    v_elapsed := extract(epoch from (clock_timestamp() - v_t0)) * 1000;
    select count(*)::integer,
           count(*) filter (
             where x->'vessel'->>'vessel_name' like 'PERF VESSEL %'
           )::integer
      into v_returned, v_tagged
      from jsonb_array_elements(v_matches) x;
    insert into mp_perf_results values
      ('cargo_matches_200', v_run, v_elapsed, v_returned, v_tagged);

    select (x->>'listing_key')::uuid
      into v_match_key
      from jsonb_array_elements(v_matches) x
     where x->'vessel'->>'vessel_name' = 'PERF VESSEL 0001';
    if v_match_key is null then
      raise exception 'PERF_FIXTURE: tagged match key was not returned';
    end if;

    v_t0 := clock_timestamp();
    v_detail := public.get_market_listing_detail(v_match_key);
    v_elapsed := extract(epoch from (clock_timestamp() - v_t0)) * 1000;
    insert into mp_perf_results values
      ('listing_detail', v_run, v_elapsed,
       case when v_detail is null then 0 else 1 end,
       case when v_detail->'vessel'->>'vessel_name' = 'PERF VESSEL 0001'
            then 1 else 0 end);
  end loop;
end
$bench$;

select endpoint,
       count(*) as samples,
       round(min(elapsed_ms), 2) as min_ms,
       round(avg(elapsed_ms), 2) as avg_ms,
       round(
         percentile_cont(0.95) within group (order by elapsed_ms)::numeric,
         2
       ) as p95_ms,
       min(returned_rows) as min_returned,
       max(returned_rows) as max_returned,
       min(tagged_rows) as min_tagged,
       max(tagged_rows) as max_tagged
  from mp_perf_results
 group by endpoint
 order by endpoint;

do $gate$
declare
  r record;
  v_limit numeric;
  v_expected integer;
  v_endpoints text[];
begin
  select array_agg(endpoint order by endpoint)
    into v_endpoints
    from (select distinct endpoint from mp_perf_results) e;
  if v_endpoints is distinct from array[
    'cargo_board_200', 'cargo_matches_200',
    'listing_detail', 'vessel_board_200'
  ]::text[] then
    raise exception 'PERF_GATE: endpoint set is incomplete or unexpected: %',
      v_endpoints;
  end if;

  for r in
    select endpoint,
           percentile_cont(0.95) within group (order by elapsed_ms) as p95_ms,
           count(*) as sample_count,
           min(returned_rows) as min_returned,
           max(returned_rows) as max_returned,
           min(tagged_rows) as min_tagged,
           max(tagged_rows) as max_tagged
      from mp_perf_results
     group by endpoint
  loop
    v_limit := case r.endpoint
      when 'cargo_board_200' then 750
      when 'vessel_board_200' then 750
      when 'cargo_matches_200' then 900
      when 'listing_detail' then 150
      else 0
    end;
    v_expected := case when r.endpoint = 'listing_detail' then 1 else 200 end;

    if r.sample_count <> 5 then
      raise exception 'PERF_GATE: % produced % samples, expected 5',
        r.endpoint, r.sample_count;
    end if;
    if r.min_returned <> v_expected or r.max_returned <> v_expected
       or r.min_tagged <> v_expected or r.max_tagged <> v_expected then
      raise exception
        'PERF_GATE: % expected % rows every run; returned %..%, tagged %..%',
        r.endpoint, v_expected, r.min_returned, r.max_returned,
        r.min_tagged, r.max_tagged;
    end if;
    if r.p95_ms > v_limit then
      raise exception
        'PERF_GATE: % p95 % ms exceeds % ms',
        r.endpoint, round(r.p95_ms::numeric, 2), v_limit;
    end if;
  end loop;
end
$gate$;

rollback;
