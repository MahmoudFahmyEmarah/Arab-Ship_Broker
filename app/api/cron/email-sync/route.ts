// Scheduled circulation-inbox sync (Vercel cron — vercel.json, hourly).
// Wakes every hour and runs the same runEmailSync the Intake button uses ONLY
// when the owner's cadence says a run is due (email_ingest_config.next_run_at,
// computed by lib/sync/email/schedule.ts from daily / every-N-days / weekly at
// a chosen hour).
//
// Honoured switches: is_enabled (the connection) and schedule_enabled (the
// cadence) — both set in Data Sync → Connections. Every run leaves a job_runs
// row AND an audit entry (actor "cron"); both are written once and awaited.
// Overlapping calls cannot both run: the lease is a per-run token (lease v2)
// and a refused claim is recorded as a skipped run.
//
// 21 Sep 2026 — two corrections (workstreams F and G):
//
//   · The schedule used to advance "whatever the outcome". It no longer does.
//     The run's outcome is classified (success / empty / skipped_lease /
//     failed / forced) and fn_sync_email_schedule_outcome decides what that
//     means: a success moves the cadence and its anchor; a FAILURE gets a
//     bounded retry in 10, 20, 40 … minutes while the daily or weekly anchor
//     stays where it was; a run refused because another lease was active
//     moves nothing at all, because it did no work; a forced call that was
//     not due moves nothing unless ?advance=1 says so. The function takes the
//     config row FOR UPDATE, so two overlapping crons cannot race it.
//
//   · Finalisation is now CONFIRMED rather than merely awaited, and the
//     response says so. The inbox sync itself is never reversed because its
//     job_runs row failed to settle; the response reports both facts.
//
//   GET /api/cron/email-sync   Authorization: Bearer <CRON_SECRET> (Vercel sends it on its own cron calls)
//   ?force=1                   run now even if not due (still needs the bearer)
//   ?advance=1                 with force: also move the normal schedule
import { NextRequest, NextResponse } from "next/server";
import { engineSecretOk } from "@/lib/dq/engine";
import { cronTrigger } from "@/lib/cron/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { runEmailSync } from "@/lib/sync/email/run";
import { RunSettler } from "@/lib/sync/email/finalize";
import type { SyncEvent } from "@/lib/sync/email/types";
import { classifyRunOutcome, isDue, nextRunAt, specFromRow, type ScheduleOutcome } from "@/lib/sync/email/schedule";
import { startJobRun } from "@/lib/jobs/runs";
import { logAudit, requestContext } from "@/lib/admin/data-sync-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** First retry after a failed scheduled run; doubles per consecutive failure, capped in SQL at an hour. */
const RETRY_BASE_SECONDS = 600;
const MAX_RETRIES = 6;

