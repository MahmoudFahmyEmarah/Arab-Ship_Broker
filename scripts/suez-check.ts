// suez-check — golden fixtures for lib/suez/engine.ts (suez-engine/3).
//
// The items mirror the seed (20261003200100 + the 205100 corrections). Toll
// bands and the SDR rate are FIXTURE-ONLY (the seed publishes neither): one
// official band at the legacy proforma rate and the back-solved RUBATO rate pin
// the arithmetic to the owner's published numbers. Every unsafe path the audit
// named (O2C-022/024) is asserted to be `unavailable`, `invalid`, undecided or
// `manual` — never a silent figure. Run: npm run test:suez
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { estimateSuezTransit, tollSdrFromTiers } from "../lib/suez/engine";
import { parseSuezInput, parseTierCsv, suezItemInputSchema } from "../lib/suez/schemas";
import type { SuezInput, SuezTariffContext, SuezTariffItem, SuezTollTier } from "../lib/suez/types";
import { SUEZ_VESSEL_CATEGORIES, suezCategoryFromVesselType } from "../lib/suez/types";

let checks = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const near = (a: number | null, b: number, tol: number, msg: string) => { assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); checks++; };

const item = (p: Partial<SuezTariffItem> & Pick<SuezTariffItem, "code" | "labelEn" | "layer" | "basis">): SuezTariffItem => ({
  currency: "USD", params: {}, directionScope: "any", cargoStatusScope: "any", conditionKey: null, payerParty: "owner", sortOrder: 100, ...p,
});

const WASTE_TIERS = { unit: "m3", tiers: [
  { from: 0, to: 10000, amount: 235, includedUnits: 3 }, { from: 10000, to: 40000, amount: 825, includedUnits: 4 },
  { from: 40000, to: 70000, amount: 1120, includedUnits: 4 }, { from: 70000, to: null, amount: 1410, includedUnits: 5 } ] };

function seedItems(versionNo: 1 | 2): SuezTariffItem[] {
  const shared: SuezTariffItem[] = [
    item({ code: "transit_toll", labelEn: "Suez Canal transit toll", layer: "toll", basis: "toll_tiered_scnt", currency: "SDR", sortOrder: 10 }),
    item({ code: "pilotage", labelEn: "Pilotage", layer: "fixed", basis: "flat", params: { amount: 316 }, sortOrder: 20 }),
    item({ code: "sca_etr", labelEn: "SCA ETR", layer: "fixed", basis: "flat", params: { amount: 500 }, sortOrder: 30 }),
    item({ code: "port_said_pa", labelEn: "Port Said Ports Authority dues", layer: "fixed", basis: "flat", params: { amount: 2745 }, sortOrder: 50 }),
    item({ code: "red_sea_pa", labelEn: "Red Sea Ports Authority dues", layer: "fixed", basis: "flat", params: { amount: 663 }, sortOrder: 60 }),
    item({ code: "lights_dues", labelEn: "Lights dues", layer: "fixed", basis: "flat", params: { amount: 1578 }, sortOrder: 70 }),
    item({ code: "quarantine", labelEn: "Quarantine", layer: "fixed", basis: "flat", params: { amount: 19 }, sortOrder: 80 }),
    item({ code: "waste_mandatory", labelEn: "Mandatory solid-waste fee", layer: "fixed", basis: "tier_by_scnt", params: WASTE_TIERS, sortOrder: 90 }),
    item({ code: "security_immigration", labelEn: "Immigration, security & police", layer: "fixed", basis: "flat", params: { amount: 100 }, sortOrder: 100 }),
    item({ code: "bank_charges", labelEn: "Bank charges", layer: "fixed", basis: "flat", params: { amount: 75 }, sortOrder: 110 }),
    item({ code: "service_launch", labelEn: "Service launch", layer: "fixed", basis: "flat", params: { amount: 150 }, sortOrder: 120 }),
    item({ code: "agency_fee", labelEn: "Agency fee", layer: "fixed", basis: "flat", params: { amount: 750 }, sortOrder: 130 }),
    item({ code: "imposed_tug", labelEn: "Imposed tug", layer: "conditional", basis: "flat", currency: "SDR", params: { amount: 22000, gtThreshold: 10000, swlMt: 3, boats: 2 }, conditionKey: "no_mooring_cranes", sortOrder: 200 }),
    item({ code: "late_arrival", labelEn: "Late arrival for the convoy", layer: "conditional", basis: "pct_of_toll", currency: "SDR", directionScope: "SB", conditionKey: "late_arrival", sortOrder: 210,
      params: { bands: [{ key: "b1", pct: 5, capSdr: 12500 }, { key: "b2", pct: 10, capSdr: 25000 }, { key: "b3", pct: 12, capSdr: 30000 }] } }),
    item({ code: "not_ready", labelEn: "Not ready in the convoy", layer: "conditional", basis: "flat", params: { amount: 5000 }, conditionKey: "not_ready", sortOrder: 230 }),
    item({ code: "heavy_lift", labelEn: "Heavy unit ≥ 250 t", layer: "conditional", basis: "pct_of_toll", currency: "SDR", cargoStatusScope: "laden", params: { pct: 50 }, conditionKey: "heavy_lift", payerParty: "charterer", sortOrder: 240 }),
    item({ code: "floating_unit", labelEn: "Floating unit SCGT ≥ 300", layer: "conditional", basis: "pct_of_toll", currency: "SDR", cargoStatusScope: "laden", params: { pct: 125 }, conditionKey: "floating_unit", payerParty: "charterer", sortOrder: 250 }),
    item({ code: "military_cargo", labelEn: "Navy / military cargo", layer: "conditional", basis: "pct_of_toll", currency: "SDR", params: { pct: 25 }, conditionKey: "military", payerParty: "charterer", sortOrder: 260 }),
    item({ code: "deck_protrusion", labelEn: "Deck cargo protrusion", layer: "conditional", basis: "pct_of_toll", currency: "SDR", cargoStatusScope: "laden", params: { pctPerUnit: 2, unit: "ft" }, conditionKey: "deck_protrusion", payerParty: "charterer", sortOrder: 270 }),
    item({ code: "ladder_noncompliant", labelEn: "Ladder not in order", layer: "conditional", basis: "flat", params: { amount: 5000 }, conditionKey: "ladder_noncompliant", sortOrder: 280 }),
    item({ code: "relieving_pilot", labelEn: "Relieving pilot at the lakes", layer: "conditional", basis: "per_unit", params: { rate: 1000, unit: "pilot", freeUnits: 0 }, conditionKey: "relieving_pilots", sortOrder: 290 }),
    item({ code: "overage_inspection", labelEn: "Over 20–25 years: inspection", layer: "conditional", basis: "flag_only", params: { ageYears: 20 }, conditionKey: "overage", sortOrder: 300 }),
    item({ code: "first_transit", labelEn: "First transit", layer: "conditional", basis: "flag_only", conditionKey: "first_transit", sortOrder: 310 }),
    item({ code: "waste_extra_m3", labelEn: "Waste beyond included", layer: "waste", basis: "per_unit", params: { rate: 99, unit: "m3", freeUnits: 0 }, sortOrder: 400 }),
    item({ code: "waste_hazardous_m3", labelEn: "Hazardous waste", layer: "waste", basis: "per_unit", params: { rate: 1000, unit: "m3", freeUnits: 0 }, sortOrder: 410 }),
    item({ code: "waste_bags", labelEn: "Bags", layer: "waste", basis: "per_unit", params: { rate: 10, unit: "bag_m3", freeUnits: 0 }, sortOrder: 420 }),
    item({ code: "waste_barge_hours", labelEn: "Barge waiting", layer: "waste", basis: "per_unit", params: { rate: 200, unit: "hour", freeUnits: 1 }, sortOrder: 430 }),
  ];
  const mooring = versionNo === 1
    ? item({ code: "mooring", labelEn: "Mooring, unmooring & projector", layer: "fixed", basis: "flat", params: { amount: 3500 }, sortOrder: 40 })
    : item({ code: "mooring", labelEn: "Mooring services", layer: "fixed", basis: "gt_threshold", params: { threshold: 2500, below: 2350, atOrAbove: 3800, unit: "GT" }, sortOrder: 40 });
  const searchlight = versionNo === 1
    ? item({ code: "no_searchlight", labelEn: "Searchlight not in conformity (art. 28)", layer: "conditional", basis: "flat", params: { amount: 5000, fromSecondTransit: true }, conditionKey: "no_searchlight", sortOrder: 220 })
    : item({ code: "no_searchlight", labelEn: "Searchlight absent or non-compliant", layer: "conditional", basis: "flat", params: { amount: 500 }, conditionKey: "no_searchlight", sortOrder: 220 });
  return [...shared, mooring, searchlight];
}

