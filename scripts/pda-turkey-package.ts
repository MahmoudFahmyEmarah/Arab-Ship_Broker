// PDA tariff package: Izmir (TRIZM), a TCDD port with KEGM pilotage — the USD version with manual lines (owner
// ruling 7 Oct 2026: "USD version + manual lines"). The USD service tables (pilotage, mooring) are automatic; the
// TRY port dues and the EUR agency, supervision and waste items are manual lines with the printed figures, because
// one tariff version prices in one currency.
//
// Every USD table in the pack is UNDATED and stops at 10,000 GT. Above 10,000 GT the rules continue the printed
// header increment ("197+81", "22+11") per started 1,000 GT up to the 80,000 GT cap (TCDD principle 8) — a
// platform assumption, labelled on each line and in the manifest. Confirm with a current KEGM/TCDD sheet or an
// agent's proforma before members rely on it.
//
// Writes docs/data/pda-tariffs/turkey-izmir-2026/{rules.json, manifest.json}. Verbatim figures and their table
// locations are in docs/data/pda-tariffs/turkey-2026-review/SOURCE-EXTRACTION.md.
//
//   node --import tsx scripts/pda-turkey-package.ts          # check only
//   node --import tsx scripts/pda-turkey-package.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePda } from "../lib/pda/calculate";
import type { PdaTariffBand, PdaTariffRule, PdaTariffVersion } from "../lib/pda/types";

const DIR = join(process.cwd(), "docs", "data", "pda-tariffs", "turkey-izmir-2026");
const ZIP = "tmp/Data/TURKISH PORTS.zip :: TURKISH PORTS/";

const SOURCES = {
  tcdd: { placeholderId: "00000000-0000-4000-9000-000000005012", title: "TCDD Port Tariff compendium (TCDD, KEGM, TDİ, Ministry, waste) — undated", authority: "reference",
    file: `${ZIP}TCDD PORT TARIFF.docx`, sha256: "a2f89a5fede22d8e34fcb3d94ea67d066fefdec6e5629b0d64075601a392c93a" },
  portDues: { placeholderId: "00000000-0000-4000-9000-000000005006", title: "Port dues (For the year 2026)", authority: "reference",
    file: `${ZIP}PORT DUES (For the year 2026).docx`, sha256: "2c59f6cb11c6499d51f25af11bfe50c805d4a9517a03120315cc9a8b3bb1d87a" },
  sanitary: { placeholderId: "00000000-0000-4000-9000-000000005007", title: "Sanitary dues (Official Gazette 9.5.2008 No 26871)", authority: "reference",
    file: `${ZIP}SANITARY DUES.docx`, sha256: "e915f2f478941bfba23fcf338e9c78b183af6003933ec827bcd707f91ae02597" },
  agency: { placeholderId: "00000000-0000-4000-9000-000000005001", title: "Agency service fee (Official Gazette 32314, 19.09.2023)", authority: "reference",
    file: `${ZIP}AGENCY SERVICE FEE.docx`, sha256: "b057513680fb84ad4049eb94343fec25bbd1bbd6ab28576990b4aa37c5141133" },
  supervision: { placeholderId: "00000000-0000-4000-9000-000000005008", title: "Supervision services (Official Gazette 26812, 10.03.2008)", authority: "reference",
    file: `${ZIP}Supervision Services .docx`, sha256: "d8047a685ec03d80b4a7241cf8fc478658fd94c9efa7d70cf2090968d5244ce7" },
} as const;
type SourceKey = keyof typeof SOURCES;

type RuleJson = Omit<PdaTariffRule, "id" | "source"> & { sourceId: string; sourcePage: string; sourceExcerpt: string };
const src = (doc: SourceKey, page: string, excerpt: string) => ({ sourceId: SOURCES[doc].placeholderId, sourcePage: page, sourceExcerpt: excerpt });

/** "base + increment" per started 1,000 GT, printed to 10,000 GT, continued (assumption) to the 80,000 GT cap. */
const CAP_GT = 80000;
function incrementBands(base: number, step: number): PdaTariffBand[] {
  const bands: PdaTariffBand[] = [];
  for (let i = 0; i < CAP_GT / 1000; i++) bands.push({ order: i + 1, lowerBound: i * 1000, upperBound: (i + 1) * 1000, flatAmount: base + step * i });
  bands.push({ order: bands.length + 1, lowerBound: CAP_GT, upperBound: null, flatAmount: base + step * (CAP_GT / 1000 - 1) });
  return bands;
}
const ABOVE_10K = "above 10,000 GT the header increment is continued per started 1,000 GT to the 80,000 GT cap (platform assumption, tables stop at 10,000 GT)";

