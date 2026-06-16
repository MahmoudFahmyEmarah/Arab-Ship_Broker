// Curated regional sea-lane graph — a hand-placed network of open-water nodes
// connected by water-only edges, routed with Dijkstra. This is the PRIMARY
// router for the platform's trading region (Med · Black Sea · Aegean · Levant ·
// Adriatic · Red Sea · Gulf · near Atlantic), because searoute-js's bundled
// global network is unreliable through the Bosphorus/Dardanelles and returned no
// route for most Black Sea ↔ E.Med pairs — silently falling back to a corridor
// that cut across land.
//
// Every node sits in open water (or a strait/river-mouth approach); every edge is
// a navigable water passage. A port connects to its nearest node by a short hop,
// so any port→port route follows water through the right chokepoints.
export type LL = [number, number];

// ── Nodes (lat, lon), all open water / strait approaches ───────────────────
const N: Record<string, LL> = {
  // Danube mouth (inland river ports route to the sea via Sulina)
  SULINA: [45.05, 29.95],
  // Black Sea
  BS_SULINA: [44.60, 30.30], BS_ODESSA: [46.00, 31.20], BS_NW: [44.20, 30.40],
  BS_W: [43.00, 29.20], BS_BOSP: [41.70, 29.30], BS_C: [43.40, 33.50],
  BS_KERCH: [44.55, 36.30], BS_E: [44.20, 38.20], BS_SE: [42.10, 40.60], BS_S: [42.30, 35.40],
  // Bosphorus · Marmara · Dardanelles
  BOSP_N: [41.22, 29.13], BOSP_S: [41.00, 29.00], MARMARA: [40.70, 28.20],
  IZMIT: [40.72, 29.45], DARD_N: [40.35, 26.55], DARD_S: [40.02, 26.18],
  // Aegean
  AEG_N: [39.60, 25.00], SALONICA: [40.00, 24.10], AEG_C: [38.10, 24.70],
  AEG_S: [37.00, 25.40], AEG_SE: [36.30, 27.40],
  // South Anatolia coast (open water S of Turkey)
  STK_W: [36.05, 28.95], STK_ANT: [35.85, 31.20], STK_C: [35.75, 33.20],
  STK_MER: [36.05, 34.30], LEV_ISK: [36.10, 35.55],
  // Levant
  LEV_LTK: [35.10, 35.75], LEV_S: [33.40, 34.90],
  // Cyprus
  CYP_W: [34.90, 32.20], CYP_S: [34.40, 33.40], CYP_E: [35.10, 34.40],
  // E.Med basin / Nile delta
  EMED_C: [34.00, 30.50], EMED_NILE: [32.10, 30.40],
  // Suez · Red Sea · Gulf  (GSUEZ + SINAI_S round the Sinai peninsula so
  // Gulf-of-Suez ↔ Gulf-of-Aqaba ↔ open Red Sea never cut across Sinai)
  PSAID: [31.55, 32.35], SUEZ_N: [30.30, 32.40], SUEZ_S: [29.85, 32.55],
  GSUEZ: [28.40, 33.30], SINAI_S: [27.55, 34.25],
  AQABA: [28.60, 34.70], RS_N: [27.00, 35.40], RS_C: [20.50, 38.50],
  RS_S: [15.50, 41.50], BAB: [12.60, 43.40], ADEN: [12.40, 46.50],
  ARAB_SEA: [14.00, 57.00], HORMUZ: [25.40, 56.90], AG_C: [26.50, 52.30], AG_N: [29.20, 49.40],
  // Crete · Ionian
  CRETE_W: [35.30, 23.20], CRETE_S: [34.50, 25.00], IONIAN_S: [36.00, 19.50], IONIAN_N: [38.50, 18.40],
  // Adriatic
  OTRANTO: [40.00, 18.90], ADR_C: [42.60, 16.10], ADR_N: [44.30, 13.80],
  // C.Med
  MALTA: [35.60, 15.40], SICILY_S: [36.40, 12.90], SICILY_W: [37.60, 11.10], GABES: [34.20, 11.80],
  // W.Med
  WMED_C: [38.40, 6.00], WMED_LION: [42.00, 5.50], LIGURIA: [43.20, 8.30],
  WMED_W: [37.20, 0.50], ALBORAN: [36.00, -2.80], GIBRALTAR: [35.95, -5.55],
  // Atlantic approaches
  ATL_IB: [37.50, -9.60], ATL_CAS: [33.40, -8.40], ATL_AGADIR: [30.20, -10.10],
  BISCAY: [45.50, -7.00], ENGLISH_CH: [49.50, -3.00], NSEA: [52.50, 3.00],
  WAF_DAKAR: [14.40, -17.90], WAF_GULF: [3.50, -3.00],
};

