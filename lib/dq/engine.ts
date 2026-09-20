// Data Quality — the batch engine (server only, service role).
//
// A run is a row in dq_runs. fn_dq_process_batch (SQL) evaluates every
// applicable rule over one key range of the current table and upserts
// dq_issues; this module drives it batch by batch within a time budget, adds
// the AI review step (masked sample → proposals) and re-kicks itself through
// /api/dq/engine so long runs survive the caller. Runs never lock member
// tables: every batch is a plain SELECT over a key range.
//
// 20 Sep 2026:
//   · a batch the database cancelled for time (PostgREST's statement_timeout)
//     is not a failed run: fn_dq_batch_timeout halves the persisted batch
//     limit in its own transaction (the cancelled batch rolled back, so the
//     cursor never moved) and the loop tries again; the database fails the
//     run after three timeouts at the 10-row floor
//   · AI budget: one reservation per batch (idempotency key ai/<batch id>),
//     leased; settled with the provider's real usage or released on failure
//   · notifications: the database enqueues them; when a run ends this
//     invocation drains the outbox (bounded) — delivery is the worker's job
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthorized } from "@/lib/cron/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { startJobRun, finishJobRun } from "@/lib/jobs/runs";
import { runAiReview } from "./ai";
import { aiIdemKey, estimateAiTokens, isLockContention, isStatementTimeout, LOCK_RETRY_MAX, lockRetryDelayMs, must } from "./ai-budget";
import { deliverOutbox } from "./notify";
import type { DqRule, DqRun, DqSettings } from "./types";

export type BatchStep =
  | { done: true; status: string }
  /** the batch timed out; the limit was shrunk and the same range is tried again */
  | { done: false; timeout: true; batch_limit: number; status: string }
  /** the range is locked by another transaction; the size is fine, the caller re-kicks */
  | { done: false; timeout?: false; contended: true; attempts: number; status: string }
  | { done: false; timeout?: false; batch_id: string; n: number; table: string; key_from: string; key_to: string; rows: number; rules: number; limit?: number; next_limit?: number; ms?: number; found: { error: number; warn: number; info: number }; errors: string[] };

export function dqDb(): SupabaseClient { return getSupabaseAdminClient(); }

