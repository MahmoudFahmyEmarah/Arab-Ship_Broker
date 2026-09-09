// ETA e-invoicing console — owner-only (tax credentials). Reads the billing
// ledger on the service role: issued invoices and their ETA state.
import { requireAdmin } from "@/lib/admin/require-admin";
import { billingDb, getBillingSettings } from "@/lib/billing/server";
import { EtaConsole } from "@/components/portal/EtaConsole";
import type { Invoice } from "@/lib/billing/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "ETA e-invoicing Admin" };

export default async function AdminEtaPage() {
  await requireAdmin({ section: "eta" });
  const sb = billingDb();
  const [settings, inv, secrets] = await Promise.all([
    getBillingSettings(sb),
    sb.from("invoices").select("*, billing_customers(legal_name)").neq("status", "draft").neq("status", "void").order("issued_at", { ascending: false }).limit(300),
    sb.from("billing_secret").select("key").in("key", ["eta_client_id", "eta_client_secret"]),
  ]);
  const rows = ((inv.data ?? []) as (Invoice & { billing_customers?: { legal_name: string } | null })[]).map((r) => ({
    ...r, total: Number(r.total), egp_total: r.egp_total == null ? null : Number(r.egp_total), customer_name: r.billing_customers?.legal_name ?? "—",
  }));
  return (
    <div className="adm-page">
      <EtaConsole rows={rows} issuerReady={!!(settings.issuer_legal_name && settings.issuer_tax_id && settings.issuer_activity_code)} apiConfigured={(secrets.data?.length ?? 0) >= 2} />
    </div>
  );
}
