// Egyptian port tariff package: Ministerial Decree 488/2015 (charges for
// services to vessels in Egyptian seaports, foreign-flag USD rates, as amended
// by 416/2019) plus the per-call agency charges of Decree 800/2016 (+417/2019).
//
// Produces docs/data/pda-tariffs/egypt-488-2015/rules.foreign-usd.json in the
// exact shape `pda_replace_tariff_rules` accepts, and proves it with the real
// engine (lib/pda/calculate.ts) on two sample calls. Nothing is loaded into
// any database: an admin registers the source, creates a DRAFT version, pastes
// these rules, and publishes through the PDA maker/checker flow, labelled as
// 2015/2016 base rates until the owner supplies current ones (README).
//
//   node --import tsx scripts/pda-egypt-488-package.ts          # check only
//   node --import tsx scripts/pda-egypt-488-package.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { calculatePda } from "../lib/pda/calculate";
import type { PdaTariffBand, PdaTariffRule, PdaTariffVersion } from "../lib/pda/types";

const SOURCE_ID = "00000000-0000-4000-9000-000000000488"; // replaced by the registered tariff_sources.id at load
const OUT = join(process.cwd(), "docs", "data", "pda-tariffs", "egypt-488-2015", "rules.foreign-usd.json");

type RuleJson = Omit<PdaTariffRule, "id" | "source"> & {
  sourceId: string; sourcePage: string; sourceExcerpt: string;
};

// Bands: inclusive at both ends, first match wins (lib/pda/calculate.ts#findBand),
// contiguous from 0 and open at the end (pda_replace_tariff_rules). For "from N"
// style bands the upper bound is N-1 (gross tonnage is an integer).
function bands(edges: number[], amounts: number[]): PdaTariffBand[] {
  assert.equal(edges.length + 1, amounts.length, "one more amount than inner edges");
  return amounts.map((amt, i) => ({
    order: i + 1,
    lowerBound: i === 0 ? 0 : edges[i - 1],
    upperBound: i < edges.length ? edges[i] : null,
    flatAmount: amt,
  }));
}

const INTL = { voyageScopes: ["international" as const] }; // proxy for "foreign-flag" (the engine has no flag field)
const src = (page: string, excerpt: string) => ({ sourceId: SOURCE_ID, sourcePage: page, sourceExcerpt: excerpt });

// Pilotage, foreign vessels, outer anchorage <-> berth (Art. 2 §4-1), USD per movement.
const PILOT_EDGES = [999, 4999, 9999, 19999, 29999, 39999, 49999, 59999];
const PILOT_4_1 = [167, 273, 381, 802, 1055, 1870, 2627, 2772, 3261];

// Cleanliness fee, foreign (Art. 7), USD per call, GT band x cargo type.
const CLEAN_EDGES = [300, 999, 4999, 9999, 19999, 29999, 39999, 49999, 59999];
const CLEAN = {
  container: [50, 60, 70, 80, 90, 100, 110, 120, 130, 140],
  general_cargo: [120, 140, 160, 180, 200, 220, 240, 260, 280, 300],
  clean_bulk: [150, 175, 200, 225, 250, 275, 300, 325, 350, 375],
  unclean_bulk: [200, 225, 250, 275, 300, 325, 350, 375, 400, 425],
};

// Agency fee, Decree 800/2016 Art. 45, one port, USD per foreign cargo ship for the
// first 5 days: <=3,000 500; <=5,000 600; <=10,000 800; <=20,000 1,000; <=40,000 1,200;
// then +200 per additional (started) 10,000 GRT. Stepped to 300,000 GT, then open.
const AGENCY_EDGES = [3000, 5000, 10000, 20000, 40000];
const AGENCY = [500, 600, 800, 1000, 1200];
for (let upper = 50000, amt = 1400; upper <= 300000; upper += 10000, amt += 200) {
  AGENCY_EDGES.push(upper);
  AGENCY.push(amt);
}
AGENCY.push(AGENCY[AGENCY.length - 1] + 200);

