"use server";

// Admin Billing actions. Access model (owner decision, 6 Sep 2026):
//   · section "billing" view  → read everything
//   · section "billing" edit  → create/edit customers, draft invoices, record
//     bank transfers and confirm pending ones
//   · owner (tier super)      → issue, void, credit, manual activation,
//     settings and secrets
// Every write goes through lib/billing/server.ts on the service role.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  BillingError, billingDb, confirmPendingPayment, createCreditNote, createSubscription, draftCustomInvoice, draftSubscriptionInvoice,
  getBillingSettings, getCatalogue, getInvoice, issueInvoice, manualActivate, recordEtaSubmission, recordPayment, syncTiers, upsertCustomer, voidInvoice,
  type CustomerInput,
} from "@/lib/billing/server";
import { getUsdEgpRate, setManualRate } from "@/lib/billing/fx";
import type { BillingPeriod, BillingSettings, Invoice, PlanCode, Subscription, BillingCustomer, Plan } from "@/lib/billing/types";

type Result<T = undefined> = ({ success: true } & (T extends undefined ? object : { data: T })) | { success: false; error: string };

async function gate(level: "view" | "edit" | "owner") {
  const u = await requireAdmin({ section: "billing", edit: level !== "view" });
  if (level === "owner" && u.tier !== "super") throw new BillingError("Only the owner can do this");
  return { sb: billingDb(), actor: u.supabaseUserId };
}
function fail(e: unknown, fallback: string): { success: false; error: string } {
  return { success: false, error: e instanceof Error ? e.message : fallback };
}
const bust = () => { revalidatePath("/admin/billing"); revalidatePath("/dashboard/account"); };

// ── reads ───────────────────────────────────────────────────────────────
export async function getBillingOverview(): Promise<Result<{
  settings: BillingSettings; plans: Plan[]; customers: (BillingCustomer & { org_name?: string | null; user_name?: string | null })[];
  subscriptions: (Subscription & { customer_name: string; plan_name: string })[];
  invoices: (Invoice & { customer_name: string })[]; pendingPayments: { id: string; invoice_id: string; invoice_number: string | null; customer_name: string; amount: number; currency: string; reference: string | null; received_at: string }[];
  fx: { rate: number; source: string; day: string } | null; isOwner: boolean;
}>> {
  try {
    const u = await requireAdmin({ section: "billing" });
    const sb = billingDb();
    const [settings, cat, customers, subs, invoices, pend, fx] = await Promise.all([
      getBillingSettings(sb), getCatalogue(sb),
      sb.from("billing_customers").select("*, organizations(name), users(full_name, email)").order("created_at", { ascending: false }),
      sb.from("subscriptions").select("*, billing_customers(legal_name), plans(name)").order("created_at", { ascending: false }),
      sb.from("invoices").select("*, billing_customers(legal_name)").order("created_at", { ascending: false }).limit(200),
      sb.from("payments").select("id, invoice_id, amount, currency, reference, received_at, invoices(number, billing_customers(legal_name))").eq("status", "pending").order("received_at"),
      getUsdEgpRate(sb),
    ]);
    type OrgJoin = { organizations?: { name: string } | null; users?: { full_name: string | null; email: string } | null };
    return { success: true, data: {
      settings, plans: cat.plans, isOwner: u.tier === "super", fx,
      customers: ((customers.data ?? []) as (BillingCustomer & OrgJoin)[]).map((c) => ({ ...c, org_name: c.organizations?.name ?? null, user_name: c.users?.full_name ?? c.users?.email ?? null })),
      subscriptions: ((subs.data ?? []) as (Subscription & { billing_customers?: { legal_name: string }; plans?: { name: string } })[]).map((s) => ({ ...s, customer_name: s.billing_customers?.legal_name ?? "—", plan_name: s.plans?.name ?? s.plan_code })),
      invoices: ((invoices.data ?? []) as (Invoice & { billing_customers?: { legal_name: string } })[]).map((i) => ({ ...i, total: Number(i.total), amount_paid: Number(i.amount_paid), egp_total: i.egp_total == null ? null : Number(i.egp_total), customer_name: i.billing_customers?.legal_name ?? "—" })),
      pendingPayments: ((pend.data ?? []) as unknown as { id: string; invoice_id: string; amount: number; currency: string; reference: string | null; received_at: string; invoices?: { number: string | null; billing_customers?: { legal_name: string } } }[])
        .map((p) => ({ id: p.id, invoice_id: p.invoice_id, amount: Number(p.amount), currency: p.currency, reference: p.reference, received_at: p.received_at, invoice_number: p.invoices?.number ?? null, customer_name: p.invoices?.billing_customers?.legal_name ?? "—" })),
    } };
  } catch (e) { return fail(e, "Could not load billing"); }
}

