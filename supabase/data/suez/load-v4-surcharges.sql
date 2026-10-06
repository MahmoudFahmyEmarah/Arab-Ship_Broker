-- Stream S · governed tariff v4 = v3 (official SCA base bands + accompanying charges) + the temporary SCA
-- category surcharges in force since 15 Jul 2026, loaded through the 205400 admin RPCs (same path as the
-- admin console; every step writes its event with the actor). Local shared stack only, run as postgres:
--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v actor=<public.users.id> -1 -f - < supabase/data/suez/load-v4-surcharges.sql
-- Every surcharge is `reported`: the SCA periodicals themselves are not on file yet (brief:
-- supabase/data/suez/sca-tolls-2026-brief.md §2), so the calculator prices them, labels them, and stays partial
-- until the owner files the instruments and a v5 marks them official.
\set ON_ERROR_STOP on
select set_config('asb.actor_user_id', :'actor', true);

select id as v3 from public.suez_tariff_versions where version_no = 3 and status = 'published' \gset

-- 1 · the instruments, registered as pending documents (no SHA-256 until the PDFs are on file)
select public.admin_suez_register_source(:'actor'::uuid, jsonb_build_object(
  'title', 'SCA Periodical 18/2026 — temporary surcharge on dry bulk transit dues (amending Circular 3/2022), from 15 Jul 2026',
  'issuer', 'Suez Canal Authority', 'documentNo', 'Periodical 18/2026', 'effectiveFrom', '2026-07-15',
  'authority', 'official', 'evidenceStatus', 'pending_document',
  'notes', 'Dry bulk 10 % → 22 %. SCA page title confirmed; text not yet retrieved.'), null) as src_dry \gset
select public.admin_suez_register_source(:'actor'::uuid, jsonb_build_object(
  'title', 'SCA Periodical 16/2026 — tanker surcharges (amending Circular 1/2022), from 15 Jul 2026',
  'issuer', 'Suez Canal Authority', 'documentNo', 'Periodical 16/2026', 'effectiveFrom', '2026-07-15',
  'authority', 'official', 'evidenceStatus', 'pending_document',
  'notes', 'Crude laden 25 → 37 %, ballast 15 → 27 % (transcribed by Sealagom).'), null) as src_tank \gset
select public.admin_suez_register_source(:'actor'::uuid, jsonb_build_object(
  'title', 'Industry relays of the 15 Jul 2026 SCA surcharge schedule (meobserver, Splash, Leth, ISS, KADMAR)',
  'issuer', 'Agents and press', 'effectiveFrom', '2026-07-15', 'authority', 'agent', 'evidenceStatus', 'pending_document',
  'notes', 'Products 37/27, LPG 32, chemical 32, LNG 19, general cargo/heavy lift 26, vehicle carriers NB 26 / SB 12, ro-ro 26, containers 12 (Circular 2/2026), passenger exempt.'), null) as src_relay \gset

-- 2 · draft v4 copied from v3, surcharge regime modelled
select (public.admin_suez_create_version(:'actor'::uuid, jsonb_build_object(
  'effectiveFrom', '2026-10-05', 'surchargeRegime', 'modelled',
  'sourceRef', 'v3 (SCA base schedule 15 Jan 2024 + accompanying charges) + SCA temporary category surcharges from 15 Jul 2026 (Periodicals 16/2026, 18/2026, Circular 2/2026; reported)',
  'sourceUrl', 'https://www.suezcanal.gov.eg/Arabic/Navigation/NavigationCirculars/Documents/english72023.pdf',
  'notes', 'v4 = v3 + category surcharges. All surcharge rates are reported (instruments not yet on file): every toll stays partial until they are filed. floating_unit and other carry no surcharge information (toll partial).'),
  :'v3'::uuid) ->> 'id') as v4 \gset
select public.admin_suez_cite_source(:'v4'::uuid, :'actor'::uuid, :'src_dry'::uuid, true);
select public.admin_suez_cite_source(:'v4'::uuid, :'actor'::uuid, :'src_tank'::uuid, true);
select public.admin_suez_cite_source(:'v4'::uuid, :'actor'::uuid, :'src_relay'::uuid, true);

-- 3 · the surcharge items (pct of the toll, scoped by category, laden/ballast and direction)
select public.admin_suez_save_item(:'v4'::uuid, :'actor'::uuid, null, s.item)
  from (values
    ('{"code":"surcharge_dry_bulk","labelEn":"Dry bulk temporary surcharge (Periodical 18/2026)","categoryScope":["dry_bulk"],"params":{"pct":22}}'),
    ('{"code":"surcharge_crude_laden","labelEn":"Crude tanker laden surcharge (Periodical 16/2026)","categoryScope":["tanker_crude"],"cargoStatusScope":"laden","params":{"pct":37}}'),
    ('{"code":"surcharge_crude_ballast","labelEn":"Crude tanker ballast surcharge (Periodical 16/2026)","categoryScope":["tanker_crude"],"cargoStatusScope":"ballast","params":{"pct":27}}'),
    ('{"code":"surcharge_product_laden","labelEn":"Product tanker laden surcharge","categoryScope":["tanker_product"],"cargoStatusScope":"laden","params":{"pct":37}}'),
    ('{"code":"surcharge_product_ballast","labelEn":"Product tanker ballast surcharge","categoryScope":["tanker_product"],"cargoStatusScope":"ballast","params":{"pct":27}}'),
    ('{"code":"surcharge_gas_chemical","labelEn":"LPG and chemical tanker surcharge","categoryScope":["lpg","chemical_tanker"],"params":{"pct":32}}'),
    ('{"code":"surcharge_lng","labelEn":"LNG carrier surcharge","categoryScope":["lng"],"params":{"pct":19}}'),
    ('{"code":"surcharge_general_roro","labelEn":"General cargo, heavy lift and ro-ro surcharge","categoryScope":["general_cargo","roro"],"params":{"pct":26}}'),
    ('{"code":"surcharge_vehicle_nb","labelEn":"Vehicle carrier surcharge (northbound)","categoryScope":["car_carrier"],"directionScope":"NB","params":{"pct":26}}'),
    ('{"code":"surcharge_vehicle_sb","labelEn":"Vehicle carrier surcharge (southbound)","categoryScope":["car_carrier"],"directionScope":"SB","params":{"pct":12}}'),
    ('{"code":"surcharge_container","labelEn":"Container ship surcharge (Circular 2/2026)","categoryScope":["container"],"params":{"pct":12}}'),
    ('{"code":"surcharge_passenger","labelEn":"Passenger / cruise — exempt","categoryScope":["passenger"],"params":{"pct":0}}')
  ) as v(j),
  lateral (select (v.j::jsonb || '{"layer":"surcharge","basis":"pct_of_toll","currency":"SDR","confidence":"reported","payerParty":"owner","sortOrder":15}'::jsonb) as item) s;

-- 4 · v3 is superseded the same day (same effective date: v4 replaces it), then v4 is published
select public.admin_suez_set_status(:'v3'::uuid, :'actor'::uuid, 'superseded');
select public.admin_suez_publish(:'v4'::uuid, :'actor'::uuid, 'PUBLISH');

select 'v4 in force: ' || (c -> 'version' ->> 'versionNo') || ' regime=' || (c -> 'version' ->> 'surchargeRegime')
       || ' surcharges=' || (select count(*) from jsonb_array_elements(c -> 'items') i where i ->> 'layer' = 'surcharge')
       || ' bands=' || jsonb_array_length(c -> 'tiers') || ' sources=' || jsonb_array_length(c -> 'sources')
  from public.get_suez_tariff_context('2026-10-05') c;
