// Muted-grey contrast guard (owner, 3 Nov 2026; Codex C2ALL-187 P2-2): every definition of --asb-gray-500 outside
// the navy-sidebar exception is the same value, and that value reads at >= 4.5:1 (unrounded) on every surface
// it is used on. Run: node scripts/contrast-check.mjs
import { readFileSync } from "node:fs";
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

// the surfaces the muted grey sits on: white, the faint panels, the gray-50/100 chips and the tinted cards
const SURFACES = ["#FFFFFF", "#F7F8FA", "#F5F7FA", "#F0F2F5", "#F0F2F6", "#EEF1F6", "#EDF1F6", "#F2F6FB", "#F1F3F6", "#F5F6F8"];
for (const bg of SURFACES) {
  const r = ratio(grey, bg);
  assert.ok(r >= 4.5, `${grey} on ${bg} reads at ${r.toFixed(3)}:1, under 4.5:1`);
}
// no stale muted hex left written inline outside the exception
const exceptionOnly = readFileSync("app/design-tokens.css", "utf8").match(/--asb-gray-500:\s*#8B95A3/gi) ?? [];
assert.equal(exceptionOnly.length, 1, "the old grey appears once in design-tokens: the navy-sidebar exception");
console.log(`MUTED GREY CONTRAST: ${grey} >= 4.5:1 on ${SURFACES.length} surfaces — ALL ASSERTIONS PASSED`);