export async function getInvoiceDetail(id: string) {
  try {
    await requireAdmin({ section: "billing" });
    const bundle = await getInvoice(billingDb(), id);
    return { success: true as const, data: bundle };
  } catch (e) { return fail(e, "Invoice not found"); }
}

export async function searchBillingTargets(q: string): Promise<Result<{ orgs: { id: string; name: string; country: string | null }[]; users: { id: string; name: string; email: string; company: string | null }[] }>> {
  try {
    await requireAdmin({ section: "billing", edit: true });
    const sb = billingDb();
    const like = `%${q.trim()}%`;
    const [o, u] = await Promise.all([
      sb.from("organizations").select("id, name, country").ilike("name", like).order("name").limit(10),
      sb.from("users").select("id, full_name, email, company").neq("role", "admin").or(`full_name.ilike.${like},email.ilike.${like},company.ilike.${like}`).limit(10),
    ]);
    return { success: true, data: {
      orgs: (o.data ?? []) as { id: string; name: string; country: string | null }[],
      users: ((u.data ?? []) as { id: string; full_name: string | null; email: string; company: string | null }[]).map((x) => ({ id: x.id, name: x.full_name ?? x.email, email: x.email, company: x.company })),
    } };
  } catch (e) { return fail(e, "Search failed"); }
}

// ── customers ───────────────────────────────────────────────────────────
export async function saveCustomer(input: CustomerInput, id?: string): Promise<Result<BillingCustomer>> {
  try {
    const { sb, actor } = await gate("edit");
    const c = await upsertCustomer(sb, input, actor, id);
    bust();
    return { success: true, data: c };
  } catch (e) { return fail(e, "Could not save the customer"); }
}

// ── subscriptions + invoices ────────────────────────────────────────────
export async function startSubscriptionForCustomer(input: { customer_id: string; plan_code: PlanCode; period: BillingPeriod; seats: number; issue: boolean }): Promise<Result<{ subscription: Subscription; invoice: Invoice }>> {
  try {
    const { sb, actor } = await gate(input.issue ? "owner" : "edit");
    const { data: c } = await sb.from("billing_customers").select("*").eq("id", input.customer_id).single();
    if (!c) throw new BillingError("Customer not found");
    const { plans } = await getCatalogue(sb);
    const plan = plans.find((p) => p.code === input.plan_code);
    if (!plan) throw new BillingError("Unknown plan");
    const sub = await createSubscription(sb, { customer_id: input.customer_id, plan_code: input.plan_code, period: input.period, seats: input.seats, actor });
    let inv = await draftSubscriptionInvoice(sb, { subscription: sub, customer: c as BillingCustomer, plan, periodStart: new Date(), actor });
    if (input.issue) inv = await issueInvoice(sb, inv.id);
    bust();
    return { success: true, data: { subscription: sub, invoice: inv } };
  } catch (e) { return fail(e, "Could not start the subscription"); }
}

export async function renewSubscription(subscriptionId: string, issue: boolean): Promise<Result<Invoice>> {
  try {
    const { sb, actor } = await gate(issue ? "owner" : "edit");
    const { data: s } = await sb.from("subscriptions").select("*").eq("id", subscriptionId).single();
    if (!s) throw new BillingError("Subscription not found");
    const sub = s as Subscription;
    const { data: c } = await sb.from("billing_customers").select("*").eq("id", sub.customer_id).single();
    const { plans } = await getCatalogue(sb);
    const plan = plans.find((p) => p.code === sub.plan_code)!;
    const start = sub.current_period_end && new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
    let inv = await draftSubscriptionInvoice(sb, { subscription: sub, customer: c as BillingCustomer, plan, periodStart: start, actor });
    if (issue) inv = await issueInvoice(sb, inv.id);
    bust();
    return { success: true, data: inv };
  } catch (e) { return fail(e, "Could not raise the renewal"); }
}

