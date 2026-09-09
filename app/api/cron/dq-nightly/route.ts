// Nightly data-quality audit (Vercel cron — see vercel.json). Creates a
// whole-database run in the mode chosen in Settings when the nightly schedule
// is enabled, then drives it (re-kicking through /api/dq/engine). Also resumes
// any run left "running" with no batch for 10 minutes (a broken chain).
//
//   GET /api/cron/dq-nightly   Authorization: Bearer <CRON_SECRET> unless Vercel's cron header is present
import { NextRequest, NextResponse, after } from "next/server";
import { dqDb, driveRun, engineSecretOk, getSettings, kickEngine } from "@/lib/dq/engine";
import { withJobRun } from "@/lib/jobs/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") != null;
  if (!engineSecretOk(req.headers.get("authorization"), isVercelCron)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = dqDb();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const base = process.env.DQ_ENGINE_URL?.replace(/\/$/, "") ?? (host ? `${proto}://${host}` : new URL(req.url).origin);

  const summary = await withJobRun(sb, "dq-nightly", { trigger: isVercelCron ? "cron" : "manual" }, async () => {
    const settings = await getSettings(sb);
    const out: { created: string | null; resumed: string[]; skipped?: string } = { created: null, resumed: [] };

    // resume stalled runs first
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: stalled } = await sb.from("dq_runs").select("id").eq("status", "running").or(`last_batch_at.lt.${stale},last_batch_at.is.null`);
    for (const r of (stalled ?? []) as { id: string }[]) { out.resumed.push(r.id); after(() => kickEngine(r.id, base)); }

    if (!settings.nightly_enabled) { out.skipped = "nightly schedule disabled in Settings"; return { result: out, rows: 0 }; }
    const { data: already } = await sb.from("dq_runs").select("id").eq("trigger", "scheduler").gte("created_at", new Date(Date.now() - 20 * 3600_000).toISOString()).limit(1);
    if (already?.length) { out.skipped = "a scheduled run already exists today"; return { result: out, rows: 0 }; }

    const { data: run, error } = await sb.from("dq_runs").insert({
      scope: { kind: "db" }, mode: settings.nightly_mode, batch_size: settings.batch_size, trigger: "scheduler", started_by_name: "Scheduler (nightly)", notify: settings.notify?.on_complete ?? false,
    }).select("id").single();
    if (error) throw new Error(error.message);
    out.created = (run as { id: string }).id;
    const first = await driveRun(out.created, 40_000);
    if (!first.done) after(() => kickEngine(out.created!, base));
    return { result: out, rows: first.batches };
  });
  return NextResponse.json({ ok: true, ...summary });
}