export const RULES: RuleJson[] = [
  { code: "port_dues", label: "Port dues (foreign, per GRT per call)", basis: "per_gt", rate: 0.35, priority: 10,
    applicability: { ...INTL, requestedServices: ["port_dues"] },
    ...src("Art. 2 §6-1", "Port dues: 35 cents per GRT (foreign vessels, §6)") },
  { code: "light_dues", label: "Light dues (foreign, per GRT)", basis: "per_gt", rate: 0.15, priority: 11,
    applicability: { ...INTL, requestedServices: ["port_dues"] },
    ...src("Art. 2 §6-5; 416/2019 Art. 2", "Light dues 15 cents per GRT. 416/2019: -10% if a Suez transit also calls one Egyptian port, -20% for two or more; Suez-only transits pay once at Suez with 25% off (enter those as manual adjustments).") },
  { code: "berthing_dues", label: "Berthing dues (USD 0.02 per GRT per day)", basis: "manual_quote", priority: 12,
    applicability: { ...INTL, requestedServices: ["port_dues"] },
    manualInstructions: "USD 0.02 x GRT x days alongside or at anchorage/buoy. Part of a day counts as a day; the day starts at midnight. (The engine has no GT x days basis yet.)",
    ...src("Art. 2 §6-2", "Berthing dues 2 cents per GRT per day") },
  { code: "stay_fee", label: "Stay fee (USD 0.02 per GRT per day, conditional)", basis: "manual_quote", priority: 13,
    applicability: { ...INTL, requestedServices: ["port_dues"] },
    manualInstructions: "USD 0.02 x GRT x days, from day 16 of berthing OR from the day after cargo operations end, whichever is first. Enter 0 when neither applies.",
    ...src("Art. 2 §6-3", "Stay fee 2 cents per GRT per day from the 16th day or the day after operations end") },
  { code: "pilotage_arrival", label: "Pilotage in (outer anchorage to berth)", basis: "tiered_flat", unit: "gt", priority: 20,
    applicability: { ...INTL, requestedServices: ["pilotage"] }, bands: bands(PILOT_EDGES, PILOT_4_1),
    ...src("Art. 2 §4-1", "Pilotage, foreign vessels, outer anchorage <-> berth, USD per movement by GRT band") },
  { code: "pilotage_departure", label: "Pilotage out (berth to outer anchorage)", basis: "tiered_flat", unit: "gt", priority: 21,
    applicability: { ...INTL, requestedServices: ["pilotage"] }, bands: bands(PILOT_EDGES, PILOT_4_1),
    ...src("Art. 2 §4-1", "Pilotage, foreign vessels, outer anchorage <-> berth, USD per movement by GRT band") },
  { code: "towage", label: "Towage (USD per tug per hour)", basis: "manual_quote", priority: 30,
    applicability: { ...INTL, requestedServices: ["towage"] },
    manualInstructions: "USD per tug per hour by GT: <=300 500; 301-999 650 (on request); 1,000-4,999 700 (min 1 tug); 5,000-9,999 750; 10,000-19,999 800; 20,000-29,999 850; 30,000-39,999 900; 40,000-49,999 950; 50,000-59,999 1,000; 60,000-79,999 1,200; 80,000-99,999 1,400; 100,000-119,999 1,600; 120,000-139,999 1,800; 140,000-159,999 2,000; 160,000-179,999 2,200; 180,000-199,999 2,400; >=200,000 2,600. From 5,000 GT minimum 2 tugs per movement. Compulsory above 999 GT. Part hour = hour; minimum hours Port Tawfik/El-Zeitiat 2, Adabiya/Safaga 3, East Port Said 2. +100% outside the port; +30% sunset-sunrise, weekends, official holidays. Multiply by tugs x hours x movements.",
    ...src("Art. 5", "Towage for pilotage, foreign vessels, USD per tug per hour") },
  { code: "mooring", label: "Mooring boats (USD per boat per hour)", basis: "manual_quote", priority: 31,
    applicability: { ...INTL, requestedServices: ["mooring"] },
    manualInstructions: "USD per mooring boat per hour by GT: <=300 15; 301-999 20; 1,000-4,999 30; 5,000-9,999 50; 10,000-19,999 75; 20,000-29,999 100; 30,000-39,999 125; 40,000-49,999 160; 50,000-59,999 200; >=60,000 240. Same +100% / +30% surcharges and minimum hours as towage. Multiply by boats x hours x operations (mooring and unmooring).",
    ...src("Art. 6", "Mooring, foreign vessels, USD per mooring boat per hour") },
  ...Object.entries(CLEAN).map(([cargo, amounts], i): RuleJson => ({
    code: `cleanliness_fee_${cargo}`, label: `Cleanliness (garbage) fee: ${cargo.replace("_", " ")}`,
    basis: "tiered_flat", unit: "gt", priority: 40 + i,
    applicability: { ...INTL, cargoTypes: [cargo] }, bands: bands(CLEAN_EDGES, amounts),
    ...src("Art. 7", `Cleanliness fee, foreign vessels, USD per call, ${cargo} column, by GT band`),
  })),
  { code: "waste_reception", label: "Waste reception (USD 25 per ton, min 10 t)", basis: "manual_quote", priority: 50,
    applicability: { ...INTL, requestedServices: ["waste"] },
    manualInstructions: "Port-authority waste reception: USD 25 per ton, minimum 10 tons (USD 250). Incinerator USD 150/t; garbage truck USD 75/h. Add the 15% Chapter 2 administration charge.",
    ...src("Ch. 2 §1-8-1", "Waste reception USD 25/ton foreign, minimum 10 tons") },
  { code: "sailing_permit", label: "Sailing permit", basis: "flat", amount: 30, priority: 60,
    applicability: { ...INTL }, ...src("Art. 2 §6-6", "Sailing permit USD 30 (other vessels)") },
  { code: "berthing_form", label: "Berthing form", basis: "flat", amount: 5, priority: 61,
    applicability: { ...INTL }, ...src("Art. 2 §6", "Berthing form USD 5") },
  { code: "site_occupation", label: "Site occupation (USD 12 per LOA metre per day, conditional)", basis: "manual_quote", priority: 62,
    applicability: { ...INTL, requestedServices: ["port_dues"] },
    manualInstructions: "Only when berthed without commercial work for reasons not attributable to the port authority, or in bad weather: USD 12 x LOA (m, part metre = metre) x days. Enter 0 otherwise.",
    ...src("Art. 4", "Site-occupation charge USD 12 per metre LOA per day (foreign)") },
  { code: "seamens_club", label: "Seamen's Club contribution (Decree 800/2016)", basis: "flat", amount: 25, priority: 70,
    applicability: { ...INTL }, ...src("800/2016 Art. 9(4-2)", "Seamen's Club USD 25 per foreign vessel call, collected by the agent") },
  { code: "agency_fee", label: "Agency fee, one port, first 5 days (Decree 800/2016)", basis: "tiered_flat", unit: "gt", priority: 80,
    applicability: { ...INTL, requestedServices: ["agency"] }, bands: bands(AGENCY_EDGES, AGENCY),
    manualInstructions: "Each additional day (or part) after the first 5: +10% of the band rate, unless delay is due to repair or force majeure; add as a manual line. Two ports / Suez transit use the other column (800, 900, 1,200, 1,500, 1,800, +250 per 10,000 GRT).",
    ...src("800/2016 Art. 45", "Shipping agency fees, USD per foreign vessel, one port, first 5 days, by GRT band; +200 per additional 10,000 GRT above 40,000") },
];

