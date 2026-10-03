// Suez Canal transit cost engine — pure, deterministic, no I/O.
//
// estimateSuezTransit(input, ctx) turns one published tariff version
// (get_suez_tariff_context) plus the vessel/voyage facts into the three cost
// layers the owner specified: (1) the progressive SCNT toll in SDR converted at
// the dated SDR rate, (2) the fixed accompanying charges, (3) the conditional
// charges shown as risk flags and added only when their condition holds — plus
// the waste block. Every amount traces back to a tariff item; nothing here is
// a constant. Contract: PLAN-voyage-economics.md §4.2.

import type {
  SuezCargoStatus,
  SuezDirection,
  SuezEstimate,
  SuezFlag,
  SuezInput,
  SuezLine,
  SuezTariffContext,
  SuezTariffItem,
  SuezTollTier,
  SuezTollTierLine,
} from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown): boolean => v === true;

function inScope(item: SuezTariffItem, direction: SuezDirection, cargoStatus: SuezCargoStatus): boolean {
  if (item.directionScope !== "any" && item.directionScope !== direction) return false;
  if (item.cargoStatusScope !== "any" && item.cargoStatusScope !== cargoStatus) return false;
  return true;
}

// Progressive bands: tons in each band × its SDR rate.
export function tollSdrFromTiers(scnt: number, tiers: SuezTollTier[]): { sdr: number; lines: SuezTollTierLine[] } {
  const sorted = [...tiers].sort((a, b) => a.tierOrder - b.tierOrder);
  const lines: SuezTollTierLine[] = [];
  let sdr = 0;
  for (const t of sorted) {
    const lo = num(t.scntFrom);
    const hi = t.scntTo == null ? Number.POSITIVE_INFINITY : num(t.scntTo);
    const tons = Math.max(0, Math.min(scnt, hi) - lo);
    const amount = tons * num(t.sdrPerScnt);
    lines.push({ tierOrder: t.tierOrder, scntFrom: lo, scntTo: t.scntTo, tons, sdrPerScnt: num(t.sdrPerScnt), sdr: round2(amount) });
    sdr += amount;
  }
  return { sdr, lines };
}

interface WasteTier { from: number; to: number | null; amount: number; includedUnits: number }

function wasteTierFor(scnt: number, tiers: WasteTier[]): WasteTier | null {
  for (const t of tiers) {
    const lo = num(t.from);
    const hi = t.to == null ? Number.POSITIVE_INFINITY : num(t.to);
    // (from, to]: "up to 10,000" is the first band, "more than 10,000 up to 40,000" the next.
    if ((scnt > lo || (lo === 0 && scnt >= 0)) && scnt <= hi) return t;
  }
  return null;
}

