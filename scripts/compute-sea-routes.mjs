// Computed sea routes over the open MARNET maritime network (Eurostat, via
// the searoute-js package already bundled with the app — EUPL-1.2), with our
// own Dijkstra and port connectors, CALIBRATED against the platform's
// ECDIS-measured routes (port_routes, method ECDIS*).
//
// Modes:
//   --validate   hold out 40 ECDIS routes, calibrate corridor factors on the
//                rest, score the holdout cold; prints the error distribution.
//                Writes nothing.
//   --fill-lanes compute + insert routes for live cargo lanes that have no
//                measured route (with geometry), method MARNET-COMPUTED.
//   --fill-matrix distance-only rows for every remaining pair of active
//                curated ports. Never touches existing rows.
//
// Every computed figure is stored with method='MARNET-COMPUTED',
// verified=false and source='MARNET network (calibrated)' — the UI labels
// them "est." and they are never allowed to overwrite a measured route.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODE = process.argv[2] ?? "--validate";

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const BASE = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathq, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${pathq}`, { ...init, headers: { ...H, ...init.headers } });
  if (!res.ok) throw new Error(`${pathq.slice(0, 80)}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// PostgREST caps every response at max-rows (1000) — page through everything.
async function restAll(pathq, page = 1000) {
  const sep = pathq.includes("?") ? "&" : "?";
  const out = [];
  for (let offset = 0; ; offset += page) {
    const batch = await rest(`${pathq}${sep}limit=${page}&offset=${offset}`);
    out.push(...batch);
    if (batch.length < page) return out;
  }
}

// ── geometry ────────────────────────────────────────────────────────────────
const R_NM = 3440.065;
const rad = (d) => (d * Math.PI) / 180;
function gcNm(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── build the graph: MARNET + our hand-built regional sea graph ─────────────
// The Corinth Canal is closed to bulk carriers — drop MARNET edges through it
// so estimates route around the Peloponnese like the real voyages do.
const CORINTH = { latMin: 37.8, latMax: 38.1, lonMin: 22.7, lonMax: 23.2 };
const inCorinth = (lat, lon) =>
  lat > CORINTH.latMin && lat < CORINTH.latMax && lon > CORINTH.lonMin && lon < CORINTH.lonMax;

async function buildGraph() {
  const net = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/searoute-js/data/marnet_densified.json"), "utf8"));
  const nodes = []; // [lat, lon]
  const key2id = new Map();
  const adj = []; // id -> [[otherId, nm], ...]
  const idFor = (lon, lat) => {
    const k = lon.toFixed(5) + "," + lat.toFixed(5);
    let id = key2id.get(k);
    if (id === undefined) {
      id = nodes.length;
      key2id.set(k, id);
      nodes.push([lat, lon]);
      adj.push([]);
    }
    return id;
  };
  const link = (a, b) => {
    const d = gcNm(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]);
    adj[a].push([b, d]);
    adj[b].push([a, d]);
  };
  // MARNET carries some LONG shortcut edges whose straight chord crosses land
  // (e.g. Cape St Vincent → Biscay, 494 NM, clipping NW Iberia). Those are
  // fine as abstract hops but wrong as drawable lines AND understate the
  // around-the-coast distance — drop them where the chord runs inland.
  // Legitimate narrow waterways the 50m landmask cannot see are exempted.
  let dropped = 0;
  for (const f of net.features) {
    const cs = f.geometry.coordinates;
    for (let i = 1; i < cs.length; i++) {
      if (inCorinth(cs[i - 1][1], cs[i - 1][0]) || inCorinth(cs[i][1], cs[i][0])) continue;
      const [lo1, la1] = cs[i - 1], [lo2, la2] = cs[i];
      const len = gcNm(la1, lo1, la2, lo2);
      if (len > 25 && !exempt((la1 + la2) / 2, (lo1 + lo2) / 2) && segmentInlandNm(la1, lo1, la2, lo2) > MAX_INLAND_NM) {
        dropped++;
        continue;
      }
      const a = idFor(lo1, la1);
      const b = idFor(lo2, la2);
      if (a !== b) link(a, b);
    }
  }
  if (dropped) console.log(`dropped ${dropped} land-crossing MARNET edges`);
  const marnetCount = nodes.length;

  // Splice the app's hand-built strait-accurate graph (Med/Black Sea/Levant/
  // Red Sea/Gulf) and cross-link its nodes to nearby MARNET nodes so routes
  // can switch networks where the regional graph knows better water.
  const sea = await import(new URL("file:///" + path.join(ROOT, "lib/portal/seaGraph.ts").replace(/\\/g, "/")).href);
  const seaId = new Map();
  for (const [name, ll] of Object.entries(sea.SEA_NODES)) {
    const id = nodes.length;
    nodes.push([ll[0], ll[1]]);
    adj.push([]);
    seaId.set(name, id);
  }
  // The hand-built graph's own long hops get the SAME land check — its
  // Atlantic edges (e.g. Cape St Vincent → Biscay, 494 NM) clip NW Iberia.
  let droppedSea = 0;
  const linkChecked = (a, b) => {
    const [la1, lo1] = nodes[a], [la2, lo2] = nodes[b];
    const len = gcNm(la1, lo1, la2, lo2);
    if (len > 25 && !exempt((la1 + la2) / 2, (lo1 + lo2) / 2) && segmentInlandNm(la1, lo1, la2, lo2) > MAX_INLAND_NM) {
      droppedSea++;
      return;
    }
    link(a, b);
  };
  for (const [a, b] of sea.SEA_EDGES) {
    if (seaId.has(a) && seaId.has(b)) linkChecked(seaId.get(a), seaId.get(b));
  }
  // cross-links: each regional node ↔ its 2 nearest MARNET nodes within 90 NM
  for (const id of seaId.values()) {
    const cand = [];
    for (let i = 0; i < marnetCount; i++) {
      const d = gcNm(nodes[id][0], nodes[id][1], nodes[i][0], nodes[i][1]);
      if (d <= 90) cand.push([i, d]);
    }
    cand.sort((x, y) => x[1] - y[1]);
    for (const [i] of cand.slice(0, 2)) linkChecked(id, i);
  }
  if (droppedSea) console.log(`dropped ${droppedSea} land-crossing regional edges`);
  return { nodes, adj };
}

