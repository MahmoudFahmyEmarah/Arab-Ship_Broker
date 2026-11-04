// Muted-grey contrast guard (owner, 3 Nov 2026; Codex C2ALL-187 P2-2): every definition of --asb-gray-500 outside
// the navy-sidebar exception is the same value, and that value reads at >= 4.5:1 (unrounded) on every surface
// it is used on. Run: node scripts/contrast-check.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const lum = (hex) => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const FILES = ["app/design-tokens.css", "app/globals.css", "lib/portal/portal.css", "components/ledger/ledger.css", "components/pda/ports-module.css"];
const values = new Set();
for (const f of FILES) {
  const css = readFileSync(f, "utf8");
  // drop the one exception block (the navy sidebar) before collecting the platform values
  const platform = css.replace(/\.asb-portal\[data-sidebar="navy"\] \.asb-sidebar\s*\{[^}]*\}/g, "");
  for (const m of platform.matchAll(/--asb-gray-500:\s*(#[0-9A-Fa-f]{6})/g)) values.add(m[1].toUpperCase());
}
assert.equal(values.size, 1, `one muted grey across the platform, found ${[...values].join(", ")}`);
const grey = [...values][0];

// Ledger and PDA counters use the shared gray-100 variable for their background. Bind every runtime definition
// of that variable to the surface value used below, so changing the resolved background cannot bypass the ratio.
const gray100Values = new Set();
for (const f of FILES) {
  const css = readFileSync(f, "utf8");
  for (const m of css.matchAll(/--asb-gray-100:\s*(#[0-9A-Fa-f]{6})/g)) gray100Values.add(m[1].toUpperCase());
}
assert.deepEqual([...gray100Values], ["#EDF1F6"], `gray-100 must resolve to the guarded #EDF1F6 surface, found ${[...gray100Values].join(", ")}`);

// the surfaces the muted grey sits on: white, the faint panels, the gray-50/100 chips and the tinted cards
const SURFACES = ["#FFFFFF", "#F7F8FA", "#F5F7FA", "#F0F2F5", "#F0F2F6", "#EEF1F6", "#EDF1F6", "#F2F6FB", "#F1F3F6", "#F5F6F8"];
for (const bg of SURFACES) {
  const r = ratio(grey, bg);
  assert.ok(r >= 4.5, `${grey} on ${bg} reads at ${r.toFixed(3)}:1, under 4.5:1`);
}

// Guard the actual production selectors that triggered C2ALL-187, not only the shared token. This makes a
// selector-level regression fail even when the token itself is still correct.
const governed = {
  globals: readFileSync("app/globals.css", "utf8"),
  portal: readFileSync("lib/portal/portal.css", "utf8"),
  ledger: readFileSync("components/ledger/ledger.css", "utf8"),
  pda: readFileSync("components/pda/ports-module.css", "utf8"),
};
assert.match(governed.globals, /\.cc-field\s*\{[^}]*background:\s*#F2F6FB[^}]*\}/i, "cargo field keeps its tinted background");
assert.match(governed.globals, /\.cc-field__k\s*\{[^}]*color:\s*#626D79[^}]*\}/i, "cargo field label keeps the accessible foreground");
assert.match(governed.portal, /\.mp-tab__count\s*\{[^}]*background:\s*#EEF1F6[^}]*color:\s*#626D79[^}]*\}/i, "portal tab count keeps its accessible pair");
assert.match(governed.ledger, /\.pp2-step__num\s*\{[^}]*background:\s*var\(--asb-gray-100\)[^}]*color:\s*var\(--asb-gray-500\)[^}]*\}/i, "ledger step number keeps the governed token pair");
assert.match(governed.pda, /\.pm-scope \.pe-tabs__c\s*\{[^}]*color:\s*var\(--asb-gray-500\)[^}]*background:\s*var\(--asb-gray-100\)[^}]*\}/i, "PDA tab counter keeps the governed token pair");

// No stale muted hex may be reintroduced inline anywhere that ships at runtime. Reference/design packages are
// deliberately outside these roots and keep their historical source values.
const runtimeFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(?:css|ts|tsx|js|jsx|mjs)$/i.test(entry.name)) runtimeFiles.push(path);
  }
};
for (const root of ["app", "components", "lib"]) walk(root);
const stale = runtimeFiles.filter((f) => /#68727F/i.test(readFileSync(f, "utf8")));
assert.deepEqual(stale, [], `the superseded muted grey #68727F remains in runtime files: ${stale.join(", ")}`);

// The old grey remains only as the navy-sidebar token exception.
const exceptionOnly = readFileSync("app/design-tokens.css", "utf8").match(/--asb-gray-500:\s*#8B95A3/gi) ?? [];
assert.equal(exceptionOnly.length, 1, "the old grey appears once in design-tokens: the navy-sidebar exception");
console.log(`MUTED GREY CONTRAST: ${grey} >= 4.5:1 on ${SURFACES.length} surfaces — ALL ASSERTIONS PASSED`);
