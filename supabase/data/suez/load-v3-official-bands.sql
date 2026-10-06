-- Stream S · governed load of the official SCA base tolls + IMF SDR rate as tariff v3 (local stack, 5 Oct 2026).
-- Mirrors the admin server actions step by step (same tables, same RPCs, same events); the actor is the
-- owner's public.users.id passed as :actor. Run as postgres inside one transaction.
\set ON_ERROR_STOP on
begin;
select set_config('asb.actor_user_id', :'actor', true);

-- 1 · source record (admin "Register a source record") + event
insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256, source_filename, source_uri, notes, registered_by)
values ('SCA "Transit Dues Rates" Schedules applicable from the 15th of January 2024', 'Suez Canal Authority', 'english72023.pdf', date '2023-10-17', date '2024-01-15', 'official', 'on_file',
        '1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f', 'SCA-Transit-Dues-Rates-Schedules-from-15-Jan-2024 (english72023.pdf).pdf',
        'https://www.suezcanal.gov.eg/Arabic/Navigation/NavigationCirculars/Documents/english72023.pdf',
        'Base transit dues, 13 categories, SDR/SCNT cumulative bands (5k/5k/10k/20k/30k/50k/rest; containerships +60k). Base unchanged since 2024 per SCA July 2026 circulars. Temporary surcharges (15 Jul 2026) are NOT in these bands.', :'actor'::uuid)
returning id \gset src_
insert into public.suez_tariff_events (entity, entity_id, action, actor_user_id, details)
values ('source', :'src_id'::uuid, 'registered', :'actor'::uuid, jsonb_build_object('title', 'SCA Transit Dues Rates Schedules from 15 Jan 2024', 'issuer', 'Suez Canal Authority', 'documentNo', 'english72023.pdf', 'evidenceStatus', 'on_file', 'sha256', '1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f'));

-- 2 · draft v3 copied from v2 (admin "New draft version")
select id as v2 from public.suez_tariff_versions where version_no = 2 and status = 'published' \gset
insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref, source_url, notes, created_by)
values (3, 'draft', date '2026-10-05', null,
        'SCA Transit Dues Rates Schedules applicable from 15 Jan 2024 (base tolls, official) + SCA Circular 1/2026 / Periodical 2/2026 / Clarksons guide (accompanying charges, carried from v2)',
        'https://www.suezcanal.gov.eg/Arabic/Navigation/NavigationCirculars/Documents/english72023.pdf',
        'v3 = v2 accompanying/conditional/waste layers + the official SCA base toll bands + IMF SDR rate. Temporary surcharges in force since 15 Jul 2026 (dry bulk 22 %, tankers 37/27 %, containers 12 % …) are not modelled in this version.', :'actor'::uuid)
returning id \gset v3_
\set v3 :v3_id
insert into public.suez_tariff_items (version_id, code, label_en, label_ar, layer, basis, currency, params, direction_scope, cargo_status_scope, condition_key, payer_party, sort_order, is_active, notes)
select :'v3'::uuid, code, label_en, label_ar, layer, basis, currency, params, direction_scope, cargo_status_scope, condition_key, payer_party, sort_order, is_active, notes
  from public.suez_tariff_items where version_id = :'v2'::uuid;
insert into public.suez_tariff_version_sources (version_id, source_id)
select :'v3'::uuid, source_id from public.suez_tariff_version_sources where version_id = :'v2'::uuid;
insert into public.suez_tariff_version_sources (version_id, source_id) values (:'v3'::uuid, :'src_id'::uuid);
insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
values ('version', :'v3'::uuid, :'v3'::uuid, 'copied_from', :'actor'::uuid, jsonb_build_object('fromVersionId', :'v2'::uuid, 'items', (select count(*) from public.suez_tariff_items where version_id = :'v3'::uuid), 'tiers', 0, 'sources', (select count(*) from public.suez_tariff_version_sources where version_id = :'v3'::uuid)));
insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
values ('version', :'v3'::uuid, :'v3'::uuid, 'source_cited', :'actor'::uuid, jsonb_build_object('sourceId', :'src_id'::uuid, 'title', 'SCA Transit Dues Rates Schedules from 15 Jan 2024'));

