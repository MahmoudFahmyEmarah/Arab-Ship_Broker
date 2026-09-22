// Meta WhatsApp Cloud API webhook.
//   GET  — subscription verification (hub.challenge echo, verify token from Vault)
//   POST — inbound events; signature-verified (X-Hub-Signature-256, app secret),
//          text messages stored (deduped) and processed after the response.
// This endpoint is publicly reachable by design; security = the signed HMAC.
//
// P0-5 (20 Sep 2026): the decision lives in lib/sync/whatsapp/webhook.ts and
// is tested there. Meta is answered 200 only once verified text is stored;
// any failure before that is a 503 with Retry-After (Meta redelivers, the
// upsert is idempotent); failures after storage are 200 because the sweep
// retries processing. Job logging never stands between the message and
// storage.

import { NextResponse, after } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { secretEquals } from "@/lib/sync/guards";
import { processPendingWhatsapp } from "@/lib/sync/whatsapp/process";
import { handleMetaWebhook, WEBHOOK_MAX_BYTES, type WebhookDeps } from "@/lib/sync/whatsapp/webhook";
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
  // Meta payloads are a few KB; refuse a flood before reading it — and the
  // real byte count is checked again inside the handler.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > WEBHOOK_MAX_BYTES) return new NextResponse("Payload too large", { status: 413 });
  const rawBody = await req.text();
  const supabase = getSupabaseAdminClient();

  const deps: WebhookDeps = {
    getAppSecret: async () => {
      const { data, error } = await supabase.rpc("get_whatsapp_secret", { p_kind: "app_secret" });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
    upsertMessages: async (rows) => {
      const { error } = await supabase.from("whatsapp_message").upsert(rows, { onConflict: "wa_message_id", ignoreDuplicates: true });
      return { error: error?.message ?? null };
    },
    startJob: () => startJobRun(supabase, "whatsapp-webhook", { trigger: "webhook" }),
    finishJob: (id, result) => finishJobRun(supabase, id, result),
    kick: () => {
      // classify + stage + ack AFTER the response — Meta gets its 200 fast.
      // A small claim with a short budget inside the route's 60 s; whatever
      // it does not reach is picked up by the 5-minute sweep cron.
      after(async () => {
        try { await processPendingWhatsapp(supabase, { limit: 8, budgetMs: 40_000, owner: "webhook" }); } catch { /* the sweep cron retries */ }
      });
    },
    now: () => new Date(),
  };

  const r = await handleMetaWebhook({ rawBody, signature: req.headers.get("x-hub-signature-256"), contentLength: declared || null }, deps);
  const headers = r.headers ?? {};
  return typeof r.body === "string"
    ? new NextResponse(r.body, { status: r.status, headers })
    : NextResponse.json(r.body, { status: r.status, headers });
}
