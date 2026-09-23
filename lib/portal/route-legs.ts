// Route legs — ONE reading of a listing's load / discharge side for every
// surface (dashboard rows, cards, map, calculators).
//
// Owner's rule (9 Sep 2026): show the port NAME first (a bare LOCODE resolves
// to its trade name; the code rides in the tooltip). A leg that names
// alternatives ("Izmail or Reni") is shown as written with an "alt" marker and
// the first alternative that resolves becomes the REFERENCE port that feeds
// distance, Voy OPEX and Ports DA — always labelled as an estimate. A leg that
// names an area or a country ("Spain Med", "Egypt") is shown as written with an
// "area" marker.
//
// 10 Sep 2026: the DATABASE now classifies every port side (port | options |
// area | none) and nominates the reference port — fn_resolve_port_side, via
// cargo_listings.load_port_scope / load_ref_locode. That stored answer wins,
// because it knows the area dictionary and the alias table this module cannot
// see; legInfo still derives its own when no stored answer is passed (mock
// data, forms, the vessel side). An area with a nominated reference port now
// DOES feed distance, Voy OPEX and Ports DA — always labelled an estimate.
import type { CargoView } from "./types";

export type LegKind = "port" | "alt" | "area" | "none";

export interface RouteLeg {
  kind: LegKind;
  /** what to print */
  label: string;
  /** the listing's own LOCODE, if any */
  code: string | null;
  /** LOCODE used for distances and costs: the listing's code, or the first alternative that resolves */
  refCode: string | null;
  refName: string | null;
  alternatives: { name: string; code: string | null }[];
  zone: string | null;
  /** refCode is a stand-in chosen from alternatives, not the listing's own port */
  estimated: boolean;
  tooltip: string;
}

export interface PortNames {
  byCode: Record<string, string>;
  byName: Record<string, string>; // portKey(name) → LOCODE
}

