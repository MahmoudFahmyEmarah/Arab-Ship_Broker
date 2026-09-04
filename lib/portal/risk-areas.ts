// Risk areas + route alerts — pure geometry, shared by the market map and
// (later) the voyage estimator.
//
// A route is a [lat, lon] polyline. An area is a [lat, lon] ring drawn by an
// admin (public.risk_areas). "Crosses" = any sampled point of the route lies
// inside the ring; segments are densified so a long leg cannot jump over a
// narrow area. Chokepoints come from the stored route (port_routes.chokepoints)
// or, for routes we only estimate, from the same box test the database used.

export type LL = [number, number];
export type RiskSeverity = "war_zone" | "high_risk" | "advisory";

export interface RiskArea {
  id: string;
  name: string;
  severity: RiskSeverity;
  alertText: string | null;
  polygon: LL[];
  isActive: boolean;
}

export interface RouteAlert {
  kind: "suez" | "chokepoint" | "risk";
  severity: RiskSeverity | "cost";
  title: string;
  text: string;
  href?: string;
  areaId?: string;
}

export const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  war_zone: "War zone",
  high_risk: "High-risk area",
  advisory: "Advisory",
};

// Same boxes as the migration (20260904100000) — one truth for both layers.
export const CHOKEPOINT_BOXES: { cp: string; label: string; lat0: number; lat1: number; lon0: number; lon1: number }[] = [
  { cp: "SUEZ", label: "Suez Canal", lat0: 29.85, lat1: 31.3, lon0: 32.2, lon1: 32.7 },
  { cp: "BOSPHORUS", label: "Bosphorus", lat0: 40.95, lat1: 41.3, lon0: 28.9, lon1: 29.3 },
  { cp: "DARDANELLES", label: "Dardanelles", lat0: 40.0, lat1: 40.5, lon0: 26.1, lon1: 26.8 },
  { cp: "BAB_EL_MANDEB", label: "Bab-el-Mandeb", lat0: 12.3, lat1: 13.2, lon0: 43.0, lon1: 43.8 },
  { cp: "HORMUZ", label: "Strait of Hormuz", lat0: 25.8, lat1: 26.9, lon0: 55.7, lon1: 56.9 },
  { cp: "GIBRALTAR", label: "Strait of Gibraltar", lat0: 35.7, lat1: 36.2, lon0: -6.0, lon1: -5.2 },
];

export function pointInRing(p: LL, ring: LL[]): boolean {
  // ray casting on [lat, lon]; x = lon, y = lat
  let inside = false;
  const x = p[1], y = p[0];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0];
    const xj = ring[j][1], yj = ring[j][0];
    const hit = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Densify so no segment is longer than `stepDeg` (≈ 0.25° ≈ 15 NM). */
export function densify(line: LL[], stepDeg = 0.25): LL[] {
  const out: LL[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    if (i === 0) { out.push(a); continue; }
    const b = line[i - 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / stepDeg));
    for (let k = 1; k <= n; k++) out.push([b[0] + ((a[0] - b[0]) * k) / n, b[1] + ((a[1] - b[1]) * k) / n]);
  }
  return out;
}

export function areasCrossed(line: LL[], areas: RiskArea[]): RiskArea[] {
  if (line.length < 2 || areas.length === 0) return [];
  const pts = densify(line);
  return areas.filter((a) => a.isActive && a.polygon.length >= 3 && pts.some((p) => pointInRing(p, a.polygon)));
}

export function chokepointsFromGeometry(line: LL[]): string[] {
  if (line.length < 2) return [];
  const pts = densify(line, 0.1);
  return CHOKEPOINT_BOXES
    .filter((b) => pts.some((p) => p[0] >= b.lat0 && p[0] <= b.lat1 && p[1] >= b.lon0 && p[1] <= b.lon1))
    .map((b) => b.cp);
}

/** Build the alert list for a drawn route. `stored` = chokepoints from the DB row, if any. */
export function routeAlerts(line: LL[], areas: RiskArea[], stored?: string[] | null): RouteAlert[] {
  const cps = new Set<string>([...(stored ?? []), ...chokepointsFromGeometry(line)]);
  const out: RouteAlert[] = [];
  if (cps.has("SUEZ")) {
    out.push({
      kind: "suez",
      severity: "cost",
      title: "Suez Canal transit",
      text: "This route transits the Suez Canal — canal tolls add a significant cost to the voyage.",
      href: "/dashboard/suez-toll",
    });
  }
  for (const a of areasCrossed(line, areas)) {
    out.push({
      kind: "risk",
      severity: a.severity,
      title: `${SEVERITY_LABEL[a.severity]}: ${a.name}`,
      text: a.alertText ?? "Transiting this area adds a war-risk insurance premium.",
      areaId: a.id,
    });
  }
  // war zones first, then high risk, advisory, then cost
  const rank: Record<string, number> = { war_zone: 0, high_risk: 1, advisory: 2, cost: 3 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/** Alerts for a single position (a vessel open inside a listed area). */
export function positionAlerts(pt: LL, areas: RiskArea[]): RouteAlert[] {
  return areas
    .filter((a) => a.isActive && a.polygon.length >= 3 && pointInRing(pt, a.polygon))
    .map((a) => ({
      kind: "risk" as const,
      severity: a.severity,
      title: `Open inside ${SEVERITY_LABEL[a.severity].toLowerCase()}: ${a.name}`,
      text: a.alertText ?? "Her open position lies inside a listed area — war-risk premium applies from the start of the voyage.",
      areaId: a.id,
    }));
}

/** Prefix alert titles with the voyage leg they belong to ("Ballast leg · …"). */
export function tagLeg(alerts: RouteAlert[], leg: string): RouteAlert[] {
  return alerts.map((a) => ({ ...a, title: `${leg} · ${a.title}` }));
}

export function parseRiskAreaRow(r: { id: string; name: string; severity: string; alert_text: string | null; polygon: unknown; is_active: boolean }): RiskArea | null {
  const poly = Array.isArray(r.polygon)
    ? (r.polygon as unknown[]).map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] as LL : null)).filter((p): p is LL => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
  if (poly.length < 3) return null;
  const sev = (["war_zone", "high_risk", "advisory"].includes(r.severity) ? r.severity : "advisory") as RiskSeverity;
  return { id: r.id, name: r.name, severity: sev, alertText: r.alert_text, polygon: poly, isActive: !!r.is_active };
}
