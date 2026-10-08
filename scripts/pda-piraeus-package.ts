// PDA tariff package: Piraeus Port Authority S.A. (PPA) port zone — cargo ships, 2026.
// Owner load order (5 Oct 2026): Egypt → Constanta → Greece PPA port-zone + waste.
//
// Writes docs/data/pda-tariffs/piraeus-ppa-2026/:
// - rules.json    — the rules in the exact shape `pda_replace_tariff_rules` takes
// - manifest.json — sources (one placeholder id per document, SHA-256 of the official
//                   PDF inside tmp/Data/GREEK PORTS.zip), dependency, known limits
// Every rate is copied from the official text (verbatim extraction in SOURCE-EXTRACTION.md);
// where the text leaves the count or the case open, the charge is a manual line.
//
//   node --import tsx scripts/pda-piraeus-package.ts          # check only
//   node --import tsx scripts/pda-piraeus-package.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePda } from "../lib/pda/calculate";
import type { PdaTariffBand, PdaTariffRule, PdaTariffVersion } from "../lib/pda/types";

const DIR = join(process.cwd(), "docs", "data", "pda-tariffs", "piraeus-ppa-2026");
const ZIP = "tmp/Data/GREEK PORTS.zip";

const SOURCES = {
  portZone: { placeholderId: "00000000-0000-4000-9000-000000003005", title: "PPA S.A. — Regulation and tariffs at the PPA port zone (June 2026)", authority: "official",
    file: `${ZIP} :: GREEK PORTS/REGULATIONS_AND_TARIFFS_at_PPA_PORT_ZONE_EN_JUNE_2026.pdf`, sha256: "032499a3a04a6f0069f7fe2f941497d765d56e381a49dae41dde3fe3315ea7aa" },
  liquidWaste: { placeholderId: "00000000-0000-4000-9000-000000003006", title: "PPA S.A. — System for covering the costs of liquid waste reception facilities (2026, from 1-5-2026)", authority: "official",
    file: `${ZIP} :: GREEK PORTS/SYSTEM FOR COVERING THE COSTS OF PROVIDING LIQUID WASTE RECEPTION FACILITIES FOR SHIPS  CARGO RESIDUES PPA SA_ 2026.pdf`, sha256: "7c1614f986fbd525f79c8d05ec5774420ede1e3ce4714a0d0981a5c7753d2988" },
  solidWaste: { placeholderId: "00000000-0000-4000-9000-000000003007", title: "PPA S.A. — System for covering the costs of solid waste reception facilities (Rev_2026_01)", authority: "official",
    file: `${ZIP} :: GREEK PORTS/SYSTEM FOR COVERING THE COSTS OF PROVIDING SOLID WASTE RECEPTION FACILITIES FOR SHIPS  CARGO RESIDUES_2026.pdf`, sha256: "2bf9546862fdf782797f954a600c9435feba11e7189bee06a1441c3f47a16c26" },
  tugs: { placeholderId: "00000000-0000-4000-9000-000000003008", title: "PPA S.A. — Regulation for the safe mooring and unmooring of ships subject to towing (no rates)", authority: "official",
    file: `${ZIP} :: GREEK PORTS/Tugboats_Regulation_EN.pdf`, sha256: "ff717b6cc61de64fbb52f814a7f8d4eafc25cc46770837dc75aea01178a03566" },
} as const;
type SourceKey = keyof typeof SOURCES;

type RuleJson = Omit<PdaTariffRule, "id" | "source"> & { sourceId: string; sourcePage: string; sourceExcerpt: string };
const src = (doc: SourceKey, page: string, excerpt: string) => ({ sourceId: SOURCES[doc].placeholderId, sourcePage: page, sourceExcerpt: excerpt });

// The waste tables band on GRT: 0-1,000 / 1,001-5,000 / 5,001-10,000 / 10,001-25,000 /
// 25,001-50,000 / >= 50,001. GT stands in for GRT (G5 6.5: international voyages are measured
// in GT under ITC 1969). Bands are inclusive and first match wins, so upper bounds
// 1000 ... 50000 reproduce the printed groups for integer tonnage with no gap.
const WASTE_EDGES = [1000, 5000, 10000, 25000, 50000];
const SIGMA_M = [1, 2, 3, 5, 8, 10];
function flatBands(coefficient: number): PdaTariffBand[] {
  return SIGMA_M.map((m, i) => ({
    order: i + 1, lowerBound: i === 0 ? 0 : WASTE_EDGES[i - 1], upperBound: i < WASTE_EDGES.length ? WASTE_EDGES[i] : null,
    flatAmount: Math.round(coefficient * m * 100) / 100,
  }));
}