export const RULES: RuleJson[] = [
  { code: "port_dues", label: "Port dues (TRY, enter the USD equivalent)", basis: "manual_quote", priority: 10,
    applicability: { requestedServices: ["port_dues"] },
    manualInstructions: "Port dues, 2026, Turkish lira per call by net tonnage: 11–500 1.283,90; 501–2.000 3.424,00; 2.001–4.000 6.848,10; 4.001–8.000 10.272,20; 8.001–10.000 17.120,40; 10.001–30.000 34.240,90; 30.001–50.000 51.361,40; over 50.000 85.602,30 TL. Vessels up to 10 NT are exempt. Enter the USD equivalent at the call date's rate (CBRT USD buying rate, or the governed EUR→TRY and EUR→USD rates: USD = TL ÷ EUR/TRY × EUR/USD). Frequency (per call / per entry) and the issuer are not printed — confirm with the agent; 50.000 NT exactly is read as 30.001–50.000.",
    ...src("portDues", "Table 1 and the paragraph after it", "11-500 tonage vessels 1.283,90 TL … 50.000 over tonage vessels 85.602,30 TL; Vessels up to 10 NT are exemption from Port dues.") },
  { code: "sanitary_dues", label: "Sanitary dues, per NT (USD 0,5025 × NT, paid in TL)", basis: "per_nt", rate: 0.5025, priority: 20,
    applicability: { requestedServices: ["port_dues"], minNt: 50.000001 },
    ...src("sanitary", "formula and exemption 4", "0,5025 x US Dollar daily buying rate x vessel’s NT; exempt: Vessels which are less than 50 NT (including vessels which are 50 NT)") },
  { code: "pilotage_arrival", label: `Pilotage, arrival (USD per service; ${ABOVE_10K})`, basis: "tiered_flat", unit: "gt", priority: 30,
    applicability: { requestedServices: ["pilotage"] }, bands: incrementBands(197, 81),
    ...src("tcdd", "§1 Table 1 and §2 Table 5, Other Cargo Vessels; §1 principle 8", "Other Cargo Vessels \"197+81\": 197 / 278 / 359 / 440 / 521 / 602 / 683 / 764 / 845 / 926 (1-1000 … 9001-10000 GT); For vessels over 80.000 GT, the fees of 80.000 GT are applied.") },
  { code: "pilotage_departure", label: `Pilotage, departure (USD per service; ${ABOVE_10K})`, basis: "tiered_flat", unit: "gt", priority: 31,
    applicability: { requestedServices: ["pilotage"] }, bands: incrementBands(197, 81),
    ...src("tcdd", "§1 Table 1 and §2 Table 5, Other Cargo Vessels; §1 principle 8", "Other Cargo Vessels \"197+81\": 197 … 926 per service (1-1000 … 9001-10000 GT)") },
  { code: "towage", label: "Towage (USD per tug per service)", basis: "manual_quote", priority: 40,
    applicability: { requestedServices: ["towage"] },
    manualInstructions: "Towage, Other Cargo Vessels, USD per tug per service: 373 up to 1,000 GT plus 70 per further started 1,000 GT (printed to 10,000 GT = 1003; above that the same increment is a platform assumption, capped at 80,000 GT = 5903). The number of tugs is set by the port regulations (a ship with working bow and stern thrusters takes one tug). Enter (tugs on arrival + tugs on departure) × the per-tug fee. +50 % on public holidays; shifting between berths −50 %.",
    ...src("tcdd", "§1 Table 2 and application principles 1, 2, 4, 7, 8; §2 Table 6", "Other Cargo Vessels \"373+70\": 373 / 443 / … / 1003 (0-1000 … 9001-10000 GT)") },
  { code: "mooring", label: `Mooring and unmooring, once per call (USD; ${ABOVE_10K})`, basis: "tiered_flat", unit: "gt", priority: 50,
    applicability: { requestedServices: ["mooring"] }, bands: incrementBands(22, 11),
    ...src("tcdd", "§1 Table 3 and notes 2, 5; §2 Table 8", "ALL TYPE OF VESSELS (22+11): 22 / 33 / … / 121 (0-1000 … 9001-10000 GT); The fees specified on table are applied for once for mooring and unmooring.") },
  { code: "wharfage", label: "Wharfage / berth occupation (USD)", basis: "manual_quote", priority: 60,
    applicability: { requestedServices: ["port_dues"], locations: ["alongside"] },
    manualInstructions: "The pack contradicts itself for a TCDD berth: T12 §1 prints wharfage \"10+10\" USD per service per 1,000 GT (10 up to 1,000 GT … 90 at 8,001–9,000 GT); T9 prints the Haydarpaşa–İzmir table \"35+35\" USD per 3,500 GT per day of stay; the Ministry tariff charges 0,010 USD per GT per day. Ask the agent or TCDD İzmir which applies and enter the USD amount for the stay. Unlawful occupation is charged double.",
    ...src("tcdd", "§1 Table 4 and §4 Table 14 note 1", "Wharfage \"10+10\" USD / PER SERVICE; It is paid 0,010 USD by vessels arriving to port per each gross tonnage of vessel for each day which they stayed in the port.") },
  { code: "anchoring", label: "Anchoring fee (USD, stays over 72 hours)", basis: "manual_quote", priority: 70,
    applicability: { requestedServices: ["port_dues"], locations: ["anchorage"] },
    manualInstructions: "Charged only when the total anchoring time exceeds 72 hours, then daily from the anchoring time. Outside the TBDTDY anchorages: foreign flag 0,004 USD per GT per day up to 168 hours, 0,006 after; Turkish flag 0,002 / 0,003. TBDTDY Annex-2 anchorages: foreign 0,008 / 0,012, Turkish 0,004 / 0,006. Example printed: 10.000 GT foreign, 5 days = 5 × 40 = 200 USD. Enter 0 when the stay at anchor is 72 hours or less.",
    ...src("tcdd", "§4 E, anchoring tariff for all ports, and Table 17 example", "USD 0,002 per GT for Turkish flagged ships and USD 0,004 per GT for foreign flagged ships with an anchorage period up to 168 hours") },
  { code: "agency_fee", label: "Agency fee (EUR tariff, enter the USD equivalent)", basis: "manual_quote", priority: 80,
    applicability: { requestedServices: ["agency"] },
    manualInstructions: "Agency Tariff No 1 (Gazette 32314, 19.09.2023), EUR per call by net tonnage: 0–500 600; 501–1000 1000; 1001–2000 1500; 2001–3000 1850; 3001–4000 2300; 4001–5000 2750; 5001–7500 3200; 7501–10000 4000; then per started 1,000 NT: 10001–20000 +125, 20001–30000 +100, over 30001 +75 (read as layered on top of 4000 — not printed, confirm). Covers 7 days; +20 % per further 5 days or part. Enter the USD equivalent at the governed EUR→USD rate of the call date.",
    ...src("agency", "Table 8 and conditions a)–b)", "0 – 500 600 … 7501 – 10000 4000; 10001 – 20000 in addition per each 1000 NT or fraction thereof 125") },
  { code: "supervision_fee", label: "Cargo supervision (EUR tariff, only if a supervising agent is appointed)", basis: "manual_quote", priority: 90,
    applicability: { requestedServices: ["agency"] },
    manualInstructions: "Supervision Tariff No 5 (Gazette 26812, 10.03.2008), EUR per metric ton, bulk: dry cargo 0.15 up to 10,000 t, 0.10 for 10,001–20,000 t, 0.05 for the part over 20,000 t; grains and seeds 0.10 up to 10,000 t, 0.075 for 10,001–25,000 t, 0.045 for the part over 25,000 t (bands read as marginal). Charged only when a supervising/protecting agent is appointed; enter the USD equivalent at the governed EUR→USD rate, or 0.",
    ...src("supervision", "Table 1 R2–R10", "a) Dry Cargo … I- 0 up to 10000 tons 0.15; II- 10001 up to 20000 tons 0.10; III- For part over 20000 tons 0.05") },
  { code: "waste_fixed_fee", label: "Ship waste, fixed fee (EUR tariff, enter the USD equivalent)", basis: "manual_quote", priority: 100,
    applicability: { requestedServices: ["waste"] },
    manualInstructions: "Waste collection fixed fee (Gazette 27249, valid 1.1.2010), EUR per call by GRT: 0–1000 80; 1001–5000 140; 5001–10000 210; 10001–15000 250; 15001–20000 300; 20001–25000 350; 25001–35000 400; 35001–60000 540; over 60000 720. Not charged again at a later Turkish port when it was paid at the first one. Waste above the allowance is per m³ (Annex I bilge/sludge 35 €, IV 15 €, V 25 €). Enter the USD equivalent at the governed EUR→USD rate.",
    ...src("tcdd", "§5 Table 18 (Annex-1) and notes 2, 3, 6", "0-1000 80 | 1001-5000 140 | 5001-10000 210 | … | 35001-60000 540 | Over 60000 720 (1. Part Fixed Fee €)") },
];

