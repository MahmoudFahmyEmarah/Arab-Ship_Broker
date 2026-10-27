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

/** Read-only per-model endpoint: the credential test proves the MODEL id exists, not only the key.
 * Every supported family exposes GET <models>/<id> (Anthropic and Google answer 404 for an unknown id). */
export function llmModelEndpoint(vendor: string, model: string, override?: string | null): string {
  return `${llmModelsEndpoint(vendor, override)}/${encodeURIComponent(model.trim())}`;
}

/** Current text models per vendor; the first entry is the default for a new key and the form keeps a
 * free-text escape hatch for ids that are not listed yet. The Anthropic ids are the current generation
 * (claude-sonnet-5 first: Data Sync classifies in bulk, so the mid-tier model is the sensible default;
 * claude-opus-5 for the strongest reads, claude-haiku-4-5 for the cheapest, claude-opus-5-5 the newest —
 * the key test tells whether the organisation's API can use it). Dated or retired ids such as
 * claude-sonnet-4-5 answer 404 "model: … not found", which is how the circular classifier failed on
 * 27 Oct 2026 after the form had filled that id in by itself. Every other picker on the platform reads this
 * table (Platform settings, the legacy-key import), so the ids cannot drift apart again. */
export const LLM_MODEL_SUGGESTIONS: Record<string, readonly string[]> = {
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-opus-5-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  google: [
    "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.5-flash", "gemini-3-pro-preview",
    "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-pro-latest",
    "gemini-2.0-flash",
  ],
  groq: [...GROQ_STRUCTURED_OUTPUT_MODELS],
  mistral: ["mistral-large-latest", "mistral-small-latest"],
  other: [],
};

/** The API root a vendor is called at when no base URL is stored — shown in the form so an empty
 * field reads as "provider default", not as "missing". Unknown vendors have no default. */
export function llmDefaultBaseUrl(vendor?: string | null): string | undefined {
  const family = llmProviderFamily(vendor);
  if (family === "anthropic") return "https://api.anthropic.com";
  if (family === "google") return "https://generativelanguage.googleapis.com";
  if (isGroqVendor(vendor)) return GROQ_API_BASE_URL;
  const normalized = (vendor ?? "").trim().toLowerCase();
  if (normalized.includes("openai")) return OPENAI_API_BASE_URL;
  if (normalized.includes("mistral")) return "https://api.mistral.ai/v1";
  return undefined;
}

/** Whether a models-list response names the model: OpenAI-compatible and Anthropic lists carry
 * `data[].id`, Google carries `models[].name` as "models/<id>". Null = the body is not a list we can read. */
export function modelListedIn(list: unknown, family: LlmProviderFamily, model: string): boolean | null {
  if (!list || typeof list !== "object") return null;
  const rows = (list as Record<string, unknown>)[family === "google" ? "models" : "data"];
  if (!Array.isArray(rows)) return null;
  const want = model.trim();
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const raw = (row as Record<string, unknown>)[family === "google" ? "name" : "id"];
    return typeof raw === "string" && raw.replace(/^models\//u, "") === want;
  });
}