function version(rules: RuleJson[]): PdaTariffVersion {
  return {
    id: "00000000-0000-4000-9000-0000000004a8", tariffSetId: "00000000-0000-4000-9000-0000000004a9",
    portLocode: "EGALY", versionNo: 1, currency: "USD", effectiveFrom: "2015-09-08",
    roundingMode: "half_up", decimalPlaces: 2,
    rules: rules.map((r, i) => ({
      ...r, id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
      source: { sourceId: r.sourceId, title: "Ministerial Decree 488/2015 (+416/2019) / 800/2016", page: r.sourcePage, excerpt: r.sourceExcerpt },
    })) as PdaTariffRule[],
  };
}

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}

// Structural checks mirroring pda_replace_tariff_rules.
for (const r of RULES) {
  check(`${r.code}: structure`, () => {
    assert.match(r.code, /^[a-z][a-z0-9_]{1,79}$/);
    if (["tiered_flat", "tiered_rate", "progressive"].includes(r.basis)) {
      assert.ok(r.unit && r.bands?.length, "banded rule needs unit and bands");
      const b = r.bands!;
      assert.equal(b[0].lowerBound, 0, "starts at zero");
      for (let i = 1; i < b.length; i++) assert.equal(b[i].lowerBound, b[i - 1].upperBound, `contiguous at band ${i + 1}`);
      assert.equal(b[b.length - 1].upperBound, null, "ends open");
      b.slice(0, -1).forEach((x) => assert.ok(x.upperBound != null));
    }
    if (r.basis === "manual_quote") assert.ok(r.manualInstructions && r.manualInstructions.length > 20);
    assert.ok(r.sourcePage && r.sourceExcerpt);
  });
}

