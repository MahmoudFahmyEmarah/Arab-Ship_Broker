// Match engine — finds counterparties for a circulation record in BOTH the live
// database and the uncommitted staged drafts.
//   cargo enquiry  → vessels whose DWT / zones fit
//   vessel position → cargoes whose quantity / zones fit
// Scoring is pure (unit-tested); loadMatches() does the candidate queries.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface MatchCandidateVessel {
  vessel_name: string | null;
  dwt_grain: number | null;
  build_year: number | null;
  preferred_zones: string[] | null;
  open_zone?: string | null;     // where she's open (queued positions)
  open_port?: string | null;
  origin: "live" | "draft";
}

// ── nautical zone neighbourhood ─────────────────────────────────────────────
// Which zones are one sea-leg away from each other (symmetric closure applied
// below). Drives proximity matching: an Algeria (W.MED) open vessel also sees
// C.MED / NCONT / WCAF cargoes as near.
const ZONE_NEIGHBOURS: Record<string, string[]> = {
  "B.SEA": ["E.MED"],
  "E.MED": ["B.SEA", "C.MED", "ADRIATIC", "R.SEA"],
  "C.MED": ["E.MED", "W.MED", "ADRIATIC"],
  "W.MED": ["C.MED", "NCONT", "WCAF"],
  "ADRIATIC": ["C.MED", "E.MED"],
  "R.SEA": ["E.MED", "A.SEA", "ECAF"],
  "AG": ["A.SEA"],
  "A.SEA": ["AG", "R.SEA", "WCI", "ECAF"],
  "WCI": ["A.SEA", "ECI"],
  "ECI": ["WCI", "F.EAST"],
  "F.EAST": ["ECI"],
  "NCONT": ["W.MED", "GLAKES", "WCAF"],
  "WCAF": ["W.MED", "NCONT", "ECSA"],
  "ECAF": ["R.SEA", "A.SEA"],
  "CARIB": ["ECSA", "GLAKES"],
  "ECSA": ["CARIB", "WCAF"],
  "GLAKES": ["NCONT", "CARIB"],
};
function neighbours(zone: string): string[] {
  const z = zone.toUpperCase();
  const direct = ZONE_NEIGHBOURS[z] ?? [];
  const reverse = Object.entries(ZONE_NEIGHBOURS).filter(([, ns]) => ns.includes(z)).map(([k]) => k);
  return [...new Set([...direct, ...reverse])];
}

/** proximity score (0–40): same zone 40, neighbouring zone 25, unknown 15. */
export function zoneProximityScore(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 15;
  const A = a.toUpperCase(), B = b.toUpperCase();
  if (A === B) return 40;
  if (neighbours(A).includes(B)) return 25;
  return 0;
}

/** direction fit (0–20): cargo discharges where the vessel wants to go. */
export function directionScore(destZones: string[] | null | undefined, dischZone: string | null | undefined): number {
  if (!destZones?.length || !dischZone) return 8; // unknown → mild neutral
  const d = dischZone.toUpperCase();
  const wanted = destZones.map((z) => z.toUpperCase());
  if (wanted.includes(d)) return 20;
  if (wanted.some((w) => neighbours(w).includes(d))) return 10;
  return 0;
}

/** same named port / country → small bonus (0 or 10). */
export function portAffinityScore(
  openPort: string | null | undefined, openCountry: string | null | undefined,
  cargoPort: string | null | undefined, cargoCountry: string | null | undefined,
): number {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const p = norm(openPort), c = norm(openCountry), lp = norm(cargoPort), lc = norm(cargoCountry);
  if (p && lp && (lp.includes(p) || p.includes(lp))) return 10;
  if (c && (lc === c || (lp && lp.includes(c)))) return 10;
  return 0;
}

export interface MatchCandidateCargo {
  ref: string | null;
  commodity_name: string | null;
  qty_min_mt: number | null;
  qty_max_mt: number | null;
  load_zone: string | null;
  load_country: string | null;
  load_port_name: string | null;
  disch_port_name: string | null;
  disch_zone: string | null;
  laycan_from: string | null;
  origin: "live" | "draft";
}

/** The vessel side of a match query — registry vessels or queued open positions. */
export interface VesselQuery {
  dwt_grain: number | null;
  preferred_zones?: string[] | null;
  open_zone?: string | null;
  open_port?: string | null;
  open_country?: string | null;
  dest_zones?: string[] | null;
}

