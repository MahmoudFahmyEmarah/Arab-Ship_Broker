// Egyptian port tariff package: Ministerial Decree 488/2015 (charges for
// services to vessels in Egyptian seaports, foreign-flag USD rates, as amended
// by 416/2019) plus the per-call agency charges of Decree 800/2016 (+417/2019).
//
// Produces, in docs/data/pda-tariffs/egypt-488-2015/:
// - rules.foreign-usd.json — the rules in the exact shape `pda_replace_tariff_rules`
//   accepts, one placeholder source id per instrument (sources in manifest.json);
// - rules.deferred-cleanliness-by-class.json — the four automatic cleanliness
//   columns, to be enabled only once a call carries a confirmed tariff cargo class;
// - manifest.json — sources, load blockers and the proposed cargo-class mapping.
// It proves the rules with the real engine (lib/pda/calculate.ts). Nothing is
// loaded into any database, and the package stays unpublishable while
// manifest.blockers is non-empty (audit C2B-007). Values are the 2015/2016 face
// values, labelled as base rates until the owner supplies current ones (README).
//
//   node --import tsx scripts/pda-egypt-488-package.ts          # check only
//   node --import tsx scripts/pda-egypt-488-package.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { calculatePda } from "../lib/pda/calculate";
import type { PdaTariffBand, PdaTariffRule, PdaTariffVersion } from "../lib/pda/types";

const DIR = join(process.cwd(), "docs", "data", "pda-tariffs", "egypt-488-2015");

// One placeholder per instrument; each is replaced by that document's registered
// tariff_sources.id at load, so rule-level provenance stays true.
const SOURCES = {
  d488: {
    placeholderId: "00000000-0000-4000-9000-000000000488",
    title: "Ministerial Decree 488/2015 — charges for services to vessels in Egyptian seaports",
    authority: "statutory",
    file: "tmp/Data/EGY 3.Ministerial Decree No.488 of 2015 (full version).20211211214808-2021-12-11media_manager214747.pdf",
    sha256: "b2d326ddf92b86bc895b4380efc1c66c7da142dcf629971206fd19f4e408b9ad",
    reference: { file: "tmp/Data/Ministry_of_Transport_Decree_No._488_of_2015.pdf", sha256: "1da870dbdcab59fbffebe7e6d8a1d04bc401ce02a8f3c161123a72af56d2017f", note: "English translation; the Arabic gazette wins where they differ" },
  },
  d416: {
    placeholderId: "00000000-0000-4000-9000-000000000416",
    title: "Ministerial Decree 416/2019 amending 488/2015",
    authority: "statutory",
    file: "tmp/Data/EGY4. Ministerial Decree No.416 of 2019 on” amending some provisions of Ministerial Decree No. 488 of 2015″ (full version).20211211214717-2021-12-11media_manager214714.pdf",
    sha256: "e8a896262882c7008ebb1ef2d61fdd569602bc42983b98fc8458a1b424e415ce",
    note: "Referenced, no rate taken from it: escalation suspended 3 years from 8 Sep 2019; light-dues reductions for calls combined with a Suez transit (not applied, see README).",
  },
  d800: {
    placeholderId: "00000000-0000-4000-9000-000000000800",
    title: "Ministerial Decree 800/2016 — maritime agency and related charges",
    authority: "statutory",
    file: "tmp/Data/EGY 2.nisterial Decree No.800 of 2016 (full version ).20211211214623-2021-12-11media_manager214621.pdf",
    sha256: "2dc69f9e1a5407f56a9da4b626a612e93d690f8e0bf2bcf5c47b5c41d1465221",
  },
  d417: {
    placeholderId: "00000000-0000-4000-9000-000000000417",
    title: "Ministerial Decree 417/2019 amending 800/2016",
    authority: "statutory",
    file: "tmp/Data/EGY 1.Ministerial Decree No.417 of 2019 on” amending some provisions of Ministerial Decree No.800 of 2016″ (full version ).20211211214540-2021-12-11media_manager2145051.pdf",
    sha256: "3959483d52d8cdbcd707cc0b5349ea2ed65072749063b814d01ba615e606bafd",
    note: "Referenced, no rate taken from it.",
  },
} as const;
type SourceKey = keyof typeof SOURCES;

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