const call = (gt: number, cargoType: string, loaM: number) => ({
  portLocode: "EGALY", callDate: "2026-10-05",
  vessel: { gt, nt: Math.round(gt * 0.6), loaM, vesselType: "bulk_carrier" },
  call: { days: 4, cargoType, cargoStatus: "laden" as const, voyageScope: "international" as const, location: "alongside" as const,
    requestedServices: ["port_dues", "pilotage", "towage", "mooring", "agency", "waste"] },
});

check("engine: 40,000 GT clean bulk call", () => {
  const r = calculatePda(call(40000, "clean_bulk", 225), version(RULES));
  const by = Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
  assert.equal(by.port_dues, 14000);
  assert.equal(by.light_dues, 6000);
  assert.equal(by.pilotage_arrival, 2627);   // 40,000 GT is the first ton of the 40,000-49,999 band
  assert.equal(by.pilotage_departure, 2627);
  assert.equal(by.cleanliness_fee_clean_bulk, 325);
  assert.equal(by.agency_fee, 1200);          // <= 40,000 GRT
  assert.equal(by.sailing_permit, 30);
  assert.equal(by.berthing_form, 5);
  assert.equal(by.seamens_club, 25);
  assert.equal(r.coverage, "partial");
  const manual = r.warnings.filter((w) => w.code === "MANUAL_QUOTE_REQUIRED").map((w) => w.ruleCode).sort();
  assert.deepEqual(manual, ["berthing_dues", "mooring", "site_occupation", "stay_fee", "towage", "waste_reception"]);
});

check("engine: 25,000 GT general cargo call", () => {
  const r = calculatePda(call(25000, "general_cargo", 190), version(RULES));
  const by = Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
  assert.equal(by.port_dues, 8750);
  assert.equal(by.light_dues, 3750);
  assert.equal(by.pilotage_arrival, 1055);
  assert.equal(by.cleanliness_fee_general_cargo, 220);
  assert.equal(by.agency_fee, 1200);
  assert.equal(by.cleanliness_fee_clean_bulk, undefined, "only the matching cargo column applies");
});

check("band edges follow the decree wording", () => {
  const amt = (code: string, gt: number) => {
    const r = calculatePda({ ...call(gt, "container", 150) }, version(RULES));
    return r.lines.find((l) => l.ruleCode === code)?.amount;
  };
  assert.equal(amt("pilotage_arrival", 999), 167);   // "< 1,000"
  assert.equal(amt("pilotage_arrival", 1000), 273);  // "1,000-4,999"
  assert.equal(amt("agency_fee", 3000), 500);        // "<= 3,000"
  assert.equal(amt("agency_fee", 3001), 600);        // "> 3,000-5,000"
  assert.equal(amt("agency_fee", 40001), 1400);      // first additional 10,000 GRT block
  assert.equal(amt("agency_fee", 50001), 1600);
  assert.equal(amt("cleanliness_fee_container", 300), 50); // "<= 300"
});

const json = JSON.stringify(RULES, null, 2) + "\n";
if (process.argv.includes("--write")) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
} else {
  check("committed JSON equals the generator output", () => {
    assert.ok(existsSync(OUT), "run with --write first");
    assert.equal(readFileSync(OUT, "utf8").replace(/\r\n/g, "\n"), json);
  });
}

console.log(`pda-egypt-488-package: ${passed} passed, ${failed} failed (${RULES.length} rules)`);
if (failed) process.exit(1);
