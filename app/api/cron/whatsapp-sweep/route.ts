// GET /api/cron/whatsapp-sweep — the WhatsApp worker on Vercel (phase 1,
// 18 Sep 2026). Every five minutes: claim the oldest pending messages (and
// any whose lease expired with a dead worker), classify, stage, acknowledge.
// The webhook only stores messages and kicks a small claim; this is the
// durable path that guarantees every stored message is processed once.
//   Authorization: Bearer <CRON_SECRET>  (Vercel sends it on its own cron calls)
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";
import { withJobRun } from "@/lib/jobs/runs";
import { processPendingWhatsapp } from "@/lib/sync/whatsapp/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = getSupabaseAdminClient();
  try {
    const res = await withJobRun(sb, "whatsapp-sweep", { trigger: cronTrigger(req.headers) }, async () => {
      // 300 s function budget: 250 s of processing, the rest for the last ack
      const r = await processPendingWhatsapp(sb, { limit: 100, budgetMs: 250_000, owner: "cron" });
      return { result: r, rows: r.staged, meta: { processed: r.processed, staged: r.staged, irrelevant: r.irrelevant, failed: r.failed, usage: r.usage, log: r.log.slice(-20) } };
    });
    return NextResponse.json({ ok: !(res.failed && !res.staged), processed: res.processed, staged: res.staged, irrelevant: res.irrelevant, failed: res.failed, log: res.log.slice(-20) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}