// No flag or tariff-treatment condition: the engine has no such input, and a
// voyage scope is not a flag (C2B-007 #2). Publishing is blocked until it has one.
const src = (doc: SourceKey, page: string, excerpt: string) =>
  ({ sourceId: SOURCES[doc].placeholderId, sourcePage: page, sourceExcerpt: excerpt });

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
const CLEAN_LABELS = ["<=300", "301-999", "1,000-4,999", "5,000-9,999", "10,000-19,999", "20,000-29,999", "30,000-39,999", "40,000-49,999", "50,000-59,999", ">=60,000"];

// Agency fee, Decree 800/2016 Art. 45, one port, USD per foreign cargo ship for the
// first 5 days: <=3,000 500; <=5,000 600; <=10,000 800; <=20,000 1,000; <=40,000 1,200;
// then +200 per additional (started) 10,000 GRT. Automatic up to 300,000 GT only;
// above that, and for two-port/Suez calls or extra days, a manual line (C2B-007 #4).
const AGENCY_MAX_GT = 300000;
const AGENCY_EDGES = [3000, 5000, 10000, 20000, 40000];
const AGENCY = [500, 600, 800, 1000, 1200];
for (let upper = 50000, amt = 1400; upper <= AGENCY_MAX_GT; upper += 10000, amt += 200) {
  AGENCY_EDGES.push(upper);
  AGENCY.push(amt);
}
AGENCY.push(AGENCY[AGENCY.length - 1] + 200); // open end required by the RPC; unreachable (maxGt)

