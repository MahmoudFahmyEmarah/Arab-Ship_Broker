import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function check(label: string, assertion: () => void): void {
  try {
    assertion();
    passed += 1;
  } catch (error) {
    throw new Error(`rules UI/boundary contract failed: ${label}`, { cause: error });
  }
}

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
const matchingMigration = source("supabase/migrations/20261003300000_matching_rules.sql");
const intelligenceServer = source("lib/portal/intelligence.server.ts");
const rulesDown = source("supabase/rollback/20261003_rules_down.sql");
const rulesHarness = source("scripts/rules-harness.sh");

check("rules tab", () => assert.match(intelligenceConsole, /id: "rules", label: "Rules"/));
check("frameworks tab", () => assert.match(intelligenceConsole, /id: "frameworks", label: "Frameworks"/));
check("no raw JSON editor", () => assert.doesNotMatch(intelligenceConsole, /Rule document \(schema v1 JSON\)|Provenance JSON/));
check("add rule", () => assert.match(structuredEditor, /Add rule/));
check("add group", () => assert.match(structuredEditor, /Add group/));
check("add framework", () => assert.match(structuredEditor, /Add framework/));
check("draft active control", () => assert.match(structuredEditor, /Active in this draft/));
check("draft evidence", () => assert.match(structuredEditor, /Evidence and change provenance/));

for (const [name, code] of [["Intelligence", intelligenceConsole], ["Matching", matchingConsole]] as const) {
  const createReload = code.indexOf("await reload");
  const createClear = code.indexOf("createGesture.current = null", createReload);
  check(`${name} create key clears only after reconciliation`, () => assert.ok(createReload >= 0 && createClear > createReload));
  const activateReload = name === "Intelligence"
    ? code.indexOf("await reload(ruleSetId)")
    : code.indexOf("await reloadDashboard()", code.indexOf("async function handleActivate"));
  const activateClear = code.indexOf("activateGesture.current = null", activateReload);
  check(`${name} activation key clears only after reconciliation`, () => assert.ok(activateReload >= 0 && activateClear > activateReload));
}
check("comparison epoch", () => assert.match(intelligenceConsole, /compareEpoch\.current/));

check("matching status union", () => assert.match(map, /status: "idle" \| "loading" \| "sample" \| "unavailable"/));
check("sample matching boundary", () => assert.match(map, /matching\?\.source === "sample"/));
check("matching unavailable copy", () => assert.match(map, /Matching checks are unavailable\. Pairing is paused\./));
check("no DB eligibility fallback", () => assert.doesNotMatch(map, /dbEligible \?\?/));

check("tooltip description", () => assert.match(flags, /aria-describedby/));
check("intelligence unavailable copy", () => assert.match(flags, /Intelligence checks unavailable\./));
check("tooltip Escape boundary", () => assert.doesNotMatch(flagsCss, /:focus-within/));
check("identifier details", () => assert.match(identifier, /<details/));
check("identifier summary", () => assert.match(identifier, /<summary/));

for (const sdk of [intelligenceSdk, matchingSdk]) {
  check("server-only SDK", () => assert.match(sdk, /import "server-only"/));
  check("structured RPC error", () => assert.match(sdk, /throwAppRpcError\(name, error\)/));
}
check("RPC error code", () => assert.match(rpcError, /readonly code/));
check("RPC error details", () => assert.match(rpcError, /readonly details/));
check("RPC error hint", () => assert.match(rpcError, /readonly hint/));

check("environment snapshot", () => assert.match(browserSpec, /e2e_rules_environment_snapshot/));
check("disposable API origin", () => assert.match(browserSpec, /port === "54321"/));
check("approved staging only", () => {
  assert.match(browserSpec, /sidcsytgqalqacsgyguz\.supabase\.co/);
  assert.match(browserConfig, /sidcsytgqalqacsgyguz\.supabase\.co/);
});
check("production browser target refused", () => {
  assert.match(browserSpec, /rezfejaxbmdzkslrrefr\.supabase\.co/);
  assert.match(browserConfig, /must never target the production Supabase project/);
});
check("beta gate state restored", () => {
  assert.match(browserSpec, /captureBetaMode/);
  assert.match(browserSpec, /restoreBetaModeOnce/);
  assert.match(browserSpec, /original row was not restored exactly/);
});
check("tooltip geometry cannot deadlock", () => assert.doesNotMatch(browserSpec, /new IntersectionObserver/));
check("stale response proof", () => assert.match(browserSpec, /staleCompleted/));
check("typed release browser proof", () => {
  assert.match(browserSpec, /typed release confirmations gate and execute matching and intelligence activation and rollback/);
  assert.match(browserSpec, /ACTIVATE v\$\{matchingVersion\}/);
  assert.match(browserSpec, /ROLLBACK v\$\{intelligenceRollbackVersion\}/);
});
check("real intelligence RPC failure proof", () => {
  assert.match(intelligenceServer, /supabase\.rpc\("get_intelligence_rules"/);
  assert.match(browserSpec, /every cargo and vessel row with the exact neutral notice/);
});
check("safe-update-compatible full cache rebuild", () => {
  assert.doesNotMatch(matchingMigration, /delete\s+from\s+public\.matches\s*;/i);
});
check("rules DOWN requires explicit history acknowledgement", () => {
  assert.match(rulesDown, /current_setting\('asb\.rules_down_ack', true\)[\s\S]*?discard-history/);
  assert.doesNotMatch(rulesDown, /^\s*set(?:\s+local)?\s+asb\.rules_down_ack/im);
});
check("rollback probes acknowledge discarded history", () => {
  assert.match(rulesHarness, /set local asb\.rules_down_ack = 'discard-history'/);
});
check("from-applied DOWN acknowledges in the same psql session", () => {
  assert.match(rulesHarness, /-c "set asb\.rules_down_ack = 'discard-history'" -f -/);
});
check("no fixed browser wait", () => assert.doesNotMatch(browserSpec, /waitForTimeout/));
check("fresh browser server", () => assert.match(browserConfig, /reuseExistingServer: false/));
check("disposable DB guard", () => assert.match(browserHarness, /supabase_db_asb-rules-e2e/));

console.log(`rules UI/boundary contract checks: ${passed} passed, 0 failed`);