export async function getSettings(sb: SupabaseClient): Promise<DqSettings> {
  const { data, error } = await sb.from("dq_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(error.message);
  return data as DqSettings;
}

// Workstream F: the budget is RESERVED before the provider is called (one row
// lock in fn_dq_reserve_ai, one reservation row per batch), so concurrent
// batches cannot all read the same remaining budget; settlement meters the
// real usage and frees the reservation; a failure releases it; a reservation
// whose lease lapsed is reclaimed by the database.
export interface AiReservation { ok: boolean; left: number; reservationId: string | null; existing: boolean }
export async function reserveAi(sb: SupabaseClient, tokens: number, idemKey: string, batchId: string | null, ttlSeconds = 600): Promise<AiReservation> {
  const { data, error } = await sb.rpc("fn_dq_reserve_ai", { p_tokens: Math.round(tokens), p_idem_key: idemKey, p_batch_id: batchId, p_ttl_seconds: ttlSeconds });
  if (error) throw new Error(`AI budget reservation: ${error.message}`);
  const d = data as { ok?: boolean; left?: number; reservation_id?: string | null; existing?: boolean };
  return { ok: !!d?.ok, left: Number(d?.left ?? 0), reservationId: d?.reservation_id ?? null, existing: !!d?.existing };
}
export async function settleAi(sb: SupabaseClient, reservationId: string, tokens: number, cost: number): Promise<void> {
  must(await sb.rpc("fn_dq_settle_ai", { p_reservation: reservationId, p_tokens: Math.round(tokens), p_cost: cost }), "settle the AI reservation");
}
export async function releaseAi(sb: SupabaseClient, reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  await sb.rpc("fn_dq_release_ai", { p_reservation: reservationId }).then(() => undefined, () => undefined);
}

/** AI review of the batch that fn_dq_process_batch just finished. Writes proposals only. */
async function aiStep(sb: SupabaseClient, run: DqRun, step: Extract<BatchStep, { batch_id: string }>, settings: DqSettings): Promise<void> {
  // idempotent: a re-kicked batch that already spent its AI call does not spend again
  const { data: bstate } = await sb.from("dq_run_batches").select("ai_state").eq("id", step.batch_id).maybeSingle();
  if ((bstate as { ai_state?: string | null } | null)?.ai_state === "done") return;
  const { data: tinfo } = await sb.from("dq_tables").select("label").eq("table_name", step.table).single();
  const { data: sample, error: sErr } = await sb.rpc("fn_dq_sample_rows", { p_table: step.table, p_from: step.key_from, p_to: step.key_to, p_n: settings.ai_sample, p_scope: run.scope });
  if (sErr) throw new Error(`sampling ${step.table}: ${sErr.message}`);
  const rows = (sample ?? []) as Record<string, unknown>[];
  if (!rows.length) return;

  let rq = sb.from("dq_rules").select("id, code, name, description, ai_prompt, kind, severity").eq("enabled", true).is("deleted_at", null).contains("tables", [step.table]);
  if (run.rule_ids?.length) rq = rq.in("id", run.rule_ids);
  const { data: rules } = await rq;
  const ruleList = (rules ?? []) as Pick<DqRule, "id" | "code" | "name" | "description" | "ai_prompt" | "kind" | "severity">[];

  // reserve before calling — one reservation per batch; refuse when the cap would be exceeded
  const reserve = estimateAiTokens(rows.length, ruleList.length);
  const budget = await reserveAi(sb, reserve, aiIdemKey(step.batch_id), step.batch_id);
  if (!budget.ok) {
    const note = `AI budget exhausted at batch ${step.n} — daily token cap ${settings.ai_daily_tokens.toLocaleString()} reached (${budget.left.toLocaleString()} left, ${reserve.toLocaleString()} needed). Rule-based results were saved.`;
    if (!run.note?.includes("AI budget exhausted")) await sb.from("dq_runs").update({ note: run.note ? `${run.note} · ${note}` : note }).eq("id", run.id);
    await sb.from("dq_run_batches").update({ ai_state: "skipped" }).eq("id", step.batch_id);
    return;
  }
  await sb.from("dq_run_batches").update({ ai_state: "reserved" }).eq("id", step.batch_id);
  const jobId = await startJobRun(sb, "dq-ai-review", { trigger: "admin", meta: { run: run.code, table: step.table, batch: step.n, rows: rows.length, reservation: budget.reservationId } });
  let result;
  try {
    result = await runAiReview(sb, {
      table: step.table, tableLabel: (tinfo as { label: string } | null)?.label ?? step.table, rows, rules: ruleList,
      maxOutputTokens: Number(settings.ai_max_output_tokens ?? 4096),
    });
  } catch (e) {
    await releaseAi(sb, budget.reservationId);
    await finishJobRun(sb, jobId, { ok: false, error: e instanceof Error ? e.message : String(e) });
    const note = `AI review failed on batch ${step.n} (${step.table}): ${e instanceof Error ? e.message : String(e)}`;
    await sb.from("dq_runs").update({ note: run.note ? `${run.note} · ${note}`.slice(0, 2000) : note }).eq("id", run.id);
    await sb.from("dq_run_batches").update({ ai_state: "failed" }).eq("id", step.batch_id);
    return;
  }
  const cost = (result.tokens / 1_000_000) * Number(settings.ai_price_per_mtok);
  if (budget.reservationId) await settleAi(sb, budget.reservationId, result.tokens, cost);
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
    // identity includes the source (workstream B): an AI finding updates only an AI finding, never a rule's issue
    const { data: existing } = await sb.from("dq_issues").select("id").eq("source", "ai").eq("rule_code", ruleCode).eq("table_name", step.table).eq("row_key", it.row_key)
      .filter("field", it.field == null ? "is" : "eq", it.field == null ? null : it.field).maybeSingle();
    const snapshot = row ? Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("__"))) : null;
    const patch = {
      rule_id: ruleByCode.get(ruleCode) ?? null, rule_code: ruleCode, run_id: run.id, table_name: step.table, row_key: it.row_key, row_label: label, field: it.field,
      observed: it.observed, expected: it.expected, severity: it.severity, category: it.category, source: "ai", confidence: it.confidence, evidence: it.evidence, why: it.why,
      snapshot, fix, last_seen: new Date().toISOString(),
    };
    let id: string | null = null;
    if (existing) { must(await sb.from("dq_issues").update(patch).eq("id", (existing as { id: string }).id), "update AI issue"); id = (existing as { id: string }).id; }
    else { const ins = must(await sb.from("dq_issues").insert(patch).select("id").single(), "insert AI issue"); id = (ins.data as { id: string } | null)?.id ?? null; }
    if (id && fix) { issueIds.push(id); confSum += it.confidence; if (evidence.length < 6) evidence.push(`${label} · ${it.field}: ${it.observed ?? "—"} → ${it.fix_value}`); }
  }
  if (issueIds.length) {
    must(await sb.from("dq_ai_suggestions").insert({
      kind: "fix", title: `${issueIds.length} AI-proposed fix${issueIds.length > 1 ? "es" : ""} on ${(tinfo as { label: string } | null)?.label ?? step.table} (${run.code} · batch ${step.n})`,
      nl: `The model proposed replacement values for ${issueIds.length} field${issueIds.length > 1 ? "s" : ""} in the sampled rows. Each applies through the audited edit RPC and can be undone from Recent edits.`,
      tables: [step.table], hits: issueIds.length, evidence, model: result.model, confidence: confSum / issueIds.length, issue_ids: issueIds, run_id: run.id,
    }), "insert AI fix suggestion");
  }
  for (const sr of result.suggestedRules) {
    const { data: dup } = await sb.from("dq_ai_suggestions").select("id").eq("kind", "rule").eq("status", "pending").ilike("title", sr.title).maybeSingle();
    if (dup) continue;
    must(await sb.from("dq_ai_suggestions").insert({ kind: "rule", title: sr.title, nl: sr.nl, sql: sr.sql, category: sr.category, severity: sr.severity, tables: [step.table], hits: 0, evidence: [], model: result.model, confidence: sr.confidence, run_id: run.id }), "insert AI rule suggestion");
  }

  must(await sb.rpc("fn_dq_run_add_ai", { p_run_id: run.id, p_tokens: Math.round(result.tokens), p_cost: cost, p_issues: result.issues.length }), "add AI totals to the run");
  must(await sb.from("dq_run_batches").update({ ai_tokens: result.tokens, ai_issues: result.issues.length, ai_state: "done" }).eq("id", step.batch_id), "mark the batch's AI step done");
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
  // A contended range is retried here, in place, with a jittered wait: the
  // batch is the right size, another transaction simply held the rows. Only
  // when the whole short ladder is exhausted does the range go back to the
  // caller, which re-kicks on its own schedule.
  let attempt = 0;
  let res = await sb.rpc("fn_dq_process_batch", { p_run_id: runId });
  while (res.error && isLockContention(res.error.message, (res.error as { code?: string }).code) && attempt < LOCK_RETRY_MAX) {
    attempt += 1;
    if (attempt >= LOCK_RETRY_MAX) break;
    await new Promise<void>((r) => setTimeout(r, lockRetryDelayMs(attempt)));
    res = await sb.rpc("fn_dq_process_batch", { p_run_id: runId });
  }
  const { data, error: bErr } = res;
  if (bErr) {
    if (isLockContention(bErr.message, (bErr as { code?: string }).code)) {
      // NOT a timeout: the persisted batch limit is untouched, so throughput
      // does not decay because a neighbour held a lock. Recorded on the run
      // for the console, then handed back.
      const note = `batch ${attempt > 1 ? `contended after ${attempt} attempts` : "contended"}: ${bErr.message}`;
      await sb.from("dq_runs").update({ note: note.slice(0, 2000) }).eq("id", runId).then(() => undefined, () => undefined);
      return { done: false, contended: true, attempts: attempt, status: "running" };
    }
    if (isStatementTimeout(bErr.message, (bErr as { code?: string }).code)) {
      // The cancelled batch rolled back whole: no batch row, no cursor move.
      // Shrink the persisted limit in a separate transaction and try again;
      // the database fails the run after three timeouts at the floor.
      const { data: t, error: tErr } = await sb.rpc("fn_dq_batch_timeout", { p_run_id: runId, p_error: bErr.message });
      if (tErr) throw new Error(`batch timeout: ${tErr.message}`);
      const tt = (t ?? {}) as { status?: string; batch_limit?: number };
      if (tt.status === "failed") return { done: true, status: "failed" };
      return { done: false, timeout: true, batch_limit: Number(tt.batch_limit ?? 0), status: tt.status ?? "running" };
    }
    await sb.rpc("fn_dq_finish_run", { p_run_id: runId, p_status: "failed", p_error: bErr.message });
    return { done: true, status: "failed" };
  }
  const step = data as BatchStep;
  // `contended` joined the union, and it carries no batch: narrow on the
  // batch's own field rather than on "not done and not a timeout"
  if (!step.done && !step.timeout && !("contended" in step) && r.mode !== "rules") {
    try {
      const settings = await getSettings(sb);
      const { data: fresh } = await sb.from("dq_runs").select("*").eq("id", runId).single();
      await aiStep(sb, (fresh ?? r) as DqRun, step, settings);
    } catch (e) {
      const note = `AI step failed on batch ${step.n}: ${e instanceof Error ? e.message : String(e)}`;
      await sb.from("dq_runs").update({ note }).eq("id", runId);
      await sb.from("dq_run_batches").update({ ai_state: "failed", error: note.slice(0, 500) }).eq("id", step.batch_id).then(() => undefined, () => undefined);
    }
  }
  return step;
}

