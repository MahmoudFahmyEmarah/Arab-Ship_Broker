-- PDA · port touch census (20261019140000, design B2ALL-061 step 11). BEGIN … ROLLBACK; run as the database owner.
--   C1  a port is touched by each live cargo that loads or discharges there (effective port and alternate slots, once per
--       listing) and by each open vessel at it; loads, discharges and vessels are counted apart; most touched first
--   C2  the cohort rule: 1 or 2 touches are suppressed (counts null, suppressed true); 0 and ≥ 3 are reported
--   C3  only what the boards show counts: OUT, CLOSED, PENDING, REJECTED cargo and FIXED / PENDING availability do not
--   C4  an inactive or unverified port is not listed at all
--   C5  gates: signed out → PDA_AUTH; T2 → PDA_TIER; grants authenticated + service_role only; no internal id
begin;

do $$
declare
  member uuid := gen_random_uuid();
  basic uuid := gen_random_uuid();
  p1 text := 'XXC' || upper(substr(md5(random()::text), 1, 2));
  p2 text; p3 text; p4 text;
  vessel_a uuid; vessel_b uuid;
  census jsonb; row1 jsonb; row2 jsonb; row3 jsonb; e text;
begin
  p2 := 'XXD' || substr(p1, 4, 2); p3 := 'XXE' || substr(p1, 4, 2); p4 := 'XXF' || substr(p1, 4, 2);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaCensus1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (member, 'pda-census-member@example.test'), (basic, 'pda-census-basic@example.test')) as f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (member, member, 'pda-census-member@example.test', 'Census Member', 'cargo_owner', true, null, 'T3'),
    (basic, basic, 'pda-census-basic@example.test', 'Census Basic', 'cargo_owner', true, null, 'T2');

  -- four fresh ports: p1 and p2 verified, p3 verified (a small cohort), p4 unverified
  insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified) values
    (p1, 'CENSUS LOAD ' || p1, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p2, 'CENSUS DISCHARGE ' || p2, 'Saudi Arabia', 'R.SEA', 'Sea Port', true, true),
    (p3, 'CENSUS SMALL ' || p3, 'Egypt', 'E.MED', 'Sea Port', true, true),
    (p4, 'CENSUS UNVERIFIED ' || p4, 'Egypt', 'E.MED', 'Sea Port', true, false);

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

  -- two open vessels at p1, one FIXED at p1, one open at the unverified p4
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL A', '9' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2015, 'Malta', true, true, false, false) returning id into vessel_a;
  insert into public.vessels (vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, max_loa_m, build_year, flag, is_geared, grain_certified, dg_certified, is_sanctioned)
  values ('CENSUS VESSEL B', '8' || lpad((random() * 999999)::int::text, 6, '0'), 'Bulk Carrier', 35000, 22400, 18500, 182, 2016, 'Malta', true, true, false, false) returning id into vessel_b;
  insert into public.vessel_availability (vessel_id, open_port_locode, open_port_name, open_zone, open_date, status, review_status, service_speed_kn, accepts_part_cargo) values
    (vessel_a, p1, 'CENSUS LOAD', 'E.MED', current_date + 5, 'OPEN', 'APPROVED', 12, false),
    (vessel_b, p1, 'CENSUS LOAD', 'E.MED', current_date + 6, 'OPEN', 'APPROVED', 12, false),
    (vessel_a, p1, 'CENSUS LOAD', 'E.MED', current_date + 7, 'FIXED', 'APPROVED', 12, false),
    (vessel_b, p4, 'CENSUS UNVERIFIED', 'E.MED', current_date + 8, 'OPEN', 'APPROVED', 12, false);

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

  -- C1 · p1: 3 primary loads + 1 alternate load + 2 open vessels = 6; p2: 3 discharges
  if row1 is null or (row1->>'touches')::int <> 6 or (row1->>'loads')::int <> 4 or (row1->>'discharges')::int <> 0 or (row1->>'vessels')::int <> 2 or (row1->>'suppressed')::boolean then
    raise exception 'C1: p1 must count 4 loads (3 primary + 1 alternate slot) and 2 open vessels = 6: %', row1; end if;
  if row2 is null or (row2->>'touches')::int <> 3 or (row2->>'discharges')::int <> 3 or (row2->>'loads')::int <> 0 or (row2->>'vessels')::int <> 0 then
    raise exception 'C1: p2 must count 3 discharges: %', row2; end if;
  if (census->>'minimumCohort')::int <> 3 or census->>'asOf' <> current_date::text then raise exception 'C1: header: %', census - 'ports'; end if;
  if (select array_agg(x->>'locode' order by o) from jsonb_array_elements(census->'ports') with ordinality y(x, o) where x->>'locode' in (p1, p2))[1] <> p1 then
    raise exception 'C1: the most touched port comes first'; end if;
  raise notice 'C1 ok: touches per port, once per listing and slot, loads/discharges/vessels apart, most touched first';

  -- C2 · p3 has exactly 1 live touch (the alternate cargo's primary load); OUT and PENDING do not count → suppressed
  if row3 is null or (row3->>'suppressed')::boolean is not true or row3->'touches' <> 'null'::jsonb or row3->'loads' <> 'null'::jsonb then
    raise exception 'C2: a port with 1–2 touches is suppressed with null counts: %', row3; end if;
  -- a port with zero touches is reported as 0, not suppressed
  if exists (select 1 from jsonb_array_elements(census->'ports') x where (x->>'suppressed')::boolean and (x->>'touches')::int = 0) then
    raise exception 'C2: zero is reported, never suppressed'; end if;
  raise notice 'C2 ok: 1–2 touches are suppressed; 0 and ≥ 3 are reported';

  -- C3 · OUT / PENDING cargo and FIXED availability counted nothing (already proved by p1 = 6, p3 = 1); make it explicit
  if (row1->>'vessels')::int <> 2 then raise exception 'C3: a FIXED availability must not count'; end if;
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
  raise notice 'C5 ok: gated, granted to members and the service role only, no id';
end $$;

do $m$ begin raise notice 'PDA PORT TOUCH CENSUS: ALL ASSERTIONS PASSED'; end $m$;
rollback;
