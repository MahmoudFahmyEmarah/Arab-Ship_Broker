import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Recompute the precomputed `matches` cache table (Vercel Cron, see vercel.json).
// Calls the SECURITY DEFINER fn_refresh_matches() via the service role, which
// re-derives every eligible cargo↔vessel pair using the same gates as the
// matching RPCs. The dashboard/board match badges read counts from this table;
// the per-listing "view matches" drill-down still uses the live RPCs.
//
//   GET /api/cron/refresh-matches        (Vercel Cron, or manual with the secret)
//   Authorization: Bearer <CRON_SECRET>  (required unless Vercel's cron header is present)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") != null;
  if (secret && !isVercelCron && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("fn_refresh_matches");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, matches: typeof data === "number" ? data : null });
}
