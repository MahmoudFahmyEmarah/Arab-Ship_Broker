/**
 * Every function body a DOWN file restores must be byte-identical to the body
 * the migration chain last created BEFORE the migration that DOWN reverses.
 *
 *   node scripts/down-fidelity-check.mjs
 *
 * Line endings included. A body between $$ … $$ is stored verbatim in
 * pg_proc.prosrc, so a copy that differs by a \r on every line is a different
 * function to every checksum — and the schema does not return to where it
 * started. This repository mixes the two deliberately: several already-applied
 * migrations are CRLF, and production's stored bodies carry those endings, so
 * "normalise everything" would create drift rather than remove it. The rule
 * has to be per function and per source.
 *
 * The migration harness catches this too, but only for the FULL chain, where
 * the last DOWN to touch a function wins. This catches it per DOWN file —
 * which is what a partial rollback actually runs, and where a body no
 * migration ever created would otherwise be installed unnoticed.
 *
 * Found on 21 Sep 2026: eight bodies across five DOWN files did not match
 * their source.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG = path.join(root, "supabase", "migrations");
const ROLL = path.join(root, "supabase", "rollback");

/**
 * A DOWN file whose name does not name one migration. The value is the
 * EARLIEST migration it reverses, because that is the point the schema has to
 * return to: restoring a body from after that point restores something the
 * rollback is itself undoing.
 */
const EXPLICIT = {
  "20260918_sync_phase4_5_down.sql": "20260918140000",   // reverses phases 4 and 5
};

/** Which migration each DOWN file reverses, taken from its own name. */
function reverses(downName) {
  if (EXPLICIT[downName]) return EXPLICIT[downName];
  // 20260919_dq_c_down.sql → the 20260919* migration whose letter matches
  const m = /^(\d{8})_(.+)_down\.sql$/.exec(downName);
  if (!m) return null;
  const [, day, slug] = m;
  const letter = /^dq_([a-z])$/.exec(slug)?.[1];
  const files = fs.readdirSync(MIG).filter((f) => f.startsWith(day) && f.endsWith(".sql"));
  if (letter) {
    const hit = files.find((f) => new RegExp(`_dq_${letter}_`).test(f));
    if (hit) return hit.split("_")[0];
  }
  const hit = files.find((f) => f.includes(slug));
  return hit ? hit.split("_")[0] : null;
}

const DEF = /create\s+or\s+replace\s+function\s+"?public"?\s*\.\s*"?(\w+)"?\s*\(/gi;

/** Every (name, body) a file defines, in file order, as raw bytes. */
function definitions(buf) {
  const text = buf.toString("latin1");            // byte-preserving
  const out = [];
  for (const m of text.matchAll(DEF)) {
    const seg = text.slice(m.index);
    const tag = /\$(\w*)\$/.exec(seg)?.[0];
    if (!tag) continue;
    const a = seg.indexOf(tag) + tag.length;
    const b = seg.indexOf(tag, a);
    if (b < 0) continue;
    out.push({ name: m[1], body: seg.slice(a, b) });
  }
  return out;
}

const migrations = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const migDefs = new Map(migrations.map((f) => [f, definitions(fs.readFileSync(path.join(MIG, f)))]));

/** The body the chain last created before `version`. */
function sourceBody(fn, version) {
  let best = null;
  for (const f of migrations) {
    if (f.split("_")[0] >= version) break;
    for (const d of migDefs.get(f)) if (d.name === fn) best = { file: f, body: d.body };
  }
  return best;
}

let pass = 0, fail = 0, skipped = 0;
const ok = (c, label) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

console.log("DOWN files restore what the migrations created");
for (const down of fs.readdirSync(ROLL).filter((f) => f.endsWith(".sql")).sort()) {
  const version = reverses(down);
  const defs = definitions(fs.readFileSync(path.join(ROLL, down)));
  if (!version) {
    // A skip is only harmless when there is nothing to check. A DOWN file
    // that restores a function and cannot be mapped to its migration is an
    // UNCHECKED rollback, which is exactly what this script exists to stop —
    // 20260918_sync_phase4_5_down.sql was skipped that way and restored a
    // 5 596-byte commit_sync_batch nobody had compared.
    if (defs.length) {
      ok(false, `${down}: restores ${defs.length} function(s) but nothing says which migration it reverses — add it to EXPLICIT`);
    } else {
      skipped++;
      console.log(`  skip ${down} — nothing to check`);
    }
    continue;
  }
  if (!defs.length) continue;
  for (const d of defs) {
    const src = sourceBody(d.name, version);
    if (!src) {
      // a DOWN that restores a function no earlier migration defines is
      // either a new object (fine, it should be dropped instead) or a body
      // invented by hand
      ok(false, `${down}: restores ${d.name}, which no migration before ${version} ever created`);
      continue;
    }
    ok(
      src.body === d.body,
      `${down}: ${d.name} matches ${src.file}` +
        (src.body === d.body ? "" : ` — ${d.body.length} bytes restored vs ${src.body.length} created` +
          (src.body.replace(/\r/g, "") === d.body.replace(/\r/g, "") ? " (LINE ENDINGS ONLY)" : "")),
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
if (fail) process.exit(1);
