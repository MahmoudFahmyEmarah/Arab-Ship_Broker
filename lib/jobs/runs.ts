// job_runs writer for background work (Vercel crons, Group Mail dispatch,
// email sync, WhatsApp webhook, bunker ingest). Service-role only — the
// table has no insert policy for members.
//
// There are TWO finalisation paths, and the difference matters (workstream G,
// 21 Sep 2026):
//
//   finishJobRun        best effort, swallows everything. For paths where the
//                       business data is already stored and the caller must
//                       acknowledge regardless — the WhatsApp webhook must
//                       not make the provider redeliver a message we have
//                       safely saved just because a log row would not write.
//
//   finishJobRunStrict  inspects the result, retries a transient failure a
//                       few times, and REPORTS whether the row was actually
//                       persisted. For scheduled jobs and the upload worker,
//                       where "the job finished" is an operational claim the
//                       health system relies on.
//
// The distinction exists because `await`ing a Supabase call is not the same as
// the call succeeding: supabase-js RESOLVES with `{ error }` rather than
// throwing, so the original `try { await update } catch {}` could not tell a
// persisted terminal status from a silently lost one. A row left "running"
// then showed up in sync_health_alerts as a phantom stuck job for ever.
// fn_sync_reconcile_job_runs() is the net underneath: it closes rows that
// stayed running past the threshold.
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobName =
  | "refresh-matches"
  | "market-insights"
  | "groupmail-dispatch"
  | "email-sync"
  | "whatsapp-webhook"
  | "whatsapp-sweep"
  | "bunker-ingest"
  | "paymob-webhook"
  | "billing-cron"
  | "dq-ai-review"
  | "dq-nightly"
  | "upload-jobs"
  | "sync-health";

export type JobTrigger = "cron" | "manual" | "webhook" | "pg_cron" | "admin";

export async function startJobRun(
  sb: SupabaseClient,
  job: JobName,
  opts: { trigger?: JobTrigger; meta?: Record<string, unknown> } = {},
): Promise<number | null> {
  try {
    const { data } = await sb
      .from("job_runs")
      .insert({ job, trigger: opts.trigger ?? null, meta: opts.meta ?? {} })
      .select("id")
      .single();
    return (data as { id: number } | null)?.id ?? null;
  } catch {
    return null;
  }
}

export async function finishJobRun(
  sb: SupabaseClient,
  id: number | null,
  result: { ok: boolean; rows?: number | null; error?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  if (id == null) return;
  try {
    const patch: Record<string, unknown> = {
      finished_at: new Date().toISOString(),
      status: result.ok ? "succeeded" : "failed",
      rows: result.rows ?? null,
      error: result.error ? String(result.error).slice(0, 500) : null,
    };
    if (result.meta) patch.meta = result.meta;
    await sb.from("job_runs").update(patch).eq("id", id);
  } catch {
    // never let the log fail the job
  }
}

export interface StrictFinalization {
  /** the terminal status is in the database */
  persisted: boolean;
  /** how many attempts it took (1 when it worked first time) */
  attempts: number;
  /** why it did not persist, when it did not */
  error?: string;
}

/**
 * Finalise a job run and say whether it really happened. A resolved
 * `{ error }`, a thrown error and a lost connection are all treated the same
 * way: retry a few times with a short delay, then report the failure to the
 * caller instead of hiding it.
 *
 * Never throws — the caller decides what an unpersisted finalisation means for
 * its response. It must never reverse business data that is already stored.
 */
export async function finishJobRunStrict(
  sb: SupabaseClient,
  id: number | null,
  result: { ok: boolean; rows?: number | null; error?: string | null; meta?: Record<string, unknown> },
  opts: { retries?: number; delayMs?: number } = {},
): Promise<StrictFinalization> {
  if (id == null) return { persisted: false, attempts: 0, error: "no job_runs row was created" };
  const retries = Math.max(0, Math.min(opts.retries ?? 2, 5));
  const delayMs = Math.max(0, Math.min(opts.delayMs ?? 250, 5_000));
  const patch: Record<string, unknown> = {
    finished_at: new Date().toISOString(),
    status: result.ok ? "succeeded" : "failed",
    rows: result.rows ?? null,
    error: result.error ? String(result.error).slice(0, 500) : null,
  };
  if (result.meta) patch.meta = result.meta;

  let last = "";
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const { error } = await sb.from("job_runs").update(patch).eq("id", id);
      if (!error) return { persisted: true, attempts: attempt };
      last = error.message;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (attempt <= retries && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs * attempt));
  }
  return { persisted: false, attempts: retries + 1, error: last || "the update did not persist" };
}

/** Run `fn` inside a job_runs row; the callback returns the row count to store. */
export async function withJobRun<T>(
  sb: SupabaseClient,
  job: JobName,
  opts: { trigger?: JobTrigger; meta?: Record<string, unknown> },
  fn: () => Promise<{ result: T; rows?: number | null; meta?: Record<string, unknown> }>,
): Promise<T> {
  const id = await startJobRun(sb, job, opts);
  try {
    const out = await fn();
    await finishJobRun(sb, id, { ok: true, rows: out.rows ?? null, meta: out.meta });
    return out.result;
  } catch (e) {
    await finishJobRun(sb, id, { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * As withJobRun, but the finalisation is CONFIRMED and returned alongside the
 * result, so a route can be truthful: the work may have succeeded while the
 * operational record of it did not persist. A failure inside `fn` still
 * propagates, with its own finalisation attempted first.
 */
export async function withJobRunStrict<T>(
  sb: SupabaseClient,
  job: JobName,
  opts: { trigger?: JobTrigger; meta?: Record<string, unknown>; retries?: number },
  fn: () => Promise<{ result: T; rows?: number | null; meta?: Record<string, unknown> }>,
): Promise<{ result: T; finalization: StrictFinalization }> {
  const id = await startJobRun(sb, job, opts);
  let out: { result: T; rows?: number | null; meta?: Record<string, unknown> };
  try {
    out = await fn();
  } catch (e) {
    await finishJobRunStrict(sb, id, { ok: false, error: e instanceof Error ? e.message : String(e) }, { retries: opts.retries });
    throw e;
  }
  const finalization = await finishJobRunStrict(sb, id, { ok: true, rows: out.rows ?? null, meta: out.meta }, { retries: opts.retries });
  return { result: out.result, finalization };
}
