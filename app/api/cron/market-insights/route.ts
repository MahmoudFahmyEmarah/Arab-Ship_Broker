import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Weekly Market Insights generator — runs each Monday (Vercel Cron, see
// vercel.json). Computes the trailing week (previous Mon–Sun), then calls the
// SECURITY DEFINER generator+freeze RPC via the service role. The RPC applies
// the Part-1 firewall rules and stores an immutable, dated edition. This route
// holds no data logic and returns no rows — only a status.
//
//   GET /api/cron/market-insights        (Vercel Cron, or manual with the secret)
//   Authorization: Bearer <CRON_SECRET>  (required unless Vercel's cron header is present)
export const dynamic = "force-dynamic";

function isoWeek(d: Date): { year: number; week: number } {
  // ISO-8601 week number (Thursday-anchored).
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") != null;
  if (secret && !isVercelCron && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Trailing week: the Monday..Sunday that ended yesterday (the just-closed week).
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = today.getUTCDay() || 7; // 1=Mon..7=Sun
  const lastSunday = new Date(today);
  lastSunday.setUTCDate(today.getUTCDate() - dow); // most recent Sunday (yesterday if today is Mon)
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);

  const { year, week } = isoWeek(lastMonday);
  const weekId = `${year}-W${String(week).padStart(2, "0")}`;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("fn_publish_market_insights_edition", {
    p_from: fmt(lastMonday),
    p_to: fmt(lastSunday),
    p_week_id: weekId,
    p_publish: true,
  });

  if (error) {
    return NextResponse.json({ ok: false, week_id: weekId, error: error.message }, { status: 500 });
  }
  const row = data as { week_id?: string; published_at?: string | null } | null;
  return NextResponse.json({
    ok: true,
    week_id: row?.week_id ?? weekId,
    range: { from: fmt(lastMonday), to: fmt(lastSunday) },
    published_at: row?.published_at ?? null,
  });
}
