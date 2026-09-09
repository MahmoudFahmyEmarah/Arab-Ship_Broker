"use client";

// Subscriptions: what each customer has bought, its period, and the owner's
// levers (renewal invoice, manual activation without payment, cancel).
import * as React from "react";
import { toast } from "sonner";
import { cancelSubscriptionAction, manualActivateAction, renewSubscription, resyncTiersAction } from "@/app/(admin)/admin/billing/actions";
import { Drawer, Field, Grid2, SubStatusBadge, fmtDate } from "./ui";
import type { Overview } from "./BillingConsole";

type Sub = Overview["subscriptions"][number];

export function SubscriptionsTab({ data, canEdit, onChanged, onOpenInvoice }: { data: Overview; canEdit: boolean; onChanged: () => void; onOpenInvoice: (id: string) => void }) {
  const [activate, setActivate] = React.useState<Sub | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const isOwner = data.isOwner;

  const renew = async (s: Sub) => {
    setBusy(s.id);
    const r = await renewSubscription(s.id, isOwner);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(isOwner ? `Renewal ${r.data.number} issued.` : "Renewal drafted.");
    onChanged(); onOpenInvoice(r.data.id);
  };
  const cancel = async (s: Sub, atEnd: boolean) => {
    if (!window.confirm(atEnd ? "Stop renewing at the end of the current period?" : "Cancel now? Seats drop to T1 immediately.")) return;
    setBusy(s.id);
    const r = await cancelSubscriptionAction(s.id, atEnd);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Updated."); onChanged();
  };
  const resync = async () => {
    const r = await resyncTiersAction();
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Tiers re-synced · ${r.data.changed} member${r.data.changed === 1 ? "" : "s"} changed.`); onChanged();
  };

  return (
    <>
      <div className="adm-filterbar" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>A member&apos;s tier follows the active subscription that covers their seat. Company admins pick which members hold seats under My Company.</span>
        {isOwner && <button type="button" className="adm-btn" onClick={resync}>Re-sync tiers</button>}
      </div>
      <div className="adm-table">
        <table>
          <thead><tr><th>Customer</th><th>Plan</th><th>Period</th><th className="num">Seats</th><th>Status</th><th>Current period</th><th>Renews</th><th /></tr></thead>
          <tbody>
            {data.subscriptions.length === 0 && <tr className="no-hover"><td colSpan={8} style={{ textAlign: "center", color: "var(--adm-muted)", padding: 24 }}>No subscriptions yet.</td></tr>}
            {data.subscriptions.map((s) => (
              <tr key={s.id} className="no-hover">
                <td style={{ fontWeight: 500 }}>{s.customer_name}</td>
                <td>{s.plan_name} <span className="mono">({s.plan_code})</span></td>
                <td>{s.period}</td>
                <td className="num">{s.seats}</td>
                <td><SubStatusBadge status={s.status} /></td>
                <td>{s.current_period_start ? `${fmtDate(s.current_period_start)} → ${fmtDate(s.current_period_end)}` : "not started"}</td>
                <td>{s.status === "canceled" ? "—" : s.cancel_at_period_end ? "stops at period end" : "yes"}</td>
                <td>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {canEdit && s.status !== "canceled" && <button type="button" className="adm-btn small" disabled={busy === s.id} onClick={() => renew(s)}>{isOwner ? "Issue renewal" : "Draft renewal"}</button>}
                    {isOwner && s.status !== "canceled" && <button type="button" className="adm-btn small" onClick={() => setActivate(s)}>Activate manually</button>}
                    {isOwner && s.status !== "canceled" && !s.cancel_at_period_end && <button type="button" className="adm-btn small" disabled={busy === s.id} onClick={() => cancel(s, true)}>Stop renewing</button>}
                    {isOwner && s.status !== "canceled" && <button type="button" className="adm-btn small reject" disabled={busy === s.id} onClick={() => cancel(s, false)}>Cancel now</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {activate && <ActivateDrawer sub={activate} onClose={() => setActivate(null)} onDone={() => { setActivate(null); onChanged(); }} />}
    </>
  );
}

function ActivateDrawer({ sub, onClose, onDone }: { sub: Sub; onClose: () => void; onDone: () => void }) {
  const [months, setMonths] = React.useState(sub.period === "annual" ? 12 : 1);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const go = async () => {
    setBusy(true);
    const r = await manualActivateAction(sub.id, months, note);
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Activated — tiers updated."); onDone();
  };
  return (
    <Drawer title="Activate without a payment" subtitle={`${sub.customer_name} · ${sub.plan_name} · ${sub.seats} seat${sub.seats === 1 ? "" : "s"}`} onClose={onClose}>
      <div className="adm-page__warn" style={{ marginBottom: 14 }}><span aria-hidden>⚠</span><span>Owner-only. This extends the period with no invoice or payment record; the reason is written to the audit log.</span></div>
      <Grid2>
        <Field label="Months"><input className="adm-input" type="number" min={1} max={36} value={months} onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))} /></Field>
      </Grid2>
      <Field label="Reason (required)"><input className="adm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="partner agreement, trial extension, goodwill…" /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="adm-btn primary" disabled={busy || !note.trim()} onClick={go}>{busy ? "Working…" : "Activate"}</button>
        <button type="button" className="adm-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Drawer>
  );
}
