// ONE matching reference — every surface that expresses "matching" (Top
// Matches ranking, map pairing eligibility, fit labels) consumes THIS module,
// never local math (09_pre_final_polish §9: a cargo must never show "3
// matches" on its card while the map highlights 4 vessels).
//
// Authoritative counts still come from the DB match RPCs
// (get_matches_for_cargo / get_matches_for_availability) — this module mirrors
// the same hard gates client-side for instant surfaces (map pairing, top
// matches) operating on already-loaded views.
import { CargoView, VesselView } from "./types";
import { calcVoyage } from "./econ";

export function dwtNum(v: VesselView): number {
  return parseInt(String(v.dwt || "").replace(/[,\s]/g, ""), 10) || 0;
}
export function cargoQtyMax(c: CargoView): number {
  if (c.qty?.max != null) return c.qty.max;
  return parseInt(String(c.qtyMt || "").replace(/[^\d]/g, ""), 10) || 0;
}

// Hard eligibility gates (mirrors the DB funnel): zone compatibility,
// DWT vs quantity (±20%), grain + DG certification hard-blocks.
export function pairEligible(c: CargoView, v: VesselView): boolean {
  const z = v.openPortZone;
  const zoneOk = !!z && (z === c.route?.polZone || z === c.route?.podZone);
  const dwt = dwtNum(v);
  const q = cargoQtyMax(c);
  const dwtOk = dwt > 0 && q > 0 && dwt >= q * 0.8 && dwt <= q * 1.2;
  const grainOk = !c.isGrain || v.grainCertified === true;
  const dgOk = !c.isDg || v.dgCertified === true;
  return zoneOk && dwtOk && grainOk && dgOk;
}

export type FitBand = "Strong" | "Good" | "Possible" | "Weak";

// Qualitative fit label (never a raw score / TCE — firewall-safe).
export function fitLabel(c: CargoView, v: VesselView): FitBand {
  if (c.isGrain && !v.grainCertified) return "Weak";
  if (c.isDg && !v.dgCertified) return "Weak";
  const dwt = dwtNum(v);
  const q = cargoQtyMax(c);
  const util = dwt > 0 ? q / dwt : 0;
  let s = 0;
  if (util >= 0.9 && util <= 1.0) s += 2;
  else if (util >= 0.8 && util <= 1.1) s += 1;
  const z = v.openPortZone;
  if (z === c.route?.polZone) s += 2;
  else if (z === c.route?.podZone) s += 1;
  if (!c.requiresGeared || v.geared) s += 1;
  return s >= 4 ? "Strong" : s >= 3 ? "Good" : s >= 1 ? "Possible" : "Weak";
}

export interface DashMatch {
  commodity: string;
  qtyMt: string;
  pol: string;
  pod: string;
  polZone: string;
  podZone: string;
  vessel: string;
  vClass: string;
  dwt: string;
  vOpen: string;
  laycan: number | null;
  tce: number;
  quality: Exclude<FitBand, "Weak">;
}

// Top Matches — built ON the same pairEligible + fitLabel gates as the map
// pairing, so the panel, the map highlights and the badges always agree.
export function buildTopMatches(
  cargos: CargoView[],
  vessels: VesselView[],
  vClassOf: (v: VesselView) => string,
  limit = 3,
): DashMatch[] {
  const used = new Set<string>();
  const out: DashMatch[] = [];
  const RANK: Record<FitBand, number> = { Strong: 3, Good: 2, Possible: 1, Weak: 0 };
  for (const c of cargos) {
    if (out.length >= limit) break;
    let best: VesselView | null = null;
    let bestBand: FitBand = "Weak";
    for (const v of vessels) {
      if (used.has(v.id)) continue;
      if (!pairEligible(c, v)) continue; // SAME gate as the map pairing
      const band = fitLabel(c, v);
      if (RANK[band] > RANK[bestBand]) { bestBand = band; best = v; }
    }
    if (!best || bestBand === "Weak") continue;
    used.add(best.id);
    let tce = 0;
    try { tce = Math.round(calcVoyage(best, c).costs.tce); } catch { tce = 0; }
    out.push({
      commodity: c.commodity || c.cargo,
      qtyMt: c.qtyMt,
      pol: c.route?.polName || c.route?.polCode || "—",
      pod: c.route?.podName || c.route?.podCode || "—",
      polZone: c.route?.polZone || "",
      podZone: c.route?.podZone || "",
      vessel: best.name,
      vClass: vClassOf(best),
      dwt: best.dwt,
      vOpen: best.openPortZone || "—",
      laycan: c.laycanDays ?? null,
      tce,
      quality: bestBand,
    });
  }
  return out;
}