export async function createManualInvoice(input: { customer_id: string; notes?: string; lines: { description: string; description_ar?: string; item_code?: string; quantity: number; unit_price: number; discount?: number }[]; issue: boolean }): Promise<Result<Invoice>> {
  try {
    const { sb, actor } = await gate(input.issue ? "owner" : "edit");
    const { data: c } = await sb.from("billing_customers").select("*").eq("id", input.customer_id).single();
    if (!c) throw new BillingError("Customer not found");
    let inv = await draftCustomInvoice(sb, { customer: c as BillingCustomer, actor, notes: input.notes, lines: input.lines });
    if (input.issue) inv = await issueInvoice(sb, inv.id);
    bust();
    return { success: true, data: inv };
  } catch (e) { return fail(e, "Could not create the invoice"); }
}

export async function issueInvoiceAction(id: string): Promise<Result<Invoice>> {
  try { const { sb } = await gate("owner"); const inv = await issueInvoice(sb, id); bust(); return { success: true, data: inv }; }
  catch (e) { return fail(e, "Could not issue"); }
}
export async function voidInvoiceAction(id: string, reason: string): Promise<Result> {
  try { const { sb } = await gate("owner"); await voidInvoice(sb, id, reason); bust(); return { success: true }; }
  catch (e) { return fail(e, "Could not void"); }
}
export async function creditNoteAction(invoiceId: string, amount: number | null, reason: string): Promise<Result<Invoice>> {
  try {
    if (!reason.trim()) throw new BillingError("Give a reason for the credit note");
    const { sb, actor } = await gate("owner");
    const cn = await createCreditNote(sb, { invoice_id: invoiceId, amount, reason, actor });
    bust();
    return { success: true, data: cn };
  } catch (e) { return fail(e, "Could not issue the credit note"); }
}

// ── payments ────────────────────────────────────────────────────────────
export async function recordBankTransfer(input: { invoice_id: string; amount: number; reference: string; note?: string; received_at?: string }): Promise<Result<Invoice>> {
  try {
    const { sb, actor } = await gate("edit");
    const { invoice } = await recordPayment(sb, { invoice_id: input.invoice_id, method: "bank_transfer", amount: input.amount, reference: input.reference, note: input.note, recorded_by: actor });
    bust();
    return { success: true, data: invoice };
  } catch (e) { return fail(e, "Could not record the payment"); }
}
export async function decidePendingPayment(paymentId: string, ok: boolean): Promise<Result> {
  try { const { sb, actor } = await gate("edit"); await confirmPendingPayment(sb, paymentId, ok, actor); bust(); return { success: true }; }
  catch (e) { return fail(e, "Could not update the payment"); }
}
export async function manualActivateAction(subscriptionId: string, months: number, note: string): Promise<Result> {
  try {
    if (!note.trim()) throw new BillingError("Write why this subscription is activated without a payment");
    const { sb, actor } = await gate("owner");
    await manualActivate(sb, subscriptionId, months, note, actor);
    bust();
    return { success: true };
  } catch (e) { return fail(e, "Could not activate"); }
}
export async function cancelSubscriptionAction(subscriptionId: string, atPeriodEnd: boolean): Promise<Result> {
  try {
    const { sb } = await gate("owner");
    const patch = atPeriodEnd ? { cancel_at_period_end: true } : { status: "canceled", current_period_end: new Date().toISOString() };
    const { error } = await sb.from("subscriptions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", subscriptionId);
    if (error) throw new BillingError(error.message);
    await syncTiers(sb);
    bust();
    return { success: true };
  } catch (e) { return fail(e, "Could not cancel"); }
}
export async function resyncTiersAction(): Promise<Result<{ changed: number }>> {
  try { const { sb } = await gate("owner"); const changed = await syncTiers(sb); return { success: true, data: { changed } }; }
  catch (e) { return fail(e, "Could not sync tiers"); }
}

// ── ETA (portal era) ────────────────────────────────────────────────────
export async function recordEtaAction(input: { invoice_id: string; uuid: string; long_id?: string; status: "submitted" | "valid" | "invalid" | "rejected" | "cancelled" }): Promise<Result> {
  try { const { sb, actor } = await gate("owner"); await recordEtaSubmission(sb, { ...input, actor }); bust(); return { success: true }; }
  catch (e) { return fail(e, "Could not record the ETA result"); }
}

