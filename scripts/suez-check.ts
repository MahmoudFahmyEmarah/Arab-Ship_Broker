// suez-check — golden fixtures for lib/suez/engine.ts (Voyage Economics, Stream S).
//
// The items below mirror the seed in 20261003200100_suez_tariff_seed.sql
// (v1: 15 Apr–14 May 2026, v2: from 15 May 2026). The toll tiers and the SDR
// rate are FIXTURE-ONLY (the seed publishes neither, r2): a single open band at
// the legacy proforma rate and the back-solved RUBATO rate reproduce the
// RUBATO proforma so the arithmetic is pinned. A contract section greps the
// migrations so the mirror cannot drift silently. Run: npm run test:suez
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateSuezTransit, tollSdrFromTiers } from "../lib/suez/engine";
import type { SuezInput, SuezTariffContext, SuezTariffItem, SuezTollTier } from "../lib/suez/types";
import { suezCategoryFromVesselType } from "../lib/suez/types";

let checks = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); checks++; };
const near = (a: number, b: number, tol: number, msg: string) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); checks++; };

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
    item({ code: "imposed_tug", labelEn: "Imposed tug", layer: "conditional", basis: "flat", currency: "SDR", params: { amount: 22000 }, conditionKey: "no_mooring_cranes", sortOrder: 200 }),
    item({ code: "late_arrival", labelEn: "Late arrival for the convoy", layer: "conditional", basis: "pct_of_toll", currency: "SDR", directionScope: "SB", conditionKey: "late_arrival", sortOrder: 210,
      params: { bands: [{ key: "b1", pct: 5, capSdr: 12500 }, { key: "b2", pct: 10, capSdr: 25000 }, { key: "b3", pct: 12, capSdr: 30000 }] } }),
    item({ code: "not_ready", labelEn: "Not ready in the convoy", layer: "conditional", basis: "flat", params: { amount: 5000 }, conditionKey: "not_ready", sortOrder: 230 }),
    item({ code: "heavy_lift", labelEn: "Heavy unit ≥ 250 t", layer: "conditional", basis: "pct_of_toll", currency: "SDR", cargoStatusScope: "laden", params: { pct: 50 }, conditionKey: "heavy_lift", payerParty: "charterer", sortOrder: 240 }),
    item({ code: "floating_unit", labelEn: "Floating unit SCGT ≥ 300", layer: "conditional", basis: "pct_of_toll", currency: "SDR", cargoStatusScope: "laden", params: { pct: 125 }, conditionKey: "floating_unit", payerParty: "charterer", sortOrder: 250 }),
    item({ code: "military_cargo", labelEn: "Navy / military cargo", layer: "conditional", basis: "pct_of_toll", currency: "SDR", params: { pct: 25 }, conditionKey: "military", payerParty: "charterer", sortOrder: 260 }),
    item({ code: "deck_protrusion", labelEn: "Deck cargo protrusion", layer: "conditional", basis: "pct_of_toll", currency: "SDR", cargoStatusScope: "laden", params: { pctPerUnit: 2, unit: "ft" }, conditionKey: "deck_protrusion", payerParty: "charterer", sortOrder: 270 }),
    item({ code: "ladder_noncompliant", labelEn: "Ladder not in order", layer: "conditional", basis: "flat", params: { amount: 5000 }, conditionKey: "ladder_noncompliant", sortOrder: 280 }),
    item({ code: "relieving_pilot", labelEn: "Relieving pilot at the lakes", layer: "conditional", basis: "per_unit", params: { rate: 1000, unit: "pilot", freeUnits: 0 }, conditionKey: "relieving_pilots", sortOrder: 290 }),
    item({ code: "overage_inspection", labelEn: "Over 20–25 years: inspection", layer: "conditional", basis: "flag_only", conditionKey: "overage", sortOrder: 300 }),
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

const CATS = ["dry_bulk", "general_cargo", "container", "tanker_crude", "tanker_product", "chemical_tanker", "lpg", "lng", "roro", "car_carrier", "passenger", "other"];
function placeholderTiers(): SuezTollTier[] {
  return CATS.flatMap((c) => [
    { vesselCategory: c, cargoStatus: "laden" as const, tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 8.687, confidence: "placeholder" as const },
    { vesselCategory: c, cargoStatus: "ballast" as const, tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 6.515, confidence: "placeholder" as const },
  ]);
}

