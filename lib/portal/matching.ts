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

// Client-side fallback gates — mirror the canonical DB funnel
// (get_matches_for_availability / get_matches_for_cargo, latest = the DG-block
// refactor) as closely as the loaded view fields allow. The AUTHORITATIVE
// eligibility on the map comes from the DB RPC on anchor; this is only used in
// sample/offline mode and to rank Top Matches. Stages mirrored: 3 geography,
// 4 capacity (qty_min floor + 10%/20% part-cargo tier), 5 vessel type, 6 timing
// (approx via days-from-now), 7a geared, 7b grain cert, DG cert, 7d draft.
export function pairEligible(c: CargoView, v: VesselView): boolean {
  // 3 · geography
  const z = v.openPortZone;
  if (!(z && (z === c.route?.polZone || z === c.route?.podZone))) return false;

  // 4 · capacity — qty_min floor + tiered tolerance (±10% / ±20% part cargo)
  const dwt = dwtNum(v);
  const qmax = cargoQtyMax(c);
  const qmin = c.qty?.min ?? qmax;
  if (!(dwt > 0 && qmax > 0)) return false;
  const part = v.acceptsPartCargo === true;
  const hi = qmax * (part ? 1.2 : 1.1);
  const lo = qmax * (part ? 0.8 : 0.9);
  if (!(dwt >= qmin && dwt <= hi && dwt >= lo)) return false;

  // 5 · vessel type — Dry Bulk requires Bulk Carrier / General Cargo
  if (c.type !== "Break Bulk" && !(v.type === "Bulk Carrier" || v.type === "General Cargo")) return false;

  // 7a · geared · 7b · grain cert · DG cert
  if (c.requiresGeared === true && v.geared !== true) return false;
  if (c.isGrain && v.grainCertified !== true) return false;
  if (c.isDg && v.dgCertified !== true) return false;

  // 7d · max draft
  if (c.maxDraft != null && v.draft) {
    const d = parseFloat(v.draft);
    if (!isNaN(d) && d > c.maxDraft) return false;
  }

  // 6 · timing (approx) — vessel open within [laycan-21, laycan+14] days
  if (!c.spot && c.laycanDays != null && v.openDateDays != null) {
    if (!(v.openDateDays >= c.laycanDays - 21 && v.openDateDays <= c.laycanDays + 14)) return false;
  }
  return true;
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
