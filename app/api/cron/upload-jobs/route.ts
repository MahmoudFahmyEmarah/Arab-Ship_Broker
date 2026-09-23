// Background staging of queued workbooks (Vercel cron — vercel.json, every
// five minutes). Large uploads are queued by /api/upload/cargomap (or by the
// signed-upload flow) instead of being staged inside the request; this route
// claims one job at a time — FOR UPDATE SKIP LOCKED, with a LEASE TOKEN that
// makes ownership explicit — and stages it into the batch the claim reserved.
//
// 21 Sep 2026: the response now separates the four outcomes a pass can have,
// because "done" used to cover a job whose finalisation had actually been
// refused. `lost` counts passes that staged work and then found the job had
// been reclaimed; their work is redone by the owning worker and is reported as
// neither done nor failed.
//
//   GET /api/cron/upload-jobs   Authorization: Bearer <CRON_SECRET>
import { NextRequest, NextResponse } from "next/server";
import { engineSecretOk } from "@/lib/dq/engine";
import { cronTrigger } from "@/lib/cron/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { withJobRunStrict } from "@/lib/jobs/runs";
import { processUploadJobs } from "@/lib/sync/upload-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!engineSecretOk(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = getSupabaseAdminClient();
  const log: string[] = [];
  try {
    const { result, finalization } = await withJobRunStrict(
      sb, "upload-jobs", { trigger: isVercelCron ? "cron" : "manual" },
      async () => {
        const r = await processUploadJobs(sb, { budgetMs: 280_000, onLog: (m) => log.push(m) });
        return {
          result: r,
          rows: r.done,
          meta: { claimed: r.claimed, done: r.done, failed: r.failed, retrying: r.retrying, lost: r.lost, log: log.slice(-20) },
        };
      },
    );
    return NextResponse.json({ ok: true, ...result, job_finalized: finalization.persisted, job_finalize_error: finalization.error ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "the upload-jobs pass failed", log: log.slice(-20) }, { status: 500 });
  }
}
