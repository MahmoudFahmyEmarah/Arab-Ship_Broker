// ════════════════════════════════════════════════════════════════════
// CANONICAL TRADE-ZONE REGISTRY — single source of truth for every zone fact
// (code, label, colour, centroid). Mirrors the database `zone_enum` (supabase
// baseline migration); the codes below MUST stay in sync with that enum.
//
// Everything else derives from here — never redefine a zone's label/colour/
// centroid anywhere else:
//   • ZONE_CODES / ZONE_LABELS / ZoneCode  → re-exported by lib/schemas/cargo
//     for forms + Zod validation
//   • ZONE_SHAPES (lib/portal/zone-shapes) → pulls colour + centroid from here
//     and only adds the drawn polygon geometry
//   • zoneByCode / zoneCentroid / zonesLabel / FLEET_ZONES → re-exported by
//     lib/portal/zones for the maps
//
// To add or recolour a zone: edit this file (and the DB enum if the code is new).
// ════════════════════════════════════════════════════════════════════

// Order mirrors the DB enum. `z.enum(ZONE_CODES)` requires this `as const` tuple.
export const ZONE_CODES = [
  "B.SEA",
  "E.MED",
  "W.MED",
  "C.MED",
  "ADRIATIC",
  "R.SEA",
  "AG",
  "A.SEA",
  "WCAF",
  "ECAF",
  "NCONT",
  "CARIB",
  "F.EAST",
  "ECI",
  "ECSA",
  "WCI",
  "R.SEA.N",
  "R.SEA.S",
  "BALTIC",
  "GLAKES",
  "Unknown",
] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

export interface ZoneMeta {
  code: ZoneCode;
  /** Full human label (used in forms, cards, popups). */
  label: string;
  /** Concise label (used for compact UI like the fleet-board direction). */
  short: string;
  /** Shared palette colour — one per zone, identical on every surface. */
  color: string;
  /** Open-water [lat, lon] used for the map label, the vessel direction-vector
   *  target, and locode-less vessel placement. Absent ⇒ zone is not placeable. */
  centroid?: [number, number];
}

export const ZONES: Record<ZoneCode, ZoneMeta> = {
  "B.SEA": { code: "B.SEA", label: "Black Sea", short: "Black Sea", color: "#2A9962", centroid: [43.3, 34.2] },
  "E.MED": { code: "E.MED", label: "East Mediterranean", short: "East Med", color: "#185FA5", centroid: [34.2, 28.0] },
  "W.MED": { code: "W.MED", label: "West Mediterranean", short: "West Med", color: "#2F6DB0", centroid: [37.4, 3.5] },
  "C.MED": { code: "C.MED", label: "Central Mediterranean", short: "Central Med", color: "#4FA3C7", centroid: [34.8, 14.2] },
  "ADRIATIC": { code: "ADRIATIC", label: "Adriatic Sea", short: "Adriatic", color: "#6E84C9", centroid: [43.0, 16.0] },
  "R.SEA": { code: "R.SEA", label: "Red Sea", short: "Red Sea", color: "#EF9F27", centroid: [20.0, 38.4] },
  "AG": { code: "AG", label: "Arabian Gulf", short: "Arabian Gulf", color: "#534AB7", centroid: [26.7, 52.2] },
  "A.SEA": { code: "A.SEA", label: "Arabian Sea", short: "Arabian Sea", color: "#1F8A8A", centroid: [17.0, 60.5] },
  "WCAF": { code: "WCAF", label: "West Coast Africa", short: "W. Africa", color: "#C24A3E", centroid: [13.5, -20.5] },
  "ECAF": { code: "ECAF", label: "East Coast Africa", short: "E. Africa", color: "#7A5BA6", centroid: [-13.0, 43.5] },
  "NCONT": { code: "NCONT", label: "North Continent", short: "N. Continent", color: "#3E7CA0", centroid: [54.0, 3.0] },
  "CARIB": { code: "CARIB", label: "Caribbean", short: "Caribbean", color: "#C99A2E", centroid: [15.0, -75.0] },
  "F.EAST": { code: "F.EAST", label: "Far East", short: "Far East", color: "#B5894C", centroid: [15.0, 112.0] },
  "ECI": { code: "ECI", label: "East Coast India", short: "E.C. India", color: "#8C6BA6", centroid: [14.0, 82.0] },
  "ECSA": { code: "ECSA", label: "East Coast South America", short: "E.C. S. America", color: "#B0524E", centroid: [-25.0, -45.0] },
  "WCI": { code: "WCI", label: "West Coast India", short: "W.C. India", color: "#C2566E", centroid: [15.5, 71.6] },
  // Field spec (09_VESSEL_FIELD_SPEC): Red Sea North & South are SEPARATE zones.
  // Legacy single R.SEA retained above for existing rows.
  "R.SEA.N": { code: "R.SEA.N", label: "Red Sea North", short: "Red Sea N", color: "#F2B04A", centroid: [26.0, 35.5] },
  "R.SEA.S": { code: "R.SEA.S", label: "Red Sea South", short: "Red Sea S", color: "#E08E22", centroid: [15.0, 41.5] },
  "BALTIC": { code: "BALTIC", label: "Baltic Sea", short: "Baltic", color: "#4E8FB8", centroid: [57.5, 19.5] },
  "GLAKES": { code: "GLAKES", label: "Great Lakes", short: "Great Lakes", color: "#5B8A72", centroid: [44.5, -82.0] },
  "Unknown": { code: "Unknown", label: "Unknown", short: "Unknown", color: "#8B95A3" },
};

