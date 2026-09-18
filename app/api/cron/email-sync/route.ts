// Scheduled circulation-inbox sync (Vercel cron — vercel.json, hourly).
// Wakes every hour and runs the same runEmailSync the Intake button uses ONLY
// when the owner's cadence says a run is due (email_ingest_config.next_run_at,
// computed by lib/sync/email/schedule.ts from daily / every-N-days / weekly at
// a chosen hour). After a run it advances next_run_at on the same rhythm.
//
// Honoured switches: is_enabled (the connection) and schedule_enabled (the
// cadence) — both set in Data Sync → Connections. Every run leaves a job_runs
// row AND an audit entry (actor "cron").
//
//   GET /api/cron/email-sync   Authorization: Bearer <CRON_SECRET> (Vercel sends it on its own cron calls)
//   ?force=1                   run now even if not due (still needs the bearer)
import { NextRequest, NextResponse } from "next/server";
import { engineSecretOk } from "@/lib/dq/engine";
import { cronTrigger } from "@/lib/cron/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { runEmailSync } from "@/lib/sync/email/run";
import { settleFor, type SyncEvent } from "@/lib/sync/email/types";
import { isDue, nextRunAt, specFromRow } from "@/lib/sync/email/schedule";
import { finishJobRun, startJobRun } from "@/lib/jobs/runs";
import { logAudit, requestContext } from "@/lib/admin/data-sync-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!engineSecretOk(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = getSupabaseAdminClient();
  const force = new URL(req.url).searchParams.get("force") === "1";

  const { data: cfg } = await sb
    .from("email_ingest_config")
    .select("is_enabled, schedule_enabled, schedule_kind, schedule_hour_utc, schedule_interval_days, schedule_weekday, schedule_tz, next_run_at, last_scheduled_run_at")
    .maybeSingle();
  const c = (cfg ?? null) as ({ is_enabled?: boolean; next_run_at?: string | null; last_scheduled_run_at?: string | null } & Parameters<typeof specFromRow>[0]) | null;
  const spec = specFromRow(c);
  if (!c?.is_enabled) return NextResponse.json({ ok: true, skipped: "inbox disabled" });
  if (!spec.enabled) return NextResponse.json({ ok: true, skipped: "schedule off" });
  const next = c.next_run_at ? new Date(c.next_run_at) : null;
  if (!force && !isDue(next)) return NextResponse.json({ ok: true, skipped: "not due", next_run_at: next?.toISOString() ?? null });

  const now = new Date();
  const runId = await startJobRun(sb, "email-sync", { trigger: isVercelCron ? "cron" : "manual", meta: { schedule: spec.kind, due: next?.toISOString() ?? null, force } });
  const log: string[] = [];
  let settled = false;
  let outcome: ReturnType<typeof settleFor> = null;
  const emit = (e: SyncEvent) => {
    if (e.type === "log") log.push(e.msg);
    const s = settleFor(e);
    if (s && !settled) { settled = true; outcome = s; void finishJobRun(sb, runId, { ...s, meta: { ...(s.meta ?? {}), log: log.slice(-40) } }); }
  };
  try {
    // 300 s function budget: 240 s for pages, the rest for the last page's staging
    await runEmailSync({ supabase: sb, limit: 50, emit, startedBy: null, owner: isVercelCron ? "cron" : "cron:manual", budgetMs: 240_000, maxPages: 6 });
  } catch (e) {
    emit({ type: "error", error: e instanceof Error ? e.message : "Email sync failed." });
  } finally {
    if (!settled) await finishJobRun(sb, runId, { ok: false, error: "sync ended without a result", meta: { log: log.slice(-40) } });
  }
  const o = outcome as ReturnType<typeof settleFor>;

  // Advance the schedule on its own rhythm (anchored to this run), whatever
  // the outcome — a failed run is visible in job_runs and the audit trail, and
  // the watermark logic already guarantees nothing is skipped.
  const following = nextRunAt(spec, now, now);
  await sb.from("email_ingest_config").update({ last_scheduled_run_at: now.toISOString(), next_run_at: following?.toISOString() ?? null }).eq("only_one", true);
  await logAudit(sb, {
    actor: { id: null, name: isVercelCron ? "Vercel cron" : "Manual cron call", kind: "cron" }, ctx: requestContext(req.headers),
    action: "run.email.cron", targetKind: "run", targetId: runId != null ? String(runId) : null,
    batchId: (o?.meta as { batch_id?: string } | undefined)?.batch_id ?? null,
    summary: o?.ok ? `Scheduled inbox sync ran — ${o.rows ?? 0} record(s) staged` : `Scheduled inbox sync failed — ${o?.error ?? "no result"}`,
    ok: !!o?.ok,
    detail: { rows: o?.rows ?? null, error: o?.error ?? null, next_run_at: following?.toISOString() ?? null, log: log.slice(-12) },
  });
  return NextResponse.json({ ok: o?.ok ?? false, rows: o?.rows ?? null, error: o?.error ?? null, next_run_at: following?.toISOString() ?? null, log: log.slice(-20) });
}
