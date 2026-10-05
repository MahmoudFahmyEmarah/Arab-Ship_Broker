import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const intelligenceConsole = source("components/admin/intelligence-rules/IntelligenceRulesConsole.tsx");
const structuredEditor = source("components/admin/intelligence-rules/StructuredDraftEditor.tsx");
const matchingConsole = source("components/admin/matching-rules/MatchingRulesConsole.tsx");
const map = source("components/portal/MarketMap.tsx");
const flags = source("components/portal/IntelligenceFlags.tsx");
const flagsCss = source("components/portal/IntelligenceFlags.module.css");
const identifier = source("components/admin/AccessibleIdentifier.tsx");
const intelligenceSdk = source("sdk/app/intelligence.ts");
const matchingSdk = source("sdk/app/matching-rules.ts");
const rpcError = source("sdk/app/rpc-error.ts");
const browserSpec = source("e2e/rules-governance.spec.ts");
const browserConfig = source("playwright.rules.config.ts");
const browserHarness = source("scripts/rules-e2e-run.ps1");

assert.match(intelligenceConsole, /id: "rules", label: "Rules"/);
assert.match(intelligenceConsole, /id: "frameworks", label: "Frameworks"/);
assert.doesNotMatch(intelligenceConsole, /Rule document \(schema v1 JSON\)|Provenance JSON/);
assert.match(structuredEditor, /Add rule/);
assert.match(structuredEditor, /Add group/);
assert.match(structuredEditor, /Add framework/);
assert.match(structuredEditor, /Active in this draft/);
assert.match(structuredEditor, /Evidence and change provenance/);

for (const [name, code] of [["Intelligence", intelligenceConsole], ["Matching", matchingConsole]] as const) {
  const createReload = code.indexOf("await reload");
  const createClear = code.indexOf("createGesture.current = null", createReload);
  assert.ok(createReload >= 0 && createClear > createReload, `${name} create key clears only after reconciliation`);
  const activateReload = name === "Intelligence"
    ? code.indexOf("await reload(ruleSetId)")
    : code.indexOf("await reloadDashboard()", code.indexOf("async function handleActivate"));
  const activateClear = code.indexOf("activateGesture.current = null", activateReload);
  assert.ok(activateReload >= 0 && activateClear > activateReload, `${name} activation key clears only after reconciliation`);
}
assert.match(intelligenceConsole, /compareEpoch\.current/);

assert.match(map, /status: "idle" \| "loading" \| "sample" \| "unavailable"/);
assert.match(map, /matching\?\.source === "sample"/);
assert.match(map, /Matching checks are unavailable\. Pairing is paused\./);
assert.doesNotMatch(map, /dbEligible \?\?/);

assert.match(flags, /aria-describedby/);
assert.match(flags, /Intelligence checks unavailable\./);
assert.doesNotMatch(flagsCss, /:focus-within/, "Escape must be able to hide a tooltip while its trigger retains focus");
assert.match(identifier, /<details/);
assert.match(identifier, /<summary/);

for (const sdk of [intelligenceSdk, matchingSdk]) {
  assert.match(sdk, /import "server-only"/);
  assert.match(sdk, /throwAppRpcError\(name, error\)/);
}
assert.match(rpcError, /readonly code/);
assert.match(rpcError, /readonly details/);
assert.match(rpcError, /readonly hint/);

assert.match(browserSpec, /e2e_rules_environment_snapshot/);
assert.match(browserSpec, /port === "54321"/);
assert.match(browserSpec, /staleCompleted/);
assert.doesNotMatch(browserSpec, /waitForTimeout/);
assert.match(browserConfig, /reuseExistingServer: false/);
assert.match(browserHarness, /supabase_db_asb-rules-e2e/);

console.log("rules UI/boundary contract checks: 32 passed, 0 failed");