export interface MatchResult {
  kind: "vessel" | "cargo";
  label: string;          // vessel name (mask before sending) or commodity
  facts: string[];        // operational facts only — never commercial terms
  band: "Strong" | "Good" | "Possible";
  score: number;
  origin: "live" | "draft";
}

const nf = (n: number) => n.toLocaleString("en-US");

/** qty↔DWT fit score (0–60). The vessel must plausibly lift the cargo. */
export function qtyFitScore(qtyMin: number | null, qtyMax: number | null, dwt: number | null): number {
  if (dwt == null || dwt <= 0) return 0;
  const max = qtyMax ?? qtyMin;
  const min = qtyMin ?? qtyMax;
  if (max == null || min == null) return 0;
  if (dwt >= max) {
    const util = max / dwt;                    // how tightly the cargo fills the ship
    if (util >= 0.85) return 60;
    if (util >= 0.6) return 45;
    if (util >= 0.35) return 30;
    return 12;                                  // ship far too big — weak economics
  }
  if (dwt >= min) return 30;                    // min parcel fits (top of range doesn't)
  return 0;                                     // cargo simply doesn't fit
}

/** zone score (0–40): exact preferred-zone hit, neutral when unknown. */
export function zoneScore(cargoZone: string | null, vesselZones: string[] | null): number {
  if (!cargoZone || !vesselZones || vesselZones.length === 0) return 15; // unknown → neutral
  return vesselZones.map((z) => z.toUpperCase()).includes(cargoZone.toUpperCase()) ? 40 : 0;
}

export function band(score: number): "Strong" | "Good" | "Possible" | null {
  if (score >= 80) return "Strong";
  if (score >= 55) return "Good";
  if (score >= 30) return "Possible";
  return null;
}

export function scoreVesselForCargo(
  cargo: { qty_min_mt: number | null; qty_max_mt: number | null; load_zone: string | null },
  v: MatchCandidateVessel,
): MatchResult | null {
  // A queued open position knows WHERE she is (open_zone → proximity);
  // a registry vessel only knows where she LIKES to trade (preferred_zones).
  const zonePart = v.open_zone != null
    ? zoneProximityScore(v.open_zone, cargo.load_zone)
    : zoneScore(cargo.load_zone, v.preferred_zones);
  const score = qtyFitScore(cargo.qty_min_mt, cargo.qty_max_mt, v.dwt_grain) + zonePart;
  const b = band(score);
  if (!b) return null;
  const facts = [
    v.dwt_grain ? `${nf(v.dwt_grain)} DWT` : null,
    v.build_year ? `built ${v.build_year}` : null,
    v.open_port ? `open ${v.open_port}` : v.open_zone ? `open ${v.open_zone}` :
      v.preferred_zones?.length ? `zones ${v.preferred_zones.slice(0, 3).join("/")}` : null,
  ].filter((x): x is string => !!x);
  return { kind: "vessel", label: v.vessel_name ?? "Unnamed vessel", facts, band: b, score, origin: v.origin };
}

