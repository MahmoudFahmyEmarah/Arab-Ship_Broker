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

// Every family/default helper reads the CANONICAL vendor (C2O-188/C2O-190): no substring match is left anywhere.
// The exact legacy value `custom` remains a gateway alias, while arbitrary spellings such as `custom-ish` are
// refused by callers when canonicalVendor() returns null.
export function isGroqVendor(vendor?: string | null): boolean {
  return canonicalVendor(vendor) === "groq";
}

/** The client family of a canonical vendor. */
export function vendorFamily(vendor: LlmVendor): LlmProviderFamily {
  if (vendor === "anthropic") return "anthropic";
  if (vendor === "google") return "google";
  return "openai-compatible";
}

export function llmProviderFamily(vendor?: string | null): LlmProviderFamily {
  const v = canonicalVendor(vendor);
  return v ? vendorFamily(v) : "openai-compatible";
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
 * free-text escape hatch for ids that are not listed yet. Anthropic: the current lineup per the provider's
 * models overview (27 Oct 2026) — claude-haiku-5-5 first, the model Anthropic recommends for high-volume
 * classification and extraction (what Data Sync does), then claude-sonnet-5-5 and claude-opus-5-5; then the
 * still-available legacy claude-sonnet-5 / claude-haiku-4-5. Retired ids such as claude-sonnet-4-5 answer
 * 404 "model: … not found", which is how the circular classifier failed on 27 Oct 2026. Every picker on the
 * platform reads this table (Platform settings, the legacy-key import), so the ids cannot drift apart again. */
export const LLM_MODEL_SUGGESTIONS: Record<string, readonly string[]> = {
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"],
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

/** The vendors a key can be saved under, in form order. "other" is the one deliberate custom-gateway choice and the
 * only vendor whose model is typed rather than picked from the catalogue. */
export const LLM_VENDORS = ["anthropic", "openai", "google", "groq", "mistral", "other"] as const;
export type LlmVendor = (typeof LLM_VENDORS)[number];

// Legacy spellings seen in stored rows and old settings, mapped onto a catalogue vendor. Deliberately exact (no
// substring match). The only alias onto "other" is the legacy UI's literal `custom`; arbitrary names must not
// unlock the free-text model.
const VENDOR_ALIASES: Record<string, LlmVendor> = {
  claude: "anthropic", "anthropic claude": "anthropic",
  gemini: "google", "google gemini": "google", "google ai": "google",
  "open ai": "openai", "groq cloud": "groq", groqcloud: "groq", "mistral ai": "mistral", mistralai: "mistral",
  custom: "other",
};

/** One vendor parser for the form, server, import and runtime (C2O-186/C2O-190): any casing or exact known alias
 * becomes canonical; legacy `custom` becomes `other`; anything else ("OpenAI-compatible", a typo, "")
 * is null — the caller refuses it, so no spelling bypasses the catalogue-only model rule. */
export function canonicalVendor(vendor?: string | null): LlmVendor | null {
  const n = (vendor ?? "").trim().toLowerCase().replace(/[\s_-]+/gu, " ");
  if ((LLM_VENDORS as readonly string[]).includes(n)) return n as LlmVendor;
  return VENDOR_ALIASES[n] ?? null;
}

/** The API root a vendor is called at when no base URL is stored — shown in the form so an empty
 * field reads as "provider default", not as "missing". Unknown vendors have no default. */
export function llmDefaultBaseUrl(vendor?: string | null): string | undefined {
  const family = llmProviderFamily(vendor);
  if (family === "anthropic") return "https://api.anthropic.com";
  if (family === "google") return "https://generativelanguage.googleapis.com";
  const v = canonicalVendor(vendor);
  if (v === "groq") return GROQ_API_BASE_URL;
  if (v === "openai") return OPENAI_API_BASE_URL;
  if (v === "mistral") return "https://api.mistral.ai/v1";
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

/** A stored model id for a vendor, mapped onto the catalogue: an id the catalogue lists is kept; an empty or
 * unlisted id for a vendor that has a catalogue becomes that vendor's default (so a retired id imported from
 * old settings never becomes the active classifier model); a vendor without a catalogue keeps what it has. */
export function catalogueModel(vendor: string, model?: string | null): string {
  const list = LLM_MODEL_SUGGESTIONS[canonicalVendor(vendor) ?? "other"] ?? [];
  const m = (model ?? "").trim();
  if (list.length === 0) return m;
  return list.includes(m) ? m : list[0];
}

/** A key's model must come from the catalogue when the vendor has one (owner, 1 Nov 2026: a dropdown, never free
 * text, so the stored id is always one the provider serves). Null when acceptable; otherwise the refusal text.
 * A vendor without a catalogue ("other": a gateway you host) keeps a typed id. */
export function modelChoiceRefusal(vendor: string, model: string): string | null {
  // canonical first (C2O-186): an alias or casing of a listed provider is held to that provider's list, an
  // unknown vendor is refused, and only canonical "other" accepts a typed id
  const v = canonicalVendor(vendor);
  if (!v) return `Choose the provider from the list (${LLM_VENDORS.join(", ")}).`;
  if (v === "other") return (model ?? "").trim() ? null : "Type the exact model id your gateway serves.";
  const list = LLM_MODEL_SUGGESTIONS[v] ?? [];
  return list.includes((model ?? "").trim()) ? null : `Choose the model from the list for ${v} (${list.join(", ")}).`;
}

/** The model for the app's direct Anthropic calls (circular parsing, Group Mail polish) when they run on the
 * ANTHROPIC_API_KEY env instead of a Data Sync credential: quality-sensitive single calls, so the current
 * Opus. Lives here so every runtime Anthropic id comes from one reviewed table. */
export const ANTHROPIC_TASK_MODEL = "claude-opus-5-5";

/** The legacy Platform settings save (C2O-176): Vault is the only key path, so a stored plaintext key blocks
 * the save until it is imported (no read-modify-write can restore it after an import), and otherwise the
 * stored key is always "" — the browser's value is never used. */
export function legacyKeyForSave(storedKey: unknown): { ok: true; apiKey: "" } | { ok: false; error: string } {
  if (typeof storedKey === "string" && storedKey.trim().length > 0) {
    return { ok: false, error: "A plaintext AI key is still stored in the old settings. Import it into Vault first (Data Sync → Connections → Import), then save again." };
  }
  return { ok: true, apiKey: "" };
}

/** Membership of a model in an OpenAI-compatible gateway's models list: present → true; absent or unreadable
 * → null (a gateway's list may be paginated or filtered, so absence is not proof — only Anthropic's and
 * Google's per-model routes give a definitive "not found"). */
export function openAiCompatibleModelFound(list: unknown, model: string): true | null {
  return modelListedIn(list, "openai-compatible", model) === true ? true : null;
}

/** Whether a provider test result may make a key the classifier key (C2O-178): Anthropic and Google expose a
 * per-model route, so only a confirmed model (true) activates; an OpenAI-compatible gateway that authenticated
 * but cannot confirm ids (null) may activate. A failed or unreadable test never activates. */
export function mayActivate(family: LlmProviderFamily, modelFound: boolean | null): boolean {
  return modelFound === true || (modelFound === null && family === "openai-compatible");
}

/** The answer of set_active_llm_credential_if_unchanged, as the owner reads it. */
export function activationRefusal(result: string): string | null {
  if (result === "activated") return null;
  if (result === "changed") return "the key was edited after it was tested — test it again, then activate";
  if (result === "not_found") return "the key no longer exists";
  return `unexpected answer from the database (${result})`;
}
