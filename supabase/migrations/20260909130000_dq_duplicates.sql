-- Data quality — possible duplicate records (owner, 9 Sep 2026): the same
-- cargo or vessel arriving from the workbook, the circulars inbox and WhatsApp
-- under different keys. Audit-only rules that match on three or four
-- parameters so an admin can merge or ignore from the Issues view.

select public.fn_dq_seed_rule(
  'DQ-U03', 'Possible duplicate cargo (same commodity · load port · laycan ± 3 d · quantity ± 10 %)', 'uniqueness', 'warn', 'declarative', 'suggest only', 'admin',
  'Two live listings that name the same commodity and load port, with laycans within three days and quantities within ten percent, are usually one order circulated twice (workbook + circular, or two brokers). Review the pair: keep one, close the other, or mark false positive when they are genuinely separate stems.',
  'cross-row: same commodity + same load port + |laycan_from| ≤ 3 d + |qty_max| ≤ 10 % + different REF',
  jsonb_build_array(jsonb_build_object('table', 'cargo_listings', 'field', 'ref',
    'violation_sql', $$r.status in ('IN','PARTIAL') and exists (
        select 1 from public.cargo_listings o
        where o.id <> r.id and o.status in ('IN','PARTIAL')
          and (o.commodity_id = r.commodity_id or lower(btrim(o.commodity_name)) = lower(btrim(r.commodity_name)))
          and coalesce(o.load_port_locode, lower(btrim(o.load_port_name))) = coalesce(r.load_port_locode, lower(btrim(r.load_port_name)))
          and (r.laycan_from is null or o.laycan_from is null or abs(o.laycan_from - r.laycan_from) <= 3)
          and (r.qty_max_mt is null or o.qty_max_mt is null or abs(o.qty_max_mt - r.qty_max_mt) <= 0.10 * greatest(o.qty_max_mt, r.qty_max_mt))
          and o.id::text < r.id::text)$$,
    'observed_sql', $$(select string_agg(coalesce(o.ref, left(o.id::text, 8)) || ' (' || coalesce(o.broker, o.source_company, 'no source') || ')', ', ')
        from public.cargo_listings o
        where o.id <> r.id and o.status in ('IN','PARTIAL')
          and (o.commodity_id = r.commodity_id or lower(btrim(o.commodity_name)) = lower(btrim(r.commodity_name)))
          and coalesce(o.load_port_locode, lower(btrim(o.load_port_name))) = coalesce(r.load_port_locode, lower(btrim(r.load_port_name)))
          and (r.laycan_from is null or o.laycan_from is null or abs(o.laycan_from - r.laycan_from) <= 3)
          and (r.qty_max_mt is null or o.qty_max_mt is null or abs(o.qty_max_mt - r.qty_max_mt) <= 0.10 * greatest(o.qty_max_mt, r.qty_max_mt))
          and o.id::text < r.id::text)$$,
    'expected_text', 'one listing per order — close the duplicate or mark false positive')));

select public.fn_dq_seed_rule(
  'DQ-U04', 'Possible duplicate vessel (same name · built · DWT ± 2 %)', 'uniqueness', 'warn', 'declarative', 'suggest only', 'admin',
  'Two register rows with the same name, the same build year and a DWT within two percent are usually one ship entered twice (once without IMO from a circular, once with IMO from the workbook). Merge them in Vessel intel or mark false positive for sister ships.',
  'cross-row: same vessel_name + build_year + |dwt_grain| ≤ 2 % + different id (or one side without IMO)',
  jsonb_build_array(jsonb_build_object('table', 'vessels', 'field', 'vessel_name',
    'violation_sql', $$r.vessel_name is not null and exists (
        select 1 from public.vessels o
        where o.id <> r.id
          and lower(regexp_replace(o.vessel_name, '^(m/?v|m/?t)\s+', '', 'i')) = lower(regexp_replace(r.vessel_name, '^(m/?v|m/?t)\s+', '', 'i'))
          and (o.build_year is null or r.build_year is null or o.build_year = r.build_year)
          and (o.dwt_grain is null or r.dwt_grain is null or abs(o.dwt_grain - r.dwt_grain) <= 0.02 * greatest(o.dwt_grain, r.dwt_grain))
          and (o.imo_number is null or r.imo_number is null or o.imo_number = r.imo_number)
          and o.id::text < r.id::text)$$,
    'observed_sql', $$(select string_agg(o.vessel_name || coalesce(' · IMO ' || o.imo_number, ' · no IMO') || coalesce(' · ' || o.dwt_grain::text || ' dwt', ''), ', ')
        from public.vessels o
        where o.id <> r.id
          and lower(regexp_replace(o.vessel_name, '^(m/?v|m/?t)\s+', '', 'i')) = lower(regexp_replace(r.vessel_name, '^(m/?v|m/?t)\s+', '', 'i'))
          and (o.build_year is null or r.build_year is null or o.build_year = r.build_year)
          and (o.dwt_grain is null or r.dwt_grain is null or abs(o.dwt_grain - r.dwt_grain) <= 0.02 * greatest(o.dwt_grain, r.dwt_grain))
          and (o.imo_number is null or r.imo_number is null or o.imo_number = r.imo_number)
          and o.id::text < r.id::text)$$,
    'expected_text', 'one register row per ship — merge in Vessel intel or mark false positive for sister ships')));