export function estimateSuezTransit(input: SuezInput, ctx: SuezTariffContext): SuezEstimate {
  const warnings: string[] = [];
  const { vessel, voyage } = input;
  const direction = voyage.direction;
  const cargoStatus = voyage.cargoStatus;
  const sdrRate = ctx.sdr ?? null;
  const rate = input.overrides?.sdrRateUsd ?? (sdrRate ? num(sdrRate.rateUsd) : 0);
  let ok = true;

  if (!(rate > 0)) {
    ok = false;
    warnings.push("No SDR→USD rate is on file for the transit date; amounts in SDR cannot be converted.");
  } else if (!input.overrides?.sdrRateUsd && sdrRate && sdrRate.asOf > ctx.date) {
    warnings.push(`The SDR rate on file (${sdrRate.asOf}) is dated after the transit date; the earliest known rate was used.`);
  }
  const toUsd = (sdr: number) => (rate > 0 ? sdr * rate : 0);
  const items = ctx.items.filter((i) => inScope(i, direction, cargoStatus));

  // ── Layer 1 · toll ───────────────────────────────────────────────────────
  const scnt = vessel.scnt != null && Number.isFinite(vessel.scnt) && vessel.scnt > 0 ? vessel.scnt : null;
  let categoryUsed = vessel.category;
  let tiers = ctx.tiers.filter((t) => t.vesselCategory === vessel.category && t.cargoStatus === cargoStatus);
  if (tiers.length === 0) {
    const fallback = ["general_cargo", "other"].find((c) => ctx.tiers.some((t) => t.vesselCategory === c && t.cargoStatus === cargoStatus));
    if (fallback) {
      categoryUsed = fallback;
      tiers = ctx.tiers.filter((t) => t.vesselCategory === fallback && t.cargoStatus === cargoStatus);
      warnings.push(`No toll tiers for category "${vessel.category}" (${cargoStatus}) in tariff v${ctx.version.versionNo}; the "${fallback}" tiers were used.`);
    } else {
      ok = false;
      warnings.push(`No toll tiers for category "${vessel.category}" (${cargoStatus}) in tariff v${ctx.version.versionNo}.`);
    }
  }
  const placeholder = tiers.some((t) => t.confidence === "placeholder");
  if (placeholder) {
    warnings.push("The toll tiers in force are placeholders reproducing the legacy proforma rate; load the SCA tolls circular before relying on the toll figure.");
  }
  let tollSdr = 0;
  let tollLines: SuezTollTierLine[] = [];
  if (scnt == null) {
    ok = false;
    warnings.push("SCNT is not sourced for this vessel; the transit toll cannot be computed. Enter the SCNT from the Suez Canal special tonnage certificate.");
  } else if (tiers.length > 0) {
    const r = tollSdrFromTiers(scnt, tiers);
    tollSdr = r.sdr;
    tollLines = r.lines;
  }
  const tollUsd = round2(toUsd(tollSdr));

  // ── Layer 2 · fixed ──────────────────────────────────────────────────────
  const fixed: SuezLine[] = [];
  let wasteIncludedM3: number | null = null;
  for (const item of items.filter((i) => i.layer === "fixed")) {
    const line = evalFixed(item, { scnt, gt: vessel.gt, toUsd, warnings });
    if (!line) continue;
    if (item.basis === "tier_by_scnt" && typeof line.quantity === "number") wasteIncludedM3 = line.quantity;
    fixed.push(line);
  }
  const fixedUsd = round2(fixed.reduce((a, l) => a + l.amountUsd, 0));

  // ── Layer 3 · conditional (risk flags) ───────────────────────────────────
  const conditional: SuezFlag[] = [];
  const mooringCranesOk =
    vessel.mooringCranesOk ?? (vessel.craneSwlMt != null ? num(vessel.craneSwlMt) >= 3 && num(vessel.craneCount, 1) >= 1 : null);
  const transitYear = Number((voyage.transitDate ?? ctx.date).slice(0, 4));
  const age = vessel.buildYear ? transitYear - vessel.buildYear : null;
  for (const item of items.filter((i) => i.layer === "conditional")) {
    const key = item.conditionKey ?? item.code;
    let triggered = false;
    let reason = "";
    let quantity: number | null = null;
    switch (key) {
      case "no_mooring_cranes": {
        const big = (vessel.gt ?? 0) > 10000;
        if (!big) reason = "GT ≤ 10,000: one mooring boat, no lifting requirement.";
        else if (mooringCranesOk === false) { triggered = true; reason = "GT > 10,000 and the vessel cannot lift two mooring boats (cranes SWL 3 t)."; }
        else if (mooringCranesOk == null) { reason = "GT > 10,000: confirm cranes with SWL 3 t can lift two mooring boats, else a tug is imposed."; warnings.push("Mooring-boat crane capability is not sourced; the imposed-tug risk cannot be ruled out."); }
        else reason = "Cranes can lift the two mooring boats.";
        break;
      }
      case "late_arrival": {
        const band = voyage.lateArrivalBand ?? "none";
        if (band !== "none") { triggered = true; reason = `Arrival in band ${band}.`; }
        else reason = "Arrival before the 23:00 limit line.";
        break;
      }
      case "no_searchlight": {
        const fromSecond = bool(item.params?.fromSecondTransit);
        if (vessel.searchlightCompliant === false) {
          if (fromSecond && bool(vessel.firstTransit)) { reason = "No compliant searchlight on a first transit: day-time transit only (delay), no due until the second transit."; }
          else { triggered = true; reason = fromSecond ? "No compliant searchlight on a second or later transit." : "No compliant searchlight on board."; }
        }
        else if (vessel.searchlightCompliant == null) { reason = "Searchlight compliance not sourced."; warnings.push("Searchlight compliance is not sourced (Rules of Navigation art. 28; Circular 1/2026)."); }
        else reason = "Compliant searchlight on board.";
        break;
      }
      case "not_ready":
        triggered = bool(voyage.notReady); reason = triggered ? "Vessel declared not ready for the convoy." : "Applies only if the vessel is found not ready.";
        break;
      case "heavy_lift":
        triggered = bool(voyage.heavyLiftOver250t); reason = triggered ? "Heavy unit of 250 t or more declared." : "No unit of 250 t or more.";
        break;
      case "floating_unit":
        triggered = bool(voyage.floatingUnitScgt300); reason = triggered ? "Floating unit of SCGT 300 or more carried." : "No floating unit carried.";
        break;
      case "military":
        triggered = bool(voyage.militaryCargo); reason = triggered ? "Navy/government charter or military cargo declared." : "No military involvement declared.";
        break;
      case "deck_protrusion": {
        const ft = num(voyage.deckProtrusionFt);
        if (ft > 0) { triggered = true; quantity = Math.ceil(ft); reason = `Deck cargo protrudes ${ft} ft beyond the limit.`; }
        else reason = "No protrusion beyond the allowed limit.";
        break;
      }
      case "ladder_noncompliant":
        triggered = bool(voyage.ladderNoncompliant); reason = triggered ? "Pilot/accommodation ladder declared non-compliant." : "Ladders compliant.";
        break;
      case "relieving_pilots": {
        const n = Math.max(0, Math.floor(num(voyage.relievingPilots)));
        if (n > 0) { triggered = true; quantity = n; reason = `${n} relieving pilot(s) at the lakes.`; }
        else reason = "Pilot change at Ismailia as normal.";
        break;
      }
      case "overage":
        if (age != null && age > 20) { triggered = true; reason = `Vessel is ${age} years old: SCA inspection on arrival.`; }
        else if (age == null) { reason = "Build year not sourced."; }
        else reason = `Vessel is ${age} years old.`;
        break;
      case "first_transit":
        triggered = bool(vessel.firstTransit); reason = triggered ? "First Suez transit: the SCNT will be measured on arrival." : "Not a first transit.";
        break;
      default:
        reason = `Unknown condition "${key}"; shown as information only.`;
        warnings.push(`Tariff item ${item.code} has an unknown condition key "${key}".`);
    }
    conditional.push(evalConditional(item, { key, triggered, reason, quantity, tollSdr, toUsd, lateBand: voyage.lateArrivalBand ?? "none" }));
  }
  const conditionalAppliedUsd = round2(conditional.reduce((a, f) => a + f.appliedUsd, 0));
  const potentialExtra = conditional.filter((f) => !f.triggered && f.potentialUsd != null).reduce((a, f) => a + (f.potentialUsd ?? 0), 0);

  // ── Waste extras ────────────────────────────────────────────────────────
  const waste: SuezLine[] = [];
  for (const item of items.filter((i) => i.layer === "waste")) {
    let units = 0;
    switch (item.code) {
      case "waste_extra_m3": units = Math.max(0, num(voyage.wasteNormalM3) - (wasteIncludedM3 ?? 0)); break;
      case "waste_hazardous_m3": units = Math.max(0, num(voyage.wasteHazardousM3)); break;
      case "waste_bags": units = Math.max(0, num(voyage.bagsM3)); break;
      case "waste_barge_hours": units = Math.max(0, num(voyage.bargeHours)); break;
      default: units = 0;
    }
    const line = evalPerUnit(item, units, toUsd);
    if (line && line.amountUsd > 0) waste.push(line);
  }
  const wasteUsd = round2(waste.reduce((a, l) => a + l.amountUsd, 0));

  const appliedUsd = round2(tollUsd + fixedUsd + conditionalAppliedUsd + wasteUsd);
  const transitDays = input.overrides?.transitDays ?? num(ctx.suezDays?.transitDays, 1);
  const anchorageDays = input.overrides?.anchorageDays ?? num(ctx.suezDays?.anchorageDays, 0.5);

  return {
    ok,
    tariffVersion: ctx.version,
    sdrRate: sdrRate ? { ...sdrRate, rateUsd: rate } : rate > 0 ? { rateUsd: rate, asOf: ctx.date, source: "override" } : null,
    vesselCategory: vessel.category,
    categoryUsed,
    scnt,
    cargoStatus,
    direction,
    transitDate: voyage.transitDate ?? ctx.date,
    layers: {
      toll: { sdr: round2(tollSdr), usd: tollUsd, tiers: tollLines, placeholder },
      fixed,
      conditional,
      waste,
    },
    wasteIncludedM3,
    totals: {
      tollUsd,
      fixedUsd,
      conditionalAppliedUsd,
      wasteUsd,
      appliedUsd,
      potentialUsd: round2(appliedUsd + potentialExtra),
    },
    transitDays,
    anchorageDays,
    warnings,
  };
}

