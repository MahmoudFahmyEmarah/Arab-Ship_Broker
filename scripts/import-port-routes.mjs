// Imports the ArabShipBroker MASTER Port Routes package into port_routes /
// port_route_waypoints:
//   1. The 430-pair distance matrix (workbook 05_BUILD_430_PAIRS) — total_nm
//      is the authoritative measured figure.
//   2. Route geometry from the 422 BVS8 ECDIS voyage-plan CSVs (waypoints in
//      degrees-minutes), with distances recomputed from the geometry as an
//      audit figure; the 20 workbook-embedded routes (02_WAYPOINTS) fill any
//      pair that lacks a CSV.
// Endpoint locodes are remapped through port_route_alias (the exports predate
// the July port dedupe). Symmetric pairs are stored once. Idempotent: re-run
// replaces the imported pairs wholesale.
//
// Usage:  node scripts/import-port-routes.mjs --dry-run
//         node scripts/import-port-routes.mjs
// Rollback: delete from port_route_waypoints; delete from port_routes;
//
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "ArabShipBroker MASTER Port Routes");
const DRY = process.argv.includes("--dry-run");

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const URL_BASE = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathq, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathq}`, { ...init, headers: { ...H, ...init.headers } });
  if (!res.ok) throw new Error(`${pathq}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// ── geometry helpers ────────────────────────────────────────────────────────
const R_NM = 3440.065; // earth radius in nautical miles
const rad = (d) => (d * Math.PI) / 180;

function greatCircleNm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Rhumb-line distance (ECDIS legs are usually RL) — differs from GC only on
// long east-west runs; both supported per the Sail column.
function rhumbNm(a, b) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat);
  const Δφ = φ2 - φ1;
  let Δλ = rad(b.lon - a.lon);
  if (Math.abs(Δλ) > Math.PI) Δλ = Δλ > 0 ? Δλ - 2 * Math.PI : Δλ + 2 * Math.PI;
  const Δψ = Math.log(Math.tan(Math.PI / 4 + φ2 / 2) / Math.tan(Math.PI / 4 + φ1 / 2));
  const q = Math.abs(Δψ) > 1e-12 ? Δφ / Δψ : Math.cos(φ1);
  return Math.sqrt(Δφ * Δφ + q * q * Δλ * Δλ) * R_NM;
}

// ── BVS8 CSV parser ─────────────────────────────────────────────────────────
// //ROUTE SHEET exported by BVS8. … data rows:
// 000,25,0.600,N,055,2.820,E,***,***,***,***,***,***,***,00:00,E,
function parseBvs8(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const routeName = lines.find((l) => l.startsWith("//Route Name"))?.split(",")[2]?.trim() ?? null;
  const wps = [];
  for (const line of lines) {
    if (!line || line.startsWith("//")) continue;
    const f = line.split(",");
    if (f.length < 7 || !/^\d+$/.test(f[0].trim())) continue;
    const lat = (parseFloat(f[1]) + parseFloat(f[2]) / 60) * (f[3].trim().toUpperCase() === "S" ? -1 : 1);
    const lon = (parseFloat(f[4]) + parseFloat(f[5]) / 60) * (f[6].trim().toUpperCase() === "W" ? -1 : 1);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const sail = (f[11] ?? "").trim().toUpperCase();
    wps.push({ lat, lon, sail });
  }
  // cumulative distance: leg i = distance from wp[i-1] to wp[i], by sail type
  let cum = 0;
  const out = wps.map((w, i) => {
    if (i > 0) {
      const fn = w.sail === "GL" ? greatCircleNm : rhumbNm;
      cum += fn(wps[i - 1], w);
    }
    return { seq: i + 1, lat: +w.lat.toFixed(6), lon: +w.lon.toFixed(6), cum: +cum.toFixed(1) };
  });
  return { routeName, waypoints: out, computedNm: out.length ? out[out.length - 1].cum : 0 };
}

// Hand-verified filename corrections (endpoint coordinates checked on chart):
// "GRRET- to TPNG" ends at 45.814N 13.223E = Porto Nogaro, Italy (ITPNG).
const NAME_FIXES = { "GRRET- to TPNG.csv": ["GRRET", "ITPNG"] };

// filename → [A, B] locodes; falls back to the embedded route name
function pairFromName(name, routeName) {
  if (NAME_FIXES[name]) return NAME_FIXES[name];
  const base = name.replace(/\.csv$/i, "").trim();
  for (const src of [base, routeName ?? ""]) {
    const m = src.match(/^([A-Z0-9]{5})[\s-]*to[\s-]*([A-Z0-9]{5})$/i) || src.match(/^([A-Z0-9]{5})-([A-Z0-9]{5})$/i);
    if (m) return [m[1].toUpperCase(), m[2].toUpperCase()];
  }
  return null;
}