export const RULES: RuleJson[] = [
  { code: "port_dues", label: "Port dues (foreign, per GRT per call)", basis: "per_gt", rate: 0.35, priority: 10,
    applicability: { requestedServices: ["port_dues"] },
    ...src("d488", "Art. 2 §6-1", "Port dues: 35 cents per GRT (foreign vessels, §6)") },
  { code: "light_dues", label: "Light dues (foreign, per GRT; full rate — may be 10–25 % lower when the call is combined with a Suez Canal transit, Decree 416/2019)", basis: "per_gt", rate: 0.15, priority: 11,
    applicability: { requestedServices: ["port_dues"] },
    ...src("d488", "Art. 2 §6-5", "Light dues 15 cents per GRT. Full rate; the 416/2019 reductions for calls combined with a Suez transit are not applied.") },
  { code: "berthing_dues", label: "Berthing dues (USD 0.02 per GRT per day)", basis: "manual_quote", priority: 12,
    applicability: { requestedServices: ["port_dues"] },
    manualInstructions: "USD 0.02 x GRT x days alongside or at anchorage/buoy. Part of a day counts as a day; the day starts at midnight. (The engine has no GT x days basis yet.)",
    ...src("d488", "Art. 2 §6-2", "Berthing dues 2 cents per GRT per day") },
  { code: "stay_fee", label: "Stay fee (USD 0.02 per GRT per day, conditional)", basis: "manual_quote", priority: 13,
    applicability: { requestedServices: ["port_dues"] },
    manualInstructions: "USD 0.02 x GRT x days, from day 16 of berthing OR from the day after cargo operations end, whichever is first. Enter 0 when neither applies.",
    ...src("d488", "Art. 2 §6-3", "Stay fee 2 cents per GRT per day from the 16th day or the day after operations end") },
  { code: "pilotage_arrival", label: "Pilotage in (outer anchorage to berth)", basis: "tiered_flat", unit: "gt", priority: 20,
    applicability: { requestedServices: ["pilotage"] }, bands: bands(PILOT_EDGES, PILOT_4_1),
    ...src("d488", "Art. 2 §4-1", "Pilotage, foreign vessels, outer anchorage <-> berth, USD per movement by GRT band") },
  { code: "pilotage_departure", label: "Pilotage out (berth to outer anchorage)", basis: "tiered_flat", unit: "gt", priority: 21,
    applicability: { requestedServices: ["pilotage"] }, bands: bands(PILOT_EDGES, PILOT_4_1),
    ...src("d488", "Art. 2 §4-1", "Pilotage, foreign vessels, outer anchorage <-> berth, USD per movement by GRT band") },
  { code: "towage", label: "Towage (USD per tug per hour)", basis: "manual_quote", priority: 30,
    applicability: { requestedServices: ["towage"] },
    manualInstructions: "USD per tug per hour by GT: <=300 500; 301-999 650 (on request); 1,000-4,999 700 (min 1 tug); 5,000-9,999 750; 10,000-19,999 800; 20,000-29,999 850; 30,000-39,999 900; 40,000-49,999 950; 50,000-59,999 1,000; 60,000-79,999 1,200; 80,000-99,999 1,400; 100,000-119,999 1,600; 120,000-139,999 1,800; 140,000-159,999 2,000; 160,000-179,999 2,200; 180,000-199,999 2,400; >=200,000 2,600. From 5,000 GT minimum 2 tugs per movement. Compulsory above 999 GT. Part hour = hour; minimum hours Port Tawfik/El-Zeitiat 2, Adabiya/Safaga 3, East Port Said 2. +100% outside the port; +30% sunset-sunrise, weekends, official holidays. Multiply by tugs x hours x movements.",
    ...src("d488", "Art. 5", "Towage for pilotage, foreign vessels, USD per tug per hour") },
  { code: "mooring", label: "Mooring boats (USD per boat per hour)", basis: "manual_quote", priority: 31,
    applicability: { requestedServices: ["mooring"] },
    manualInstructions: "USD per mooring boat per hour by GT: <=300 15; 301-999 20; 1,000-4,999 30; 5,000-9,999 50; 10,000-19,999 75; 20,000-29,999 100; 30,000-39,999 125; 40,000-49,999 160; 50,000-59,999 200; >=60,000 240. Same +100% / +30% surcharges and minimum hours as towage. Multiply by boats x hours x operations (mooring and unmooring).",
    ...src("d488", "Art. 6", "Mooring, foreign vessels, USD per mooring boat per hour") },
  // One line for every call, never silently absent: the call's cargo vocabulary is
  // not the tariff's cargo class (C2B-007 #3). The automatic columns are deferred.
  { code: "cleanliness_fee", label: "Cleanliness (garbage) fee, by GT and tariff cargo class", basis: "manual_quote", priority: 40,
    manualInstructions: `USD per call by GT band (${CLEAN_LABELS.join(" | ")}). ` +
      Object.entries(CLEAN).map(([k, v]) => `${k.replace("_", " ")}: ${v.join(", ")}`).join("; ") +
      ". Choose the column for the cargo actually carried (container / general cargo / clean bulk / unclean bulk).",
    ...src("d488", "Art. 7", "Cleanliness fee, foreign vessels, USD per call, by GT band and cargo type") },
  { code: "waste_reception", label: "Waste reception (USD 25 per ton, min 10 t)", basis: "manual_quote", priority: 50,
    applicability: { requestedServices: ["waste"] },
    manualInstructions: "Port-authority waste reception: USD 25 per ton, minimum 10 tons (USD 250). Incinerator USD 150/t; garbage truck USD 75/h. Add the 15% Chapter 2 administration charge.",
    ...src("d488", "Ch. 2 §1-8-1", "Waste reception USD 25/ton foreign, minimum 10 tons") },
  { code: "sailing_permit", label: "Sailing permit", basis: "flat", amount: 30, priority: 60,
    ...src("d488", "Art. 2 §6-6", "Sailing permit USD 30 (other vessels)") },
  { code: "berthing_form", label: "Berthing form", basis: "flat", amount: 5, priority: 61,
    ...src("d488", "Art. 2 §6", "Berthing form USD 5") },
  { code: "site_occupation", label: "Site occupation (USD 12 per LOA metre per day, conditional)", basis: "manual_quote", priority: 62,
    applicability: { requestedServices: ["port_dues"] },
    manualInstructions: "Only when berthed without commercial work for reasons not attributable to the port authority, or in bad weather: USD 12 x LOA (m, part metre = metre) x days. Enter 0 otherwise.",
    ...src("d488", "Art. 4", "Site-occupation charge USD 12 per metre LOA per day (foreign)") },
  { code: "seamens_club", label: "Seamen's Club contribution (Decree 800/2016)", basis: "flat", amount: 25, priority: 70,
    ...src("d800", "Art. 9(4-2)", "Seamen's Club USD 25 per foreign vessel call, collected by the agent") },
  { code: "agency_fee", label: "Agency fee, one port, first 5 days (Decree 800/2016)", basis: "tiered_flat", unit: "gt", priority: 80,
    applicability: { requestedServices: ["agency"], maxGt: AGENCY_MAX_GT }, bands: bands(AGENCY_EDGES, AGENCY),
    ...src("d800", "Art. 45", "Shipping agency fees, USD per foreign vessel, one port, first 5 days, by GRT band; +200 per additional 10,000 GRT above 40,000") },
  { code: "agency_fee_above_300000_gt", label: "Agency fee above 300,000 GT (Decree 800/2016)", basis: "manual_quote", priority: 81,
    applicability: { requestedServices: ["agency"], minGt: AGENCY_MAX_GT + 1 },
    manualInstructions: "One port, first 5 days: USD 1,200 + 200 per started 10,000 GRT above 40,000 (e.g. 300,001-310,000 GT = 6,600).",
    ...src("d800", "Art. 45", "Shipping agency fees: +200 per additional 10,000 GRT above 40,000, without upper limit") },
  { code: "agency_fee_adjustments", label: "Agency fee: two ports, Suez transit or extra days", basis: "manual_quote", priority: 82,
    applicability: { requestedServices: ["agency"] },
    manualInstructions: "Enter 0 for a one-port call of up to 5 days. Two ports or a Suez transit: replace the one-port fee with the other column (800, 900, 1,200, 1,500, 1,800, then +250 per started 10,000 GRT) and enter the difference here. Each additional day (or part) after day 5: +10% of the band rate, unless the delay is due to repair or force majeure.",
    ...src("d800", "Art. 45", "Two-port / Suez-transit column and +10% per additional day after the first 5 days") },
];

