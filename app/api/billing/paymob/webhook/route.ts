// Paymob "transaction processed" callback (server → server). Public by
// design; security is the HMAC over the payload verified with the Vault
// secret. Every call lands in billing_webhook_inbox first (idempotent on the
// transaction id), then the verified transaction settles the invoice.
import { NextRequest, NextResponse } from "next/server";
import { billingDb } from "@/lib/billing/server";
import { settlePaymobTransaction, txnFromWebhook, verifyPaymobWebhook } from "@/lib/billing/paymob";
import { startJobRun, finishJobRun } from "@/lib/jobs/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sb = billingDb();
  const hmac = req.nextUrl.searchParams.get("hmac");
  let payload: { type?: string; obj?: Record<string, unknown> } = {};
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const obj = payload.obj;
  if (!obj || payload.type !== "TRANSACTION") return NextResponse.json({ ok: true, ignored: payload.type ?? "no obj" });

  const { data: secret } = await sb.rpc("billing_get_secret", { p_key: "paymob_hmac" });
  const ok = !!secret && verifyPaymobWebhook(obj, hmac, secret as string);
  const eventId = String(obj.id ?? "");

  const { error: inboxErr } = await sb.from("billing_webhook_inbox").insert({ gateway: "paymob", event_id: eventId, signature_ok: ok, payload });
  if (inboxErr?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
  if (!ok) return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });

  const runId = await startJobRun(sb, "paymob-webhook", { trigger: "webhook", meta: { txn: eventId } });
  try {
    const result = await settlePaymobTransaction(sb, txnFromWebhook(obj));
    await sb.from("billing_webhook_inbox").update({ processed_at: new Date().toISOString(), error: result.applied ? null : result.reason }).eq("gateway", "paymob").eq("event_id", eventId);
    await finishJobRun(sb, runId, { ok: true, rows: result.applied ? 1 : 0, meta: { reason: result.reason, invoice: result.invoiceId } });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "settle failed";
    await sb.from("billing_webhook_inbox").update({ processed_at: new Date().toISOString(), error: msg }).eq("gateway", "paymob").eq("event_id", eventId);
    await finishJobRun(sb, runId, { ok: false, error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
