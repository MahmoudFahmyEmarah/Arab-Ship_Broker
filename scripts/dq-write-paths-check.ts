/**
 * Data Quality · write-path coverage and discovery (no network).
 * Run:  npx tsx scripts/dq-write-paths-check.ts
 *
 *   1. registry   every declared path names its tables and a known policy, its
 *                 file exists and carries the marker that proves the policy
 *   2. discovery  the application (app/, lib/, components/, sdk/) is scanned
 *                 for writes to registered tables — a direct insert / update /
 *                 upsert / delete through the Supabase client, or a call to a
 *                 publication RPC — and every file found must be declared
 *   3. SQL        the migrations are scanned for SECURITY DEFINER functions
 *                 that write a registered table: each must set its channel
 *                 (set_config('dq.channel', …)) or be listed in DQ_SQL_WRITERS
 *                 with who gates it; a service-role-callable publication
 *                 function with neither FAILS
 *   4. coverage   every registered table has a strict publication path, and
 *                 ungated paths are counted so the report can list them
 *   5. ratchet    (21 Sep 2026) no ungated path may touch a table that has a
 *                 gate trigger — rules run there, so an unchannelled
 *                 service-role write is a bypass, not a gap — and the set of
 *                 ungated ids must equal DQ_UNGATED_ALLOWED exactly, so a new
 *                 one cannot be added without saying so
 */
import fs from "node:fs";
import path from "node:path";
import { DQ_GATE_TRIGGER_TABLES, DQ_PUBLICATION_RPCS, DQ_REGISTERED_TABLES, DQ_RESTRICTED_ALLOWED, DQ_SQL_WRITERS, DQ_UNGATED_ALLOWED, DQ_WRITE_PATHS, POLICY_LABEL } from "@/lib/dq/policy";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const root = path.resolve(__dirname, "..");
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");

console.log("1 · registry");
const seen = new Set<string>();
for (const p of DQ_WRITE_PATHS) {
  ok(!seen.has(p.id), `${p.id}: unique id`); seen.add(p.id);
  ok(p.tables.length > 0 && p.policy in POLICY_LABEL && p.tables.every((t) => (DQ_REGISTERED_TABLES as readonly string[]).includes(t)), `${p.id}: names registered tables and a known policy`);
  const file = path.join(root, p.file);
  if (!fs.existsSync(file)) { ok(false, `${p.id}: ${p.file} exists`); continue; }
  const src = fs.readFileSync(file, "utf8");
  ok(src.includes(p.marker), `${p.id}: ${p.file} carries the policy marker "${p.marker}"${p.planned ? " (planned path)" : ""}`);
  if (p.policy === "ungated") ok(!!p.note, `${p.id}: an ungated path says why it is tolerated`);
  if (p.policy === "restricted") {
    const e = p.exception;
    ok(!!e && !!e.owner && !!e.rationale && !!e.risk && !!e.test, `${p.id}: the restriction names an owner, a reason, a risk level and a test`);
    if (e?.test) ok(fs.existsSync(path.join(root, e.test)), `${p.id}: its test ${e.test} exists`);
    if (e?.rationale) ok(e.rationale.length >= 80, `${p.id}: the reason says what MECHANISM limits the path, not just that it is limited`);
  }
}

console.log("2 · discovery — application writes to registered tables");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(full);
  }
  return out;
}
const tables = DQ_REGISTERED_TABLES.join("|");
const directWrite = new RegExp(`\\.from\\(["'](${tables})["']\\)\\s*\\.(insert|update|upsert|delete)\\(`, "g");
const rpcCall = new RegExp(`\\.rpc\\(["'](${DQ_PUBLICATION_RPCS.join("|")})["']`, "g");
const declaredFiles = new Set(DQ_WRITE_PATHS.filter((p) => !p.planned).map((p) => p.file));
const files = ["app", "lib", "components", "sdk"].filter((d) => fs.existsSync(path.join(root, d))).flatMap((d) => walk(path.join(root, d)));
let found = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const hits = [...Array.from(src.matchAll(directWrite)).map((m) => `${m[1]}.${m[2]}`), ...Array.from(src.matchAll(rpcCall)).map((m) => `rpc ${m[1]}`)];
  if (!hits.length) continue;
  found += 1;
  const r = rel(f);
  ok(declaredFiles.has(r), `${r}: ${Array.from(new Set(hits)).join(", ")} — declared in DQ_WRITE_PATHS`);
}
ok(found >= 8, `${found} files write registered tables (scan covered ${files.length} files)`);