// Enabled only when the request carries a confirmed tariff cargo class; then they
// replace `cleanliness_fee` (C2B-007 #3).
export const DEFERRED_CLEANLINESS: RuleJson[] = Object.entries(CLEAN).map(([cargo, amounts], i): RuleJson => ({
  code: `cleanliness_fee_${cargo}`, label: `Cleanliness (garbage) fee: ${cargo.replace("_", " ")}`,
  basis: "tiered_flat", unit: "gt", priority: 41 + i,
  applicability: { cargoTypes: [cargo] }, bands: bands(CLEAN_EDGES, amounts),
  ...src("d488", "Art. 7", `Cleanliness fee, foreign vessels, USD per call, ${cargo} column, by GT band`),
}));

export const MANIFEST = {
  package: "egypt-488-2015",
  publishable: true,
  ownerRuling: "5 Oct 2026: publish the 2015/2016 face values, labelled as base rates (not escalated), until fresh data is provided.",
  blockers: [] as { id: string; finding: string; text: string; owner: string }[],
  resolved: [
    {
      id: "flag-treatment",
      finding: "C2B-007 #2",
      text: "Resolved in PDA Wave 2 (20261007300000): every rule declares applicability.flagTreatments ['foreign']. The route flow resolves the flag state server-side (public.flag_states) and the engine derives the treatment against the port country; a national (EG) vessel gets no line from this foreign-USD set, and an unknown flag raises MISSING_INPUT.",
      owner: "PDA owner (Opus B, Wave 2; Codex audits)",
    },
  ],
  sources: SOURCES,
  deferred: {
    file: "rules.deferred-cleanliness-by-class.json",
    replaces: "cleanliness_fee",
    condition: "the request carries a tariff cargo class confirmed by the user",
    proposedMapping: {
      note: "Proposal for the PDA owner; the user confirms the class on each estimate. Platform cargo types are Grain / Dry Bulk / Break Bulk.",
      Grain: "clean_bulk",
      "Break Bulk": "general_cargo",
      "Dry Bulk": "clean_bulk or unclean_bulk by commodity (e.g. clinker, coal, phosphate rock, petcoke = unclean_bulk) — user choice, no default",
      Container: "container",
    },
  },
  knownLimits: [
    "Light dues are charged at the full rate; the 416/2019 reductions for calls combined with a Suez transit (−10 % / −20 %, Suez-only −25 %) are not applied. OWNER WAIVER (8 Oct 2026, C2O-090 B2C-035 P1-3): accepted as a labelled over-estimate; the line label says so.",
    "One tariff set per port (EGALY, EGDAM, EGPSD, EGSOK, …) with the same rules; minimum towage/mooring hours differ by port (towage instructions).",
  ],
};

