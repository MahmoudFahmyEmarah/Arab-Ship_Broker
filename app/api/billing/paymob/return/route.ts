// Paymob "transaction response" redirect (browser → us after the iframe).
// Verifies the HMAC on the query, settles idempotently (the webhook usually
// got there first) and sends the member back to their billing tab with a
// result flag. Never trusts the query without the signature.
import { NextRequest, NextResponse } from "next/server";
import { billingDb } from "@/lib/billing/server";
import { settlePaymobTransaction, txnFromRedirect, verifyPaymobRedirect } from "@/lib/billing/paymob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const back = new URL("/dashboard/account", req.nextUrl.origin);
  back.searchParams.set("tab", "billing");
  const sb = billingDb();
  const { data: secret } = await sb.rpc("billing_get_secret", { p_key: "paymob_hmac" });
  if (!secret || !verifyPaymobRedirect(q, secret as string)) {
    back.searchParams.set("pay", "unverified");
    return NextResponse.redirect(back);
  }
  const txn = txnFromRedirect(q);
  try {
    const r = await settlePaymobTransaction(sb, txn);
    back.searchParams.set("pay", txn.success && !txn.pending ? "success" : txn.pending ? "pending" : "failed");
    if (r.invoiceId) back.searchParams.set("invoice", r.invoiceId);
  } catch {
    back.searchParams.set("pay", "error");
  }
  return NextResponse.redirect(back);
}