export const MANIFEST = {
  package: "turkey-izmir-2026",
  ports: ["TRIZM"],
  currency: "USD",
  effectiveFrom: "2026-01-01",
  // Publication needs trusted evidence (official, agent or statutory sources). The Turkish pack names no issuer
  // or provider, so its documents are registered as "reference" until the owner rules on their provenance.
  publishable: false,
  blockers: [
    { id: "TR-AUTH", text: "Source authority: the TURKISH PORTS.zip documents name no issuer or provider. pda_submit_tariff_version refuses rules whose sources are not official, agent or statutory. The owner rules on the provenance (for example an agent's compiled pack → 'agent'), or a current KEGM/TCDD sheet or agent proforma replaces them." },
  ] as { id: string; text: string }[],
  dependsOn: [
    "20261007310000_pda_fx_rates (+ the 20261007320000 ECB feed): the EUR and TRY manual lines are converted at the governed rates.",
  ],
  sources: SOURCES,
  knownLimits: [
    "UNDATED SOURCES. Every USD table (TCDD/KEGM pilotage, towage, mooring, wharfage) is undated; KEGM revises them yearly. Only the port dues say 2026. Confirm before use.",
    "Above 10,000 GT the pilotage and mooring rules continue the printed header increment (+81, +11 per started 1,000 GT) to the 80,000 GT cap: a platform assumption, stated on each line. The cap is printed for TCDD only.",
    "Rates are the 'Other Cargo Vessels' column (bulk and general cargo). Container, Ro-Ro, passenger and car-carrier columns differ and are not loaded.",
    "İzmir pilotage and towage are KEGM services (§2); the KEGM Other Cargo figures equal TCDD §1. Outer-harbour services are +100 %; holidays +50 %; dangerous goods +10 % to +30 % — none applied automatically.",
    "T9 prints different KEGM rates (202,27 + 83,17 pilotage; 382,99 + 71,87 towage); T12 is used. Which edition is current is open (review question 9).",
    "Sanitary dues read the single printed formula (0,5025 USD × NT, paid in TL) as the port-call rate; transit and free-pratique variants are not printed separately.",
    "Manual lines: port dues (TRY), wharfage (three conflicting bases), anchoring (72-hour threshold), towage (tug count), agency, supervision and waste (EUR).",
    "Not in the package: light dues (the pack covers Straits transits only), Chamber of Shipping contribution and freight tax (T11, contradictory), private-terminal berth, handling, ISPS and security charges.",
  ],
};