// ── Edges (water passages) ─────────────────────────────────────────────────
const E: [string, string][] = [
  // Danube → Black Sea
  ["SULINA", "BS_SULINA"],
  // Black Sea mesh
  ["BS_SULINA", "BS_ODESSA"], ["BS_SULINA", "BS_NW"], ["BS_SULINA", "BS_C"],
  ["BS_ODESSA", "BS_NW"], ["BS_ODESSA", "BS_C"], ["BS_NW", "BS_W"], ["BS_NW", "BS_C"],
  ["BS_W", "BS_BOSP"], ["BS_W", "BS_C"], ["BS_C", "BS_KERCH"], ["BS_C", "BS_E"],
  ["BS_C", "BS_S"], ["BS_C", "BS_SE"], ["BS_C", "BS_BOSP"], ["BS_KERCH", "BS_E"],
  ["BS_E", "BS_SE"], ["BS_E", "BS_S"], ["BS_SE", "BS_S"], ["BS_S", "BS_BOSP"],
  // Straits
  ["BS_BOSP", "BOSP_N"], ["BOSP_N", "BOSP_S"], ["BOSP_S", "MARMARA"],
  ["MARMARA", "IZMIT"], ["MARMARA", "DARD_N"], ["DARD_N", "DARD_S"], ["DARD_S", "AEG_N"],
  // Aegean
  ["AEG_N", "AEG_C"], ["AEG_N", "SALONICA"], ["AEG_C", "SALONICA"], ["AEG_C", "AEG_S"],
  // NOTE: no direct AEG_S→IONIAN_S edge — that chord clips the Peloponnese.
  // Aegean→Ionian must route south of Crete via CRETE_W.
  ["AEG_S", "AEG_SE"], ["AEG_S", "CRETE_W"],
  // South Anatolia coast → Levant
  ["AEG_SE", "STK_W"], ["STK_W", "STK_ANT"], ["STK_ANT", "STK_C"], ["STK_C", "STK_MER"],
  ["STK_MER", "LEV_ISK"], ["STK_MER", "CYP_W"], ["LEV_ISK", "LEV_LTK"],
  ["LEV_LTK", "LEV_S"], ["LEV_LTK", "CYP_E"],
  // Cyprus
  ["CYP_W", "CYP_S"], ["CYP_S", "CYP_E"], ["CYP_W", "EMED_C"], ["CYP_S", "EMED_C"], ["CYP_S", "LEV_S"],
  // E.Med basin / Nile / Suez
  ["EMED_C", "CRETE_S"], ["EMED_C", "EMED_NILE"], ["EMED_C", "PSAID"],
  ["EMED_NILE", "PSAID"], ["EMED_NILE", "CRETE_S"], ["LEV_S", "EMED_NILE"], ["LEV_S", "PSAID"],
  // Crete · Ionian
  ["CRETE_W", "CRETE_S"], ["CRETE_W", "IONIAN_S"], ["IONIAN_S", "IONIAN_N"],
  ["IONIAN_S", "MALTA"], ["IONIAN_N", "OTRANTO"], ["IONIAN_N", "MALTA"],
  // Adriatic
  ["OTRANTO", "ADR_C"], ["ADR_C", "ADR_N"],
  // Suez · Red Sea · Gulf  (round Sinai: Suez→GSUEZ→SINAI_S→{Aqaba, open Red Sea})
  ["PSAID", "SUEZ_N"], ["SUEZ_N", "SUEZ_S"], ["SUEZ_S", "GSUEZ"], ["GSUEZ", "SINAI_S"],
  ["SINAI_S", "AQABA"], ["SINAI_S", "RS_N"], ["RS_N", "RS_C"], ["RS_C", "RS_S"], ["RS_S", "BAB"], ["BAB", "ADEN"],
  ["ADEN", "ARAB_SEA"], ["ARAB_SEA", "HORMUZ"], ["HORMUZ", "AG_C"], ["AG_C", "AG_N"],
  // C.Med
  ["MALTA", "SICILY_S"], ["MALTA", "GABES"], ["SICILY_S", "SICILY_W"], ["SICILY_S", "GABES"],
  ["SICILY_W", "WMED_C"], ["SICILY_W", "GABES"],
  // W.Med
  ["WMED_C", "WMED_LION"], ["WMED_C", "LIGURIA"], ["WMED_C", "WMED_W"], ["WMED_LION", "LIGURIA"],
  ["WMED_W", "ALBORAN"], ["ALBORAN", "GIBRALTAR"],
  // Atlantic
  ["GIBRALTAR", "ATL_IB"], ["GIBRALTAR", "ATL_CAS"], ["ATL_IB", "BISCAY"], ["ATL_IB", "ATL_CAS"],
  ["ATL_CAS", "ATL_AGADIR"], ["ATL_AGADIR", "WAF_DAKAR"], ["WAF_DAKAR", "WAF_GULF"],
  ["BISCAY", "ENGLISH_CH"], ["ENGLISH_CH", "NSEA"],
];