// ── land mask (Natural Earth 50m) — connectors must stay on water ───────────
// Straight endpoint hops with no water check can leap across a peninsula
// (Avilés→Med straight over Iberia) and Dijkstra takes the shortcut. Each
// candidate connector is sampled every ~8 km; more than ~20 km continuously
// inland disqualifies it (short hits are chart noise in narrow straits).
const LAND_PATH = process.env.LAND_GEOJSON ||
  "C:/Users/mahmo/AppData/Local/Temp/claude/d--ASB-Projects-Arab-Shipborker-Arabshipbroker/d7e6c54f-575c-4f8a-8b22-fea9a15ea1f5/scratchpad/land50.geojson";
const LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson";
let RINGS = null;
async function loadLand() {
  if (RINGS) return;
  if (!fs.existsSync(LAND_PATH)) {
    console.log("downloading land polygons…");
    const body = await fetch(LAND_URL).then((r) => { if (!r.ok) throw new Error("land download failed"); return r.text(); });
    fs.writeFileSync(LAND_PATH, body);
  }
  const land = JSON.parse(fs.readFileSync(LAND_PATH, "utf8"));
  RINGS = [];
  for (const f of land.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const outer = poly[0];
      let minX = 180, maxX = -180, minY = 90, maxY = -90;
      for (const [x, y] of outer) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      RINGS.push({ outer, holes: poly.slice(1), minX, maxX, minY, maxY });
    }
  }
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function onLand(lat, lon) {
  for (const r of RINGS) {
    if (lon < r.minX || lon > r.maxX || lat < r.minY || lat > r.maxY) continue;
    if (inRing(lon, lat, r.outer)) {
      for (const h of r.holes) if (inRing(lon, lat, h)) return false;
      return true;
    }
  }
  return false;
}
function segmentInlandNm(aLat, aLon, bLat, bLon) {
  const total = gcNm(aLat, aLon, bLat, bLon);
  const steps = Math.max(2, Math.ceil(total / 4.3)); // ~8 km sampling
  let worst = 0, run = 0;
  for (let s = 1; s < steps; s++) {
    const f = s / steps;
    if (onLand(aLat + (bLat - aLat) * f, aLon + (bLon - aLon) * f)) {
      run += total / steps;
      if (run > worst) worst = run;
    } else run = 0;
  }
  return worst;
}
const MAX_INLAND_NM = 11; // ≈ 20 km — tolerates strait/canal chart noise only

