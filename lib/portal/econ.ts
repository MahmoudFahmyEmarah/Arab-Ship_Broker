// Economic calculators — formulas ported from the new design
// (asb/voyage-estimator.jsx): voyage P&L / TCE, Ports DA, Suez Canal toll.
// Pure functions over the portal view models.
import { CargoView, VesselView } from "./types";

export const FUEL_PRICES = { vlsfo: 585, lsmgo: 725, port: "Singapore", updated: "23 May 2026" };
export const SUEZ_SDR_USD = 1.38;
const KAP_SAR_USD = 3.75;
const SUEZ_TARIFF = { Laden: 8.687, Ballast: 6.515 }; // SDR per SCNRT
export const SUEZ_FIXED: [string, number][] = [
  ["Pilotage", 316],
  ["SCA ETR", 500],
  ["Mooring, unmooring & projector", 3500],
  ["Port Said Ports Authority", 2745],
  ["Red Sea Ports Authority", 663],
  ["Lights dues", 1578],
  ["Quarantine", 19],
  ["Waste reception", 825],
  ["Immigration, security & police", 100],
  ["Bank charges", 75],
  ["Service boat", 150],
  ["Agency", 750],
];

export function num(s: string | number | null | undefined): number {
  return parseInt(String(s ?? "").replace(/[^0-9.]/g, ""), 10) || 0;
}
const f = (s: string | number) => parseFloat(String(s)) || 0;

export interface FuelPrices { vlsfo: number; lsmgo: number; port: string; updated: string }

// GT / SCNRT — use the real registered values from the vessel record when
// present; fall back to the prototype's DWT approximation (flagged in the UI as
// estimated) until the Suez Canal certificate / GT columns are populated.
export function vesselSCNRT(v: VesselView): number {
  return v.scnrt != null ? v.scnrt : Math.round(num(v.dwt) * 0.45);
}
export function vesselGT(v: VesselView): number {
  return v.gt != null ? v.gt : Math.round(num(v.dwt) * 0.54);
}
export const scnrtIsEstimated = (v: VesselView) => v.scnrt == null;

// Suez direction from the zone pair (Med ↔ Red-Sea/Gulf/Asia/E.Africa).
export function detectSuezDirection(polZone: string, podZone: string): "Southbound" | "Northbound" {
  if (MED.has(polZone) && RED_AG.has(podZone)) return "Southbound";
  if (RED_AG.has(polZone) && MED.has(podZone)) return "Northbound";
  return "Southbound";
}

// ── Ports DA (King Abdullah Port / Kanoo model) ────────────────────────────
export function calcPortDA({
  days,
  qtyMT,
  stevedoringAccount,
  agencyFeeSAR,
}: {
  days: number;
  qtyMT: number;
  stevedoringAccount: string;
  agencyFeeSAR?: number;
}) {
  const d = Math.max(Math.round(days) || 1, 1);
  let berthHire = 0;
  for (let i = 1; i <= d; i++) berthHire += i <= 3 ? 2100 : 3000;
  const portDues = 2400;
  const mooring = 14878.6;
  const waste = 400 * d;
  const tabdulBase = 50;
  const tabdulVat = tabdulBase * 0.15;
  const tabdul = tabdulBase + tabdulVat;
  const agency = agencyFeeSAR != null ? agencyFeeSAR : 18750;
  const stevedoring = stevedoringAccount === "Owner" ? 8 * (qtyMT || 0) : 0;
  const subtotalExcl = berthHire + portDues + mooring + waste + tabdul + agency;
  const subtotalIncl = subtotalExcl + stevedoring;
  return {
    days: d,
    rate: KAP_SAR_USD,
    berthHire, portDues, mooring, waste, tabdulBase, tabdulVat, tabdul, agency, stevedoring,
    subtotalExcl, subtotalIncl,
    usdExcl: subtotalExcl / KAP_SAR_USD,
    usdIncl: subtotalIncl / KAP_SAR_USD,
  };
}

// ── Suez Canal toll (RUBATO transit model) ─────────────────────────────────
export function calcSuezToll({
  scnrt,
  cargoStatus,
  sdrUsd,
}: {
  scnrt: number;
  cargoStatus: string;
  sdrUsd?: number;
}) {
  const tariff = cargoStatus === "Ballast" ? SUEZ_TARIFF.Ballast : SUEZ_TARIFF.Laden;
  const toll = (scnrt || 0) * tariff * (sdrUsd || SUEZ_SDR_USD);
  const fixedTotal = SUEZ_FIXED.reduce((a, [, v]) => a + v, 0);
  return { tariff, toll, fixedTotal, total: toll + fixedTotal };
}

// ── Voyage P&L / TCE ───────────────────────────────────────────────────────
const DISTANCES: Record<string, number> = {
  "EGALY|SAJED": 1100, "AEJEA|TZDAR": 2620, "INMUM|JOAQJ": 2710, "EGDAM|RUNER": 1010,
  "JOAQJ|ROCND": 2210, "EGALY|TRIST": 850, "SAJED|TRIZM": 1820, "AEJEA|EGALY": 3150,
};
function lookupNM(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  return DISTANCES[[a, b].sort().join("|")] ?? null;
}
const MED = new Set(["E.MED", "W.MED", "C.MED", "ADRIATIC", "B.SEA", "NCONT"]);
const RED_AG = new Set(["R.SEA", "AG", "A.SEA", "ECAF", "ECI", "F.EAST"]);
export function needsSuez(polZone: string, podZone: string): boolean {
  return (MED.has(polZone) && RED_AG.has(podZone)) || (RED_AG.has(polZone) && MED.has(podZone));
}

