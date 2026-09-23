export type LlmProviderFamily = "anthropic" | "google" | "openai-compatible";

export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

export const GROQ_STRUCTURED_OUTPUT_MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
] as const;

const cleanBaseUrl = (value?: string | null): string | undefined => {
  const clean = value?.trim().replace(/\/+$/u, "");
  return clean || undefined;
};

export function isGroqVendor(vendor?: string | null): boolean {
  return (vendor ?? "").trim().toLowerCase().includes("groq");
}

export function llmProviderFamily(vendor?: string | null): LlmProviderFamily {
  const normalized = (vendor ?? "").trim().toLowerCase();
  if (normalized.includes("anthropic") || normalized.includes("claude")) return "anthropic";
  if (normalized.includes("google") || normalized.includes("gemini")) return "google";
  return "openai-compatible";
}

/** Complete API root used by OpenAI-compatible clients. Groq gets a safe
 * official default; other compatible providers retain their explicit override. */
export function openAiCompatibleBaseUrl(vendor: string, override?: string | null): string | undefined {
  return cleanBaseUrl(override) ?? (isGroqVendor(vendor) ? GROQ_API_BASE_URL : undefined);
}

/** Read-only endpoint used by the credential test. The configured base URL is
 * already the versioned API root, so append /models—not another /v1/models. */
export function llmModelsEndpoint(vendor: string, override?: string | null): string {
  const family = llmProviderFamily(vendor);
  const base = cleanBaseUrl(override);
  if (family === "anthropic") return `${base ?? "https://api.anthropic.com"}/v1/models`;
  if (family === "google") return `${base ?? "https://generativelanguage.googleapis.com"}/v1beta/models`;
  return `${openAiCompatibleBaseUrl(vendor, base) ?? OPENAI_API_BASE_URL}/models`;
}
