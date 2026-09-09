// Route legs — ONE reading of a listing's load / discharge side for every
// surface (dashboard rows, cards, map, calculators).
//
// Owner's rule (9 Sep 2026): show the port NAME first (a bare LOCODE resolves
// to its trade name; the code rides in the tooltip). A leg that names
// alternatives ("Izmail or Reni") is shown as written with an "alt" marker and
// the first alternative that resolves becomes the REFERENCE port that feeds
// distance, Voy OPEX and Ports DA — always labelled as an estimate. A leg that
// names an area or a country ("Spain Med", "Egypt") is shown as written with an
// "area" marker and feeds nothing until a member picks a port.
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

export function legInfo(
  code: string | null | undefined,
  name: string | null | undefined,
  zone: string | null | undefined,
  names?: PortNames | null,
): RouteLeg {
  const c = cleanCode(code);
  const n = (name ?? "").trim();
  const z = (zone ?? "").trim() || null;
  if (c) {
    const known = names?.byCode[c];
    const label = known || n || c;
    return { kind: "port", label, code: c, refCode: c, refName: label, alternatives: [], zone: z, estimated: false, tooltip: `${label} · ${c}${z ? ` · ${z}` : ""}` };
  }
  if (n) {
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
export function routeLegs(c: Pick<CargoView, "route" | "polLeg" | "podLeg">, names?: PortNames | null): RouteLegs {
  const pol = c.polLeg ?? legInfo(c.route?.polCode, c.route?.polName, c.route?.polZone, names);
  const pod = c.podLeg ?? legInfo(c.route?.podCode, c.route?.podName, c.route?.podZone, names);
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
