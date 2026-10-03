-- Suez tariff seed (Voyage Economics, Stream S, 3 Oct 2026).
--
-- Two published versions so the date selection is real from day one:
--   v1  15 Apr 2026 – 14 May 2026  Periodical 2/2026 waste tariff in force;
--                                  mooring still the pre-circular USD 3,500 line.
--   v2  15 May 2026 – open         Circular 1/2026: mooring USD 3,800 (GT ≥ 2,500)
--                                  / 2,350 (below), SCA electrician no longer boards,
--                                  searchlight fine USD 500 per transit.
-- Only the VERIFIED layers are published: the fixed charges as on the RUBATO
-- proforma and Circular 1/2026, the waste tariff of Periodical 2/2026, and the
-- conditional charges of the SCA mini guide and circulars. NO toll tiers and NO
-- SDR rate are seeded (r2, C2O-025: no placeholder values as published truth):
-- the engine reports "SCA tolls circular not loaded" / "no SDR rate on file"
-- until the owner loads them through Admin → Voyage estimator data. The RUBATO
-- figures (Apr 2026, SB laden, tolls USD 189,854 + other 11,221 = 201,075) are
-- the engine's golden fixture in scripts/suez-check.ts only.
--
-- Idempotent: skipped when version 1 already exists.

do $seed$
declare
  v1 uuid;
  v2 uuid;
