// PDA tariff package: CN APM S.A. Constanta (Constanta, Midia, Mangalia, partly Basarabi),
// "valid as from 15.09.2026" (owner load order: Egypt first, then Constanta; 5 Oct 2026).
//
// Writes docs/data/pda-tariffs/constanta-2026/:
// - rules.json    — the rules in the exact shape `pda_replace_tariff_rules` takes
// - manifest.json — sources (one placeholder id per document, SHA-256 of the official
//                   PDF inside tmp/Data/ROMANIA PORTS.zip), dependencies, known limits
// It proves the rules with the real engine (lib/pda/calculate.ts). Nothing is loaded into
// any database. Every rate is copied from the official page text (verbatim extraction in
// the README); where the page is ambiguous the charge is a manual line, never a guess.
//
//   node --import tsx scripts/pda-constanta-package.ts          # check only
//   node --import tsx scripts/pda-constanta-package.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePda } from "../lib/pda/calculate";
import type { PdaTariffBand, PdaTariffRule, PdaTariffVersion } from "../lib/pda/types";

const DIR = join(process.cwd(), "docs", "data", "pda-tariffs", "constanta-2026");
const ZIP = "tmp/Data/ROMANIA PORTS.zip";
const FOLDER = "ROMANIA PORTS/1. Tariffs for services attached to water transport in the port of Constanta (Constanta area, Midia area, Mangalia area and partially Basarabi area)/";

const SOURCES = {
  access: { placeholderId: "00000000-0000-4000-9000-000000001101", title: "CN APM Constanta tariffs 1.1 — access tariff", authority: "official",
    file: `${ZIP} :: ${FOLDER}1.Port of Constanta – Tariffs.pdf`, sha256: "3aee32646aadb9df54d9bbecad62ae0576ab7efc384ea913e8ca3c60c77d2838" },
  dockage: { placeholderId: "00000000-0000-4000-9000-000000001102", title: "CN APM Constanta tariffs 1.2 — key (dockage) tariff", authority: "official",
    file: `${ZIP} :: ${FOLDER}2.Port of Constanta – Tariffs.pdf`, sha256: "b7e319f16c02121c2537dfc66fb82e5874b73388ac8177d52fe0dc40aef67dd0" },
  basin: { placeholderId: "00000000-0000-4000-9000-000000001103", title: "CN APM Constanta tariffs 1.3 — basin tariff", authority: "official",
    file: `${ZIP} :: ${FOLDER}3.Port of Constanta – Tariffs.pdf`, sha256: "914cea186fd9b5edf14e44995ebacf8cbac8e1ac05f2909312e0b5457f748bcc" },
  security: { placeholderId: "00000000-0000-4000-9000-000000001105", title: "CN APM Constanta tariffs 1.5 — special tariffs (safety and security)", authority: "official",
    file: `${ZIP} :: ${FOLDER}5.Port of Constanta – Tariffs.pdf`, sha256: "00c2761e157f26f0396cfd53dbc91ec38c41114f838780d580386fb9873c7317" },
  waste: { placeholderId: "00000000-0000-4000-9000-000000001109", title: "CN APM Constanta tariffs 1.9 — ship waste reception tariffs (GO 9/2022)", authority: "official",
    file: `${ZIP} :: ${FOLDER}9.Port of Constanta – Tariffs.pdf`, sha256: "6e2f58faefe0d374654bc20967e25571d57543d00b3b272d5ac94d190734b44d" },
  pilotage: { placeholderId: "00000000-0000-4000-9000-000000001110", title: "CN APM Constanta tariffs 1.10 — maritime vessel pilotage tariffs", authority: "official",
    file: `${ZIP} :: ${FOLDER}10.Port of Constanta – Tariffs.pdf`, sha256: "71e5dd08de32c1843b3446ee66f9c1cee3ede6e90ea05ca95e5159e5cb6f94b3",
    duplicate: { file: `${ZIP} :: ${FOLDER}10.0Port of Constanta – Tariffs.pdf`, sha256: "3bdd66387cf87e6a0dbc62fb34e8a52800eb868ed6d930672b6f0c6ce1e9907d", note: "same content; only the print timestamps differ" } },
  towage: { placeholderId: "00000000-0000-4000-9000-000000001199", title: "CN APM Constanta — towage (licensed operators, no rates)", authority: "official",
    file: `${ZIP} :: ROMANIA PORTS/TOWAGE Port of Constanta – Tariffs.pdf`, sha256: "38b537ab31367986db7889d725f69abf621c04dc523345e2cbdd4a3dc6e1be15" },
} as const;
type SourceKey = keyof typeof SOURCES;