export async function GET(req: NextRequest) {
  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!engineSecretOk(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = getSupabaseAdminClient();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const advanceOnForced = url.searchParams.get("advance") === "1";

  const { data: cfg } = await sb
    .from("email_ingest_config")
    .select("is_enabled, schedule_enabled, schedule_kind, schedule_hour_utc, schedule_interval_days, schedule_weekday, schedule_tz, next_run_at, last_scheduled_run_at, schedule_anchor_at, schedule_retry_count")
    .maybeSingle();
  const c = (cfg ?? null) as ({
    is_enabled?: boolean; next_run_at?: string | null; last_scheduled_run_at?: string | null;
    schedule_anchor_at?: string | null; schedule_retry_count?: number | null;
  } & Parameters<typeof specFromRow>[0]) | null;
  const spec = specFromRow(c);
  if (!c?.is_enabled) return NextResponse.json({ ok: true, skipped: "inbox disabled" });
  if (!spec.enabled) return NextResponse.json({ ok: true, skipped: "schedule off" });
  const next = c.next_run_at ? new Date(c.next_run_at) : null;
  const due = isDue(next);
  if (!force && !due) return NextResponse.json({ ok: true, skipped: "not due", next_run_at: next?.toISOString() ?? null });

  const now = new Date();
  const runId = await startJobRun(sb, "email-sync", { trigger: isVercelCron ? "cron" : "manual", meta: { schedule: spec.kind, due: next?.toISOString() ?? null, force, retry_count: c.schedule_retry_count ?? 0 } });
  const settler = new RunSettler();
  const emit = (e: SyncEvent) => { settler.note(e); };
  try {
    // 300 s function budget: 240 s for pages, the rest for the last page's staging
    await runEmailSync({ supabase: sb, limit: 50, emit, startedBy: null, owner: isVercelCron ? "cron" : "cron:manual", budgetMs: 240_000, maxPages: 6 });
  } catch (e) {
    emit({ type: "error", error: e instanceof Error ? e.message : "Email sync failed." });
  }
  // exactly one terminal job status, confirmed (workstream G)
  const o = await settler.finishStrict(sb, runId);
  const finalization = settler.finalization;
  const log = settler.log;

  // ── the schedule (workstream F) ──────────────────────────────────────────
  // The cadence anchor, not "now", is what "every N days" steps from, so a
  // string of retries cannot drift the rhythm.
  const outcome: ScheduleOutcome = classifyRunOutcome(o, { forced: force, due });
  const anchor = c.schedule_anchor_at ? new Date(c.schedule_anchor_at) : (c.last_scheduled_run_at ? new Date(c.last_scheduled_run_at) : null);
  const nextNormal = nextRunAt(spec, now, anchor);
  const { data: sched, error: schedErr } = await sb.rpc("fn_sync_email_schedule_outcome", {
    p_outcome: outcome,
    p_next_normal: nextNormal?.toISOString() ?? null,
    p_retry_base_seconds: RETRY_BASE_SECONDS,
    p_max_retries: MAX_RETRIES,
    p_advance_on_forced: advanceOnForced,
  });
  const s = (sched ?? {}) as { ok?: boolean; advanced?: boolean; retrying?: boolean; next_run_at?: string | null; retry_count?: number };
  const scheduleWritten = !schedErr && s.ok === true;

  await logAudit(sb, {
    actor: { id: null, name: isVercelCron ? "Vercel cron" : "Manual cron call", kind: "cron" }, ctx: requestContext(req.headers),
    action: "run.email.cron", targetKind: "run", targetId: runId != null ? String(runId) : null,
    batchId: (o.meta as { batch_id?: string } | undefined)?.batch_id ?? null,
    summary: outcome === "skipped_lease"
      ? "Scheduled inbox sync skipped — another run held the inbox; the slot was kept"
      : outcome === "failed"
        ? `Scheduled inbox sync failed — ${o.error ?? "no result"}${s.retrying ? `; retrying at ${s.next_run_at}` : ""}`
        : `Scheduled inbox sync ran — ${o.rows ?? 0} record(s) staged`,
    ok: outcome !== "failed",
    detail: {
      rows: o.rows ?? null, error: o.error ?? null, outcome,
      next_run_at: s.next_run_at ?? null, advanced: !!s.advanced, retrying: !!s.retrying, retry_count: s.retry_count ?? null,
      schedule_written: scheduleWritten, schedule_error: schedErr?.message ?? null,
      job_finalized: finalization?.persisted ?? null, job_finalize_error: finalization?.error ?? null,
      log: log.slice(-12),
    },
  });

  // Truthful response: the sync's own outcome, and separately whether the
  // operational records settled. A caller must not read ok:true as "the
  // schedule moved" or as "job_runs is correct".
  return NextResponse.json({
    ok: outcome !== "failed",
    outcome,
    rows: o.rows ?? null,
    error: o.error ?? null,
    next_run_at: s.next_run_at ?? null,
    schedule_advanced: !!s.advanced,
    retrying: !!s.retrying,
    retry_count: s.retry_count ?? null,
    schedule_written: scheduleWritten,
    schedule_error: schedErr?.message ?? null,
    job_finalized: finalization?.persisted ?? false,
    job_finalize_error: finalization?.error ?? null,
    log: log.slice(-20),
  }, { status: scheduleWritten ? 200 : 500 });
}
