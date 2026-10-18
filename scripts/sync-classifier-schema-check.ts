// The email classifier's structured-output schema must pass STRICT validation on OpenAI-compatible providers
// (OpenAI, Groq): every object lists every property in `required`, and no extra properties are allowed.
// 18 Oct 2026: Groq openai/gpt-oss-20b rejected every batch because the vessel/cargo fields were .optional().
// This builds the real ChatOpenAI request through LangChain with a capturing fetch (no network, no key) and
// checks the json_schema it would send. Run: node --import tsx scripts/sync-classifier-schema-check.ts
import assert from "node:assert/strict";
import { ChatOpenAI } from "@langchain/openai";
import { LangChainClassifier } from "../lib/sync/email/classifier";
import { GROQ_API_BASE_URL, GROQ_STRUCTURED_OUTPUT_MODELS } from "../lib/sync/llm-provider";

type Json = Record<string, unknown>;

function strictViolations(node: unknown, path: string, out: string[]): void {
  if (Array.isArray(node)) { node.forEach((n, i) => strictViolations(n, `${path}[${i}]`, out)); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Json;
  if (o.properties && typeof o.properties === "object") {
    const keys = Object.keys(o.properties as Json);
    const required = Array.isArray(o.required) ? (o.required as string[]) : [];
    const missing = keys.filter((k) => !required.includes(k));
    if (missing.length) out.push(`${path}: not in required → ${missing.join(", ")}`);
    if (o.additionalProperties !== false) out.push(`${path}: additionalProperties is not false`);
  }
  for (const [k, v] of Object.entries(o)) strictViolations(v, `${path}/${k}`, out);
}

async function requestBodyFor(model: string): Promise<Json> {
  let body: Json | null = null;
  const capture = async (_url: unknown, init?: { body?: unknown }) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Json;
    throw new Error("captured");
  };
  const llm = new ChatOpenAI({
    apiKey: "sk-test-not-a-key", model, temperature: 0, maxRetries: 0,
    configuration: { baseURL: GROQ_API_BASE_URL, fetch: capture as unknown as typeof fetch },
  });
  await new LangChainClassifier(llm)
    .classifyBatch([{ from: "desk@example.test", subject: "open position", date: null, text: "MV TEST open Izmir 09 Sep" } as never])
    .catch(() => {});
  assert.ok(body, `${model}: no request was built`);
  return body!;
}

(async () => {
  for (const model of GROQ_STRUCTURED_OUTPUT_MODELS) {
    const body = await requestBodyFor(model);
    const rf = body.response_format as Json | undefined;
    assert.equal(rf?.type, "json_schema", `${model}: expected a json_schema response_format, got ${JSON.stringify(rf?.type)}`);
    const js = rf!.json_schema as Json;
    assert.equal(js.name, "classify_batch");
    const out: string[] = [];
    strictViolations(js.schema, "#", out);
    assert.deepEqual(out, [], `${model}: schema would be rejected in strict mode:\n  ${out.join("\n  ")}`);
    // spot-check: the fields Groq named on 18 Oct are all present, required and nullable
    const vessel = (((js.schema as Json).properties as Json).results as Json);
    const vItem = ((((vessel.items as Json).properties as Json).vessels as Json).items as Json);
    for (const f of ["imo", "vessel_name", "open_date", "dest_zones"]) {
      assert.ok((vItem.required as string[]).includes(f), `${model}: vessel.${f} not required`);
      assert.ok(JSON.stringify((vItem.properties as Json)[f]).includes("null"), `${model}: vessel.${f} is not nullable`);
    }
    console.log(`  ok   ${model}: classify_batch schema is strict-valid (every property required, no extras)`);
  }
  console.log("SYNC CLASSIFIER SCHEMA: ALL ASSERTIONS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
