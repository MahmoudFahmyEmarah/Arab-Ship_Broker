// Billing & Gateway Layer — server core. Every money-changing operation lives
// here and runs on the service-role client, so RLS never has a write path for
// members and every caller (admin actions, member self-serve, webhooks, cron)
// goes through the same rules:
//   · drafts are built from the price list and the customer's tax profile
//   · issuing freezes the FX rate, snapshots issuer + customer, assigns the
//     gapless number and sets the due date; the database then locks the row
//   · payments are rows; the database settles the invoice; this module then
//     activates the subscription period and re-syncs member tiers
// Import only from server code (actions, route handlers, server components).
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  BillingCustomer, BillingCurrency, BillingPeriod, BillingSettings, EtaAddress, Invoice, InvoiceLine, Payment,
  PaymentMethod, Plan, PlanCode, Price, Subscription, VatTreatment,
} from "./types";
import { ETA_VAT_SUBTYPE } from "./types";
import { addPeriod, computeLine, round2 } from "./money";
import { getUsdEgpRate } from "./fx";
import type { EtaIssuer } from "./eta";

export type Db = SupabaseClient;
export const billingDb = (): Db => getSupabaseAdminClient();

export class BillingError extends Error {}

const fail = (msg: string): never => { throw new BillingError(msg); };

// ── settings ────────────────────────────────────────────────────────────
export async function getBillingSettings(sb: Db): Promise<BillingSettings> {
  const { data, error } = await sb.from("billing_settings").select("*").eq("id", 1).maybeSingle();
  if (error) fail(error.message);
  const d = (data ?? {}) as Partial<BillingSettings>;
  return {
    issuer_legal_name: d.issuer_legal_name ?? null,
    issuer_legal_name_ar: d.issuer_legal_name_ar ?? null,
    issuer_tax_id: d.issuer_tax_id ?? null,
    issuer_activity_code: d.issuer_activity_code ?? null,
    issuer_branch_id: d.issuer_branch_id ?? "0",
    issuer_address: (d.issuer_address ?? {}) as EtaAddress,
    bank_details: d.bank_details ?? {},
    invoice_prefix: d.invoice_prefix ?? "ASB",
    vat_rate: Number(d.vat_rate ?? 14),
    grace_days: Number(d.grace_days ?? 7),
    renew_before_days: Number(d.renew_before_days ?? 7),
    reminder_days: d.reminder_days ?? [7, 1],
    fx_source: d.fx_source ?? "CBE",
    paymob_enabled: !!d.paymob_enabled,
    paymob_merchant_id: d.paymob_merchant_id ?? null,
    paymob_integration_id: d.paymob_integration_id ?? null,
    paymob_iframe_id: d.paymob_iframe_id ?? null,
    updated_at: d.updated_at ?? new Date().toISOString(),
  };
}

export function issuerFromSettings(s: BillingSettings): EtaIssuer | null {
  if (!s.issuer_legal_name || !s.issuer_tax_id) return null;
  return {
    legalName: s.issuer_legal_name,
    taxId: s.issuer_tax_id,
    activityCode: s.issuer_activity_code ?? "",
    branchId: s.issuer_branch_id,
    address: s.issuer_address,
  };
}

// ── catalogue ───────────────────────────────────────────────────────────
export async function getCatalogue(sb: Db): Promise<{ plans: Plan[]; prices: Price[] }> {
  const [p, pr] = await Promise.all([
    sb.from("plans").select("*").eq("is_active", true).order("sort_order"),
    sb.from("prices").select("*").is("active_to", null).order("active_from", { ascending: false }),
  ]);
  if (p.error) fail(p.error.message);
  if (pr.error) fail(pr.error.message);
  return { plans: (p.data ?? []) as Plan[], prices: ((pr.data ?? []) as Price[]).map((x) => ({ ...x, unit_amount: Number(x.unit_amount) })) };
}

