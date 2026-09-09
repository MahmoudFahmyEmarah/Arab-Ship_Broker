"use client";

// One invoice: lines, payments, ETA state, and the actions the viewer's role
// allows. Issue / void / credit / ETA are owner-only; recording a transfer is
// open to the billing seat.
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BillingCustomer, Invoice, InvoiceLine, Payment } from "@/lib/billing/types";
import { fmtMoney } from "@/lib/billing/money";
import { creditNoteAction, getInvoiceDetail, issueInvoiceAction, recordBankTransfer, recordEtaAction, voidInvoiceAction } from "@/app/(admin)/admin/billing/actions";
import { Drawer, Field, Grid2, InvoiceStatusBadge, EtaBadge, Money, fmtDate } from "./ui";

type Bundle = { invoice: Invoice; lines: InvoiceLine[]; customer: BillingCustomer; payments: Payment[] };

export function InvoiceDrawer({ id, isOwner, canEdit, onClose, onChanged }: { id: string; isOwner: boolean; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [b, setB] = React.useState<Bundle | null>(null);
  const [mode, setMode] = React.useState<"view" | "pay" | "credit" | "void" | "eta">("view");
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [note, setNote] = React.useState("");
  const [etaUuid, setEtaUuid] = React.useState("");
  const [etaLong, setEtaLong] = React.useState("");
  const [etaStatus, setEtaStatus] = React.useState<"submitted" | "valid" | "invalid" | "rejected" | "cancelled">("valid");

  const load = React.useCallback(async () => {
    const r = await getInvoiceDetail(id);
    if (!r.success) { toast.error(r.error); onClose(); return; }
    setB(r.data);
    setAmount(String((r.data.invoice.total - r.data.invoice.amount_paid).toFixed(2)));
  }, [id, onClose]);
  React.useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.success) { toast.error(r.error ?? "Failed"); return; }
    toast.success(ok);
    setMode("view");
    await load();
    onChanged();
  };

  if (!b) return <Drawer title="Invoice" onClose={onClose}><div style={{ color: "var(--adm-muted)" }}>Loading…</div></Drawer>;
  const { invoice: inv, lines, customer, payments } = b;
  const open = inv.total - inv.amount_paid;
  const isOpen = inv.status === "issued" || inv.status === "partially_paid";

  return (
    <Drawer title={inv.number ?? "Draft invoice"} subtitle={<>{customer.legal_name} · <InvoiceStatusBadge status={inv.status} /> <EtaBadge status={inv.einvoice_status} /></>} onClose={onClose} wide>
      <div className="adm-kv" style={{ marginBottom: 14 }}>
        <span className="adm-kv__k">Customer</span><span className="adm-kv__v">{customer.legal_name}{customer.tax_id ? ` · tax id ${customer.tax_id}` : ""} · {customer.country}</span>
        <span className="adm-kv__k">Type</span><span className="adm-kv__v">{inv.document_type === "I" ? "Invoice" : inv.document_type === "C" ? "Credit note" : "Debit note"}{inv.related_invoice_id ? " (references an earlier invoice)" : ""}</span>
        <span className="adm-kv__k">Period</span><span className="adm-kv__v">{inv.period_start ? `${fmtDate(inv.period_start)} → ${fmtDate(inv.period_end)}` : "—"}</span>
        <span className="adm-kv__k">VAT</span><span className="adm-kv__v">{inv.vat_treatment.replace(/_/g, " ")} · {inv.vat_rate}%{inv.vat_treatment === "pending_review" ? " · accountant to confirm" : ""}</span>
        <span className="adm-kv__k">FX</span><span className="adm-kv__v">{inv.currency === "EGP" ? "EGP invoice" : inv.fx_rate ? `1 USD = ${inv.fx_rate} EGP · ${inv.fx_source} · ${inv.fx_date}` : "frozen at issue"}</span>
        <span className="adm-kv__k">Issued / due</span><span className="adm-kv__v">{fmtDate(inv.issued_at)} / {fmtDate(inv.due_at)}</span>
        {inv.eta_uuid && <><span className="adm-kv__k">ETA UUID</span><span className="adm-kv__v mono">{inv.eta_uuid}{inv.eta_long_id ? ` · ${inv.eta_long_id}` : ""}</span></>}
      </div>

      <div className="adm-table" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>#</th><th>Description</th><th>Code</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="no-hover">
                <td className="row-num">{l.position}</td><td>{l.description}</td><td className="mono">{l.item_code ?? "—"}</td>
                <td className="num">{l.quantity}</td><td className="num">{fmtMoney(l.unit_price, inv.currency)}</td><td className="num">{fmtMoney(l.tax_amount, inv.currency)} ({l.tax_rate}%)</td><td className="num">{fmtMoney(l.total, inv.currency)}</td>
              </tr>
            ))}
            <tr className="no-hover"><td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>Total</td><td className="num" style={{ fontWeight: 600 }}><Money n={inv.total} currency={inv.currency} egp={inv.egp_total} /></td></tr>
            <tr className="no-hover"><td colSpan={6} style={{ textAlign: "right" }}>Paid</td><td className="num">{fmtMoney(inv.amount_paid, inv.currency)}</td></tr>
            {isOpen && <tr className="no-hover"><td colSpan={6} style={{ textAlign: "right", color: "var(--adm-red)" }}>Open</td><td className="num" style={{ color: "var(--adm-red)" }}>{fmtMoney(open, inv.currency)}</td></tr>}
          </tbody>
        </table>
      </div>

      {payments.length > 0 && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <div className="adm-card__head"><span className="adm-card__title">Payments</span></div>
          <div className="adm-list">
            {payments.map((p) => (
              <div key={p.id} className="adm-list__row">
                <div className="adm-list__body"><div className="adm-list__title">{fmtMoney(p.amount, p.currency)} · {p.method.replace("_", " ")} · <span className={`adm-badge ${p.status === "succeeded" ? "live" : p.status === "pending" ? "pending" : "rejected"}`}>{p.status}</span></div><div className="adm-list__meta">{fmtDate(p.received_at)}{p.reference ? ` · ref ${p.reference}` : ""}{p.note ? ` · ${p.note}` : ""}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "view" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/admin/billing/invoices/${inv.id}`} target="_blank" className="adm-btn">Open document ↗</Link>
          {inv.status === "draft" && isOwner && <button type="button" className="adm-btn primary" disabled={busy} onClick={() => run(() => issueInvoiceAction(inv.id), "Invoice issued.")}>Issue</button>}
          {inv.status === "draft" && isOwner && <button type="button" className="adm-btn" disabled={busy} onClick={() => run(() => voidInvoiceAction(inv.id, "draft discarded"), "Draft discarded.")}>Discard draft</button>}
          {isOpen && canEdit && <button type="button" className="adm-btn approve" onClick={() => setMode("pay")}>Record bank transfer</button>}
          {isOpen && isOwner && !inv.eta_uuid && <button type="button" className="adm-btn" onClick={() => setMode("void")}>Void</button>}
          {(inv.status === "paid" || isOpen) && isOwner && inv.document_type === "I" && <button type="button" className="adm-btn" onClick={() => setMode("credit")}>Credit note</button>}
          {inv.status !== "draft" && inv.status !== "void" && isOwner && <button type="button" className="adm-btn" onClick={() => setMode("eta")}>{inv.eta_uuid ? "Update ETA result" : "Record ETA UUID"}</button>}
        </div>
      )}

      {mode === "pay" && (
        <div className="adm-card">
          <div className="adm-card__head"><span className="adm-card__title">Record bank transfer</span></div>
          <Grid2>
            <Field label={`Amount (${inv.currency})`}><input className="adm-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Bank reference"><input className="adm-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="statement reference" /></Field>
          </Grid2>
          <Field label="Note (optional)"><input className="adm-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="adm-btn approve" disabled={busy || !ref.trim() || !(Number(amount) > 0)} onClick={() => run(() => recordBankTransfer({ invoice_id: inv.id, amount: Number(amount), reference: ref, note }), "Payment recorded.")}>Save payment</button>
            <button type="button" className="adm-btn ghost" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "void" && (
        <div className="adm-card">
          <div className="adm-card__head"><span className="adm-card__title">Void this invoice</span><span className="adm-card__sub">only for unpaid invoices that never reached the ETA</span></div>
          <Field label="Reason"><input className="adm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="issued in error, duplicate, …" /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="adm-btn reject" disabled={busy || !note.trim()} onClick={() => run(() => voidInvoiceAction(inv.id, note), "Invoice voided.")}>Void</button>
            <button type="button" className="adm-btn ghost" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "credit" && (
        <div className="adm-card">
          <div className="adm-card__head"><span className="adm-card__title">Issue a credit note</span><span className="adm-card__sub">leave the amount as the total for a full reversal</span></div>
          <Grid2>
            <Field label={`Amount (${inv.currency})`}><input className="adm-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Reason"><input className="adm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="refund, pricing correction, …" /></Field>
          </Grid2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="adm-btn primary" disabled={busy || !note.trim() || !(Number(amount) > 0)} onClick={() => run(() => creditNoteAction(inv.id, Math.abs(Number(amount) - inv.total) < 0.005 ? null : Number(amount), note), "Credit note issued.")}>Issue credit note</button>
            <button type="button" className="adm-btn ghost" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "eta" && (
        <div className="adm-card">
          <div className="adm-card__head"><span className="adm-card__title">ETA portal result</span><span className="adm-card__sub">paste what the portal returned after you keyed this document</span></div>
          <Grid2>
            <Field label="UUID"><input className="adm-input" value={etaUuid} onChange={(e) => setEtaUuid(e.target.value)} placeholder="ETA document UUID" /></Field>
            <Field label="Long ID (optional)"><input className="adm-input" value={etaLong} onChange={(e) => setEtaLong(e.target.value)} /></Field>
          </Grid2>
          <Field label="Status">
            <select className="adm-select" value={etaStatus} onChange={(e) => setEtaStatus(e.target.value as typeof etaStatus)}>
              <option value="submitted">Submitted</option><option value="valid">Valid</option><option value="invalid">Invalid</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="adm-btn primary" disabled={busy || !etaUuid.trim()} onClick={() => run(() => recordEtaAction({ invoice_id: inv.id, uuid: etaUuid, long_id: etaLong, status: etaStatus }), "ETA result recorded.")}>Save</button>
            <button type="button" className="adm-btn ghost" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