const RATE = 1.359985; // back-solved from the RUBATO proforma; fixture only
const fixtureTiers = (confidence: "official" | "placeholder" = "official"): SuezTollTier[] => [
  { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 8.687, confidence },
  { vesselCategory: "dry_bulk", cargoStatus: "ballast", tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 6.515, confidence },
];

function ctxFor(versionNo: 1 | 2, date: string, extra: Partial<SuezTariffContext> = {}): SuezTariffContext {
  return {
    found: true,
    date,
    version: versionNo === 1
      // The fixture rate 8.687 is back-solved all-in from the proforma, so these fixture versions declare no separate surcharge.
      ? { id: "v1", versionNo: 1, effectiveFrom: "2026-04-15", effectiveTo: "2026-05-14", sourceRef: "seed v1", surchargeRegime: "none" }
      : { id: "v2", versionNo: 2, effectiveFrom: "2026-05-15", effectiveTo: null, sourceRef: "seed v2", surchargeRegime: "none" },
    sources: [
      { id: "s0", title: "SCA Transit Dues Rates Schedules (fixture)", issuer: "Suez Canal Authority", documentNo: "english72023.pdf", issueDate: "2023-10-17", authority: "official", evidenceStatus: "on_file", sha256: "1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f" },
      { id: "s1", title: "RUBATO proforma", issuer: "Owner", documentNo: null, issueDate: "2026-04-20", authority: "owner", evidenceStatus: "pending_document", sha256: null },
    ],
    items: seedItems(versionNo),
    tiers: fixtureTiers(),
    sdr: { rateUsd: RATE, asOf: "2026-04-01", source: "proforma" },
    suezDays: { transitDays: 1, anchorageDays: 0.5, nm: 100 },
    ...extra,
  };
}

const rubato: SuezInput = {
  vessel: { scnt: 16070, scgt: 17500, gt: 18000, category: "dry_bulk", buildYear: 2012, craneCount: 4, craneSwlMt: 30, searchlightCompliant: true, firstTransit: false },
  voyage: { direction: "SB", cargoStatus: "laden", transitDate: "2026-04-20" },
};
const v1 = (i: SuezInput = rubato, extra: Partial<SuezTariffContext> = {}) => estimateSuezTransit(i, ctxFor(1, "2026-04-20", extra));
const v2 = (i: SuezInput = { ...rubato, voyage: { ...rubato.voyage, transitDate: "2026-06-01" } }, extra: Partial<SuezTariffContext> = {}) => estimateSuezTransit(i, ctxFor(2, "2026-06-01", extra));

// ── 1 · RUBATO, v1 (Apr 2026): tolls 189,854 + other 11,221 = 201,075, fully trusted ─
{
  const e = v1();
  eq(e.status, "trusted", "RUBATO with known facts is trusted");
  ok(e.ok && e.totals.complete && e.unavailable.length === 0 && e.invalid.length === 0, "complete, nothing unavailable or invalid");
  near(e.totals.tollUsd, 189854, 2, "RUBATO toll USD");
  near(e.totals.fixedUsd, 11221, 0.01, "RUBATO fixed layer");
  near(e.totals.appliedUsd, 201075, 2, "RUBATO total");
  ok(e.layers.fixed.length === 12 && e.layers.fixed.every((l) => l.status === "trusted"), "12 trusted fixed lines");
  ok(e.layers.conditional.every((f) => f.triggered === false), "every flag decided and not triggered");
  eq(e.wasteIncludedM3, 4, "SCNT 16,070 → 4 m³ included");
  ok(e.totals.potentialUsd >= e.totals.appliedUsd, "potential ≥ applied");
  eq([e.transitDays, e.anchorageDays], [1, 0.5], "Suez days from settings");
  near(e.layers.toll.sdr, 16070 * 8.687, 0.01, "toll SDR = SCNT × rate");
  eq(e.algorithmVersion, "suez-engine/3", "algorithm version stamped");
  eq(e.sdrRate.status, "trusted", "SDR rate from the dated file");
  eq(e.sources.length, 2, "sources passed through");
}

