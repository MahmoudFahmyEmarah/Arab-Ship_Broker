// Broker trade zones — bounds + colors, shared by the fleet map (zone shading)
// and the fleet board (placing each vessel's preferred-direction vector toward
// the centroid of its first preferred zone, and labelling the direction).
export interface ZoneDef {
  code: string;
  label: string;
  bounds: [[number, number], [number, number]]; // SW [lat,lon] → NE [lat,lon]
  color: string;
}

export const FLEET_ZONES: ZoneDef[] = [
  { code: "AG", label: "Arabian Gulf", bounds: [[23, 48], [30.5, 57]], color: "#534AB7" },
  { code: "R.SEA", label: "Red Sea", bounds: [[12, 33], [30, 44]], color: "#EF9F27" },
  { code: "E.MED", label: "East Med", bounds: [[30, 22], [37.5, 37]], color: "#185FA5" },
  { code: "B.SEA", label: "Black Sea", bounds: [[40.5, 27], [47, 42]], color: "#2A9962" },
  { code: "A.SEA", label: "Arabian Sea", bounds: [[8, 55], [25, 74]], color: "#1F8A8A" },
  { code: "NCONT", label: "N. Continent", bounds: [[50, -5], [58, 9]], color: "#7A5BA6" },
];

const BY_CODE: Record<string, ZoneDef> = Object.fromEntries(FLEET_ZONES.map((z) => [z.code, z]));

export function zoneByCode(code?: string | null): ZoneDef | null {
  if (!code) return null;
  return BY_CODE[code] ?? null;
}

export function zoneCentroid(z: ZoneDef): [number, number] {
  return [(z.bounds[0][0] + z.bounds[1][0]) / 2, (z.bounds[0][1] + z.bounds[1][1]) / 2];
}

/** Human label(s) for a list of zone codes, e.g. ["E.MED","R.SEA"] → "East Med / Red Sea". */
export function zonesLabel(codes?: string[] | null): string | null {
  if (!codes || !codes.length) return null;
  const labels = codes.map((c) => zoneByCode(c)?.label ?? c).filter(Boolean);
  return labels.length ? labels.join(" / ") : null;
}
