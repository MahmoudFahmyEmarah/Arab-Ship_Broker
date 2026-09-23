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

// Same boxes as the migration (20260909160000) — one truth for both layers.
// Each box covers only the INNER part of the passage, so a route that merely
// calls at a port on the passage (Port Said, Adabiya, Istanbul, Canakkale,
// Tangier, Mina Saqr) is not counted as a transit — only a route that goes
// through the narrows is.
export const CHOKEPOINT_BOXES: { cp: string; label: string; lat0: number; lat1: number; lon0: number; lon1: number }[] = [
  { cp: "SUEZ", label: "Suez Canal", lat0: 30.15, lat1: 31.05, lon0: 32.2, lon1: 32.7 },
  { cp: "BOSPHORUS", label: "Bosphorus", lat0: 41.07, lat1: 41.22, lon0: 28.98, lon1: 29.18 },
  { cp: "DARDANELLES", label: "Dardanelles", lat0: 40.2, lat1: 40.45, lon0: 26.45, lon1: 26.75 },
  { cp: "BAB_EL_MANDEB", label: "Bab-el-Mandeb", lat0: 12.3, lat1: 13.2, lon0: 43.0, lon1: 43.8 },
  { cp: "HORMUZ", label: "Strait of Hormuz", lat0: 26.3, lat1: 26.75, lon0: 56.2, lon1: 56.8 },
  { cp: "GIBRALTAR", label: "Strait of Gibraltar", lat0: 35.85, lat1: 36.05, lon0: -5.72, lon1: -5.52 },
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

/**
 * Which side of the Suez Canal a point lies on. "S" = the Red Sea and every
 * sea reached through it (Gulf of Aden, East Africa, the Gulf incl. its head
 * at 30.5N, Indian Ocean, Far East); everything else — Med, Black Sea,
 * Atlantic, Northern Europe, the Americas, West Africa — is "N". Suez town
 * (29.97N 32.55E) and Aqaba are S; Port Said (31.25N) is N.
 *
 * Used only to DROP a claimed transit: two ports on the same side cannot
 * have transited the canal, whatever a box test or a stored tag says. It never
 * adds one, so a Cape-route pair (both "cross-side") still relies on geometry.
 */
export function suezSideOf(p: LL): "N" | "S" {
  const [lat, lon] = p;
  if (lon >= 60) return "S";
  if (lon >= 44 && lat <= 31) return "S";      // the Gulf up to Shatt al-Arab
  if (lon >= 32.3 && lat <= 30.0) return "S";  // Red Sea, Gulf of Suez / Aqaba
  return "N";
}

/** A Suez transit is only plausible when the two ends sit on opposite sides. */
export function suezPlausible(line: LL[]): boolean {
  if (line.length < 2) return false;
  return suezSideOf(line[0]) !== suezSideOf(line[line.length - 1]);
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
  // Owner's rule (12 Sep 2026): a same-side pair — Sfax → Port Said, Jeddah →
  // Aqaba — never shows a canal transit, whatever the stored tag or a box test
  // says. Geography is the final word.
  if (cps.has("SUEZ") && !suezPlausible(line)) cps.delete("SUEZ");
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
