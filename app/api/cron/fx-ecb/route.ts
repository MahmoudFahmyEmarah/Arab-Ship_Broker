import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";
import { withJobRunStrict } from "@/lib/jobs/runs";
import { assertEcbFresh, ecbFeedPayloads, fetchEcbDaily, parseEcbDaily } from "@/lib/pda/ecb";

// Daily ECB euro reference rates → governed PDA FX rates (Vercel Cron, see vercel.json: once after the ECB's
// ~16:00 CET publication and a later retry; both are idempotent). Reads the ECB's free daily file and records
// EUR → USD/RON/TRY through pda_record_fx_rate_system (service role; exact ECB publication binding; never
// overwrites). The file must be complete and fresh; a day the ECB does not publish re-reads the previous file
// and reports replays only.
//
//   GET /api/cron/fx-ecb        Authorization: Bearer <CRON_SECRET> (Vercel sends it on its own cron calls)
//
// The response is green only when the rates are recorded AND the job_runs record of it persisted (C2O-089).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Recorded = { pair: string; rate: number; id: string; inserted: boolean };

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
    const { result, finalization } = await withJobRunStrict(supabase, "fx-ecb", { trigger }, async () => {
      const daily = parseEcbDaily(await fetchEcbDaily());
      assertEcbFresh(daily.date);
      const rows: Recorded[] = [];
      for (const payload of ecbFeedPayloads(daily)) {
        const { data, error } = await supabase.rpc("pda_record_fx_rate_system", { p_payload: payload });
        if (error) throw new Error(`${payload.baseCurrency}→${payload.quoteCurrency}: ${error.message}`);
        const row = data as { id?: string; inserted?: boolean } | null;
        if (!row?.id || typeof row.inserted !== "boolean") throw new Error(`${payload.quoteCurrency}: unexpected feed answer`);
        rows.push({ pair: `${payload.baseCurrency}/${payload.quoteCurrency}`, rate: payload.rate, id: row.id, inserted: row.inserted });
      }
      const inserted = rows.filter((r) => r.inserted).length;
      return { result: { date: daily.date, inserted, replayed: rows.length - inserted, rows }, rows: inserted,
        meta: { date: daily.date, inserted, replayed: rows.length - inserted } };
    });
    if (!finalization.persisted) {
      return NextResponse.json({ ok: false, error: "job_run_not_persisted", job_finalize_error: finalization.error ?? null, ...result }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "fx feed failed" }, { status: 500 });
  }
}