type RuleJson = Omit<PdaTariffRule, "id" | "source"> & { sourceId: string; sourcePage: string; sourceExcerpt: string };
const src = (doc: SourceKey, page: string, excerpt: string) => ({ sourceId: SOURCES[doc].placeholderId, sourcePage: page, sourceExcerpt: excerpt });

// The printed GT groups: 0-5000 / 5001-10000 / 10001-20000 / 20001-45000 / 45001- 70000 / >70000.
// Bands are inclusive at both ends and first match wins, so upper bounds 5000 ... 70000
// reproduce the printed groups for integer GT and leave no gap for a fractional GT.
const GT_EDGES = [5000, 10000, 20000, 45000, 70000];
function rateBands(rates: number[]): PdaTariffBand[] {
  assert.equal(rates.length, GT_EDGES.length + 1);
  return rates.map((rate, i) => ({ order: i + 1, lowerBound: i === 0 ? 0 : GT_EDGES[i - 1], upperBound: i < GT_EDGES.length ? GT_EDGES[i] : null, rate }));
}
// For per-day/LOA rates that vary by GT group there is no banded per_loa_day basis, so each
// group is its own rule with a GT range; minGt sits just above the previous edge, so one and
// only one group applies to every GT (proved below for integers and fractions).
const GT_RANGES = GT_EDGES.map((edge, i) => ({ minGt: i === 0 ? 0 : GT_EDGES[i - 1] + 0.000001, maxGt: edge }))
  .concat([{ minGt: GT_EDGES[GT_EDGES.length - 1] + 0.000001, maxGt: undefined as unknown as number }]);
const GT_LABELS = ["0-5000", "5001-10000", "10001-20000", "20001-45000", "45001- 70000", ">70000"];

// 1.10 pilotage: "0,102(*) / 0,067 / 0,047 / 0,041 / 0,037 / 0,037" euros/UTB/maneuver; the last
// group prints as "> 7000", read as >70000 (it follows 45001 - 70000). Minimum 114 euro per
// service in the 0-5000 group only; above 5000 GT the per-GT amount always exceeds 114
// (5001 x 0,067 = 335), so a rule-level minimum of 114 is exactly the printed rule.
const PILOT = [0.102, 0.067, 0.047, 0.041, 0.037, 0.037];
// 1.2 dockage, 2.7 bulk carriers, €/m-day on LOA x days.
const DOCK_LISTED = [3.735, 5.852, 9.96, 11.204, 18.673, 26.142]; // (a) coal and derivatives, phosphates, apatite, iron ore, bauxite
const DOCK_OTHER = [1.867, 2.927, 4.981, 5.602, 9.336, 13.071];   // (b) other cargoes
// 1.3 basin, bulk carrier row, printed "€/UTB" while the text says LOA x days (see manual line).
const BASIN_BULK = ["0,651", "0,576", "0,534", "0,501", "0,480", "0,448"];

const listRates = (rates: (number | string)[]) => rates.map((r, i) => `${GT_LABELS[i]} GT ${String(r).replace(".", ",")}`).join("; ");

