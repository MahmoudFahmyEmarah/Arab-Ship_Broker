// Modular map/board filter model — one facet list, shared by the map filter
// panel and (later) the board filter bar so a cargo filters identically in both.
//
// §2b governing rule: CLOSED enums (fixed business vocabulary — category, IMSBC
// group, load terms) always render their full fixed option set, even if no
// current listing uses a value (so IMSBC always offers A/B/C). OPEN/geographic
// sets (zones, ports) are derived from the live data so the filter never offers
// an empty result (no phantom zones).
import { CargoView, VesselView } from "./types";

export type FacetItem = CargoView | VesselView;

export interface EnumFacet<T extends FacetItem> {
  id: string;
  label: string;
  kind: "enum";
  group: "cargo" | "vessel";
  /** closed = fixed `options`; open = derive options from the live data. */
  closed: boolean;
  options: string[] | ((items: T[]) => string[]);
  /** the item's value(s) for this facet (null = item has no value). */
  valueOf: (item: T) => string | string[] | null;
}

// ── cargo categorisation (Grain is derived, not just c.type) ──
export function cargoCategory(c: CargoView): string {
  if (c.isGrain) return "GRAIN";
  const t = (c.type || "").toLowerCase();
  if (t === "dry bulk") return "DRY BULK";
  if (t === "break bulk") return "BREAK BULK";
  if (t === "project") return "PROJECT";
  if (t === "liquid") return "LIQUID";
  return (c.type || "—").toUpperCase();
}

const norm = (s: string) => s.trim().toUpperCase();
const distinct = (xs: (string | null | undefined)[]) =>
  Array.from(new Set(xs.filter((x): x is string => !!x && x.trim() !== ""))).sort();

// ── Cargo facets (§2b) ──
export const CARGO_FACETS: EnumFacet<CargoView>[] = [
  {
    id: "category",
    label: "Category",
    kind: "enum",
    group: "cargo",
    closed: true, // closed set — show all, incl. categories with no current data
    options: ["GRAIN", "DRY BULK", "BREAK BULK", "PROJECT", "LIQUID"],
    valueOf: (c) => cargoCategory(c),
  },
  {
    id: "imsbc",
    label: "IMSBC group",
    kind: "enum",
    group: "cargo",
    closed: true, // always A/B/C (B is shown even with no Group-B data)
    options: ["A", "B", "C"],
    valueOf: (c) => (c.imsbcGroup ? norm(c.imsbcGroup).replace(/^CAT[_\s-]?/, "") : null),
  },
  {
    id: "loadTerms",
    label: "Load terms",
    kind: "enum",
    group: "cargo",
    closed: true,
    options: ["FIOST", "FIO", "FIOT", "FIOS", "FI", "FO", "Liner Terms", "Gross Terms"],
    valueOf: (c) => c.loadTerms ?? null,
  },
  {
    id: "zone",
    label: "Zone",
    kind: "enum",
    group: "cargo",
    closed: false, // open/geographic — only zones present in the data
    options: (items) => distinct(items.flatMap((c) => [c.route?.polZone, c.route?.podZone])),
    valueOf: (c) => [c.route?.polZone, c.route?.podZone].filter(Boolean) as string[],
  },
  // NOTE: "Cargo nature" deliberately NOT a facet (§2b — it's offer firmness, a
  // listing field, not a discovery facet). Laycan (range/SPOT), Quantity range
  // and Sort are follow-ups.
];

// ── Vessel facets ──
export const VESSEL_FACETS: EnumFacet<VesselView>[] = [
  {
    id: "vesselType",
    label: "Vessel type",
    kind: "enum",
    group: "vessel",
    closed: false, // open — derive from the live fleet
    options: (items) => distinct(items.map((v) => v.type)),
    valueOf: (v) => v.type ?? null,
  },
  {
    id: "openZone",
    label: "Open zone",
    kind: "enum",
    group: "vessel",
    closed: false,
    options: (items) => distinct(items.map((v) => v.openPortZone)),
    valueOf: (v) => v.openPortZone ?? null,
  },
];

/** Resolve a facet's options (closed array, or derived from data). */
export function facetOptions<T extends FacetItem>(facet: EnumFacet<T>, items: T[]): string[] {
  return typeof facet.options === "function" ? facet.options(items) : facet.options;
}

/** A selection map: facetId → Set of selected option values. Empty/absent = inactive. */
export type Selections = Record<string, Set<string>>;

function itemValues<T extends FacetItem>(facet: EnumFacet<T>, item: T): string[] {
  const v = facet.valueOf(item);
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(norm);
}

/** An item passes if, for every facet with a non-empty selection, at least one
 *  of the item's values is selected. (Empty selection = facet off = passes.) */
export function passesFacets<T extends FacetItem>(
  item: T,
  facets: EnumFacet<T>[],
  sel: Selections,
): boolean {
  for (const facet of facets) {
    const chosen = sel[facet.id];
    if (!chosen || chosen.size === 0) continue;
    const vals = itemValues(facet, item);
    if (!vals.some((v) => chosen.has(v))) return false;
  }
  return true;
}
