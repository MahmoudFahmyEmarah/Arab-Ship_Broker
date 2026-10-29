import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GROQ_API_BASE_URL,
  GROQ_STRUCTURED_OUTPUT_MODELS,
  LLM_MODEL_SUGGESTIONS,
  ANTHROPIC_TASK_MODEL,
  activationRefusal,
  mayActivate,
  catalogueModel,
  legacyKeyForSave,
  openAiCompatibleModelFound,
  isGroqVendor,
  llmDefaultBaseUrl,
  llmModelEndpoint,
  llmModelsEndpoint,
  llmProviderFamily,
  modelListedIn,
  openAiCompatibleBaseUrl,
} from "../lib/sync/llm-provider";

assert.equal(isGroqVendor("Groq"), true);
assert.equal(llmProviderFamily("groq"), "openai-compatible");
assert.equal(openAiCompatibleBaseUrl("groq"), GROQ_API_BASE_URL);
assert.equal(
  llmModelsEndpoint("groq", GROQ_API_BASE_URL),
  "https://api.groq.com/openai/v1/models",
  "the key test must not duplicate /v1",
);
assert.equal(
  llmModelsEndpoint("groq", `${GROQ_API_BASE_URL}/`),
  "https://api.groq.com/openai/v1/models",
  "trailing slashes must be normalized",
);
assert.equal(llmModelsEndpoint("openai"), "https://api.openai.com/v1/models");
assert.equal(
  llmModelsEndpoint("other", "https://openrouter.ai/api/v1"),
  "https://openrouter.ai/api/v1/models",
);
assert.deepEqual(GROQ_STRUCTURED_OUTPUT_MODELS, [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
]);

// 27 Oct 2026: the form filled in claude-sonnet-4-5 by itself and every classification batch answered
// 404 "model not found". The catalogue must carry only current Anthropic ids, newest first, and never
// a dated or retired one; the key test must probe the model id, not only the key.
assert.deepEqual(LLM_MODEL_SUGGESTIONS.anthropic, ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"],
  "Anthropic's current lineup first (Haiku 5.5 = their pick for high-volume classification), then still-available legacy ids");
assert.equal(catalogueModel("anthropic", "claude-sonnet-4"), "claude-haiku-5-5", "a retired imported id becomes the default");
assert.equal(catalogueModel("anthropic", ""), "claude-haiku-5-5");
assert.equal(catalogueModel("anthropic", "claude-opus-5-5"), "claude-opus-5-5", "a listed id is kept");
assert.equal(catalogueModel("Anthropic", " claude-sonnet-5-5 "), "claude-sonnet-5-5");
assert.equal(catalogueModel("other", "my-gateway-model"), "my-gateway-model", "a vendor without a catalogue keeps its id");

