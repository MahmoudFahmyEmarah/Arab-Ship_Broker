// PDA tariff package: Bulgarian Ports Infrastructure Co. (ДП „Пристанищна инфраструктура“) — Varna and Burgas
// public-transport ports (Art. 106a) — port fees (15.11.2023, still in force), ship-waste fees (2026) and the
// departure clearance certificate (2026). Owner load order: Egypt → Constanta → Greece → … → Bulgaria.
//
// Writes docs/data/pda-tariffs/bulgaria-bpi-2026/{rules.json, manifest.json}. Rates are transcribed from the scanned
// tariffs (verbatim extraction with page references in SOURCE-EXTRACTION.md); what the text leaves open is a manual line.
//
//   node --import tsx scripts/pda-bulgaria-package.ts          # check only
//   node --import tsx scripts/pda-bulgaria-package.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePda } from "../lib/pda/calculate";
import type { PdaTariffBand, PdaTariffRule, PdaTariffVersion } from "../lib/pda/types";

const DIR = join(process.cwd(), "docs", "data", "pda-tariffs", "bulgaria-bpi-2026");
const ZIP = "tmp/Data/BULGARIAN PORTS.zip :: BULGARIAN PORTS/";

const SOURCES = {
  burgas: { placeholderId: "00000000-0000-4000-9000-000000004013", title: "BPI — Tariff for port fees, port under Art. 106a — Burgas (board protocol 188/15.11.2023)", authority: "official",
    file: `${ZIP}Tariff for port fees collected by Bulgarian Ports Infrastructure Company in a port within the meaning of Art. 106a of the Law on Maritime Spaces, Inland Waterways and Ports of thebourgas_15112023_tariffa.pdf`,
    sha256: "41d802dd5a992617d2a2496f52e09ea4acd767c0b973781d864cb91edd5791aa" },
  varna: { placeholderId: "00000000-0000-4000-9000-000000004015", title: "BPI — Tariff for port fees, port under Art. 106a — Varna (board protocol 188/15.11.2023)", authority: "official",
    file: `${ZIP}Tariff for port fees collected by State Enterprise Port Infrastructure in a port within the meaning of Art. 106a of the Law on Maritime Spaces, Inland Waterways and Ports of the Repvarna_15112023_tariffa.pdf`,
    sha256: "071271508457ca0ed516fc01e34f186ae9e299b20d950395edd5ff598501aad6" },
  waste: { placeholderId: "00000000-0000-4000-9000-000000004016", title: "BPI — Tariff for port fees for reception and handling of ship waste (protocols 203/14.10.2024, 224/23.01.2026)", authority: "official",
    file: `${ZIP}Tariff for port fees for reception and handling of waste collected by Bulgarian Ports Infrastructure Companytarifa-otpadaczi-dppi_05032026.pdf`,
    sha256: "597ea501fdc6eee56874a402a1055bd1df4ff080a66e2e20dc49914b9c1e2feb" },
  priceList: { placeholderId: "00000000-0000-4000-9000-000000004007", title: "BPI — Price list of services (order РД09-24/24.02.2026)", authority: "official",
    file: `${ZIP}Price list of services offered by Bulgarian Ports Infrastrczenorazpis-rd-09-24.pdf`,
    sha256: "a2499b8c857f2fdb661e2a799476bea03678e79f6a7ea566844c08900e9fbf23" },
} as const;
type SourceKey = keyof typeof SOURCES;

type RuleJson = Omit<PdaTariffRule, "id" | "source"> & { sourceId: string; sourcePage: string; sourceExcerpt: string };
const src = (doc: SourceKey, page: string, excerpt: string) => ({ sourceId: SOURCES[doc].placeholderId, sourcePage: page, sourceExcerpt: excerpt });
function flatBands(edges: number[], amounts: number[]): PdaTariffBand[] {
  assert.equal(edges.length + 1, amounts.length);
  return amounts.map((flatAmount, i) => ({ order: i + 1, lowerBound: i === 0 ? 0 : edges[i - 1], upperBound: i < edges.length ? edges[i] : null, flatAmount }));
}

// SIT (light infrastructure fee), per call above 40 GT: 41–500 15; 501–1000 40; 1001–5000 70; 5001–10 000 110; над 10 000 150.
// Ships up to 40 GT pay an annual fee instead, so the rule starts at 41 GT.
const SIT_EDGES = [500, 1000, 5000, 10000];
const SIT = [15, 40, 70, 110, 150];
// B16 waste: GT bands 0–2 000 … > 50 001; indirect fees A (Annex I), A1 (Annex IV), A2 (Annex V), EUR per call.
const WASTE_EDGES = [2000, 3000, 6000, 10000, 20000, 30000, 40000, 50000];
const W_I = [45, 110, 140, 210, 230, 260, 460, 710, 910];
const W_IV = [15, 20, 25, 30, 35, 40, 45, 50, 60];
const W_V = [45, 70, 85, 105, 140, 200, 270, 420, 570];