// Second BVS8 flavor — passage-plan report: Dep/Way/Arr rows with a combined
// coordinate cell like  40°57.60'N 028°40.80'E  (any junk byte for °).
function parsePassageReport(file) {
  const lines = fs.readFileSync(file, "latin1").split(/\r?\n/);
  const wps = [];
  for (const line of lines) {
    if (!/^(Dep|Way|Arr),/i.test(line)) continue;
    const m = line.match(/(\d{1,2})[^\d]+([\d.]+)'([NS])\s+(\d{1,3})[^\d]+([\d.]+)'([EW])/);
    if (!m) continue;
    const lat = (parseInt(m[1], 10) + parseFloat(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
    const lon = (parseInt(m[4], 10) + parseFloat(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
    const sail = /,GL,/.test(line) ? "GL" : "RL";
    wps.push({ lat, lon, sail });
  }
  let cum = 0;
  return wps.map((w, i) => {
    if (i > 0) cum += (w.sail === "GL" ? greatCircleNm : rhumbNm)(wps[i - 1], w);
    return { seq: i + 1, lat: +w.lat.toFixed(6), lon: +w.lon.toFixed(6), cum: +cum.toFixed(1) };
  });
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  // alias map from the DB (single source of truth, seeded by the migration)
  const aliasRows = await rest("port_route_alias?select=alias,canonical&limit=200");
  const ALIAS = new Map(aliasRows.map((r) => [r.alias, r.canonical]));
  const canon = (l) => ALIAS.get(l) ?? l;
  const pairKey = (a, b) => [a, b].sort().join("|");

  // 1 · workbook matrix + embedded geometry
  const wb = XLSX.read(fs.readFileSync(path.join(DIR, "ArabShipBroker MASTER Port Routes.xlsx")), { type: "buffer" });
  const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets["05_BUILD_430_PAIRS"], { header: 1, defval: null })
    .slice(3)
    .filter((r) => r[2] && r[5] && r[9] != null)
    .map((r) => ({
      pol: canon(String(r[2]).trim().toUpperCase()),
      pod: canon(String(r[5]).trim().toUpperCase()),
      timesTraded: r[8] != null ? Number(r[8]) : null,
      totalNm: Number(r[9]),
      method: r[10] ? String(r[10]) : null,
    }))
    .filter((r) => r.pol !== r.pod && Number.isFinite(r.totalNm) && r.totalNm > 0);

  // workbook 01/02: the 20 embedded geometries, by canonical pair
  const routes01 = XLSX.utils.sheet_to_json(wb.Sheets["01_ROUTES"], { header: 1, defval: null })
    .slice(2).filter((r) => r[0]);
  const wp02 = XLSX.utils.sheet_to_json(wb.Sheets["02_WAYPOINTS"], { header: 1, defval: null })
    .slice(2).filter((r) => r[0]);
  const wbGeo = new Map(); // pairKey → waypoints
  for (const r of routes01) {
    const [polRaw, podRaw] = [String(r[1]).toUpperCase(), String(r[4]).toUpperCase()];
    const key = pairKey(canon(polRaw), canon(podRaw));
    const pts = wp02.filter((w) => w[0] === r[0])
      .map((w, i) => ({ seq: i + 1, lat: +Number(w[2]).toFixed(6), lon: +Number(w[3]).toFixed(6), cum: w[4] != null ? +Number(w[4]).toFixed(1) : null }));
    if (pts.length >= 2) wbGeo.set(key, { pol: canon(polRaw), pod: canon(podRaw), waypoints: pts, computedNm: pts[pts.length - 1].cum });
  }

  // 2 · CSV geometries
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".csv"));
  const csvGeo = new Map(); // pairKey → {pol, pod, waypoints, computedNm, file}
  const unresolved = [], tooFew = [];
  for (const f of files) {
    const parsed = parseBvs8(path.join(DIR, f));
    if (parsed.waypoints.length < 2) {
      const alt = parsePassageReport(path.join(DIR, f));
      if (alt.length >= 2) parsed.waypoints = alt;
    }
    const pair = pairFromName(f, parsed.routeName);
    if (!pair) { unresolved.push(f); continue; }
    if (parsed.waypoints.length < 2) { tooFew.push(f); continue; }
    parsed.computedNm = parsed.waypoints[parsed.waypoints.length - 1].cum;
    const [pol, pod] = [canon(pair[0]), canon(pair[1])];
    const key = pairKey(pol, pod);
    // keep the richer geometry if a pair appears twice
    const prev = csvGeo.get(key);
    if (!prev || parsed.waypoints.length > prev.waypoints.length)
      csvGeo.set(key, { pol, pod, waypoints: parsed.waypoints, computedNm: parsed.computedNm, file: f });
  }

  // 3 · merge: sheet is authoritative for distance; geometry from CSV else workbook
  const routes = new Map(); // pairKey → row
  for (const s of sheetRows) {
    const key = pairKey(s.pol, s.pod);
    const prev = routes.get(key);
    if (prev) { // duplicate pair after alias remap — keep higher trade count
      if ((s.timesTraded ?? 0) > (prev.times_traded ?? 0)) prev.times_traded = s.timesTraded;
      continue;
    }
    routes.set(key, {
      pol_locode: s.pol, pod_locode: s.pod, total_nm: s.totalNm,
      times_traded: s.timesTraded, method: s.method ?? "ECDIS-MEASURED",
      source: "ECDIS voyage plan", geometry: null,
    });
  }
  for (const [key, g] of [...csvGeo, ...wbGeo]) {
    const r = routes.get(key);
    if (r) {
      if (!r.geometry) r.geometry = g;
    } else {
      // measured geometry for a pair outside the 430 sheet — import with the
      // computed distance as the total
      routes.set(key, {
        pol_locode: g.pol, pod_locode: g.pod, total_nm: +g.computedNm.toFixed(1),
        times_traded: null, method: "ECDIS-CSV", source: "ECDIS voyage plan", geometry: g,
      });
    }
  }

  // 4 · verification + stats
  const anomalies = [];
  let withGeo = 0, distOnly = 0;
  for (const [key, r] of routes) {
    if (r.geometry) {
      withGeo++;
      // orient: geometry direction defines pol/pod for the stored row
      r.pol_locode = r.geometry.pol; r.pod_locode = r.geometry.pod;
      r.computed_nm = +Number(r.geometry.computedNm).toFixed(1);
      r.waypoint_count = r.geometry.waypoints.length;
      const dev = Math.abs(r.computed_nm - r.total_nm) / r.total_nm;
      r.verified = dev <= 0.05;
      if (dev > 0.5) {
        // A sheet figure this far off the measured geometry is a data-entry
        // error (e.g. Abu Qir→Gijón "184 NM") — the geometry wins.
        anomalies.push(`${key}: sheet ${r.total_nm} NM impossible vs geometry ${r.computed_nm} NM → using geometry`);
        r.total_nm = r.computed_nm;
      } else if (!r.verified) {
        anomalies.push(`${key}: sheet ${r.total_nm} NM vs geometry ${r.computed_nm} NM (${(dev * 100).toFixed(1)}% off)`);
      }
    } else {
      distOnly++;
      r.computed_nm = null; r.waypoint_count = 0; r.verified = false;
    }
  }

  // endpoints not in the curated ports table (report-only; lookups still work)
  const ports = await rest("ports?select=locode,is_active&limit=1000");
  const portSet = new Map(ports.map((p) => [p.locode, p.is_active]));
  const endpoints = new Set([...routes.values()].flatMap((r) => [r.pol_locode, r.pod_locode]));
  const missingPorts = [...endpoints].filter((l) => !portSet.has(l)).sort();
  const inactivePorts = [...endpoints].filter((l) => portSet.get(l) === false).sort();

  console.log(`routes to import: ${routes.size}  (with geometry: ${withGeo} · distance-only: ${distOnly})`);
  console.log(`endpoints: ${endpoints.size} | not in curated ports: ${missingPorts.length} ${JSON.stringify(missingPorts)}`);
  console.log(`endpoints still retired after remap: ${inactivePorts.length} ${JSON.stringify(inactivePorts)}`);
  console.log(`unresolved files: ${unresolved.length} ${JSON.stringify(unresolved)}`);
  if (tooFew.length) console.log(`files with <2 waypoints (skipped geometry): ${tooFew.length} ${JSON.stringify(tooFew)}`);
  console.log(`distance mismatches >5% (imported, unverified): ${anomalies.length}`);
  for (const a of anomalies.slice(0, 15)) console.log("  ·", a);
  if (anomalies.length > 15) console.log(`  · … ${anomalies.length - 15} more`);

  if (DRY) { console.log("\nDRY RUN — nothing written."); return; }

  // 5 · write: wholesale replace of the imported pairs
  await rest("port_route_waypoints?route_id=not.is.null", { method: "DELETE" });
  await rest("port_routes?id=not.is.null", { method: "DELETE" });

  const rows = [...routes.values()].map((r) => ({
    pol_locode: r.pol_locode, pod_locode: r.pod_locode, total_nm: r.total_nm,
    computed_nm: r.computed_nm, waypoint_count: r.waypoint_count,
    times_traded: r.times_traded, source: r.source, method: r.method, verified: r.verified,
  }));
  const inserted = [];
  for (let i = 0; i < rows.length; i += 200) {
    const batch = await rest("port_routes", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    inserted.push(...batch);
  }
  const idByPair = new Map(inserted.map((r) => [pairKey(r.pol_locode, r.pod_locode), r.id]));

  let wpTotal = 0;
  let wpBuf = [];
  for (const [key, r] of routes) {
    if (!r.geometry) continue;
    const id = idByPair.get(key);
    for (const w of r.geometry.waypoints)
      wpBuf.push({ route_id: id, seq: w.seq, latitude: w.lat, longitude: w.lon, cumulative_nm: w.cum });
  }
  for (let i = 0; i < wpBuf.length; i += 3000) {
    await rest("port_route_waypoints", { method: "POST", body: JSON.stringify(wpBuf.slice(i, i + 3000)) });
    wpTotal += Math.min(3000, wpBuf.length - i);
    process.stdout.write(`  waypoints ${wpTotal}/${wpBuf.length}\r`);
  }
  console.log(`\nImported ${inserted.length} routes · ${wpBuf.length} waypoints.`);
})();