function ctxFor(versionNo: 1 | 2, date: string, extra: Partial<SuezTariffContext> = {}): SuezTariffContext {
  return {
    found: true,
    date,
    version: versionNo === 1
      ? { id: "v1", versionNo: 1, effectiveFrom: "2026-04-15", effectiveTo: "2026-05-14", sourceRef: "seed v1" }
      : { id: "v2", versionNo: 2, effectiveFrom: "2026-05-15", effectiveTo: null, sourceRef: "seed v2" },
    items: seedItems(versionNo),
    tiers: placeholderTiers(),
    sdr: { rateUsd: 1.359985, asOf: "2026-04-01", source: "proforma" },
    suezDays: { transitDays: 1, anchorageDays: 0.5, nm: 100 },
    ...extra,
  };
}

const rubato: SuezInput = {
  vessel: { scnt: 16070, scgt: 17500, gt: 18000, category: "dry_bulk", buildYear: 2012, craneCount: 4, craneSwlMt: 30, searchlightCompliant: true, firstTransit: false },
  voyage: { direction: "SB", cargoStatus: "laden", transitDate: "2026-04-20" },
};

// ── 1 · RUBATO, v1 (Apr 2026): tolls 189,854 + other 11,221 = 201,075 ─────────
{
  const e = estimateSuezTransit(rubato, ctxFor(1, "2026-04-20"));
  ok(e.ok, "RUBATO computes");
  near(e.totals.tollUsd, 189854, 2, "RUBATO toll USD");
  near(e.totals.fixedUsd, 11221, 0.01, "RUBATO fixed layer");
  near(e.totals.appliedUsd, 201075, 2, "RUBATO total");
  ok(e.layers.fixed.length === 12, `12 fixed lines (got ${e.layers.fixed.length})`);
  ok(e.totals.conditionalAppliedUsd === 0, "no conditional charge applied");
  ok(e.layers.conditional.every((f) => !f.triggered), "no flag triggered on a compliant ship");
  ok(e.layers.toll.placeholder && e.warnings.some((w) => w.includes("placeholder")), "placeholder tiers are flagged");
  ok(e.wasteIncludedM3 === 4, `SCNT 16,070 → 4 m³ included (got ${e.wasteIncludedM3})`);
  ok(e.totals.potentialUsd >= e.totals.appliedUsd, "potential ≥ applied");
  ok(e.transitDays === 1 && e.anchorageDays === 0.5, "Suez days from settings");
  const toll = e.layers.toll;
  near(toll.sdr, 16070 * 8.687, 0.01, "toll SDR = SCNT × rate");
  ok(toll.tiers.length === 1 && toll.tiers[0].tons === 16070, "single open placeholder band");
}

// ── 2 · v2 (from 15 May 2026): mooring by GT threshold ───────────────────────
{
  const e = estimateSuezTransit({ ...rubato, voyage: { ...rubato.voyage, transitDate: "2026-06-01" } }, ctxFor(2, "2026-06-01"));
  near(e.totals.fixedUsd, 11521, 0.01, "v2 fixed with mooring 3,800 (GT ≥ 2,500)");
  const small = estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, gt: 2000 } }, ctxFor(2, "2026-06-01"));
  near(small.totals.fixedUsd, 11221 - 3500 + 2350, 0.01, "v2 fixed with mooring 2,350 (GT < 2,500)");
  const noGt = estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, gt: null } }, ctxFor(2, "2026-06-01"));
  near(noGt.totals.fixedUsd, 11521, 0.01, "GT not sourced assumes the higher mooring band");
  ok(noGt.warnings.some((w) => w.includes("GT not sourced")), "GT-not-sourced warning");
}

// ── 3 · Ballast tariff ──────────────────────────────────────────────────────
{
  const e = estimateSuezTransit({ ...rubato, voyage: { ...rubato.voyage, cargoStatus: "ballast" } }, ctxFor(1, "2026-04-20"));
  near(e.layers.toll.sdr, 16070 * 6.515, 0.01, "ballast toll SDR");
  ok(!e.layers.conditional.some((f) => f.code === "heavy_lift"), "laden-only flags hidden in ballast");
}

