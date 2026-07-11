// Meta WhatsApp Cloud API webhook.
//   GET  — subscription verification (hub.challenge echo, verify token from Vault)
//   POST — inbound events; signature-verified (X-Hub-Signature-256, app secret),
//          text messages stored (deduped) and processed after the response so
//          Meta always gets a fast 200 and never retry-storms.
// This endpoint is publicly reachable by design; security = the signed HMAC.

import { NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignature, extractMetaTexts } from "@/lib/sync/whatsapp/security";
import { processPendingWhatsapp } from "@/lib/sync/whatsapp/process";

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
    if (!expected || token !== expected) return new NextResponse("Forbidden", { status: 403 });
    return new NextResponse(challenge, { status: 200 });
  } catch {
    return new NextResponse("Error", { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
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
      const { error } = await supabase
        .from("whatsapp_message")
        .upsert(rows, { onConflict: "wa_message_id", ignoreDuplicates: true });
      if (!error) {
        // classify + stage + ack AFTER the response — Meta gets its 200 fast
        after(async () => {
          try { await processPendingWhatsapp(supabase); } catch { /* retried by the sweep */ }
        });
      }
    }
    // Always 200 for verified payloads (statuses, receipts, unsupported types…)
    return NextResponse.json({ ok: true });
  } catch {
    // Even on unexpected errors return 200 — Meta backs off permanently on
    // repeated 5xx; the message will be re-delivered and deduped.
    return NextResponse.json({ ok: true });
  }
}
