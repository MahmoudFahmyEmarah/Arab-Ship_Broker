/**
 * Data Quality · authorization checks (no network). Run:  npx tsx scripts/dq-authz-check.ts
 *
 * Proves, without a browser or a database:
 *   1. the capability matrix (lib/dq/authz.ts): a view-only admin holds no
 *      run or edit capability; run holds no edit; edit holds all
 *   2. every exported server action in app/(admin)/admin/data-quality/actions.ts
 *      calls gate(<capability>) — and the ones that execute batches, resume,
 *      recover, retry, schedule, spend AI budget or change configuration call
 *      it with "run" or "edit", never "view"
 *   3. tickRun (the poller a viewer calls every two seconds) is read-only:
 *      no processOneBatch, no kickEngine, no RPC, no write
 *   4. the member-callable module (lib/dq/member-gate.ts) evaluates a draft
 *      and writes exactly one gate-log line — nothing else
 *
 * Together with requireAdmin (which redirects anyone below "view") and
 * canAccess (lib/admin/sections.ts) this is the whole chain a request goes
 * through; the presets prove what each role resolves to.
 */
import fs from "node:fs";
import path from "node:path";
import { assertDqCapability, dqCapabilities } from "@/lib/dq/authz";
import { ADMIN_PRESETS, canAccess } from "@/lib/admin/sections";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const throws = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

console.log("1 · capability matrix");
ok(JSON.stringify(dqCapabilities("view")) === JSON.stringify({ view: true, run: false, edit: false }), "view: read only");
ok(JSON.stringify(dqCapabilities("run")) === JSON.stringify({ view: true, run: true, edit: false }), "run: read + run, no edit");
ok(JSON.stringify(dqCapabilities("edit")) === JSON.stringify({ view: true, run: true, edit: true }), "edit: everything");
ok(JSON.stringify(dqCapabilities("none")) === JSON.stringify({ view: false, run: false, edit: false }), "none: nothing");
ok(/run permission/.test(throws(() => assertDqCapability("view", "run")) ?? ""), "a viewer asking to run is refused with the console's wording");
ok(/edit access/.test(throws(() => assertDqCapability("view", "edit")) ?? ""), "a viewer asking to edit is refused");
ok(/edit access/.test(throws(() => assertDqCapability("run", "edit")) ?? ""), "a runner asking to edit is refused");
ok(throws(() => assertDqCapability("run", "run")) === null && throws(() => assertDqCapability("edit", "run")) === null, "run and edit may run");
ok(throws(() => assertDqCapability("none", "view")) !== null, "no access may not even view");
// what the presets resolve to
ok(canAccess("dataquality", "sub", ADMIN_PRESETS.broker.perms) === "view" && !dqCapabilities(canAccess("dataquality", "sub", ADMIN_PRESETS.broker.perms)).run, "the Broker preset is view-only: it cannot run, resume, recover, retry or schedule");
ok(canAccess("dataquality", "sub", ADMIN_PRESETS.it.perms) === "edit", "the IT preset edits");
ok(canAccess("dataquality", "sub", ADMIN_PRESETS.sales.perms) === "none", "the Sales preset has no access");
ok(canAccess("dataquality", "super", null) === "edit", "the owner edits");
ok(dqCapabilities(canAccess("dataquality", "sub", { dataquality: "run" })).run && !dqCapabilities(canAccess("dataquality", "sub", { dataquality: "run" })).edit, "an explicit run grant runs but does not edit");

