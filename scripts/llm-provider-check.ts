import assert from "node:assert/strict";
import {
  GROQ_API_BASE_URL,
  GROQ_STRUCTURED_OUTPUT_MODELS,
  LLM_MODEL_SUGGESTIONS,
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
assert.deepEqual(LLM_MODEL_SUGGESTIONS.anthropic, ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-opus-5-5"],
  "the default (first) is the mid-tier model: Data Sync classifies in bulk");
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
