import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchDue } from "@/lib/groupmail/dispatch";

// Scheduled-circular dispatcher — pinged by pg_cron (groupmail_dispatch_tick)
// every 10 minutes whenever a campaign is due. Auth: the Vault dispatch token
// as a bearer. Each call processes one bounded chunk; pg_cron keeps pinging
// until the campaign completes.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const c = getSupabaseAdminClient();
  const { data: expected } = await c.rpc("groupmail_get_secret", { p_key: "dispatch_token" });
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !got || got !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await dispatchDue(c);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[group-mail] dispatch error:", e);
    return NextResponse.json({ ok: false, error: "dispatch failed" }, { status: 500 });
  }
}