console.log("3 · SQL — SECURITY DEFINER functions that write registered tables");
const migDir = path.join(root, "supabase", "migrations");
const migrations = fs.readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort();
type FnInfo = { file: string; definer: boolean; channel: boolean; writes: Set<string>; serviceRole: boolean };
const fns = new Map<string, FnInfo>();
const grants = new Set<string>();
const writeRe = new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.(${tables})\\b`, "gi");
for (const name of migrations) {
  const src = fs.readFileSync(path.join(migDir, name), "utf8");
  for (const g of src.matchAll(/grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\([^)]*\)\s+to\s+([^;]+);/gi)) if (/service_role/i.test(g[2])) grants.add(g[1]);
  const heads = Array.from(src.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi));
  for (let i = 0; i < heads.length; i += 1) {
    const body = src.slice(heads[i].index, heads[i + 1]?.index ?? src.length);
    const writes = new Set(Array.from(body.matchAll(writeRe)).map((m) => m[1].toLowerCase()));
    // dynamic SQL: execute format('update public.%I …') on a registered table name is a write too
    if (/execute\s+format\s*\(\s*'(?:insert\s+into|update|delete\s+from)\s+public\.%I/i.test(body)) writes.add("(dynamic)");
    if (!writes.size) continue;
    fns.set(heads[i][1], { file: name, definer: /security\s+definer/i.test(body), channel: /set_config\('dq\.channel'/.test(body), writes, serviceRole: false });
  }
}
for (const [fn, info] of fns) info.serviceRole = grants.has(fn);
const exempt = new Map(DQ_SQL_WRITERS.map((w) => [w.fn, w]));
let sqlWriters = 0;
for (const [fn, info] of fns) {
  if (!info.definer) continue; // invoker functions run as the member: the trigger judges them
  sqlWriters += 1;
  const declared = exempt.get(fn);
  const label = `${fn} (${info.file.slice(0, 14)}; writes ${Array.from(info.writes).join(", ")}${info.serviceRole ? "; service_role may call" : ""})`;
  if (info.channel) { ok(true, `${label}: names its channel`); continue; }
  if (declared) { ok(true, `${label}: gated by ${declared.gate} — ${declared.why}`); continue; }
  ok(false, `${label}: no dq.channel and not in DQ_SQL_WRITERS — an undeclared ${info.serviceRole ? "service-role publication" : "definer"} write`);
}
ok(sqlWriters >= 15, `${sqlWriters} definer functions write registered tables`);
for (const w of DQ_SQL_WRITERS) ok(fns.has(w.fn), `DQ_SQL_WRITERS.${w.fn}: still exists in the migrations`);

console.log("4 · coverage");
for (const t of DQ_REGISTERED_TABLES) {
  ok(DQ_WRITE_PATHS.some((p) => !p.planned && p.tables.includes(t) && p.policy === "publication"), `${t}: has a strict publication path`);
}
const ungated = DQ_WRITE_PATHS.filter((p) => p.policy === "ungated");
console.log(`  info ${ungated.length} ungated path(s) on record: ${ungated.map((p) => p.id).join(", ")}`);

console.log("5 · ratchet — no ungated path, and no restriction without a test");
const restricted = DQ_WRITE_PATHS.filter((p) => p.policy === "restricted");
ok(ungated.length === 0, `zero ungated paths${ungated.length ? ` — ${ungated.map((p) => p.id).join(", ")} still unjudged and unlimited` : ""}`);
ok(DQ_UNGATED_ALLOWED.length === 0, "DQ_UNGATED_ALLOWED is empty: no path may be both unjudged and unlimited");
{
  const allowedR = new Set<string>(DQ_RESTRICTED_ALLOWED);
  const actualR = new Set(restricted.map((p) => p.id));
  const addedR = [...actualR].filter((id) => !allowedR.has(id));
  const closedR = [...allowedR].filter((id) => !actualR.has(id));
  ok(addedR.length === 0, `no undeclared restriction${addedR.length ? `: ${addedR.join(", ")} — gate it, or add it to DQ_RESTRICTED_ALLOWED with an owner and a test` : ""}`);
  ok(closedR.length === 0, `DQ_RESTRICTED_ALLOWED lists nothing already closed${closedR.length ? `: ${closedR.join(", ")}` : ""}`);
  for (const p of restricted) {
    ok(p.exception?.risk !== "high", `${p.id}: a high-risk path may not stay restricted (risk ${p.exception?.risk})`);
  }
  console.log(`  info ${restricted.length} restricted path(s): ${restricted.map((p) => `${p.id} [${p.exception?.risk}]`).join(", ")}`);
}
const migSrc = migrations.map((n) => fs.readFileSync(path.join(migDir, n), "utf8")).join("\n");
for (const t of DQ_GATE_TRIGGER_TABLES) {
  const re = new RegExp(`create trigger trg_\\w+_zz_dq_gate\\s+before insert or update on public\\.${t}\\b`, "i");
  ok(re.test(migSrc), `${t}: the gate trigger DQ_GATE_TRIGGER_TABLES claims exists in the migrations`);
}
for (const p of [...ungated, ...restricted]) {
  const judged = p.tables.filter((t) => (DQ_GATE_TRIGGER_TABLES as readonly string[]).includes(t));
  ok(judged.length === 0, `${p.id}: ${p.policy}, and touches no gate-trigger table${judged.length ? ` — but it writes ${judged.join(", ")}, which the rules judge: a service-role write there is a BYPASS` : ""}`);
}
const allowed = new Set<string>(DQ_UNGATED_ALLOWED);
const actual = new Set(ungated.map((p) => p.id));
const added = [...actual].filter((id) => !allowed.has(id));
const closed = [...allowed].filter((id) => !actual.has(id));
ok(added.length === 0, `no undeclared ungated path${added.length ? `: ${added.join(", ")} — gate it, or add it to DQ_UNGATED_ALLOWED with the reason` : ""}`);
ok(closed.length === 0, `DQ_UNGATED_ALLOWED lists nothing already closed${closed.length ? `: ${closed.join(", ")} — remove them from the list` : ""}`);
for (const t of DQ_GATE_TRIGGER_TABLES) {
  ok(DQ_WRITE_PATHS.some((p) => !p.planned && p.tables.includes(t) && p.policy === "publication" && p.channel === "admin"),
     `${t}: the admin channel has a strict publication path (the console cannot publish past the rules)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