// ── item evaluators ────────────────────────────────────────────────────────

function baseLine(item: SuezTariffItem, native: number, usd: number, explanation: string, quantity: number | null = null, unit: string | null = null): SuezLine {
  return {
    code: item.code,
    label: item.labelEn,
    labelAr: item.labelAr ?? null,
    layer: item.layer,
    basis: item.basis,
    currency: item.currency,
    amountNative: round2(native),
    amountUsd: round2(usd),
    quantity,
    unit,
    explanation,
    payerParty: item.payerParty,
  };
}

function evalFixed(
  item: SuezTariffItem,
  f: { scnt: number | null; gt: number | null; toUsd: (sdr: number) => number; warnings: string[] },
): SuezLine | null {
  const p = item.params ?? {};
  const conv = (native: number) => (item.currency === "SDR" ? f.toUsd(native) : native);
  switch (item.basis) {
    case "flat": {
      const amount = num(p.amount);
      return baseLine(item, amount, conv(amount), `Flat ${item.currency} ${amount.toLocaleString()} per transit.`);
    }
    case "gt_threshold": {
      const threshold = num(p.threshold);
      if (f.gt == null) {
        const amount = num(p.atOrAbove);
        f.warnings.push(`${item.labelEn}: GT not sourced; the GT ≥ ${threshold.toLocaleString()} rate was assumed.`);
        return baseLine(item, amount, conv(amount), `GT not sourced; assumed GT ≥ ${threshold.toLocaleString()}: ${item.currency} ${amount.toLocaleString()}.`);
      }
      const amount = f.gt >= threshold ? num(p.atOrAbove) : num(p.below);
      return baseLine(item, amount, conv(amount), `GT ${f.gt.toLocaleString()} ${f.gt >= threshold ? "≥" : "<"} ${threshold.toLocaleString()}: ${item.currency} ${amount.toLocaleString()}.`);
    }
    case "tier_by_scnt": {
      const tiers = Array.isArray(p.tiers) ? (p.tiers as WasteTier[]) : [];
      if (f.scnt == null) {
        const t = tiers[0];
        if (!t) return null;
        f.warnings.push(`${item.labelEn}: SCNT not sourced; the lowest band was assumed.`);
        return baseLine(item, num(t.amount), conv(num(t.amount)), `SCNT not sourced; lowest band assumed (${num(t.includedUnits)} ${String(p.unit ?? "units")} included).`, num(t.includedUnits), String(p.unit ?? "m3"));
      }
      const t = wasteTierFor(f.scnt, tiers);
      if (!t) return null;
      const upper = t.to == null ? "and above" : `up to ${num(t.to).toLocaleString()}`;
      return baseLine(item, num(t.amount), conv(num(t.amount)), `SCNT ${f.scnt.toLocaleString()} → band ${num(t.from).toLocaleString()} ${upper}: ${item.currency} ${num(t.amount).toLocaleString()} (${num(t.includedUnits)} ${String(p.unit ?? "m3")} included).`, num(t.includedUnits), String(p.unit ?? "m3"));
    }
    case "per_unit": {
      return evalPerUnit(item, num(p.units), f.toUsd);
    }
    case "flag_only":
    case "toll_tiered_scnt":
    case "pct_of_toll":
    default:
      return null;
  }
}