function version(rules: RuleJson[]): PdaTariffVersion {
  return {
    id: "00000000-0000-4000-9000-000000005100", tariffSetId: "00000000-0000-4000-9000-000000005000",
    portLocode: "TRIZM", versionNo: 1, currency: "USD", effectiveFrom: "2026-01-01", roundingMode: "half_up", decimalPlaces: 2,
    rules: rules.map((r, i) => ({ ...r, id: `00000000-0000-4000-9000-5100${String(i + 1).padStart(8, "0")}`,
      source: { sourceId: r.sourceId, title: "Turkish tariffs", page: r.sourcePage, excerpt: r.sourceExcerpt } })) as PdaTariffRule[],
  };
}

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}
const ids = new Set<string>(Object.values(SOURCES).map((s) => s.placeholderId));
for (const r of RULES) {
  check(`${r.code}: structure`, () => {
    assert.match(r.code, /^[a-z][a-z0-9_]{1,79}$/);
    assert.ok(ids.has(r.sourceId));
    if (r.basis === "manual_quote") assert.ok(r.manualInstructions && r.manualInstructions.length > 40);
    else assert.equal(r.manualInstructions, undefined);
    if (r.bands) {
      assert.equal(r.bands[0].lowerBound, 0);
      for (let i = 1; i < r.bands.length; i++) assert.equal(r.bands[i].lowerBound, r.bands[i - 1].upperBound);
      assert.equal(r.bands[r.bands.length - 1].upperBound, null);
    }
  });
}

const ALL = ["port_dues", "pilotage", "towage", "mooring", "agency", "waste"];
const call = (gt: number, nt: number | null, location: "alongside" | "anchorage" = "alongside") => ({
  portLocode: "TRIZM", callDate: "2026-10-07",
  vessel: { gt, nt, loaM: 190, vesselType: "Bulk Carrier", flagState: "MT" },
  call: { days: 3, hours: 72, cargoType: "Grain", cargoStatus: "laden" as const, voyageScope: "international" as const, location,
    requestedServices: ALL },
});
const amounts = (r: ReturnType<typeof calculatePda>) => Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
const manual = (r: ReturnType<typeof calculatePda>) => r.warnings.filter((w) => w.code === "MANUAL_QUOTE_REQUIRED").map((w) => w.ruleCode).sort();

