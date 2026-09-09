"use server";

// Member self-serve billing. Reads go through the member's own session (RLS
// shows their personal profile and their company). The subscribe flow writes
// through lib/billing/server.ts on the service role after verifying, here,
// that the member may buy for the target: themselves, or a company they
// administer. The system issues the invoice (that is normal SaaS practice);
// the owner keeps control of credits, refunds and manual activations.
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUserRow } from "@/lib/app-user";
import {
  BillingError, billingDb, createSubscription, draftSubscriptionInvoice, findCustomerFor, getBillingSettings, getCatalogue, getInvoice, issueInvoice, recordPayment, upsertCustomer,
} from "@/lib/billing/server";
import { createPaymobCheckout } from "@/lib/billing/paymob";
import { buildBillingMail, sendBillingMail } from "@/lib/billing/mail";
import type { BillingCurrency, BillingCustomer, BillingPeriod, Invoice, Plan, PlanCode, Price, Subscription, EtaAddress } from "@/lib/billing/types";

type Result<T = undefined> = ({ success: true } & (T extends undefined ? object : { data: T })) | { success: false; error: string };
const fail = (e: unknown, fb: string): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : fb });

async function viewer() {
  const sb = await getSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new BillingError("Sign in first");
  const row = await getAppUserRow<{ full_name: string | null; email: string; company: string | null; role: string; subscription_tier: string }>(sb, user.id, "full_name, email, company, role, subscription_tier");
  if (!row) throw new BillingError("Account not found");
  const { data: adminOrg } = await sb.rpc("fn_my_admin_org_id");
  const { data: mem } = await sb.rpc("fn_my_membership");
  const membership = (Array.isArray(mem) ? mem[0] : mem) as { org_id: string; org_name: string; status: string; member_role: string } | null;
  return { sb, authUid: user.id, user: row, adminOrgId: (adminOrg as string | null) ?? null, membership };
}

export type MyBilling = {
  tier: string;
  plans: Plan[]; prices: Price[];
  personal: BillingCustomer | null;
  company: (BillingCustomer & { org_name: string }) | null;
  canBuyForCompany: boolean; companyName: string | null; companyId: string | null;
  subscriptions: Subscription[];
  invoices: Invoice[];
  bank: Record<string, string> | null;
  paymobEnabled: boolean;
};

export async function getMyBilling(): Promise<Result<MyBilling>> {
  try {
    const v = await viewer();
    const admin = billingDb();
    const { plans, prices } = await getCatalogue(admin);
    const [customers, subs, invs, bank, settings] = await Promise.all([
      v.sb.from("billing_customers").select("*"),
      v.sb.from("subscriptions").select("*").order("created_at", { ascending: false }),
      v.sb.from("invoices").select("*").neq("status", "draft").order("created_at", { ascending: false }).limit(50),
      v.sb.rpc("fn_billing_bank_details"),
      admin.from("billing_settings").select("paymob_enabled").eq("id", 1).maybeSingle(),
    ]);
    const cs = (customers.data ?? []) as BillingCustomer[];
    const personal = cs.find((c) => c.user_id === v.user.id) ?? null;
    const companyCust = v.membership?.status === "active" ? cs.find((c) => c.org_id === v.membership!.org_id) ?? null : null;
    return { success: true, data: {
      tier: v.user.subscription_tier, plans, prices,
      personal,
      company: companyCust ? { ...companyCust, org_name: v.membership!.org_name } : null,
      canBuyForCompany: !!v.adminOrgId, companyName: v.membership?.org_name ?? null, companyId: v.adminOrgId,
      subscriptions: (subs.data ?? []) as Subscription[],
      invoices: ((invs.data ?? []) as Invoice[]).map((i) => ({ ...i, total: Number(i.total), amount_paid: Number(i.amount_paid), egp_total: i.egp_total == null ? null : Number(i.egp_total) })),
      bank: (bank.data as Record<string, string> | null) ?? null,
      paymobEnabled: !!(settings.data as { paymob_enabled?: boolean } | null)?.paymob_enabled,
    } };
  } catch (e) { return fail(e, "Could not load billing"); }
}

export type SubscribeInput = {
  scope: "company" | "personal";
  plan_code: PlanCode; period: BillingPeriod; seats: number;
  profile: { legal_name: string; legal_name_ar?: string; tax_id?: string; country: string; currency: BillingCurrency; address: EtaAddress; billing_email: string; phone?: string };
};