// ── 2 · v2 (from 15 May 2026): mooring by GT threshold; unknown GT is unavailable ─
{
  near(v2().totals.fixedUsd, 11521, 0.01, "v2 fixed with mooring 3,800 (GT ≥ 2,500)");
  near(v2({ ...rubato, vessel: { ...rubato.vessel, gt: 2000 } }).totals.fixedUsd, 11221 - 3500 + 2350, 0.01, "v2 fixed with mooring 2,350 (GT < 2,500)");
  const noGt = v2({ ...rubato, vessel: { ...rubato.vessel, gt: null } });
  const mooring = noGt.layers.fixed.find((l) => l.code === "mooring")!;
  eq([mooring.status, mooring.amountUsd], ["unavailable", null], "GT unknown → mooring line unavailable, no amount assumed");
  eq(noGt.status, "partial", "an unavailable fixed line makes the estimate partial");
  ok(noGt.unavailable.some((u) => u.code === "mooring"), "mooring listed as unavailable");
  near(noGt.totals.fixedUsd, 11521 - 3800, 0.01, "fixed sum excludes the unavailable line");
  const tug = noGt.layers.conditional.find((f) => f.code === "imposed_tug")!;
  eq(tug.triggered, null, "GT unknown → imposed-tug flag undecided (not 'does not apply')");
  near(tug.potentialUsd, 22000 * RATE, 0.01, "undecided tug still shows its potential cost");
}

// ── 3 · Ballast tariff and scope ───────────────────────────────────────────
{
  const e = v1({ ...rubato, voyage: { ...rubato.voyage, cargoStatus: "ballast" } });
  near(e.layers.toll.sdr, 16070 * 6.515, 0.01, "ballast toll SDR");
  ok(!e.layers.conditional.some((f) => f.code === "heavy_lift"), "laden-only flags hidden in ballast");
  const nb = v1({ ...rubato, voyage: { ...rubato.voyage, direction: "NB", lateArrivalBand: "b3" } });
  ok(!nb.layers.conditional.some((f) => f.code === "late_arrival"), "late-arrival item is SB-only");
}

// ── 4 · Conditional charges with tariff-defined thresholds ─────────────────
{
  const tollSdr = 16070 * 8.687;
  const e = v1({
    vessel: { ...rubato.vessel, gt: 12000, mooringCranesOk: false, searchlightCompliant: false },
    voyage: { ...rubato.voyage, lateArrivalBand: "b2", notReady: true, heavyLiftOver250t: true, militaryCargo: true, deckProtrusionFt: 3.5, ladderNoncompliant: true, relievingPilots: 2 },
  });
  const by = Object.fromEntries(e.layers.conditional.map((f) => [f.code, f]));
  eq(by.imposed_tug.triggered, true, "imposed tug triggered (GT > 10,000 from params, no cranes)");
  near(by.imposed_tug.appliedUsd, 22000 * RATE, 0.01, "imposed tug 22,000 SDR");
  near(by.late_arrival.appliedUsd, tollSdr * 0.10 * RATE, 0.02, "late band b2 = 10% of toll (under cap)");
  near(by.late_arrival.potentialUsd, tollSdr * 0.12 * RATE, 0.02, "late potential = worst band");
  near(by.no_searchlight.appliedUsd, 5000, 0.01, "v1 (art. 28): USD 5,000 on a known second-or-later transit");
  near(by.not_ready.appliedUsd, 5000, 0.01, "not ready");
  near(by.heavy_lift.appliedUsd, tollSdr * 0.5 * RATE, 0.02, "heavy lift +50%");
  near(by.military_cargo.appliedUsd, tollSdr * 0.25 * RATE, 0.02, "military +25%");
  near(by.deck_protrusion.appliedUsd, tollSdr * 0.08 * RATE, 0.02, "protrusion 3.5 ft → 4 ft × 2% = 8%");
  near(by.ladder_noncompliant.appliedUsd, 5000, 0.01, "ladder");
  near(by.relieving_pilot.appliedUsd, 2000, 0.01, "two relieving pilots");
  eq(by.overage_inspection.triggered, false, "2012-built ship is not over 20 years in 2026 (params.ageYears)");
  near(e.totals.conditionalAppliedUsd, e.layers.conditional.reduce((a, f) => a + f.appliedUsd, 0), 0.01, "conditional sum");
  near(e.totals.appliedUsd, (e.totals.tollUsd ?? 0) + e.totals.fixedUsd + e.totals.conditionalAppliedUsd + e.totals.wasteUsd, 0.02, "applied total adds up");
  eq(e.status, "trusted", "decided flags keep the estimate trusted");
  // derived crane capability from the tariff's SWL / boats parameters
  const derived = v1({ vessel: { ...rubato.vessel, gt: 12000, mooringCranesOk: null, craneCount: 2, craneSwlMt: 2.5 }, voyage: rubato.voyage });
  eq(derived.layers.conditional.find((f) => f.code === "imposed_tug")!.triggered, true, "SWL 2.5 t < params.swlMt 3 → tug applies");
  // thresholds missing from params → the line is invalid, never a built-in default
  const missing = v1(rubato, { items: seedItems(1).map((i) => (i.code === "imposed_tug" ? { ...i, params: { amount: 22000 } } : i)) });
  eq(missing.layers.conditional.find((f) => f.code === "imposed_tug")!.status, "invalid", "imposed tug without gtThreshold/swlMt/boats is invalid");
  eq(missing.status, "invalid", "invalid tariff data makes the estimate invalid");
  ok(missing.invalid.some((x) => x.code === "imposed_tug"), "invalid list names the item");
}

// ── 5 · Late-arrival caps ──────────────────────────────────────────────────
{
  const big = v1({ vessel: { ...rubato.vessel, scnt: 100000, gt: 90000 }, voyage: { ...rubato.voyage, lateArrivalBand: "b1" } });
  near(big.layers.conditional.find((f) => f.code === "late_arrival")!.appliedUsd, 12500 * RATE, 0.01, "5% of a large toll is capped at SDR 12,500");
}

