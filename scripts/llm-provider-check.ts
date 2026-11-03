import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GROQ_API_BASE_URL,
  GROQ_STRUCTURED_OUTPUT_MODELS,
  LLM_MODEL_SUGGESTIONS,
  ANTHROPIC_TASK_MODEL,
  activationRefusal,
  modelChoiceRefusal,
  canonicalVendor,
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
assert.match(syncActions, /const importVendor = legacyVendor === "custom" \? "other" : canonicalVendor\(ai\.vendor \|\| "anthropic"\);\n    if \(!importVendor\) return/, "the legacy import canonicalises its vendor and refuses an unknown one");
assert.match(syncActions, /const importModel = catalogueModel\(importVendor, ai\.model\);/, "the legacy import maps a retired id onto the catalogue");
assert.match(syncActions, /p_vendor: importVendor,/, "the legacy import stores the canonical vendor");
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
assert.match(syncActions, /const outcome = await activateKey\(keyFlowDeps\(c, who\), id\);/, "Activate goes through activateKey (activateIfVerified + structured outcome)");
assert.match(syncActions, /Promise<Result<ActivationResult>>/, "the standalone action returns the structured outcome");
assert.match(src("components/admin/data-sync/SettingsView.tsx"), /const f = activationFeedback\(r\);\n    toast\[f\.kind\]\(f\.text\);\n    if \(f\.reload\) await reloadKeys\(\);/, "the form renders the outcome via activationFeedback and reloads when told");
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

// the current Claude models reject `temperature` (1 Nov 2026): no Anthropic constructor sets it
for (const f of ["lib/sync/email/llm.ts", "lib/groupmail/polish.ts"]) {
  const code = src(f).replace(/\/\/.*$/gm, "");
  const m = code.match(/new ChatAnthropic\(\{[\s\S]*?\}\)/g) ?? [];
  assert.ok(m.length > 0, `${f}: ChatAnthropic constructor found`);
  for (const block of m) assert.doesNotMatch(block, /temperature/, `${f}: ChatAnthropic is built without temperature`);
}
// the model is chosen from the vendor's list (owner, 1 Nov 2026): dropdown only, refused on the server otherwise
assert.equal(modelChoiceRefusal("anthropic", "claude-haiku-5-5"), null);
assert.match(modelChoiceRefusal("anthropic", "claude-sonnet-4-5") ?? "", /Choose the model from the list for anthropic/);
assert.match(modelChoiceRefusal("Anthropic", " typed-id ") ?? "", /Choose the model from the list/);
assert.equal(modelChoiceRefusal("other", "my-gateway-model"), null, "a gateway you host keeps a typed id");
assert.match(src("app/(admin)/admin/data-sync/settings-actions.ts"), /const choice = modelChoiceRefusal\(vendor, input\.model\);\n  if \(choice\) return \{ success: false, error: choice \};/, "the save refuses an id outside the list");