export const ZONE_LABELS: Record<ZoneCode, string> = Object.fromEntries(
  ZONE_CODES.map((c) => [c, ZONES[c].label]),
) as Record<ZoneCode, string>;

/** All placeable zones (those with a centroid). */
export const FLEET_ZONES: ZoneMeta[] = ZONE_CODES.map((c) => ZONES[c]).filter((z) => z.centroid);

// Zones offered on the member dashboard. The wider canonical registry above is
// intentionally retained for historic rows and future expansion, but those
// areas must not appear as selectable operating coverage until the business
// actually serves them.
export const OPERATING_ZONE_CODES = [
  "B.SEA",
  "E.MED",
  "W.MED",
  "C.MED",
  "ADRIATIC",
  "R.SEA",
  "AG",
  "A.SEA",
  "WCAF",
  "ECAF",
] as const;
export type OperatingZoneCode = (typeof OPERATING_ZONE_CODES)[number];

const OPERATING_ZONE_SET = new Set<string>(OPERATING_ZONE_CODES);
const RED_SEA_ZONE_SET = new Set<string>(["R.SEA", "R.SEA.N", "R.SEA.S"]);

/** User-facing operating zones. Red Sea is deliberately one UI choice even
 * though north/south remain separate internal codes for matching distance. */
export const OPERATING_ZONES: ZoneMeta[] = OPERATING_ZONE_CODES.map((code) => ZONES[code]);

/** Convert a stored zone code to its selectable dashboard code. Unsupported
 * coverage returns null; all Red Sea variants collapse to the single R.SEA. */
export function operatingZoneCode(code?: string | null): OperatingZoneCode | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  if (RED_SEA_ZONE_SET.has(normalized)) return "R.SEA";
  return OPERATING_ZONE_SET.has(normalized) ? normalized as OperatingZoneCode : null;
}

/** Match a stored code against user-facing selections, including the three
 * internal Red Sea values represented by the single R.SEA option. */
export function zoneMatchesSelection(code: string | null | undefined, selected: Iterable<string>): boolean {
  const normalized = operatingZoneCode(code);
  if (!normalized) return false;
  for (const choice of selected) {
    if (operatingZoneCode(choice) === normalized) return true;
  }
  return false;
}

export function zoneByCode(code?: string | null): ZoneMeta | null {
  if (!code) return null;
  return (ZONES as Record<string, ZoneMeta>)[code] ?? null;
}

export function zoneCentroid(z: ZoneMeta): [number, number] | null {
  return z.centroid ?? null;
}

/** Concise label(s) for a list of zone codes, e.g. ["E.MED","R.SEA"] →
 *  "East Med / Red Sea". Unknown codes pass through verbatim. */
export function zonesLabel(codes?: (string | null | undefined)[] | null): string | null {
  if (!codes || !codes.length) return null;
  const labels = codes
    .map((c) => (c ? zoneByCode(c)?.short ?? c : null))
    .filter((x): x is string => !!x);
  return labels.length ? labels.join(" / ") : null;
}
