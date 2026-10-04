-- Corrective seed migration (Voyage Economics, Stream S; audit O2C-022 items 1, 9,
-- 11 and O2C-024 item 6). Applies only where the 200100 seed exists; idempotent.
--
-- Published versions are immutable by trigger. These corrections amend a seed
-- that production never received (the Suez block is not applied anywhere but
-- the local development databases), so the children guard is bypassed
-- explicitly and the bypass is recorded as a 'seed' event — the audit trail
-- shows exactly what changed and why.
--
-- 1. Searchlight rule per version (v1: art. 28(9) USD 5,000 from the second
--    transit; v2: Circular 1/2026 USD 500 per transit).
-- 2. Tariff-defined thresholds move into item params: imposed tug (GT 10,000,
--    SWL 3 t, two boats), overage inspection (20 years).
-- 3. Governed source records with file hashes, cited by both versions.

do $fix$
declare
  v1 uuid; v2 uuid;
  s_circ uuid; s_waste uuid; s_guide uuid; s_art28 uuid; s_rubato uuid;
begin
  select id into v1 from public.suez_tariff_versions where version_no = 1;
  select id into v2 from public.suez_tariff_versions where version_no = 2;
  if v1 is null or v2 is null then
    return; -- the 200100 seed is not present; nothing to correct
  end if;

  -- ── sources ─────────────────────────────────────────────────────────────
  insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256, source_filename, byte_size, notes)
  values ('Circular No. 1/2026 — mooring and light services', 'Suez Canal Authority', 'Circular 1/2026', date '2026-05-06', date '2026-05-15', 'official', 'on_file',
          'f171b583c9d2eb163dd08e8d687ad22dacf3a3d787b3141d39cc3822db4a3fb7', 'Circular 1 - 2026.pdf', 755775,
          'Mooring from shore stations: USD 3,800 (GT ≥ 2,500) / USD 2,350 (below); no SCA electrician boards; searchlight non-conformity USD 500 per transit from the first transit; cancels Notice to Mariners 1/2024 from 15 May 2026.')
  returning id into s_circ;
  insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256, source_filename, byte_size, notes)
  values ('Periodical No. 2/2026 — integrated waste management fees (agent transmission)', 'Suez Canal Authority via Clarksons Shipping Agency', 'Periodical 2/2026', date '2026-03-24', date '2026-04-15', 'agent', 'on_file',
          '3f20ef3540904267e5ef092b6d3b1cb49c61caa768345931d9cafb0cf64cf55b', 'MSG 1 SUEZ CANAL TRANSIT - SB __ COMPULSARY GARBAGE DISPOSAL  .docx', 150759,
          'Mandatory solid-waste fees by SCNT (235 / 825 / 1,120 / 1,410 USD with 3 / 4 / 4 / 5 m³ included), USD 99/m³ extra, USD 1,000/m³ hazardous, USD 10 per bag per m³, barge first hour free then USD 200/h. Agent message; the SCA periodical itself is not on file.')
  returning id into s_waste;
  insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256, source_filename, byte_size, notes)
  values ('Southbound Suez Canal Transit Mini Guide (edition Dec 2015, updated 2020)', 'Clarksons Shipping Agency', null, date '2020-12-01', null, 'agent', 'on_file',
          '4a0d86b3949a64220791773e4c1b8e2bfa67b1d84081db53a0e12e786f1d13ef', 'Suez Canal Guide SB.pdf', 356287,
          'Late-arrival bands (+5/10/12 %, caps SDR 12,500/25,000/30,000), imposed tug SDR 22,000, not-ready USD 5,000, heavy lift +50 %, floating unit 125 %, navy +25 %, deck protrusion +2 %/ft, ladder USD 5,000, relieving pilot USD 1,000, overage inspection.')
  returning id into s_guide;
  insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256, source_filename, byte_size, notes)
  values ('Rules of Navigation — art. 26 deck cargo, art. 27 ballast, art. 28 searchlights', 'Suez Canal Authority', 'Rules of Navigation (Dec 2020), pp. 53–55', date '2020-12-01', null, 'official', 'on_file',
          '47d771190175cba8dad406aaa696397aadb7c10861524dea0ac3cd5e885968ae', 'Article 28 - Search light.pdf', 650452,
          'Searchlight specification; art. 28(9): non-conformity → day-time transit only and USD 5,000 at the second and each following transit (superseded by Circular 1/2026 from 15 May 2026). Art. 26(3): +2 % of transit dues per foot of protrusion.')
  returning id into s_art28;
  insert into public.suez_tariff_sources (title, issuer, document_no, issue_date, effective_from, authority, evidence_status, sha256, source_filename, byte_size, notes)
  values ('RUBATO southbound transit proforma, April 2026', 'Owner (Capt. M. Dawoud) — agent proforma', null, date '2026-04-20', null, 'owner', 'pending_document', null, null, null,
          'Fixed accompanying charges as invoiced (pilotage 316, ETR 500, mooring 3,500, Port Said PA 2,745, Red Sea PA 663, lights 1,578, quarantine 19, waste 825, security 100, bank 75, launch 150, agency 750 = USD 11,221; tolls USD 189,854). The proforma document is awaited from the owner; until it is on file the figures are owner-reported.')
  returning id into s_rubato;

  insert into public.suez_tariff_version_sources (version_id, source_id) values
    (v1, s_waste), (v1, s_guide), (v1, s_art28), (v1, s_rubato),
    (v2, s_circ), (v2, s_waste), (v2, s_guide), (v2, s_art28), (v2, s_rubato)
  on conflict do nothing;

  -- ── item corrections under an explicit, logged bypass ─────────────────────
  alter table public.suez_tariff_items disable trigger trg_suez_items_guard;

  update public.suez_tariff_items set
      label_en = 'Searchlight / electrical connections not in conformity',
      params = '{"amount": 5000, "fromSecondTransit": true}'::jsonb,
      notes = 'Rules of Navigation art. 28(9): day-time transit only; USD 5,000 at the second and each following transit. Spec: bow-mounted, 1,800 m beam, 3 million candela (2,000 W up to 30,000 SCGT, 3,000 W above), type-test certificate.'
    where version_id = v1 and code = 'no_searchlight';
  update public.suez_tariff_items set
      label_en = 'Searchlight absent or non-compliant',
      params = '{"amount": 500}'::jsonb,
      notes = 'Circular 1/2026 art. 3: USD 500 per transit, from the first transit; no SCA electrician boards. Spec per Rules of Navigation art. 28.'
    where version_id = v2 and code = 'no_searchlight';

  update public.suez_tariff_items set params = params || '{"gtThreshold": 10000, "swlMt": 3, "boats": 2}'::jsonb
    where version_id in (v1, v2) and code = 'imposed_tug' and not (params ? 'gtThreshold');
  update public.suez_tariff_items set params = params || '{"ageYears": 20}'::jsonb
    where version_id in (v1, v2) and code = 'overage_inspection' and not (params ? 'ageYears');

  alter table public.suez_tariff_items enable trigger trg_suez_items_guard;

  insert into public.suez_tariff_events (entity, entity_id, version_id, action, actor_user_id, details)
  values ('seed', null, v1, 'seed_correction', null, jsonb_build_object('migration', '20261003205100', 'changes', jsonb_build_array('no_searchlight v1 → art. 28(9) USD 5,000 fromSecondTransit', 'imposed_tug params gtThreshold/swlMt/boats', 'overage_inspection params ageYears', 'sources cited'))),
         ('seed', null, v2, 'seed_correction', null, jsonb_build_object('migration', '20261003205100', 'changes', jsonb_build_array('no_searchlight v2 → Circular 1/2026 USD 500', 'imposed_tug params gtThreshold/swlMt/boats', 'overage_inspection params ageYears', 'sources cited')));

  -- Both versions must still validate under the publish-time rules.
  perform public.fn_suez_validate_version(v1);
  perform public.fn_suez_validate_version(v2);
end;
$fix$;
