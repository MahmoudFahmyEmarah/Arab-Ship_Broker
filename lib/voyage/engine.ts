// Voyage cost engine — pure, deterministic, no I/O (voyage-engine/2).
//
// estimateVoyage(input) turns the vessel's operating profile, the legs with
// their ECA share, the port calls, the canal snapshot and the fuel index into
// days per state, fuel per product, the running cost and the voyage total.
// Rules from the owner's brief (3 Oct 2026):
//   sea days = NM ÷ (speed × 24) × (1 + sea margin [default + lane + season])
//   inside an ECA the main engine burns the 0.10 % product, not VLSFO
//   HSFO only with a scrubber; a port with an open-loop ban or an EU berth
//   beyond 2 h takes the compliant product in port
//   port working ≠ idle; anchorage is its own state
//   daily cost = (crew + maintenance) × class multiplier (C 1.0, B 1.5, A 2.2)
//   fuel price = the Fuel Bar index AVERAGE (§4.1); admin fallback is labelled
// Audit O2C-024: nothing is substituted silently. A missing consumption makes
// the leg's fuel unavailable; an unknown ECA share prices as non-ECA and marks
// the leg partial (architect ruling D1); a missing DA or canal cost is
// unavailable, never 0; a fallback price is `fallback` (ruling D2); unknown
// scrubber/class are stated assumptions; the input is validated fail-closed.

import { parseVoyageInput } from "./schemas";
import type {
  ComponentStatus,
  FuelBurn,
  OperatingState,
  Season,
  StateConsumption,
  VesselClass,
  VoyageEstimate,
  VoyageFuelLine,
  VoyageInput,
  VoyageLegResult,
  VoyageSettings,
  VoyageStatus,
} from "./types";
import { VOYAGE_ALGORITHM_VERSION } from "./types";

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)); // locale-free

export const RESIDUAL_PRODUCT_SCRUBBER = "HSFO380";
export const RESIDUAL_PRODUCT_COMPLIANT = "VLSFO";

export function seaDays(nm: number, speedKn: number, marginPct: number): number {
  if (!(nm > 0) || !(speedKn > 0)) return 0;
  return (nm / (speedKn * 24)) * (1 + Math.max(0, marginPct) / 100);
}

// Default + lane allowance + season allowance (additive percentage points).
export function seaMarginFor(settings: VoyageSettings, lane: string | null, season: Season | null): { pct: number; basis: string } {
  let pct = settings.seaMargin.defaultPct;
  const parts = [`default ${fmt(settings.seaMargin.defaultPct)}%`];
  if (lane && settings.seaMargin.byLane && typeof settings.seaMargin.byLane[lane] === "number") { pct += settings.seaMargin.byLane[lane]; parts.push(`lane ${lane} +${fmt(settings.seaMargin.byLane[lane])}%`); }
  if (season && settings.seaMargin.bySeason && typeof settings.seaMargin.bySeason[season] === "number") { pct += settings.seaMargin.bySeason[season]!; parts.push(`${season} +${fmt(settings.seaMargin.bySeason[season]!)}%`); }
  return { pct, basis: parts.join(" + ") };
}

export function seasonOf(isoDate: string | null | undefined): Season | null {
  if (!isoDate || !/^\d{4}-\d{2}/.test(isoDate)) return null;
  const m = Number(isoDate.slice(5, 7));
  if (m === 12 || m <= 2) return "winter";
  if (m <= 5) return "spring";
  if (m <= 8) return "summer";
  return "autumn";
}

