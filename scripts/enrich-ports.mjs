// Enriches the curated ports table from the official UNECE UN/LOCODE
// registry (datasets/un-locode mirror) plus local fallbacks:
//   • latitude/longitude — official registry coords, else the UN/LOCODE
//     reference list (lib/portal/ports-reference.json), else the map
//     fallback file (lib/portal/port-coords.ts). Write-once: existing
//     coordinates are never overwritten.
//   • seaward_bearing — from the map fallback file, when present and unset.
//   • unlocode_status / unlocode_function — always refreshed (registry
//     validation metadata; NULL = code not in the registry).
//
// Usage:
//   node scripts/enrich-ports.mjs --dry-run
//   node scripts/enrich-ports.mjs
// The official CSV (~7MB) is downloaded once and cached beside the script
// run (UNLOCODE_CSV env var overrides the path).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry-run");
const CSV_URL = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv";
const CSV_CACHE = process.env.UNLOCODE_CSV || path.join(os.tmpdir(), "unlocode-code-list.csv");

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const URL_BASE = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const norm = (l) => l.replace(/\s+/g, "").toUpperCase();

// Hand-sourced harbour coordinates for active ports that are absent from (or
// coordinate-less in) every automated source. Chart-level approximations.
const MANUAL_COORDS = new Map([
  ["RUTMN", { lat: 45.1215, lon: 36.6839 }], // Taman, Black Sea
  ["TRCNK", { lat: 40.1467, lon: 26.4086 }], // Canakkale, Dardanelles
  ["YESAL", { lat: 15.305, lon: 42.681 }],   // Saleef (As-Salif), Red Sea
  ["UAKIL", { lat: 45.455, lon: 29.266 }],   // Kiliya, Danube delta
]);

// "1654N 04230E" → { lat: 16.9, lon: 42.5 }
function parseCoords(s) {
  const m = /^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/.exec((s ?? "").trim());
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
  const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
  return { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 };
}

// Minimal CSV parser (handles quoted fields with commas).
function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

(async () => {
  if (!fs.existsSync(CSV_CACHE)) {
    console.log("downloading UN/LOCODE code list…");
    const body = await fetch(CSV_URL).then((r) => { if (!r.ok) throw new Error("download failed: " + r.status); return r.text(); });
    fs.writeFileSync(CSV_CACHE, body);
  }
  // registry: code → { status, function, coords }
  const registry = new Map();
  const lines = fs.readFileSync(CSV_CACHE, "utf8").split("\n");
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    if (f.length < 11 || !f[1] || !f[2]) continue;
    const entry = { status: f[6] || null, func: f[7] || null, coords: parseCoords(f[10]) };
    const k = norm(f[1] + f[2]);
    const prev = registry.get(k);
    // UN/LOCODE lists some codes on several rows (changes/aliases) — keep the
    // seaport-function row, else the row that carries coordinates.
    if (!prev
        || (entry.func?.startsWith("1") && !prev.func?.startsWith("1"))
        || (!!entry.coords && !prev.coords && !prev.func?.startsWith("1"))) {
      registry.set(k, entry);
    }
  }
  console.log("registry entries:", registry.size);

  const refCoords = new Map(
    JSON.parse(fs.readFileSync(path.join(ROOT, "lib/portal/ports-reference.json"), "utf8"))
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => [norm(p.c), { lat: p.lat, lon: p.lon }]),
  );

  // map fallback file: unquoted keys —  AEDXB: [25.25, 55.2667, 315],
  const fallback = new Map();
  const fcSrc = fs.readFileSync(path.join(ROOT, "lib/portal/port-coords.ts"), "utf8");
  for (const m of fcSrc.matchAll(/^\s*([A-Z0-9]{5}):\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+)(?:,\s*(-?[\d.]+))?/gm)) {
    fallback.set(norm(m[1]), { lat: Number(m[2]), lon: Number(m[3]), bearing: m[4] != null ? Number(m[4]) : null });
  }
  console.log("reference coords:", refCoords.size, "| map fallbacks:", fallback.size);

  const ports = await fetch(`${URL_BASE}/rest/v1/ports?select=locode,trade_name,country,is_active,latitude,longitude,seaward_bearing&limit=1000`, { headers: H }).then((r) => r.json());
  let coordsSet = 0, statusSet = 0, bearingSet = 0;
  const noCoords = [], notInRegistry = [], notSeaport = [];

  for (const p of ports) {
    const code = norm(p.locode);
    const reg = registry.get(code);
    const body = {};
    // registry metadata — always refreshed
    body.unlocode_status = reg?.status ?? null;
    body.unlocode_function = reg?.func ?? null;
    if (p.is_active && !reg) notInRegistry.push(p.locode + " " + p.trade_name);
    if (p.is_active && reg?.func && !reg.func.startsWith("1")) notSeaport.push(p.locode + " " + p.trade_name + " [" + reg.func + "]");
    // coordinates — write-once
    if (p.latitude == null) {
      const c = reg?.coords ?? refCoords.get(code) ?? fallback.get(code) ?? MANUAL_COORDS.get(code) ?? null;
      if (c) { body.latitude = c.lat; body.longitude = c.lon; coordsSet++; }
      else if (p.is_active) noCoords.push(p.locode + " " + p.trade_name);
    }
    if (p.seaward_bearing == null && fallback.get(code)?.bearing != null) {
      body.seaward_bearing = fallback.get(code).bearing;
      bearingSet++;
    }
    statusSet++;
    if (!DRY) {
      const r = await fetch(`${URL_BASE}/rest/v1/ports?locode=eq.${encodeURIComponent(p.locode)}`, {
        method: "PATCH",
        headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(p.locode + ": " + r.status + " " + (await r.text()).slice(0, 200));
    }
  }

  console.log(`\n${DRY ? "DRY RUN — nothing written." : "Enrichment applied."}`);
  console.log("rows processed:", ports.length, "| coords set:", coordsSet, "| bearings set:", bearingSet);
  console.log("\nACTIVE ports still without coordinates (", noCoords.length, "):", noCoords.join(", ") || "none");
  console.log("\nACTIVE codes NOT in the official registry (", notInRegistry.length, "):", notInRegistry.join(", ") || "none");
  console.log("\nACTIVE codes whose registry function is NOT seaport (", notSeaport.length, "):", notSeaport.join(", ") || "none");
})();
