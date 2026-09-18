// Token metering for the circular classifier — the same daily budget the Data
// quality module spends from (dq_ai_usage, dq_settings.ai_daily_tokens), so the
// Intake tile can say "Model · budget today" truthfully.
//
// withStructuredOutput() strips usage_metadata from what invoke() returns, so
// the meter listens as a LangChain callback instead: every model call that
// finishes reports its token usage here, regardless of how it was wrapped.

import type { SupabaseClient } from "@supabase/supabase-js";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";

export interface UsageTotals { tokens: number; calls: number }

export class UsageMeter extends BaseCallbackHandler {
  name = "asb_usage_meter";
  tokens = 0;
  calls = 0;
  /** Rough fallback when a provider returns no usage block: ~4 chars/token. */
  private pendingChars = 0;

  handleLLMStart(_llm: unknown, prompts: string[]): void {
    this.pendingChars = prompts.reduce((a, p) => a + p.length, 0);
  }
  handleChatModelStart(_llm: unknown, messages: unknown[][]): void {
    this.pendingChars = JSON.stringify(messages).length;
  }
  handleLLMEnd(output: LLMResult): void {
    this.calls += 1;
    const usage = (output.llmOutput as { tokenUsage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number } } | undefined)?.tokenUsage;
    let total = usage?.totalTokens ?? ((usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0));
    if (!total) {
      // Gemini/Anthropic report per-message usage_metadata instead of llmOutput.
      for (const gen of output.generations.flat()) {
        const m = (gen as { message?: { usage_metadata?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } } }).message;
        const u = m?.usage_metadata;
        if (u) total += u.total_tokens ?? ((u.input_tokens ?? 0) + (u.output_tokens ?? 0));
      }
    }
    if (!total) total = Math.ceil((this.pendingChars + JSON.stringify(output.generations).length) / 4);
    this.tokens += total;
    this.pendingChars = 0;
  }
  totals(): UsageTotals { return { tokens: this.tokens, calls: this.calls }; }
}

export interface AiBudget { used: number; cap: number; left: number; pricePerMtok: number; cost: number; calls: number }

/** Today's usage against the daily cap. Never throws — a missing settings row
 *  simply means "no cap configured", which is reported as Infinity. */
export async function aiBudgetToday(sb: SupabaseClient): Promise<AiBudget> {
  const day = new Date().toISOString().slice(0, 10);
  const [{ data: settings }, { data: usage }] = await Promise.all([
    sb.from("dq_settings").select("ai_daily_tokens, ai_price_per_mtok").eq("id", 1).maybeSingle(),
    sb.from("dq_ai_usage").select("tokens, cost, calls").eq("day", day).maybeSingle(),
  ]);
  const cap = Number((settings as { ai_daily_tokens?: number } | null)?.ai_daily_tokens ?? Number.POSITIVE_INFINITY);
  const pricePerMtok = Number((settings as { ai_price_per_mtok?: number } | null)?.ai_price_per_mtok ?? 0);
  const used = Number((usage as { tokens?: number } | null)?.tokens ?? 0);
  return {
    used, cap, left: Math.max(0, cap - used), pricePerMtok,
    cost: Number((usage as { cost?: number } | null)?.cost ?? 0),
    calls: Number((usage as { calls?: number } | null)?.calls ?? 0),
  };
}

/** Record a run's tokens atomically (fn_dq_meter_ai upserts the day row). Returns
 *  the cost charged so the run can report it. Never throws. */
export async function meterUsage(sb: SupabaseClient, totals: UsageTotals, pricePerMtok: number): Promise<number> {
  if (totals.tokens <= 0) return 0;
  const cost = Number(((totals.tokens / 1_000_000) * pricePerMtok).toFixed(4));
  try {
    // fn_dq_meter_ai counts one call per invocation; add the rest as no-token calls
    // so `calls` stays honest without a schema change.
    await sb.rpc("fn_dq_meter_ai", { p_tokens: Math.round(totals.tokens), p_cost: cost });
    for (let i = 1; i < totals.calls; i += 1) await sb.rpc("fn_dq_meter_ai", { p_tokens: 0, p_cost: 0 });
  } catch { /* metering must never fail the run */ }
  return cost;
}
