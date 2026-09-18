import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withJobRun } from "@/lib/jobs/runs";
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";

// Recompute the precomputed `matches` cache table (Vercel Cron, see vercel.json).
// Calls the SECURITY DEFINER fn_refresh_matches() via the service role, which
// re-derives every eligible cargo↔vessel pair using the same gates as the
// matching RPCs. The dashboard/board match badges read counts from this table;
// the per-listing "view matches" drill-down still uses the live RPCs.
//
//   GET /api/cron/refresh-matches        (Vercel Cron sends the secret; manual calls must too)
//   Authorization: Bearer <CRON_SECRET>  (Vercel sends it on its own cron calls)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!cronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  try {
    // Every run leaves a job_runs row (status, rows, error) for the console dashboard.
    const matches = await withJobRun(supabase, "refresh-matches", { trigger: isVercelCron ? "cron" : "manual" }, async () => {
      const { data, error } = await supabase.rpc("fn_refresh_matches");
      if (error) throw new Error(error.message);
      const n = typeof data === "number" ? data : null;
      return { result: n, rows: n };
    });
    return NextResponse.json({ ok: true, matches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "refresh failed" }, { status: 500 });
  }
}