-- 3 · toll bands (admin "Replace all bands (CSV)"), confidence official
delete from public.suez_toll_tiers where version_id = :'v3'::uuid;
insert into public.suez_toll_tiers (version_id, vessel_category, cargo_status, tier_order, scnt_from, scnt_to, sdr_per_scnt, confidence) values
(:'v3'::uuid, 'tanker_crude', 'laden', 0, 0, 5000, 11.0400, 'official'),
(:'v3'::uuid, 'tanker_crude', 'laden', 1, 5000, 10000, 7.8200, 'official'),
(:'v3'::uuid, 'tanker_crude', 'laden', 2, 10000, 20000, 5.9100, 'official'),
(:'v3'::uuid, 'tanker_crude', 'laden', 3, 20000, 40000, 2.9300, 'official'),
(:'v3'::uuid, 'tanker_crude', 'laden', 4, 40000, 70000, 2.5300, 'official'),
(:'v3'::uuid, 'tanker_crude', 'laden', 5, 70000, 120000, 2.1700, 'official'),
(:'v3'::uuid, 'tanker_crude', 'laden', 6, 120000, null, 2.1300, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 0, 0, 5000, 9.4000, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 1, 5000, 10000, 6.6400, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 2, 10000, 20000, 5.0400, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 3, 20000, 40000, 2.5000, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 4, 40000, 70000, 2.1400, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 5, 70000, 120000, 1.8500, 'official'),
(:'v3'::uuid, 'tanker_crude', 'ballast', 6, 120000, null, 1.8200, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 0, 0, 5000, 11.0400, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 1, 5000, 10000, 7.8200, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 2, 10000, 20000, 5.9100, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 3, 20000, 40000, 3.9300, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 4, 40000, 70000, 3.8400, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 5, 70000, 120000, 3.4600, 'official'),
(:'v3'::uuid, 'tanker_product', 'laden', 6, 120000, null, 3.3400, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 0, 0, 5000, 9.4000, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 1, 5000, 10000, 6.6400, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 2, 10000, 20000, 5.0400, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 3, 20000, 40000, 2.5000, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 4, 40000, 70000, 2.1400, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 5, 70000, 120000, 1.8500, 'official'),
(:'v3'::uuid, 'tanker_product', 'ballast', 6, 120000, null, 1.8200, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 0, 0, 5000, 10.1300, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 1, 5000, 10000, 7.7400, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 2, 10000, 20000, 6.1200, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 3, 20000, 40000, 2.2400, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 4, 40000, 70000, 1.9700, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 5, 70000, 120000, 1.8500, 'official'),
(:'v3'::uuid, 'dry_bulk', 'laden', 6, 120000, null, 1.7700, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 0, 0, 5000, 8.6200, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 1, 5000, 10000, 6.5800, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 2, 10000, 20000, 5.2100, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 3, 20000, 40000, 1.8900, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 4, 40000, 70000, 1.6800, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 5, 70000, 120000, 1.5800, 'official'),
(:'v3'::uuid, 'dry_bulk', 'ballast', 6, 120000, null, 1.5000, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 0, 0, 5000, 11.6000, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 1, 5000, 10000, 8.4000, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 2, 10000, 20000, 6.2200, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 3, 20000, 40000, 5.0500, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 4, 40000, 70000, 4.4200, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 5, 70000, 120000, 4.1300, 'official'),
(:'v3'::uuid, 'lpg', 'laden', 6, 120000, null, 4.1300, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 0, 0, 5000, 9.8700, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 1, 5000, 10000, 7.1400, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 2, 10000, 20000, 5.2900, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 3, 20000, 40000, 4.3000, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 4, 40000, 70000, 3.7600, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 5, 70000, 120000, 3.5100, 'official'),
(:'v3'::uuid, 'lpg', 'ballast', 6, 120000, null, 3.5100, 'official'),
(:'v3'::uuid, 'lng', 'laden', 0, 0, 5000, 10.4200, 'official'),
(:'v3'::uuid, 'lng', 'laden', 1, 5000, 10000, 8.1100, 'official'),
(:'v3'::uuid, 'lng', 'laden', 2, 10000, 20000, 7.0200, 'official'),
(:'v3'::uuid, 'lng', 'laden', 3, 20000, 40000, 5.4300, 'official'),
(:'v3'::uuid, 'lng', 'laden', 4, 40000, 70000, 5.0300, 'official'),
(:'v3'::uuid, 'lng', 'laden', 5, 70000, 120000, 4.8000, 'official'),
(:'v3'::uuid, 'lng', 'laden', 6, 120000, null, 4.6700, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 0, 0, 5000, 8.8700, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 1, 5000, 10000, 6.8900, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 2, 10000, 20000, 5.9700, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 3, 20000, 40000, 4.6100, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 4, 40000, 70000, 4.2700, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 5, 70000, 120000, 4.0800, 'official'),
(:'v3'::uuid, 'lng', 'ballast', 6, 120000, null, 3.9700, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 0, 0, 5000, 11.5500, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 1, 5000, 10000, 8.9200, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 2, 10000, 20000, 7.1200, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 3, 20000, 40000, 5.1900, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 4, 40000, 70000, 4.6300, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 5, 70000, 120000, 4.3500, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'laden', 6, 120000, null, 4.2700, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 0, 0, 5000, 9.8100, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 1, 5000, 10000, 7.5800, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 2, 10000, 20000, 6.0600, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 3, 20000, 40000, 4.4200, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 4, 40000, 70000, 3.9400, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 5, 70000, 120000, 3.7000, 'official'),
(:'v3'::uuid, 'chemical_tanker', 'ballast', 6, 120000, null, 3.6300, 'official'),
(:'v3'::uuid, 'container', 'laden', 0, 0, 5000, 11.0400, 'official'),
(:'v3'::uuid, 'container', 'laden', 1, 5000, 10000, 7.5800, 'official'),
(:'v3'::uuid, 'container', 'laden', 2, 10000, 20000, 5.8900, 'official'),
(:'v3'::uuid, 'container', 'laden', 3, 20000, 40000, 4.1300, 'official'),
(:'v3'::uuid, 'container', 'laden', 4, 40000, 70000, 3.8200, 'official'),
(:'v3'::uuid, 'container', 'laden', 5, 70000, 120000, 3.0100, 'official'),
(:'v3'::uuid, 'container', 'laden', 6, 120000, 180000, 2.9400, 'official'),
(:'v3'::uuid, 'container', 'laden', 7, 180000, null, 2.8800, 'official'),
(:'v3'::uuid, 'container', 'ballast', 0, 0, 5000, 9.4000, 'official'),
(:'v3'::uuid, 'container', 'ballast', 1, 5000, 10000, 6.4500, 'official'),
(:'v3'::uuid, 'container', 'ballast', 2, 10000, 20000, 5.0000, 'official'),
(:'v3'::uuid, 'container', 'ballast', 3, 20000, 40000, 3.5100, 'official'),
(:'v3'::uuid, 'container', 'ballast', 4, 40000, 70000, 3.2500, 'official'),
(:'v3'::uuid, 'container', 'ballast', 5, 70000, 120000, 2.5600, 'official'),
(:'v3'::uuid, 'container', 'ballast', 6, 120000, 180000, 2.5200, 'official'),
(:'v3'::uuid, 'container', 'ballast', 7, 180000, null, 2.4400, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 0, 0, 5000, 10.0800, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 1, 5000, 10000, 7.7800, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 2, 10000, 20000, 5.4200, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 3, 20000, 40000, 4.0700, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 4, 40000, 70000, 3.9400, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 5, 70000, 120000, 3.8700, 'official'),
(:'v3'::uuid, 'general_cargo', 'laden', 6, 120000, null, 3.8000, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 0, 0, 5000, 8.5800, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 1, 5000, 10000, 6.6200, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 2, 10000, 20000, 4.6100, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 3, 20000, 40000, 3.4500, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 4, 40000, 70000, 3.3600, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 5, 70000, 120000, 3.3000, 'official'),
(:'v3'::uuid, 'general_cargo', 'ballast', 6, 120000, null, 3.2200, 'official'),
(:'v3'::uuid, 'roro', 'laden', 0, 0, 5000, 10.0800, 'official'),
(:'v3'::uuid, 'roro', 'laden', 1, 5000, 10000, 7.5000, 'official'),
(:'v3'::uuid, 'roro', 'laden', 2, 10000, 20000, 5.8300, 'official'),
(:'v3'::uuid, 'roro', 'laden', 3, 20000, 40000, 4.2100, 'official'),
(:'v3'::uuid, 'roro', 'laden', 4, 40000, 70000, 3.9400, 'official'),
(:'v3'::uuid, 'roro', 'laden', 5, 70000, 120000, 3.8000, 'official'),
(:'v3'::uuid, 'roro', 'laden', 6, 120000, null, 3.6500, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 0, 0, 5000, 8.5800, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 1, 5000, 10000, 6.3700, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 2, 10000, 20000, 4.9700, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 3, 20000, 40000, 3.5900, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 4, 40000, 70000, 3.3600, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 5, 70000, 120000, 3.2200, 'official'),
(:'v3'::uuid, 'roro', 'ballast', 6, 120000, null, 3.1200, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 0, 0, 5000, 11.0400, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 1, 5000, 10000, 7.5800, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 2, 10000, 20000, 5.6700, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 3, 20000, 40000, 4.0500, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 4, 40000, 70000, 3.8200, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 5, 70000, 120000, 3.0100, 'official'),
(:'v3'::uuid, 'car_carrier', 'laden', 6, 120000, null, 2.8800, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 0, 0, 5000, 9.4000, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 1, 5000, 10000, 6.4500, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 2, 10000, 20000, 4.8300, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 3, 20000, 40000, 3.4500, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 4, 40000, 70000, 3.2500, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 5, 70000, 120000, 2.5600, 'official'),
(:'v3'::uuid, 'car_carrier', 'ballast', 6, 120000, null, 2.4400, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 0, 0, 5000, 9.9700, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 1, 5000, 10000, 7.0000, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 2, 10000, 20000, 5.7700, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 3, 20000, 40000, 4.0800, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 4, 40000, 70000, 4.0300, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 5, 70000, 120000, 3.9000, 'official'),
(:'v3'::uuid, 'passenger', 'laden', 6, 120000, null, 3.7600, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 0, 0, 5000, 8.4800, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 1, 5000, 10000, 5.9600, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 2, 10000, 20000, 4.9100, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 3, 20000, 40000, 3.4800, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 4, 40000, 70000, 3.4200, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 5, 70000, 120000, 3.3100, 'official'),
(:'v3'::uuid, 'passenger', 'ballast', 6, 120000, null, 3.1900, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 0, 0, 5000, 11.9800, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 1, 5000, 10000, 7.9400, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 2, 10000, 20000, 7.1400, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 3, 20000, 40000, 5.0600, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 4, 40000, 70000, 4.7600, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 5, 70000, 120000, 4.3100, 'official'),
(:'v3'::uuid, 'floating_unit', 'laden', 6, 120000, null, 4.1600, 'official'),
(:'v3'::uuid, 'other', 'laden', 0, 0, 5000, 10.5400, 'official'),
(:'v3'::uuid, 'other', 'laden', 1, 5000, 10000, 7.1000, 'official'),
(:'v3'::uuid, 'other', 'laden', 2, 10000, 20000, 5.9700, 'official'),
(:'v3'::uuid, 'other', 'laden', 3, 20000, 40000, 4.3500, 'official'),
(:'v3'::uuid, 'other', 'laden', 4, 40000, 70000, 4.2100, 'official'),
(:'v3'::uuid, 'other', 'laden', 5, 70000, 120000, 3.9400, 'official'),
(:'v3'::uuid, 'other', 'laden', 6, 120000, null, 3.8000, 'official'),
(:'v3'::uuid, 'other', 'ballast', 0, 0, 5000, 8.9600, 'official'),
(:'v3'::uuid, 'other', 'ballast', 1, 5000, 10000, 6.0400, 'official'),
(:'v3'::uuid, 'other', 'ballast', 2, 10000, 20000, 5.0800, 'official'),
(:'v3'::uuid, 'other', 'ballast', 3, 20000, 40000, 3.7000, 'official'),
(:'v3'::uuid, 'other', 'ballast', 4, 40000, 70000, 3.5900, 'official'),
(:'v3'::uuid, 'other', 'ballast', 5, 70000, 120000, 3.3600, 'official'),
(:'v3'::uuid, 'other', 'ballast', 6, 120000, null, 3.2200, 'official');
insert into public.suez_tariff_events (entity, version_id, action, actor_user_id, details)
values ('tier', :'v3'::uuid, 'replaced', :'actor'::uuid, jsonb_build_object('bands', 177, 'categories', 13, 'confidence', 'official', 'source', 'SCA schedule from 15 Jan 2024'));

-- 4 · SDR rate (admin "Record a rate"; the insert trigger writes the event)
insert into public.sdr_rates (rate_usd, as_of, source, notes, created_by)
values (1.354080, date '2026-10-02', 'IMF', 'IMF representative rate, "currency units per SDR" (rms_five), 2 Oct 2026', :'actor'::uuid);

-- 5 · publish: close v2 the day before, then publish v3 (trigger validates params + bands)
select public.admin_suez_set_window(:'v2'::uuid, :'actor'::uuid, date '2026-10-04', null);
select public.admin_suez_set_status(:'v3'::uuid, :'actor'::uuid, 'published');

-- 6 · what the member context now returns for today
select (c ->> 'found') as found, (c -> 'version' ->> 'versionNo') as version_no, jsonb_array_length(c -> 'tiers') as tiers, (c -> 'sdr' ->> 'rateUsd') as sdr, jsonb_array_length(c -> 'sources') as sources, c ->> 'algorithmVersion' as algo
  from public.get_suez_tariff_context(current_date) as c;
commit;
