// job_runs writer for background work (Vercel crons, Group Mail dispatch,
// email sync, WhatsApp webhook, bunker ingest). Service-role only — the
// table has no insert policy for members. Every helper swallows its own
// errors: a missing log row must never fail the job it describes.
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobName =
  | "refresh-matches"
  | "market-insights"
  | "groupmail-dispatch"
  | "email-sync"
  | "whatsapp-webhook"
  | "bunker-ingest";

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