// ── settings ────────────────────────────────────────────────────────────
export async function saveBillingSettings(patch: Partial<BillingSettings>): Promise<Result> {
  try {
    const { sb } = await gate("owner");
    const allowed: (keyof BillingSettings)[] = [
      "issuer_legal_name", "issuer_legal_name_ar", "issuer_tax_id", "issuer_activity_code", "issuer_branch_id", "issuer_address", "bank_details",
      "invoice_prefix", "vat_rate", "grace_days", "renew_before_days", "reminder_days", "fx_source", "paymob_enabled", "paymob_merchant_id", "paymob_integration_id", "paymob_iframe_id",
    ];
    const clean: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    const { error } = await sb.from("billing_settings").upsert(clean, { onConflict: "id" });
    if (error) throw new BillingError(error.message);
    bust();
    return { success: true };
  } catch (e) { return fail(e, "Could not save settings"); }
}
export async function saveBillingSecret(key: "paymob_api_key" | "paymob_hmac" | "eta_client_id" | "eta_client_secret", value: string): Promise<Result> {
  try {
    const { sb } = await gate("owner");
    const { error } = await sb.rpc("billing_set_secret", { p_key: key, p_value: value });
    if (error) throw new BillingError(error.message);
    return { success: true };
  } catch (e) { return fail(e, "Could not store the secret"); }
}
export async function getBillingSecretStatus(): Promise<Result<Record<string, boolean>>> {
  try {
    await gate("view");
    const { data } = await billingDb().from("billing_secret").select("key");
    const keys = new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
    return { success: true, data: { paymob_api_key: keys.has("paymob_api_key"), paymob_hmac: keys.has("paymob_hmac"), eta_client_id: keys.has("eta_client_id"), eta_client_secret: keys.has("eta_client_secret") } };
  } catch (e) { return fail(e, "Could not read secrets"); }
}
export async function setFxRateAction(rate: number): Promise<Result> {
  try {
    if (!(rate > 0)) throw new BillingError("Rate must be positive");
    const { sb } = await gate("owner");
    await setManualRate(sb, rate);
    bust();
    return { success: true };
  } catch (e) { return fail(e, "Could not set the rate"); }
}
export async function refreshFxAction(): Promise<Result<{ rate: number; source: string; day: string }>> {
  try {
    const { sb } = await gate("edit");
    await sb.from("fx_rates").delete().eq("day", new Date().toISOString().slice(0, 10)).neq("source", "manual");
    const fx = await getUsdEgpRate(sb);
    if (!fx) throw new BillingError("No rate source answered");
    bust();
    return { success: true, data: fx };
  } catch (e) { return fail(e, "Could not refresh the rate"); }
}

// ── catalogue (owner) ───────────────────────────────────────────────────
export async function savePlanCatalogue(input: { plans: { code: PlanCode; egs_code: string | null; gpc_code: string | null; name: string; name_ar: string | null }[]; prices: { plan_code: PlanCode; period: BillingPeriod; unit_amount: number }[] }): Promise<Result> {
  try {
    const { sb } = await gate("owner");
    for (const p of input.plans) {
      const { error } = await sb.from("plans").update({ egs_code: p.egs_code?.trim() || null, gpc_code: p.gpc_code?.trim() || null, name: p.name.trim() || p.code, name_ar: p.name_ar?.trim() || null }).eq("code", p.code);
      if (error) throw new BillingError(error.message);
    }
    // prices: retire the current USD row and insert the new one only when the amount changed
    const { prices } = await getCatalogue(sb);
    const today = new Date().toISOString().slice(0, 10);
    for (const np of input.prices) {
      if (!(np.unit_amount >= 0)) continue;
      const cur = prices.find((x) => x.plan_code === np.plan_code && x.period === np.period && x.currency === "USD");
      if (cur && Math.abs(cur.unit_amount - np.unit_amount) < 0.005) continue;
      if (cur) await sb.from("prices").update({ active_to: today }).eq("id", cur.id);
      const { error } = await sb.from("prices").insert({ plan_code: np.plan_code, period: np.period, currency: "USD", unit_amount: np.unit_amount, active_from: today });
      if (error) throw new BillingError(error.message);
    }
    bust();
    return { success: true };
  } catch (e) { return fail(e, "Could not save the catalogue"); }
}

export async function getPlanCatalogue(): Promise<Result<{ plans: Plan[]; prices: { plan_code: string; period: string; currency: string; unit_amount: number }[] }>> {
  try { await gate("view"); const c = await getCatalogue(billingDb()); return { success: true, data: c }; }
  catch (e) { return fail(e, "Could not load the catalogue"); }
}