export function scoreCargoForVessel(
  vessel: VesselQuery,
  c: MatchCandidateCargo,
): MatchResult | null {
  // Location: prefer the true open position (proximity via zone neighbourhood);
  // fall back to trading-zone membership for registry vessels.
  const zonePart = vessel.open_zone != null
    ? zoneProximityScore(vessel.open_zone, c.load_zone)
    : zoneScore(c.load_zone, vessel.preferred_zones ?? null);
  const score =
    qtyFitScore(c.qty_min_mt, c.qty_max_mt, vessel.dwt_grain) +
    zonePart +
    directionScore(vessel.dest_zones, c.disch_zone) +
    portAffinityScore(vessel.open_port, vessel.open_country, c.load_port_name, c.load_country);
  const b = band(score);
  if (!b) return null;
  const qty = c.qty_min_mt != null || c.qty_max_mt != null
    ? `${c.qty_min_mt != null ? nf(c.qty_min_mt) : "—"}–${c.qty_max_mt != null ? nf(c.qty_max_mt) : "—"} MT` : null;
  const route = [c.load_port_name, c.disch_port_name].filter(Boolean).join(" → ") || null;
  const facts = [qty, route, c.laycan_from ? `laycan ${c.laycan_from}` : null].filter((x): x is string => !!x);
  return { kind: "cargo", label: c.commodity_name ?? "Cargo", facts, band: b, score, origin: c.origin };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strv = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * Load + score matches for one staged row (cargo or vessels sheet).
 * Candidates come from the live table AND from uncommitted staged drafts.
 * Every query is bounded; any partial failure degrades to fewer candidates.
 */
export async function loadMatches(
  supabase: SupabaseClient,
  sheet: "cargo" | "vessels",
  payload: Record<string, unknown>,
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  if (sheet === "cargo") {
    const cargo = {
      qty_min_mt: num(payload.qty_min_mt), qty_max_mt: num(payload.qty_max_mt),
      load_zone: strv(payload.load_zone),
    };
    const maxQty = cargo.qty_max_mt ?? cargo.qty_min_mt;
    if (maxQty == null) return [];
    // live vessels that could lift it (bounded window)
    const { data: live } = await supabase
      .from("vessels")
      .select("vessel_name, dwt_grain, build_year, preferred_zones")
      .gte("dwt_grain", Math.floor((cargo.qty_min_mt ?? maxQty) * 0.9))
      .lte("dwt_grain", maxQty * 5)
      .limit(80);
    for (const v of live ?? []) {
      const r = scoreVesselForCargo(cargo, { ...v, origin: "live" } as MatchCandidateVessel);
      if (r) results.push(r);
    }
    // staged draft vessels (uncommitted)
    const { data: draft } = await supabase
      .from("sync_staged_row")
      .select("payload")
      .eq("sheet", "vessels").eq("committed", false)
      .in("classification", ["new", "updated"])
      .limit(200);
    for (const d of draft ?? []) {
      const p = (d.payload ?? {}) as Record<string, unknown>;
      const r = scoreVesselForCargo(cargo, {
        vessel_name: strv(p.vessel_name), dwt_grain: num(p.dwt_grain),
        build_year: num(p.build_year), preferred_zones: null, origin: "draft",
      });
      if (r) results.push(r);
    }
    // queued open positions (no-IMO vessels awaiting review) — they know WHERE they are
    const { data: queued } = await supabase
      .from("vessel_review_queue")
      .select("vessel_name, dwt_grain, built, open_zone, open_port")
      .eq("status", "pending")
      .limit(200);
    for (const q of queued ?? []) {
      const r = scoreVesselForCargo(cargo, {
        vessel_name: q.vessel_name, dwt_grain: q.dwt_grain, build_year: q.built,
        preferred_zones: null, open_zone: q.open_zone, open_port: q.open_port, origin: "draft",
      });
      if (r) results.push(r);
    }
  } else {
    const vessel: VesselQuery = {
      dwt_grain: num(payload.dwt_grain),
      open_zone: strv(payload.open_zone), open_port: strv(payload.open_port),
      open_country: strv(payload.open_country),
      dest_zones: Array.isArray(payload.dest_zones) ? (payload.dest_zones as string[]) : null,
      preferred_zones: null,
    };
    if (vessel.dwt_grain == null) return [];
    const { data: live } = await supabase
      .from("cargo_listings")
      .select("ref, commodity_name, qty_min_mt, qty_max_mt, load_zone, load_country, load_port_name, disch_port_name, disch_zone, laycan_from")
      .in("status", ["IN", "PARTIAL"])
      .lte("qty_max_mt", Math.ceil(vessel.dwt_grain * 1.1))
      .gte("qty_max_mt", Math.floor(vessel.dwt_grain * 0.2))
      .limit(80);
    for (const c of live ?? []) {
      const r = scoreCargoForVessel(vessel, { ...c, origin: "live" } as MatchCandidateCargo);
      if (r) results.push(r);
    }
    const { data: draft } = await supabase
      .from("sync_staged_row")
      .select("payload")
      .eq("sheet", "cargo").eq("committed", false)
      .in("classification", ["new", "updated"])
      .limit(200);
    for (const d of draft ?? []) {
      const p = (d.payload ?? {}) as Record<string, unknown>;
      const r = scoreCargoForVessel(vessel, {
        ref: strv(p.ref), commodity_name: strv(p.commodity_name),
        qty_min_mt: num(p.qty_min_mt), qty_max_mt: num(p.qty_max_mt),
        load_zone: strv(p.load_zone), load_country: strv(p.load_country),
        load_port_name: strv(p.load_port_name), disch_port_name: strv(p.disch_port_name),
        disch_zone: strv(p.disch_zone), laycan_from: strv(p.laycan_from), origin: "draft",
      });
      if (r) results.push(r);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 10);
}