/** normalised port name key — mirrors fn_resolve_port_locode's cleanup */
export function portKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\s*port\s+of\s+/, "")
    .replace(/\s+(port|anchorage|anch\.?)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALT_SPLIT = /\s+(?:or|either)\s+|\s*\/\s*/i;
const RANGE_WORDS = /\b(range|rge|area|coast|any|ports?)\b/i;

export function splitAlternatives(text: string): string[] {
  if (RANGE_WORDS.test(text) && !/\s+or\s+/i.test(text)) return [text.trim()];
  return text.split(ALT_SPLIT).map((s) => s.trim()).filter(Boolean);
}

const cleanCode = (code: string | null | undefined): string | null => {
  const k = (code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{2}[A-Z2-9]{3}$/.test(k) ? k : null;
};

/** The database's reading of one side, when the server loader has it. */
export interface StoredLeg {
  scope: "port" | "options" | "area" | "none" | null;
  refCode: string | null;
}

export function legInfo(
  code: string | null | undefined,
  name: string | null | undefined,
  zone: string | null | undefined,
  names?: PortNames | null,
  stored?: StoredLeg | null,
): RouteLeg {
  const c = cleanCode(code);
  const n = (name ?? "").trim();
  const z = (zone ?? "").trim() || null;
  const storedRef = cleanCode(stored?.refCode);
  if (c) {
    const known = names?.byCode[c];
    const label = known || n || c;
    return { kind: "port", label, code: c, refCode: c, refName: label, alternatives: [], zone: z, estimated: false, tooltip: `${label} · ${c}${z ? ` · ${z}` : ""}` };
  }
  if (n) {
    // The database placed this side already — trust it over re-deriving,
    // and use its reference port so areas can feed the calculators.
    // "options" → alt; "area" → area; "none" with a reference → the trigger
    // found no placeable text but a LOCODE sat in slot 2 — shown as an area
    // (unplaceable wording, estimated figures), never as alternatives.
    if (stored?.scope && stored.scope !== "port" && storedRef) {
      const alts = splitAlternatives(n).map((a) => ({ name: a, code: names?.byName[portKey(a)] ?? null }));
      const refName = names?.byCode[storedRef] ?? storedRef;
      const isArea = stored.scope !== "options";
      return {
        kind: isArea ? "area" : "alt",
        label: n,
        code: null,
        refCode: storedRef,
        refName,
        alternatives: isArea ? [] : alts,
        zone: z,
        estimated: true,
        tooltip: isArea
          ? `${n} — an area, not a single port; distance and costs are estimated from ${refName} (${storedRef})${z ? ` · zone ${z}` : ""}`
          : `Alternatives: ${alts.map((a) => (a.code ? `${a.name} (${a.code})` : a.name)).join(" · ")} — distance and costs are estimated from ${refName}`,
      };
    }
    const alts = splitAlternatives(n);
    if (alts.length >= 2) {
      const resolved = alts.map((a) => ({ name: a, code: names?.byName[portKey(a)] ?? null }));
      const ref = resolved.find((a) => a.code);
      return {
        kind: "alt", label: n, code: null, refCode: ref?.code ?? null, refName: ref?.name ?? null, alternatives: resolved, zone: z, estimated: !!ref,
        tooltip: `Alternatives: ${resolved.map((a) => (a.code ? `${a.name} (${a.code})` : a.name)).join(" · ")}${ref ? ` — distance and costs are estimated from ${ref.name}` : " — none is a known port; pick one for distance and costs"}`,
      };
    }
    const single = names?.byName[portKey(n)] ?? null;
    if (single) {
      return { kind: "port", label: n, code: null, refCode: single, refName: n, alternatives: [], zone: z, estimated: false, tooltip: `${n} · ${single}${z ? ` · ${z}` : ""}` };
    }
    return { kind: "area", label: n, code: null, refCode: null, refName: null, alternatives: [], zone: z, estimated: false, tooltip: `${n} — an area or country, not a single port; pick a port for distance and costs${z ? ` · zone ${z}` : ""}` };
  }
  return { kind: "none", label: z ?? "—", code: null, refCode: null, refName: null, alternatives: [], zone: z, estimated: false, tooltip: z ? `Zone only · ${z}` : "No port given" };
}

export interface RouteLegs {
  pol: RouteLeg;
  pod: RouteLeg;
  /** effective LOCODEs for distance, routes and costs (own code or reference port) */
  polCode: string | null;
  podCode: string | null;
  estimated: boolean;
  /** plain-language note when a reference port stands in, else null */
  note: string | null;
}

/** The two legs of a cargo. Uses the server-resolved legs when present. */
export function routeLegs(
  c: Pick<CargoView, "route" | "polLeg" | "podLeg"> & Partial<Pick<CargoView, "portScope">>,
  names?: PortNames | null,
): RouteLegs {
  const ps = c.portScope;
  const pol = c.polLeg ?? legInfo(c.route?.polCode, c.route?.polName, c.route?.polZone, names,
    ps ? { scope: ps.polScope, refCode: ps.polRef } : null);
  const pod = c.podLeg ?? legInfo(c.route?.podCode, c.route?.podName, c.route?.podZone, names,
    ps ? { scope: ps.podScope, refCode: ps.podRef } : null);
  const parts: string[] = [];
  if (pol.estimated) parts.push(`load side uses ${pol.refName} (listing says ${pol.label})`);
  if (pod.estimated) parts.push(`discharge side uses ${pod.refName} (listing says ${pod.label})`);
  return {
    pol, pod, polCode: pol.refCode, podCode: pod.refCode, estimated: pol.estimated || pod.estimated,
    note: parts.length ? `Estimated: ${parts.join("; ")}.` : null,
  };
}

/** Why no route can be drawn, in plain words (null when both sides resolve). */
export function noRouteReason(legs: RouteLegs): string | null {
  if (legs.polCode && legs.podCode) return null;
  const side = (leg: RouteLeg, name: string) =>
    leg.kind === "alt" && !leg.refCode ? `${name} lists alternatives (${leg.label}) and none is a known port`
    : leg.kind === "area" ? `${name} is an area, not a port (${leg.label})`
    : leg.kind === "none" ? `${name} has no port`
    : null;
  const why = [side(legs.pol, "the load side"), side(legs.pod, "the discharge side")].filter(Boolean).join("; ");
  return `No route is drawn because ${why}. Pick a port on each side to get distance, Voy OPEX and Ports DA.`;
}

export const legMarker = (leg: RouteLeg): "alt" | "area" | null => (leg.kind === "alt" ? "alt" : leg.kind === "area" ? "area" : null);

// ── Route state (17 Sep 2026) ──────────────────────────────────────────────
// Three explicit states for every cargo, shown on the card and the row rather
// than hidden in a tooltip:
//   exact      port → port, the listing's own LOCODEs
//   estimated  an area / option list on either side, resolved through the
//              nominated reference port — the original wording stays, the
//              reference route is printed underneath ("Estimated via …")
//   invalid    a side nobody can place: no LOCODE and no reference port
// The database refuses the third shape for a live, approved cargo
// (trg_cl_zy_live_route_gate, 20260917120000_cargo_live_route_gate.sql).
export type RouteState = "exact" | "estimated" | "invalid";

export function routeState(legs: RouteLegs): RouteState {
  if (!legs.polCode || !legs.podCode) return "invalid";
  return legs.estimated ? "estimated" : "exact";
}

export interface RouteEstimate {
  state: Exclude<RouteState, "exact">;
  /** one short line for the card: "Estimated via Piraeus → Lattakia" */
  text: string;
  /** the long form, for a tooltip */
  detail: string;
}

/** The secondary route line. Null for exact port → port (nothing to add). */
export function routeEstimate(legs: RouteLegs): RouteEstimate | null {
  const state = routeState(legs);
  if (state === "exact") return null;
  if (state === "invalid") {
    return {
      state,
      text: "Reference port required",
      detail: noRouteReason(legs) ?? "No route can be drawn.",
    };
  }
  const via = `${legs.pol.refName ?? legs.pol.label} → ${legs.pod.refName ?? legs.pod.label}`;
  return {
    state,
    text: `Estimated via ${via}`,
    detail: `${legs.note ?? "Estimated."} Distance, Voy OPEX and Ports DA use ${via}; the contractual ports are as written above.`,
  };
}
