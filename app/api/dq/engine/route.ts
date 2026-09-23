// Data Quality engine — processes batches of one run within the function's
// time budget, then re-kicks itself (after the response is sent) until the run
// finishes, pauses or is cancelled. Started by the admin console (createRun /
// resumeRun) and by the nightly cron.
//
//   POST /api/dq/engine  { runId }   Authorization: Bearer <CRON_SECRET>
import { NextRequest, NextResponse, after } from "next/server";
import { driveRun, engineSecretOk, kickEngine } from "@/lib/dq/engine";
import { engineOrigin } from "@/lib/dq/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!engineSecretOk(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let runId: string | null = null;
  try { runId = ((await req.json()) as { runId?: string }).runId ?? null; } catch { /* no body */ }
  if (!runId) return NextResponse.json({ ok: false, error: "runId required" }, { status: 400 });

  // Workstream A (19 Sep 2026): the self-kick goes to the CONFIGURED origin
  // only — never to a host taken from the request, which used to receive the
  // cron secret. Resolve it before driving so a misconfiguration is a clean
  // 500, not a run that silently stops after its first batch.
  let origin: string;
  try { origin = engineOrigin(); } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "engine origin not configured" }, { status: 500 });
  }
  const result = await driveRun(runId, 45_000);
  if (!result.done && result.status === "running") {
    after(() => kickEngine(runId!, origin));
  }
  return NextResponse.json({ ok: true, ...result });
}