begin
  if exists (select 1 from public.suez_tariff_versions where version_no = 1) then
    return;
  end if;

  insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref, source_url, notes, published_at)
  values (1, 'draft', date '2026-04-15', date '2026-05-14',
          'SCA Periodical 2/2026 (waste, 24 Mar 2026); Clarksons SB mini guide (2020 ed.); RUBATO proforma Apr 2026',
          null,
          'Seed version: fixed, conditional and waste layers only. Toll tiers: none (load the SCA tolls circular).',
          null)
  returning id into v1;

  insert into public.suez_tariff_versions (version_no, status, effective_from, effective_to, source_ref, source_url, notes, published_at)
  values (2, 'draft', date '2026-05-15', null,
          'SCA Circular 1/2026 (mooring, light services, 15 May 2026); SCA Periodical 2/2026 (waste); Clarksons SB mini guide',
          'https://www.suezcanal.gov.eg',
          'Seed version: mooring per Circular 1/2026; fixed, conditional and waste layers only. Toll tiers: none (load the SCA tolls circular).',
          null)
  returning id into v2;

  -- ── Items shared by both versions ─────────────────────────────────────────
  insert into public.suez_tariff_items (version_id, code, label_en, label_ar, layer, basis, currency, params, direction_scope, cargo_status_scope, condition_key, payer_party, sort_order, notes)
  select v, code, label_en, label_ar, layer, basis, currency, params::jsonb, dir, cs, cond, payer, so, notes
    from unnest(array[v1, v2]) as v
   cross join (values
    -- layer 1 · toll
    ('transit_toll', 'Suez Canal transit toll', 'رسوم العبور', 'toll', 'toll_tiered_scnt', 'SDR', '{}', 'any', 'any', null, 'owner', 10, 'Progressive SDR per SCNT from the toll tiers; converted at the dated SDR rate.'),
    -- layer 2 · fixed accompanying charges
    ('pilotage', 'Pilotage', 'الإرشاد', 'fixed', 'flat', 'USD', '{"amount": 316}', 'any', 'any', null, 'owner', 20, null),
    ('sca_etr', 'SCA electronic transit registration (ETR)', 'تسجيل العبور الإلكتروني', 'fixed', 'flat', 'USD', '{"amount": 500}', 'any', 'any', null, 'owner', 30, null),
    ('port_said_pa', 'Port Said Ports Authority dues', 'رسوم هيئة ميناء بورسعيد', 'fixed', 'flat', 'USD', '{"amount": 2745}', 'any', 'any', null, 'owner', 50, null),
    ('red_sea_pa', 'Red Sea Ports Authority dues', 'رسوم هيئة موانئ البحر الأحمر', 'fixed', 'flat', 'USD', '{"amount": 663}', 'any', 'any', null, 'owner', 60, null),
    ('lights_dues', 'Lights dues', 'رسوم الفنارات', 'fixed', 'flat', 'USD', '{"amount": 1578}', 'any', 'any', null, 'owner', 70, null),
    ('quarantine', 'Quarantine', 'الحجر الصحي', 'fixed', 'flat', 'USD', '{"amount": 19}', 'any', 'any', null, 'owner', 80, null),
    ('waste_mandatory', 'Mandatory solid-waste fee (Antipollution Egypt)', 'رسوم المخلفات الإلزامية', 'fixed', 'tier_by_scnt', 'USD',
       '{"unit": "m3", "tiers": [{"from": 0, "to": 10000, "amount": 235, "includedUnits": 3}, {"from": 10000, "to": 40000, "amount": 825, "includedUnits": 4}, {"from": 40000, "to": 70000, "amount": 1120, "includedUnits": 4}, {"from": 70000, "to": null, "amount": 1410, "includedUnits": 5}]}',
       'any', 'any', null, 'owner', 90, 'Periodical 2/2026, from 15 Apr 2026: levied on every transiting vessel whether or not waste is delivered.'),
    ('security_immigration', 'Immigration, security & police', 'الأمن والجوازات', 'fixed', 'flat', 'USD', '{"amount": 100}', 'any', 'any', null, 'owner', 100, null),
    ('bank_charges', 'Bank charges', 'عمولة البنك', 'fixed', 'flat', 'USD', '{"amount": 75}', 'any', 'any', null, 'owner', 110, null),
    ('service_launch', 'Service launch', 'أجرة لنش الخدمة', 'fixed', 'flat', 'USD', '{"amount": 150}', 'any', 'any', null, 'owner', 120, null),
    ('agency_fee', 'Agency fee', 'أتعاب الوكيل', 'fixed', 'flat', 'USD', '{"amount": 750}', 'any', 'any', null, 'owner', 130, null),
    -- layer 3 · conditional charges (risk flags)
    ('imposed_tug', 'Imposed tug (mooring boats cannot be lifted / SCA judgement)', 'قاطرة مفروضة', 'conditional', 'flat', 'SDR', '{"amount": 22000}', 'any', 'any', 'no_mooring_cranes', 'owner', 200, 'Unified rate for the complete transit. Triggered when GT > 10,000 and the vessel cannot lift two mooring boats (cranes SWL 3 t).'),
    ('late_arrival', 'Late arrival for the convoy', 'الوصول بعد الموعد', 'conditional', 'pct_of_toll', 'SDR',
       '{"bands": [{"key": "b1", "label": "23:00–00:00", "pct": 5, "capSdr": 12500}, {"key": "b2", "label": "00:00–01:00", "pct": 10, "capSdr": 25000}, {"key": "b3", "label": "after 01:00", "pct": 12, "capSdr": 30000}]}',
       'SB', 'any', 'late_arrival', 'owner', 210, 'Southbound limit line 23:00 LT; extensions against additional tolls.'),
    ('no_searchlight', 'Searchlight absent or non-compliant', 'غياب الكشاف أو عدم مطابقته', 'conditional', 'flat', 'USD', '{"amount": 500}', 'any', 'any', 'no_searchlight', 'owner', 220, 'Per transit, from the first transit (Circular 1/2026).'),
    ('not_ready', 'Vessel enlisted in the convoy and found not ready', 'السفينة غير جاهزة في القافلة', 'conditional', 'flat', 'USD', '{"amount": 5000}', 'any', 'any', 'not_ready', 'owner', 230, null),
    ('heavy_lift', 'Heavy unit of 250 t or more on board', 'حمولة ثقيلة 250 طناً فأكثر', 'conditional', 'pct_of_toll', 'SDR', '{"pct": 50}', 'any', 'laden', 'heavy_lift', 'charterer', 240, '50% surcharge on the transit toll (project cargo).'),
    ('floating_unit', 'Floating unit of SCGT 300 or more carried (semi-submersible rule)', 'وحدة عائمة 300 طن فأكثر', 'conditional', 'pct_of_toll', 'SDR', '{"pct": 125}', 'any', 'laden', 'floating_unit', 'charterer', 250, '125% plus escort tugs assigned by the SCA.'),
    ('military_cargo', 'Navy / government charter or ≥ 50% military cargo', 'سفن أو بضائع عسكرية', 'conditional', 'pct_of_toll', 'SDR', '{"pct": 25}', 'any', 'any', 'military', 'charterer', 260, null),
    ('deck_protrusion', 'Deck cargo protruding beyond the allowed limit', 'بروز البضاعة خارج الحدود', 'conditional', 'pct_of_toll', 'SDR', '{"pctPerUnit": 2, "unit": "ft"}', 'any', 'laden', 'deck_protrusion', 'charterer', 270, '2% per foot or fraction beyond half the beam (max 15 m a side).'),
    ('ladder_noncompliant', 'Pilot / accommodation ladder not in order', 'سلم الإرشاد غير مطابق', 'conditional', 'flat', 'USD', '{"amount": 5000}', 'any', 'any', 'ladder_noncompliant', 'owner', 280, null),
    ('relieving_pilot', 'Relieving pilot at the lakes (no accommodation ladder)', 'مرشد بديل في البحيرات', 'conditional', 'per_unit', 'USD', '{"rate": 1000, "unit": "pilot", "freeUnits": 0}', 'any', 'any', 'relieving_pilots', 'owner', 290, 'USD 1,000 per relieving pilot when the pilot change moves to the Bitter or Timsah lakes.'),
    ('overage_inspection', 'Vessel over 20–25 years: SCA seaworthiness inspection', 'معاينة السفن المسنّة', 'conditional', 'flag_only', 'USD', '{}', 'any', 'any', 'overage', 'owner', 300, 'May be allowed to transit only towed or with imposed tugs; cost known after inspection.'),
    ('first_transit', 'First Suez transit: measurement, SCNT uncertain', 'عبور أول: قياس الحمولة', 'conditional', 'flag_only', 'USD', '{}', 'any', 'any', 'first_transit', 'owner', 310, 'Surveyor boards to determine the SCNT; the toll estimate is provisional.'),
    -- layer 4 · waste extras (only when volumes are declared)
    ('waste_extra_m3', 'Non-hazardous waste beyond the included volume', 'مخلفات زائدة عن المشمول', 'waste', 'per_unit', 'USD', '{"rate": 99, "unit": "m3", "freeUnits": 0}', 'any', 'any', null, 'owner', 400, 'USD 99 per m³ above the mandatory included volume.'),
    ('waste_hazardous_m3', 'Hazardous waste (optional service)', 'مخلفات خطرة', 'waste', 'per_unit', 'USD', '{"rate": 1000, "unit": "m3", "freeUnits": 0}', 'any', 'any', null, 'owner', 410, null),
    ('waste_bags', 'UN-approved bags supplied by the contractor', 'أكياس معتمدة', 'waste', 'per_unit', 'USD', '{"rate": 10, "unit": "bag_m3", "freeUnits": 0}', 'any', 'any', null, 'owner', 420, 'USD 10 per bag per m³.'),
    ('waste_barge_hours', 'Self-propelled garbage barge waiting', 'انتظار صندل المخلفات', 'waste', 'per_unit', 'USD', '{"rate": 200, "unit": "hour", "freeUnits": 1}', 'any', 'any', null, 'owner', 430, 'First hour free, USD 200 per additional hour.')
   ) as t(code, label_en, label_ar, layer, basis, currency, params, dir, cs, cond, payer, so, notes);

  -- ── Mooring: differs between the two versions ─────────────────────────────
  insert into public.suez_tariff_items (version_id, code, label_en, label_ar, layer, basis, currency, params, sort_order, notes)
  values (v1, 'mooring', 'Mooring, unmooring & projector', 'الرباط والكشاف', 'fixed', 'flat', 'USD', '{"amount": 3500}', 40,
          'Pre-Circular 1/2026 line as on the RUBATO proforma.'),
         (v2, 'mooring', 'Mooring services (shore stations, Canal Mooring & Lights Co.)', 'خدمات الرباط', 'fixed', 'gt_threshold', 'USD',
          '{"threshold": 2500, "below": 2350, "atOrAbove": 3800, "unit": "GT"}', 40,
          'Circular 1/2026 art. 4: lump sum USD 3,800 for GT ≥ 2,500, USD 2,350 below; no electrician boards.');

  -- Publish both (the children guard only bites after publication). Toll tiers
  -- and the SDR rate are deliberately absent: the admin loads them.
  update public.suez_tariff_versions set status = 'published', published_at = now() where id in (v1, v2);
end;
$seed$;
