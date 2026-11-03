// Executable cases for the classifier runtime boundary (C2O-188): getActiveModel holds the ACTIVE row to the same
// rule as save/Test/Activate before it decrypts the secret — canonical vendor picks the client, an unknown vendor
// or an off-list model fails closed, and a custom gateway needs its own safe base URL. No network: the client
// objects are only constructed. Run: npx tsx scripts/llm-runtime-check.ts
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getActiveModel } from "../lib/sync/email/llm";
import { GROQ_API_BASE_URL } from "../lib/sync/llm-provider";

type Row = { vendor: string | null; model: string | null; base_url?: string | null };
function fake(row: Row) {
  let decrypted = 0;
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "k1", base_url: null, ...row }, error: null }) }) }) }),
    rpc: async () => { decrypted++; return { data: "sk-test-not-a-key", error: null }; },
  } as unknown as SupabaseClient;
  return { client, decrypted: () => decrypted };
}

let n = 0;
const t = async (name: string, fn: () => Promise<void>) => { await fn(); n++; console.log(`  ok   ${name}`); };

async function refused(row: Row, pattern: RegExp) {
  const f = fake(row);
  await assert.rejects(getActiveModel(f.client), pattern);
  assert.equal(f.decrypted(), 0, "a refused row is never decrypted");
}

async function main() {
  await t("an unknown vendor that merely contains 'claude' fails closed (no Anthropic guess)", () =>
    refused({ vendor: "claude-ish", model: "claude-haiku-5-5" }, /provider "claude-ish" is not supported/));
  await t("'custom' and 'OpenAI-compatible' active rows fail closed (no OpenAI guess)", async () => {
    await refused({ vendor: "custom", model: "custom-model", base_url: "https://gw.example.com/v1" }, /not supported/);
    await refused({ vendor: "OpenAI-compatible", model: "gpt-4o", base_url: "https://gw.example.com/v1" }, /not supported/);
    await refused({ vendor: null, model: "gpt-4o" }, /not supported/);
  });
  await t("a legacy-import placeholder model 'unset' fails closed", () =>
    refused({ vendor: "other", model: "unset", base_url: "https://gw.example.com/v1" }, /no model id/));
  await t("a listed provider with an off-list (retired) model fails closed", () =>
    refused({ vendor: "anthropic", model: "claude-sonnet-4-5" }, /cannot be used — Choose the model from the list for anthropic/));
  await t("an alias row is held to its provider's list", () =>
    refused({ vendor: "claude", model: "bogus" }, /for anthropic/));
  await t("a custom gateway without a base URL fails closed; an unsafe one is rejected", async () => {
    await refused({ vendor: "other", model: "my-model", base_url: null }, /custom gateway with no base URL/);
    await refused({ vendor: "other", model: "my-model", base_url: "http://127.0.0.1:8080/v1" }, /base URL rejected/);
  });
  await t("a stored 'Anthropic' row with a listed model builds ChatAnthropic under the canonical name", async () => {
    const f = fake({ vendor: "Anthropic", model: "claude-haiku-5-5" });
    const m = await getActiveModel(f.client);
    assert.ok(m.model instanceof ChatAnthropic);
    assert.deepEqual([m.vendor, m.modelName], ["anthropic", "claude-haiku-5-5"]);
    assert.equal(f.decrypted(), 1);
  });
  await t("google and groq build their clients", async () => {
    assert.ok((await getActiveModel(fake({ vendor: "google", model: "gemini-3.5-flash" }).client)).model instanceof ChatGoogleGenerativeAI);
    const groq = (await getActiveModel(fake({ vendor: "groq", model: "openai/gpt-oss-20b" }).client)).model;
    assert.ok(groq instanceof ChatOpenAI);
    assert.equal((groq as unknown as { clientConfig: { baseURL?: string } }).clientConfig.baseURL, GROQ_API_BASE_URL, "groq goes to its official root");
  });
  await t("canonical 'other' with a safe base URL and a typed model builds the compatible client", async () => {
    const m = await getActiveModel(fake({ vendor: "other", model: "my-gateway-model", base_url: "https://gw.example.com/v1" }).client);
    assert.ok(m.model instanceof ChatOpenAI);
    assert.deepEqual([m.vendor, m.modelName], ["other", "my-gateway-model"]);
    assert.equal((m.model as unknown as { clientConfig: { baseURL?: string } }).clientConfig.baseURL, "https://gw.example.com/v1", "the gateway key goes to the gateway, never a default host");
  });
  console.log(`LLM runtime boundary: ${n} executable checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