export const RULES: RuleJson[] = [
  { code: "port_use", label: "Use of the port (per GT per arrival)", basis: "per_gt", rate: 0.061, priority: 10,
    applicability: { requestedServices: ["port_dues"] },
    ...src("portZone", "Art. 3 A.1 (p4-5)", "The charge is calculated for each arrival, based on the total capacity (GRT or G.T.) ... 1.3. Cargo ships and other vessels, including RoPax of foreign origin: From 1/4/2024 0,061") },
  { code: "berthing", label: "Berthing (per LOA metre per day)", basis: "per_loa_day", rate: 1.033, rounding: "started", priority: 11,
    applicability: { requestedServices: ["port_dues"], locations: ["alongside"] },
    ...src("portZone", "Art. 3 A.2 (p5); Art. 6.1 (p10)", "charged for each metre - based on their length overall (LOA) - and for each day of stay ... 2.3. Cargo ships ... From 1/4/2024 1,033. Fraction of a day is calculated as a whole day.") },
  { code: "anchorage", label: "Anchorage (per GT per undividable 15 days)", basis: "per_gt_day", rate: 0.397, rounding: "started", unitSize: 15, priority: 12,
    applicability: { requestedServices: ["port_dues"], locations: ["anchorage"] },
    ...src("portZone", "Art. 4.2 (p8)", "Ships / floating crafts anchored at the PPA port area between Salamina and Perama ... will be charged € 0,397, calculated per G.T. and undividable 15 days.") },
  { code: "mooring", label: "Mooring by PPA (per work step)", basis: "manual_quote", priority: 20,
    applicability: { requestedServices: ["mooring"] },
    manualInstructions: "PPA mooring: 600,00 € per work step (lashing or unlashing, i.e. making fast or letting go), from 1/4/2024, charged only \"In case the mooring is not provided by the pilotage service\". The tariff prints no number of steps per call; usually one to make fast and one to let go, plus any shift. Enter 600,00 x steps, or 0 when the pilotage service moors the ship.",
    ...src("portZone", "Art. 3 A.5 (p6-7)", "Cargo ships and other floating crafts including RoPax of foreign origin | Per work step (lashing or unlashing | As from 1/4/2024 600,00") },
  { code: "waste_liquid_oily", label: "Liquid (oily) waste reception fee (384 x σΜ)", basis: "tiered_flat", unit: "gt", priority: 30,
    applicability: { requestedServices: ["waste"] }, bands: flatBands(384),
    ...src("liquidWaste", "§3.1 (p3-4)", "Τ = σΤ x σΜ ... σΤ = liquid waste management fixed coefficient = 384; σΜ 1/2/3/5/8/10 by GRT: 384 / 768 / 1.152 / 1.920 / 3.072 / 3.840") },
  { code: "waste_sewage", label: "Sewage reception fee (169 x σΜ)", basis: "tiered_flat", unit: "gt", priority: 31,
    applicability: { requestedServices: ["waste"] }, bands: flatBands(169),
    ...src("liquidWaste", "§3.1 (p5)", "Fee = 169 x σμ: 169,00 / 338,00 / 507,00 / 845,00 / 1.352,00 / 1.690,00 €") },
  { code: "waste_solid", label: "Solid waste reception fee, cargo ships (174,75 x σΜ)", basis: "tiered_flat", unit: "gt", priority: 32,
    applicability: { requestedServices: ["waste"] }, bands: flatBands(174.75),
    ...src("solidWaste", "§3.1 a1 (p3)", "CARGO SHIPS (RO-RO, GENERAL CARGO, CONTAINER VESSELS etc), TANKERS ... σΤ = 174,75 ... 174,75 / 349,50 / 524,25 / 873,75 / 1.398,00 / 1.747,50") },
  { code: "towage", label: "Towage (private operators; PPA sets minimum tugs only)", basis: "manual_quote", priority: 40,
    applicability: { requestedServices: ["towage"] },
    manualInstructions: "PPA publishes no towage rates. Its tug regulation sets the minimum number of tugs and bollard pull for bulk carriers / general cargo by size category (I 0-100 ... IV 201-250, presumably LOA in metres), wind force and bow thruster. Enter the tug operator's quotation x tugs x moves.",
    ...src("tugs", "Bulk Carriers/ General Cargo table", "minimum tugs and bollard pull by size category, Beaufort 4/5/6, mooring and unmooring, with/without bow thruster; no rates") },
];

export const MANIFEST = {
  package: "piraeus-ppa-2026",
  portLocode: "GRPIR",
  currency: "EUR",
  effectiveFrom: "2026-05-01",
  publishable: true,
  blockers: [] as { id: string; text: string }[],
  dependsOn: [
    "20261007310000_pda_fx_rates: the route view shows USD; an EUR → USD governed FX rate must be recorded or every Piraeus leg stays FX_RATE_REQUIRED.",
  ],
  sources: SOURCES,
  knownLimits: [
    "Effective dates differ by document: port-zone rates from 1/4/2024 (June 2026 edition), liquid waste from 1-5-2026, solid waste Rev_2026_01; the version is dated 2026-05-01, the latest of them.",
    "Port use is charged on every arrival, including a call that only anchors (open question; exemption B.6 waives charges for anchoring ≤ 48 h for supplies or crew change).",
    "Berthing counts started calendar days (00.01-24.00); the 6-hour two-day rule (6.2), the 50 % alongside-another-ship discount (6.7) and stern berthing at 35 % are not applied.",
    "Anchorage is 0,397 per GT per started 15-day block; the printed text carries no effective date.",
    "Waste fees are prepaid on every call (80 % refunded when waste is delivered, per the waste systems); the full fee is shown. GT stands in for GRT. The 70 % transit discount at the anchorage (< 48 h) and the ship-repair coefficient (262,12) are not applied.",
    "The January CPI indexation clause of the waste systems is not applied beyond the printed figures.",
    "Mooring is a manual line (steps per call not printed; not charged when pilotage moors). Towage has no PPA rates.",
    "Not in the PPA pack: pilotage, light dues, agency, health, launch; VAT treatment is not stated.",
  ],
};

