// Suez Canal transit cost engine — pure, deterministic, no I/O (suez-engine/3).
//
// estimateSuezTransit(input, ctx) prices one transit against the published
// tariff version in force on the transit date: (1) the progressive SCNT toll
// in SDR converted at the dated SDR rate, (2) the fixed accompanying charges,
// (3) the conditional charges as risk flags, applied only when the facts say
// the condition holds, plus the waste block. Every line carries a status and
// nothing is substituted for a missing governed input (audit O2C-022/024):
//   · no SCNT → toll and SCNT-banded lines `unavailable`;
//   · no SDR rate on or before the date → SDR-denominated lines `unavailable`;
//   · no toll bands for the vessel's category → toll `unavailable` (no other
//     category is borrowed);
//   · placeholder bands → toll `placeholder`, estimate `partial`;
//   · SCNT above the last published band → toll `unavailable` (never charged at
//     the ceiling; publication also requires an open-ended last band);
//   · category surcharges (suez-engine/3, audit C2O-039): a version whose
//     surcharge regime is `unknown` cannot price a trusted toll (surcharge
//     `unavailable`); `modelled` needs an item scoped to the vessel category
//     (else `unavailable`); a `reported` item is `placeholder`, never trusted;
//   · unknown GT → GT-banded line `unavailable`, GT-gated flag undecided;
//   · unknown transit history / searchlight / cranes → flag undecided (null),
//     never a charge;
//   · malformed tariff params → line `invalid`, estimate `invalid`;
//   · a manual SDR rate carries actor, reason and time and marks the toll
//     `manual`.
// Thresholds (GT 10,000, SWL 3 t, two boats, 20 years) come from the item
// params, not from this file.

import { parseSuezInput } from "./schemas";
import {
  SUEZ_ALGORITHM_VERSION,
  type EstimateStatus,
  type LineStatus,
  type SuezCargoStatus,
  type SuezDirection,
  type SuezEstimate,
  type SuezFlag,
  type SuezInput,
  type SuezLine,
  type SuezSurchargeRegime,
  type SuezTariffContext,
  type SuezTariffItem,
  type SuezTollTier,
  type SuezTollTierLine,
} from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)); // deterministic, locale-free

function inScope(item: SuezTariffItem, direction: SuezDirection, cargoStatus: SuezCargoStatus, category: string): boolean {
  if (item.directionScope !== "any" && item.directionScope !== direction) return false;
  if (item.cargoStatusScope !== "any" && item.cargoStatusScope !== cargoStatus) return false;
  if (Array.isArray(item.categoryScope) && item.categoryScope.length > 0 && !item.categoryScope.includes(category)) return false;
  return true;
}

// Progressive bands: tons in each band × its SDR rate. `ceiling` is set when the
// highest band is finite and the SCNT lies above it (those tons are not charged:
// the caller must treat the toll as unavailable).
export function tollSdrFromTiers(scnt: number, tiers: SuezTollTier[]): { sdr: number; lines: SuezTollTierLine[]; ceiling: number | null } {
  const sorted = [...tiers].sort((a, b) => a.tierOrder - b.tierOrder);
  const lines: SuezTollTierLine[] = [];
  let sdr = 0;
  for (const t of sorted) {
    const lo = t.scntFrom;
    const hi = t.scntTo == null ? Number.POSITIVE_INFINITY : t.scntTo;
    const tons = Math.max(0, Math.min(scnt, hi) - lo);
    const amount = tons * t.sdrPerScnt;
    lines.push({ tierOrder: t.tierOrder, scntFrom: lo, scntTo: t.scntTo, tons, sdrPerScnt: t.sdrPerScnt, sdr: round2(amount) });
    sdr += amount;
  }
  const last = sorted[sorted.length - 1];
  const ceiling = last && last.scntTo != null && scnt > last.scntTo ? last.scntTo : null;
  return { sdr, lines, ceiling };
}

interface WasteTier { from: number; to: number | null; amount: number; includedUnits: number }

function wasteTierFor(scnt: number, tiers: WasteTier[]): WasteTier | null {
  for (const t of tiers) {
    const hi = t.to == null ? Number.POSITIVE_INFINITY : t.to;
    // (from, to]: "up to 10,000" is the first band, "more than 10,000 up to 40,000" the next.
    if ((scnt > t.from || (t.from === 0 && scnt >= 0)) && scnt <= hi) return t;
  }
  return null;
}

type Conv = { rate: number | null; status: LineStatus };

