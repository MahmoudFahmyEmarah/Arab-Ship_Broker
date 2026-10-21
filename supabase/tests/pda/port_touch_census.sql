-- PDA · port touch census (20261019140000, design B2ALL-061 step 11). BEGIN … ROLLBACK; run as the database owner.
--   C1  a port is touched by each live cargo that loads or discharges there (effective port and alternate slots, once per
--       listing) and by each open vessel at it; loads, discharges and vessels are counted apart; most touched first
--   C2  the cohort rule: 1 or 2 listings or vessels are suppressed (counts null, suppressed true); 0 and ≥ 3 are reported
--   C3  only what the boards show counts: OUT, CLOSED, PENDING, REJECTED cargo and FIXED / PENDING availability do not
--   C4  an inactive or unverified port is not listed at all
--   C5  gates: signed out → PDA_AUTH; T2 → PDA_TIER; grants authenticated + service_role only; no internal id
--   C6  a breakdown cell of 1 or 2 withholds every cell (only the total is reported), so no cell points at one listing:
--       a small vessel cell (p5) and a small loads cell (p9), all three terms pinned each time
--   C7  the cohort counts distinct vessels and listings: one vessel with three open positions is one (p6), and one
--       listing that loads and discharges at the same port plus one vessel is two (p10) — both suppressed
--   C8  suppressed ports are ordered by name among the untouched ones, never by the count they withhold
begin;

do $$
declare
  member uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  p1 text := 'XXC' || upper(substr(md5(random()::text), 1, 2));
  p2 text; p3 text; p4 text; p5 text; p6 text; p7 text; p8 text; p9 text; p10 text;
  vessel_a uuid; vessel_b uuid; vessel_c uuid; vessel_d uuid; vessel_e uuid; vessel_f uuid;
  census jsonb; row1 jsonb; row2 jsonb; row3 jsonb; row5 jsonb; row6 jsonb; row7 jsonb; row8 jsonb; row9 jsonb; row10 jsonb; e text; o3 int; o7 int;