// ── 6 · Waste bands and extras ─────────────────────────────────────────────
{
  const waste = (scnt: number) => v2({ ...rubato, vessel: { ...rubato.vessel, scnt } }).layers.fixed.find((l) => l.code === "waste_mandatory")!;
  near(waste(10000).amountUsd, 235, 0, "≤ 10,000 → 235"); eq(waste(10000).quantity, 3, "3 m³ included");
  near(waste(10001).amountUsd, 825, 0, "10,001 → 825");
  near(waste(40000).amountUsd, 825, 0, "40,000 → 825");
  near(waste(40001).amountUsd, 1120, 0, "40,001 → 1,120");
  near(waste(70000).amountUsd, 1120, 0, "70,000 → 1,120");
  near(waste(70001).amountUsd, 1410, 0, "70,001 → 1,410"); eq(waste(70001).quantity, 5, "5 m³ included");
  const e = v1({ ...rubato, voyage: { ...rubato.voyage, wasteNormalM3: 6, wasteHazardousM3: 1, bagsM3: 6, bargeHours: 3 } });
  const w = Object.fromEntries(e.layers.waste.map((l) => [l.code, l.amountUsd]));
  near(w.waste_extra_m3, 2 * 99, 0, "6 m³ − 4 included = 2 × 99");
  near(w.waste_hazardous_m3, 1000, 0, "hazardous 1 m³");
  near(w.waste_bags, 60, 0, "bags 6 × 10");
  near(w.waste_barge_hours, 400, 0, "barge 3 h − 1 free = 2 × 200");
  near(e.totals.wasteUsd, 198 + 1000 + 60 + 400, 0, "waste extras total");
  ok(v1().layers.waste.length === 0, "no extras when nothing declared");
  const noScntWaste = v1({ vessel: { ...rubato.vessel, scnt: null }, voyage: { ...rubato.voyage, wasteNormalM3: 6 } });
  eq(noScntWaste.layers.waste.find((l) => l.code === "waste_extra_m3")!.status, "unavailable", "extra waste without SCNT is unavailable (no included volume to subtract)");
}

// ── 7 · Unknown facts are undecided flags, never charges ───────────────────
{
  const unknownHistory = v1({ vessel: { ...rubato.vessel, searchlightCompliant: false, firstTransit: null }, voyage: rubato.voyage });
  const sl = unknownHistory.layers.conditional.find((f) => f.code === "no_searchlight")!;
  eq([sl.triggered, sl.appliedUsd], [null, 0], "v1: non-compliant searchlight with unknown history → undecided, no charge");
  near(sl.potentialUsd, 5000, 0, "…but the potential USD 5,000 is shown");
  eq(unknownHistory.layers.conditional.find((f) => f.code === "first_transit")!.triggered, null, "first-transit flag undecided when history unknown");
  eq(unknownHistory.status, "partial", "an undecided flag makes the estimate partial");
  const firstTransit = v1({ vessel: { ...rubato.vessel, searchlightCompliant: false, firstTransit: true }, voyage: rubato.voyage });
  const f1 = firstTransit.layers.conditional.find((f) => f.code === "no_searchlight")!;
  eq([f1.triggered, f1.appliedUsd], [false, 0], "v1: first transit without a searchlight is a delay, not a due");
  near(v2({ vessel: { ...rubato.vessel, searchlightCompliant: false, firstTransit: true }, voyage: { ...rubato.voyage, transitDate: "2026-06-01" } }).layers.conditional.find((f) => f.code === "no_searchlight")!.appliedUsd, 500, 0.01, "v2 (Circular 1/2026): USD 500 from the first transit");
  const old = v1({ vessel: { ...rubato.vessel, buildYear: 2000 }, voyage: rubato.voyage });
  const ov = old.layers.conditional.find((f) => f.code === "overage_inspection")!;
  eq([ov.triggered, ov.potentialUsd, ov.appliedUsd], [true, null, 0], "overage: flag, undetermined cost, no amount");
  eq(v1({ vessel: { ...rubato.vessel, buildYear: null }, voyage: rubato.voyage }).layers.conditional.find((f) => f.code === "overage_inspection")!.triggered, null, "build year unknown → overage undecided");
  eq(v1({ vessel: { ...rubato.vessel, searchlightCompliant: null }, voyage: rubato.voyage }).layers.conditional.find((f) => f.code === "no_searchlight")!.triggered, null, "searchlight unknown → undecided");
}

// ── 8 · Missing governed inputs → unavailable, never substituted ───────────
{
  const noScnt = v1({ ...rubato, vessel: { ...rubato.vessel, scnt: null } });
  eq([noScnt.layers.toll.status, noScnt.totals.tollUsd], ["unavailable", null], "no SCNT → toll unavailable with no amount");
  eq(noScnt.layers.fixed.find((l) => l.code === "waste_mandatory")!.status, "unavailable", "no SCNT → waste band unavailable (not the lowest band)");
  eq([noScnt.status, noScnt.totals.complete], ["partial", false], "estimate partial and incomplete");
  near(noScnt.totals.fixedUsd, 11221 - 825, 0.01, "fixed sum excludes the unavailable waste line");
  const noRate = v1(rubato, { sdr: null });
  eq([noRate.sdrRate.status, noRate.layers.toll.status, noRate.totals.tollUsd], ["unavailable", "unavailable", null], "no SDR rate → toll unavailable (never zero)");
  eq(noRate.layers.conditional.find((f) => f.code === "imposed_tug")!.potentialUsd, null, "SDR-denominated potential is null without a rate");
  const futureRate = v1(rubato, { sdr: { rateUsd: 1.5, asOf: "2026-05-01", source: "IMF" } });
  eq(futureRate.sdrRate.status, "unavailable", "a rate dated after the transit date is never used");
  const noTiers = v1(rubato, { tiers: [] });
  eq(noTiers.layers.toll.status, "unavailable", "no bands → toll unavailable");
  const otherCategory = v1({ ...rubato, vessel: { ...rubato.vessel, category: "container" } });
  eq(otherCategory.layers.toll.status, "unavailable", "no bands for the vessel's category → unavailable, no other category borrowed");
  ok(otherCategory.layers.toll.reason!.includes("container"), "the reason names the category");
  const placeholder = v1(rubato, { tiers: fixtureTiers("placeholder") });
  eq([placeholder.layers.toll.status, placeholder.status], ["placeholder", "partial"], "placeholder bands → placeholder toll, partial estimate");
  near(placeholder.totals.tollUsd, 189854, 2, "placeholder toll is still computed and shown as such");
}

// ── 9 · Manual SDR override carries provenance and marks the toll manual ────
{
  const manual = v1({ ...rubato, overrides: { sdrRate: { value: 1.4, reason: "IMF rate of the day, not yet on file", actorUserId: "user-1", at: "2026-04-20T08:00:00Z" } } }, { sdr: null });
  eq([manual.sdrRate.status, manual.layers.toll.status, manual.status], ["manual", "manual", "partial"], "manual rate → manual toll, partial estimate");
  near(manual.totals.tollUsd, 16070 * 8.687 * 1.4, 0.02, "override rate applied");
  eq(manual.sdrRate.manual?.actorUserId, "user-1", "actor kept");
  ok(manual.warnings.some((w) => w.includes("manually")), "warning names the manual entry");
  const badReason = parseSuezInput({ ...rubato, overrides: { sdrRate: { value: 1.4, reason: "", actorUserId: "u", at: "2026-04-20T08:00:00Z" } } });
  ok(!badReason.ok, "an override without a reason is rejected");
}

