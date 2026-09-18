// Data Quality — the batch engine (server only, service role).
//
// A run is a row in dq_runs. fn_dq_process_batch (SQL) evaluates every
// applicable rule over one key range of the current table and upserts
// dq_issues; this module drives it batch by batch within a time budget, adds
// the AI review step (masked sample → proposals) and re-kicks itself through
// /api/dq/engine so long runs survive the caller. Runs never lock member
// tables: every batch is a plain SELECT over a key range.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthorized } from "@/lib/cron/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { startJobRun, finishJobRun } from "@/lib/jobs/runs";
import { runAiReview } from "./ai";
import type { DqRule, DqRun, DqSettings } from "./types";

export type BatchStep =
  | { done: true; status: string }
  | { done: false; batch_id: string; n: number; table: string; key_from: string; key_to: string; rows: number; rules: number; found: { error: number; warn: number; info: number }; errors: string[] };

export function dqDb(): SupabaseClient { return getSupabaseAdminClient(); }

export async function getSettings(sb: SupabaseClient): Promise<DqSettings> {
  const { data, error } = await sb.from("dq_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(error.message);
  return data as DqSettings;
}

async function aiBudgetLeft(sb: SupabaseClient, settings: DqSettings): Promise<{ used: number; left: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from("dq_ai_usage").select("tokens").eq("day", day).maybeSingle();
  const used = Number((data as { tokens?: number } | null)?.tokens ?? 0);
  return { used, left: Math.max(0, Number(settings.ai_daily_tokens) - used) };
}

// One atomic statement (insert … on conflict do update set tokens = tokens + …)
// so two batches in flight cannot lose each other's tokens (audit C3).
async function meterAi(sb: SupabaseClient, tokens: number, cost: number) {
  await sb.rpc("fn_dq_meter_ai", { p_tokens: Math.round(tokens), p_cost: cost });
}

/** AI review of the batch that fn_dq_process_batch just finished. Writes proposals only. */
async function aiStep(sb: SupabaseClient, run: DqRun, step: Extract<BatchStep, { done: false }>, settings: DqSettings): Promise<void> {
  const budget = await aiBudgetLeft(sb, settings);
  if (budget.left <= 0) {
    const note = `AI budget exhausted at batch ${step.n} — daily token cap ${settings.ai_daily_tokens.toLocaleString()} reached. Rule-based results were saved.`;
    if (!run.note?.includes("AI budget exhausted")) await sb.from("dq_runs").update({ note: run.note ? `${run.note} · ${note}` : note }).eq("id", run.id);
    return;
  }
  const { data: tinfo } = await sb.from("dq_tables").select("label").eq("table_name", step.table).single();
  const { data: sample, error: sErr } = await sb.rpc("fn_dq_sample_rows", { p_table: step.table, p_from: step.key_from, p_to: step.key_to, p_n: settings.ai_sample, p_scope: run.scope });
  if (sErr) throw new Error(`sampling ${step.table}: ${sErr.message}`);
  const rows = (sample ?? []) as Record<string, unknown>[];
  if (!rows.length) return;

  let rq = sb.from("dq_rules").select("id, code, name, description, ai_prompt, kind, severity").eq("enabled", true).is("deleted_at", null).contains("tables", [step.table]);
  if (run.rule_ids?.length) rq = rq.in("id", run.rule_ids);
  const { data: rules } = await rq;
  const ruleList = (rules ?? []) as Pick<DqRule, "id" | "code" | "name" | "description" | "ai_prompt" | "kind" | "severity">[];

  const jobId = await startJobRun(sb, "dq-ai-review", { trigger: "admin", meta: { run: run.code, table: step.table, batch: step.n, rows: rows.length } });
  let result;
  try {
    result = await runAiReview(sb, { table: step.table, tableLabel: (tinfo as { label: string } | null)?.label ?? step.table, rows, rules: ruleList });
  } catch (e) {
    await finishJobRun(sb, jobId, { ok: false, error: e instanceof Error ? e.message : String(e) });
    const note = `AI review failed on batch ${step.n} (${step.table}): ${e instanceof Error ? e.message : String(e)}`;
    await sb.from("dq_runs").update({ note: run.note ? `${run.note} · ${note}`.slice(0, 2000) : note }).eq("id", run.id);
    return;
  }
  const cost = (result.tokens / 1_000_000) * Number(settings.ai_price_per_mtok);
  await meterAi(sb, result.tokens, cost);
  if (result.parseFailed) {
    const note = `AI reply on batch ${step.n} (${step.table}) was not JSON — tokens spent, no findings recorded.`;
    await sb.from("dq_runs").update({ note: run.note ? `${run.note} · ${note}`.slice(0, 2000) : note }).eq("id", run.id);
    await sb.from("dq_run_batches").update({ error: "AI reply was not JSON" }).eq("id", step.batch_id);
  }

  // issues → dq_issues (source ai); fixes grouped into one approval card
  const ruleByCode = new Map(ruleList.map((r) => [r.code, r.id]));
  const byKey = new Map(rows.map((r) => [String(r.__key), r]));
  const issueIds: string[] = [];
  const evidence: string[] = [];
  let confSum = 0;
  for (const it of result.issues) {
    const row = byKey.get(it.row_key);
    const label = row ? String(row.__label ?? it.row_key) : it.row_key;
    const ruleCode = it.rule_code ?? "AI";
    const fix = it.fix_value != null && it.field ? { field: it.field, value: it.fix_value, before: it.observed, after: it.fix_value, rationale: it.why, confidence: it.confidence, kind: "suggest only" } : null;
    const { data: existing } = await sb.from("dq_issues").select("id").eq("rule_code", ruleCode).eq("table_name", step.table).eq("row_key", it.row_key).eq("status", "open")
      .filter("field", it.field == null ? "is" : "eq", it.field == null ? null : it.field).maybeSingle();
    const snapshot = row ? Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("__"))) : null;
    const patch = {
      rule_id: ruleByCode.get(ruleCode) ?? null, rule_code: ruleCode, run_id: run.id, table_name: step.table, row_key: it.row_key, row_label: label, field: it.field,
      observed: it.observed, expected: it.expected, severity: it.severity, category: it.category, source: "ai", confidence: it.confidence, evidence: it.evidence, why: it.why,
      snapshot, fix, last_seen: new Date().toISOString(),
    };
    let id: string | null = null;
    if (existing) { await sb.from("dq_issues").update(patch).eq("id", (existing as { id: string }).id); id = (existing as { id: string }).id; }
    else { const { data: ins } = await sb.from("dq_issues").insert(patch).select("id").single(); id = (ins as { id: string } | null)?.id ?? null; }
    if (id && fix) { issueIds.push(id); confSum += it.confidence; if (evidence.length < 6) evidence.push(`${label} · ${it.field}: ${it.observed ?? "—"} → ${it.fix_value}`); }
  }
  if (issueIds.length) {
    await sb.from("dq_ai_suggestions").insert({
      kind: "fix", title: `${issueIds.length} AI-proposed fix${issueIds.length > 1 ? "es" : ""} on ${(tinfo as { label: string } | null)?.label ?? step.table} (${run.code} · batch ${step.n})`,
      nl: `The model proposed replacement values for ${issueIds.length} field${issueIds.length > 1 ? "s" : ""} in the sampled rows. Each applies through the audited edit RPC and can be undone from Recent edits.`,
      tables: [step.table], hits: issueIds.length, evidence, model: result.model, confidence: confSum / issueIds.length, issue_ids: issueIds, run_id: run.id,
    });
  }
  for (const sr of result.suggestedRules) {
    const { data: dup } = await sb.from("dq_ai_suggestions").select("id").eq("kind", "rule").eq("status", "pending").ilike("title", sr.title).maybeSingle();
    if (dup) continue;
    await sb.from("dq_ai_suggestions").insert({ kind: "rule", title: sr.title, nl: sr.nl, sql: sr.sql, category: sr.category, severity: sr.severity, tables: [step.table], hits: 0, evidence: [], model: result.model, confidence: sr.confidence, run_id: run.id });
  }

  await sb.rpc("fn_dq_run_add_ai", { p_run_id: run.id, p_tokens: Math.round(result.tokens), p_cost: cost, p_issues: result.issues.length });
  await sb.from("dq_run_batches").update({ ai_tokens: result.tokens, ai_issues: result.issues.length }).eq("id", step.batch_id);
  await finishJobRun(sb, jobId, { ok: true, rows: rows.length, meta: { tokens: result.tokens, cost, issues: result.issues.length, rules: result.suggestedRules.length, model: result.model } });
}