console.log("2 · every server action gates, and with the right capability");
const src = read("app/(admin)/admin/data-quality/actions.ts");
const actions = new Map<string, string>();
const re = /^export async function (\w+)\(/gm;
let m: RegExpExecArray | null;
const starts: { name: string; at: number }[] = [];
while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
for (let i = 0; i < starts.length; i += 1) actions.set(starts[i].name, src.slice(starts[i].at, starts[i + 1]?.at ?? src.length));
ok(actions.size >= 40, `${actions.size} exported actions found`);
const gateOf = (body: string): string[] => Array.from(body.matchAll(/await gate\("(view|run|edit)"\)/g)).map((x) => x[1]);
for (const [name, body] of actions) {
  const g = gateOf(body);
  ok(g.length > 0, `${name}: calls gate() (${g.join(", ") || "none"})`);
}
const mustBe = (name: string, allowed: string[], why: string) => {
  const g = gateOf(actions.get(name) ?? "");
  ok(g.length > 0 && g.every((x) => allowed.includes(x)), `${name}: gate ${allowed.join("|")} — ${why} (found ${g.join(", ") || "none"})`);
};
mustBe("createRun", ["run", "edit"], "starts a run or schedules one");
ok(/if \(input\.when === "nightly"\) \{[\s\S]*?await gate\("edit"\)[\s\S]*?\}\s*const \{ sb, actor, actorName \} = await gate\("run"\)/.test(actions.get("createRun") ?? ""), "createRun: the nightly (scheduling) branch needs edit, run-now needs run");
mustBe("controlRun", ["run"], "pause / resume / cancel execute or stop batches");
mustBe("recoverRun", ["run"], "re-kicks a stalled run (executes a batch)");
mustBe("retryRun", ["run", "edit"], "re-evaluates failed checks");
mustBe("saveSettings", ["edit"], "configuration");
mustBe("setChannelMode", ["edit"], "gate matrix");
mustBe("saveRule", ["edit"], "rules");
mustBe("toggleRule", ["edit"], "rules");
mustBe("applyFix", ["edit"], "writes member data");
mustBe("applyFixes", ["edit"], "writes member data");
mustBe("undoFix", ["edit"], "writes member data");
mustBe("acceptSuggestion", ["edit"], "may apply fixes");
mustBe("approveAllFixes", ["edit"], "applies fixes in bulk");
mustBe("requeueNotification", ["edit"], "changes delivery state");
mustBe("importWorkbookRules", ["edit"], "rules");
mustBe("savePortException", ["edit"], "registry");
// a view-gated action reads: no table write, no batch, no re-kick, no engine / outbox / reservation RPC
for (const [name, body] of actions) {
  if (!gateOf(body).includes("view")) continue;
  const writes = /\.(insert|update|upsert|delete)\(|processOneBatch\(|kickEngine\(|\.rpc\("(fn_dq_(retry|finish|prepare|process|reserve|settle|release|batch_timeout|outbox)|dq_(apply|undo|set|save))/.test(body);
  ok(!writes, `${name}: view-gated, so it neither writes, executes nor schedules`);
}

console.log("3 · the poller is read-only");
const tick = actions.get("tickRun") ?? "";
ok(gateOf(tick).length === 1 && gateOf(tick)[0] === "view", "tickRun gates as view (viewers poll)");
ok(!/processOneBatch|kickEngine|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|after\(/.test(tick), "tickRun neither executes a batch, re-kicks, calls an RPC nor writes");
ok(/isStalled\(run\)/.test(tick), "tickRun reports the stall instead of acting on it");
const recover = actions.get("recoverRun") ?? "";
ok(/processOneBatch\(sb, run\.id\)/.test(recover) && /kickEngine\(/.test(recover), "recoverRun is where the re-kick lives");

console.log("4 · the member-callable module");
const mg = read("lib/dq/member-gate.ts");
const rpcs = Array.from(mg.matchAll(/\.rpc\("(\w+)"/g)).map((x) => x[1]);
ok(rpcs.length === 1 && rpcs[0] === "fn_dq_validate", `member-gate calls exactly one RPC, fn_dq_validate (found ${rpcs.join(", ")})`);
const writes = Array.from(mg.matchAll(/\.from\("(\w+)"\)\.(insert|update|upsert|delete)\(/g)).map((x) => `${x[1]}.${x[2]}`);
ok(writes.length === 1 && writes[0] === "dq_gate_log.insert", `member-gate writes exactly one thing, a gate-log line (found ${writes.join(", ")})`);
ok(/p_log: false/.test(mg), "validateMemberDraft never logs from inside the check");
ok(/correlation_id: crypto\.randomUUID\(\)/.test(mg) && /correlation_id: correlationId/.test(mg), "the correlation id is minted with the verdict and quoted back on the refusal report");
ok(/auth\.getUser\(\)/.test(mg.split("export async function reportGateRefusal")[1] ?? ""), "the refusal report requires a signed-in member");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