// ── 4 · Conditional charges ────────────────────────────────────────────────
{
  const rate = 1.359985;
  const tollSdr = 16070 * 8.687;
  const e = estimateSuezTransit({
    vessel: { ...rubato.vessel, gt: 12000, mooringCranesOk: false, searchlightCompliant: false },
    voyage: { ...rubato.voyage, lateArrivalBand: "b2", notReady: true, heavyLiftOver250t: true, militaryCargo: true, deckProtrusionFt: 3.5, ladderNoncompliant: true, relievingPilots: 2 },
  }, ctxFor(1, "2026-04-20"));
  const by = Object.fromEntries(e.layers.conditional.map((f) => [f.code, f]));
  ok(by.imposed_tug.triggered, "imposed tug triggered (GT > 10,000, no cranes)");
  near(by.imposed_tug.appliedUsd, 22000 * rate, 0.01, "imposed tug 22,000 SDR");
  ok(by.late_arrival.triggered, "late arrival triggered");
  near(by.late_arrival.appliedUsd, (tollSdr * 0.10) * rate, 0.02, "late band b2 = 10% of toll (under cap)");
  near(by.late_arrival.potentialUsd ?? 0, (tollSdr * 0.12) * rate, 0.02, "late potential = worst band");
  near(by.no_searchlight.appliedUsd, 5000, 0.01, "v1 (art. 28): USD 5,000 on a second or later transit");
  const first = estimateSuezTransit({ vessel: { ...rubato.vessel, searchlightCompliant: false, firstTransit: true }, voyage: rubato.voyage }, ctxFor(1, "2026-04-20"));
  const fl = first.layers.conditional.find((f) => f.code === "no_searchlight")!;
  ok(!fl.triggered && fl.reason.includes("day-time"), "v1: first transit without a searchlight is a delay, not a due");
  const v2 = estimateSuezTransit({ vessel: { ...rubato.vessel, searchlightCompliant: false, firstTransit: true }, voyage: { ...rubato.voyage, transitDate: "2026-06-01" } }, ctxFor(2, "2026-06-01"));
  near(v2.layers.conditional.find((f) => f.code === "no_searchlight")!.appliedUsd, 500, 0.01, "v2 (Circular 1/2026): USD 500 per transit from the first transit");
  near(by.not_ready.appliedUsd, 5000, 0.01, "not ready");
  near(by.heavy_lift.appliedUsd, tollSdr * 0.5 * rate, 0.02, "heavy lift +50%");
  near(by.military_cargo.appliedUsd, tollSdr * 0.25 * rate, 0.02, "military +25%");
  near(by.deck_protrusion.appliedUsd, tollSdr * 0.08 * rate, 0.02, "protrusion 3.5 ft → 4 ft × 2% = 8%");
  near(by.ladder_noncompliant.appliedUsd, 5000, 0.01, "ladder");
  near(by.relieving_pilot.appliedUsd, 2000, 0.01, "two relieving pilots");
  ok(by.overage_inspection.triggered === false, "2012-built ship is not overage in 2026");
  near(e.totals.conditionalAppliedUsd, e.layers.conditional.reduce((a, f) => a + f.appliedUsd, 0), 0.01, "conditional sum");
  near(e.totals.appliedUsd, e.totals.tollUsd + e.totals.fixedUsd + e.totals.conditionalAppliedUsd + e.totals.wasteUsd, 0.02, "applied total adds up");
}

// ── 5 · Late-arrival caps and direction scope ─────────────────────────────
{
  const big = estimateSuezTransit({ vessel: { ...rubato.vessel, scnt: 100000, gt: 90000 }, voyage: { ...rubato.voyage, lateArrivalBand: "b1" } }, ctxFor(1, "2026-04-20"));
  const late = big.layers.conditional.find((f) => f.code === "late_arrival")!;
  near(late.appliedUsd, 12500 * 1.359985, 0.01, "5% of a large toll is capped at SDR 12,500");
  const nb = estimateSuezTransit({ ...rubato, voyage: { ...rubato.voyage, direction: "NB", lateArrivalBand: "b3" } }, ctxFor(1, "2026-04-20"));
  ok(!nb.layers.conditional.some((f) => f.code === "late_arrival"), "late-arrival item is SB-only");
}