function evalPerUnit(item: SuezTariffItem, units: number, toUsd: (sdr: number) => number): SuezLine | null {
  const p = item.params ?? {};
  const rate = num(p.rate);
  const free = num(p.freeUnits);
  const chargeable = Math.max(0, units - free);
  const native = chargeable * rate;
  const usd = item.currency === "SDR" ? toUsd(native) : native;
  const unit = String(p.unit ?? "unit");
  return baseLine(item, native, usd, `${units} ${unit}${free > 0 ? ` − ${free} free` : ""} = ${chargeable} × ${item.currency} ${rate.toLocaleString()}.`, chargeable, unit);
}

function evalConditional(
  item: SuezTariffItem,
  c: { key: string; triggered: boolean; reason: string; quantity: number | null; tollSdr: number; toUsd: (sdr: number) => number; lateBand: string },
): SuezFlag {
  const p = item.params ?? {};
  const conv = (native: number) => (item.currency === "SDR" ? c.toUsd(native) : native);
  let native = 0;
  let potentialUsd: number | null = null;
  let explanation = "";
  switch (item.basis) {
    case "flat": {
      native = num(p.amount);
      potentialUsd = round2(conv(native));
      explanation = `${item.currency} ${native.toLocaleString()} when it applies.`;
      break;
    }
    case "pct_of_toll": {
      if (Array.isArray(p.bands)) {
        const bands = p.bands as { key: string; label?: string; pct: number; capSdr?: number }[];
        const applyBand = (b: { pct: number; capSdr?: number }) => {
          const raw = (c.tollSdr * num(b.pct)) / 100;
          return b.capSdr != null ? Math.min(raw, num(b.capSdr)) : raw;
        };
        const worst = bands.reduce((m, b) => Math.max(m, applyBand(b)), 0);
        potentialUsd = round2(conv(worst));
        const chosen = bands.find((b) => b.key === c.lateBand);
        if (c.triggered && chosen) native = applyBand(chosen);
        explanation = bands.map((b) => `${b.label ?? b.key}: +${b.pct}%${b.capSdr != null ? ` (max SDR ${num(b.capSdr).toLocaleString()})` : ""}`).join("; ") + " of the toll.";
      } else if (p.pctPerUnit != null) {
        const pct = num(p.pctPerUnit) * (c.quantity ?? 0);
        native = (c.tollSdr * pct) / 100;
        potentialUsd = null; // depends on the protrusion
        explanation = `+${num(p.pctPerUnit)}% of the toll per ${String(p.unit ?? "unit")} beyond the limit${c.quantity ? ` → ${pct}%` : ""}.`;
      } else {
        const pct = num(p.pct);
        native = (c.tollSdr * pct) / 100;
        potentialUsd = round2(conv(native));
        explanation = `+${pct}% of the transit toll.`;
      }
      break;
    }
    case "per_unit": {
      const rate = num(p.rate);
      const free = num(p.freeUnits);
      const chargeable = Math.max(0, (c.quantity ?? 0) - free);
      native = chargeable * rate;
      potentialUsd = null;
      explanation = `${item.currency} ${rate.toLocaleString()} per ${String(p.unit ?? "unit")}.`;
      break;
    }
    case "flag_only":
    default:
      native = 0;
      potentialUsd = null;
      explanation = item.notes ?? "Cost determined by the SCA after inspection.";
  }
  const appliedNative = c.triggered ? native : 0;
  const appliedUsd = round2(conv(appliedNative));
  return {
    ...baseLine(item, appliedNative, appliedUsd, explanation, c.quantity, typeof p.unit === "string" ? p.unit : null),
    conditionKey: c.key,
    triggered: c.triggered,
    potentialUsd,
    appliedUsd,
    reason: c.reason,
  };
}
