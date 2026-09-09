// Data Quality engine — processes batches of one run within the function's
// time budget, then re-kicks itself (after the response is sent) until the run
// finishes, pauses or is cancelled. Started by the admin console (createRun /
// resumeRun) and by the nightly cron.
//
//   POST /api/dq/engine  { runId }   Authorization: Bearer <CRON_SECRET>
import { NextRequest, NextResponse, after } from "next/server";
import { driveRun, engineSecretOk, kickEngine } from "@/lib/dq/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function baseUrl(req: NextRequest): string {
  const explicit = process.env.DQ_ENGINE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  if (!engineSecretOk(req.headers.get("authorization"), req.headers.get("x-vercel-cron") != null)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let runId: string | null = null;
  try { runId = ((await req.json()) as { runId?: string }).runId ?? null; } catch { /* no body */ }
  if (!runId) return NextResponse.json({ ok: false, error: "runId required" }, { status: 400 });

  const result = await driveRun(runId, 45_000);
  if (!result.done && result.status === "running") {
    const url = baseUrl(req);
    after(() => kickEngine(runId!, url));
  }
  return NextResponse.json({ ok: true, ...result });
}
