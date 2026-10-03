// Voyage cost engine — pure, deterministic, no I/O (Voyage Economics, Stream S).
//
// estimateVoyage(input) turns the vessel's operating profile, the legs with
// their ECA share, the port calls, the canal transit and the fuel prices into
// days per state, fuel per product, the daily running cost and the voyage
// total. Rules from the owner's brief (3 Oct 2026):
//   sea days = NM ÷ (speed × 24) × (1 + sea margin)
//   inside an ECA the ship burns 0.10 % fuel (LSMGO/ULSFO), not VLSFO
//   HSFO only with a scrubber; port working ≠ idle; anchorage is its own state
//   daily cost = (crew + maintenance) × class multiplier (C 1.0, B 1.5, A 2.2)
//   fuel price = the platform index AVERAGE at the bunkering port (§4.1)

import type {
  FuelBurn,
  FuelPriceInput,
  OperatingState,
  StateConsumption,
  VesselClass,
  VoyageEstimate,
  VoyageFuelLine,
  VoyageInput,
  VoyageLegResult,
} from "./types";

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

export const RESIDUAL_PRODUCT_SCRUBBER = "HSFO380";
export const RESIDUAL_PRODUCT_COMPLIANT = "VLSFO";
export const DISTILLATE_PRODUCT = "LSMGO";

export function seaDays(nm: number, speedKn: number, marginPct: number): number {
  if (!(nm > 0) || !(speedKn > 0)) return 0;
  return (nm / (speedKn * 24)) * (1 + Math.max(0, marginPct) / 100);
}

function pickConsumption(
  map: VoyageInput["vessel"]["consumption"],
  state: OperatingState,
  fallbacks: OperatingState[],
  notes: { assumptions: string[]; warnings: string[] },
): StateConsumption {
  const direct = map[state];
  if (direct && (direct.residual != null || direct.distillate != null)) return direct;
  for (const f of fallbacks) {
    const c = map[f];
    if (c && (c.residual != null || c.distillate != null)) {
      notes.assumptions.push(`${state} consumption not declared; ${f} figures used.`);
      return c;
    }
  }
  notes.warnings.push(`No consumption declared for ${state}; 0 MT/day assumed.`);
  return { residual: 0, distillate: 0 };
}

