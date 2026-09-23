-- Seed the DISPOSABLE database to production's shape, for the load test
-- (21 Sep 2026).  COMMITS — never run this against the linked project.
--
--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/data_quality/seed_production_shape.sql
--
-- The load test (dq_load_test.sql) multiplies the cargo_listings that are
-- already there. On a database rebuilt from repository artifacts there are
-- none, so it would multiply nothing and prove nothing — a sequential scan
-- over an empty table is fast for reasons that have nothing to do with the
-- release.
--
-- These are the real counts on the linked project, read on 21 Sep 2026:
--
--   cargo_listings 1833 · vessel_availability 85 · vessels 159
--   ports 366 · commodities 131 · organizations 166
--
-- The rows are synthetic but shaped to exercise the rules rather than to slip
-- past them: port names that need resolving, quantity ranges, commodity names
-- both canonical and vague, and a realistic spread of statuses. Roughly a
-- fifth are deliberately defective, because a corpus where everything passes
-- measures the wrong thing — the engine's cost is in the rows that fail.
set session_replication_role = replica;   -- no match refresh, no gate, while seeding

-- ── reference data up to production's size ─────────────────────────────────
insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified)
select 'ZL' || lpad(g::text, 3, '0'),
       'Load Port ' || g,
       (array['Egypt', 'Turkey', 'Spain', 'Italy', 'Greece', 'Ukraine', 'Romania'])[1 + (g % 7)],
       'E.MED'::zone_enum, 'Sea Port'::port_type_enum, true, true
  from generate_series(1, greatest(0, 366 - (select count(*) from public.ports))) g
on conflict (locode) do nothing;

insert into public.commodities (canonical_name, cargo_type, imsbc_category, is_active, sort_order)
select 'Load Commodity ' || g, 'Dry Bulk'::cargo_type_enum, 'Non_DG', true, 900 + g
  from generate_series(1, greatest(0, 131 - (select count(*) from public.commodities))) g
on conflict do nothing;

insert into public.organizations (name, org_type)
select 'Load Org ' || g, 'broker'
  from generate_series(1, greatest(0, 166 - (select count(*) from public.organizations))) g
on conflict do nothing;

-- ── cargo listings, to production's count ─────────────────────────────────
do $$
declare
  v_have int;
  v_want int := 1833;
  v_ports text[];
  v_comm  text[];
begin
  select count(*) into v_have from public.cargo_listings;
  if v_have >= v_want then
    raise notice 'cargo_listings already holds % rows (want %) - nothing seeded', v_have, v_want;
    return;
  end if;
  select array_agg(locode order by locode) into v_ports from public.ports where is_active;
  select array_agg(canonical_name order by canonical_name) into v_comm from public.commodities where is_active;

  insert into public.cargo_listings (
    ref, status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo,
    qty_min_mt, qty_max_mt, is_spot, review_status,
    load_port_name, load_port_locode, disch_port_name, disch_port_locode,
    laycan_from, laycan_to)
  select
    'LOAD-' || lpad(g::text, 6, '0'),
    -- A row with a port that does not resolve cannot be live: the database
    -- refuses it (cargo_listings_live_routable_ck), which is the route gate
    -- doing exactly what it was built for. So the defective rows are withdrawn
    -- or still pending review — which is what they look like in production too.
    case when (g % 7 = 0 or g % 9 = 0) then 'OUT'
         else (array['IN', 'IN', 'IN', 'PARTIAL', 'CLOSED'])[1 + (g % 5)] end::cargo_status_enum,
    'Dry Bulk'::cargo_type_enum,
    -- one in five carries a vague commodity name: a DQ-C09 / DQ-D* finding
    case when g % 5 = 0 then 'general cargo' else v_comm[1 + (g % array_length(v_comm, 1))] end,
    false, (g % 11 = 0),
    3000 + (g % 40) * 500,
    3000 + (g % 40) * 500 + 2000,
    (g % 3 = 0),
    case when (g % 7 = 0 or g % 9 = 0) then 'PENDING'
         else (array['APPROVED', 'APPROVED', 'PENDING'])[1 + (g % 3)] end::review_status_enum,
    -- one in seven names a port that does not resolve: the DQ-P / DQ-K rules
    case when g % 7 = 0 then 'somewhere near ' || (g % 50) else 'Load Port ' || (g % 300) end,
    case when g % 7 = 0 then null else v_ports[1 + (g % array_length(v_ports, 1))] end,
    case when g % 9 = 0 then 'tbc' else 'Load Port ' || ((g + 17) % 300) end,
    case when g % 9 = 0 then null else v_ports[1 + ((g + 17) % array_length(v_ports, 1))] end,
    now() + make_interval(days => (g % 60)),
    now() + make_interval(days => (g % 60) + 10)
  from generate_series(1, v_want - v_have) g;

  raise notice 'seeded % cargo listings (now %)', v_want - v_have, (select count(*) from public.cargo_listings);
end $$;

set session_replication_role = origin;

-- The planner needs statistics for the volume that is actually there, or every
-- plan in the load test is chosen for a table it thinks is empty.
analyze public.cargo_listings;
analyze public.ports;
analyze public.commodities;
analyze public.organizations;

select 'seeded: cargo_listings=' || (select count(*) from public.cargo_listings)
    || ' ports=' || (select count(*) from public.ports)
    || ' commodities=' || (select count(*) from public.commodities)
    || ' organizations=' || (select count(*) from public.organizations) as result;
