import assert from "node:assert/strict";
import {
  GROQ_API_BASE_URL,
  GROQ_STRUCTURED_OUTPUT_MODELS,
  isGroqVendor,
  llmModelsEndpoint,
  llmProviderFamily,
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

console.log("LLM provider checks passed");