export const RULES: RuleJson[] = [
  { code: "access_fee", label: "Access tariff (per GT per entry)", basis: "per_gt", rate: 0.155, priority: 10,
    applicability: { requestedServices: ["port_dues"] },
    ...src("access", "1.1, table 1 (1/9)", "applied to the ship's GT, for each entry of the ship into the port ... Bulk carrier €/UTB 0.155 in every GT group") },
  { code: "basin_fee", label: "Basin tariff (unit to confirm)", basis: "manual_quote", priority: 11,
    applicability: { requestedServices: ["port_dues"] },
    manualInstructions: `1.3 basin tariff, bulk carrier row as printed: ${listRates(BASIN_BULK)} (€/UTB). The page prints the unit €/UTB (per GT), but its text says it "is applied to the maximum length of the ship (LOA) and the number of days of call in the port" and its footnotes use EURO/m - day. Confirm the basis with CN APM or the agent before entering the amount.`,
    ...src("basin", "1.3 (1/4, 3/4-4/4)", "Bulk carrier €/UTB 0,651 / 0,576 / 0,534 / 0,501 / 0,480 / 0,448; basis sentence: LOA x days") },
  ...DOCK_OTHER.map((rate, i): RuleJson => ({
    code: `dockage_other_cargo_${i + 1}`, label: `Dockage, bulk carrier, other cargoes (GT ${GT_LABELS[i]})`, basis: "per_loa_day", rate, priority: 20 + i,
    applicability: { requestedServices: ["port_dues"], vesselTypes: ["Bulk Carrier"], cargoTypes: ["Grain"],
      minGt: GT_RANGES[i].minGt, ...(GT_RANGES[i].maxGt != null ? { maxGt: GT_RANGES[i].maxGt } : {}) },
    ...src("dockage", "1.2, 2.7 (4/6)", `when operating other cargoes ... Bulk carrier €/m-day ${String(rate).replace(".", ",")} (GT ${GT_LABELS[i]}); applies to LOA and the number of days of call`),
  })),
  { code: "dockage_bulk_cargo_class", label: "Dockage, bulk carrier (cargo class to confirm)", basis: "manual_quote", priority: 30,
    applicability: { requestedServices: ["port_dues"], vesselTypes: ["Bulk Carrier"], cargoTypes: ["Dry Bulk", "Break Bulk"] },
    manualInstructions: `1.2 dockage, €/m-day x LOA x days. (a) "coal and derivatives, phosphates, apatite, iron ore, bauxite (or other derivatives)", including idle berthing: ${listRates(DOCK_LISTED)}. (b) other cargoes: ${listRates(DOCK_OTHER)}. Mixed cargo: the class with the highest quantity. Choose the class for this cargo and enter LOA x days x rate.`,
    ...src("dockage", "1.2, 2.7 (3/6-4/6)", "Bulk cargo (listed cargoes) 3,735 ... 26,142; Bulk carrier (other cargoes) 1,867 ... 13,071 €/m-day") },
  { code: "dockage_other_vessel_types", label: "Dockage, other vessel types", basis: "manual_quote", priority: 31,
    applicability: { requestedServices: ["port_dues"], vesselTypes: ["Cargo Ship", "General Cargo", "Other"] },
    manualInstructions: "1.2 dockage, €/m-day x LOA x days, 2.8 cargo ships: listed bulk cargoes (coal and derivatives, phosphates, apatite, iron ore, bauxite) 3,921 / 4,673 / 6,914 / 7,090 / 7,282 / 7,522; any other cargo, including idle berthing, 2,614 / 3,116 / 4,609 / 4,727 / 4,855 / 5,015 (GT groups 0-5000 ... >70000). Other ship types: see the 1.2 tables.",
    ...src("dockage", "1.2, 2.8 (4/6-5/6)", "Cargo (listed bulk) 3,921 ... 7,522; Cargo (other) 2,614 ... 5,015 €/m-day") },
  { code: "pilotage_entry", label: "Pilotage, port entry manoeuvre", basis: "tiered_rate", unit: "gt", priority: 40, minimumAmount: 114,
    applicability: { requestedServices: ["pilotage"] }, bands: rateBands(PILOT),
    ...src("pilotage", "1.10 (1/8)", "0,102(*) / 0,067 / 0,047 / 0,041 / 0,037 / 0,037 euros/UTB/maneuver; (*) minimum 114 euro/ship/service in the 0-5000 group") },
  { code: "pilotage_exit", label: "Pilotage, port exit manoeuvre", basis: "tiered_rate", unit: "gt", priority: 41, minimumAmount: 114,
    applicability: { requestedServices: ["pilotage"] }, bands: rateBands(PILOT),
    ...src("pilotage", "1.10 (1/8)", "The tariffs apply for each arrival/departure/movement maneuver of ships in the port.") },
  { code: "security_fee", label: "Safety and security tariff (per GT per call)", basis: "per_gt", rate: 0.08, priority: 50, minimumAmount: 215,
    applicability: { requestedServices: ["security"] },
    ...src("security", "1.5 (1/1)", "for seagoing vessels = 0.080 EURO/UGT (but not less than 215 EURO/ship); each ship that performs loading/unloading operations in the port berths belonging to the Administration, each call") },
  { code: "waste_fixed", label: "Ship waste reception, indirect tariff, fixed component", basis: "per_call", amount: 191, priority: 60,
    applicability: { requestedServices: ["waste"] },
    ...src("waste", "1.9, table no. 1 (1/7)", "Fixed component 191 EUR/call") },
  { code: "waste_variable", label: "Ship waste reception, indirect tariff, variable component", basis: "per_gt", rate: 0.027, priority: 61, maximumAmount: 945,
    applicability: { requestedServices: ["waste"] },
    ...src("waste", "1.9, table no. 1 (1/7)", "Variable component 0.027 EUR/GRT, maximum 35.000 GRT; total maximum 1.136 EUR (= 191 + 0.027 x 35,000; variable part capped at 945)") },
  { code: "towage", label: "Towage (licensed operators' tariffs)", basis: "manual_quote", priority: 70,
    applicability: { requestedServices: ["towage"] },
    manualInstructions: "CN APM publishes no towage rates: towage is provided by licensed operators (Harbour Towage S.R.L., Coremar S.A., Black Sea Services S.R.L.; Midia Shipyard for its own vessels). Enter the operator's quotation.",
    ...src("towage", "Towage (1/1)", "since 1 Aug 2012 through specialized and authorised operators, under the contracts concluded between our company and these operators") },
];