export function estimateVoyage(input: VoyageInput): VoyageEstimate {
  const notes = { assumptions: [] as string[], warnings: [] as string[] };
  const s = input.settings;
  let ok = true;

  // ── speeds, margin, class ──────────────────────────────────────────────
  const speedLaden = input.vessel.speedLadenKn ?? (notes.assumptions.push(`Laden speed not declared; default ${s.speeds.ladenKn} kn.`), s.speeds.ladenKn);
  const speedBallast = input.vessel.speedBallastKn ?? (notes.assumptions.push(`Ballast speed not declared; default ${s.speeds.ballastKn} kn.`), s.speeds.ballastKn);
  const marginPct = input.seaMarginPct ?? s.seaMargin.defaultPct;
  const vesselClass: VesselClass = input.vessel.vesselClass ?? (notes.assumptions.push("Vessel class not declared; class C multiplier 1.0 used."), "C");
  const multiplier = num(s.classMultipliers[vesselClass], 1);

  // ── products ─────────────────────────────────────────────────────────
  const residualProduct = input.vessel.hasScrubber ? RESIDUAL_PRODUCT_SCRUBBER : RESIDUAL_PRODUCT_COMPLIANT;
  const ecaProduct = s.eca?.fuelProductKey || DISTILLATE_PRODUCT;
  if (input.vessel.hasScrubber) notes.assumptions.push("Scrubber fitted: HSFO 380 burned outside ECAs; inside an ECA the scrubber is assumed compliant (open-loop bans not checked).");

  const legs: VoyageLegResult[] = [];
  const burnsByProduct = new Map<string, number>();
  let ecaMt = 0;
  // One burn entry per product per leg (ECA main-engine fuel and the auxiliary
  // distillate may both be LSMGO); the voyage total is kept unrounded.
  const addBurn = (burns: FuelBurn[], product: string, mt: number, inEca: boolean) => {
    if (!(mt > 0)) return;
    const existing = burns.find((b) => b.productKey === product);
    if (existing) existing.mt = round3(existing.mt + mt);
    else burns.push({ productKey: product, mt: round3(mt) });
    burnsByProduct.set(product, (burnsByProduct.get(product) ?? 0) + mt);
    if (inEca) ecaMt += mt;
  };

  // Burn `days` in `state`, splitting `ecaDays` of them onto the ECA product
  // when the ship has no scrubber.
  const burnState = (burns: FuelBurn[], state: OperatingState, days: number, ecaDays: number, fallbacks: OperatingState[]) => {
    if (!(days > 0)) return;
    const c = pickConsumption(input.vessel.consumption, state, fallbacks, notes);
    const res = num(c.residual);
    const dis = num(c.distillate);
    const eca = Math.min(Math.max(ecaDays, 0), days);
    const outside = days - eca;
    if (input.vessel.hasScrubber) {
      addBurn(burns, residualProduct, res * days, false);
      addBurn(burns, DISTILLATE_PRODUCT, dis * days, false);
    } else {
      addBurn(burns, residualProduct, res * outside, false);
      // Inside the ECA the main engine burns the 0.10 % product; if an eca_sea
      // figure exists it replaces the sea figure for those days.
      const ecaCons = state.startsWith("sea") && input.vessel.consumption.eca_sea?.residual != null ? num(input.vessel.consumption.eca_sea.residual) : res;
      addBurn(burns, ecaProduct, ecaCons * eca, true);
      addBurn(burns, DISTILLATE_PRODUCT, dis * days, false);
    }
  };

  // ── sea legs ─────────────────────────────────────────────────────────
  const seaLeg = (leg: NonNullable<VoyageInput["legs"]["ballast"]>, state: "sea_laden" | "sea_ballast", speed: number) => {
    const burns: FuelBurn[] = [];
    if (leg.nm == null || !(leg.nm > 0)) {
      ok = false;
      notes.warnings.push(`${state === "sea_laden" ? "Laden" : "Ballast"} leg distance is unknown; the leg counts 0 days.`);
      legs.push({ key: leg.key, label: state === "sea_laden" ? "Laden passage" : "Ballast passage", kind: "sea", from: leg.from, to: leg.to, nm: null, ecaNm: null, days: 0, ecaDays: 0, burns, note: "Distance not sourced." });
      return 0;
    }
    const days = seaDays(leg.nm, speed, marginPct);
    let ecaNm = leg.ecaNm;
    if (ecaNm == null) {
      notes.warnings.push(`${state === "sea_laden" ? "Laden" : "Ballast"} leg: ECA share unknown; priced as non-ECA.`);
      ecaNm = 0;
    }
    const ecaDays = leg.nm > 0 ? days * Math.min(ecaNm, leg.nm) / leg.nm : 0;
    burnState(burns, state, days, ecaDays, state === "sea_laden" ? ["sea_ballast"] : ["sea_laden"]);
    legs.push({
      key: leg.key, label: state === "sea_laden" ? "Laden passage" : "Ballast passage", kind: "sea",
      from: leg.from, to: leg.to, nm: leg.nm, ecaNm: round1(ecaNm), days: round2(days), ecaDays: round2(ecaDays), burns,
      note: `${Math.round(leg.nm).toLocaleString()} NM ÷ (${speed} kn × 24) × (1 + ${marginPct}% margin)${leg.nmSource ? ` · distance ${leg.nmSource}` : ""}${ecaNm > 0 ? ` · ${Math.round(ecaNm).toLocaleString()} NM in ECA` : ""}`,
    });
    return days;
  };
  const dSeaBallast = input.legs.ballast ? seaLeg(input.legs.ballast, "sea_ballast", speedBallast) : 0;
  const dSeaLaden = seaLeg(input.legs.laden, "sea_laden", speedLaden);

  // ── canal ───────────────────────────────────────────────────────────
  let dCanalTransit = 0;
  let dCanalAnch = 0;
  let canalUsd = 0;
  if (input.canal?.required) {
    const c = input.canal;
    dCanalTransit = num(c.transitDays, s.suez.transitDays);
    dCanalAnch = num(c.anchorageDays, s.suez.anchorageDays);
    canalUsd = num(c.costUsd);
    if (c.ok === false) { ok = false; notes.warnings.push(`${c.name ?? "Canal"} transit cost could not be computed (see the Suez calculator); 0 assumed.`); }
    const burns: FuelBurn[] = [];
    burnState(burns, "sea_laden", dCanalTransit, 0, ["sea_ballast"]);
    const aBurns: FuelBurn[] = [];
    burnState(aBurns, "anchorage", dCanalAnch, c.anchorageInEca ? dCanalAnch : 0, ["port_idle", "port_working"]);
    legs.push({ key: "canal", label: `${c.name ?? "Canal"} transit`, kind: "canal", from: null, to: null, nm: c.nm ?? s.suez.nm, ecaNm: 0, days: round2(dCanalTransit), ecaDays: 0, burns, note: `${dCanalTransit} day(s) transit at sea consumption${c.tariffVersionNo ? ` · tariff v${c.tariffVersionNo}` : ""}` });
    legs.push({ key: "canal_anchorage", label: `${c.name ?? "Canal"} anchorage / convoy wait`, kind: "anchorage", from: null, to: null, nm: 0, ecaNm: 0, days: round2(dCanalAnch), ecaDays: round2(c.anchorageInEca ? dCanalAnch : 0), burns: aBurns, note: `${dCanalAnch} day(s) at anchorage consumption${c.anchorageInEca ? " (inside the Med ECA)" : ""}` });
  }

  // ── port calls ──────────────────────────────────────────────────────
  const portCall = (p: VoyageInput["ports"]["load"]) => {
    const isLoad = p.key === "load";
    let days: number;
    if (p.rateMtDay && p.rateMtDay > 0 && p.qtyMt > 0) {
      days = p.qtyMt / p.rateMtDay + num(p.allowanceDays);
    } else {
      days = (isLoad ? s.portTimeDays.loadDefault : s.portTimeDays.dischDefault) + num(p.allowanceDays);
      notes.assumptions.push(`${isLoad ? "Load" : "Discharge"} rate not declared; default ${isLoad ? s.portTimeDays.loadDefault : s.portTimeDays.dischDefault} port days used.`);
    }
    const idleShare = Math.min(Math.max(num(s.portTimeDays.idleSharePct), 0), 100) / 100;
    const working = days * (1 - idleShare);
    const idle = days * idleShare;
    const burns: FuelBurn[] = [];
    burnState(burns, "port_working", working, p.inEca ? working : 0, ["port_idle", "anchorage"]);
    burnState(burns, "port_idle", idle, p.inEca ? idle : 0, ["port_working", "anchorage"]);
    legs.push({
      key: p.key, label: isLoad ? "Loading" : "Discharging", kind: "port", from: p.port, to: p.port, nm: 0, ecaNm: 0,
      days: round2(days), ecaDays: round2(p.inEca ? days : 0), burns,
      note: p.rateMtDay ? `${p.qtyMt.toLocaleString()} MT ÷ ${p.rateMtDay.toLocaleString()} MT/day${num(p.allowanceDays) ? ` + ${p.allowanceDays} d allowance` : ""} · ${Math.round((1 - idleShare) * 100)}% working / ${Math.round(idleShare * 100)}% idle` : "Default port time",
    });
    return days;
  };
  const dLoad = portCall(input.ports.load);
  const dDisch = portCall(input.ports.disch);

  // ── waiting at anchorage (broker input) ─────────────────────────────
  const dAnch = num(input.anchorageDays, s.anchorageDaysDefault);
  if (dAnch > 0) {
    const burns: FuelBurn[] = [];
    burnState(burns, "anchorage", dAnch, input.anchorageInEca ? dAnch : 0, ["port_idle", "port_working"]);
    legs.push({ key: "anchorage", label: "Waiting at anchorage", kind: "anchorage", from: null, to: null, nm: 0, ecaNm: 0, days: round2(dAnch), ecaDays: round2(input.anchorageInEca ? dAnch : 0), burns, note: "Broker estimate" });
  }

  const totalDays = dSeaBallast + dSeaLaden + dCanalTransit + dCanalAnch + dLoad + dDisch + dAnch;

  // ── fuel cost ───────────────────────────────────────────────────────
  const lines: VoyageFuelLine[] = [];
  for (const [product, mt] of burnsByProduct) {
    if (!(mt > 0)) continue;
    const price: FuelPriceInput | undefined = input.prices[product];
    let usdMt: number;
    let source: FuelPriceInput["source"];
    if (price && price.usdMt > 0) {
      usdMt = price.usdMt; source = price.source;
    } else {
      const fb = num(s.fuelFallback?.[product]);
      if (!(fb > 0)) { ok = false; notes.warnings.push(`No price for ${product} (no live index and no fallback); its cost is 0.`); usdMt = 0; source = "fallback"; }
      else { notes.warnings.push(`No live index price for ${product}; the admin fallback USD ${fb}/MT was used.`); usdMt = fb; source = "fallback"; }
    }
    lines.push({ productKey: product, mt: round2(mt), usdMt, usd: round2(mt * usdMt), priceSource: source, priceAsOf: price?.asOf ?? null, pricePort: price?.port ?? null });
  }
  lines.sort((a, b) => b.usd - a.usd);
  const totalMt = round2([...burnsByProduct.values()].reduce((a, b) => a + b, 0));
  const fuelUsd = round2(lines.reduce((a, l) => a + l.usd, 0));

  // ── running cost ────────────────────────────────────────────────────
  const baseUsdDay = num(s.opex.crewUsdDay) + num(s.opex.maintenanceUsdDay);
  const usdDay = baseUsdDay * multiplier;
  const opexUsd = round2(usdDay * totalDays);

  // ── other costs ─────────────────────────────────────────────────────
  const pdaLoadUsd = num(input.ports.load.pdaUsd);
  const pdaDischUsd = num(input.ports.disch.pdaUsd);
  if (input.ports.load.pdaSource === "none" || input.ports.load.pdaUsd == null) notes.warnings.push("Load port DA not available; 0 assumed.");
  if (input.ports.disch.pdaSource === "none" || input.ports.disch.pdaUsd == null) notes.warnings.push("Discharge port DA not available; 0 assumed.");
  const extrasUsd = round2(num(input.extras?.insuranceUsd) + num(input.extras?.stevedoringUsd) + num(input.extras?.otherUsd));
  const voyageCostsUsd = round2(fuelUsd + canalUsd + pdaLoadUsd + pdaDischUsd + extrasUsd);
  const totalUsd = round2(voyageCostsUsd + opexUsd);

  // ── revenue / TCE ───────────────────────────────────────────────────
  let revenue: VoyageEstimate["revenue"] = null;
  if (input.revenue && input.revenue.freightUsdMt != null && input.revenue.freightUsdMt > 0) {
    const gross = input.revenue.qtyMt * input.revenue.freightUsdMt;
    const comm = gross * (num(input.revenue.commissionPct) / 100);
    const net = gross - comm;
    revenue = {
      grossFreightUsd: round2(gross),
      commissionUsd: round2(comm),
      netFreightUsd: round2(net),
      tceUsdDay: totalDays > 0 ? round2((net - voyageCostsUsd) / totalDays) : 0,
      resultAfterOpexUsd: round2(net - voyageCostsUsd - opexUsd),
    };
  }

  return {
    ok,
    days: {
      seaBallast: round2(dSeaBallast), seaLaden: round2(dSeaLaden),
      canalTransit: round2(dCanalTransit), canalAnchorage: round2(dCanalAnch),
      portLoad: round2(dLoad), portDisch: round2(dDisch), anchorage: round2(dAnch),
      total: round2(totalDays),
    },
    seaMarginPct: marginPct,
    legs,
    fuel: { lines, totalMt, totalUsd: fuelUsd, ecaMt: round2(ecaMt), residualProduct, ecaProduct },
    opex: { baseUsdDay, multiplier, vesselClass, usdDay: round2(usdDay), usd: opexUsd },
    costs: { fuelUsd, canalUsd: round2(canalUsd), pdaLoadUsd: round2(pdaLoadUsd), pdaDischUsd: round2(pdaDischUsd), extrasUsd, voyageCostsUsd, opexUsd, totalUsd },
    revenue,
    assumptions: notes.assumptions,
    warnings: notes.warnings,
  };
}
