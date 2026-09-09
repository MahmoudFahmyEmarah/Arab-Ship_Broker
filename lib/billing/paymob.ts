// Paymob Accept (Egypt) — hosted checkout adapter. Three calls create a
// checkout: auth token → order → payment key; the member then pays on
// Paymob's own iframe page, so no card data ever touches this app (PCI
// SAQ-A). Paymob calls back twice: a server-to-server "transaction processed"
// POST (the source of truth, handled by /api/billing/paymob/webhook) and a
// browser redirect (the "transaction response" GET, handled by
// /api/billing/paymob/return). Both carry an HMAC-SHA512 over a fixed field
// order that we verify with the HMAC secret from Vault before touching money.
// Settlement is idempotent on the Paymob transaction id.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingCustomer, BillingSettings, Invoice } from "./types";
import { round2 } from "./money";
import { getInvoice, recordPayment, BillingError } from "./server";

const BASE = "https://accept.paymob.com/api";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw new BillingError(`Paymob ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  return json as T;
}

export async function paymobAuthToken(apiKey: string): Promise<string> {
  const r = await post<{ token: string }>("/auth/tokens", { api_key: apiKey });
  if (!r.token) throw new BillingError("Paymob did not return an auth token");
  return r.token;
}

/** The amount Paymob charges for an invoice: EGP, at the invoice's frozen rate for USD invoices. */
export function chargeAmountEgp(invoice: Invoice, open: number): number {
  if (invoice.currency === "EGP") return round2(open);
  if (!invoice.fx_rate) throw new BillingError("This invoice has no EGP rate — it cannot be charged by card");
  return round2(open * invoice.fx_rate);
}

export async function createPaymobCheckout(sb: SupabaseClient, input: {
  invoice: Invoice; customer: BillingCustomer; settings: BillingSettings; apiKey: string; actor: string | null; payerEmail?: string | null; payerName?: string | null;
}): Promise<{ url: string; intentId: string }> {
  const { invoice, customer, settings } = input;
  if (!settings.paymob_enabled) throw new BillingError("Card payments are not enabled");
  if (!settings.paymob_integration_id || !settings.paymob_iframe_id) throw new BillingError("Paymob integration id / iframe id are not set");
  const open = round2(invoice.total - invoice.amount_paid);
  if (open <= 0) throw new BillingError("Nothing left to pay on this invoice");
  const egp = chargeAmountEgp(invoice, open);
  const amountCents = Math.round(egp * 100);
  const merchantRef = `${invoice.number ?? invoice.id}-${Date.now().toString(36)}`;

  const token = await paymobAuthToken(input.apiKey);
  const order = await post<{ id: number }>("/ecommerce/orders", {
    auth_token: token, delivery_needed: "false", amount_cents: amountCents, currency: "EGP", merchant_order_id: merchantRef,
    items: [{ name: `Invoice ${invoice.number ?? ""}`.trim(), amount_cents: amountCents, description: `${customer.legal_name} · Arab ShipBroker`, quantity: 1 }],
  });
  const [first, ...rest] = (input.payerName ?? customer.legal_name).trim().split(/\s+/);
  const key = await post<{ token: string }>("/acceptance/payment_keys", {
    auth_token: token, amount_cents: amountCents, expiration: 3600, order_id: order.id, currency: "EGP",
    integration_id: Number(settings.paymob_integration_id), lock_order_when_paid: true,
    billing_data: {
      first_name: first || "Member", last_name: rest.join(" ") || "ASB",
      email: input.payerEmail ?? customer.billing_email ?? "billing@arabshipbroker.com",
      phone_number: customer.phone ?? "+201000000000",
      apartment: "NA", floor: "NA", building: customer.address?.buildingNumber || "NA", street: customer.address?.street || "NA",
      city: customer.address?.regionCity || "NA", state: customer.address?.governate || "NA", country: customer.country || "EG",
      postal_code: customer.address?.postalCode || "NA", shipping_method: "NA",
    },
  });

  const { data: intent, error } = await sb.from("billing_payment_intents").insert({
    invoice_id: invoice.id, gateway: "paymob", gateway_order_id: String(order.id), merchant_ref: merchantRef,
    amount_cents: amountCents, currency: "EGP", invoice_amount: open, status: "created", created_by: input.actor,
  }).select("id").single();
  if (error) throw new BillingError(error.message);

  return { url: `${BASE}/acceptance/iframes/${settings.paymob_iframe_id}?payment_token=${encodeURIComponent(key.token)}`, intentId: (intent as { id: string }).id };
}

// ── callbacks ───────────────────────────────────────────────────────────
const HMAC_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id", "is_3d_secure",
  "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
  "source_data.pan", "source_data.sub_type", "source_data.type", "success",
] as const;

type Obj = Record<string, unknown>;
const get = (o: Obj, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Obj)[k] : undefined), o);
const str = (v: unknown) => (v == null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v));

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase()), bb = Buffer.from(b.toLowerCase());
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** HMAC over the "transaction processed" JSON callback (obj = payload.obj). */
export function verifyPaymobWebhook(obj: Obj, hmac: string | null, secret: string): boolean {
  if (!hmac) return false;
  const concat = HMAC_FIELDS.map((f) => str(get(obj, f))).join("");
  return safeEq(createHmac("sha512", secret).update(concat).digest("hex"), hmac);
}

/** HMAC over the browser redirect query (flat keys; `order` instead of `order.id`). */
export function verifyPaymobRedirect(q: URLSearchParams, secret: string): boolean {
  const hmac = q.get("hmac");
  if (!hmac) return false;
  const concat = HMAC_FIELDS.map((f) => q.get(f === "order.id" ? "order" : f) ?? "").join("");
  return safeEq(createHmac("sha512", secret).update(concat).digest("hex"), hmac);
}

export type PaymobTxn = { id: string; orderId: string; success: boolean; pending: boolean; amountCents: number; currency: string; errorOccured: boolean; isRefunded: boolean; isVoided: boolean; raw: unknown };

export function txnFromWebhook(obj: Obj): PaymobTxn {
  return {
    id: str(obj.id), orderId: str(get(obj, "order.id")), success: obj.success === true || str(obj.success) === "true",
    pending: obj.pending === true || str(obj.pending) === "true", amountCents: Number(obj.amount_cents ?? 0), currency: str(obj.currency),
    errorOccured: obj.error_occured === true || str(obj.error_occured) === "true",
    isRefunded: obj.is_refunded === true || str(obj.is_refunded) === "true", isVoided: obj.is_voided === true || str(obj.is_voided) === "true", raw: obj,
  };
}
export function txnFromRedirect(q: URLSearchParams): PaymobTxn {
  const o: Obj = {}; q.forEach((v, k) => { o[k] = v; });
  return { id: q.get("id") ?? "", orderId: q.get("order") ?? "", success: q.get("success") === "true", pending: q.get("pending") === "true", amountCents: Number(q.get("amount_cents") ?? 0), currency: q.get("currency") ?? "", errorOccured: q.get("error_occured") === "true", isRefunded: q.get("is_refunded") === "true", isVoided: q.get("is_voided") === "true", raw: o };
}

/** Apply a verified Paymob transaction to the ledger. Idempotent on the transaction id. */
export async function settlePaymobTransaction(sb: SupabaseClient, txn: PaymobTxn): Promise<{ applied: boolean; reason: string; invoiceId: string | null }> {
  const { data: intent } = await sb.from("billing_payment_intents").select("*").eq("gateway_order_id", txn.orderId).maybeSingle();
  if (!intent) return { applied: false, reason: `unknown order ${txn.orderId}`, invoiceId: null };
  const it = intent as { id: string; invoice_id: string; amount_cents: number; invoice_amount: number; status: string };

  if (!txn.success || txn.pending || txn.errorOccured || txn.isVoided || txn.isRefunded) {
    await sb.from("billing_payment_intents").update({ status: txn.pending ? "created" : "failed", gateway_txn_id: txn.id, raw: txn.raw, updated_at: new Date().toISOString() }).eq("id", it.id);
    return { applied: false, reason: txn.pending ? "pending" : "not successful", invoiceId: it.invoice_id };
  }
  if (txn.amountCents !== Number(it.amount_cents)) {
    await sb.from("billing_payment_intents").update({ status: "failed", gateway_txn_id: txn.id, raw: txn.raw, updated_at: new Date().toISOString() }).eq("id", it.id);
    return { applied: false, reason: `amount mismatch ${txn.amountCents} ≠ ${it.amount_cents}`, invoiceId: it.invoice_id };
  }
  const { invoice } = await getInvoice(sb, it.invoice_id);
  const open = round2(invoice.total - invoice.amount_paid);
  // settle exactly what was owed at intent time (never more than what is still open)
  const amount = Math.min(Number(it.invoice_amount), Math.max(open, 0));
  if (amount <= 0) {
    await sb.from("billing_payment_intents").update({ status: "paid", gateway_txn_id: txn.id, raw: txn.raw, updated_at: new Date().toISOString() }).eq("id", it.id);
    return { applied: false, reason: "already settled", invoiceId: it.invoice_id };
  }
  try {
    await recordPayment(sb, {
      invoice_id: it.invoice_id, method: "paymob", amount, status: "succeeded", gateway: "paymob", gateway_payment_id: `paymob:${txn.id}`,
      reference: `Paymob order ${txn.orderId}`, note: `${(txn.amountCents / 100).toFixed(2)} EGP charged`, raw: txn.raw, recorded_by: null,
    });
  } catch (e) {
    if (e instanceof Error && /already recorded/i.test(e.message)) return { applied: false, reason: "duplicate", invoiceId: it.invoice_id };
    throw e;
  }
  await sb.from("billing_payment_intents").update({ status: "paid", gateway_txn_id: txn.id, raw: txn.raw, updated_at: new Date().toISOString() }).eq("id", it.id);
  return { applied: true, reason: "paid", invoiceId: it.invoice_id };
}