export function estimateVoyage(rawInput: VoyageInput): VoyageEstimate {
  const parsed = parseVoyageInput(rawInput);
  if (!parsed.ok) return invalidEstimate(parsed.errors, rawInput?.settingsSource ?? "defaults");
  const input = parsed.value;
  const s = input.settings;
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const unavailable: { code: string; reason: string }[] = [];

  // ── speeds, margin, class, scrubber ────────────────────────────────────
  if (input.settingsSource === "defaults") warnings.push("Voyage settings could not be read from the platform; compiled defaults were used.");
  const speedLaden = input.vessel.speedLadenKn ?? (assumptions.push(`Laden speed not declared; default ${fmt(s.speeds.ladenKn)} kn.`), s.speeds.ladenKn);
  const speedBallast = input.vessel.speedBallastKn ?? (assumptions.push(`Ballast speed not declared; default ${fmt(s.speeds.ballastKn)} kn.`), s.speeds.ballastKn);
  const margin = input.seaMarginPct != null ? { pct: input.seaMarginPct, basis: `entered ${fmt(input.seaMarginPct)}%` } : seaMarginFor(s, input.lane, input.season);
  const classAssumed = input.vessel.vesselClass == null;
  const vesselClass: VesselClass = input.vessel.vesselClass ?? "C";
  if (classAssumed) assumptions.push("Vessel cost class not declared; class C (multiplier 1.0) assumed.");
  const multiplier = s.classMultipliers[vesselClass];
  const scrubber = input.vessel.hasScrubber === true;
  if (input.vessel.hasScrubber == null) assumptions.push("Scrubber status not declared; priced as no scrubber (compliant fuel everywhere).");
  if (scrubber) assumptions.push("Scrubber fitted: HSFO 380 outside ECAs and inside them at sea; ports with an open-loop ban or an EU berth beyond 2 h take the compliant product.");

  const residualProduct = scrubber ? RESIDUAL_PRODUCT_SCRUBBER : RESIDUAL_PRODUCT_COMPLIANT;
  const ecaProduct = s.eca.fuelProductKey;
  const distillateProduct = s.eca.distillateProductKey ?? "LSMGO";

  // ── fuel accounting ───────────────────────────────────────────────────
  const legs: VoyageLegResult[] = [];
  const burnsByProduct = new Map<string, number>();
  let ecaMt = 0;
  const addBurn = (burns: FuelBurn[], product: string, mt: number, inEca: boolean) => {
    if (!(mt > 0)) return;
    const existing = burns.find((b) => b.productKey === product);
    if (existing) existing.mt = round3(existing.mt + mt); else burns.push({ productKey: product, mt: round3(mt) });
    burnsByProduct.set(product, (burnsByProduct.get(product) ?? 0) + mt);
    if (inEca) ecaMt += mt;
  };
  const declared = (state: OperatingState): StateConsumption | null => {
    const c = input.vessel.consumption[state];
    return c && (c.residual != null || c.distillate != null) ? c : null;
  };
  // Burns `days` in `state`; `ecaDays` of them inside an ECA; `compliantPort`
  // forces the compliant product even with a scrubber (open-loop ban / EU berth).
  // Returns false when the state has no declared consumption (leg unavailable).
  const burnState = (burns: FuelBurn[], state: OperatingState, days: number, ecaDays: number, compliantPort = false): boolean => {
    if (!(days > 0)) return true;
    const c = declared(state);
    if (!c) return false;
    const res = c.residual ?? 0;
    const dis = c.distillate ?? 0;
    const eca = Math.min(Math.max(ecaDays, 0), days);
    const outside = days - eca;
    const ecaSea = state === "sea_laden" || state === "sea_ballast" ? declared("eca_sea") : null;
    const ecaRes = ecaSea?.residual ?? res; // main-engine burn inside the ECA
    const ecaDis = ecaSea?.distillate ?? dis;
    if (scrubber && !compliantPort) {
      addBurn(burns, residualProduct, res * outside + ecaRes * eca, false);
      addBurn(burns, distillateProduct, dis * outside + ecaDis * eca, false);
    } else {
      // Outside: the residual product (VLSFO, or HSFO with a scrubber when a
      // compliant port only concerns the in-port share). Inside the ECA / a
      // compliant port the 0.10 % product replaces the residual share.
      addBurn(burns, residualProduct, res * outside, false);
      addBurn(burns, ecaProduct, ecaRes * eca, true);
      addBurn(burns, distillateProduct, dis * outside + ecaDis * eca, false);
    }
    return true;
  };

  // ── sea legs ─────────────────────────────────────────────────────────
  let anyLegUnavailable = false;
  const seaLeg = (leg: NonNullable<VoyageInput["legs"]["ballast"]>, state: "sea_laden" | "sea_ballast", speed: number): number => {
    const label = state === "sea_laden" ? "Laden passage" : "Ballast passage";
    const burns: FuelBurn[] = [];
    if (leg.nm == null || leg.method === "none") {
      anyLegUnavailable = true;
      unavailable.push({ code: leg.key, reason: `${label}: distance not sourced (no measured route, no manual entry).` });
      legs.push({ key: leg.key, label, kind: "sea", status: "unavailable", from: leg.from, to: leg.to, nm: null, ecaNm: null, ecaShareKnown: false, days: 0, ecaDays: 0, burns, note: "Distance not sourced." });
      return 0;
    }
    const days = seaDays(leg.nm, speed, margin.pct);
    const ecaKnown = leg.ecaNm != null;
    const ecaNm = leg.ecaNm ?? 0;
    const ecaDays = days * Math.min(ecaNm, leg.nm) / leg.nm;
    const priced = burnState(burns, state, days, ecaDays);
    let status: ComponentStatus = leg.method === "manual" ? "manual" : "trusted";
    if (!priced) { status = "unavailable"; unavailable.push({ code: `${leg.key}_fuel`, reason: `${label}: no ${state.replace("_", " ")} consumption declared; its fuel cannot be priced.` }); }
    else if (!ecaKnown) { warnings.push(`${label}: ECA share unknown (route without waypoints); priced as non-ECA.`); }
    legs.push({
      key: leg.key, label, kind: "sea", status: status === "trusted" && !ecaKnown ? "fallback" : status,
      from: leg.from, to: leg.to, nm: leg.nm, ecaNm: ecaKnown ? round1(ecaNm) : null, ecaShareKnown: ecaKnown, days: round2(days), ecaDays: round2(ecaDays), burns,
      note: `${fmt(Math.round(leg.nm))} NM / (${fmt(speed)} kn × 24) × (1 + ${fmt(margin.pct)}%)` + (leg.method === "manual" ? ` · manual distance (${leg.manual?.reason ?? ""})` : leg.method === "waypoints" ? " · measured route with ECA split" : " · measured distance, ECA share unknown") + (ecaKnown && ecaNm > 0 ? ` · ${fmt(Math.round(ecaNm))} NM in ECA` : ""),
    });
    return days;
  };
  const dSeaBallast = input.legs.ballast ? seaLeg(input.legs.ballast, "sea_ballast", speedBallast) : 0;
  const dSeaLaden = seaLeg(input.legs.laden, "sea_laden", speedLaden);

  // ── canal ───────────────────────────────────────────────────────────
  let dCanalTransit = 0, dCanalAnch = 0;
  let canal: VoyageEstimate["costs"]["canal"] = { usd: null, status: "unavailable", required: false };
  if (input.canal?.required) {
    const c = input.canal;
    dCanalTransit = c.transitDays; dCanalAnch = c.anchorageDays;
    if (c.costUsd != null && c.complete && (c.status === "trusted" || c.status === "manual")) canal = { usd: c.costUsd, status: c.status, required: true };
    else { canal = { usd: null, status: "unavailable", required: true }; unavailable.push({ code: "canal", reason: `${c.name} transit cost unavailable (the Suez estimate is ${c.status}${c.complete ? "" : ", incomplete"}).` }); }
    const burns: FuelBurn[] = [];
    const aBurns: FuelBurn[] = [];
    const okT = burnState(burns, "sea_laden", dCanalTransit, 0);
    const okA = burnState(aBurns, "anchorage", dCanalAnch, c.anchorageInEca ? dCanalAnch : 0, c.anchorageInEca);
    if (!okT) unavailable.push({ code: "canal_fuel", reason: `${c.name} transit: no sea consumption declared.` });
    if (!okA) unavailable.push({ code: "canal_anchorage_fuel", reason: `${c.name} anchorage: no anchorage consumption declared.` });
    legs.push({ key: "canal", label: `${c.name} transit`, kind: "canal", status: okT ? canal.status : "unavailable", from: null, to: null, nm: c.nm, ecaNm: 0, ecaShareKnown: true, days: round2(dCanalTransit), ecaDays: 0, burns, note: `${fmt(dCanalTransit)} day(s) at sea consumption${c.tariffVersionNo ? ` · tariff v${c.tariffVersionNo}` : ""}` });
    legs.push({ key: "canal_anchorage", label: `${c.name} anchorage / convoy wait`, kind: "anchorage", status: okA ? "trusted" : "unavailable", from: null, to: null, nm: 0, ecaNm: 0, ecaShareKnown: true, days: round2(dCanalAnch), ecaDays: round2(c.anchorageInEca ? dCanalAnch : 0), burns: aBurns, note: `${fmt(dCanalAnch)} day(s) at anchorage consumption${c.anchorageInEca ? " (inside the Med ECA)" : ""}` });
  }

  // ── port calls ──────────────────────────────────────────────────────
  const idleShare = Math.min(Math.max(s.portTimeDays.idleSharePct, 0), 100) / 100;
  const portCall = (p: VoyageInput["ports"]["load"]) => {
    const isLoad = p.key === "load";
    const label = isLoad ? "Loading" : "Discharging";
    let days: number;
    let note: string;
    if (p.rateMtDay != null && p.qtyMt > 0) { days = p.qtyMt / p.rateMtDay + p.allowanceDays; note = `${fmt(p.qtyMt)} MT / ${fmt(p.rateMtDay)} MT/day${p.allowanceDays ? ` + ${fmt(p.allowanceDays)} d allowance` : ""}`; }
    else { const d = isLoad ? s.portTimeDays.loadDefault : s.portTimeDays.dischDefault; days = d + p.allowanceDays; note = `default ${fmt(d)} port days${p.allowanceDays ? ` + ${fmt(p.allowanceDays)} d allowance` : ""}`; assumptions.push(`${label}: no rate declared; default ${fmt(d)} port days used.`); }
    const compliant = p.inEca || p.openLoopBan || p.euBerthOver2h;
    const working = days * (1 - idleShare), idle = days * idleShare;
    const burns: FuelBurn[] = [];
    const okW = burnState(burns, "port_working", working, compliant ? working : 0, compliant);
    const okI = burnState(burns, "port_idle", idle, compliant ? idle : 0, compliant);
    let status: ComponentStatus = "trusted";
    if (!okW || !okI) { status = "unavailable"; unavailable.push({ code: `${p.key}_fuel`, reason: `${label}: no ${!okW ? "port working" : "port idle"} consumption declared; its fuel cannot be priced.` }); }
    legs.push({ key: p.key, label, kind: "port", status, from: p.port, to: p.port, nm: 0, ecaNm: 0, ecaShareKnown: true, days: round2(days), ecaDays: round2(compliant ? days : 0), burns, note: `${note} · ${fmt(Math.round((1 - idleShare) * 100))}% working / ${fmt(Math.round(idleShare * 100))}% idle${compliant ? ` · compliant fuel in port (${[p.inEca && "ECA", p.openLoopBan && "open-loop ban", p.euBerthOver2h && "EU berth > 2 h"].filter(Boolean).join(", ")})` : ""}` });
    return days;
  };
  const dLoad = portCall(input.ports.load);
  const dDisch = portCall(input.ports.disch);

  // ── waiting at anchorage ────────────────────────────────────────────
  const dAnch = input.anchorageDays;
  if (dAnch > 0) {
    const burns: FuelBurn[] = [];
    const okA = burnState(burns, "anchorage", dAnch, input.anchorageInEca ? dAnch : 0, input.anchorageInEca);
    if (!okA) unavailable.push({ code: "anchorage_fuel", reason: "Waiting at anchorage: no anchorage consumption declared." });
    legs.push({ key: "anchorage", label: "Waiting at anchorage", kind: "anchorage", status: okA ? "trusted" : "unavailable", from: null, to: null, nm: 0, ecaNm: 0, ecaShareKnown: true, days: round2(dAnch), ecaDays: round2(input.anchorageInEca ? dAnch : 0), burns, note: "Broker estimate" });
  }
  const totalDays = dSeaBallast + dSeaLaden + dCanalTransit + dCanalAnch + dLoad + dDisch + dAnch;

  // ── fuel pricing from the index snapshot (average) or the admin fallback ──
  const lines: VoyageFuelLine[] = [];
  const idx = input.fuel;
  let fuelStatus: ComponentStatus = "trusted";
  for (const [product, mt] of burnsByProduct) {
    if (!(mt > 0)) continue;
    const p = idx.status !== "unavailable" ? idx.products.find((x) => x.key === product) : undefined;
    if (p) {
      lines.push({ productKey: product, mt: round2(mt), status: idx.status === "manual" ? "manual" : "trusted", usdMt: p.averageUsdMt, usd: round2(mt * p.averageUsdMt), priceAsOf: p.latestQuoteAt ?? idx.asOf, pricePort: idx.actualPort ?? idx.region, priceScope: idx.scope });
      if (p.freshness === "stale") warnings.push(`${product}: the index average rests on stale quotes (8–14 days).`);
      continue;
    }
    const fb = s.fuelFallback[product];
    if (typeof fb === "number" && fb > 0) {
      lines.push({ productKey: product, mt: round2(mt), status: "fallback", usdMt: fb, usd: round2(mt * fb), priceAsOf: null, pricePort: null, priceScope: null });
      warnings.push(`${product}: no live Fuel Bar index${idx.noOffer.includes(product) ? " (no current offer)" : ""}; the admin fallback USD ${fmt(fb)}/MT was used.`);
      if (fuelStatus === "trusted") fuelStatus = "fallback";
    } else {
      lines.push({ productKey: product, mt: round2(mt), status: "unavailable", usdMt: null, usd: null, priceAsOf: null, pricePort: null, priceScope: null });
      unavailable.push({ code: `fuel_${product}`, reason: `${product}: no live index and no admin fallback price.` });
      fuelStatus = "unavailable";
    }
  }
  lines.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const totalMt = round2([...burnsByProduct.values()].reduce((a, b) => a + b, 0));
  const pricedMt = round2(lines.filter((l) => l.usd != null).reduce((a, l) => a + l.mt, 0));
  const fuelUsd = round2(lines.reduce((a, l) => a + (l.usd ?? 0), 0));
  if (idx.status === "manual") fuelStatus = "manual";

  // ── running cost ────────────────────────────────────────────────────
  const baseUsdDay = s.opex.crewUsdDay + s.opex.maintenanceUsdDay;
  const usdDay = baseUsdDay * multiplier;
  const opexUsd = round2(usdDay * totalDays);

  // ── port DAs and extras ─────────────────────────────────────────────
  const pda = (p: VoyageInput["ports"]["load"]): VoyageEstimate["costs"]["pdaLoad"] => {
    if (p.pda.source === "none" || p.pda.usd == null) { unavailable.push({ code: `pda_${p.key}`, reason: `${p.key === "load" ? "Load" : "Discharge"} port DA not available (no tariff estimate, no manual figure).` }); return { usd: null, status: "unavailable" }; }
    return { usd: round2(p.pda.usd), status: p.pda.source === "manual" ? "manual" : "trusted" };
  };
  const pdaLoad = pda(input.ports.load);
  const pdaDisch = pda(input.ports.disch);
  const extrasUsd = round2(input.extras.insuranceUsd + input.extras.stevedoringUsd + input.extras.otherUsd);
  const voyageCostsUsd = round2(fuelUsd + (canal.usd ?? 0) + (pdaLoad.usd ?? 0) + (pdaDisch.usd ?? 0) + extrasUsd);
  const totalUsd = round2(voyageCostsUsd + opexUsd);
  const complete = unavailable.length === 0;

  // ── revenue / TCE ───────────────────────────────────────────────────
  let revenue: VoyageEstimate["revenue"] = null;
  if (input.revenue) {
    const gross = input.revenue.qtyMt * input.revenue.freightUsdMt;
    const comm = gross * (input.revenue.commissionPct / 100);
    const net = gross - comm;
    revenue = { grossFreightUsd: round2(gross), commissionUsd: round2(comm), netFreightUsd: round2(net), tceUsdDay: totalDays > 0 ? round2((net - voyageCostsUsd) / totalDays) : 0, resultAfterOpexUsd: round2(net - voyageCostsUsd - opexUsd) };
  }

  // ── status ──────────────────────────────────────────────────────────
  let status: VoyageStatus;
  if (anyLegUnavailable && legs.filter((l) => l.kind === "sea").every((l) => l.status === "unavailable")) status = "unavailable";
  else if (!complete || fuelStatus !== "trusted" || canal.status === "manual" || pdaLoad.status === "manual" || pdaDisch.status === "manual" || legs.some((l) => l.status === "manual" || l.status === "fallback") || input.settingsSource === "defaults" || input.vessel.hasScrubber == null) status = "partial";
  else status = "trusted";

  return {
    status,
    ok: status === "trusted",
    algorithmVersion: VOYAGE_ALGORITHM_VERSION,
    settingsSource: input.settingsSource,
    days: { seaBallast: round2(dSeaBallast), seaLaden: round2(dSeaLaden), canalTransit: round2(dCanalTransit), canalAnchorage: round2(dCanalAnch), portLoad: round2(dLoad), portDisch: round2(dDisch), anchorage: round2(dAnch), total: round2(totalDays) },
    seaMarginPct: margin.pct,
    seaMarginBasis: margin.basis,
    legs,
    fuel: { status: fuelStatus, lines, totalMt, pricedMt, totalUsd: fuelUsd, ecaMt: round2(ecaMt), residualProduct, ecaProduct, distillateProduct, indexAsOf: idx.asOf, indexScope: idx.scope },
    opex: { baseUsdDay, multiplier, vesselClass, classAssumed, usdDay: round2(usdDay), usd: opexUsd },
    costs: { fuel: { usd: fuelUsd, status: fuelStatus }, canal, pdaLoad, pdaDisch, extrasUsd, voyageCostsUsd, opexUsd, totalUsd, complete },
    revenue,
    unavailable,
    assumptions,
    warnings,
  };
}

