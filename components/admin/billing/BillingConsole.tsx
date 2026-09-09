"use client";

// Admin → Billing. Overview (money owed, pending transfers, drafts), Invoices
// (issue · record transfer · void · credit note · ETA UUID), Customers,
// Subscriptions and Settings. Reads come from getBillingOverview(); every
// change calls a server action and refreshes the page data.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BillingCustomer, Invoice, Plan, Subscription, BillingSettings } from "@/lib/billing/types";
import { fmtMoney } from "@/lib/billing/money";
import { decidePendingPayment, issueInvoiceAction } from "@/app/(admin)/admin/billing/actions";
import { InvoiceStatusBadge, EtaBadge, Money, fmtDate } from "./ui";
import { InvoiceDrawer } from "./InvoiceDrawer";
import { CustomersTab } from "./CustomersTab";
import { SubscriptionsTab } from "./SubscriptionsTab";
import { BillingSettingsTab } from "./BillingSettingsTab";

export type Overview = {
  settings: BillingSettings; plans: Plan[]; isOwner: boolean; fx: { rate: number; source: string; day: string } | null;
  customers: (BillingCustomer & { org_name?: string | null; user_name?: string | null })[];
  subscriptions: (Subscription & { customer_name: string; plan_name: string })[];
  invoices: (Invoice & { customer_name: string })[];
  pendingPayments: { id: string; invoice_id: string; invoice_number: string | null; customer_name: string; amount: number; currency: string; reference: string | null; received_at: string }[];
};

type Tab = "overview" | "invoices" | "customers" | "subscriptions" | "settings";

