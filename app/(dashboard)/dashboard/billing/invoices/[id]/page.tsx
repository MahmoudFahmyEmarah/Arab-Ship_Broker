// Member view of one of their invoices. Reads through the signed-in client,
// so RLS decides visibility (own personal profile or own company; never drafts).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { InvoiceDocument } from "@/components/billing/InvoiceDocument";
import { PrintButton } from "@/components/billing/PrintButton";
import type { BillingCustomer, Invoice, InvoiceLine, Payment } from "@/lib/billing/types";

export const dynamic = "force-dynamic";

export default async function MemberInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await getSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: inv } = await sb.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const invoice = inv as Invoice;
  const [lines, customer, payments, bank, related] = await Promise.all([
    sb.from("invoice_lines").select("*").eq("invoice_id", id).order("position"),
    sb.from("billing_customers").select("*").eq("id", invoice.customer_id).single(),
    sb.from("payments").select("*").eq("invoice_id", id).order("received_at"),
    sb.rpc("fn_billing_bank_details"),
    invoice.related_invoice_id ? sb.from("invoices").select("number, eta_uuid").eq("id", invoice.related_invoice_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  const snap = (invoice.issuer_snapshot ?? {}) as Record<string, unknown>;

  return (
    <div style={{ background: "var(--asb-gray-100)", minHeight: "100%", padding: "18px 0 40px" }}>
      <div className="no-print" style={{ maxWidth: 820, margin: "0 auto 12px", display: "flex", gap: 8, padding: "0 12px" }}>
        <Link href="/dashboard/account?tab=billing" className="asb-btn">← Subscription &amp; Billing</Link>
        <span style={{ flex: 1 }} />
        <PrintButton className="asb-btn primary" />
      </div>
      <InvoiceDocument
        invoice={{ ...invoice, subtotal: num(invoice.subtotal), discount_total: num(invoice.discount_total), tax_total: num(invoice.tax_total), total: num(invoice.total), amount_paid: num(invoice.amount_paid), egp_total: invoice.egp_total == null ? null : num(invoice.egp_total), fx_rate: invoice.fx_rate == null ? null : num(invoice.fx_rate), vat_rate: num(invoice.vat_rate) }}
        lines={((lines.data ?? []) as InvoiceLine[]).map((l) => ({ ...l, quantity: num(l.quantity), unit_price: num(l.unit_price), discount: num(l.discount), tax_rate: num(l.tax_rate), net_total: num(l.net_total), tax_amount: num(l.tax_amount), total: num(l.total) }))}
        customer={customer.data as BillingCustomer}
        payments={((payments.data ?? []) as Payment[]).map((p) => ({ ...p, amount: num(p.amount) }))}
        issuer={snap}
        bank={((snap.bank_details as Record<string, string> | undefined) ?? (bank.data as Record<string, string> | null)) ?? null}
        related={(related.data as { number: string | null; eta_uuid: string | null } | null) ?? null}
      />
    </div>
  );
}
