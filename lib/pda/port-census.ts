// PDA · the port touch census model (design B2ALL-061, build step 11): what the hub, the directory and the map read.
//
// One governed RPC, get_port_touch_census (20261019140000): every active, verified port with the number of live,
// approved listings that touch it today — exactly what the member can already see on the boards. Counts are touches
// (a listing loading AND discharging at a port touches it twice); the cohort rule counts distinct listings and vessels:
// fewer than the minimum → suppressed (every count null). A reported port whose breakdown has a cell of 1–2 keeps its
// total and withholds every cell (loads/discharges/vessels null, suppressed false), so no cell points at one listing.
// These helpers are pure (parse, rank, zone shares, pin sizes) so the pages and the contract check share one definition.

export interface PdaPortTouch {
  locode: string;
  name: string;
  country: string | null;
  zone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** null when suppressed (1 … minimumCohort-1 listings or vessels) */
  touches: number | null;
  /** null when suppressed, and null when the breakdown is withheld (a cell of 1 … minimumCohort-1) */
  loads: number | null;
  discharges: number | null;
  vessels: number | null;
  suppressed: boolean;
}

export interface PdaPortCensus {
  asOf: string;
  minimumCohort: number;
  ports: PdaPortTouch[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

export function parsePdaPortCensus(raw: unknown): PdaPortCensus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ports = Array.isArray(r.ports) ? r.ports : [];
  return {
    asOf: str(r.asOf) ?? "",
    minimumCohort: num(r.minimumCohort) ?? 3,
    ports: ports.map((item) => {
      const p = (item ?? {}) as Record<string, unknown>;
      const suppressed = p.suppressed === true;
      return {
        locode: String(p.locode ?? ""),
        name: String(p.name ?? p.locode ?? ""),
        country: str(p.country),
        zone: str(p.zone),
        latitude: num(p.latitude),
        longitude: num(p.longitude),
        touches: suppressed ? null : num(p.touches),
        loads: suppressed ? null : num(p.loads),
        discharges: suppressed ? null : num(p.discharges),
        vessels: suppressed ? null : num(p.vessels),
        suppressed,
      };
    }).filter((p) => p.locode),
  };
}

/** The port's role among the listings that touch it, in the design's words. */
export function touchRole(p: PdaPortTouch): "load" | "discharge" | "both" | "vessels" | "none" | "suppressed" | "touched" {
  if (p.suppressed) return "suppressed";
  if ((p.touches ?? 0) > 0 && p.loads == null && p.discharges == null && p.vessels == null) return "touched";
  const loads = p.loads ?? 0;
  const discharges = p.discharges ?? 0;
  if (loads && discharges) return "both";
  if (loads) return "load";
  if (discharges) return "discharge";
  return (p.vessels ?? 0) > 0 ? "vessels" : "none";
}

export const TOUCH_ROLE_LABEL: Record<ReturnType<typeof touchRole>, string> = {
  load: "loads here", discharge: "discharges here", both: "loads and discharges", vessels: "vessels open here", none: "no live listing", suppressed: "fewer than 3 listings",
  touched: "live listings touch it (breakdown withheld)",
};

/** Rank by touches (suppressed and zero ports have none); ties by name. */
export function rankedPorts(census: PdaPortCensus): Array<PdaPortTouch & { rank: number | null }> {
  const sorted = [...census.ports].sort((a, b) => (b.touches ?? -1) - (a.touches ?? -1) || a.name.localeCompare(b.name));
  let rank = 0;
  return sorted.map((p) => ({ ...p, rank: p.touches != null && p.touches > 0 ? ++rank : null }));
}

export const targetedCount = (census: PdaPortCensus) => census.ports.filter((p) => (p.touches ?? 0) > 0 || p.suppressed).length;
export const totalTouches = (census: PdaPortCensus) => census.ports.reduce((n, p) => n + (p.touches ?? 0), 0);

/** Touches per zone, suppressed ports counted as "at least 1" is NOT done: only reported counts add up. */
export function zoneShares(census: PdaPortCensus): Array<{ zone: string; touches: number; ports: number }> {
  const by = new Map<string, { touches: number; ports: number }>();
  for (const p of census.ports) {
    if (!p.zone) continue;
    const z = by.get(p.zone) ?? { touches: 0, ports: 0 };
    z.touches += p.touches ?? 0;
    z.ports += 1;
    by.set(p.zone, z);
  }
  return [...by.entries()].map(([zone, v]) => ({ zone, ...v })).sort((a, b) => b.touches - a.touches || a.zone.localeCompare(b.zone));
}

/** Pin diameter on the map: 9 px for an untouched port, up to 22 px for the most touched; suppressed ports sit at 11. */
export function pinSize(p: PdaPortTouch, max: number): number {
  if (p.suppressed) return 11;
  const t = p.touches ?? 0;
  if (t <= 0 || max <= 0) return 9;
  return Math.round(9 + 13 * Math.sqrt(t / max));
}

export const maxTouches = (census: PdaPortCensus) => census.ports.reduce((m, p) => Math.max(m, p.touches ?? 0), 0);

export type PortSortKey = "rank" | "name" | "country" | "zone";

/** Search (name, LOCODE, country, zone) and sort for the directory. */
export function filterDirectory(census: PdaPortCensus, query: string, zone: string | null, sort: PortSortKey, desc: boolean) {
  const q = query.trim().toLowerCase();
  const rows = rankedPorts(census).filter((p) => {
    if (zone && p.zone !== zone) return false;
    if (!q) return true;
    return [p.name, p.locode, p.country ?? "", p.zone ?? ""].join(" ").toLowerCase().includes(q);
  });
  const cmp = (a: typeof rows[number], b: typeof rows[number]) => {
    switch (sort) {
      case "name": return a.name.localeCompare(b.name);
      case "country": return (a.country ?? "").localeCompare(b.country ?? "") || a.name.localeCompare(b.name);
      case "zone": return (a.zone ?? "").localeCompare(b.zone ?? "") || a.name.localeCompare(b.name);
      default: return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
    }
  };
  rows.sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
  return rows;
}