// C2O-172 supplement: provider secrets live only in Vault. The legacy Platform settings page must not
// receive, render, accept or store a plaintext key, nor fake a "Connected" test.
// EOL-proof: Windows checkouts (core.autocrlf) carry CRLF; every pin below is written with LF line ends
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const settingsPage = src("app/(admin)/admin/settings/page.tsx");
const settingsAction = src("app/(admin)/admin/settings/actions.ts");
const legacyUi = src("components/admin/settings/PlatformSettings.tsx");
const syncActions = src("app/(admin)/admin/data-sync/settings-actions.ts");
assert.match(settingsPage, /initialSettings=\{\{ \.\.\.settings, ai: \{ \.\.\.settings\.ai, apiKey: "" \} \}\}/, "the page redacts the key before serialising settings");
assert.match(settingsAction, /ai: \{ \.\.\.input\.settings\.ai, apiKey: legacy\.apiKey \}/, "the save action never uses the browser key; it writes legacyKeyForSave's value");
assert.doesNotMatch(settingsAction, /value: input\.settings,/, "input.settings is never written verbatim");
assert.doesNotMatch(legacyUi, /ai\.apiKey|apiKey \}\)|testKey|responded in/, "no key field and no simulated test on the legacy page");
assert.match(legacyUi, /href="\/admin\/data-sync"/, "the legacy page points to the Vault-backed editor");
assert.match(syncActions, /const importModel = catalogueModel\(ai\.vendor \|\| "anthropic", ai\.model\);/, "the legacy import maps a retired id onto the catalogue");
assert.match(syncActions, /p_make_active: false,/, "every legacy import is inactive until Test");
assert.doesNotMatch(syncActions, /p_make_active: true/, "no import path activates an unverified key");
// C2O-177: Test, Activate and save-with-activate share one provider/model probe; nothing activates without it
assert.match(syncActions, /async function probeLlmCredential\(/, "one private probe helper");
assert.match(syncActions, /export async function testLlmCredential[\s\S]*?return await probeLlmCredential\(c, who, id\);/, "Test runs the probe");
assert.match(syncActions, /return data\?\.is_active === true;/, "the save knows whether it edits the active key");
// C2O-178: activation is version-bound and provider-family aware; the old unconditional switch is never called
assert.equal(mayActivate("anthropic", true), true);
assert.equal(mayActivate("anthropic", null), false, "Anthropic/Google must confirm the model");
assert.equal(mayActivate("google", null), false);
assert.equal(mayActivate("openai-compatible", null), true, "a gateway that cannot confirm ids may activate");
assert.equal(mayActivate("openai-compatible", false), false);
assert.equal(activationRefusal("activated"), null);
assert.match(activationRefusal("changed") ?? "", /test it again/);
assert.match(activationRefusal("weird") ?? "", /unexpected/);
assert.equal((syncActions.match(/c\.rpc\("set_active_llm_credential_if_unchanged"/g) ?? []).length, 1, "one conditional activation call site (keyFlowDeps)");
assert.doesNotMatch(syncActions, /c\.rpc\("set_active_llm_credential",/, "the unconditional switch is never called");
assert.doesNotMatch(syncActions, /\.update\(\{ is_active/, "no direct is_active writes");
assert.match(syncActions, /p_expected_updated_at: token \}/, "activation carries the token the test read");
assert.match(src("lib/sync/llm-key-flows.ts"), /if \(!mayActivate\(probe\.data\.family, probe\.data\.modelFound\)\)/, "the family rule gates activation");
assert.match(syncActions, /await activateIfVerified\(keyFlowDeps\(c, who\), id\)/, "Activate goes through activateIfVerified");
assert.match(syncActions, /await saveAndMaybeActivate\(keyFlowDeps\(c, who\), \{/, "save goes through saveAndMaybeActivate");
assert.match(syncActions, /p_base_url: input\.baseUrl, p_secret: input\.secret,\n        p_make_active: false,/, "the save RPC never activates");
assert.doesNotMatch(syncActions, /made active" : ""/, "the save audit never claims an activation");
const migration = src("supabase/migrations/20261029100000_llm_credential_conditional_activation.sql");
assert.match(migration, /is_active = false,\n    updated_at = clock_timestamp\(\);/, "every edit is saved inactive (DB)");
assert.match(migration, /for update;\n  if not found then return 'not_found'; end if;\n  if p_expected_updated_at is null or v_updated is distinct from p_expected_updated_at then return 'changed'; end if;/, "the switch is locked and token-bound (DB)");
assert.match(migration, /grant execute on function public\.set_active_llm_credential_if_unchanged\(uuid, timestamptz\) to service_role;/);
// C2O-182: activations are serialised platform-wide, and the legacy unconditional switch is retired
assert.match(migration, /perform pg_advisory_xact_lock\(7310290001\);\n  select updated_at into v_updated from public\.llm_credential where id = p_id for update;/, "the fixed advisory lock precedes the target read");
assert.match(migration, /raise exception 'set_active_llm_credential is retired/, "the legacy switch refuses");
assert.match(migration, /revoke all on function public\.set_active_llm_credential\(uuid\) from public, anon, authenticated, service_role;/, "no role may execute the legacy switch");
assert.doesNotMatch(migration, /grant execute on function public\.set_active_llm_credential\(uuid\)/, "UP never re-grants the legacy switch");
const validate = src("scripts/data-sync-validate.sh");
assert.match(validate, /supabase\/tests\/data_sync\/llm_conditional_activation_smoke\.sql/, "the SQL contract runs in data-sync-validate");
assert.match(validate, /supabase\/tests\/data_sync\/llm_activation_race_two_sessions\.sh/, "the two-session races run in data-sync-validate");
const race = src("supabase/tests/data_sync/llm_activation_race_two_sessions.sh");
assert.match(race, /GOT=\$\(q "select current_database\(\)" 2>\/dev\/null \|\| true\)\n\[ "\$GOT" = "\$WANT" \] \|\| refuse/, "the race harness verifies the database it actually reached");
assert.match(race, /\[\[ "\$WANT" =~ \^asb_\[a-z0-9_\]\+\$ \]\] \|\| refuse/, "the declared disposable database must be asb_*");
assert.ok(race.indexOf("select current_database()") < race.indexOf("update public.llm_credential"), "the target check precedes every write");
assert.match(src("components/admin/data-sync/SettingsView.tsx"), /if \(r\.data\.activationUnknown\) toast\.warning\(/, "the form reports an unknown activation as unknown");
assert.match(src("components/admin/data-sync/SettingsView.tsx"), /if \(r\.data\.notActivated\) toast\.warning\(/, "the form says when a saved key was not activated");
// C2O-176 P1, behaviourally: a stored plaintext key blocks the save; otherwise the key written is always ""
assert.equal(legacyKeyForSave("sk-ant-legacy").ok, false);
assert.equal(legacyKeyForSave("  ").ok, true);
assert.deepEqual(legacyKeyForSave(undefined), { ok: true, apiKey: "" });
assert.deepEqual(legacyKeyForSave(null), { ok: true, apiKey: "" });
assert.match(settingsAction, /const legacy = legacyKeyForSave\(/, "the save action uses legacyKeyForSave");
assert.match(settingsAction, /if \(!legacy\.ok\) return \{ success: false, error: legacy\.error \};/, "a stored key refuses the save");
// C2O-176 P2: a gateway list that lacks the id is "not verifiable", never "not found"
assert.equal(openAiCompatibleModelFound({ data: [{ id: "gpt-4o" }] }, "gpt-4o"), true);
assert.equal(openAiCompatibleModelFound({ data: [{ id: "gpt-4o" }] }, "o3-mini"), null);
assert.equal(openAiCompatibleModelFound({ nope: 1 }, "o3-mini"), null);
// every runtime Anthropic constructor takes its model from the shared module
assert.equal(ANTHROPIC_TASK_MODEL, "claude-opus-5-5");
for (const f of ["lib/circulars/engine.ts", "lib/groupmail/polish.ts", "lib/sync/email/llm.ts"]) {
  assert.doesNotMatch(src(f).replace(/\/\/.*$/gm, ""), /model:\s*"claude-/, `${f}: no hard-coded Anthropic model id`);
}
assert.equal(catalogueModel("custom", ""), "", "no catalogue + no model stays empty (the import then stays inactive)");
assert.match(syncActions, /redirect: "manual"[\s\S]*redirect: "manual"/, "both key-test probes refuse redirects");
for (const f of ["lib/app-settings.ts", "components/admin/settings/PlatformSettings.tsx", "app/(admin)/admin/data-sync/settings-actions.ts", "components/admin/data-sync/SettingsView.tsx"]) {
  assert.doesNotMatch(src(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /"claude-(sonnet-4|opus-4|3-5-[a-z]+|sonnet-4-5|opus-4-1)"/, `${f}: no retired Anthropic id in code`);
}
for (const [vendor, models] of Object.entries(LLM_MODEL_SUGGESTIONS)) {
  for (const m of models) {
    assert.doesNotMatch(m, /claude-(sonnet|opus|haiku)-[0-9](-[0-9])?-\d{8}$/u, `${vendor}: dated Anthropic ids are not suggested (${m})`);
    assert.doesNotMatch(m, /^claude-(sonnet-4-5|opus-4-1|3-5-haiku-latest|sonnet-4)$/u, `${vendor}: retired id ${m}`);
    assert.equal(m, m.trim(), `${vendor}: no surrounding whitespace in ${m}`);
  }
}
assert.deepEqual(LLM_MODEL_SUGGESTIONS.groq, [...GROQ_STRUCTURED_OUTPUT_MODELS], "Groq suggestions stay the structured-output set");
assert.equal(llmDefaultBaseUrl("anthropic"), "https://api.anthropic.com");
assert.equal(llmDefaultBaseUrl("google"), "https://generativelanguage.googleapis.com");
assert.equal(llmDefaultBaseUrl("groq"), GROQ_API_BASE_URL);
assert.equal(llmDefaultBaseUrl("openai"), "https://api.openai.com/v1");
assert.equal(llmDefaultBaseUrl("other"), undefined, "an unknown vendor has no default root to show");
assert.equal(llmModelEndpoint("anthropic", "claude-opus-5"), "https://api.anthropic.com/v1/models/claude-opus-5");
assert.equal(llmModelEndpoint("google", "gemini-2.5-flash"), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash");
assert.equal(llmModelEndpoint("groq", "openai/gpt-oss-20b"), "https://api.groq.com/openai/v1/models/openai%2Fgpt-oss-20b", "a slash in the id is encoded");
assert.equal(llmModelEndpoint("anthropic", " claude-sonnet-5 "), "https://api.anthropic.com/v1/models/claude-sonnet-5", "the id is trimmed");
assert.equal(modelListedIn({ data: [{ id: "gpt-4o" }, { id: "o3-mini" }] }, "openai-compatible", "o3-mini"), true);
assert.equal(modelListedIn({ data: [{ id: "gpt-4o" }] }, "openai-compatible", "o3-mini"), false);
assert.equal(modelListedIn({ models: [{ name: "models/gemini-2.5-flash" }] }, "google", "gemini-2.5-flash"), true);
assert.equal(modelListedIn({ models: [{ name: "models/gemini-2.5-flash" }] }, "google", "gemini-2.5-pro"), false);
assert.equal(modelListedIn({ error: "nope" }, "openai-compatible", "gpt-4o"), null, "an unreadable list is 'not verifiable', never 'not found'");
assert.equal(modelListedIn(null, "anthropic", "claude-opus-5"), null);

console.log("LLM provider checks passed");