/** Unit price per seat for a plan/period in the customer's currency; EGP derives from USD at the day's rate. */
export async function resolveUnitPrice(sb: Db, planCode: PlanCode, period: BillingPeriod, currency: BillingCurrency): Promise<{ unitPrice: number; fx: { rate: number; source: string; day: string } | null }> {
  const { prices } = await getCatalogue(sb);
  const exact = prices.find((p) => p.plan_code === planCode && p.period === period && p.currency === currency);
  if (exact) return { unitPrice: exact.unit_amount, fx: currency === "USD" ? await getUsdEgpRate(sb) : null };
  const usd = prices.find((p) => p.plan_code === planCode && p.period === period && p.currency === "USD");
  if (!usd) fail(`No price for ${planCode} ${period}`);
  if (currency === "EGP") {
    const fx = await getUsdEgpRate(sb);
    if (!fx) fail("No USD→EGP rate available — set one in Billing settings");
    return { unitPrice: round2(usd!.unit_amount * fx!.rate), fx };
  }
  return { unitPrice: usd!.unit_amount, fx: null };
}

// ── customers ───────────────────────────────────────────────────────────
export type CustomerInput = {
  org_id?: string | null;
  user_id?: string | null;
  legal_name: string;
  legal_name_ar?: string | null;
  receiver_type?: "B" | "P" | "F";
  tax_id?: string | null;
  country?: string;
  address?: EtaAddress;
  currency?: BillingCurrency;
  vat_treatment?: VatTreatment;
  billing_email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

function normalizeCustomer(input: CustomerInput) {
  const country = (input.country ?? "EG").toUpperCase().slice(0, 2);
  const receiver = input.receiver_type ?? (country === "EG" ? "B" : "F");
  return {
    legal_name: input.legal_name.trim(),
    legal_name_ar: input.legal_name_ar?.trim() || null,
    receiver_type: receiver,
    tax_id: input.tax_id?.trim() || null,
    country,
    address: input.address ?? {},
    currency: input.currency ?? (country === "EG" ? "EGP" : "USD"),
    vat_treatment: input.vat_treatment ?? (country === "EG" ? "standard" : "pending_review"),
    billing_email: input.billing_email?.trim() || null,
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

export async function upsertCustomer(sb: Db, input: CustomerInput, actor: string | null, id?: string): Promise<BillingCustomer> {
  if (!input.legal_name?.trim()) fail("Legal name is required");
  if (!id && !input.org_id && !input.user_id) fail("A customer belongs to a company or a member");
  const row = normalizeCustomer(input);
  if (id) {
    const { data, error } = await sb.from("billing_customers").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
    if (error) fail(error.message);
    return data as BillingCustomer;
  }
  const { data, error } = await sb.from("billing_customers")
    .insert({ ...row, org_id: input.org_id ?? null, user_id: input.user_id ?? null, created_by: actor })
    .select("*").single();
  if (error) fail(error.code === "23505" ? "This company or member already has a billing profile" : error.message);
  return data as BillingCustomer;
}

export async function findCustomerFor(sb: Db, ref: { org_id?: string | null; user_id?: string | null }): Promise<BillingCustomer | null> {
  let q = sb.from("billing_customers").select("*");
  q = ref.org_id ? q.eq("org_id", ref.org_id) : q.eq("user_id", ref.user_id ?? "00000000-0000-0000-0000-000000000000");
  const { data } = await q.maybeSingle();
  return (data as BillingCustomer | null) ?? null;
}

// ── subscriptions + invoices ────────────────────────────────────────────
export async function createSubscription(sb: Db, input: { customer_id: string; plan_code: PlanCode; period: BillingPeriod; seats: number; actor: string | null; notes?: string | null }): Promise<Subscription> {
  if (input.seats < 1 || input.seats > 500) fail("Seats must be between 1 and 500");
  const { data, error } = await sb.from("subscriptions")
    .insert({ customer_id: input.customer_id, plan_code: input.plan_code, period: input.period, seats: input.seats, status: "trialing", created_by: input.actor, notes: input.notes ?? null })
    .select("*").single();
  if (error) fail(error.message);
  return data as Subscription;
}

function periodLabel(start: Date, end: Date, period: BillingPeriod): string {
  const f = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return period === "monthly" ? start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : `${f(start)} – ${f(new Date(end.getTime() - 86400000))}`;
}

/** Draft the invoice for one subscription period (does not issue it). */
export async function draftSubscriptionInvoice(sb: Db, input: { subscription: Subscription; customer: BillingCustomer; plan: Plan; periodStart: Date; actor: string | null }): Promise<Invoice> {
  const { subscription: s, customer: c, plan } = input;
  const settings = await getBillingSettings(sb);
  const start = input.periodStart;
  const end = addPeriod(start, s.period);
  const { unitPrice, fx } = await resolveUnitPrice(sb, s.plan_code, s.period, c.currency);
  const treatment: VatTreatment = c.vat_treatment;
  const line = computeLine({ quantity: s.seats, unitPrice, treatment, vatRate: settings.vat_rate });

  const { data: inv, error } = await sb.from("invoices").insert({
    customer_id: c.id, subscription_id: s.id, document_type: "I", status: "draft",
    currency: c.currency,
    fx_rate: c.currency === "EGP" ? 1 : fx?.rate ?? null, fx_source: c.currency === "EGP" ? "n/a" : fx?.source ?? null, fx_date: fx?.day ?? null,
    vat_treatment: treatment, vat_rate: line.taxRate,
    period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10),
    created_by: input.actor,
  }).select("*").single();
  if (error) fail(error.message);
  const invoice = inv as Invoice;

  const { error: lErr } = await sb.from("invoice_lines").insert({
    invoice_id: invoice.id, position: 1,
    description: `${plan.name} plan · ${s.seats} seat${s.seats === 1 ? "" : "s"} · ${periodLabel(start, end, s.period)}`,
    description_ar: plan.name_ar ? `خطة ${plan.name_ar} · ${s.seats} مقعد · ${periodLabel(start, end, s.period)}` : null,
    item_type: "EGS", item_code: plan.egs_code, unit_type: "EA",
    quantity: s.seats, unit_price: unitPrice, discount: 0,
    tax_type: "T1", tax_subtype: line.taxSubtype, tax_rate: line.taxRate,
    net_total: line.net, tax_amount: line.tax, total: line.total,
  });
  if (lErr) fail(lErr.message);
  await sb.rpc("fn_invoice_recalc", { p_invoice_id: invoice.id });
  return (await getInvoice(sb, invoice.id)).invoice;
}

/** Custom / manual invoice (Partner plans, services) — lines given by the owner. */
export async function draftCustomInvoice(sb: Db, input: {
  customer: BillingCustomer; actor: string | null; notes?: string | null; subscription_id?: string | null;
  lines: { description: string; description_ar?: string | null; item_code?: string | null; quantity: number; unit_price: number; discount?: number }[];
}): Promise<Invoice> {
  if (!input.lines.length) fail("Add at least one line");
  const settings = await getBillingSettings(sb);
  const c = input.customer;
  const fx = c.currency === "USD" ? await getUsdEgpRate(sb) : null;
  const { data: inv, error } = await sb.from("invoices").insert({
    customer_id: c.id, subscription_id: input.subscription_id ?? null, document_type: "I", status: "draft", currency: c.currency,
    fx_rate: c.currency === "EGP" ? 1 : fx?.rate ?? null, fx_source: c.currency === "EGP" ? "n/a" : fx?.source ?? null, fx_date: fx?.day ?? null,
    vat_treatment: c.vat_treatment, vat_rate: ETA_VAT_SUBTYPE[c.vat_treatment].rate, notes: input.notes ?? null, created_by: input.actor,
  }).select("*").single();
  if (error) fail(error.message);
  const invoice = inv as Invoice;
  const rows = input.lines.map((l, i) => {
    const calc = computeLine({ quantity: l.quantity, unitPrice: l.unit_price, discount: l.discount ?? 0, treatment: c.vat_treatment, vatRate: settings.vat_rate });
    return {
      invoice_id: invoice.id, position: i + 1, description: l.description.trim(), description_ar: l.description_ar?.trim() || null,
      item_type: "EGS", item_code: l.item_code?.trim() || null, unit_type: "EA", quantity: l.quantity, unit_price: round2(l.unit_price), discount: round2(l.discount ?? 0),
      tax_type: "T1", tax_subtype: calc.taxSubtype, tax_rate: calc.taxRate, net_total: calc.net, tax_amount: calc.tax, total: calc.total,
    };
  });
  const { error: lErr } = await sb.from("invoice_lines").insert(rows);
  if (lErr) fail(lErr.message);
  await sb.rpc("fn_invoice_recalc", { p_invoice_id: invoice.id });
  return (await getInvoice(sb, invoice.id)).invoice;
}

export async function getInvoice(sb: Db, id: string): Promise<{ invoice: Invoice; lines: InvoiceLine[]; customer: BillingCustomer; payments: Payment[] }> {
  const { data: invoice, error } = await sb.from("invoices").select("*").eq("id", id).single();
  if (error || !invoice) fail("Invoice not found");
  const [lines, customer, payments] = await Promise.all([
    sb.from("invoice_lines").select("*").eq("invoice_id", id).order("position"),
    sb.from("billing_customers").select("*").eq("id", (invoice as Invoice).customer_id).single(),
    sb.from("payments").select("*").eq("invoice_id", id).order("received_at"),
  ]);
  return {
    invoice: numeric(invoice as Invoice),
    lines: ((lines.data ?? []) as InvoiceLine[]).map(numericLine),
    customer: customer.data as BillingCustomer,
    payments: ((payments.data ?? []) as Payment[]).map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

const numeric = (i: Invoice): Invoice => ({
  ...i, subtotal: Number(i.subtotal), discount_total: Number(i.discount_total), tax_total: Number(i.tax_total), total: Number(i.total),
  amount_paid: Number(i.amount_paid), egp_total: i.egp_total == null ? null : Number(i.egp_total), fx_rate: i.fx_rate == null ? null : Number(i.fx_rate), vat_rate: Number(i.vat_rate),
});
const numericLine = (l: InvoiceLine): InvoiceLine => ({
  ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price), discount: Number(l.discount), tax_rate: Number(l.tax_rate),
  net_total: Number(l.net_total), tax_amount: Number(l.tax_amount), total: Number(l.total),
});

/** Issue a draft: freeze FX, snapshot issuer + customer, number it, set due date. */
export async function issueInvoice(sb: Db, id: string): Promise<Invoice> {
  const { invoice, lines, customer } = await getInvoice(sb, id);
  if (invoice.status !== "draft") fail("Only drafts can be issued");
  if (!lines.length || invoice.total <= 0) fail("The invoice has no amount");
  const settings = await getBillingSettings(sb);
  let fxRate = invoice.fx_rate, fxSource = invoice.fx_source, fxDay = invoice.fx_date;
  if (invoice.currency === "USD" && fxRate == null) {
    const fx = await getUsdEgpRate(sb);
    if (!fx) fail("No USD→EGP rate available — set one in Billing settings before issuing");
    fxRate = fx!.rate; fxSource = fx!.source; fxDay = fx!.day;
    await sb.from("invoices").update({ fx_rate: fxRate, fx_source: fxSource, fx_date: fxDay }).eq("id", id);
    await sb.rpc("fn_invoice_recalc", { p_invoice_id: id });
  }
  const now = new Date();
  const { data: num, error: nErr } = await sb.rpc("fn_next_invoice_number", { p_prefix: settings.invoice_prefix, p_year: now.getUTCFullYear() });
  if (nErr) fail(nErr.message);
  const issuerSnapshot = {
    legal_name: settings.issuer_legal_name, legal_name_ar: settings.issuer_legal_name_ar, tax_id: settings.issuer_tax_id,
    activity_code: settings.issuer_activity_code, branch_id: settings.issuer_branch_id, address: settings.issuer_address, bank_details: settings.bank_details,
  };
  const { data, error } = await sb.from("invoices").update({
    status: "issued", number: num as string, issued_at: now.toISOString(),
    due_at: new Date(now.getTime() + settings.grace_days * 86400000).toISOString(),
    issuer_snapshot: issuerSnapshot, customer_snapshot: customer,
  }).eq("id", id).eq("status", "draft").select("*").single();
  if (error) fail(error.message);
  return numeric(data as Invoice);
}

export async function voidInvoice(sb: Db, id: string, reason: string): Promise<void> {
  const { invoice } = await getInvoice(sb, id);
  if (invoice.status === "draft") { await sb.from("invoices").delete().eq("id", id); return; }
  if (invoice.status === "paid" || invoice.status === "partially_paid") fail("A paid invoice cannot be voided — issue a credit note");
  if (invoice.eta_uuid) fail("This invoice reached the ETA — cancel it there and issue a credit note");
  const { error } = await sb.from("invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: reason.trim() || null }).eq("id", id);
  if (error) fail(error.message);
}

/** Credit note against an issued invoice (full or partial amount), issued immediately. */
export async function createCreditNote(sb: Db, input: { invoice_id: string; amount?: number | null; reason: string; actor: string | null }): Promise<Invoice> {
  const { invoice, lines, customer } = await getInvoice(sb, input.invoice_id);
  if (invoice.status === "draft" || invoice.status === "void") fail("Credit notes are for issued invoices");
  const full = input.amount == null || Math.abs(input.amount - invoice.total) < 0.005;
  const factor = full ? 1 : (input.amount as number) / invoice.total;
  if (!full && (factor <= 0 || factor > 1)) fail("Credit amount must be between 0 and the invoice total");
  const settings = await getBillingSettings(sb);
  const { data: cn, error } = await sb.from("invoices").insert({
    customer_id: customer.id, subscription_id: invoice.subscription_id, document_type: "C", related_invoice_id: invoice.id, status: "draft",
    currency: invoice.currency, fx_rate: invoice.fx_rate, fx_source: invoice.fx_source, fx_date: invoice.fx_date,
    vat_treatment: invoice.vat_treatment, vat_rate: invoice.vat_rate, period_start: invoice.period_start, period_end: invoice.period_end,
    notes: `Credit note for ${invoice.number}: ${input.reason.trim()}`, created_by: input.actor,
  }).select("*").single();
  if (error) fail(error.message);
  const note = cn as Invoice;
  const rows = lines.map((l) => {
    const calc = computeLine({ quantity: l.quantity, unitPrice: round2(l.unit_price * factor), discount: round2(l.discount * factor), treatment: invoice.vat_treatment, vatRate: settings.vat_rate });
    return {
      invoice_id: note.id, position: l.position, description: `Credit · ${l.description}`, description_ar: l.description_ar ? `إشعار دائن · ${l.description_ar}` : null,
      item_type: l.item_type, item_code: l.item_code, unit_type: l.unit_type, quantity: l.quantity, unit_price: round2(l.unit_price * factor), discount: round2(l.discount * factor),
      tax_type: l.tax_type, tax_subtype: l.tax_subtype, tax_rate: l.tax_rate, net_total: calc.net, tax_amount: calc.tax, total: calc.total,
    };
  });
  const { error: lErr } = await sb.from("invoice_lines").insert(rows);
  if (lErr) fail(lErr.message);
  await sb.rpc("fn_invoice_recalc", { p_invoice_id: note.id });
  const issued = await issueInvoice(sb, note.id);
  // a credit note is settled by definition — it records money owed back / written off
  await sb.from("payments").insert({ invoice_id: issued.id, customer_id: customer.id, method: "credit_note", status: "succeeded", amount: issued.total, currency: issued.currency, note: input.reason.trim(), recorded_by: input.actor });
  return (await getInvoice(sb, issued.id)).invoice;
}

// ── payments + activation ───────────────────────────────────────────────
export async function recordPayment(sb: Db, input: {
  invoice_id: string; method: PaymentMethod; amount: number; status?: "pending" | "succeeded"; reference?: string | null; note?: string | null;
  gateway?: string | null; gateway_payment_id?: string | null; raw?: unknown; recorded_by: string | null;
}): Promise<{ payment: Payment; invoice: Invoice }> {
  const { invoice } = await getInvoice(sb, input.invoice_id);
  if (invoice.status === "draft") fail("Issue the invoice before recording a payment");
  if (invoice.status === "void") fail("This invoice is void");
  if (!(input.amount > 0)) fail("Amount must be positive");
  const { data, error } = await sb.from("payments").insert({
    invoice_id: invoice.id, customer_id: invoice.customer_id, method: input.method, status: input.status ?? "succeeded",
    amount: round2(input.amount), currency: invoice.currency, gateway: input.gateway ?? null, gateway_payment_id: input.gateway_payment_id ?? null,
    reference: input.reference?.trim() || null, note: input.note?.trim() || null, raw: input.raw ?? null, recorded_by: input.recorded_by,
  }).select("*").single();
  if (error) fail(error.code === "23505" ? "This gateway payment was already recorded" : error.message);
  const after = (await getInvoice(sb, invoice.id)).invoice;
  if (after.status === "paid") await activateForInvoice(sb, after);
  return { payment: data as Payment, invoice: after };
}

export async function confirmPendingPayment(sb: Db, paymentId: string, ok: boolean, actor: string | null): Promise<void> {
  const { data: p, error } = await sb.from("payments").update({ status: ok ? "succeeded" : "failed", recorded_by: actor }).eq("id", paymentId).eq("status", "pending").select("invoice_id").single();
  if (error) fail(error.message);
  const inv = (await getInvoice(sb, (p as { invoice_id: string }).invoice_id)).invoice;
  if (inv.status === "paid") await activateForInvoice(sb, inv);
}

/** A paid subscription invoice starts (or extends) the period and re-syncs tiers. */
export async function activateForInvoice(sb: Db, invoice: Invoice): Promise<void> {
  if (!invoice.subscription_id || invoice.document_type !== "I") return;
  const { data: s } = await sb.from("subscriptions").select("*").eq("id", invoice.subscription_id).single();
  if (!s) return;
  const sub = s as Subscription;
  const start = invoice.period_start ? new Date(`${invoice.period_start}T00:00:00Z`) : new Date();
  const end = invoice.period_end ? new Date(`${invoice.period_end}T00:00:00Z`) : addPeriod(start, sub.period);
  const newEnd = sub.current_period_end && new Date(sub.current_period_end) > end ? sub.current_period_end : end.toISOString();
  await sb.from("subscriptions").update({
    status: "active", current_period_start: sub.current_period_start ?? start.toISOString(), current_period_end: newEnd, updated_at: new Date().toISOString(),
  }).eq("id", sub.id);
  await syncTiers(sb);
}

/** Owner shortcut: activate a subscription for a period without a payment record. */
export async function manualActivate(sb: Db, subscriptionId: string, months: number, note: string, actor: string | null): Promise<void> {
  const { data: s } = await sb.from("subscriptions").select("*").eq("id", subscriptionId).single();
  if (!s) fail("Subscription not found");
  const sub = s as Subscription;
  const base = sub.current_period_end && new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
  const end = new Date(base.getTime()); end.setUTCMonth(end.getUTCMonth() + Math.max(1, months));
  await sb.from("subscriptions").update({
    status: "active", current_period_start: sub.current_period_start ?? new Date().toISOString(), current_period_end: end.toISOString(),
    notes: [sub.notes, `Manual activation by owner (${months} mo): ${note}`].filter(Boolean).join("\n"), updated_at: new Date().toISOString(),
  }).eq("id", subscriptionId);
  await sb.from("billing_events").insert({ actor, entity: "subscriptions", entity_id: subscriptionId, action: "manual_activate", after: { months, note } });
  await syncTiers(sb);
}

export async function syncTiers(sb: Db): Promise<number> {
  const { data, error } = await sb.rpc("fn_billing_sync_tiers");
  if (error) fail(error.message);
  return Number(data ?? 0);
}

// ── ETA bookkeeping (portal era) ────────────────────────────────────────
export async function recordEtaSubmission(sb: Db, input: { invoice_id: string; uuid: string; long_id?: string | null; status: "submitted" | "valid" | "invalid" | "rejected" | "cancelled"; mode?: "portal" | "api"; response?: unknown; actor: string | null }): Promise<void> {
  const uuid = input.uuid.trim();
  if (!uuid) fail("The ETA UUID is required");
  await sb.from("einvoice_submissions").insert({ invoice_id: input.invoice_id, authority: "ETA", mode: input.mode ?? "portal", status: input.status, uuid, long_id: input.long_id?.trim() || null, response: input.response ?? null, attempted_by: input.actor });
  const { error } = await sb.from("invoices").update({
    einvoice_status: input.status, eta_uuid: uuid, eta_long_id: input.long_id?.trim() || null, eta_submitted_at: new Date().toISOString(), eta_response: input.response ?? null,
  }).eq("id", input.invoice_id);
  if (error) fail(error.message);
}