// ── 6 · Waste tiers at the boundaries + extras ────────────────────────────
{
  const at = (scnt: number) => estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, scnt } }, ctxFor(2, "2026-06-01"));
  const waste = (scnt: number) => at(scnt).layers.fixed.find((l) => l.code === "waste_mandatory")!;
  near(waste(10000).amountUsd, 235, 0, "≤ 10,000 → 235"); ok(waste(10000).quantity === 3, "3 m³ included");
  near(waste(10001).amountUsd, 825, 0, "10,001 → 825");
  near(waste(40000).amountUsd, 825, 0, "40,000 → 825");
  near(waste(40001).amountUsd, 1120, 0, "40,001 → 1,120");
  near(waste(70000).amountUsd, 1120, 0, "70,000 → 1,120");
  near(waste(70001).amountUsd, 1410, 0, "70,001 → 1,410"); ok(waste(70001).quantity === 5, "5 m³ included");
  const e = estimateSuezTransit({ ...rubato, voyage: { ...rubato.voyage, wasteNormalM3: 6, wasteHazardousM3: 1, bagsM3: 6, bargeHours: 3 } }, ctxFor(1, "2026-04-20"));
  const w = Object.fromEntries(e.layers.waste.map((l) => [l.code, l.amountUsd]));
  near(w.waste_extra_m3, 2 * 99, 0, "6 m³ − 4 included = 2 × 99");
  near(w.waste_hazardous_m3, 1000, 0, "hazardous 1 m³");
  near(w.waste_bags, 60, 0, "bags 6 × 10");
  near(w.waste_barge_hours, 400, 0, "barge 3 h − 1 free = 2 × 200");
  near(e.totals.wasteUsd, 198 + 1000 + 60 + 400, 0, "waste extras total");
  const none = estimateSuezTransit(rubato, ctxFor(1, "2026-04-20"));
  ok(none.layers.waste.length === 0 && none.totals.wasteUsd === 0, "no extras when nothing declared");
}

// ── 7 · Flag-only conditions ───────────────────────────────────────────────
{
  const e = estimateSuezTransit({ vessel: { ...rubato.vessel, buildYear: 2000, firstTransit: true }, voyage: rubato.voyage }, ctxFor(1, "2026-04-20"));
  const by = Object.fromEntries(e.layers.conditional.map((f) => [f.code, f]));
  ok(by.overage_inspection.triggered && by.overage_inspection.potentialUsd === null && by.overage_inspection.appliedUsd === 0, "overage: flag, no amount");
  ok(by.first_transit.triggered && by.first_transit.appliedUsd === 0, "first transit: flag only");
  ok(e.totals.appliedUsd === estimateSuezTransit(rubato, ctxFor(1, "2026-04-20")).totals.appliedUsd, "flags do not change the applied total");
}

// ── 8 · Not computable cases ───────────────────────────────────────────────
{
  const noScnt = estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, scnt: null } }, ctxFor(1, "2026-04-20"));
  ok(!noScnt.ok && noScnt.totals.tollUsd === 0 && noScnt.warnings.some((w) => w.includes("SCNT")), "no SCNT → not ok, toll 0, warning");
  near(noScnt.totals.fixedUsd, 11221 - 825 + 235, 0.01, "fixed layer still computed without SCNT (lowest waste band)");
  const noRate = estimateSuezTransit(rubato, ctxFor(1, "2026-04-20", { sdr: null }));
  ok(!noRate.ok && noRate.totals.tollUsd === 0, "no SDR rate → not ok");
  const override = estimateSuezTransit({ ...rubato, overrides: { sdrRateUsd: 1.4 } }, ctxFor(1, "2026-04-20", { sdr: null }));
  ok(override.ok, "manual SDR override computes");
  near(override.totals.tollUsd, 16070 * 8.687 * 1.4, 0.02, "override rate applied");
  const unknownCat = estimateSuezTransit({ ...rubato, vessel: { ...rubato.vessel, category: "hovercraft" } }, ctxFor(1, "2026-04-20"));
  ok(unknownCat.ok && unknownCat.categoryUsed === "general_cargo" && unknownCat.warnings.some((w) => w.includes("general_cargo")), "unknown category falls back with a warning");
  const noTiers = estimateSuezTransit(rubato, ctxFor(1, "2026-04-20", { tiers: [] }));
  ok(!noTiers.ok && noTiers.totals.tollUsd === 0, "no tiers at all → not ok");
  const all = [noScnt, noRate, override, unknownCat, noTiers];
  ok(all.every((e) => Number.isFinite(e.totals.appliedUsd) && Number.isFinite(e.totals.potentialUsd)), "totals are always finite");
}