check("printed tables reproduced exactly to 10,000 GT", () => {
  const p = (gt: number) => amounts(calculatePda(call(gt, 100), version(RULES)));
  const printedPilotage = [197, 278, 359, 440, 521, 602, 683, 764, 845, 926];
  const printedMooring = [22, 33, 44, 55, 66, 77, 88, 99, 110, 121];
  printedPilotage.forEach((v, i) => {
    for (const gt of [i * 1000 + 1, (i + 1) * 1000]) {
      const a = p(gt);
      assert.equal(a.pilotage_arrival, v, `pilotage at ${gt} GT`);
      assert.equal(a.pilotage_departure, v, `pilotage out at ${gt} GT`);
      assert.equal(a.mooring, printedMooring[i], `mooring at ${gt} GT`);
    }
  });
});

check("engine: 35,000 GT / 20,000 NT bulk carrier alongside (assumed increments above 10,000 GT)", () => {
  const r = calculatePda(call(35000, 20000), version(RULES));
  const a = amounts(r);
  assert.equal(a.pilotage_arrival, 197 + 81 * 34);   // 2951, band 34,001–35,000
  assert.equal(a.pilotage_departure, 2951);
  assert.equal(a.mooring, 22 + 11 * 34);              // 396
  assert.equal(a.sanitary_dues, 10050);               // 0,5025 × 20,000 NT
  assert.deepEqual(manual(r), ["agency_fee", "port_dues", "supervision_fee", "towage", "waste_fixed_fee", "wharfage"]);
  assert.equal(r.nativeCurrency, "USD");
});

check("80,000 GT cap: 80,001 and 150,000 GT pay the 80,000 GT fee", () => {
  const a80 = amounts(calculatePda(call(80000, 100), version(RULES)));
  for (const gt of [80001, 150000]) {
    const a = amounts(calculatePda(call(gt, 100), version(RULES)));
    assert.equal(a.pilotage_arrival, a80.pilotage_arrival);
    assert.equal(a.mooring, a80.mooring);
  }
  assert.equal(a80.pilotage_arrival, 6596);
  assert.equal(a80.mooring, 891);
});

check("sanitary dues: none at 50 NT or below; NT missing is a missing input, never zero", () => {
  assert.equal(amounts(calculatePda(call(300, 50), version(RULES))).sanitary_dues, undefined);
  assert.equal(amounts(calculatePda(call(300, 51), version(RULES))).sanitary_dues, 25.63); // 0,5025 × 51 = 25,6275
  const r = calculatePda(call(35000, null), version(RULES));
  assert.equal(amounts(r).sanitary_dues, undefined);
  assert.ok(r.warnings.some((w) => w.code === "MISSING_INPUT" && w.ruleCode === "sanitary_dues"));
});

check("at anchorage the anchoring line replaces wharfage", () => {
  const m = manual(calculatePda(call(35000, 20000, "anchorage"), version(RULES)));
  assert.ok(m.includes("anchoring") && !m.includes("wharfage"));
});

check("manifest: held back on source authority, every source hashed, assumption and dating stated", () => {
  assert.equal(MANIFEST.publishable, false);
  assert.deepEqual(MANIFEST.blockers.map((b) => b.id), ["TR-AUTH"]);
  for (const s of Object.values(SOURCES)) assert.equal(s.authority, "reference");
  for (const s of Object.values(SOURCES)) assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.ok(MANIFEST.knownLimits[0].startsWith("UNDATED SOURCES"));
  for (const r of RULES.filter((x) => x.bands)) assert.match(r.label, /platform assumption/);
});

const OUTPUTS: [string, unknown][] = [["rules.json", RULES], ["manifest.json", MANIFEST]];
for (const [file, data] of OUTPUTS) {
  const path = join(DIR, file);
  const json = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--write")) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, json);
    console.log(`wrote ${path}`);
  } else {
    check(`committed ${file} equals the generator output`, () => {
      assert.ok(existsSync(path), "run with --write first");
      assert.equal(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), json);
    });
  }
}
console.log(`pda-turkey-package: ${passed} passed, ${failed} failed (${RULES.length} rules)`);
if (failed) process.exit(1);