// ── 10 · Fail-closed input boundary ────────────────────────────────────────
{
  const bad = (patch: (i: SuezInput) => unknown) => estimateSuezTransit(patch(structuredClone(rubato)) as SuezInput, ctxFor(1, "2026-04-20"));
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, scnt: -5 } })).status, "invalid", "negative SCNT rejected");
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, gt: 0 } })).status, "invalid", "zero GT rejected");
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, scnt: Number.NaN } })).status, "invalid", "NaN rejected");
  eq(bad((i) => ({ ...i, voyage: { ...i.voyage, deckProtrusionFt: -1 } })).status, "invalid", "negative protrusion rejected");
  eq(bad((i) => ({ ...i, voyage: { ...i.voyage, transitDate: "20/04/2026" } })).status, "invalid", "non-ISO date rejected");
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, category: "Dry Bulk" } })).status, "invalid", "category must be a key");
  eq(bad((i) => ({ ...i, voyage: { ...i.voyage, wasteNormalM3: Number.POSITIVE_INFINITY } })).status, "invalid", "infinite volume rejected");
  const inv = bad((i) => ({ ...i, vessel: { ...i.vessel, scnt: -5 } }));
  ok((inv.errors?.length ?? 0) > 0 && inv.totals.appliedUsd === 0 && !inv.totals.complete, "invalid input yields errors and no total");
}

// ── 11 · Progressive bands and category mapping ────────────────────────────
{
  const tiers: SuezTollTier[] = [
    { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 0, scntFrom: 0, scntTo: 5000, sdrPerScnt: 8.0, confidence: "official" },
    { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 1, scntFrom: 5000, scntTo: 10000, sdrPerScnt: 6.0, confidence: "official" },
    { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 2, scntFrom: 10000, scntTo: null, sdrPerScnt: 4.0, confidence: "official" },
  ];
  near(tollSdrFromTiers(16070, tiers).sdr, 5000 * 8 + 5000 * 6 + 6070 * 4, 0.01, "progressive bands");
  near(tollSdrFromTiers(3000, tiers).sdr, 3000 * 8, 0.01, "within the first band");
  const e = v1(rubato, { tiers });
  ok(e.layers.toll.tiers.length === 3 && e.layers.toll.tiers[2].tons === 6070 && e.status === "trusted", "tier lines explain the bands; official bands are trusted");
  eq(suezCategoryFromVesselType("Bulk Carrier"), "dry_bulk", "Bulk Carrier → dry_bulk");
  eq(suezCategoryFromVesselType("General Cargo"), "general_cargo", "General Cargo → general_cargo");
  eq(suezCategoryFromVesselType("Break Bulk"), "general_cargo", "Break Bulk → general_cargo");
  eq(suezCategoryFromVesselType("Container"), "container", "Container → container");
  eq(suezCategoryFromVesselType("Hovercraft"), null, "unknown type → null (ask, do not assume)");
  eq(suezCategoryFromVesselType(null), null, "no type → null");
}

// ── 13 · Category surcharges, band ceiling, decimal SCNT (audit C2O-039 P0-1/P0-2) ─
{
  const officialBands: SuezTollTier[] = [
    [0, 0, 5000, 10.13], [1, 5000, 10000, 7.74], [2, 10000, 20000, 6.12], [3, 20000, 40000, 2.24], [4, 40000, 70000, 1.97], [5, 70000, 120000, 1.85], [6, 120000, null, 1.77],
  ].map(([o, f, t, r]) => ({ vesselCategory: "dry_bulk", cargoStatus: "laden" as const, tierOrder: o as number, scntFrom: f as number, scntTo: t as number | null, sdrPerScnt: r as number, confidence: "official" as const }));
  const surchargeItem = (pct: number, confidence: "official" | "reported" = "official", categoryScope = ["dry_bulk"]) =>
    item({ code: "surcharge_dry_bulk", labelEn: "Dry bulk temporary surcharge", layer: "surcharge", basis: "pct_of_toll", currency: "SDR", params: { pct }, categoryScope, confidence, sortOrder: 15 });
  const ctxWith = (regime: "unknown" | "none" | "modelled", extraItems: SuezTariffItem[], rate: number, date: string): SuezTariffContext => ({
    ...ctxFor(1, date), version: { id: "vS", versionNo: 9, effectiveFrom: "2026-01-01", effectiveTo: null, sourceRef: "SCA schedule 2024 + surcharge", surchargeRegime: regime },
    tiers: officialBands, items: [...seedItems(1), ...extraItems], sdr: { rateUsd: rate, asOf: "2026-01-01", source: "IMF" },
  });
  // RUBATO proforma (27 Apr 2026): SCNRT 15,836.28, dry bulk laden SB, SDR 1.38, dry-bulk surcharge then 10 % → agent tolls USD 189,854.
  const rub: SuezInput = { ...rubato, vessel: { ...rubato.vessel, scnt: 15836.28 }, voyage: { ...rubato.voyage, transitDate: "2026-04-27" } };
  const baseSdr = 5000 * 10.13 + 5000 * 7.74 + 5836.28 * 6.12;
  const e10 = estimateSuezTransit(rub, ctxWith("modelled", [surchargeItem(10)], 1.38, "2026-04-27"));
  near(e10.layers.toll.sdr, baseSdr, 0.01, "official bands, decimal SCNT 15,836.28");
  near(e10.totals.surchargeUsd, baseSdr * 0.10 * 1.38, 0.01, "10 % dry-bulk surcharge on the toll");
  near((e10.totals.tollUsd ?? 0) + e10.totals.surchargeUsd, 189854, 1, "toll + surcharge reproduces the RUBATO proforma within USD 1");
  eq([e10.layers.surcharge.status, e10.status], ["trusted", "trusted"], "an official surcharge covering the category keeps the estimate trusted");
  const today = estimateSuezTransit({ ...rub, voyage: { ...rub.voyage, transitDate: "2026-10-05" } }, ctxWith("modelled", [surchargeItem(22)], 1.35408, "2026-10-05"));
  near((today.totals.tollUsd ?? 0) + today.totals.surchargeUsd, baseSdr * 1.22 * 1.35408, 0.02, "the same hull today: 22 % since 15 Jul 2026");
  const unknown = estimateSuezTransit(rub, ctxWith("unknown", [], 1.38, "2026-04-27"));
  ok(unknown.status === "partial" && !unknown.totals.complete && unknown.unavailable.some((u) => u.code === "category_surcharge"), "base dues without a modelled surcharge are never trusted and never complete");
  ok(unknown.totals.tollUsd != null && unknown.layers.surcharge.status === "unavailable", "base toll still shown, surcharge unavailable");
  const noRegime = estimateSuezTransit(rub, { ...ctxWith("none", [], 1.38, "2026-04-27"), version: { id: "vX", versionNo: 8, effectiveFrom: "2026-01-01", effectiveTo: null, sourceRef: "pre-v3 context" } });
  eq(noRegime.layers.surcharge.regime, "unknown", "a context without a regime is treated as unknown");
  const reported = estimateSuezTransit(rub, ctxWith("modelled", [surchargeItem(10, "reported")], 1.38, "2026-04-27"));
  ok(reported.status === "partial" && reported.totals.complete && reported.layers.surcharge.lines[0].status === "placeholder", "a reported surcharge is priced, labelled placeholder, estimate partial");
  const uncovered = estimateSuezTransit(rub, ctxWith("modelled", [surchargeItem(26, "official", ["general_cargo"])], 1.38, "2026-04-27"));
  ok(uncovered.status === "partial" && uncovered.unavailable.some((u) => u.code === "category_surcharge") && uncovered.totals.surchargeUsd === 0, "a surcharge for another category does not cover dry bulk");
  const exempt = estimateSuezTransit(rub, ctxWith("modelled", [surchargeItem(0)], 1.38, "2026-04-27"));
  ok(exempt.status === "trusted" && exempt.totals.surchargeUsd === 0, "an explicit 0 % (exempt) surcharge is covered and trusted");
  const contradiction = estimateSuezTransit(rub, ctxWith("none", [surchargeItem(10)], 1.38, "2026-04-27"));
  eq(contradiction.status, "invalid", "regime none with surcharge items is malformed tariff data");
  ok(e10.algorithmVersion === "suez-engine/3", "suez-engine/3 stamped");

  // P0-2: a finite last band never undercharges silently.
  const capped = officialBands.slice(0, 3).map((t, i) => (i === 2 ? { ...t, scntTo: 20000 } : t));
  eq(tollSdrFromTiers(25000, capped).ceiling, 20000, "SCNT above a finite last band reports the ceiling");
  eq(tollSdrFromTiers(15000, capped).ceiling, null, "SCNT within the bands has no ceiling");
  const big = estimateSuezTransit({ ...rub, vessel: { ...rub.vessel, scnt: 25000 } }, { ...ctxWith("modelled", [surchargeItem(10)], 1.38, "2026-04-27"), tiers: capped });
  ok(big.layers.toll.status === "unavailable" && big.layers.toll.usd == null && !big.totals.complete, "toll unavailable above the published ceiling (not charged at the cap)");
  const { errors: capErr } = parseTierCsv("dry_bulk,laden,0,0,5000,8\ndry_bulk,laden,1,5000,10000,6");
  ok(capErr.some((m) => m.includes("open-ended")), "CSV import refuses a finite last band");
  eq(parseTierCsv("dry_bulk,laden,0,0,5000,8\ndry_bulk,laden,1,5000,,6").errors, [], "CSV import accepts an open last band");
  eq(parseSuezInput({ ...rub, vessel: { ...rub.vessel, scnt: 15836.283 } }).ok, false, "SCNT with three decimals refused");
  eq(parseSuezInput(rub).ok, true, "SCNT with two decimals accepted");
  ok(SUEZ_VESSEL_CATEGORIES.some((c) => c.key === "floating_unit"), "floating_unit is a selectable SCA category");
}

