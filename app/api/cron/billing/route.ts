// Daily billing cron (Vercel, 06:30 UTC — see vercel.json). Four passes, each
// idempotent, each logged to job_runs:
//   1. renewals   — active subscriptions ending within renew_before_days get
//                   their next-period invoice drafted + issued (once) and the
//                   customer is emailed
//   2. reminders  — due in 7 days, due tomorrow, overdue (once per milestone)
//   3. grace      — overdue past grace_days → subscription past_due; period
//                   end passed and still unpaid → expired (seats drop to T1)
//   4. tiers      — fn_billing_sync_tiers so entitlements match reality
//
//   GET /api/cron/billing   Authorization: Bearer <CRON_SECRET> (Vercel sends it on its own cron calls)
import { NextRequest, NextResponse } from "next/server";
import { billingDb, draftSubscriptionInvoice, getBillingSettings, getCatalogue, getInvoice, issueInvoice, syncTiers } from "@/lib/billing/server";
import { buildBillingMail, sendBillingMail, type BillingMailKind } from "@/lib/billing/mail";
import { withJobRun } from "@/lib/jobs/runs";
import type { BillingCustomer, Invoice, Subscription } from "@/lib/billing/types";
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DAY = 86_400_000;

export async function GET(req: NextRequest) {
  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!cronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = billingDb();
  try {
    const summary = await withJobRun(sb, "billing-cron", { trigger: isVercelCron ? "cron" : "manual" }, async () => {
      const settings = await getBillingSettings(sb);
      const { plans } = await getCatalogue(sb);
      const now = new Date();
      const out = { renewals: 0, reminders: 0, past_due: 0, expired: 0, tiers: 0, errors: [] as string[] };

      const mail = async (kind: BillingMailKind, inv: Invoice, customer: BillingCustomer) => {
        if (!customer.billing_email) return;
        const { data: already } = await sb.from("billing_reminders").select("kind").eq("invoice_id", inv.id).eq("kind", kind).maybeSingle();
        if (already) return;
        const r = await sendBillingMail(sb, customer.billing_email, buildBillingMail(kind, inv, customer.legal_name, { graceDays: settings.grace_days }));
        if (!r.ok) { out.errors.push(`${kind} ${inv.number}: ${r.error}`); return; }
        await sb.from("billing_reminders").insert({ invoice_id: inv.id, kind, sent_to: customer.billing_email });
        out.reminders += 1;
      };

      // 1 · renewals
      const horizon = new Date(now.getTime() + settings.renew_before_days * DAY).toISOString();
      const { data: subs } = await sb.from("subscriptions").select("*").eq("status", "active").eq("cancel_at_period_end", false).not("current_period_end", "is", null).lte("current_period_end", horizon);
      for (const s of (subs ?? []) as Subscription[]) {
        try {
          const nextStart = s.current_period_end!.slice(0, 10);
          const { data: existing } = await sb.from("invoices").select("id").eq("subscription_id", s.id).eq("document_type", "I").eq("period_start", nextStart).neq("status", "void").limit(1);
          if (existing?.length) continue;
          const { data: c } = await sb.from("billing_customers").select("*").eq("id", s.customer_id).single();
          const plan = plans.find((p) => p.code === s.plan_code);
          if (!c || !plan) continue;
          const draft = await draftSubscriptionInvoice(sb, { subscription: s, customer: c as BillingCustomer, plan, periodStart: new Date(s.current_period_end!), actor: null });
          const issued = await issueInvoice(sb, draft.id);
          out.renewals += 1;
          await mail("issued", issued, c as BillingCustomer);
        } catch (e) { out.errors.push(`renewal ${s.id}: ${e instanceof Error ? e.message : String(e)}`); }
      }

      // 2 · reminders + 3 · grace, over every open invoice
      const { data: open } = await sb.from("invoices").select("*").in("status", ["issued", "partially_paid"]).eq("document_type", "I");
      for (const raw of (open ?? []) as Invoice[]) {
        try {
          const { invoice: inv, customer } = await getInvoice(sb, raw.id);
          if (!inv.due_at) continue;
          const msToDue = new Date(inv.due_at).getTime() - now.getTime();
          const daysToDue = Math.ceil(msToDue / DAY);
          if (settings.reminder_days.includes(7) && daysToDue <= 7 && daysToDue > 1) await mail("due-7", inv, customer);
          if (settings.reminder_days.includes(1) && daysToDue <= 1 && daysToDue >= 0) await mail("due-1", inv, customer);
          if (msToDue < 0) {
            await mail("overdue", inv, customer);
            if (inv.subscription_id) {
              const { data: s } = await sb.from("subscriptions").select("*").eq("id", inv.subscription_id).single();
              const sub = s as Subscription | null;
              if (sub && sub.status === "active") { await sb.from("subscriptions").update({ status: "past_due", updated_at: now.toISOString() }).eq("id", sub.id); out.past_due += 1; }
              const graceOver = -msToDue > settings.grace_days * DAY;
              const periodOver = sub?.current_period_end ? new Date(sub.current_period_end) < now : true;
              if (sub && graceOver && periodOver && sub.status !== "expired" && sub.status !== "canceled") {
                await sb.from("subscriptions").update({ status: "expired", updated_at: now.toISOString() }).eq("id", sub.id);
                out.expired += 1;
                await mail("expired", inv, customer);
              }
            }
          }
        } catch (e) { out.errors.push(`invoice ${raw.number ?? raw.id}: ${e instanceof Error ? e.message : String(e)}`); }
      }

      // 4 · tiers
      out.tiers = await syncTiers(sb);
      return { result: out, rows: out.renewals + out.reminders + out.past_due + out.expired, meta: out };
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "billing cron failed" }, { status: 500 });
  }
}