export function BillingConsole({ data, secrets, canEdit }: { data: Overview; secrets: Record<string, boolean>; canEdit: boolean }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("overview");
  const [openInvoice, setOpenInvoice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const refresh = () => router.refresh();

  const outstanding = data.invoices.filter((i) => i.status === "issued" || i.status === "partially_paid");
  const owed = outstanding.reduce<Record<string, number>>((acc, i) => { acc[i.currency] = (acc[i.currency] ?? 0) + (i.total - i.amount_paid); return acc; }, {});
  const drafts = data.invoices.filter((i) => i.status === "draft");
  const overdue = outstanding.filter((i) => i.due_at && new Date(i.due_at) < new Date());
  const issuerReady = !!(data.settings.issuer_legal_name && data.settings.issuer_tax_id);

  const decide = async (id: string, ok: boolean) => {
    setBusy(id);
    const r = await decidePendingPayment(id, ok);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(ok ? "Payment confirmed — invoice settled and seats activated." : "Payment rejected.");
    refresh();
  };
  const issue = async (id: string) => {
    setBusy(id);
    const r = await issueInvoiceAction(id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Issued ${r.data.number}.`);
    refresh();
  };

  return (
    <>
      <div className="adm-tabs">
        {([["overview", "Overview"], ["invoices", `Invoices · ${data.invoices.length}`], ["customers", `Customers · ${data.customers.length}`], ["subscriptions", `Subscriptions · ${data.subscriptions.length}`], ["settings", "Settings"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" className={`adm-tab${tab === id ? " is-on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {!issuerReady && (
        <div className="adm-page__warn">
          <span aria-hidden>⚠</span>
          <span>Issuer details are not set. Invoices can be issued, but they will not carry your legal name and tax number until <button type="button" className="adm-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setTab("settings")}>Settings → Issuer</button> is filled in.</span>
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="adm-stats">
            <div className="adm-stat"><span className="adm-stat__label">Outstanding</span><span className="adm-stat__value" style={{ fontSize: 20 }}>{Object.keys(owed).length ? Object.entries(owed).map(([c, n]) => fmtMoney(n, c)).join(" · ") : "—"}</span><span className="adm-stat__sub">{outstanding.length} open invoice{outstanding.length === 1 ? "" : "s"} · {overdue.length} overdue</span></div>
            <div className="adm-stat"><span className="adm-stat__label">Pending transfers</span><span className={`adm-stat__value${data.pendingPayments.length ? " is-amber" : ""}`}>{data.pendingPayments.length}</span><span className="adm-stat__sub">members who said they paid</span></div>
            <div className="adm-stat"><span className="adm-stat__label">Drafts</span><span className="adm-stat__value">{drafts.length}</span><span className="adm-stat__sub">awaiting issue</span></div>
            <div className="adm-stat"><span className="adm-stat__label">USD → EGP today</span><span className="adm-stat__value" style={{ fontSize: 20 }}>{data.fx ? data.fx.rate.toFixed(2) : "—"}</span><span className="adm-stat__sub">{data.fx ? `${data.fx.source} · ${data.fx.day}` : "no rate — set one in Settings"}</span></div>
          </div>

          <div className="adm-cols-2">
            <div className="adm-card">
              <div className="adm-card__head"><span className="adm-card__title">Pending bank transfers</span><span className="adm-card__sub">confirm against the bank statement</span></div>
              {data.pendingPayments.length === 0 ? <div className="adm-empty" style={{ padding: 20 }}>Nothing waiting.</div> : (
                <div className="adm-list">
                  {data.pendingPayments.map((p) => (
                    <div key={p.id} className="adm-list__row">
                      <div className="adm-list__body">
                        <div className="adm-list__title">{p.customer_name} · {fmtMoney(p.amount, p.currency)}</div>
                        <div className="adm-list__meta">{p.invoice_number ?? "invoice"} · ref {p.reference ?? "—"} · {fmtDate(p.received_at)}</div>
                      </div>
                      <div className="adm-list__actions">
                        <button type="button" className="adm-btn small approve" disabled={!canEdit || busy === p.id} onClick={() => decide(p.id, true)}>Confirm</button>
                        <button type="button" className="adm-btn small" disabled={!canEdit || busy === p.id} onClick={() => decide(p.id, false)}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="adm-card">
              <div className="adm-card__head"><span className="adm-card__title">Drafts &amp; overdue</span><span className="adm-card__sub">owner issues · everyone can open</span></div>
              {drafts.length + overdue.length === 0 ? <div className="adm-empty" style={{ padding: 20 }}>Clean.</div> : (
                <div className="adm-list">
                  {drafts.map((i) => (
                    <div key={i.id} className="adm-list__row">
                      <span className="adm-list__icon is-amber">D</span>
                      <div className="adm-list__body"><div className="adm-list__title">{i.customer_name} · <Money n={i.total} currency={i.currency} /></div><div className="adm-list__meta">draft · {fmtDate(i.created_at)}</div></div>
                      <div className="adm-list__actions">
                        <button type="button" className="adm-btn small" onClick={() => setOpenInvoice(i.id)}>Open</button>
                        {data.isOwner && <button type="button" className="adm-btn small primary" disabled={busy === i.id} onClick={() => issue(i.id)}>Issue</button>}
                      </div>
                    </div>
                  ))}
                  {overdue.map((i) => (
                    <div key={i.id} className="adm-list__row">
                      <span className="adm-list__icon is-red">!</span>
                      <div className="adm-list__body"><div className="adm-list__title">{i.number} · {i.customer_name} · <Money n={i.total - i.amount_paid} currency={i.currency} /></div><div className="adm-list__meta">due {fmtDate(i.due_at)}</div></div>
                      <div className="adm-list__actions"><button type="button" className="adm-btn small" onClick={() => setOpenInvoice(i.id)}>Open</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "invoices" && (
        <div className="adm-table">
          <table>
            <thead><tr><th>Number</th><th>Customer</th><th>Type</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th>ETA</th><th>Issued</th><th>Due</th><th /></tr></thead>
            <tbody>
              {data.invoices.length === 0 && <tr className="no-hover"><td colSpan={10} style={{ textAlign: "center", color: "var(--adm-muted)", padding: 24 }}>No invoices yet. Start a subscription from Customers, or raise a manual invoice.</td></tr>}
              {data.invoices.map((i) => (
                <tr key={i.id} onClick={() => setOpenInvoice(i.id)}>
                  <td className="mono">{i.number ?? "draft"}</td>
                  <td>{i.customer_name}</td>
                  <td>{i.document_type === "I" ? "Invoice" : i.document_type === "C" ? "Credit note" : "Debit note"}</td>
                  <td className="num"><Money n={i.total} currency={i.currency} egp={i.egp_total} /></td>
                  <td className="num">{fmtMoney(i.amount_paid, i.currency)}</td>
                  <td><InvoiceStatusBadge status={i.status} /></td>
                  <td><EtaBadge status={i.einvoice_status} /></td>
                  <td>{fmtDate(i.issued_at)}</td>
                  <td style={{ color: i.due_at && new Date(i.due_at) < new Date() && (i.status === "issued" || i.status === "partially_paid") ? "var(--adm-red)" : undefined }}>{fmtDate(i.due_at)}</td>
                  <td onClick={(e) => e.stopPropagation()}><Link href={`/admin/billing/invoices/${i.id}`} className="adm-link" target="_blank">Document ↗</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "customers" && <CustomersTab data={data} canEdit={canEdit} onChanged={refresh} onOpenInvoice={setOpenInvoice} />}
      {tab === "subscriptions" && <SubscriptionsTab data={data} canEdit={canEdit} onChanged={refresh} onOpenInvoice={setOpenInvoice} />}
      {tab === "settings" && <BillingSettingsTab settings={data.settings} secrets={secrets} isOwner={data.isOwner} fx={data.fx} onChanged={refresh} />}

      {openInvoice && <InvoiceDrawer id={openInvoice} isOwner={data.isOwner} canEdit={canEdit} onClose={() => setOpenInvoice(null)} onChanged={refresh} />}
    </>
  );
}