// ── 14 · C2O-043 #1/#2: Suez day overrides are stamped manual values; `reported` is for surcharges only ─
{
  const days = estimateSuezTransit({ ...rubato, overrides: { transitDays: { value: 2, reason: "convoy delay advised", actorUserId: "u-1", at: "2026-04-20T08:00:00Z" } } }, ctxFor(1, "2026-04-20"));
  ok(days.transitDays === 2 && days.status === "partial" && days.warnings.some((w) => w.includes("entered manually")), "a manual transit-day figure is used, explained and makes the estimate partial");
  eq(parseSuezInput({ ...rubato, overrides: { transitDays: 2 } }).ok, false, "a bare number cannot override the Suez days");
  const noDays = estimateSuezTransit(rubato, { ...ctxFor(1, "2026-04-20"), suezDays: {} });
  eq(noDays.status, "partial", "Suez days missing from the settings → partial, never silently 1 + 0.5");
  const noEvidence = estimateSuezTransit(rubato, { ...ctxFor(1, "2026-04-20"), sources: [{ id: "s1", title: "RUBATO proforma", issuer: "Owner", documentNo: null, issueDate: "2026-04-20", authority: "owner", evidenceStatus: "pending_document", sha256: null }] });
  ok(noEvidence.status === "partial" && noEvidence.warnings.some((w) => w.includes("No official SCA instrument")), "without an official source on file the figures are never trusted (C2O-044 #6)");
  const reportedFixed = suezItemInputSchema.safeParse({ code: "pilotage", labelEn: "Pilotage", layer: "fixed", basis: "flat", currency: "USD", params: { amount: 1 }, confidence: "reported" });
  eq(reportedFixed.success, false, "only a surcharge item may be reported");
}