export const MANIFEST = {
  package: "constanta-2026",
  portLocode: "ROCND",
  currency: "EUR",
  effectiveFrom: "2026-09-15",
  publishable: true,
  blockers: [] as { id: string; text: string }[],
  dependsOn: [
    "20261007310000_pda_fx_rates: the route view shows USD; an EUR → USD governed FX rate must be recorded (admin, Port Tariffs → FX rates) or every Constanta leg stays FX_RATE_REQUIRED.",
  ],
  sources: SOURCES,
  knownLimits: [
    "Basin tariff 1.3 is a manual line: the page prints €/UTB but describes LOA x days (open question for CN APM).",
    "Dockage for Dry Bulk / Break Bulk needs the tariff cargo class (listed coal/ore/phosphate/apatite/bauxite vs other); only Grain is automatic (other cargoes).",
    "Dockage days are the call days as entered; the page prints no started-day rule or minimum. The repair/idle/2nd-line rate is cut off on the printed page.",
    "Pilotage counts one entry and one exit manoeuvre; shifting, split legs (outer dock → inner dock → berth) and the +30 % weekend/holiday, +10 % night, +15 % dangerous goods, +100 % dead ship surcharges and the -10 % return-within-30-days discount are not applied.",
    "Access: the 0,132 re-call-within-30-days rate and the liner rates are not applied (no call-history input).",
    "Safety and security applies to calls that load/unload at Administration berths; deselect 'Security' for a call that does not.",
    "Waste: GRT is taken as GT. The 50 % green reduction and the liner fixed component (47.75 €/call) are not applied.",
    "Not in the CN APM pack: towage rates (operators), mooring/boatmen, Romanian Naval Authority/harbour-master fees, light dues, agency, sanitary fees, cargo handling.",
  ],
};

function version(rules: RuleJson[]): PdaTariffVersion {
  return {
    id: "00000000-0000-4000-9000-000000001100", tariffSetId: "00000000-0000-4000-9000-000000001000",
    portLocode: "ROCND", versionNo: 1, currency: "EUR", effectiveFrom: "2026-09-15", roundingMode: "half_up", decimalPlaces: 2,
    rules: rules.map((r, i) => ({ ...r, id: `00000000-0000-4000-9000-1100${String(i + 1).padStart(8, "0")}`,
      source: { sourceId: r.sourceId, title: "CN APM Constanta tariffs (15.09.2026)", page: r.sourcePage, excerpt: r.sourceExcerpt } })) as PdaTariffRule[],
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
    assert.ok(ids.has(r.sourceId), "source id is one of the manifest's documents");
    assert.ok(r.sourcePage && r.sourceExcerpt);
    if (r.basis === "manual_quote") assert.ok(r.manualInstructions && r.manualInstructions.length > 40);
    else assert.equal(r.manualInstructions, undefined);
    if (r.bands) {
      assert.equal(r.bands[0].lowerBound, 0);
      for (let i = 1; i < r.bands.length; i++) assert.equal(r.bands[i].lowerBound, r.bands[i - 1].upperBound);
      assert.equal(r.bands[r.bands.length - 1].upperBound, null);
    }
    assert.equal(r.applicability?.flagTreatments, undefined, "Constanta charges Romanian and foreign flags alike");
  });
}

const call = (gt: number, loaM: number, cargoType: string, days = 3, vesselType = "Bulk Carrier") => ({
  portLocode: "ROCND", callDate: "2026-10-07",
  vessel: { gt, loaM, vesselType },
  call: { days, cargoType, cargoStatus: "laden" as const, voyageScope: "international" as const, location: "alongside" as const,
    requestedServices: ["port_dues", "pilotage", "towage", "waste", "security"] },
});
const amounts = (r: ReturnType<typeof calculatePda>) => Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
const manual = (r: ReturnType<typeof calculatePda>) => r.warnings.filter((w) => w.code === "MANUAL_QUOTE_REQUIRED").map((w) => w.ruleCode).sort();