/** One batch: SQL rules, then (mode ai/both) the AI review of the same range. */
export async function processOneBatch(sb: SupabaseClient, runId: string): Promise<BatchStep> {
  const { data: run, error } = await sb.from("dq_runs").select("*").eq("id", runId).single();
  if (error || !run) throw new Error(error?.message ?? "run not found");
  const r = run as DqRun;
  // queued → first batch; paused → resume from the saved cursor (audit C1:
  // only "queued" prepared before, so Resume silently did nothing)
  if (r.status === "queued" || r.status === "paused") {
    const { error: pErr } = await sb.rpc("fn_dq_prepare_run", { p_run_id: runId });
    if (pErr) throw new Error(pErr.message);
  } else if (r.status !== "running") {
    return { done: true, status: r.status };
  }
  const { data, error: bErr } = await sb.rpc("fn_dq_process_batch", { p_run_id: runId });
  if (bErr) {
    await sb.rpc("fn_dq_finish_run", { p_run_id: runId, p_status: "failed", p_error: bErr.message });
    return { done: true, status: "failed" };
  }
  const step = data as BatchStep;
  if (!step.done && r.mode !== "rules") {
    try {
      const settings = await getSettings(sb);
      const { data: fresh } = await sb.from("dq_runs").select("*").eq("id", runId).single();
      await aiStep(sb, (fresh ?? r) as DqRun, step, settings);
    } catch (e) {
      const note = `AI step skipped on batch ${step.n}: ${e instanceof Error ? e.message : String(e)}`;
      await sb.from("dq_runs").update({ note }).eq("id", runId);
    }
  }
  return step;
}