export const RULES: RuleJson[] = [
  { code: "itd_access_fee", label: "Infrastructure access fee (ITD), per GT per call", basis: "manual_quote", priority: 10,
    applicability: { requestedServices: ["port_dues"] },
    manualInstructions: "ITD, general/bulk cargo ships (Кораби за генерални/насипни товари), EUR per GT per call: District I 0,59, District II 0,60 (Varna: east/west of 27°45'54\"E; Burgas: east/west of 27°29'00\"E — the tariff names no terminals, so the berth's district decides). Multipliers (only one applies, the most favourable): 4th and later call in the calendar year ×0,72; call without cargo operations (bunkers, stores, crew change, repairs) ×0,70; cabotage between Bulgarian ports ×0,20. Enter GT × rate × multiplier, rounded to whole euros.",
    ...src("varna", "Art. 1(1), Art. 2(1)–(3), p. 1–2 (Burgas identical for bulk)", "Кораби за генерални/насипни товари: Район I 0,59, Район II 0,60 EUR/GT") },
  { code: "sit_light_fee", label: "Light infrastructure fee (SIT), per call", basis: "tiered_flat", unit: "gt", priority: 20,
    applicability: { requestedServices: ["port_dues"], minGt: 41 }, bands: flatBands(SIT_EDGES, SIT),
    ...src("varna", "Art. 2(6)–(9), p. 2–3", "41–500 БТ 15; 501–1000 БТ 40; 1001–5000 БТ 70; 5001–10 000 БТ 110; над 10 000 БТ 150 евро при всяко посещение") },
  { code: "oit_operational_fee", label: "Operational infrastructure fee (OIT), per LOA metre per started hour", basis: "per_loa_hour", rate: 0.1, rounding: "started", unitSize: 1, priority: 30,
    applicability: { requestedServices: ["port_dues"] },
    ...src("varna", "Art. 2(15)–(16), p. 4", "0,10 евро за всеки започнат линеен метър от максималната дължина ... за периода от действителното време на пристигане до действителното време на напускане, без времето на рейд, в часове, закръглени към по-голямото цяло число") },
  { code: "waste_annex_i", label: "Ship waste, indirect fee, MARPOL Annex I (oily)", basis: "tiered_flat", unit: "gt", priority: 40,
    applicability: { requestedServices: ["waste"] }, bands: flatBands(WASTE_EDGES, W_I),
    ...src("waste", "table, column A, p. 1–2", "A: 45,00 / 110,00 / 140,00 / 210,00 / 230,00 / 260,00 / 460,00 / 710,00 / 910,00 EUR by GT band") },
  { code: "waste_annex_iv", label: "Ship waste, indirect fee, MARPOL Annex IV (sewage)", basis: "tiered_flat", unit: "gt", priority: 41,
    applicability: { requestedServices: ["waste"] }, bands: flatBands(WASTE_EDGES, W_IV),
    ...src("waste", "table, column A1, p. 1–2", "A1: 15,00 / 20,00 / 25,00 / 30,00 / 35,00 / 40,00 / 45,00 / 50,00 / 60,00 EUR by GT band") },
  { code: "waste_annex_v", label: "Ship waste, indirect fee, MARPOL Annex V (garbage)", basis: "tiered_flat", unit: "gt", priority: 42,
    applicability: { requestedServices: ["waste"] }, bands: flatBands(WASTE_EDGES, W_V),
    ...src("waste", "table, column A2, p. 1–2", "A2: 45,00 / 70,00 / 85,00 / 105,00 / 140,00 / 200,00 / 270,00 / 420,00 / 570,00 EUR by GT band") },
  { code: "clearance_certificate", label: "Departure clearance certificate", basis: "per_call", amount: 70, priority: 50,
    applicability: { requestedServices: ["port_dues"] },
    ...src("priceList", "item 1, p. 1", "За издаване на свидетелство за отплаване ... 70,00 (седемдесет) евро (prices exclude VAT)") },
];

