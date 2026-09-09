// Admin view of one invoice document (print → PDF). Owner and billing seats.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { billingDb, getBillingSettings, getInvoice } from "@/lib/billing/server";
import { InvoiceDocument } from "@/components/billing/InvoiceDocument";
import { PrintButton } from "@/components/billing/PrintButton";

export const dynamic = "force-dynamic";

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin({ section: "billing" });
  const { id } = await params;
  const sb = billingDb();
  let bundle;
  try { bundle = await getInvoice(sb, id); } catch { notFound(); }
  const settings = await getBillingSettings(sb);
  const snap = (bundle.invoice.issuer_snapshot ?? {
    legal_name: settings.issuer_legal_name, legal_name_ar: settings.issuer_legal_name_ar, tax_id: settings.issuer_tax_id,
    activity_code: settings.issuer_activity_code, address: settings.issuer_address, bank_details: settings.bank_details,
  }) as Record<string, unknown>;
  const related = bundle.invoice.related_invoice_id
    ? (await sb.from("invoices").select("number, eta_uuid").eq("id", bundle.invoice.related_invoice_id).maybeSingle()).data as { number: string | null; eta_uuid: string | null } | null
    : null;

  return (
    <div style={{ background: "var(--asb-gray-100)", minHeight: "100%", padding: "18px 0 40px" }}>
      <div className="no-print" style={{ maxWidth: 820, margin: "0 auto 12px", display: "flex", gap: 8, padding: "0 12px" }}>
        <Link href="/admin/billing" className="adm-btn">← Billing</Link>
        <span style={{ flex: 1 }} />
        <PrintButton />
      </div>
      <InvoiceDocument
        invoice={bundle.invoice} lines={bundle.lines} customer={bundle.customer} payments={bundle.payments}
        issuer={snap} bank={(snap.bank_details as Record<string, string> | undefined) ?? settings.bank_details as Record<string, string>} related={related}
      />
    </div>
  );
}
