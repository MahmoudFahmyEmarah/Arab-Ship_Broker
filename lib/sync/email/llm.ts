// Build a LangChain chat model from the active, Vault-encrypted LLM credential.
// The plaintext key is decrypted server-side (get_llm_secret) and stays here —
// it never reaches the browser. Vendor decides the client (Anthropic vs OpenAI-
// compatible); base_url allows proxies / self-hosted gateways.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface ActiveModel {
  model: BaseChatModel;
  vendor: string;
  modelName: string;
}

export async function getActiveModel(supabase: SupabaseClient): Promise<ActiveModel> {
  const { data: cred, error } = await supabase
    .from("llm_credential")
    .select("id, vendor, model, base_url")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Reading the active LLM key: ${error.message}`);
  if (!cred) throw new Error("No active LLM key. Add one in Data Sync → Settings.");

  const { data: secret, error: sErr } = await supabase.rpc("get_llm_secret", { p_id: cred.id });
  if (sErr) throw new Error(`Decrypting the LLM key: ${sErr.message}`);
  if (!secret) throw new Error("The active LLM key has no stored secret.");

  const vendor = String(cred.vendor).toLowerCase();
  const modelName = String(cred.model);
  const baseUrl = (cred.base_url as string | null)?.trim() || undefined;
  const isAnthropic = vendor.includes("anthropic") || vendor.includes("claude");
  const isGoogle = vendor.includes("google") || vendor.includes("gemini");

  let model: BaseChatModel;
  if (isAnthropic) {
    model = new ChatAnthropic({
      apiKey: secret as string, model: modelName, temperature: 0, maxTokens: 4096,
      ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
    });
  } else if (isGoogle) {
    model = new ChatGoogleGenerativeAI({
      apiKey: secret as string, model: modelName, temperature: 0,
      ...(baseUrl ? { baseUrl } : {}),
    });
  } else {
    model = new ChatOpenAI({
      apiKey: secret as string, model: modelName, temperature: 0,
      ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
    });
  }

  return { model, vendor, modelName };
}