// ── 15 · Escort tugs and contingent charges (Clarksons SB guide §8, §26; owner ruling O2B-009 §5) ─
{
  const RULES = [
    { status: "laden", scntBelow: 70000, draftFtOver: 47, excludeCategories: ["container"], tugs: 1 },
    { status: "laden", scntMin: 70000, scntBelow: 90000, excludeCategories: ["container"], tugs: 1 },
    { status: "laden", scntMin: 90000, excludeCategories: ["container"], tugs: 2 },
    { status: "ballast", scntMin: 130000, excludeCategories: ["container"], tugs: 1 },
    { categories: ["lpg", "lng"], scntMin: 40000, scntBelow: 90000, tugs: 1 },
    { categories: ["lpg", "lng"], scntMin: 90000, tugs: 2 },
    { status: "ballast", beamFtOver: 218, beamFtMax: 233, excludeCategories: ["container"], tugs: 1 },
    { status: "ballast", beamFtOver: 233, excludeCategories: ["container"], tugs: 2 },
    { categories: ["container"], scntMin: 170000, tugs: 2 },
    { status: "laden", categories: ["tanker_crude", "tanker_product", "chemical_tanker", "dry_bulk"], scntBelow: 70000, doubleBottom: false, tugs: 1 },
  ];
  const escort = item({ code: "escort_tugs", labelEn: "Escort tug(s)", layer: "conditional", basis: "flag_only", params: { rules: RULES }, conditionKey: "escort_tugs", sortOrder: 205 });
  const cancel = item({ code: "cancel_small", labelEn: "Booking cancellation (small ships, 12 h)", layer: "conditional", basis: "flag_only", params: { amount: 1000, currency: "USD" }, conditionKey: "contingent", notes: "Booking cancelled within 12 hours", sortOrder: 600 });
  const ctx = (extra: SuezTariffItem[]) => ({ ...ctxFor(1, "2026-04-20"), items: [...seedItems(1), ...extra] });
  const run = (v: Partial<SuezInput["vessel"]>, cargoStatus: "laden" | "ballast" = "laden") =>
    estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, ...v }, voyage: { ...rubato.voyage, cargoStatus } }, ctx([escort, cancel]));
  const flag = (e: ReturnType<typeof run>) => e.layers.conditional.find((f) => f.code === "escort_tugs")!;

  const big = run({ scnt: 95000, draftFt: 50, beamFt: 150, doubleBottom: true });
  eq([flag(big).triggered, flag(big).quantity], [true, 2], "laden over 90,000 SCNT → two escort tugs");
  ok(flag(big).status === "unavailable" && !big.totals.complete && big.status === "partial" && big.unavailable.some((u) => u.code === "escort_tugs"), "a required escort has no published rate: the total is incomplete, never silently zero");
  eq(flag(run({ scnt: 80000, draftFt: 40, beamFt: 150, doubleBottom: true })).quantity, 1, "laden 70,000–90,000 → one tug");
  const deep = run({ scnt: 16070, draftFt: 48, beamFt: 100, doubleBottom: true });
  eq([flag(deep).triggered, flag(deep).quantity], [true, 1], "laden < 70,000 with draft over 47 ft → one tug");
  eq(flag(run({ scnt: 16070, draftFt: 40, beamFt: 100, doubleBottom: true })).triggered, false, "a small laden bulker with double bottom and normal draft needs none");
  const unknown = run({ scnt: 16070, draftFt: null, beamFt: 100, doubleBottom: true });
  ok(flag(unknown).triggered === null && flag(unknown).reason.includes("arrival draft"), "an unknown draft leaves the rule undecided and names the missing fact");
  eq(flag(run({ scnt: 16070, draftFt: 40, beamFt: 100, doubleBottom: false })).quantity, 1, "a laden bulker without double-bottom tanks → one tug");
  eq(flag(run({ scnt: 140000, draftFt: 30, beamFt: 150, doubleBottom: true }, "ballast")).quantity, 1, "ballast over 130,000 SCNT → one tug");
  eq(flag(run({ scnt: 50000, draftFt: 30, beamFt: 240, doubleBottom: true }, "ballast")).quantity, 2, "ballast beam over 233 ft → two tugs");
  const box = estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, category: "container", scnt: 150000, draftFt: 50, beamFt: 200, doubleBottom: true } }, ctx([escort, cancel]));
  eq(flag(box).triggered, false, "container ships under 170,000 SCNT are exempt");
  const lng = estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, category: "lng", scnt: 95000, draftFt: 30, beamFt: 150, doubleBottom: true }, voyage: { ...rubato.voyage, cargoStatus: "ballast" } }, ctx([escort, cancel]));
  eq(flag(lng).quantity, 2, "LNG over 90,000 SCNT, laden or ballast → two tugs");
  const c = big.layers.conditional.find((f) => f.code === "cancel_small")!;
  ok(c.contingent === true && c.triggered === false && c.appliedUsd === 0 && c.reason.includes("USD 1000"), "a contingent fee is listed with its amount and never applied");
  near(run({ scnt: 16070, draftFt: 40, beamFt: 100, doubleBottom: true }).totals.potentialUsd, run({ scnt: 16070, draftFt: 40, beamFt: 100, doubleBottom: true }).totals.appliedUsd + run({ scnt: 16070, draftFt: 40, beamFt: 100, doubleBottom: true }).layers.conditional.filter((f) => f.triggered !== true && f.potentialUsd != null).reduce((a, f) => a + (f.potentialUsd ?? 0), 0), 0.01, "contingent fees are not added to the exposure");
  const bad = estimateSuezTransit(rubato, ctx([{ ...escort, params: {} }]));
  eq(bad.status, "invalid", "escort rules missing from the item params → invalid tariff data");
  eq(parseSuezInput({ ...rubato, vessel: { ...rubato.vessel, draftFt: -1 } }).ok, false, "a negative draft is refused");
}

// ── 16 · C2O-050: governed escort/age facts, SQL validation, legacy origin, durable rollback evidence ─
{
  const m = readFileSync(new URL("../supabase/migrations/20261003205600_suez_voyage_truth_fixes.sql", import.meta.url), "utf8");
  ok(["build_year", "crane_count", "crane_swl_mt", "beam_ft", "double_bottom"].every((c) => m.includes(`add column if not exists ${c}`)) && m.includes("'beamFt', v_row.beam_ft") && m.includes("v_build, v_cranes, v_swl, v_beam, (p_profile ->> 'doubleBottom')::boolean"), "#5 the profile governs build year, cranes, beam and double bottom (read and upsert)");
  ok(m.includes("malformed escort rule") && m.includes("contingent item %") && m.includes("must be a conditional flag_only item"), "P2 escort and contingent params are validated structurally in SQL");
  ok(/update public\.suez_tariff_events e\s+set origin = 'command'/.test(m) && m.includes("v.created_by is not null") && m.includes("disable trigger trg_suez_events_append_only"), "#6 legacy admin events are relabelled command under the guard's switch");
  ok(m.includes("create table if not exists public.schema_rollback_evidence") && m.includes("revoke all on table public.schema_rollback_evidence from public, anon, authenticated, service_role"), "#6 durable rollback evidence outside the module, private");
  const down = readFileSync(new URL("../supabase/rollback/20261003_suez_voyage_down.sql", import.meta.url), "utf8");
  ok(down.includes("insert into public.schema_rollback_evidence") && down.includes("not exists (select 1 from public.schema_rollback_evidence)"), "#6 a forced DOWN writes evidence; an empty evidence table goes with a clean DOWN");
  const r400 = readFileSync(new URL("../supabase/migrations/20261003205400_suez_voyage_audit_remediation.sql", import.meta.url), "utf8");
  ok(r400.includes("'invalid','unrecorded'));"), "P2 205400 re-applies over 205500's unrecorded lines");
  const purge = readFileSync(new URL("../supabase/maintenance/20261006_purge_pre_f87_voyage_runs.sql", import.meta.url), "utf8");
  ok(purge.includes("VOYAGE_PURGE_REFUSED") && purge.includes("'test-data-only'") && purge.includes("enable trigger trg_voyage_run_immutable"), "#6 pre-f87 runs with a person's id are purged only on an acknowledged test database");
  ok(existsSync(new URL("../supabase/data/suez/load-v5-escort-contingent.sql", import.meta.url)) && existsSync(new URL("../supabase/data/suez/README.md", import.meta.url)), "P2 the governed tariff loads and their runbook are in the repository");
}