// ── 9 · Progressive bands (what the SCA circular will look like) ───────────
{
  const tiers: SuezTollTier[] = [
    { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 0, scntFrom: 0, scntTo: 5000, sdrPerScnt: 8.0, confidence: "official" },
    { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 1, scntFrom: 5000, scntTo: 10000, sdrPerScnt: 6.0, confidence: "official" },
    { vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 2, scntFrom: 10000, scntTo: null, sdrPerScnt: 4.0, confidence: "official" },
  ];
  near(tollSdrFromTiers(16070, tiers).sdr, 5000 * 8 + 5000 * 6 + 6070 * 4, 0.01, "progressive bands");
  near(tollSdrFromTiers(3000, tiers).sdr, 3000 * 8, 0.01, "within the first band");
  const e = estimateSuezTransit(rubato, ctxFor(1, "2026-04-20", { tiers }));
  ok(!e.layers.toll.placeholder && !e.warnings.some((w) => w.includes("placeholder")), "official tiers carry no placeholder warning");
  ok(e.layers.toll.tiers.length === 3 && e.layers.toll.tiers[2].tons === 6070, "tier lines explain the bands");
}

// ── 10 · Category mapping ─────────────────────────────────────────────────
{
  ok(suezCategoryFromVesselType("Bulk Carrier") === "dry_bulk", "Bulk Carrier → dry_bulk");
  ok(suezCategoryFromVesselType("General Cargo") === "general_cargo", "General Cargo → general_cargo");
  ok(suezCategoryFromVesselType("Break Bulk") === "general_cargo", "Break Bulk → general_cargo");
  ok(suezCategoryFromVesselType("Container") === "container", "Container → container");
  ok(suezCategoryFromVesselType(null) === "general_cargo", "unknown → general_cargo");
}

// ── 11 · Contract: the fixture mirrors the seed migration ─────────────────
{
  const sql = readFileSync(new URL("../supabase/migrations/20261003200100_suez_tariff_seed.sql", import.meta.url), "utf8");
  for (const it of seedItems(2)) ok(sql.includes(`'${it.code}'`), `seed migration defines item ${it.code}`);
  for (const n of ["316", "500", "2745", "663", "1578", "19", "100", "75", "150", "750", "3500", "3800", "2350", "22000", "12500", "25000", "30000", "235", "825", "1120", "1410", "99", "1000"]) {
    ok(sql.includes(n), `seed migration carries the figure ${n}`);
  }
  ok(!sql.includes("insert into public.suez_toll_tiers") && !sql.includes("insert into public.sdr_rates"), "seed publishes no toll tiers and no SDR rate (r2: no placeholder truth)");
  ok(!sql.includes("8.687") && !sql.includes("1.359985"), "legacy proforma rate and back-solved SDR stay fixture-only");
  const schema = readFileSync(new URL("../supabase/migrations/20261003200000_suez_tariff_schema.sql", import.meta.url), "utf8");
  ok(schema.includes("grant execute on function public.get_suez_tariff_context(date) to authenticated, service_role"), "member read is granted");
  ok(/revoke all on table public\.suez_tariff_versions[\s\S]*?from public, anon, authenticated/.test(schema), "tariff tables are closed to members");
  const down = readFileSync(new URL("../supabase/rollback/20261003_suez_voyage_down.sql", import.meta.url), "utf8");
  for (const t of ["suez_tariff_versions", "suez_tariff_items", "suez_toll_tiers", "sdr_rates", "vessel_economics_profiles", "eca_zones"]) ok(down.includes(`drop table if exists public.${t}`), `DOWN drops ${t}`);
}

console.log(`suez-check: ${checks} checks passed`);