function version(rules: RuleJson[]): PdaTariffVersion {
  return {
    id: "00000000-0000-4000-9000-000000003100", tariffSetId: "00000000-0000-4000-9000-000000003000",
    portLocode: "GRPIR", versionNo: 1, currency: "EUR", effectiveFrom: "2026-05-01", roundingMode: "half_up", decimalPlaces: 2,
    rules: rules.map((r, i) => ({ ...r, id: `00000000-0000-4000-9000-3100${String(i + 1).padStart(8, "0")}`,
      source: { sourceId: r.sourceId, title: "PPA S.A. tariffs (2026)", page: r.sourcePage, excerpt: r.sourceExcerpt } })) as PdaTariffRule[],
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
    assert.ok(r.sourcePage && r.sourceExcerpt);
    if (r.basis === "manual_quote") assert.ok(r.manualInstructions && r.manualInstructions.length > 40);
    else assert.equal(r.manualInstructions, undefined);
    if (r.bands) {
      assert.equal(r.bands[0].lowerBound, 0);
      for (let i = 1; i < r.bands.length; i++) assert.equal(r.bands[i].lowerBound, r.bands[i - 1].upperBound);
      assert.equal(r.bands[r.bands.length - 1].upperBound, null);
    }
  });
}

const call = (gt: number, loaM: number, days: number, location: "alongside" | "anchorage") => ({
  portLocode: "GRPIR", callDate: "2026-10-07",
  vessel: { gt, loaM, vesselType: "Bulk Carrier" },
  call: { days, cargoType: "Grain", cargoStatus: "laden" as const, voyageScope: "international" as const, location,
    requestedServices: ["port_dues", "mooring", "towage", "waste"] },
});
const amounts = (r: ReturnType<typeof calculatePda>) => Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
const manual = (r: ReturnType<typeof calculatePda>) => r.warnings.filter((w) => w.code === "MANUAL_QUOTE_REQUIRED").map((w) => w.ruleCode).sort();

check("engine: 40,000 GT, 225 m bulk carrier alongside 3.2 days", () => {
  const r = calculatePda(call(40000, 225, 3.2, "alongside"), version(RULES));
  const a = amounts(r);
  assert.equal(a.port_use, 2440);            // 0,061 x 40,000
  assert.equal(a.berthing, 929.7);           // 1,033 x 225 m x 4 started days
  assert.equal(a.anchorage, undefined, "not at anchorage");
  assert.equal(a.waste_liquid_oily, 3072);   // 384 x 8 (25,001-50,000)
  assert.equal(a.waste_sewage, 1352);        // 169 x 8
  assert.equal(a.waste_solid, 1398);         // 174,75 x 8
  assert.deepEqual(manual(r), ["mooring", "towage"]);
  assert.equal(r.nativeCurrency, "EUR");
});

check("anchorage: 0,397 per GT per started 15-day block; no berthing", () => {
  const at = (days: number) => amounts(calculatePda(call(40000, 225, days, "anchorage"), version(RULES)));
  assert.equal(at(2).anchorage, 15880);      // 0,397 x 40,000 x 1 block
  assert.equal(at(15).anchorage, 15880);
  assert.equal(at(16).anchorage, 31760);     // second block started
  assert.equal(at(2).berthing, undefined);
});

check("waste bands follow the printed GRT groups (GT as GRT)", () => {
  const solid = (gt: number) => amounts(calculatePda(call(gt, 150, 2, "alongside"), version(RULES))).waste_solid;
  assert.equal(solid(1000), 174.75);
  assert.equal(solid(1001), 349.5);
  assert.equal(solid(25000), 873.75);
  assert.equal(solid(50000), 1398);
  assert.equal(solid(50001), 1747.5);
  const oily = (gt: number) => amounts(calculatePda(call(gt, 150, 2, "alongside"), version(RULES))).waste_liquid_oily;
  assert.equal(oily(5000), 768);
  assert.equal(oily(90000), 3840);
});

check("manifest: publishable, every source hashed, FX dependency stated", () => {
  assert.equal(MANIFEST.publishable, true);
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

console.log(`pda-piraeus-package: ${passed} passed, ${failed} failed (${RULES.length} rules)`);
if (failed) process.exit(1);