/** Create/refresh the tax profile, open the subscription, issue the first invoice. */
export async function subscribe(input: SubscribeInput): Promise<Result<{ invoice: Invoice; subscription: Subscription }>> {
  try {
    const v = await viewer();
    if (v.user.role === "admin") throw new BillingError("Admin accounts do not buy plans");
    if (input.scope === "company" && !v.adminOrgId) throw new BillingError("Only a company admin can buy seats for the company");
    if (input.scope === "personal" && input.seats !== 1) throw new BillingError("A personal plan is one seat");
    if (!input.profile.legal_name?.trim()) throw new BillingError("Legal name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.profile.billing_email ?? "")) throw new BillingError("A billing email is required");
    const admin = billingDb();
    const { plans } = await getCatalogue(admin);
    const plan = plans.find((p) => p.code === input.plan_code);
    if (!plan) throw new BillingError("Unknown plan");
    if (plan.code === "T4") throw new BillingError("Partner plans are arranged with the team — contact sales@arabshipbroker.com");

    const ref = input.scope === "company" ? { org_id: v.adminOrgId } : { user_id: v.user.id };
    const existing = await findCustomerFor(admin, ref);
    const country = input.profile.country.toUpperCase().slice(0, 2);
    const customer = await upsertCustomer(admin, {
      ...ref,
      legal_name: input.profile.legal_name, legal_name_ar: input.profile.legal_name_ar ?? null,
      receiver_type: input.scope === "personal" ? "P" : country === "EG" ? "B" : "F",
      tax_id: input.profile.tax_id ?? null, country, address: input.profile.address ?? {},
      currency: input.profile.currency,
      // members never set their own VAT treatment; keep what the owner decided, else flag for review
      vat_treatment: existing?.vat_treatment ?? (country === "EG" ? "standard" : "pending_review"),
      billing_email: input.profile.billing_email, phone: input.profile.phone ?? null,
    }, v.authUid, existing?.id);

    // one live subscription per customer; a second purchase becomes a renewal on the owner's side
    const { data: live } = await admin.from("subscriptions").select("id").eq("customer_id", customer.id).in("status", ["trialing", "active", "past_due"]).limit(1);
    if (live?.length) throw new BillingError("There is already an active subscription on this profile. Renewals are raised from your invoices; to change plan or seats, contact sales@arabshipbroker.com");

    const sub = await createSubscription(admin, { customer_id: customer.id, plan_code: input.plan_code, period: input.period, seats: input.seats, actor: v.authUid });
    const draft = await draftSubscriptionInvoice(admin, { subscription: sub, customer, plan, periodStart: new Date(), actor: v.authUid });
    const invoice = await issueInvoice(admin, draft.id);
    // best-effort confirmation with the invoice link; the ledger is already written
    if (customer.billing_email) {
      const settings = await getBillingSettings(admin);
      void sendBillingMail(admin, customer.billing_email, buildBillingMail("issued", invoice, customer.legal_name, { graceDays: settings.grace_days }))
        .then((r) => { if (r.ok) return admin.from("billing_reminders").insert({ invoice_id: invoice.id, kind: "issued", sent_to: customer.billing_email }); });
    }
    revalidatePath("/dashboard/account"); revalidatePath("/admin/billing");
    return { success: true, data: { invoice, subscription: sub } };
  } catch (e) { return fail(e, "Could not start the subscription"); }
}

/** Member says "I have transferred" — recorded as pending; the admin confirms it against the bank. */
export async function reportBankTransfer(invoiceId: string, reference: string, amount: number): Promise<Result> {
  try {
    const v = await viewer();
    const { data: inv } = await v.sb.from("invoices").select("id, total, amount_paid, status").eq("id", invoiceId).maybeSingle(); // RLS: must be theirs
    if (!inv) throw new BillingError("Invoice not found");
    if (!reference.trim()) throw new BillingError("Enter the bank reference so we can match it");
    const open = Number(inv.total) - Number(inv.amount_paid);
    const amt = amount > 0 ? Math.min(amount, open) : open;
    await recordPayment(billingDb(), { invoice_id: invoiceId, method: "bank_transfer", amount: amt, status: "pending", reference, note: "reported by member", recorded_by: v.authUid });
    revalidatePath("/dashboard/account"); revalidatePath("/admin/billing");
    return { success: true };
  } catch (e) { return fail(e, "Could not record the transfer"); }
}

/** "Pay by card": create a Paymob checkout for an invoice the member may see, return the hosted page URL. */
export async function startCardPayment(invoiceId: string): Promise<Result<{ url: string }>> {
  try {
    const v = await viewer();
    const { data: visible } = await v.sb.from("invoices").select("id").eq("id", invoiceId).maybeSingle(); // RLS: theirs, not a draft
    if (!visible) throw new BillingError("Invoice not found");
    const admin = billingDb();
    const settings = await getBillingSettings(admin);
    if (!settings.paymob_enabled) throw new BillingError("Card payments are not available yet — please pay by bank transfer");
    const { data: apiKey } = await admin.rpc("billing_get_secret", { p_key: "paymob_api_key" });
    if (!apiKey) throw new BillingError("Card payments are not configured");
    const { invoice, customer } = await getInvoice(admin, invoiceId);
    if (invoice.status !== "issued" && invoice.status !== "partially_paid") throw new BillingError("This invoice is not open");
    const { url } = await createPaymobCheckout(admin, { invoice, customer, settings, apiKey: apiKey as string, actor: v.authUid, payerEmail: v.user.email, payerName: v.user.full_name });
    return { success: true, data: { url } };
  } catch (e) { return fail(e, "Could not start the card payment"); }
}