// Narrow waterways the 50m landmask cannot see — legitimate transits.
const EXEMPT = [
  { latMin: 29.7, latMax: 31.4, lonMin: 32.0, lonMax: 32.7 },     // Suez Canal
  { latMin: 39.9, latMax: 41.5, lonMin: 26.0, lonMax: 30.0 },     // Turkish straits
  { latMin: 53.7, latMax: 54.5, lonMin: 8.8, lonMax: 10.3 },      // Kiel Canal
  { latMin: 41.0, latMax: 52.0, lonMin: -93.0, lonMax: -55.0 },   // Great Lakes + St Lawrence
  { latMin: -35.5, latMax: -31.0, lonMin: -61.5, lonMax: -56.5 }, // Paraná / La Plata
  { latMin: 28.5, latMax: 30.8, lonMin: -91.5, lonMax: -88.5 },   // Mississippi delta
];
const exempt = (lat, lon) =>
  EXEMPT.some((b) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax);

// Longest continuous inland run of a whole path, skipping exempt waterways —
// the final guard: geometry that fails this is stored distance-only. The run
// carries ACROSS waypoints (a chain of short land-crossing segments is as
// wrong as one long one), so it is sampled continuously like the audit.
function pathInlandNm(pts) {
  let worst = 0, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [aLat, aLon] = pts[i - 1], [bLat, bLon] = pts[i];
    const total = gcNm(aLat, aLon, bLat, bLon);
    const steps = Math.max(1, Math.ceil(total / 4.3)); // ~8 km sampling
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const lat = aLat + (bLat - aLat) * f, lon = aLon + (bLon - aLon) * f;
      if (!exempt(lat, lon) && onLand(lat, lon)) {
        run += total / steps;
        if (run > worst) worst = run;
      } else run = 0;
    }
  }
  return worst;
}

// ── min-heap Dijkstra with land-aware endpoint connectors ───────────────────
const connectorCache = new Map();
function nearestNodes(graph, lat, lon, k = 6, maxNm = 400) {
  const key = lat.toFixed(3) + "," + lon.toFixed(3);
  const hit = connectorCache.get(key);
  if (hit) return hit;
  const cand = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    const d = gcNm(lat, lon, graph.nodes[i][0], graph.nodes[i][1]);
    if (d <= maxNm) cand.push([i, d]);
  }
  cand.sort((x, y) => x[1] - y[1]);
  // keep the k nearest WATER-ONLY connectors (scan up to 40 candidates);
  // if none stays wet, fall back to the nearest few so a route still exists.
  const clean = [];
  for (const [i, d] of cand.slice(0, 40)) {
    if (segmentInlandNm(lat, lon, graph.nodes[i][0], graph.nodes[i][1]) <= MAX_INLAND_NM) {
      clean.push([i, d]);
      if (clean.length >= k) break;
    }
  }
  const out = clean.length ? clean : cand.slice(0, 2);
  connectorCache.set(key, out);
  return out;
}