export const MANIFEST = {
  package: "bulgaria-bpi-2026",
  ports: ["BGVAR", "BGBOJ"],
  currency: "EUR",
  effectiveFrom: "2026-03-05",
  publishable: true,
  blockers: [] as { id: string; text: string }[],
  dependsOn: [
    "20261007310000_pda_fx_rates (+ the 20261007320000 ECB feed): the USD route view needs a governed EUR → USD rate.",
  ],
  sources: SOURCES,
  knownLimits: [
    "Version date 2026-03-05 is the waste tariff's publication (file name); the port fees are in force since 15.11.2023 and the clearance price list since its order of 24.02.2026 (handwritten effective date read as 01.03.2026).",
    "ITD is a manual line: the rate depends on the berth's district (a meridian), which the tariffs do not map to terminals; the call-count, no-cargo and cabotage multipliers (one only) are applied by hand.",
    "OIT reads Art. 2(15) with (16): 0,10 € per started LOA metre for each started hour from arrival to departure, roads excluded. (15) does not literally say 'per hour' — confirm with BPI or the agent. The engine does not round LOA up (the tariff does); enter the LOA as a whole number.",
    "SIT applies from 41 GT; smaller craft pay an annual fee instead (not modelled).",
    "Waste: the fixed indirect fees only; landing above the free m³ (Б/Б1/Б2) is paid to the waste operators at their own tariff (no € figure in B16). A ship of exactly 50 001 GT is read as the top band.",
    "Not in the BPI pack: pilotage (state pilotage tariff), towage, mooring at the public terminals, agency, sanitary dues, cargo handling (terminal operators).",
  ],
};

function version(rules: RuleJson[]): PdaTariffVersion {
  return {
    id: "00000000-0000-4000-9000-000000004100", tariffSetId: "00000000-0000-4000-9000-000000004000",
    portLocode: "BGVAR", versionNo: 1, currency: "EUR", effectiveFrom: "2026-03-05", roundingMode: "half_up", decimalPlaces: 2,
    rules: rules.map((r, i) => ({ ...r, id: `00000000-0000-4000-9000-4100${String(i + 1).padStart(8, "0")}`,
      source: { sourceId: r.sourceId, title: "BPI tariffs", page: r.sourcePage, excerpt: r.sourceExcerpt } })) as PdaTariffRule[],
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

const call = (gt: number, loaM: number, days: number, hours: number) => ({
  portLocode: "BGVAR", callDate: "2026-10-07",
  vessel: { gt, loaM, vesselType: "Bulk Carrier" },
  call: { days, hours, cargoType: "Grain", cargoStatus: "laden" as const, voyageScope: "international" as const, location: "alongside" as const,
    requestedServices: ["port_dues", "waste"] },
});
const amounts = (r: ReturnType<typeof calculatePda>) => Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
const manual = (r: ReturnType<typeof calculatePda>) => r.warnings.filter((w) => w.code === "MANUAL_QUOTE_REQUIRED").map((w) => w.ruleCode).sort();

check("engine: 35,000 GT, 225 m bulk carrier, 3 days / 71.5 h in port", () => {
  const r = calculatePda(call(35000, 225, 3, 71.5), version(RULES));
  const a = amounts(r);
  assert.equal(a.sit_light_fee, 150);              // над 10 000 БТ
  assert.equal(a.oit_operational_fee, 1620);       // 0,10 × 225 m × 72 started hours
  assert.equal(a.waste_annex_i, 460);              // 30 001 – 40 000
  assert.equal(a.waste_annex_iv, 45);
  assert.equal(a.waste_annex_v, 270);
  assert.equal(a.clearance_certificate, 70);
  assert.deepEqual(manual(r), ["itd_access_fee"]);
  assert.equal(r.nativeCurrency, "EUR");
});

check("SIT bands as printed; nothing below 41 GT", () => {
  const sit = (gt: number) => amounts(calculatePda(call(gt, 60, 1, 10), version(RULES))).sit_light_fee;
  assert.equal(sit(40), undefined);
  assert.equal(sit(41), 15);
  assert.equal(sit(500), 15);
  assert.equal(sit(501), 40);
  assert.equal(sit(10000), 110);
  assert.equal(sit(10001), 150);
});

check("waste bands as printed, including the 50 000 / 50 001 edge", () => {
  const w = (gt: number) => { const a = amounts(calculatePda(call(gt, 150, 1, 10), version(RULES))); return [a.waste_annex_i, a.waste_annex_iv, a.waste_annex_v]; };
  assert.deepEqual(w(2000), [45, 15, 45]);
  assert.deepEqual(w(2001), [110, 20, 70]);
  assert.deepEqual(w(50000), [710, 50, 420]);
  assert.deepEqual(w(50001), [910, 60, 570]);
});

check("OIT without explicit hours uses the call days x 24 (the engine's governed default), started hours", () => {
  const req = call(35000, 225, 3, 0);
  const noHours = { ...req, call: { ...req.call, hours: null } };
  assert.equal(amounts(calculatePda(noHours, version(RULES))).oit_operational_fee, 1620); // 0,10 x 225 x 72
  assert.equal(amounts(calculatePda(call(35000, 225, 3, 2.25), version(RULES))).oit_operational_fee, 67.5); // 3 started hours
});

check("manifest: publishable, every source hashed, FX dependency stated", () => {
  assert.equal(MANIFEST.publishable, true);
  for (const s of Object.values(SOURCES)) assert.match(s.sha256, /^[0-9a-f]{64}$/);
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
console.log(`pda-bulgaria-package: ${passed} passed, ${failed} failed (${RULES.length} rules)`);
if (failed) process.exit(1);