export function estimateSuezTransit(rawInput: SuezInput, ctx: SuezTariffContext): SuezEstimate {
  const parsed = parseSuezInput(rawInput);
  const base = {
    algorithmVersion: SUEZ_ALGORITHM_VERSION,
    tariffVersion: ctx.version,
    sources: ctx.sources ?? [],
  };
  if (!parsed.ok) {
    return {
      ...base,
      status: "invalid", ok: false,
      sdrRate: { status: "unavailable", rateUsd: null, asOf: null, source: null },
      vesselCategory: String(rawInput?.vessel?.category ?? ""), scnt: null,
      cargoStatus: (rawInput?.voyage?.cargoStatus as SuezCargoStatus) ?? "laden",
      direction: (rawInput?.voyage?.direction as SuezDirection) ?? "SB",
      transitDate: String(rawInput?.voyage?.transitDate ?? ctx.date),
      layers: { toll: { status: "unavailable", sdr: null, usd: null, tiers: [], reason: "invalid input" }, surcharge: { status: "unavailable", regime: ctx.version.surchargeRegime ?? "unknown", lines: [], reason: "invalid input" }, fixed: [], conditional: [], waste: [] },
      wasteIncludedM3: null,
      totals: { tollUsd: null, surchargeUsd: 0, fixedUsd: 0, conditionalAppliedUsd: 0, wasteUsd: 0, appliedUsd: 0, potentialUsd: 0, complete: false },
      unavailable: [], invalid: [], transitDays: 0, anchorageDays: 0,
      warnings: [], errors: parsed.errors,
    };
  }
  const input = parsed.value;
  const { vessel, voyage } = input;
  const direction = voyage.direction;
  const cargoStatus = voyage.cargoStatus;
  const warnings: string[] = [];
  const unavailable: { code: string; reason: string }[] = [];
  const invalid: { code: string; reason: string }[] = [];

  // ── SDR → USD ────────────────────────────────────────────────────────────
  let conv: Conv;
  let sdrRate: SuezEstimate["sdrRate"];
  if (input.overrides?.sdrRate) {
    const m = input.overrides.sdrRate;
    conv = { rate: m.value, status: "manual" };
    sdrRate = { status: "manual", rateUsd: m.value, asOf: m.at.slice(0, 10), source: "manual override", manual: m };
    warnings.push(`SDR rate ${fmt(m.value)} USD entered manually by the broker (${m.reason}).`);
  } else if (ctx.sdr && isNum(ctx.sdr.rateUsd) && ctx.sdr.rateUsd > 0 && ctx.sdr.asOf <= ctx.date) {
    conv = { rate: ctx.sdr.rateUsd, status: "trusted" };
    sdrRate = { status: "trusted", rateUsd: ctx.sdr.rateUsd, asOf: ctx.sdr.asOf, source: ctx.sdr.source };
  } else {
    conv = { rate: null, status: "unavailable" };
    sdrRate = { status: "unavailable", rateUsd: null, asOf: null, source: null };
    warnings.push("No SDR→USD rate is on file on or before the transit date; SDR amounts cannot be converted.");
  }
  const toUsd = (sdr: number): number | null => (conv.rate == null ? null : sdr * conv.rate);
  const items = ctx.items.filter((i) => inScope(i, direction, cargoStatus, vessel.category));

  // ── Layer 1 · toll ───────────────────────────────────────────────────────
  const scnt = vessel.scnt;
  const tiers = ctx.tiers.filter((t) => t.vesselCategory === vessel.category && t.cargoStatus === cargoStatus);
  const toll: SuezEstimate["layers"]["toll"] = { status: "trusted", sdr: null, usd: null, tiers: [], reason: null };
  if (scnt == null) {
    toll.status = "unavailable"; toll.reason = "SCNT not sourced (Suez Canal special tonnage certificate).";
  } else if (tiers.length === 0) {
    toll.status = "unavailable"; toll.reason = `No SCA toll bands for category "${vessel.category}" (${cargoStatus}) in tariff v${ctx.version.versionNo}; the SCA tolls circular has not been loaded for it.`;
  } else {
    const r = tollSdrFromTiers(scnt, tiers);
    toll.tiers = r.lines;
    const usd = toUsd(r.sdr);
    if (r.ceiling != null) { toll.status = "unavailable"; toll.reason = `SCNT ${fmt(scnt)} lies above the highest published band (${fmt(r.ceiling)} SCNT); the toll is not charged at the ceiling.`; }
    else if (usd == null) { toll.sdr = round2(r.sdr); toll.status = "unavailable"; toll.reason = "SDR rate unavailable."; }
    else {
      toll.sdr = round2(r.sdr);
      toll.usd = round2(usd);
      toll.status = tiers.some((t) => t.confidence === "placeholder") ? "placeholder" : conv.status;
      if (toll.status === "placeholder") toll.reason = "Toll bands are placeholders, not the official SCA circular.";
    }
  }
  if (toll.status === "unavailable") unavailable.push({ code: "transit_toll", reason: toll.reason ?? "unavailable" });
  if (toll.status === "placeholder") warnings.push("The toll bands in force are placeholders; the toll figure is not official.");

  // ── Layer 1b · category surcharges on the toll ─────────────────────────
  const regime: SuezSurchargeRegime = ctx.version.surchargeRegime ?? "unknown";
  const surcharge: SuezEstimate["layers"]["surcharge"] = { status: "trusted", regime, lines: [], reason: null };
  const surchargeItems = items.filter((i) => i.layer === "surcharge");
  if (toll.sdr == null) {
    surcharge.status = "unavailable"; surcharge.reason = "The toll is not computable, so its surcharge is not either.";
  } else if (regime === "none") {
    surcharge.reason = `No category surcharge was in force for tariff v${ctx.version.versionNo}.`;
    if (surchargeItems.length > 0) { surcharge.status = "invalid"; surcharge.reason = "The version says no surcharge is in force but carries surcharge items."; invalid.push({ code: "category_surcharge", reason: surcharge.reason }); }
  } else if (regime === "unknown") {
    surcharge.status = "unavailable";
    surcharge.reason = `Tariff v${ctx.version.versionNo} does not model the SCA category surcharges (temporary surcharges in force since 15 Jul 2026); the base dues alone are not the transit cost.`;
    unavailable.push({ code: "category_surcharge", reason: surcharge.reason });
  } else if (surchargeItems.length === 0) {
    surcharge.status = "unavailable";
    surcharge.reason = `Tariff v${ctx.version.versionNo} models surcharges but none covers "${vessel.category}" (${cargoStatus}, ${direction}).`;
    unavailable.push({ code: "category_surcharge", reason: surcharge.reason });
  } else {
    for (const item of surchargeItems) {
      const pct = item.params?.pct;
      if (!isNum(pct) || pct < 0 || pct > 1000) {
        const l = baseLine(item, "invalid", null, null, "params.pct must be a number between 0 and 1000");
        surcharge.lines.push(l); invalid.push({ code: l.code, reason: l.explanation }); continue;
      }
      const native = (toll.sdr * pct) / 100;
      const usd = toUsd(native);
      const reported = item.confidence === "reported";
      const st: LineStatus = usd == null ? "unavailable" : reported || toll.status === "placeholder" ? "placeholder" : conv.status === "manual" || toll.status === "manual" ? "manual" : "trusted";
      const l: SuezLine = { ...baseLine(item, st, native, usd, `${fmt(pct)}% of the toll (SDR ${fmt(round2(toll.sdr))})${reported ? " · reported rate, instrument not on file" : ""}${item.notes ? ` · ${item.notes}` : ""}.`), currency: "SDR" };
      surcharge.lines.push(l);
      if (st === "unavailable") unavailable.push({ code: l.code, reason: "SDR rate unavailable." });
    }
    const rank: Record<LineStatus, number> = { trusted: 0, manual: 1, placeholder: 2, unavailable: 3, invalid: 4 };
    surcharge.status = surcharge.lines.reduce<LineStatus>((w, l) => (rank[l.status] > rank[w] ? l.status : w), "trusted");
    if (surcharge.lines.some((l) => l.status === "placeholder")) warnings.push("The category surcharge rate is reported, not taken from an SCA instrument on file; the toll is not trusted.");
  }
  const surchargeUsd = round2(surcharge.lines.reduce((a, l) => a + (l.amountUsd ?? 0), 0));

  // ── Layer 2 · fixed ──────────────────────────────────────────────────────
  const fixed: SuezLine[] = [];
  let wasteIncludedM3: number | null = null;
  for (const item of items.filter((i) => i.layer === "fixed")) {
    const line = evalFixed(item, { scnt, gt: vessel.gt, toUsd, convStatus: conv.status });
    if (!line) continue;
    if (item.basis === "tier_by_scnt" && line.status !== "unavailable" && line.status !== "invalid" && typeof line.quantity === "number") wasteIncludedM3 = line.quantity;
    fixed.push(line);
    if (line.status === "unavailable") unavailable.push({ code: line.code, reason: line.explanation });
    if (line.status === "invalid") invalid.push({ code: line.code, reason: line.explanation });
  }
  const fixedUsd = round2(fixed.reduce((a, l) => a + (l.amountUsd ?? 0), 0));

  // ── Layer 3 · conditional (risk flags) ───────────────────────────────────
  const conditional: SuezFlag[] = [];
  const transitYear = Number(voyage.transitDate.slice(0, 4));
  const age = vessel.buildYear != null ? transitYear - vessel.buildYear : null;
  for (const item of items.filter((i) => i.layer === "conditional")) {
    const key = item.conditionKey ?? item.code;
    const p = item.params ?? {};
    let triggered: boolean | null = false;
    let reason = "";
    let quantity: number | null = null;
    let paramError: string | null = null;
    switch (key) {
      case "no_mooring_cranes": {
        const gtThreshold = p.gtThreshold, swl = p.swlMt, boats = p.boats;
        if (!isNum(gtThreshold) || !isNum(swl) || !isNum(boats)) { paramError = "params need gtThreshold, swlMt and boats"; break; }
        const ok = vessel.mooringCranesOk ?? (vessel.craneSwlMt != null ? vessel.craneSwlMt >= swl && (vessel.craneCount ?? 1) >= 1 : null);
        if (vessel.gt == null) { triggered = null; reason = `GT not sourced: cannot tell whether the ${fmt(gtThreshold)} GT mooring-boat rule applies.`; }
        else if (vessel.gt <= gtThreshold) reason = `GT ${fmt(vessel.gt)} ≤ ${fmt(gtThreshold)}: one mooring boat, no lifting requirement.`;
        else if (ok === false) { triggered = true; reason = `GT ${fmt(vessel.gt)} > ${fmt(gtThreshold)} and the vessel cannot lift ${fmt(boats)} mooring boats (cranes SWL ${fmt(swl)} t).`; }
        else if (ok == null) { triggered = null; reason = `GT > ${fmt(gtThreshold)}: confirm cranes of SWL ${fmt(swl)} t can lift ${fmt(boats)} mooring boats; otherwise a tug is imposed.`; }
        else reason = `Cranes can lift the ${fmt(boats)} mooring boats.`;
        break;
      }
      case "late_arrival": {
        const band = voyage.lateArrivalBand ?? "none";
        if (band !== "none") { triggered = true; reason = `Arrival in band ${band}.`; } else reason = "Arrival before the 23:00 limit line.";
        break;
      }
      case "no_searchlight": {
        const fromSecond = p.fromSecondTransit === true;
        if (vessel.searchlightCompliant === false) {
          if (!fromSecond) { triggered = true; reason = "No compliant searchlight on board."; }
          else if (vessel.firstTransit === true) reason = "No compliant searchlight on a first transit: day-time transit only (delay), no due until the second transit.";
          else if (vessel.firstTransit === false) { triggered = true; reason = "No compliant searchlight on a second or later transit."; }
          else { triggered = null; reason = "No compliant searchlight and the transit history is unknown: the USD 5,000 due applies from the second transit — confirm whether the vessel transited before."; }
        } else if (vessel.searchlightCompliant == null) { triggered = null; reason = "Searchlight compliance not sourced (Rules of Navigation art. 28)."; }
        else reason = "Compliant searchlight on board.";
        break;
      }
      case "not_ready": triggered = voyage.notReady === true; reason = triggered ? "Vessel declared not ready for the convoy." : "Applies only if the vessel is found not ready."; break;
      case "heavy_lift": triggered = voyage.heavyLiftOver250t === true; reason = triggered ? "Heavy unit of 250 t or more declared." : "No unit of 250 t or more."; break;
      case "floating_unit": triggered = voyage.floatingUnitScgt300 === true; reason = triggered ? "Floating unit of SCGT 300 or more carried." : "No floating unit carried."; break;
      case "military": triggered = voyage.militaryCargo === true; reason = triggered ? "Navy/government charter or military cargo declared." : "No military involvement declared."; break;
      case "deck_protrusion": {
        const ft = voyage.deckProtrusionFt ?? 0;
        if (ft > 0) { triggered = true; quantity = Math.ceil(ft); reason = `Deck cargo protrudes ${fmt(ft)} ft beyond the limit.`; } else reason = "No protrusion beyond the allowed limit.";
        break;
      }
      case "ladder_noncompliant": triggered = voyage.ladderNoncompliant === true; reason = triggered ? "Pilot/accommodation ladder declared non-compliant." : "Ladders compliant."; break;
      case "relieving_pilots": {
        const n = Math.floor(voyage.relievingPilots ?? 0);
        if (n > 0) { triggered = true; quantity = n; reason = `${n} relieving pilot(s) at the lakes.`; } else reason = "Pilot change at Ismailia as normal.";
        break;
      }
      case "overage": {
        const ageYears = p.ageYears;
        if (!isNum(ageYears)) { paramError = "params need ageYears"; break; }
        if (age == null) { triggered = null; reason = "Build year not sourced: the over-age inspection rule cannot be decided."; }
        else if (age > ageYears) { triggered = true; reason = `Vessel is ${age} years old (> ${fmt(ageYears)}): SCA inspection on arrival.`; }
        else reason = `Vessel is ${age} years old.`;
        break;
      }
      case "first_transit":
        if (vessel.firstTransit === true) { triggered = true; reason = "First Suez transit: the SCNT will be measured on arrival; the toll estimate is provisional."; }
        else if (vessel.firstTransit === false) reason = "Not a first transit.";
        else { triggered = null; reason = "Transit history unknown: confirm whether this is the vessel's first Suez transit."; }
        break;
      case "escort_tugs": {
        // Rules are data; an unknown fact a rule needs makes it undecided, never a charge or a waiver.
        const rules = Array.isArray(p.rules) ? (p.rules as Record<string, unknown>[]) : null;
        if (!rules || rules.length === 0) { paramError = "params.rules must list the escort triggers"; break; }
        let tugs = 0; let undecidedTugs = 0; const hits: string[] = []; const unknowns = new Set<string>();
        for (const r of rules) {
          const t = isNum(r.tugs) ? r.tugs : 0;
          if (r.status && r.status !== cargoStatus) continue;
          if (Array.isArray(r.categories) && !(r.categories as string[]).includes(vessel.category)) continue;
          if (Array.isArray(r.excludeCategories) && (r.excludeCategories as string[]).includes(vessel.category)) continue;
          let verdict: boolean | null = true;
          const need = (known: boolean, ok: boolean, fact: string) => { if (!known) { unknowns.add(fact); if (verdict !== false) verdict = null; } else if (!ok) verdict = false; };
          if (isNum(r.scntMin) || isNum(r.scntBelow)) need(vessel.scnt != null, vessel.scnt != null && (!isNum(r.scntMin) || vessel.scnt > (r.scntMin as number)) && (!isNum(r.scntBelow) || vessel.scnt < (r.scntBelow as number)), "SCNT");
          if (isNum(r.draftFtOver)) need(vessel.draftFt != null, vessel.draftFt != null && vessel.draftFt > (r.draftFtOver as number), "arrival draft");
          if (isNum(r.beamFtOver) || isNum(r.beamFtMax)) need(vessel.beamFt != null, vessel.beamFt != null && (!isNum(r.beamFtOver) || vessel.beamFt > (r.beamFtOver as number)) && (!isNum(r.beamFtMax) || vessel.beamFt <= (r.beamFtMax as number)), "beam");
          if (r.doubleBottom === false) need(vessel.doubleBottom != null, vessel.doubleBottom === false, "double-bottom tanks");
          if (verdict === true && t > tugs) { tugs = t; hits.push(`${t} tug(s)`); }
          if (verdict === null && t > undecidedTugs) undecidedTugs = t;
        }
        if (tugs > 0) { triggered = true; quantity = tugs; reason = `${tugs} escort tug(s) required by the SCA escort rules for this ${cargoStatus} ${vessel.category} transit.`; }
        else if (undecidedTugs > 0) { triggered = null; reason = `Escort tugs may be required (up to ${undecidedTugs}); not sourced: ${[...unknowns].join(", ")}.`; }
        else reason = "No escort tug required by the SCA escort rules.";
        break;
      }
      case "contingent": {
        const amt = isNum(p.amount) ? p.amount : null;
        triggered = false;
        reason = `${amt != null ? `${typeof p.currency === "string" ? p.currency : item.currency} ${fmt(amt)}` : "Charge"} only if it happens: ${item.notes ?? item.labelEn}.`;
        break;
      }
      default:
        triggered = null; reason = `Unknown condition "${key}".`; paramError = `unknown condition key "${key}"`;
    }
    const flag = evalConditional(item, { key, triggered, reason, quantity, tollSdr: toll.sdr, toUsd, lateBand: voyage.lateArrivalBand ?? "none", convStatus: conv.status, paramError });
    if (key === "contingent") flag.contingent = true;
    // A required escort has no published rate: the SCA invoices it, so the transit total is not complete without it.
    if (key === "escort_tugs" && flag.triggered === true && flag.status !== "invalid") {
      flag.status = "unavailable";
      flag.explanation = `${flag.reason} No published rate: the SCA charges escort tugs on its invoice.`;
    }
    conditional.push(flag);
    if (flag.status === "invalid") invalid.push({ code: flag.code, reason: flag.explanation });
    if (flag.triggered === null) warnings.push(`${flag.label}: ${flag.reason}`);
    if (flag.triggered === true && flag.status === "unavailable") unavailable.push({ code: flag.code, reason: flag.explanation });
  }
  const conditionalAppliedUsd = round2(conditional.reduce((a, f) => a + f.appliedUsd, 0));
  const potentialExtra = conditional.filter((f) => f.triggered !== true && f.potentialUsd != null).reduce((a, f) => a + (f.potentialUsd ?? 0), 0);

  // ── Waste extras ────────────────────────────────────────────────────────
  const waste: SuezLine[] = [];
  for (const item of items.filter((i) => i.layer === "waste")) {
    let units: number | null = 0;
    switch (item.code) {
      case "waste_extra_m3": units = (voyage.wasteNormalM3 ?? 0) > 0 ? (wasteIncludedM3 == null ? null : Math.max(0, (voyage.wasteNormalM3 ?? 0) - wasteIncludedM3)) : 0; break;
      case "waste_hazardous_m3": units = voyage.wasteHazardousM3 ?? 0; break;
      case "waste_bags": units = voyage.bagsM3 ?? 0; break;
      case "waste_barge_hours": units = voyage.bargeHours ?? 0; break;
      default: units = 0;
    }
    if (units == null) {
      const l = baseLine(item, "unavailable", null, null, "Declared waste cannot be priced: the included volume depends on the SCNT, which is not sourced.");
      waste.push(l); unavailable.push({ code: l.code, reason: l.explanation }); continue;
    }
    const line = evalPerUnit(item, units, toUsd, conv.status);
    if (line.status === "invalid") { waste.push(line); invalid.push({ code: line.code, reason: line.explanation }); continue; }
    if ((line.amountUsd ?? 0) > 0 || line.status === "unavailable") {
      if (line.status === "unavailable" && units > 0) { waste.push(line); unavailable.push({ code: line.code, reason: line.explanation }); }
      else if ((line.amountUsd ?? 0) > 0) waste.push(line);
    }
  }
  const wasteUsd = round2(waste.reduce((a, l) => a + (l.amountUsd ?? 0), 0));

  // ── Totals and status ──────────────────────────────────────────────────
  const appliedUsd = round2((toll.usd ?? 0) + surchargeUsd + fixedUsd + conditionalAppliedUsd + wasteUsd);
  const complete = unavailable.length === 0 && invalid.length === 0 && toll.usd != null;
  const daysManual = !!(input.overrides?.transitDays || input.overrides?.anchorageDays);
  // Official figures stand on an official instrument whose file is on record; otherwise the estimate is partial.
  const evidenceOnFile = (ctx.sources ?? []).some((src) => src.authority === "official" && src.evidenceStatus === "on_file");
  if (!evidenceOnFile) warnings.push("No official SCA instrument with its file on record is cited by this tariff version; the figures are not trusted.");
  if (input.overrides?.transitDays) warnings.push(`Transit days ${fmt(input.overrides.transitDays.value)} entered manually (${input.overrides.transitDays.reason}).`);
  if (input.overrides?.anchorageDays) warnings.push(`Anchorage days ${fmt(input.overrides.anchorageDays.value)} entered manually (${input.overrides.anchorageDays.reason}).`);
  const daysGoverned = isNum(ctx.suezDays?.transitDays) && isNum(ctx.suezDays?.anchorageDays);
  if (!daysGoverned && !daysManual) warnings.push("Suez transit/anchorage days are not in the voyage settings; 1 and 0.5 days were assumed.");
  const transitDays = input.overrides?.transitDays?.value ?? (isNum(ctx.suezDays?.transitDays) ? ctx.suezDays.transitDays! : 1);
  const anchorageDays = input.overrides?.anchorageDays?.value ?? (isNum(ctx.suezDays?.anchorageDays) ? ctx.suezDays.anchorageDays! : 0.5);
  let status: EstimateStatus;
  if (invalid.length > 0) status = "invalid";
  else if (toll.status === "unavailable" && fixed.every((l) => l.status === "unavailable")) status = "unavailable";
  else if (!complete || !evidenceOnFile || daysManual || !daysGoverned || toll.status === "placeholder" || toll.status === "manual" || surcharge.status !== "trusted" || conditional.some((f) => f.triggered === null) || fixed.some((l) => l.status !== "trusted")) status = "partial";
  else status = "trusted";

  return {
    ...base,
    status,
    ok: status === "trusted",
    sdrRate,
    vesselCategory: vessel.category,
    scnt,
    cargoStatus,
    direction,
    transitDate: voyage.transitDate,
    layers: { toll, surcharge, fixed, conditional, waste },
    wasteIncludedM3,
    totals: { tollUsd: toll.usd, surchargeUsd, fixedUsd, conditionalAppliedUsd, wasteUsd, appliedUsd, potentialUsd: round2(appliedUsd + potentialExtra), complete },
    unavailable,
    invalid,
    transitDays,
    anchorageDays,
    warnings,
  };
}

