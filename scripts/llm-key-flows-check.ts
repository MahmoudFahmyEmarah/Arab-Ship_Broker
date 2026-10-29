// Behavioural test of the Data Sync key save/activate flows against a fake client (C2O-178 / B2O-110 P2):
// a failed or unconfirmed test never reaches the activation RPC; a 'changed' token is refused; an unticked box
// on an active edit leaves the key inactive; audits follow the real outcome.
import assert from "node:assert/strict";
import { activateIfVerified, saveAndMaybeActivate, type KeyFlowDeps, type ProbeOutcome, type SaveKeyInput } from "../lib/sync/llm-key-flows";

type Call = [string, ...unknown[]];
function fake(opts: { active?: boolean; probe: ProbeOutcome; rpc?: string }): { d: KeyFlowDeps; calls: Call[] } {
  const calls: Call[] = [];
  const d: KeyFlowDeps = {
    isActive: async (id) => { calls.push(["isActive", id]); return !!opts.active; },
    save: async (input) => { calls.push(["save", input.makeActive]); return input.id ?? "new-id"; },
    probe: async (id) => { calls.push(["probe", id]); return opts.probe; },
    activateIfUnchanged: async (id, token) => { calls.push(["activateIfUnchanged", id, token]); return opts.rpc ?? "activated"; },
    audit: async (e) => { calls.push(["audit", e.action]); },
  };
  return { d, calls };
}
const ok = (family: "anthropic" | "google" | "openai-compatible", modelFound: boolean | null): ProbeOutcome =>
  ({ ok: true, data: { model: "m", modelFound, family, token: "2026-10-29T09:40:12.123456+00:00" } });
const names = (calls: Call[]) => calls.map((c) => c[0]);
const input = (o: Partial<SaveKeyInput>): SaveKeyInput => ({ label: "k", vendor: "anthropic", model: "m", baseUrl: null, secret: null, makeActive: false, ...o });
let n = 0; const t = async (name: string, fn: () => Promise<void>) => { await fn(); n++; console.log(`  ok   ${name}`); };

async function main() {
await t("a failed probe never calls the activation RPC", async () => {
  const { d, calls } = fake({ probe: { ok: false, error: "Provider rejected the key (HTTP 401)." } });
  assert.equal(await activateIfVerified(d, "k1"), "Provider rejected the key (HTTP 401).");
  assert.ok(!names(calls).includes("activateIfUnchanged"));
  assert.ok(!names(calls).includes("audit"), "no activation audit on refusal");
});
await t("Anthropic and Google with an unconfirmed model never call the RPC", async () => {
  for (const family of ["anthropic", "google"] as const) {
    const { d, calls } = fake({ probe: ok(family, null) });
    assert.match((await activateIfVerified(d, "k1")) ?? "", /did not confirm the model/);
    assert.ok(!names(calls).includes("activateIfUnchanged"));
  }
});
await t("an OpenAI-compatible gateway that cannot confirm ids may activate", async () => {
  const { d, calls } = fake({ probe: ok("openai-compatible", null) });
  assert.equal(await activateIfVerified(d, "k1"), null);
  assert.deepEqual(calls.find((c) => c[0] === "activateIfUnchanged"), ["activateIfUnchanged", "k1", "2026-10-29T09:40:12.123456+00:00"], "the probe's token reaches the RPC unchanged");
});
await t("a model the provider does not serve never activates", async () => {
  const { d, calls } = fake({ probe: ok("anthropic", false) });
  assert.notEqual(await activateIfVerified(d, "k1"), null);
  assert.ok(!names(calls).includes("activateIfUnchanged"));
});
await t("a 'changed' token is refused and not audited as activated", async () => {
  const { d, calls } = fake({ probe: ok("anthropic", true), rpc: "changed" });
  assert.match((await activateIfVerified(d, "k1")) ?? "", /test it again/);
  assert.deepEqual(names(calls), ["probe", "activateIfUnchanged"]);
});
await t("a passing test activates, then audits the activation", async () => {
  const { d, calls } = fake({ probe: ok("google", true) });
  assert.equal(await activateIfVerified(d, "k1"), null);
  assert.deepEqual(names(calls), ["probe", "activateIfUnchanged", "audit"]);
});
await t("save always calls the save RPC with makeActive false, even when activation is requested", async () => {
  const { d, calls } = fake({ probe: ok("anthropic", true) });
  const r = await saveAndMaybeActivate(d, input({ makeActive: true, secret: "sk" }));
  assert.equal(r.activated, true);
  assert.deepEqual(calls.find((c) => c[0] === "save"), ["save", false]);
  assert.deepEqual(names(calls), ["save", "audit", "probe", "activateIfUnchanged", "audit"], "save audit, then the activation audit");
});
await t("an unticked box on an edit of the ACTIVE key leaves it inactive and says so", async () => {
  const { d, calls } = fake({ active: true, probe: ok("anthropic", true) });
  const r = await saveAndMaybeActivate(d, input({ id: "k1", makeActive: false }));
  assert.equal(r.activated, false);
  assert.match(r.notActivated ?? "", /took the key out of service/);
  assert.ok(!names(calls).includes("probe") && !names(calls).includes("activateIfUnchanged"));
  assert.deepEqual(names(calls), ["isActive", "save", "audit", "audit"], "save + deactivate audits");
});
await t("a failing re-test of an edited active key leaves it INACTIVE and says it was active", async () => {
  const { d, calls } = fake({ active: true, probe: { ok: false, error: "Provider rejected the key (HTTP 401)." } });
  const r = await saveAndMaybeActivate(d, input({ id: "k1", makeActive: true }));
  assert.equal(r.activated, false);
  assert.match(r.notActivated ?? "", /HTTP 401\)?\.?.*INACTIVE \(it was active before the edit\)/);
  assert.ok(!names(calls).includes("activateIfUnchanged"));
});
await t("a new key without the box ticked is saved inactive with no probe", async () => {
  const { d, calls } = fake({ probe: ok("anthropic", true) });
  const r = await saveAndMaybeActivate(d, input({ secret: "sk" }));
  assert.deepEqual(r, { id: "new-id", activated: false });
  assert.deepEqual(names(calls), ["save", "audit"]);
});

  console.log(`LLM key flows: ${n} behavioural checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
