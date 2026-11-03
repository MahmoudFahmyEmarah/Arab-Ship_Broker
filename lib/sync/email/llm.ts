// Build a LangChain chat model from the active, Vault-encrypted LLM credential.
// The plaintext key is decrypted server-side (get_llm_secret) and stays here —
// it never reaches the browser. Vendor decides the client (Anthropic vs OpenAI-
// compatible); base_url allows proxies / self-hosted gateways.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { isSafeBaseUrl } from "@/lib/sync/guards";
import { canonicalVendor, modelChoiceRefusal, openAiCompatibleBaseUrl, vendorFamily } from "@/lib/sync/llm-provider";

export interface ActiveModel {
  model: BaseChatModel;
  vendor: string;
  modelName: string;
}

/** opts.maxOutputTokens caps the provider's reply (Data Quality reserves budget against it). */
export async function getActiveModel(supabase: SupabaseClient, opts: { maxOutputTokens?: number } = {}): Promise<ActiveModel> {
  const maxTokens = Math.max(256, Math.min(32_000, Math.round(opts.maxOutputTokens ?? 4096)));
  const { data: cred, error } = await supabase
    .from("llm_credential")
    .select("id, vendor, model, base_url")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Reading the active LLM key: ${error.message}`);
  if (!cred) throw new Error("No active LLM key. Add one in Data Sync → Settings.");

  // The active row is held to the save/Test/Activate rule BEFORE its secret is decrypted (C2O-188): the canonical
  // vendor picks the client (no substring guess), an unknown vendor or an id outside the provider's list fails
  // closed, and a custom gateway ("other") must name its own safe base URL — its key never goes to a default host.
  const vendor = canonicalVendor(cred.vendor as string | null);
  if (!vendor) throw new Error(`The active LLM key's provider "${String(cred.vendor)}" is not supported. Edit it in Data Sync → Connections and choose a provider from the list.`);
  const modelName = String(cred.model ?? "").trim();
  if (!modelName || modelName === "unset") throw new Error("The active LLM key has no model id. Edit it in Data Sync → Connections and choose one.");
  const refusal = modelChoiceRefusal(vendor, modelName);
  if (refusal) throw new Error(`The active LLM key cannot be used — ${refusal} Edit it in Data Sync → Connections.`);
  const baseUrl = (cred.base_url as string | null)?.trim() || undefined;
  if (baseUrl) {
    const safe = isSafeBaseUrl(baseUrl);
    if (!safe.ok) throw new Error(`Stored LLM base URL rejected — ${safe.reason}. Edit the credential in Data Sync → Connections.`);
  } else if (vendor === "other") {
    throw new Error("The active LLM key is a custom gateway with no base URL. Edit it in Data Sync → Connections and enter the gateway's URL.");
  }
  const family = vendorFamily(vendor);

  const { data: secret, error: sErr } = await supabase.rpc("get_llm_secret", { p_id: cred.id });
  if (sErr) throw new Error(`Decrypting the LLM key: ${sErr.message}`);
  if (!secret) throw new Error("The active LLM key has no stored secret.");

  let model: BaseChatModel;
  if (family === "anthropic") {
    // no `temperature`: the current Claude models reject it ("temperature is deprecated for this model", 400 on
    // every classification batch, 1 Nov 2026); the structured-output schema keeps the extraction deterministic
    model = new ChatAnthropic({
      apiKey: secret as string, model: modelName, maxTokens,
      ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
    });
  } else if (family === "google") {
    model = new ChatGoogleGenerativeAI({
      apiKey: secret as string, model: modelName, temperature: 0, maxOutputTokens: maxTokens,
      ...(baseUrl ? { baseUrl } : {}),
    });
  } else {
    const compatibleBaseUrl = openAiCompatibleBaseUrl(vendor, baseUrl);
    model = new ChatOpenAI({
      apiKey: secret as string, model: modelName, temperature: 0, maxTokens,
      ...(compatibleBaseUrl ? { configuration: { baseURL: compatibleBaseUrl } } : {}),
    });
  }

  return { model, vendor, modelName };
}
