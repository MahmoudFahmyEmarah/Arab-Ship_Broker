// Data Sync health check (Vercel cron — vercel.json, every fifteen minutes).
// The consumer that makes sync_health_alerts actual monitoring rather than a
// view nobody reads (workstream I, 21 Sep 2026).
//
// Each tick:
//   · closes job_runs rows that have been "running" past the threshold, so a
//     lost connection cannot leave a permanent phantom stuck job (workstream G)
//   · folds the health view into sync_alert_state and mails only the
//     conditions that have been present for the configured number of
//     consecutive checks and have not been reported yet, plus any that have
//     just cleared
//   · sweeps expired and abandoned upload payloads out of private storage
//
// Switched on in Data Sync → Health (sync_alert_config). Until it is on, with
// at least one recipient, the module must not be described as unattended.
//
//   GET /api/cron/sync-health   Authorization: Bearer <CRON_SECRET>
//   ?dry=1                      fold the state and report, send nothing
import { NextRequest, NextResponse } from "next/server";
import { engineSecretOk } from "@/lib/dq/engine";
import { cronTrigger } from "@/lib/cron/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { withJobRunStrict } from "@/lib/jobs/runs";
import { runHealthCheck } from "@/lib/sync/alerts";
import { sweepUploadPayloads } from "@/lib/sync/upload-jobs";
import { engineOrigin } from "@/lib/dq/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STALE_JOB_MINUTES = 120;

export async function GET(req: NextRequest) {
  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!engineSecretOk(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = getSupabaseAdminClient();
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  let origin: string | null = null;
  try { origin = engineOrigin(); } catch { origin = null; }

  try {
    const { result, finalization } = await withJobRunStrict(
      sb, "sync-health", { trigger: isVercelCron ? "cron" : "manual" },
      async () => {
        // G: close anything that never reported a terminal status
        const { data: rec } = await sb.rpc("fn_sync_reconcile_job_runs", { p_stale_minutes: STALE_JOB_MINUTES });
        const reconciled = (rec ?? {}) as { closed?: number; jobs?: string };

        const health = await runHealthCheck(sb, {
          origin,
          send: dry ? async () => { throw new Error("dry run — nothing sent"); } : undefined,
        });

        // D: retention for queued workbooks
        let sweep: { deleted: number; parked: number; errors: string[] } = { deleted: 0, parked: 0, errors: [] };
        try { sweep = await sweepUploadPayloads(sb, { abandonedHours: 24, limit: 50 }); }
        catch (e) { sweep.errors.push(e instanceof Error ? e.message : String(e)); }

        return {
          result: { reconciled, health, sweep, dry },
          rows: health.notified + health.recovered,
          meta: {
            reconciled_jobs: reconciled.closed ?? 0, notified: health.notified, recovered: health.recovered,
            sent: health.sent, alerting: health.enabled, skipped: health.skipped ?? null, error: health.error ?? null,
            payloads_deleted: sweep.deleted, uploads_parked: sweep.parked,
          },
        };
      },
    );
    return NextResponse.json({ ok: true, ...result, job_finalized: finalization.persisted, job_finalize_error: finalization.error ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "the health check failed" }, { status: 500 });
  }
}