function version(rules: RuleJson[]): PdaTariffVersion {
  return {
    id: "00000000-0000-4000-9000-0000000004a8", tariffSetId: "00000000-0000-4000-9000-0000000004a9",
    portLocode: "EGALY", versionNo: 1, currency: "USD", effectiveFrom: "2015-09-08",
    roundingMode: "half_up", decimalPlaces: 2,
    rules: rules.map((r, i) => ({
      ...r, id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
      source: { sourceId: r.sourceId, title: "Egyptian decrees 488/2015 / 800/2016", page: r.sourcePage, excerpt: r.sourceExcerpt },
    })) as PdaTariffRule[],
  };
}

// Wave 2: these are the foreign-flag USD tables, so every rule says so (C2B-007 #2 resolved).
for (const r of [...RULES, ...DEFERRED_CLEANLINESS]) {
  r.applicability = { ...(r.applicability ?? {}), flagTreatments: ["foreign"] };
}

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}

const placeholderIds = new Set<string>(Object.values(SOURCES).map((s) => s.placeholderId));

// Structural checks mirroring pda_replace_tariff_rules.
for (const r of [...RULES, ...DEFERRED_CLEANLINESS]) {
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
    else assert.equal(r.manualInstructions, undefined, "instructions on an automatic rule raise no warning; use a manual line");
    assert.ok(placeholderIds.has(r.sourceId), "source id is one of the manifest's instruments");
    assert.equal(r.applicability?.voyageScopes, undefined, "voyage scope is not a flag proxy");
    assert.ok(r.sourcePage && r.sourceExcerpt);
  });
}

check("provenance: each instrument's rules cite that instrument", () => {
  const by = (doc: SourceKey) => RULES.filter((r) => r.sourceId === SOURCES[doc].placeholderId).map((r) => r.code);
  assert.deepEqual(by("d800").sort(), ["agency_fee", "agency_fee_above_300000_gt", "agency_fee_adjustments", "seamens_club"]);
  assert.equal(by("d488").length, RULES.length - 4);
  assert.deepEqual(by("d416"), []);
  assert.deepEqual(by("d417"), []);
});

check("manifest: publishable only with no open blocker", () => {
  assert.equal(MANIFEST.blockers.length, 0);
  assert.equal(MANIFEST.publishable, true);
  assert.ok(MANIFEST.resolved.some((x) => x.id === "flag-treatment"));
});

check("every rule is foreign-flag only", () => {
  for (const r of [...RULES, ...DEFERRED_CLEANLINESS]) assert.deepEqual(r.applicability?.flagTreatments, ["foreign"], r.code);
});

const call = (gt: number, cargoType: string | undefined, loaM: number) => ({
  portLocode: "EGALY", callDate: "2026-10-05",
  vessel: { gt, nt: Math.round(gt * 0.6), loaM, vesselType: "bulk_carrier", flagState: "PA" as string | null },
  call: { days: 4, cargoType, cargoStatus: "laden" as const, voyageScope: "international" as const, location: "alongside" as const,
    requestedServices: ["port_dues", "pilotage", "towage", "mooring", "agency", "waste"] },
});
const amounts = (r: ReturnType<typeof calculatePda>) => Object.fromEntries(r.lines.map((l) => [l.ruleCode, l.amount]));
const manualCodes = (r: ReturnType<typeof calculatePda>) =>
  r.warnings.filter((w) => w.code === "MANUAL_QUOTE_REQUIRED").map((w) => w.ruleCode).sort();

check("engine: 40,000 GT bulk call", () => {
  const r = calculatePda(call(40000, "Dry Bulk", 225), version(RULES));
  const by = amounts(r);
  assert.equal(by.port_dues, 14000);
  assert.equal(by.light_dues, 6000);
  assert.equal(by.pilotage_arrival, 2627);   // 40,000 GT is the first ton of the 40,000-49,999 band
  assert.equal(by.pilotage_departure, 2627);
  assert.equal(by.agency_fee, 1200);          // <= 40,000 GRT
  assert.equal(by.sailing_permit, 30);
  assert.equal(by.berthing_form, 5);
  assert.equal(by.seamens_club, 25);
  assert.equal(r.coverage, "partial");
  assert.deepEqual(manualCodes(r), ["agency_fee_adjustments", "berthing_dues", "cleanliness_fee", "mooring", "site_occupation", "stay_fee", "towage", "waste_reception"]);
});

