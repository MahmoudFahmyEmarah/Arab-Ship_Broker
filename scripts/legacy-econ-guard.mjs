// Prebuild guard (architect ruling on C2O-041, B2O-011 R5): no surface may show
// the retired legacy economics again. lib/portal/econ.ts keeps only geography
// helpers for members of the UI; its money exports (hard-coded fuel prices,
// KAP port DA, flat Suez toll, calcVoyage) must not be imported anywhere except
// the files listed in PENDING, each tied to an open item that removes it.
//   node scripts/legacy-econ-guard.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const MONEY = ["FUEL_PRICES", "SUEZ_SDR_USD", "SUEZ_FIXED", "calcPortDA", "calcSuezToll", "calcVoyage", "VoyageCalc"];
// Temporary: removed by Codex's Stream R correction (C2O-042, R1). Then delete the
// money exports from econ.ts and empty this list.
const PENDING = new Set([]); // R1 landed with Stream R 53390ce; the money exports are deleted (R4).
const SCAN = ["app", "components", "lib", "sdk"];
const IGNORE = new Set(["node_modules", ".next"]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) yield p;
  }
}

const problems = [];
const importRe = /import\s*\{([^}]*)\}\s*from\s*["'](?:@\/lib\/portal\/econ|\.\.?\/(?:[\w.-]+\/)*econ)["']/g;
for (const top of SCAN) {
  for (const f of files(join(ROOT, top))) {
    const rel = relative(ROOT, f).split(sep).join("/");
    if (rel === "lib/portal/econ.ts") continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(importRe)) {
      const names = m[1].split(",").map((s) => s.replace(/\btype\b/, "").trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const bad = names.filter((n) => MONEY.includes(n));
      if (bad.length && !PENDING.has(rel)) problems.push(`${rel}: imports retired legacy economics ${bad.join(", ")}`);
    }
    if (/className="ve-fuel-live"/.test(src)) problems.push(`${rel}: unconditional "Live" fuel label (use the per-product status)`);
  }
}

for (const p of PENDING) {
  try { statSync(join(ROOT, p)); } catch { problems.push(`${p}: listed as pending but missing; empty PENDING`); }
}

if (problems.length) {
  console.error("legacy-econ-guard: FAILED\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`legacy-econ-guard: ok (no retired economics on any surface; pending: ${[...PENDING].join(", ") || "none"})`);