const R = 3440.065; // earth radius in NM
function nm(a: LL, b: LL): number {
  const toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const la1 = a[0] * toR, la2 = b[0] * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// adjacency: node -> [{to, w}]
const ADJ: Record<string, { to: string; w: number }[]> = {};
for (const [a, b] of E) {
  if (!N[a] || !N[b]) continue;
  const w = nm(N[a], N[b]);
  (ADJ[a] = ADJ[a] || []).push({ to: b, w });
  (ADJ[b] = ADJ[b] || []).push({ to: a, w });
}

const NAMES = Object.keys(N);
function nearestNode(ll: LL): { name: string; d: number } {
  let best = NAMES[0], bd = Infinity;
  for (const name of NAMES) {
    const d = nm(ll, N[name]);
    if (d < bd) { bd = d; best = name; }
  }
  return { name: best, d: bd };
}

function dijkstra(src: string, dst: string): string[] | null {
  const dist: Record<string, number> = { [src]: 0 };
  const prev: Record<string, string> = {};
  const seen = new Set<string>();
  const pq: { n: string; d: number }[] = [{ n: src, d: 0 }];
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { n } = pq.shift()!;
    if (n === dst) break;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const { to, w } of ADJ[n] || []) {
      const nd = (dist[n] ?? Infinity) + w;
      if (nd < (dist[to] ?? Infinity)) {
        dist[to] = nd; prev[to] = n;
        pq.push({ n: to, d: nd });
      }
    }
  }
  if (dist[dst] == null) return null;
  const path: string[] = [];
  let cur: string | undefined = dst;
  while (cur) { path.unshift(cur); cur = prev[cur]; }
  return path;
}

// A port farther than this from ANY node is out of the curated region → caller
// falls back to searoute/arc. Generous so all Med/Black Sea/Red Sea ports attach.
const MAX_CONNECT_NM = 500;

export interface SeaGraphResult { pts: LL[]; nm: number }

// Water-only route between two ports via the curated graph. Returns null when a
// port is out of region or the graph can't connect the pair (→ caller fallback).
export function seaGraphRoute(polLL: LL, podLL: LL): SeaGraphResult | null {
  const a = nearestNode(polLL), b = nearestNode(podLL);
  if (a.d > MAX_CONNECT_NM || b.d > MAX_CONNECT_NM) return null;
  // Same access node = same small basin → let the caller's gentle arc handle it
  // (routing out to the shared node and back would be a V-shaped detour).
  if (a.name === b.name) return null;
  const nodePath = dijkstra(a.name, b.name);
  if (!nodePath) return null;
  const pts: LL[] = [polLL, ...nodePath.map((n) => N[n]), podLL];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += nm(pts[i - 1], pts[i]);
  return { pts, nm: total };
}
