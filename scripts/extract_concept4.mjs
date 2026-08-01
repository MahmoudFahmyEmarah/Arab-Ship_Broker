// Extracts the design sources embedded in the "Concept 4 - Broker Ledger" HTML bundles
// (self-extracting pages: a JSON manifest of gzip+base64 resources plus an escaped page
// template) into reference/handoff/ so the design source of truth is version-controlled.
//
// Usage: node scripts/extract_concept4.mjs
//
// The bundles ship the same asb/* modules as the CTO handoff package at
// "ASB UIUX redesign - Extracting Design System Component/handoff_post_cargo_position/"
// plus one file that exists nowhere else: asb/ledger-shell.jsx (the shared Broker Ledger
// shell) and the per-page mountBrokerLedger configs. Bundle versions are authoritative.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "reference", "handoff");

const BUNDLES = [
  { html: "Concept 4 - Broker Ledger - Post Cargo.html", tag: "cargo" },
  { html: "Concept 4 - Broker Ledger - Post Vessel.html", tag: "vessel" },
];

// Known resource-id -> filename mapping, recovered from each module's header comment.
const NAME_BY_HEADER = [
  { re: /asb\/ledger-shell\.jsx/, name: "asb/ledger-shell.jsx" },
  { re: /asb\/pc2-steps\.jsx/, name: "asb/pc2-steps.jsx" },
  { re: /asb\/post-cargo2\.jsx/, name: "asb/post-cargo2.jsx" },
  { re: /asb\/pc2-data\.js/, name: "asb/pc2-data.js" },
  { re: /asb\/pp2-steps\.jsx/, name: "asb/pp2-steps.jsx" },
  { re: /asb\/post-position2\.jsx/, name: "asb/post-position2.jsx" },
  { re: /asb\/pp2-data\.js/, name: "asb/pp2-data.js" },
  { re: /asb\/companies-data\.js/, name: "asb/companies-data.js" },
  { re: /asb\/vessel-schema-q88\.js/, name: "asb/vessel-schema-q88.js" },
];

function decodeResource(entry) {
  const content = entry.content ?? entry.data ?? entry;
  if (typeof content !== "string") return null;
  if (content.startsWith("H4sI")) {
    return zlib.gunzipSync(Buffer.from(content, "base64")).toString("utf8");
  }
  return content;
}

function extractBundle({ html, tag }) {
  const lines = fs.readFileSync(path.join(ROOT, html), "utf8").split("\n");
  const lineAfter = (marker) => {
    const i = lines.findIndex((l) => l.trim().startsWith(`<script type="__bundler/${marker}"`));
    if (i === -1) throw new Error(`${html}: missing __bundler/${marker}`);
    return lines[i + 1];
  };

  const manifest = JSON.parse(lineAfter("manifest"));
  const written = [];
  for (const entry of Object.values(manifest)) {
    const mime = entry.mime || entry.type || "";
    if (/font|octet/.test(mime)) continue; // skip embedded woff2 fonts
    const src = decodeResource(entry);
    if (!src) continue;
    const head = src.slice(0, 200);
    const hit = NAME_BY_HEADER.find((m) => m.re.test(head));
    if (!hit) continue; // React/ReactDOM/Babel/DS-bundle libraries
    const out = path.join(OUT, hit.name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, src);
    written.push(hit.name);
  }

  // The page template holds the scoped DS CSS + the led-* shell CSS + the mount config.
  const template = JSON.parse(lineAfter("template"));
  const styles = [...template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  fs.writeFileSync(path.join(OUT, `page-styles-${tag}.css`), styles.join("\n\n/* ==== next style block ==== */\n\n"));
  const inline = [...template.matchAll(/<script type="text\/babel">([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s) => s.includes("mountBrokerLedger"));
  fs.writeFileSync(path.join(OUT, `mount-config-${tag}.jsx`), inline.join("\n"));
  written.push(`page-styles-${tag}.css`, `mount-config-${tag}.jsx`);
  return written;
}

fs.mkdirSync(OUT, { recursive: true });
for (const bundle of BUNDLES) {
  const files = extractBundle(bundle);
  console.log(`${bundle.html} -> ${files.length} files:`);
  for (const f of files) console.log(`  ${f}`);
}
console.log(`\nDone. Output: ${OUT}`);
