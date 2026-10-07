import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";
import { withJobRun } from "@/lib/jobs/runs";
import { ECB_DAILY_URL, ecbFeedPayloads, parseEcbDaily } from "@/lib/pda/ecb";

// Daily ECB euro reference rates → governed PDA FX rates (Vercel Cron, see vercel.json).
// Reads the ECB's free daily file and records EUR → USD/RON/TRY through pda_record_fx_rate_system
// (service role; source_kind 'ecb'; idempotent per pair and day; never overwrites). A day the ECB does not
// publish (weekend, TARGET holiday) simply re-reads the previous file and records nothing new.
//
//   GET /api/cron/fx-ecb        Authorization: Bearer <CRON_SECRET> (Vercel sends it on its own cron calls)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const trigger = cronTrigger(req.headers); // label only
  if (!cronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const recorded = await withJobRun(supabase, "fx-ecb", { trigger }, async () => {
      const response = await fetch(ECB_DAILY_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`ECB feed answered ${response.status}`);
      const daily = parseEcbDaily(await response.text());
      const rows: { pair: string; rate: number; id: string }[] = [];
      for (const payload of ecbFeedPayloads(daily)) {
        const { data, error } = await supabase.rpc("pda_record_fx_rate_system", { p_payload: payload });
        if (error) throw new Error(`${payload.baseCurrency}→${payload.quoteCurrency}: ${error.message}`);
        rows.push({ pair: `${payload.baseCurrency}/${payload.quoteCurrency}`, rate: payload.rate, id: String(data) });
      }
      return { result: { date: daily.date, rows }, rows: rows.length, meta: { date: daily.date } };
    });
    return NextResponse.json({ ok: true, ...recorded });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fx feed failed" }, { status: 500 });
  }
}