export interface VoyageLeg {
  name: string;
  from: string;
  to: string;
  nm: number | null;
  days: number;
  vlsfo: number;
  lsmgo: number;
  note: string;
  suez?: boolean;
  nmAuto?: boolean;
}

export interface VoyageOpts {
  fuel?: FuelPrices;
  insurance?: number;
  stevedoring?: number;
  podPDAManual?: number;
}

export function calcVoyage(vessel: VesselView, cargo: CargoView, opts: VoyageOpts = {}) {
  const speedLaden = 12.5;
  const speedBallast = 13.0;
  const fuel = opts.fuel ?? FUEL_PRICES;
  const vlsfoSea = f(vessel.fuel.vlsfoSea);
  const lsmgoPort = f(vessel.fuel.lsmgoPort);
  const qty = num(cargo.qtyMt);

  const ladenNMauto = lookupNM(cargo.route.polCode, cargo.route.podCode);
  const ballastNMauto = lookupNM(vessel.openPortLocode, cargo.route.polCode);
  const ladenNM = ladenNMauto ?? 1500;
  const ballastNM = ballastNMauto ?? 900;
  const ladenDays = ladenNM / (speedLaden * 24);
  const ballastDays = ballastNM / (speedBallast * 24);

  const suez = needsSuez(cargo.route.polZone, cargo.route.podZone);
  const suezDays = suez ? 1 : 0;
  const suezNM = suez ? 100 : 0;

  const loadDays = cargo.loadRate ? qty / cargo.loadRate : 0;
  const dischDays = cargo.dischRate ? qty / cargo.dischRate : 0;

  const ballastVLSFO = ballastDays * vlsfoSea;
  const ladenVLSFO = ladenDays * vlsfoSea;
  const suezVLSFO = suezDays * vlsfoSea;
  const loadLSMGO = loadDays * lsmgoPort;
  const dischLSMGO = dischDays * lsmgoPort;

  const totalVLSFO = ballastVLSFO + ladenVLSFO + suezVLSFO;
  const totalLSMGO = loadLSMGO + dischLSMGO;
  const totalDays = ballastDays + ladenDays + suezDays + loadDays + dischDays;
  const totalNM = ballastNM + ladenNM + suezNM;

  const bunkerVLSFO = totalVLSFO * fuel.vlsfo;
  const bunkerLSMGO = totalLSMGO * fuel.lsmgo;
  const bunker = bunkerVLSFO + bunkerLSMGO;

  // POL PDA is computed by the SAME Ports DA model used on the Ports DA page,
  // so the estimator and that page agree to the cent (KAP/Kanoo proforma).
  const polDA = calcPortDA({ days: Math.max(Math.ceil(loadDays || 1), 1), qtyMT: qty, stevedoringAccount: "Charterer" });
  const polPDA = polDA.usdIncl;
  // POD has no rate table yet → manual fallback, flagged amber in the UI.
  const podPDAauto = false;
  const podPDA = opts.podPDAManual ?? 42000;

  const scnrt = vesselSCNRT(vessel);
  const suezTotal = suez ? calcSuezToll({ scnrt, cargoStatus: "Laden", sdrUsd: SUEZ_SDR_USD }).total : 0;

  const grossFreight = qty * (cargo.freightIdea || 0);
  const commissionAmt = grossFreight * ((cargo.commission || 0) / 100);
  const netFreight = grossFreight - commissionAmt;
  const insurance = opts.insurance ?? 0;
  const stevedoring = opts.stevedoring ?? 0;
  const grossExpenses = bunker + polPDA + podPDA + suezTotal + insurance + stevedoring;
  const tce = totalDays > 0 ? (netFreight - grossExpenses) / totalDays : 0;

  const legs: VoyageLeg[] = [
    { name: "Ballast leg", from: vessel.openPort, to: cargo.route.polName, nm: ballastNM, days: ballastDays, vlsfo: ballastVLSFO, lsmgo: 0, nmAuto: ballastNMauto != null, note: ballastNMauto != null ? "Auto from distance table." : "Manual — distance not in Phase-1 table." },
    { name: "Laden leg", from: cargo.route.polName, to: cargo.route.podName, nm: ladenNM, days: ladenDays, vlsfo: ladenVLSFO, lsmgo: 0, nmAuto: ladenNMauto != null, note: ladenNMauto != null ? "Auto from distance table." : "Manual entry required." },
    { name: "Suez transit", from: suez ? "Port Said" : "—", to: suez ? "Suez" : "—", nm: suezNM, days: suezDays, vlsfo: suezVLSFO, lsmgo: 0, suez, note: suez ? "Cost → see Suez Canal Toll." : "Not required for this route." },
    { name: "Port: Loading", from: cargo.route.polName, to: "—", nm: null, days: loadDays, vlsfo: 0, lsmgo: loadLSMGO, note: "Qty ÷ load rate." },
    { name: "Port: Discharging", from: cargo.route.podName, to: "—", nm: null, days: dischDays, vlsfo: 0, lsmgo: dischLSMGO, note: "Qty ÷ discharge rate." },
  ];

  return {
    legs,
    totals: { nm: totalNM, days: totalDays, vlsfo: totalVLSFO, lsmgo: totalLSMGO },
    speed: { laden: speedLaden, ballast: speedBallast },
    costs: { bunkerVLSFO, bunkerLSMGO, bunker, polPDA, podPDA, podPDAauto, suezTotal, insurance, stevedoring, grossFreight, commissionAmt, netFreight, grossExpenses, tce },
    suez: { required: suez, scnrt, total: suezTotal, direction: detectSuezDirection(cargo.route.polZone, cargo.route.podZone) },
    ports: { polDays: loadDays, podDays: dischDays, polDA },
    fuel,
  };
}

export type VoyageCalc = ReturnType<typeof calcVoyage>;

export const usd = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