// ── item evaluators ────────────────────────────────────────────────────────

function baseLine(item: SuezTariffItem, status: LineStatus, native: number | null, usd: number | null, explanation: string, quantity: number | null = null, unit: string | null = null): SuezLine {
  return {
    code: item.code, label: item.labelEn, labelAr: item.labelAr ?? null, layer: item.layer, basis: item.basis, currency: item.currency,
    status, amountNative: native == null ? null : round2(native), amountUsd: usd == null ? null : round2(usd), quantity, unit, explanation, payerParty: item.payerParty,
  };
}

function convert(item: SuezTariffItem, native: number, toUsd: (sdr: number) => number | null, convStatus: LineStatus): { usd: number | null; status: LineStatus } {
  if (item.currency === "USD") return { usd: native, status: "trusted" };
  const usd = toUsd(native);
  return usd == null ? { usd: null, status: "unavailable" } : { usd, status: convStatus === "manual" ? "manual" : "trusted" };
}

function evalFixed(item: SuezTariffItem, f: { scnt: number | null; gt: number | null; toUsd: (sdr: number) => number | null; convStatus: LineStatus }): SuezLine | null {
  const p = item.params ?? {};
  switch (item.basis) {
    case "flat": {
      if (!isNum(p.amount) || p.amount < 0) return baseLine(item, "invalid", null, null, "params.amount must be a non-negative number");
      const c = convert(item, p.amount, f.toUsd, f.convStatus);
      return baseLine(item, c.status, p.amount, c.usd, c.usd == null ? "SDR rate unavailable." : `Flat ${item.currency} ${fmt(p.amount)} per transit.`);
    }
    case "gt_threshold": {
      if (!isNum(p.threshold) || !isNum(p.below) || !isNum(p.atOrAbove)) return baseLine(item, "invalid", null, null, "params need threshold, below, atOrAbove");
      if (f.gt == null) return baseLine(item, "unavailable", null, null, `GT not sourced; the ${item.currency} ${fmt(p.below)} / ${fmt(p.atOrAbove)} band (threshold ${fmt(p.threshold)} GT) cannot be chosen.`);
      const amount = f.gt >= p.threshold ? p.atOrAbove : p.below;
      const c = convert(item, amount, f.toUsd, f.convStatus);
      return baseLine(item, c.status, amount, c.usd, `GT ${fmt(f.gt)} ${f.gt >= p.threshold ? "≥" : "<"} ${fmt(p.threshold)}: ${item.currency} ${fmt(amount)}.`);
    }
    case "tier_by_scnt": {
      const tiers = Array.isArray(p.tiers) ? (p.tiers as WasteTier[]) : [];
      if (tiers.length === 0 || tiers.some((t) => !isNum(t.from) || !isNum(t.amount) || !isNum(t.includedUnits) || (t.to != null && !isNum(t.to)))) return baseLine(item, "invalid", null, null, "params.tiers must be bands with numeric from/to/amount/includedUnits");
      const unit = typeof p.unit === "string" ? p.unit : "m3";
      if (f.scnt == null) return baseLine(item, "unavailable", null, null, "SCNT not sourced; the SCNT band cannot be chosen.", null, unit);
      const t = wasteTierFor(f.scnt, tiers);
      if (!t) return baseLine(item, "invalid", null, null, `no band covers SCNT ${fmt(f.scnt)}`);
      const c = convert(item, t.amount, f.toUsd, f.convStatus);
      const upper = t.to == null ? "and above" : `up to ${fmt(t.to)}`;
      return baseLine(item, c.status, t.amount, c.usd, `SCNT ${fmt(f.scnt)} → band ${fmt(t.from)} ${upper}: ${item.currency} ${fmt(t.amount)} (${fmt(t.includedUnits)} ${unit} included).`, t.includedUnits, unit);
    }
    case "per_unit":
      return evalPerUnit(item, isNum(p.units) ? p.units : 0, f.toUsd, f.convStatus);
    case "flag_only":
    case "toll_tiered_scnt":
    case "pct_of_toll":
    default:
      return null;
  }
}