// one canonical vendor parser for form, server and import (C2O-186)
assert.equal(canonicalVendor("Anthropic"), "anthropic", "stored casing is canonicalised");
assert.equal(canonicalVendor(" ANTHROPIC "), "anthropic");
assert.equal(canonicalVendor("claude"), "anthropic", "a known alias maps onto its provider");
assert.equal(canonicalVendor("Gemini"), "google");
assert.equal(canonicalVendor("Google"), "google");
assert.equal(canonicalVendor("GroqCloud"), "groq");
assert.equal(canonicalVendor("Mistral AI"), "mistral");
assert.equal(canonicalVendor("other"), "other");
for (const bad of ["OpenAI-compatible", "openai compatible", "my-gateway", "", "   ", null, undefined, "claude-ish", "anthropic2"]) {
  assert.equal(canonicalVendor(bad), null, `an unknown vendor is null: ${String(bad)}`);
}
// aliases cannot bypass a listed catalogue; unknown vendors are refused; only canonical "other" takes a typed id
assert.match(modelChoiceRefusal("claude", "bogus") ?? "", /Choose the model from the list for anthropic/, "an alias is held to its provider's list");
assert.equal(modelChoiceRefusal("claude", "claude-haiku-5-5"), null, "an alias with a listed id is accepted (and stored canonical)");
assert.match(modelChoiceRefusal("Anthropic", "bogus") ?? "", /Choose the model from the list for anthropic/, "mixed case is held to the list");
assert.match(modelChoiceRefusal("gemini", "bogus") ?? "", /for google/);
assert.match(modelChoiceRefusal("OpenAI-compatible", "bogus") ?? "", /Choose the provider from the list/, "a non-canonical gateway spelling is refused, not treated as other");
assert.match(modelChoiceRefusal("some-vendor", "anything") ?? "", /Choose the provider from the list/, "an arbitrary unknown vendor is refused");
assert.equal(modelChoiceRefusal("OTHER", "my-model"), null, "canonical other keeps a typed id");
assert.match(modelChoiceRefusal("other", "  ") ?? "", /Type the exact model id/, "other still needs an id");
const actionsSrc = src("app/(admin)/admin/data-sync/settings-actions.ts");
assert.match(actionsSrc, /const vendor = canonicalVendor\(input\.vendor\);\n  if \(!vendor\) return/, "the save canonicalises or refuses before the model rule");
assert.match(actionsSrc, /id: input\.id, label: input\.label\.trim\(\), vendor, model:/, "the save persists the canonical vendor");
assert.match(actionsSrc, /const vendor = canonicalVendor\(meta\.vendor as string\);\n    if \(!vendor\) return/, "Test/Activate refuse a stored non-canonical vendor");
assert.match(actionsSrc, /const stale = modelChoiceRefusal\(vendor, model\);\n    if \(stale\) return/, "Test/Activate refuse a stored id outside the list");
const formSrc = src("components/admin/data-sync/SettingsView.tsx");
assert.match(formSrc, /useState<LlmVendor \| "">\(cred \? canonicalVendor\(cred\.vendor\) \?\? "" : "anthropic"\)/, "the form canonicalises the stored vendor before the catalogue lookup");
assert.match(formSrc, /\{vendor !== "other" \? \(/, "only canonical other renders a free-text model");
assert.match(formSrc, /const modelOk = vendor === "other" \? model\.trim\(\)\.length > 0 && baseUrl\.trim\(\)\.length > 0 : !!vendor && suggestions\.includes\(model\);/, "Save needs a provider and a listed model (a gateway also needs its URL)");

// C2O-188: no substring guess is left in the family helpers; a gateway needs its URL; legacy "custom" imports as other
assert.equal(llmProviderFamily("claude-ish"), "openai-compatible", "a substring is not a family (callers refuse unknown vendors first)");
assert.equal(llmProviderFamily("Anthropic"), "anthropic");
assert.equal(llmProviderFamily("gemini"), "google");
assert.equal(isGroqVendor("not-groq-really"), false, "groq is matched exactly");
assert.equal(llmDefaultBaseUrl("openai-compatible"), undefined, "no default host for a non-canonical vendor");
assert.match(actionsSrc, /if \(vendor === "other" && !input\.baseUrl\?\.trim\(\)\) return \{ success: false, error: "A custom gateway needs its base URL\." \};/, "the save refuses a gateway without a URL");
assert.match(actionsSrc, /if \(vendor === "other" && !override\) return/, "Test/Activate refuse a stored gateway without a URL");
assert.match(actionsSrc, /const importVendor = legacyVendor === "custom" \? "other" : canonicalVendor\(ai\.vendor \|\| "anthropic"\);/, "exactly legacy 'custom' imports as other; other names go through the parser");
assert.equal(catalogueModel("other", " custom-model "), "custom-model", "an imported gateway keeps its typed model");
assert.match(actionsSrc, /p_base_url: ai\.baseUrl\?\.trim\(\) \|\| null,[\s\S]{0,80}p_make_active: false,/, "the import keeps the base URL and stays inactive");
{
  const saveAt = actionsSrc.indexOf("if (saveErr) return { success: false, error: saveErr.message };");
  const scrubAt = actionsSrc.indexOf('const scrubbed = { ...settings, ai: { ...ai, apiKey: "" } };');
  assert.ok(saveAt > 0 && scrubAt > saveAt, "the plaintext is scrubbed only after the Vault save succeeded");
}
assert.ok(actionsSrc.indexOf('if (vendor === "other" && !override) return') < actionsSrc.indexOf('c.rpc("get_llm_secret"'), "Test/Activate decrypt the key only after every rule passed (B2O P3)");
const runtimeSrc = src("lib/sync/email/llm.ts");
assert.doesNotMatch(runtimeSrc, /llmProviderFamily/, "the classifier runtime picks its client from the canonical vendor only");
assert.ok(runtimeSrc.indexOf("canonicalVendor(") < runtimeSrc.indexOf('rpc("get_llm_secret"'), "the active row is validated before its secret is decrypted");
assert.match(formSrc, /disabled=\{saving \|\| !modelOk\}/);
assert.doesNotMatch(src("components/admin/data-sync/SettingsView.tsx"), /Other model id|CUSTOM_MODEL|setCustomModel/, "the form offers no free-text model for a listed vendor");

console.log("LLM provider checks passed");