begin
  p2 := 'XXD' || substr(p1, 4, 2); p3 := 'XXE' || substr(p1, 4, 2); p4 := 'XXF' || substr(p1, 4, 2);
  p5 := 'XXG' || substr(p1, 4, 2); p6 := 'XXH' || substr(p1, 4, 2); p7 := 'XXJ' || substr(p1, 4, 2); p8 := 'XXK' || substr(p1, 4, 2);
  p9 := 'XXL' || substr(p1, 4, 2); p10 := 'XXM' || substr(p1, 4, 2);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaCensus1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (member, 'pda-census-member@example.test'), (basic, 'pda-census-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (member, member, 'pda-census-member@example.test', 'Census Member', 'cargo_owner', true, null, 'T3'),
    (basic, basic, 'pda-census-basic@example.test', 'Census Basic', 'cargo_owner', true, null, 'T2');

  -- seven fresh ports: p1, p2 verified and busy; p3 a small cohort; p4 unverified; p5 a small breakdown cell;
  -- p6 one vessel with three open positions; p7 two touches, named to sort AFTER p3
  insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified) values
    (p1, 'CENSUS LOAD ' || p1, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p2, 'CENSUS DISCHARGE ' || p2, 'Saudi Arabia', 'R.SEA', 'Sea Port', true, true),
    (p3, 'CENSUS SMALL ' || p3, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p4, 'CENSUS UNVERIFIED ' || p4, 'Egypt', 'E.MED', 'Sea Port', true, false),
    (p5, 'CENSUS SUBCELL ' || p5, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p6, 'CENSUS ONE VESSEL ' || p6, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p7, 'CENSUS ZZ-SMALL ' || p7, 'Saudi Arabia', 'R.SEA', 'Sea Port', true, true),
    (p8, 'CENSUS ZERO ' || p8, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p9, 'CENSUS SMALL LOADS ' || p9, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p10, 'CENSUS SAME PORT ' || p10, 'Egypt', 'E.MED', 'Sea Port', true, true);

  -- three live cargoes p1 → p2; one with p1 as an ALTERNATE load port (slot 2) and p3 as its primary; one OUT; one PENDING
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  select 'CENSUS-' || g, 'IN', 'APPROVED', 'Dry Bulk', 'Census wheat', false, true, 25000, 27500,
         p1, 'CENSUS LOAD', 'E.MED', p2, 'CENSUS DISCHARGE', 'R.SEA', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200
  from generate_series(1, 3) g;
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_2_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  values ('CENSUS-ALT', 'PARTIAL', 'APPROVED', 'Dry Bulk', 'Census barley', false, true, 10000, 12000,
          p3, p1, 'CENSUS SMALL', 'E.MED', p4, 'CENSUS UNVERIFIED', 'E.MED', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200);
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  values ('CENSUS-OUT', 'OUT', 'APPROVED', 'Dry Bulk', 'Census gone', false, true, 25000, 27500, p3, 'CENSUS SMALL', 'E.MED', p2, 'CENSUS DISCHARGE', 'R.SEA', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200),
         ('CENSUS-PEND', 'IN', 'PENDING', 'Dry Bulk', 'Census pending', false, true, 25000, 27500, p3, 'CENSUS SMALL', 'E.MED', p2, 'CENSUS DISCHARGE', 'R.SEA', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200);

  -- two more live cargoes p1 → p7 (p7: exactly 2 touches from 2 listings) and three p5 → p2 (p5: 3 loads)
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  select 'CENSUS-Z' || g, 'IN', 'APPROVED', 'Dry Bulk', 'Census maize', false, true, 25000, 27500,
         p1, 'CENSUS LOAD', 'E.MED', p7, 'CENSUS ZZ-SMALL', 'R.SEA', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200
  from generate_series(1, 2) g;
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  select 'CENSUS-S' || g, 'IN', 'APPROVED', 'Dry Bulk', 'Census sorghum', false, true, 25000, 27500,
         p5, 'CENSUS SUBCELL', 'E.MED', p2, 'CENSUS DISCHARGE', 'R.SEA', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200
  from generate_series(1, 3) g;

  -- p9: two live cargoes load there (a small loads cell) with three open vessels below; p10: ONE listing loads at p10
  -- and discharges at p10 through its alternate discharge slot (primary discharge at the unverified p4) — one listing
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  select 'CENSUS-L' || g, 'IN', 'APPROVED', 'Dry Bulk', 'Census lentils', false, true, 25000, 27500,
         p9, 'CENSUS SMALL LOADS', 'E.MED', p4, 'CENSUS UNVERIFIED', 'E.MED', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200
  from generate_series(1, 2) g;
  insert into public.cargo_listings (ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt,
      load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_2_locode, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, load_terms, load_rate, disch_rate)
  values ('CENSUS-SAME', 'IN', 'APPROVED', 'Dry Bulk', 'Census coastal', false, true, 5000, 6000,
          p10, 'CENSUS SAME PORT', 'E.MED', p4, p10, 'CENSUS UNVERIFIED', 'E.MED', current_date + 10, current_date + 20, false, 'FIOST', 1200, 1200);

  -- vessels: A and B open at p1 (A also FIXED there), B open at the unverified p4, C open at p1, D open at p5 (p5's
  -- single vessel cell), E with THREE open positions at p6 (one vessel), F open at p10, and C/D/E each also open at p9
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL A', '9' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2015, 'Malta', true, true, false, false) returning id into vessel_a;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL B', '8' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2016, 'Malta', true, true, false, false) returning id into vessel_b;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL C', '7' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2017, 'Malta', true, true, false, false) returning id into vessel_c;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL D', '6' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2018, 'Malta', true, true, false, false) returning id into vessel_d;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL E', '5' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2019, 'Malta', true, true, false, false) returning id into vessel_e;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL F', '4' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2020, 'Malta', true, true, false, false) returning id into vessel_f;
  insert into public.vessel_availability (vessel_id, open_port_locode, open_port_name, open_zone, open_date, status, review_status, service_speed_kn, accepts_part_cargo) values
    (vessel_a, p1, 'CENSUS LOAD', 'E.MED', current_date + 5, 'OPEN', 'APPROVED', 12, false),
    (vessel_b, p1, 'CENSUS LOAD', 'E.MED', current_date + 6, 'OPEN', 'APPROVED', 12, false),
    (vessel_a, p1, 'CENSUS LOAD', 'E.MED', current_date + 7, 'FIXED', 'APPROVED', 12, false),
    (vessel_b, p4, 'CENSUS UNVERIFIED', 'E.MED', current_date + 8, 'OPEN', 'APPROVED', 12, false),
    (vessel_c, p1, 'CENSUS LOAD', 'E.MED', current_date + 9, 'OPEN', 'APPROVED', 12, false),
    (vessel_d, p5, 'CENSUS SUBCELL', 'E.MED', current_date + 9, 'OPEN', 'APPROVED', 12, false),
    (vessel_e, p6, 'CENSUS ONE VESSEL', 'E.MED', current_date + 9, 'OPEN', 'APPROVED', 12, false),
    (vessel_e, p6, 'CENSUS ONE VESSEL', 'E.MED', current_date + 12, 'OPEN', 'APPROVED', 12, false),
    (vessel_e, p6, 'CENSUS ONE VESSEL', 'E.MED', current_date + 15, 'OPEN', 'APPROVED', 12, false),
    (vessel_f, p10, 'CENSUS SAME PORT', 'E.MED', current_date + 9, 'OPEN', 'APPROVED', 12, false),
    (vessel_c, p9, 'CENSUS SMALL LOADS', 'E.MED', current_date + 20, 'OPEN', 'APPROVED', 12, false),
    (vessel_d, p9, 'CENSUS SMALL LOADS', 'E.MED', current_date + 20, 'OPEN', 'APPROVED', 12, false),
    (vessel_e, p9, 'CENSUS SMALL LOADS', 'E.MED', current_date + 20, 'OPEN', 'APPROVED', 12, false);

  -- C5 · gates
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin perform public.get_port_touch_census(); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_AUTH' then raise exception 'C5: signed out must be PDA_AUTH, got %', e; end if;
  perform set_config('request.jwt.claim.sub', basic::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',basic,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  begin perform public.get_port_touch_census(); e := null; exception when others then e := split_part(sqlerrm, ':', 1); end;
  if e is distinct from 'PDA_TIER' then raise exception 'C5: a T2 member must be PDA_TIER, got %', e; end if;

  perform set_config('request.jwt.claim.sub', member::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',member,'app_metadata',jsonb_build_object('role','cargo_owner'))::text, true);
  census := public.get_port_touch_census();
  select x into row1 from jsonb_array_elements(census->'ports') x where x->>'locode' = p1;
  select x into row2 from jsonb_array_elements(census->'ports') x where x->>'locode' = p2;
  select x into row3 from jsonb_array_elements(census->'ports') x where x->>'locode' = p3;
  select x into row5 from jsonb_array_elements(census->'ports') x where x->>'locode' = p5;
  select x into row6 from jsonb_array_elements(census->'ports') x where x->>'locode' = p6;
  select x into row7 from jsonb_array_elements(census->'ports') x where x->>'locode' = p7;
  select x into row8 from jsonb_array_elements(census->'ports') x where x->>'locode' = p8;
  select x into row9 from jsonb_array_elements(census->'ports') x where x->>'locode' = p9;
  select x into row10 from jsonb_array_elements(census->'ports') x where x->>'locode' = p10;

  -- C1 · p1: 3 + 2 primary loads + 1 alternate load + 3 open vessels = 9; p2: 3 + 3 discharges
  if row1 is null or (row1->>'touches')::int is distinct from 9 or (row1->>'loads')::int is distinct from 6 or (row1->>'discharges')::int is distinct from 0 or (row1->>'vessels')::int is distinct from 3 or (row1->>'suppressed')::boolean then
    raise exception 'C1: p1 must count 6 loads (5 primary + 1 alternate slot) and 3 open vessels = 9: %', row1; end if;
  if row2 is null or (row2->>'touches')::int is distinct from 6 or (row2->>'discharges')::int is distinct from 6 or (row2->>'loads')::int is distinct from 0 or (row2->>'vessels')::int is distinct from 0 then
    raise exception 'C1: p2 must count 6 discharges: %', row2; end if;
  if (census->>'minimumCohort')::int is distinct from 3 or census->>'asOf' is distinct from current_date::text then raise exception 'C1: header: %', census - 'ports'; end if;
  if (select array_agg(x->>'locode' order by o) from jsonb_array_elements(census->'ports') with ordinality y(x, o) where x->>'locode' in (p1, p2))[1] is distinct from p1 then
    raise exception 'C1: the most touched port comes first'; end if;
  raise notice 'C1 ok: touches per port, once per listing and slot, loads/discharges/vessels apart, most touched first';

  -- C2 · p3 has exactly 1 live touch (the alternate cargo's primary load); OUT and PENDING do not count → suppressed
  if row3 is null or (row3->>'suppressed')::boolean is not true or row3->'touches' is distinct from 'null'::jsonb or row3->'loads' is distinct from 'null'::jsonb then
    raise exception 'C2: a port with 1–2 touches is suppressed with null counts: %', row3; end if;
  -- a port with zero touches (p8) is reported as 0 in every cell, not suppressed
  if row8 is null or (row8->>'suppressed')::boolean or (row8->>'touches')::int is distinct from 0 or (row8->>'loads')::int is distinct from 0 or (row8->>'discharges')::int is distinct from 0 or (row8->>'vessels')::int is distinct from 0 then
    raise exception 'C2: zero is reported as 0 in every cell, never suppressed: %', row8; end if;
  raise notice 'C2 ok: 1–2 touches are suppressed; 0 and ≥ 3 are reported';

  -- C3 · OUT / PENDING cargo and FIXED availability counted nothing (already proved by p1 = 6, p3 = 1); make it explicit
  if (row1->>'vessels')::int is distinct from 3 then raise exception 'C3: a FIXED availability must not count'; end if;
  raise notice 'C3 ok: only live, approved cargo and open, approved vessels count';

  -- C4 · the unverified port is absent although two live listings touch it
  if exists (select 1 from jsonb_array_elements(census->'ports') x where x->>'locode' = p4) then raise exception 'C4: an unverified port must not be listed'; end if;
  update public.ports set is_active = false where locode = p2;
  if exists (select 1 from jsonb_array_elements(public.get_port_touch_census()->'ports') x where x->>'locode' = p2) then raise exception 'C4: an inactive port must not be listed'; end if;
  raise notice 'C4 ok: inactive and unverified ports are never listed';

  -- C5 · grants and no internal id
  if has_function_privilege('anon', 'public.get_port_touch_census()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_port_touch_census()', 'execute')
     or not has_function_privilege('service_role', 'public.get_port_touch_census()', 'execute') then
    raise exception 'C5: grants must be authenticated + service_role only'; end if;
  if census::text ~ '"[A-Za-z]*[iI]d"\s*:' or position(vessel_a::text in census::text) > 0 or position(member::text in census::text) > 0 then
    raise exception 'C5: an internal id is exposed'; end if;
  -- anon, as a role: EXECUTE is refused by the grant itself, before the function's own PDA_AUTH gate can answer
  begin
    set local role anon;
    perform public.get_port_touch_census();
    e := 'EXECUTED';
  exception when others then e := case when sqlerrm like 'permission denied for function%' then 'DENIED' else split_part(sqlerrm, ':', 1) end;
  end;
  reset role;
  if e is distinct from 'DENIED' then raise exception 'C5: anon must be refused EXECUTE by the grant, got %', e; end if;
  raise notice 'C5 ok: gated, granted to members and the service role only, no id';

  -- C6 · p5: 3 loads + 1 open vessel = 4 from 4 entities → the total is reported, every cell withheld (the vessel cell is 1)
  if row5 is null or (row5->>'suppressed')::boolean or (row5->>'touches')::int is distinct from 4
     or row5->'loads' is distinct from 'null'::jsonb or row5->'discharges' is distinct from 'null'::jsonb or row5->'vessels' is distinct from 'null'::jsonb then
    raise exception 'C6: a small breakdown cell must withhold every cell and keep the total: %', row5; end if;
  -- the same with a small LOADS cell: p9 has 2 loads + 3 open vessels = 5 from 5 entities → total 5, every cell withheld
  if row9 is null or (row9->>'suppressed')::boolean is distinct from false or (row9->>'touches')::int is distinct from 5
     or row9->'loads' is distinct from 'null'::jsonb or row9->'discharges' is distinct from 'null'::jsonb or row9->'vessels' is distinct from 'null'::jsonb then
    raise exception 'C6: a small loads cell must withhold every cell and keep the total: %', row9; end if;
  -- …and a port whose cells are all 0 or ≥ 3 keeps them (p2: 0 / 6 / 0; p1: 6 / 0 / 3)
  if row2->'loads' is distinct from '0'::jsonb or row2->'discharges' is distinct from '6'::jsonb or row2->'vessels' is distinct from '0'::jsonb
     or row1->'loads' is distinct from '6'::jsonb or row1->'discharges' is distinct from '0'::jsonb or row1->'vessels' is distinct from '3'::jsonb then
    raise exception 'C6: zero and ≥ 3 cells are reported: % / %', row2, row1; end if;
  raise notice 'C6 ok: a breakdown cell of 1–2 (vessels or loads) withholds every cell; the total stays; 0 and ≥ 3 cells are shown';

  -- C7 · p6: one vessel, three open positions → one entity → suppressed (never "3 vessels")
  if row6 is null or (row6->>'suppressed')::boolean is not true or row6->'touches' is distinct from 'null'::jsonb or row6->'vessels' is distinct from 'null'::jsonb then
    raise exception 'C7: one vessel with three open positions is one entity and is suppressed: %', row6; end if;
  -- p10: one listing touches it twice (load + alternate discharge) and one vessel opens there: 3 touches, 2 entities → suppressed
  if row10 is null or (row10->>'suppressed')::boolean is distinct from true or row10->'touches' is distinct from 'null'::jsonb
     or row10->'loads' is distinct from 'null'::jsonb or row10->'discharges' is distinct from 'null'::jsonb or row10->'vessels' is distinct from 'null'::jsonb then
    raise exception 'C7: one listing loading and discharging at the port plus one vessel is two entities and is suppressed: %', row10; end if;
  raise notice 'C7 ok: the cohort counts distinct vessels and distinct listings, never rows or touches';

  -- C8 · p3 (1 touch) and p7 (2 touches) are both suppressed: p3 precedes p7 by NAME; neither precedes a reported port
  select o into o3 from jsonb_array_elements(census->'ports') with ordinality y(x, o) where x->>'locode' = p3;
  select o into o7 from jsonb_array_elements(census->'ports') with ordinality y(x, o) where x->>'locode' = p7;
  if o3 is null or o7 is null or o3 > o7 then raise exception 'C8: suppressed ports must be ordered by name (p3 % before p7 %), never by the hidden count', o3, o7; end if;
  if exists (select 1 from jsonb_array_elements(census->'ports') with ordinality a(x, o)
             join jsonb_array_elements(census->'ports') with ordinality b(y, q) on a.o < b.q
             where (a.x->>'suppressed')::boolean and (b.y->>'touches')::int > 0) then
    raise exception 'C8: a suppressed port must never precede a port with a reported count'; end if;
  raise notice 'C8 ok: suppressed ports sort by name among the untouched ones, after every reported port';
end $$;

do $m$ begin raise notice 'PDA PORT TOUCH CENSUS: ALL ASSERTIONS PASSED'; end $m$;
rollback;