function evalPerUnit(item: SuezTariffItem, units: number, toUsd: (sdr: number) => number | null, convStatus: LineStatus): SuezLine {
  const p = item.params ?? {};
  if (!isNum(p.rate) || p.rate < 0 || typeof p.unit !== "string") return baseLine(item, "invalid", null, null, "params need a non-negative rate and a unit");
  const free = isNum(p.freeUnits) ? p.freeUnits : 0;
  const chargeable = Math.max(0, units - free);
  const native = chargeable * p.rate;
  const c = convert(item, native, toUsd, convStatus);
  return baseLine(item, c.status, native, c.usd, `${fmt(units)} ${p.unit}${free > 0 ? ` − ${fmt(free)} free` : ""} = ${fmt(chargeable)} × ${item.currency} ${fmt(p.rate)}.`, chargeable, p.unit);
}

function evalConditional(
  item: SuezTariffItem,
  c: { key: string; triggered: boolean | null; reason: string; quantity: number | null; tollSdr: number | null; toUsd: (sdr: number) => number | null; lateBand: string; convStatus: LineStatus; paramError: string | null },
): SuezFlag {
  const p = item.params ?? {};
  const mk = (status: LineStatus, native: number | null, usd: number | null, explanation: string, potentialUsd: number | null, appliedUsd: number): SuezFlag => ({
    ...baseLine(item, status, native, usd, explanation, c.quantity, typeof p.unit === "string" ? p.unit : null),
    conditionKey: c.key, triggered: c.triggered, potentialUsd, appliedUsd, reason: c.reason,
  });
  if (c.paramError) return mk("invalid", null, null, c.paramError, null, 0);
  const conv = (native: number): number | null => (item.currency === "SDR" ? c.toUsd(native) : native);
  let native = 0;
  let potentialUsd: number | null = null;
  let explanation = "";
  let needsToll = false;
  switch (item.basis) {
    case "flat": {
      if (!isNum(p.amount) || p.amount < 0) return mk("invalid", null, null, "params.amount must be a non-negative number", null, 0);
      native = p.amount;
      potentialUsd = conv(native);
      explanation = `${item.currency} ${fmt(native)} when it applies.`;
      break;
    }
    case "pct_of_toll": {
      needsToll = true;
      if (Array.isArray(p.bands)) {
        const bands = p.bands as { key: string; label?: string; pct: number; capSdr?: number }[];
        if (bands.some((b) => !isNum(b.pct))) return mk("invalid", null, null, "params.bands need numeric pct", null, 0);
        const applyBand = (b: { pct: number; capSdr?: number }) => { const raw = ((c.tollSdr ?? 0) * b.pct) / 100; return isNum(b.capSdr) ? Math.min(raw, b.capSdr) : raw; };
        const worst = bands.reduce((m, b) => Math.max(m, applyBand(b)), 0);
        potentialUsd = c.tollSdr == null ? null : conv(worst);
        const chosen = bands.find((b) => b.key === c.lateBand);
        if (c.triggered === true && chosen) native = applyBand(chosen);
        explanation = bands.map((b) => `${b.label ?? b.key}: +${fmt(b.pct)}%${isNum(b.capSdr) ? ` (max SDR ${fmt(b.capSdr)})` : ""}`).join("; ") + " of the toll.";
      } else if (isNum(p.pctPerUnit)) {
        const pct = p.pctPerUnit * (c.quantity ?? 0);
        native = ((c.tollSdr ?? 0) * pct) / 100;
        potentialUsd = null;
        explanation = `+${fmt(p.pctPerUnit)}% of the toll per ${typeof p.unit === "string" ? p.unit : "unit"} beyond the limit${c.quantity ? ` → ${fmt(pct)}%` : ""}.`;
      } else if (isNum(p.pct)) {
        native = ((c.tollSdr ?? 0) * p.pct) / 100;
        potentialUsd = c.tollSdr == null ? null : conv(native);
        explanation = `+${fmt(p.pct)}% of the transit toll.`;
      } else return mk("invalid", null, null, "params need pct, pctPerUnit or bands", null, 0);
      break;
    }
    case "per_unit": {
      if (!isNum(p.rate) || p.rate < 0) return mk("invalid", null, null, "params need a non-negative rate", null, 0);
      const free = isNum(p.freeUnits) ? p.freeUnits : 0;
      native = Math.max(0, (c.quantity ?? 0) - free) * p.rate;
      potentialUsd = null;
      explanation = `${item.currency} ${fmt(p.rate)} per ${typeof p.unit === "string" ? p.unit : "unit"}.`;
      break;
    }
    case "flag_only":
    default:
      return mk("trusted", null, null, item.notes ?? "Cost determined by the SCA after inspection.", null, 0);
  }
  if (c.triggered !== true) {
    const status: LineStatus = needsToll && c.tollSdr == null ? "unavailable" : "trusted";
    return mk(status, 0, 0, explanation, potentialUsd == null ? null : round2(potentialUsd), 0);
  }
  if (needsToll && c.tollSdr == null) return mk("unavailable", null, null, `${explanation} The toll is unavailable, so this surcharge cannot be priced.`, null, 0);
  const usd = conv(native);
  if (usd == null) return mk("unavailable", native, null, `${explanation} SDR rate unavailable.`, null, 0);
  const status: LineStatus = item.currency === "SDR" && c.convStatus === "manual" ? "manual" : "trusted";
  return mk(status, native, usd, explanation, potentialUsd == null ? null : round2(potentialUsd), round2(usd));
}