check("engine: 40,000 GT, 225 m bulk carrier, grain, 3 days", () => {
  const r = calculatePda(call(40000, 225, "Grain"), version(RULES));
  const a = amounts(r);
  assert.equal(a.access_fee, 6200);                 // 0.155 x 40,000
  assert.equal(a.pilotage_entry, 1640);             // 0,041 x 40,000 (20001-45000)
  assert.equal(a.pilotage_exit, 1640);
  assert.equal(a.security_fee, 3200);               // 0.080 x 40,000
  assert.equal(a.waste_fixed, 191);
  assert.equal(a.waste_variable, 945);              // 0.027 x 40,000 = 1,080, capped at 0.027 x 35,000
  assert.equal(a.dockage_other_cargo_4, 3781.35);   // 5,602 x 225 m x 3 days
  assert.equal(Object.keys(a).filter((k) => k.startsWith("dockage")).length, 1, "exactly one dockage group");
  assert.deepEqual(manual(r), ["basin_fee", "towage"]);
  assert.equal(r.nativeCurrency, "EUR");
});

check("waste never exceeds the printed maximum 1.136 EUR; below the cap it is 191 + 0.027 x GT", () => {
  const w = (gt: number) => { const a = amounts(calculatePda(call(gt, 190, "Grain"), version(RULES))); return a.waste_fixed + a.waste_variable; };
  assert.equal(w(90000), 1136);
  assert.equal(w(35000), 1136);
  assert.equal(w(20000), 731);                     // 191 + 540
});

check("pilotage: minimum 114 in the 0-5000 group, band edges as printed", () => {
  const p = (gt: number) => amounts(calculatePda(call(gt, 90, "Grain"), version(RULES))).pilotage_entry;
  assert.equal(p(800), 114);        // 0,102 x 800 = 81.6 -> minimum 114
  assert.equal(p(5000), 510);       // 0,102 x 5,000 (0-5000)
  assert.equal(p(5001), 335.07);    // 0,067 x 5,001
  assert.equal(p(70000), 2590);     // 0,037 x 70,000 (45001- 70000)
  assert.equal(p(80000), 2960);     // ">7000" read as >70000: 0,037
});

check("dockage: exactly one GT group applies to every integer and fractional GT", () => {
  const dock = RULES.filter((r) => r.code.startsWith("dockage_other_cargo_"));
  const hits = (gt: number) => dock.filter((r) => gt >= (r.applicability!.minGt ?? 0) && (r.applicability!.maxGt == null || gt <= r.applicability!.maxGt));
  for (let gt = 1; gt <= 200000; gt += 1) assert.equal(hits(gt).length, 1, `GT ${gt}`);
  for (const gt of [5000.5, 10000.25, 45000.9, 70000.01]) assert.equal(hits(gt).length, 1, `GT ${gt}`);
  assert.equal(hits(5000)[0].code, "dockage_other_cargo_1");
  assert.equal(hits(5001)[0].code, "dockage_other_cargo_2");
  assert.equal(hits(70001)[0].code, "dockage_other_cargo_6");
});

check("dry bulk needs the tariff cargo class; other vessel types get the 2.8 manual line", () => {
  const dry = calculatePda(call(40000, 225, "Dry Bulk"), version(RULES));
  assert.equal(Object.keys(amounts(dry)).some((k) => k.startsWith("dockage")), false);
  assert.ok(manual(dry).includes("dockage_bulk_cargo_class"));
  const cargoShip = calculatePda(call(15000, 150, "Break Bulk", 2, "General Cargo"), version(RULES));
  assert.ok(manual(cargoShip).includes("dockage_other_vessel_types"));
});

check("manifest: publishable, every source hashed, FX dependency stated", () => {
  assert.equal(MANIFEST.publishable, true);
  assert.equal(MANIFEST.blockers.length, 0);
  for (const s of Object.values(SOURCES)) assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.ok(MANIFEST.dependsOn.some((d) => d.startsWith("20261007310000_pda_fx_rates")));
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

console.log(`pda-constanta-package: ${passed} passed, ${failed} failed (${RULES.length} rules)`);
if (failed) process.exit(1);