function route(graph, aLat, aLon, bLat, bLon) {
  const startC = nearestNodes(graph, aLat, aLon);
  const endC = nearestNodes(graph, bLat, bLon);
  if (!startC.length || !endC.length) return null;
  const endMap = new Map(endC);
  const N = graph.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  // binary heap of [distance, id]
  const heap = [[0, -2]]; // sentinel replaced below
  heap.length = 0;
  const push = (d, id) => {
    heap.push([d, id]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  for (const [id, d] of startC) { dist[id] = d; push(d, id); }
  // best terminal: node in endMap minimizing dist[node] + hop to B
  let best = Infinity, bestEnd = -1;
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (d > best) break;
    const endHop = endMap.get(u);
    if (endHop !== undefined && d + endHop < best) { best = d + endHop; bestEnd = u; }
    for (const [v, w] of graph.adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
    }
  }
  if (bestEnd < 0) return null;
  const pathIds = [];
  for (let u = bestEnd; u !== -1; u = prev[u]) pathIds.push(u);
  pathIds.reverse();
  const pts = [[aLat, aLon], ...pathIds.map((i) => graph.nodes[i]), [bLat, bLon]];
  return { nm: best, pts };
}

// Shape-preserving simplification (Douglas–Peucker). Uniform sampling is NOT
// safe here — deleting coastal waypoints straightens the line across land.
// Distances in degree-space with longitude scaled by cos(mid-latitude);
// epsilon 0.01° ≈ 1 km keeps strait/coast fidelity.
function simplify(pts, epsilon = 0.01) {
  if (pts.length <= 2) return pts;
  const midLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const perp = (p, a, b) => {
    const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0], px = p[1] * kx, py = p[0];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = 0, maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perp(pts[i], pts[i0], pts[i1]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > epsilon && maxI > 0) {
      keep[maxI] = true;
      stack.push([i0, maxI], [maxI, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// deterministic shuffle (LCG, fixed seed) for a reproducible holdout
function seededShuffle(arr, seed = 42) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  await loadLand();
  console.log("building MARNET graph…");
  const graph = await buildGraph();
  console.log(`graph: ${graph.nodes.length} nodes`);

  // ECDIS ground truth: endpoints straight from each route's own waypoints
  const measured = await restAll("port_routes?select=id,pol_locode,pod_locode,total_nm,method&method=like.ECDIS*");
  const ends = new Map(); // route id -> {aLat,aLon,bLat,bLon}
  {
    const wps = await restAll("port_route_waypoints?select=route_id,seq,latitude,longitude&order=route_id,seq");
    const byRoute = new Map();
    for (const w of wps) {
      let r = byRoute.get(w.route_id);
      if (!r) byRoute.set(w.route_id, (r = []));
      r.push(w);
    }
    for (const [id, list] of byRoute) {
      const a = list[0], b = list[list.length - 1];
      ends.set(id, { aLat: +a.latitude, aLon: +a.longitude, bLat: +b.latitude, bLon: +b.longitude });
    }
  }
  const truth = measured.filter((m) => ends.has(m.id));
  console.log(`ECDIS ground truth: ${truth.length} routes with endpoints`);

  // zones per locode for corridor calibration
  const ports = await rest("ports?select=locode,zone,latitude,longitude,is_active&limit=1000");
  const zoneOf = new Map(ports.map((p) => [p.locode, p.zone]));
  zoneOf.set("RUNVS", zoneOf.get("RUNOI") ?? "B.SEA");
  zoneOf.set("UARNI", zoneOf.get("UAREN") ?? "B.SEA");
  const corridor = (r) => [zoneOf.get(r.pol_locode) ?? "?", zoneOf.get(r.pod_locode) ?? "?"].sort().join("~");

  // compute all ground-truth pairs once
  console.log("computing all ECDIS pairs over the network…");
  const computed = new Map(); // route id -> nm
  let unroutable = 0;
  for (const m of truth) {
    const e = ends.get(m.id);
    const r = route(graph, e.aLat, e.aLon, e.bLat, e.bLon);
    if (!r) { unroutable++; continue; }
    computed.set(m.id, r.nm);
  }
  console.log(`computed: ${computed.size}/${truth.length} (unroutable: ${unroutable})`);

  // ── calibration + holdout validation ──
  const usable = truth.filter((m) => computed.has(m.id));
  const shuffled = seededShuffle(usable);
  const holdout = MODE === "--validate" ? shuffled.slice(0, 40) : [];
  const calib = MODE === "--validate" ? shuffled.slice(40) : shuffled;

  const byCorridor = new Map();
  const allRatios = [];
  for (const m of calib) {
    const ratio = m.total_nm / computed.get(m.id);
    if (ratio < 0.5 || ratio > 2) continue; // guard against endpoint pathologies
    allRatios.push(ratio);
    const c = corridor(m);
    if (!byCorridor.has(c)) byCorridor.set(c, []);
    byCorridor.get(c).push(ratio);
  }
  const globalFactor = median(allRatios);
  const factors = new Map();
  for (const [c, rs] of byCorridor) if (rs.length >= 3) factors.set(c, median(rs));
  const factorFor = (r) => factors.get(corridor(r)) ?? globalFactor;
  console.log(`calibration: global factor ${globalFactor.toFixed(4)} · ${factors.size} corridor factors (from ${calib.length} routes)`);

  if (MODE === "--validate") {
    const rawErr = [], calErr = [];
    const rows = [];
    for (const m of holdout) {
      const raw = computed.get(m.id);
      const cal = raw * factorFor(m);
      rawErr.push(Math.abs(raw - m.total_nm) / m.total_nm * 100);
      calErr.push(Math.abs(cal - m.total_nm) / m.total_nm * 100);
      rows.push({ pair: `${m.pol_locode}→${m.pod_locode}`, ecdis: m.total_nm, raw: +raw.toFixed(0), cal: +cal.toFixed(0), errPct: +(Math.abs(cal - m.total_nm) / m.total_nm * 100).toFixed(1) });
    }
    rows.sort((a, b) => b.errPct - a.errPct);
    console.log("\n── HOLDOUT VALIDATION (40 ECDIS routes, computed cold) ──");
    console.log(`raw error:        median ${median(rawErr).toFixed(1)}% · p75 ${pct(rawErr, 75).toFixed(1)}% · p90 ${pct(rawErr, 90).toFixed(1)}% · max ${Math.max(...rawErr).toFixed(1)}%`);
    console.log(`calibrated error: median ${median(calErr).toFixed(1)}% · p75 ${pct(calErr, 75).toFixed(1)}% · p90 ${pct(calErr, 90).toFixed(1)}% · max ${Math.max(...calErr).toFixed(1)}%`);
    console.log("worst 8 (calibrated):");
    for (const r of rows.slice(0, 8)) console.log(`  ${r.pair}: ECDIS ${r.ecdis} vs computed ${r.cal} (${r.errPct}%)`);
    return;
  }

  // ── fill modes (calibrated with ALL ECDIS routes) ──
  const pairKey = (a, b) => [a, b].sort().join("|");
  const existing = new Set((await restAll("port_routes?select=pair_key")).map((r) => r.pair_key));
  const aliasRows = await rest("port_route_alias?select=alias,canonical&limit=200");
  const ALIAS = new Map(aliasRows.map((r) => [r.alias, r.canonical]));
  const canon = (l) => ALIAS.get(l) ?? l;
  const portByLocode = new Map(ports.filter((p) => p.latitude != null).map((p) => [p.locode, p]));
  const coordFor = (locode) => {
    // routes store canonical codes; coords live under the curated variant
    if (portByLocode.has(locode)) return portByLocode.get(locode);
    const back = aliasRows.find((r) => r.canonical === locode && portByLocode.has(r.alias));
    return back ? portByLocode.get(back.alias) : null;
  };
  const factorForZones = (za, zb) => factors.get([za ?? "?", zb ?? "?"].sort().join("~")) ?? globalFactor;

  const insertRoutes = async (rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      await rest("port_routes?on_conflict=pair_key", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
    }
  };

  if (MODE === "--fill-lanes") {
    const cargo = await restAll("cargo_listings?select=load_port_locode,disch_port_locode&load_port_locode=not.is.null&disch_port_locode=not.is.null");
    const lanes = new Map();
    for (const c of cargo) {
      const a = canon(c.load_port_locode), b = canon(c.disch_port_locode);
      if (a === b || existing.has(pairKey(a, b))) continue;
      lanes.set(pairKey(a, b), [a, b]);
    }
    console.log(`live lanes missing a route: ${lanes.size}`);
    const rows = [], geo = new Map();
    let failed = [], geoRejected = [];
    for (const [key, [a, b]] of lanes) {
      const pa = coordFor(a), pb = coordFor(b);
      if (!pa || !pb) { failed.push(`${a}-${b} (no coords)`); continue; }
      const r = route(graph, +pa.latitude, +pa.longitude, +pb.latitude, +pb.longitude);
      if (!r) { failed.push(`${a}-${b} (unroutable)`); continue; }
      const nm = +(r.nm * factorForZones(pa.zone ?? zoneOf.get(a), pb.zone ?? zoneOf.get(b))).toFixed(1);
      rows.push({ pol_locode: a, pod_locode: b, total_nm: nm, computed_nm: +r.nm.toFixed(1), waypoint_count: 0, source: "MARNET network (calibrated)", method: "MARNET-COMPUTED", verified: false });
      // Final guard: never store a drawable track that runs inland (outside
      // exempt canals/rivers). The distance row stays; the map falls back to
      // its dashed corridor estimate instead of drawing a wrong line.
      const pts = simplify(r.pts);
      const inland = pathInlandNm(pts);
      if (inland > 15) { geoRejected.push(`${a}-${b} (${Math.round(inland * 1.852)} km inland)`); continue; }
      geo.set(key, pts);
    }
    await insertRoutes(rows);
    // waypoints for the inserted rows
    const inserted = await restAll(`port_routes?select=id,pair_key&method=eq.MARNET-COMPUTED`);
    const wpBuf = [];
    for (const ins of inserted) {
      const pts = geo.get(ins.pair_key);
      if (!pts) continue;
      pts.forEach((p, i) => wpBuf.push({ route_id: ins.id, seq: i + 1, latitude: +p[0].toFixed(6), longitude: +p[1].toFixed(6), cumulative_nm: null }));
    }
    for (let i = 0; i < wpBuf.length; i += 3000)
      await rest("port_route_waypoints?on_conflict=route_id,seq", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(wpBuf.slice(i, i + 3000)) });
    // set waypoint_count
    for (const ins of inserted) {
      const pts = geo.get(ins.pair_key);
      if (pts) await rest(`port_routes?id=eq.${ins.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ waypoint_count: pts.length }) });
    }
    console.log(`inserted ${rows.length} computed lane routes · geometry withheld (land-crossing): ${geoRejected.length} ${JSON.stringify(geoRejected)}`);
    console.log(`failed: ${failed.length} ${JSON.stringify(failed.slice(0, 10))}`);
    return;
  }

  if (MODE === "--fill-matrix") {
    const active = ports.filter((p) => p.is_active && p.latitude != null);
    console.log(`active curated ports with coords: ${active.length}`);
    const rows = [];
    let unroutableCt = 0, done = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = canon(active[i].locode), b = canon(active[j].locode);
        if (a === b || existing.has(pairKey(a, b))) continue;
        const r = route(graph, +active[i].latitude, +active[i].longitude, +active[j].latitude, +active[j].longitude);
        if (!r) { unroutableCt++; continue; }
        const nm = +(r.nm * factorForZones(active[i].zone, active[j].zone)).toFixed(1);
        rows.push({ pol_locode: a, pod_locode: b, total_nm: nm, computed_nm: +r.nm.toFixed(1), waypoint_count: 0, source: "MARNET network (calibrated)", method: "MARNET-COMPUTED", verified: false });
      }
      done++;
      if (done % 20 === 0) process.stdout.write(`  ${done}/${active.length} ports · ${rows.length} pairs computed\r`);
    }
    console.log(`\npairs to insert: ${rows.length} · unroutable: ${unroutableCt}`);
    await insertRoutes(rows);
    console.log("matrix fill complete.");
    return;
  }
})();