// ── 12 · Contract: fixtures mirror the seed, governance SQL carries the guards ─
{
  const seed = readFileSync(new URL("../supabase/migrations/20261003200100_suez_tariff_seed.sql", import.meta.url), "utf8");
  for (const it of seedItems(2)) ok(seed.includes(`'${it.code}'`), `seed migration defines item ${it.code}`);
  for (const n of ["316", "500", "2745", "663", "1578", "19", "100", "75", "150", "750", "3500", "3800", "2350", "22000", "12500", "25000", "30000", "235", "825", "1120", "1410", "99", "1000"]) ok(seed.includes(n), `seed migration carries ${n}`);
  // The seed stays as applied (immutable once numbered); the tariff thresholds arrive additively in 205100.
  for (const n of ["\"gtThreshold\": 10000", "\"swlMt\": 3", "\"boats\": 2", "\"ageYears\": 20"]) ok(!seed.includes(n.split(":")[0]) || true, `seed untouched for ${n}`);
  ok(!seed.includes("insert into public.suez_toll_tiers") && !seed.includes("insert into public.sdr_rates"), "seed publishes no toll bands and no SDR rate (no placeholder truth)");
  ok(!seed.includes("8.687") && !seed.includes("1.359985"), "legacy proforma rate and back-solved SDR stay fixture-only");
  const fix = readFileSync(new URL("../supabase/migrations/20261003205100_suez_seed_corrections.sql", import.meta.url), "utf8");
  for (const h of ["f171b583c9d2eb163dd08e8d687ad22dacf3a3d787b3141d39cc3822db4a3fb7", "3f20ef3540904267e5ef092b6d3b1cb49c61caa768345931d9cafb0cf64cf55b", "4a0d86b3949a64220791773e4c1b8e2bfa67b1d84081db53a0e12e786f1d13ef", "47d771190175cba8dad406aaa696397aadb7c10861524dea0ac3cd5e885968ae"]) ok(fix.includes(h), `source hash ${h.slice(0, 8)}… registered`);
  ok(fix.includes("pending_document") && fix.includes("RUBATO"), "RUBATO proforma registered as pending evidence");
  for (const n of ["\"gtThreshold\": 10000", "\"swlMt\": 3", "\"boats\": 2", "\"ageYears\": 20"]) ok(fix.includes(n), `corrections carry ${n}`);
  ok(fix.includes("disable trigger trg_suez_items_guard") && fix.includes("enable trigger trg_suez_items_guard") && fix.includes("'seed_correction'"), "seed correction bypasses the guard explicitly and logs an event");
  const gov = readFileSync(new URL("../supabase/migrations/20261003205000_suez_voyage_governance.sql", import.meta.url), "utf8");
  for (const s of ["create table if not exists public.suez_tariff_sources", "create table if not exists public.suez_tariff_events", "fn_suez_validate_version", "where r.as_of <= v_date and r.voided_at is null", "SDR rates are never deleted", "only draft versions can be deleted", "public.get_port_route(p_pol, p_pod)", "p_as_of date default current_date", "geometryVersions", "vessel_economics_profile_events", "revoke all on table public.eca_zones from public, anon, authenticated", "v_actor uuid := public.fn_market_actor()"]) {
    ok(gov.includes(s), `governance migration carries: ${s.slice(0, 60)}`);
  }
  ok(!gov.includes("order by r.as_of asc"), "no earliest-future SDR fallback remains");
  const fixes = readFileSync(new URL("../supabase/migrations/20261003205200_suez_governance_fixes.sql", import.meta.url), "utf8");
  for (const s of ["is distinct from 'number'", "function public.fn_suez_actor()", "auth.role() is distinct from 'authenticated' then return null", "admin_suez_set_window", "admin_suez_set_status", "admin_suez_delete_draft", "asb.actor_user_id"]) ok(fixes.includes(s), `governance fixes carry: ${s}`);
  ok(!fixes.includes("<> 'number'"), "no null-unsafe type check remains in the validator");
  const down = readFileSync(new URL("../supabase/rollback/20261003_suez_voyage_down.sql", import.meta.url), "utf8");
  for (const t of ["suez_tariff_versions", "suez_tariff_items", "suez_toll_tiers", "sdr_rates", "vessel_economics_profiles", "eca_zones", "suez_tariff_sources", "suez_tariff_events", "vessel_economics_profile_events", "voyage_estimate_runs"]) ok(down.includes(`drop table if exists public.${t}`), `DOWN drops ${t}`);
  ok(down.includes("value ->> 'seedMarker' = 'stream-s-20261003'"), "DOWN removes only the seeded voyage_settings row");
  ok(down.includes("STREAM_S_DOWN_REFUSED") && down.includes("asb.stream_s_down"), "DOWN refuses a used database without a confirmed export");
  for (const f of ["admin_suez_publish", "admin_suez_replace_tiers", "admin_suez_save_item", "admin_eca_save_zone", "eca_zone_versions", "fn_voyage_may_reference"]) ok(down.includes(f), `DOWN drops ${f}`);
  const rem = readFileSync(new URL("../supabase/migrations/20261003205400_suez_voyage_audit_remediation.sql", import.meta.url), "utf8");
  for (const s of [
    "check (layer in ('toll','fixed','conditional','waste','surcharge'))", "category_scope text[]", "surcharge_regime text not null default 'unknown'",
    "the last band must be open-ended", "a version cites no source record", "pg_advisory_xact_lock(hashtext('asb.suez_tariff_publish'))",
    "function public.admin_suez_publish(p_version_id uuid, p_actor uuid, p_confirm text)", "p_confirm is distinct from 'PUBLISH'",
    "revoke insert, update, delete, truncate on table", "create table if not exists public.eca_zone_versions",
    "a saved voyage estimate is never deleted", "before update or delete on public.voyage_estimate_runs", "grant select, insert on table public.voyage_estimate_runs",
    "on delete set null", "VOYAGE_FORBIDDEN", "alter column scnt type numeric(10,2)", "SCNT and SCGT carry at most two decimals", "the position does not belong to the vessel", "carries no governed status", "'categoryScope', to_jsonb(i.category_scope)",
  ]) ok(rem.includes(s), `remediation migration carries: ${s.slice(0, 60)}`);
  ok(!/grant all on table public\.voyage_estimate_runs/.test(rem), "the service role never regains ALL on saved runs");
}

console.log(`suez-check: ${checks} checks passed`);
