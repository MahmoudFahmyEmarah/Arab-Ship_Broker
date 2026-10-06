-- Stream S · governed tariff v5 = v4 + escort-tug triggers + contingent charges, from the Clarksons southbound guide
-- (agent source on file, already cited since v2; owner ruling O2B-009 §5). Admin RPCs only; local shared stack only.
--   docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v actor=<public.users.id> -1 -f - < supabase/data/suez/load-v5-escort-contingent.sql
\set ON_ERROR_STOP on
select id as v4 from public.suez_tariff_versions where version_no = 4 and status = 'published' \gset

select (public.admin_suez_create_version(:'actor'::uuid, jsonb_build_object(
  'effectiveFrom', '2026-10-06', 'surchargeRegime', 'modelled',
  'sourceRef', 'v4 + escort-tug triggers and contingent charges per the Clarksons Southbound Suez Canal Transit Mini Guide (Rules of Navigation; agent source on file)',
  'notes', 'Escort tugs have no published rate: when the rules require them the canal total is incomplete (SCA invoice). Contingent charges are listed, never added.'),
  :'v4'::uuid) ->> 'id') as v5 \gset

select public.admin_suez_save_item(:'v5'::uuid, :'actor'::uuid, null, jsonb_build_object(
  'code', 'escort_tugs', 'labelEn', 'Escort tug(s) (Rules of Navigation, via agent guide §8)', 'layer', 'conditional', 'basis', 'flag_only',
  'currency', 'USD', 'conditionKey', 'escort_tugs', 'payerParty', 'owner', 'sortOrder', 205,
  'notes', 'Clarksons SB mini guide §8. Semi-submersibles, integrated units on first transit and technical cases are decided by SCA inspection.',
  'params', jsonb_build_object('rules', '[
    {"status":"laden","scntBelow":70000,"draftFtOver":47,"excludeCategories":["container"],"tugs":1},
    {"status":"laden","scntMin":70000,"scntBelow":90000,"excludeCategories":["container"],"tugs":1},
    {"status":"laden","scntMin":90000,"excludeCategories":["container"],"tugs":2},
    {"status":"ballast","scntMin":130000,"excludeCategories":["container"],"tugs":1},
    {"categories":["lpg","lng"],"scntMin":40000,"scntBelow":90000,"tugs":1},
    {"categories":["lpg","lng"],"scntMin":90000,"tugs":2},
    {"status":"ballast","beamFtOver":218,"beamFtMax":233,"excludeCategories":["container"],"tugs":1},
    {"status":"ballast","beamFtOver":233,"excludeCategories":["container"],"tugs":2},
    {"categories":["container"],"scntMin":170000,"tugs":2},
    {"status":"laden","categories":["tanker_crude","tanker_product","chemical_tanker","dry_bulk"],"scntBelow":70000,"doubleBottom":false,"tugs":1}
  ]'::jsonb)));

select public.admin_suez_save_item(:'v5'::uuid, :'actor'::uuid, null, c.item)
  from (values
    ('{"code":"cancel_booking_small","labelEn":"Booking cancellation, small ships (12 h)","params":{"amount":1000,"currency":"USD"},"notes":"booking cancelled within 12 hours (agent guide §26)","sortOrder":600}'),
    ('{"code":"cancel_booking_large","labelEn":"Booking cancellation, super tankers and gas carriers (12 h)","params":{"amount":3000,"currency":"USD"},"notes":"booking cancelled within 12 hours (agent guide §26)","sortOrder":601}'),
    ('{"code":"cancel_berth_port_said","labelEn":"Port Said berth booking cancellation (6 h)","params":{"amount":600,"currency":"USD"},"notes":"berth booking cancelled within 6 hours (agent guide §26)","sortOrder":602}'),
    ('{"code":"wrong_cargo_declaration","labelEn":"Erroneous cargo declaration","params":{},"notes":"a fine of twice the toll difference (agent guide §26)","sortOrder":603}')
  ) as v(j),
  lateral (select v.j::jsonb || '{"layer":"conditional","basis":"flag_only","currency":"USD","conditionKey":"contingent","payerParty":"owner"}'::jsonb as item) c;

select public.admin_suez_publish(:'v5'::uuid, :'actor'::uuid, 'PUBLISH');

select 'v5 in force: ' || (c -> 'version' ->> 'versionNo') || ' items=' || jsonb_array_length(c -> 'items')
       || ' escort=' || (select count(*) from jsonb_array_elements(c -> 'items') i where i ->> 'conditionKey' = 'escort_tugs')
       || ' contingent=' || (select count(*) from jsonb_array_elements(c -> 'items') i where i ->> 'conditionKey' = 'contingent')
  from public.get_suez_tariff_context('2026-10-06') c;
