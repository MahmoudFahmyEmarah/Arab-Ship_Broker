// Meta WhatsApp Cloud API webhook.
//   GET  — subscription verification (hub.challenge echo, verify token from Vault)
//   POST — inbound events; signature-verified (X-Hub-Signature-256, app secret),
//          text messages stored (deduped) and processed after the response so
//          Meta always gets a fast 200 and never retry-storms.
// This endpoint is publicly reachable by design; security = the signed HMAC.

import { NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignature, extractMetaTexts } from "@/lib/sync/whatsapp/security";
import { secretEquals } from "@/lib/sync/guards";
import { processPendingWhatsapp } from "@/lib/sync/whatsapp/process";
import { startJobRun, finishJobRun } from "@/lib/jobs/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !token || !challenge) {
      return new NextResponse("Bad request", { status: 400 });
    }
    const supabase = getSupabaseAdminClient();
    const { data: expected } = await supabase.rpc("get_whatsapp_secret", { p_kind: "verify" });
    if (!secretEquals(token, expected as string | null)) return new NextResponse("Forbidden", { status: 403 });
    return new NextResponse(challenge, { status: 200 });
  } catch {
    return new NextResponse("Error", { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Meta payloads are a few KB; refuse a flood before reading it.
    if (Number(req.headers.get("content-length") ?? 0) > 1024 * 1024) return new NextResponse("Payload too large", { status: 413 });
    const rawBody = await req.text();
    const supabase = getSupabaseAdminClient();

    const { data: appSecret } = await supabase.rpc("get_whatsapp_secret", { p_kind: "app_secret" });
    if (!appSecret) return new NextResponse("Not configured", { status: 403 });
    if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret as string)) {
      return new NextResponse("Invalid signature", { status: 403 });
    }

    let payload: unknown = {};
    try { payload = JSON.parse(rawBody); } catch { /* non-JSON → no messages */ }
    const texts = extractMetaTexts(payload);

    if (texts.length) {
      const rows = texts.map((t) => ({
        wa_message_id: t.waMessageId,
        provider: "meta",
        wa_from: t.from,
        contact_name: t.name,
        body: t.text,
        received_at: t.timestamp ? new Date(Number(t.timestamp) * 1000).toISOString() : new Date().toISOString(),
        raw: { meta: true },
      }));
      // dedupe on wa_message_id — Meta retries webhooks; must be idempotent
      const runId = await startJobRun(supabase, "whatsapp-webhook", { trigger: "webhook" });
      const { error } = await supabase
        .from("whatsapp_message")
        .upsert(rows, { onConflict: "wa_message_id", ignoreDuplicates: true });
      await finishJobRun(supabase, runId, { ok: !error, rows: rows.length, error: error?.message ?? null });
      if (error) {
        // Phase 1 (18 Sep 2026): the message is NOT stored, so a 200 would
        // tell Meta it was delivered and lose it. 503 makes Meta retry with
        // back-off; the upsert is idempotent on wa_message_id, and the failed
        // job_runs row above is the alert on the admin dashboard.
        return new NextResponse("Storage unavailable", { status: 503, headers: { "Retry-After": "60" } });
      }
      // classify + stage + ack AFTER the response — Meta gets its 200 fast.
      // A small claim with a short budget: this runs inside the route's 60 s;
      // whatever it does not reach is picked up by the 5-minute sweep cron.
      after(async () => {
        try { await processPendingWhatsapp(supabase, { limit: 8, budgetMs: 40_000, owner: "webhook" }); } catch { /* the sweep cron retries */ }
      });
    }
    // Always 200 for verified payloads (statuses, receipts, unsupported types…)
    return NextResponse.json({ ok: true });
  } catch (e) {
    // An unexpected error after verification still answers 200 — Meta
    // disables a webhook after sustained 5xx — but never silently: the failed
    // job_runs row surfaces it, and a stored message is re-processed by the sweep.
    try {
      const sb = getSupabaseAdminClient();
      const id = await startJobRun(sb, "whatsapp-webhook", { trigger: "webhook" });
      await finishJobRun(sb, id, { ok: false, error: e instanceof Error ? e.message : "webhook failed before storing the message" });
    } catch { /* storage itself is down — nothing more to do here */ }
    return NextResponse.json({ ok: true });
  }
}
