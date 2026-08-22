// Backfills missing load/disch port LOCODEs on cargo_listings by resolving
// the stored port NAME against (1) the curated ports table, then (2) the
// UN/LOCODE reference list (lib/portal/ports-reference.json). Only exact,
// unambiguous case-insensitive name matches are applied; everything else is
// reported for review. Idempotent — only touches NULL locode columns.
//
// Usage: node scripts/backfill-listing-locodes.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry-run");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const BASE = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathq, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${pathq}`, { ...init, headers: { ...H, ...init.headers } });
  if (!res.ok) throw new Error(`${pathq.slice(0, 60)}: ${res.status} ${(await res.text()).slice(0, 150)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

// name → locode maps; names that appear under MORE than one locode are
// ambiguous and never auto-applied.
function buildMap(entries) {
  const seen = new Map();
  for (const [name, locode] of entries) {
    const k = norm(name);
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, locode);
    else if (seen.get(k) !== locode) seen.set(k, null); // ambiguous
  }
  return seen;
}

const ports = await rest("ports?select=locode,trade_name,is_active&limit=1000");
const curated = buildMap(
  ports.filter((p) => p.is_active).map((p) => [p.trade_name, p.locode]),
);
const refList = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/portal/ports-reference.json"), "utf8"));
const backstop = buildMap(refList.map((p) => [p.n, p.c]));

// cargo_listings.locode columns carry an FK to ports(locode) — only codes
// present in the curated table can be applied; backstop-only resolutions are
// reported instead.
const portSet = new Set(ports.map((p) => p.locode));
const resolve = (name) => {
  if (!name) return null;
  const k = norm(name);
  const code = curated.get(k) ?? backstop.get(k) ?? null;
  return code && portSet.has(code) ? code : null;
};

const rows = await rest(
  "cargo_listings?select=id,ref,load_port_name,load_port_locode,disch_port_name,disch_port_locode&or=(load_port_locode.is.null,disch_port_locode.is.null)&limit=1000",
);
console.log(`listings missing a locode: ${rows.length}`);

let fixed = 0;
const unresolved = new Map(); // name -> count
for (const r of rows) {
  const patch = {};
  if (!r.load_port_locode && r.load_port_name) {
    const l = resolve(r.load_port_name);
    if (l) patch.load_port_locode = l;
    else unresolved.set(r.load_port_name, (unresolved.get(r.load_port_name) ?? 0) + 1);
  }
  if (!r.disch_port_locode && r.disch_port_name) {
    const l = resolve(r.disch_port_name);
    if (l) patch.disch_port_locode = l;
    else unresolved.set(r.disch_port_name, (unresolved.get(r.disch_port_name) ?? 0) + 1);
  }
  if (Object.keys(patch).length) {
    fixed++;
    if (!DRY) await rest(`cargo_listings?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    console.log(`  ${r.ref ?? r.id}: ${JSON.stringify(patch)}`);
  }
}
console.log(`\n${DRY ? "DRY RUN — " : ""}listings updated: ${fixed}`);
const un = [...unresolved.entries()].sort((a, b) => b[1] - a[1]);
console.log(`unresolvable port names (${un.length}):`, un.map(([n, c]) => `${n} ×${c}`).join(" · ") || "none");