function invalidEstimate(errors: string[], settingsSource: VoyageEstimate["settingsSource"]): VoyageEstimate {
  return {
    status: "invalid", ok: false, algorithmVersion: VOYAGE_ALGORITHM_VERSION, settingsSource,
    days: { seaBallast: 0, seaLaden: 0, canalTransit: 0, canalAnchorage: 0, portLoad: 0, portDisch: 0, anchorage: 0, total: 0 },
    seaMarginPct: 0, seaMarginBasis: "invalid input", legs: [],
    fuel: { status: "invalid", lines: [], totalMt: 0, pricedMt: 0, totalUsd: 0, ecaMt: 0, residualProduct: "", ecaProduct: "", distillateProduct: "", indexAsOf: null, indexScope: null },
    opex: { baseUsdDay: 0, multiplier: 0, vesselClass: "C", classAssumed: true, usdDay: 0, usd: 0 },
    costs: { fuel: { usd: 0, status: "invalid" }, canal: { usd: null, status: "invalid", required: false }, pdaLoad: { usd: null, status: "invalid" }, pdaDisch: { usd: null, status: "invalid" }, extrasUsd: 0, voyageCostsUsd: 0, opexUsd: 0, totalUsd: 0, complete: false },
    revenue: null, unavailable: [], assumptions: [], warnings: [], errors,
  };
}
