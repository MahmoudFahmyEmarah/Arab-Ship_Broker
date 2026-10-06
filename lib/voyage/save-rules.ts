// Voyage save — the truth-boundary rules as pure functions (C2O-050 #1, #2, #5).
//
// The server action fetches the governed rows and calls these; scripts/voyage-check.ts
// attacks them with adversarial payloads. Nothing here reads the network.

import type { SuezVesselFacts } from "@/lib/suez/types";

export interface LinkedCargoRow {
  load_port_locode: string | null;
  disch_port_locode: string | null;
  qty_min_mt: number | string | null;
  qty_max_mt: number | string | null;
}
export interface LinkedPositionRow {
  vessel_id: string;
  open_port_locode: string | null;
}

/**
 * A link is accepted only beside its own facts. An inconsistency is REFUSED with the reason; it is never dropped
 * silently (an estimate saved "unlinked" after the broker linked it would misstate what was estimated).
 */
export function reconcileLinks(args: {
  ladenFrom: string | null; ladenTo: string | null; openPort: string | null; qtyMt: number | null; freightQtyMt: number | null;
  vesselId: string | null;
  cargo?: { id: string; row: LinkedCargoRow | null } | null;
  position?: { id: string; row: LinkedPositionRow | null } | null;
}): { ok: true; vesselId: string | null } | { ok: false; error: string } {
  let vesselId = args.vesselId;
  if (args.cargo) {
    const c = args.cargo.row;
    if (!c) return { ok: false, error: "The linked cargo listing no longer exists; remove the link to save." };
    if (c.load_port_locode !== args.ladenFrom || c.disch_port_locode !== args.ladenTo) {
      return { ok: false, error: `The laden route (${args.ladenFrom ?? "?"} → ${args.ladenTo ?? "?"}) is not the linked cargo's (${c.load_port_locode ?? "?"} → ${c.disch_port_locode ?? "?"}). Change the route or remove the cargo link.` };
    }
    const qMin = c.qty_min_mt == null ? null : Number(c.qty_min_mt), qMax = c.qty_max_mt == null ? null : Number(c.qty_max_mt);
    const q = args.qtyMt;
    if ((qMin != null || qMax != null) && (q == null || !Number.isFinite(q) || (qMin != null && q < qMin) || (qMax != null && q > qMax))) {
      return { ok: false, error: `The quantity (${q == null || !Number.isFinite(q) ? "none" : q} MT) is outside the linked cargo's range (${qMin ?? "?"}–${qMax ?? "?"} MT).` };
    }
    if (args.freightQtyMt != null && args.freightQtyMt !== q) return { ok: false, error: "The freight quantity differs from the cargo quantity." };
  }
  if (args.position) {
    const a = args.position.row;
    if (!a) return { ok: false, error: "The linked position no longer exists; remove the link to save." };
    if (vesselId && a.vessel_id !== vesselId) return { ok: false, error: "The linked position belongs to another vessel." };
    if (a.open_port_locode && a.open_port_locode !== args.openPort) {
      return { ok: false, error: `The voyage opens at ${args.openPort ?? "?"} but the linked position is open at ${a.open_port_locode}. Change the ballast leg or remove the position link.` };
    }
    vesselId = vesselId ?? a.vessel_id;
  }
  return { ok: true, vesselId };
}

/** The governed Suez vessel facts: the vessel's economics profile, the vessels row for the build year. */
export interface GovernedSuezFacts {
  scnt: number | null; scgt: number | null; gt: number | null; category: string | null; buildYear: number | null;
  craneCount: number | null; craneSwlMt: number | null; mooringCranesOk: boolean | null; searchlightCompliant: boolean | null;
  firstTransit: boolean | null; beamFt: number | null; doubleBottom: boolean | null;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/**
 * Every fact the canal price reads, compared with its governed source. A typed fact that is not the governed one,
 * an arrival draft (a voyage fact) and undeclared voyage conditions are reasons the canal is the broker's figure;
 * omitted conditions are never read as a governed "none".
 */
export function suezFactReasons(typed: SuezVesselFacts | null | undefined, governed: GovernedSuezFacts | null, conditionsDeclared: boolean): string[] {
  if (!typed) return [];
  const g: Record<string, unknown> = { ...(governed ?? {}) };
  const t: Record<string, unknown> = {
    scnt: num(typed.scnt), scgt: num(typed.scgt), gt: num(typed.gt), category: typed.category ?? null, buildYear: num(typed.buildYear),
    craneCount: num(typed.craneCount), craneSwlMt: num(typed.craneSwlMt), mooringCranesOk: typed.mooringCranesOk ?? null,
    searchlightCompliant: typed.searchlightCompliant ?? null, firstTransit: typed.firstTransit ?? null, beamFt: num(typed.beamFt),
    doubleBottom: typed.doubleBottom ?? null,
  };
  const reasons: string[] = [];
  for (const [k, v] of Object.entries(t)) {
    const gv = g[k] ?? null;
    if (v != null && v !== gv) reasons.push(`${k} typed (${String(v)}) ≠ governed (${gv == null ? "none" : String(gv)})`);
  }
  if (num(typed.draftFt) != null) reasons.push("arrival draft typed for this voyage");
  if (!conditionsDeclared) reasons.push("voyage conditions (special services, surcharges) not declared");
  return reasons;
}