/** Drive a run until it finishes, pauses, or the time budget is spent. */
// The consecutive-error count used to live in a process-local Map here. A
// serverless invocation does not share memory with the next one, so the count
// restarted at zero on every cold start and the "stop after three" limit never
// actually bound: a permanently broken run could be re-kicked for ever, each
// invocation believing it was the first to fail. It is a column on dq_runs
// now, incremented atomically by fn_dq_run_note_error (21 Sep 2026).
export const ENGINE_MAX_CONSECUTIVE_ERRORS = 3;

/** Drain what the database queued (bounded); a delivery failure is the row's problem, not the engine's. */
async function drainOutbox(sb: SupabaseClient): Promise<void> {
  try { await deliverOutbox(sb, { limit: 5 }); } catch { /* the hourly cron retries */ }
}

export async function driveRun(
  runId: string,
  budgetMs = 45_000,
  /**
   * The client, injectable so the consecutive-failure limit can be tested
   * across SEPARATE simulated invocations — which is the whole point of
   * moving that count into the database, and cannot be shown with a single
   * in-process call.
   */
  sb: SupabaseClient = dqDb(),
): Promise<{ done: boolean; status: string; batches: number; timeouts: number; contended?: number; error?: string }> {
  const t0 = Date.now();
  let batches = 0;
  let timeouts = 0;
  let contended = 0;
  let cleared = false;
  let last: BatchStep = { done: false } as BatchStep;
  while (Date.now() - t0 < budgetMs) {
    try {
      last = await processOneBatch(sb, runId);
    } catch (e) {
      // A lost connection or an RPC failure used to escape as a bare 500 and
      // leave the run "running" until the stall timer noticed (audit C9).
      // Record it on the run, let the caller re-kick, and stop after three
      // failures in a row so a persistent fault cannot loop forever.
      const msg = e instanceof Error ? e.message : String(e);
      // Count it in the DATABASE: this invocation may be the first to run at
      // all, and the limit has to hold across cold starts. The function also
      // writes the note, so one round trip does both.
      const noted = await sb.rpc("fn_dq_run_note_error", { p_run_id: runId, p_error: msg, p_max: ENGINE_MAX_CONSECUTIVE_ERRORS });
      const info = (noted.data ?? {}) as { consecutive_errors?: number; give_up?: boolean };
      if (noted.error) {
        // The count could not be recorded, so it cannot be trusted to bind
        // here. Leave the run alone rather than failing it on one unrecorded
        // error; the stall detector fails a run that stops making progress.
        return { done: false, status: "running", batches, timeouts, error: msg };
      }
      if (info.give_up) {
        await sb.rpc("fn_dq_finish_run", { p_run_id: runId, p_status: "failed", p_error: msg }).then(() => undefined, () => undefined);
        await drainOutbox(sb);
        return { done: true, status: "failed", batches, timeouts, error: msg };
      }
      return { done: false, status: "running", batches, timeouts, error: msg };
    }
    // Progress clears the streak a previous invocation may have left behind.
    // Once per invocation is enough: this loop returns on the first error.
    if (!cleared) { cleared = true; await sb.rpc("fn_dq_run_clear_errors", { p_run_id: runId }).then(() => undefined, () => undefined); }
    if (last.done) { await drainOutbox(sb); return { done: true, status: last.status, batches, timeouts }; }
    if (last.timeout) { timeouts += 1; continue; }
    if ("contended" in last && last.contended) {
      // The range is locked, not oversized. Hand the invocation back so the
      // lock holder can finish; the caller re-kicks on its own schedule.
      contended += 1;
      return { done: false, status: "running", batches, timeouts, contended };
    }
    batches += 1;
  }
  const { data } = await sb.from("dq_runs").select("status").eq("id", runId).single();
  return { done: false, status: (data as { status: string } | null)?.status ?? "running", batches, timeouts };
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
    // the hourly cron resumes a stalled run; the console offers Recover to a run-capable admin
  }
}

/** A run whose last batch is older than this is treated as stalled: the console offers Recover, the cron re-kicks. */
export const STALL_MS = 90_000;

/** True when the run is running and no batch has been reported for STALL_MS. */
export function isStalled(run: Pick<DqRun, "status" | "last_batch_at" | "started_at" | "created_at">, now = Date.now()): boolean {
  if (run.status !== "running") return false;
  const last = run.last_batch_at ?? run.started_at ?? run.created_at;
  return now - new Date(last).getTime() > STALL_MS;
}