check("cleanliness is never silently absent, whatever the cargo vocabulary", () => {
  for (const cargo of ["Dry Bulk", "Break Bulk", "Grain", "clean_bulk", undefined]) {
    const r = calculatePda(call(25000, cargo, 190), version(RULES));
    assert.ok(manualCodes(r).includes("cleanliness_fee"), `cargo ${cargo}`);
  }
});

check("deferred cleanliness columns, once a tariff class is confirmed", () => {
  const rules = [...RULES.filter((r) => r.code !== "cleanliness_fee"), ...DEFERRED_CLEANLINESS];
  const by = amounts(calculatePda(call(40000, "clean_bulk", 225), version(rules)));
  assert.equal(by.cleanliness_fee_clean_bulk, 325);
  assert.equal(by.cleanliness_fee_unclean_bulk, undefined, "only the matching column applies");
  assert.equal(amounts(calculatePda(call(25000, "general_cargo", 190), version(rules))).cleanliness_fee_general_cargo, 220);
  assert.equal(amounts(calculatePda(call(300, "container", 60), version(rules))).cleanliness_fee_container, 50); // "<= 300"
});

check("agency fee: automatic to 300,000 GT, manual above", () => {
  const at = (gt: number) => calculatePda(call(gt, "Dry Bulk", 300), version(RULES));
  assert.equal(amounts(at(3000)).agency_fee, 500);     // "<= 3,000"
  assert.equal(amounts(at(3001)).agency_fee, 600);     // "> 3,000-5,000"
  assert.equal(amounts(at(40001)).agency_fee, 1400);   // first started 10,000 GRT above 40,000
  assert.equal(amounts(at(50001)).agency_fee, 1600);
  assert.equal(amounts(at(300000)).agency_fee, 6400);  // 1,200 + 26 x 200
  const above = at(300001);
  assert.equal(amounts(above).agency_fee, undefined);
  assert.ok(manualCodes(above).includes("agency_fee_above_300000_gt"));
  assert.ok(!manualCodes(at(300000)).includes("agency_fee_above_300000_gt"));
});

check("flag treatment: a national (EG) vessel gets nothing from the foreign set; an unknown flag is MISSING_INPUT", () => {
  const national = { ...call(40000, "Dry Bulk", 225) };
  national.vessel = { ...national.vessel, flagState: "EG" };
  const n = calculatePda(national, version(RULES));
  assert.equal(n.lines.length, 0, "no foreign-USD line for an Egyptian-flag vessel");
  assert.equal(n.warnings.filter((w) => w.code === "MISSING_INPUT").length, 0);
  const unknown = { ...call(40000, "Dry Bulk", 225) };
  unknown.vessel = { ...unknown.vessel, flagState: null };
  const u = calculatePda(unknown, version(RULES));
  assert.equal(u.lines.length, 0, "never guessed");
  assert.ok(u.warnings.some((w) => w.code === "MISSING_INPUT" && /flag state/.test(w.message)), "names the missing flag state");
});

check("pilotage band edges follow the decree wording", () => {
  const amt = (gt: number) => amounts(calculatePda(call(gt, "Dry Bulk", 150), version(RULES))).pilotage_arrival;
  assert.equal(amt(999), 167);   // "< 1,000"
  assert.equal(amt(1000), 273);  // "1,000-4,999"
});

const OUTPUTS: [string, unknown][] = [
  ["rules.foreign-usd.json", RULES],
  ["rules.deferred-cleanliness-by-class.json", DEFERRED_CLEANLINESS],
  ["manifest.json", MANIFEST],
];
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

console.log(`pda-egypt-488-package: ${passed} passed, ${failed} failed (${RULES.length} rules + ${DEFERRED_CLEANLINESS.length} deferred)`);
if (failed) process.exit(1);
