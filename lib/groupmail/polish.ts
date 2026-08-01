// Group Mail — AI review of the circular body (server-only). Two modes:
//   proofread — grammar/spelling/punctuation only
//   rephrase  — light professional polish, least change necessary
// Uses the Data Sync module's managed LLM credential (Vault) with the
// ANTHROPIC_API_KEY env as fallback, mirroring lib/circulars/engine.ts.
// Hard guardrails: facts/figures/terms untouched, no added content, output is
// the plain edited body only.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PolishMode = "proofread" | "rephrase";

const RULES = `You edit shipping-circular emails for Arab ShipBroker, a MENA dry-cargo brokerage.
HARD RULES:
- Preserve every fact, figure, quantity, rate, name, date, port and cargo term EXACTLY as written.
- Do not add or remove information, greetings, sign-offs or links that are not in the original.
- Keep the author's structure and paragraph breaks; keep roughly the same length.
- Maritime jargon and abbreviations (MT, DWT, laycan, MOLOO, CQD, WWD, SHINC, FHEX, NOR…) are correct — never "fix" them.
- The result must sound professional but natural and human — no corporate clichés, no filler.
- Output ONLY the edited email body as plain text. No preamble, no quotes, no markdown, no commentary.`;

const MODE_TASK: Record<PolishMode, string> = {
  proofread: "TASK: Correct grammar, spelling and punctuation only. Change nothing else — if a sentence is already correct, leave it word-for-word.",
  rephrase: "TASK: Lightly rewrite for a more professional, polished tone with the LEAST change necessary. Meaning, facts and order must stay identical.",
};

export async function polishCircularBody(
  supabase: SupabaseClient,
  body: string,
  mode: PolishMode,
): Promise<string> {
  const system = `${RULES}\n\n${MODE_TASK[mode]}`;
  const user = `Email body to edit:\n\n${body}`;

  let raw: string;
  if (process.env.ANTHROPIC_API_KEY) {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: "claude-opus-4-8",
      temperature: 0.2,
      maxTokens: 4096,
    });
    const res = await model.invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  } else {
    const { getActiveModel } = await import("@/lib/sync/email/llm");
    const { model } = await getActiveModel(supabase);
    const res = await model.invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  }

  // Strip an accidental code fence / surrounding quotes; keep everything else.
  const text = raw.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if (!text) throw new Error("The reviewer returned an empty result — keep your text.");
  return text;
}