/** Drive a run until it finishes, pauses, or the time budget is spent. */
const consecutiveErrors = new Map<string, number>();

export async function driveRun(runId: string, budgetMs = 45_000): Promise<{ done: boolean; status: string; batches: number; error?: string }> {
  const sb = dqDb();
  const t0 = Date.now();
  let batches = 0;
  let last: BatchStep = { done: false } as BatchStep;
  while (Date.now() - t0 < budgetMs) {
    try {
      last = await processOneBatch(sb, runId);
    } catch (e) {
      // A lost connection or an RPC timeout used to escape as a bare 500 and
      // leave the run "running" until the stall timer noticed (audit C9).
      // Record it on the run, let the caller re-kick, and stop after three
      // failures in a row so a persistent fault cannot loop forever.
      const msg = e instanceof Error ? e.message : String(e);
      const n = (consecutiveErrors.get(runId) ?? 0) + 1;
      consecutiveErrors.set(runId, n);
      const note = `engine error (${n}/3): ${msg}`;
      await sb.from("dq_runs").update({ note }).eq("id", runId).then(() => undefined, () => undefined);
      if (n >= 3) {
        consecutiveErrors.delete(runId);
        await sb.rpc("fn_dq_finish_run", { p_run_id: runId, p_status: "failed", p_error: msg }).then(() => undefined, () => undefined);
        return { done: true, status: "failed", batches, error: msg };
      }
      return { done: false, status: "running", batches, error: msg };
    }
    consecutiveErrors.delete(runId);
    if (last.done) return { done: true, status: last.status, batches };
    batches += 1;
  }
  const { data } = await sb.from("dq_runs").select("status").eq("id", runId).single();
  return { done: false, status: (data as { status: string } | null)?.status ?? "running", batches };
}

// Bearer CRON_SECRET only (phase 0, 18 Sep 2026): the x-vercel-cron header
// used to be accepted as proof of origin; it is a plain header any caller can
// add. lib/cron/auth.ts holds the one rule for every scheduled endpoint.
export function engineSecretOk(authorization: string | null): boolean {
  return cronAuthorized(authorization);
}

/** Fire-and-forget POST to the engine route so the run continues server-side. */
export async function kickEngine(runId: string, baseUrl: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  try {
    await fetch(`${baseUrl}/api/dq/engine`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ runId }),
      cache: "no-store",
    });
  } catch {
    // the UI poller (tickRun) picks the run up when the chain breaks
  }
}

/** A run whose last batch is older than this is treated as stalled and re-kicked by the poller. */
export const STALL_MS = 90_000;
