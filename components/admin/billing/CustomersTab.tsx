"use client";

// Customers: one tax profile per company or member. Create from a company or
// member search, edit the profile, and start a subscription or a manual
// invoice from the row.
import * as React from "react";
import { toast } from "sonner";
import type { BillingCurrency, BillingPeriod, PlanCode, VatTreatment } from "@/lib/billing/types";
import { createManualInvoice, saveCustomer, searchBillingTargets, startSubscriptionForCustomer } from "@/app/(admin)/admin/billing/actions";
import type { CustomerInput } from "@/lib/billing/server";
import { Drawer, Field, Grid2 } from "./ui";
import type { Overview } from "./BillingConsole";

type Customer = Overview["customers"][number];

const VAT_LABEL: Record<VatTreatment, string> = { standard: "Standard 14%", zero_rated_export: "Zero-rated export", out_of_scope: "Out of scope", pending_review: "Pending accountant review" };

export function CustomersTab({ data, canEdit, onChanged, onOpenInvoice }: { data: Overview; canEdit: boolean; onChanged: () => void; onOpenInvoice: (id: string) => void }) {
  const [editing, setEditing] = React.useState<Customer | "new" | null>(null);
  const [subFor, setSubFor] = React.useState<Customer | null>(null);
  const [invFor, setInvFor] = React.useState<Customer | null>(null);
  return (
    <>
      <div className="adm-filterbar" style={{ justifyContent: "flex-end" }}>
        {canEdit && <button type="button" className="adm-btn primary" onClick={() => setEditing("new")}>New customer</button>}
      </div>
      <div className="adm-table">
        <table>
          <thead><tr><th>Legal name</th><th>Linked to</th><th>Country</th><th>Tax id</th><th>Currency</th><th>VAT treatment</th><th>Email</th><th /></tr></thead>
          <tbody>
            {data.customers.length === 0 && <tr className="no-hover"><td colSpan={8} style={{ textAlign: "center", color: "var(--adm-muted)", padding: 24 }}>No billing customers yet.</td></tr>}
            {data.customers.map((c) => (
              <tr key={c.id} className="no-hover">
                <td style={{ fontWeight: 500 }}>{c.legal_name}{c.legal_name_ar ? <span style={{ color: "var(--adm-muted)" }}> · {c.legal_name_ar}</span> : null}</td>
                <td>{c.org_id ? `Company · ${c.org_name ?? ""}` : `Member · ${c.user_name ?? ""}`}</td>
                <td>{c.country} · {c.receiver_type}</td>
                <td className="mono">{c.tax_id ?? "—"}</td>
                <td>{c.currency}</td>
                <td><span className={`adm-badge ${c.vat_treatment === "pending_review" ? "pending" : "tier"}`}>{VAT_LABEL[c.vat_treatment]}</span></td>
                <td>{c.billing_email ?? "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    {canEdit && <button type="button" className="adm-btn small" onClick={() => setEditing(c)}>Edit</button>}
                    {canEdit && <button type="button" className="adm-btn small" onClick={() => setSubFor(c)}>Subscription</button>}
                    {canEdit && <button type="button" className="adm-btn small" onClick={() => setInvFor(c)}>Invoice</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CustomerDrawer customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      {subFor && <StartSubscriptionDrawer customer={subFor} plans={data.plans} isOwner={data.isOwner} onClose={() => setSubFor(null)} onDone={(invId) => { setSubFor(null); onChanged(); onOpenInvoice(invId); }} />}
      {invFor && <ManualInvoiceDrawer customer={invFor} isOwner={data.isOwner} onClose={() => setInvFor(null)} onDone={(invId) => { setInvFor(null); onChanged(); onOpenInvoice(invId); }} />}
    </>
  );
}

function CustomerDrawer({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<{ orgs: { id: string; name: string; country: string | null }[]; users: { id: string; name: string; email: string; company: string | null }[] } | null>(null);
  const [target, setTarget] = React.useState<{ org_id?: string; user_id?: string; label: string } | null>(customer ? { org_id: customer.org_id ?? undefined, user_id: customer.user_id ?? undefined, label: customer.org_id ? `Company · ${customer.org_name}` : `Member · ${customer.user_name}` } : null);
  const [f, setF] = React.useState<CustomerInput>({
    legal_name: customer?.legal_name ?? "", legal_name_ar: customer?.legal_name_ar ?? "", receiver_type: customer?.receiver_type ?? "B",
    tax_id: customer?.tax_id ?? "", country: customer?.country ?? "EG", address: customer?.address ?? {}, currency: customer?.currency ?? "USD",
    vat_treatment: customer?.vat_treatment ?? "pending_review", billing_email: customer?.billing_email ?? "", phone: customer?.phone ?? "", notes: customer?.notes ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (p: Partial<CustomerInput>) => setF((prev) => ({ ...prev, ...p }));
  const setAddr = (k: string, v: string) => setF((prev) => ({ ...prev, address: { ...(prev.address ?? {}), [k]: v } }));

  React.useEffect(() => {
    if (customer || q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(async () => { const r = await searchBillingTargets(q); if (r.success) setHits(r.data); }, 250);
    return () => clearTimeout(t);
  }, [q, customer]);

  const save = async () => {
    if (!customer && !target) { toast.error("Pick the company or member this profile belongs to"); return; }
    setBusy(true);
    const r = await saveCustomer({ ...f, org_id: target?.org_id ?? null, user_id: target?.user_id ?? null }, customer?.id);
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Customer saved.");
    onSaved();
  };

  return (
    <Drawer title={customer ? "Edit customer" : "New customer"} subtitle="The tax profile printed on every invoice and sent to the ETA" onClose={onClose}>
      {!customer && (
        <Field label="Belongs to" hint={target ? `Selected: ${target.label}` : "search a company or a member"}>
          <input className="adm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="company name, member name or email" />
          {hits && (hits.orgs.length + hits.users.length > 0) && (
            <div style={{ border: "1px solid var(--adm-bd)", borderRadius: 8, marginTop: 4, maxHeight: 200, overflow: "auto", background: "var(--asb-white)" }}>
              {hits.orgs.map((o) => <button key={o.id} type="button" className="adm-btn ghost" style={{ display: "flex", width: "100%", justifyContent: "flex-start" }} onClick={() => { setTarget({ org_id: o.id, label: `Company · ${o.name}` }); set({ legal_name: f.legal_name || o.name, country: o.country?.slice(0, 2).toUpperCase() === "UA" ? "AE" : f.country }); setQ(""); setHits(null); }}>Company · {o.name}{o.country ? ` · ${o.country}` : ""}</button>)}
              {hits.users.map((u) => <button key={u.id} type="button" className="adm-btn ghost" style={{ display: "flex", width: "100%", justifyContent: "flex-start" }} onClick={() => { setTarget({ user_id: u.id, label: `Member · ${u.name}` }); set({ legal_name: f.legal_name || u.name, receiver_type: "P", billing_email: f.billing_email || u.email }); setQ(""); setHits(null); }}>Member · {u.name} · {u.email}</button>)}
            </div>
          )}
        </Field>
      )}
      <Grid2>
        <Field label="Legal name"><input className="adm-input" value={f.legal_name} onChange={(e) => set({ legal_name: e.target.value })} /></Field>
        <Field label="Legal name (Arabic, optional)"><input className="adm-input" dir="rtl" value={f.legal_name_ar ?? ""} onChange={(e) => set({ legal_name_ar: e.target.value })} /></Field>
      </Grid2>
      <Grid2>
        <Field label="Receiver type" hint="B business · P person · F foreign (no Egyptian tax id)">
          <select className="adm-select" value={f.receiver_type} onChange={(e) => set({ receiver_type: e.target.value as "B" | "P" | "F" })}><option value="B">B · Business</option><option value="P">P · Person</option><option value="F">F · Foreign</option></select>
        </Field>
        <Field label="Tax id / TRN / national id"><input className="adm-input" value={f.tax_id ?? ""} onChange={(e) => set({ tax_id: e.target.value })} /></Field>
      </Grid2>
      <Grid2>
        <Field label="Country (ISO-2)"><input className="adm-input" value={f.country ?? ""} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} /></Field>
        <Field label="Invoice currency"><select className="adm-select" value={f.currency} onChange={(e) => set({ currency: e.target.value as BillingCurrency })}><option value="USD">USD</option><option value="EGP">EGP</option></select></Field>
      </Grid2>
      <Field label="VAT treatment" hint="Pending review flags the invoice for the accountant and charges 14% meanwhile">
        <select className="adm-select" value={f.vat_treatment} onChange={(e) => set({ vat_treatment: e.target.value as VatTreatment })}>
          {(Object.keys(VAT_LABEL) as VatTreatment[]).map((k) => <option key={k} value={k}>{VAT_LABEL[k]}</option>)}
        </select>
      </Field>
      <Grid2>
        <Field label="Governorate / emirate"><input className="adm-input" value={f.address?.governate ?? ""} onChange={(e) => setAddr("governate", e.target.value)} /></Field>
        <Field label="City"><input className="adm-input" value={f.address?.regionCity ?? ""} onChange={(e) => setAddr("regionCity", e.target.value)} /></Field>
      </Grid2>
      <Grid2>
        <Field label="Street"><input className="adm-input" value={f.address?.street ?? ""} onChange={(e) => setAddr("street", e.target.value)} /></Field>
        <Field label="Building"><input className="adm-input" value={f.address?.buildingNumber ?? ""} onChange={(e) => setAddr("buildingNumber", e.target.value)} /></Field>
      </Grid2>
      <Grid2>
        <Field label="Billing email"><input className="adm-input" type="email" value={f.billing_email ?? ""} onChange={(e) => set({ billing_email: e.target.value })} /></Field>
        <Field label="Phone"><input className="adm-input" value={f.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></Field>
      </Grid2>
      <Field label="Notes"><textarea className="adm-textarea" value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="adm-btn primary" disabled={busy || !f.legal_name.trim()} onClick={save}>{busy ? "Saving…" : "Save customer"}</button>
        <button type="button" className="adm-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Drawer>
  );
}

function StartSubscriptionDrawer({ customer, plans, isOwner, onClose, onDone }: { customer: Customer; plans: Overview["plans"]; isOwner: boolean; onClose: () => void; onDone: (invoiceId: string) => void }) {
  const [plan, setPlan] = React.useState<PlanCode>("T3");
  const [period, setPeriod] = React.useState<BillingPeriod>("monthly");
  const [seats, setSeats] = React.useState(1);
  const [issue, setIssue] = React.useState(isOwner);
  const [busy, setBusy] = React.useState(false);
  const go = async () => {
    setBusy(true);
    const r = await startSubscriptionForCustomer({ customer_id: customer.id, plan_code: plan, period, seats, issue });
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(issue ? `Subscription started · ${r.data.invoice.number} issued.` : "Subscription drafted — issue the invoice when ready.");
    onDone(r.data.invoice.id);
  };
  return (
    <Drawer title="Start a subscription" subtitle={`${customer.legal_name} · billed in ${customer.currency}`} onClose={onClose}>
      <Field label="Plan"><select className="adm-select" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}</select></Field>
      <Grid2>
        <Field label="Period"><select className="adm-select" value={period} onChange={(e) => setPeriod(e.target.value as BillingPeriod)}><option value="monthly">Monthly</option><option value="annual">Annual (10 months&apos; price)</option></select></Field>
        <Field label="Seats"><input className="adm-input" type="number" min={1} max={500} value={seats} onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))} /></Field>
      </Grid2>
      {isOwner && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 14 }}><input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} /> Issue the first invoice now</label>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="adm-btn primary" disabled={busy} onClick={go}>{busy ? "Working…" : "Create"}</button>
        <button type="button" className="adm-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Drawer>
  );
}

function ManualInvoiceDrawer({ customer, isOwner, onClose, onDone }: { customer: Customer; isOwner: boolean; onClose: () => void; onDone: (invoiceId: string) => void }) {
  const [lines, setLines] = React.useState([{ description: "", item_code: "", quantity: 1, unit_price: 0 }]);
  const [notes, setNotes] = React.useState("");
  const [issue, setIssue] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const upd = (i: number, p: Partial<typeof lines[number]>) => setLines((prev) => prev.map((l, x) => (x === i ? { ...l, ...p } : l)));
  const go = async () => {
    setBusy(true);
    const r = await createManualInvoice({ customer_id: customer.id, notes, issue, lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, item_code: l.item_code || undefined, quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0 })) });
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(issue ? `Invoice ${r.data.number} issued.` : "Draft created.");
    onDone(r.data.id);
  };
  return (
    <Drawer title="Manual invoice" subtitle={`${customer.legal_name} · ${customer.currency} · VAT ${customer.vat_treatment.replace(/_/g, " ")}`} onClose={onClose} wide>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 70px 110px 32px", gap: 8, marginBottom: 8, alignItems: "end" }}>
          <Field label={i === 0 ? "Description" : ""}><input className="adm-input" value={l.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Partner plan · Q4 2026" /></Field>
          <Field label={i === 0 ? "EGS code" : ""}><input className="adm-input" value={l.item_code} onChange={(e) => upd(i, { item_code: e.target.value })} /></Field>
          <Field label={i === 0 ? "Qty" : ""}><input className="adm-input" type="number" min={1} value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} /></Field>
          <Field label={i === 0 ? `Unit (${customer.currency})` : ""}><input className="adm-input" inputMode="decimal" value={l.unit_price} onChange={(e) => upd(i, { unit_price: Number(e.target.value) })} /></Field>
          <button type="button" className="adm-btn ghost" style={{ marginBottom: 12 }} onClick={() => setLines((p) => p.filter((_, x) => x !== i))} aria-label="Remove line">×</button>
        </div>
      ))}
      <button type="button" className="adm-btn small" onClick={() => setLines((p) => [...p, { description: "", item_code: "", quantity: 1, unit_price: 0 }])}>+ line</button>
      <Field label="Notes on the invoice"><textarea className="adm-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {isOwner && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 14 }}><input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} /> Issue now</label>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="adm-btn primary" disabled={busy || !lines.some((l) => l.description.trim() && l.unit_price > 0)} onClick={go}>{busy ? "Working…" : issue ? "Issue invoice" : "Save draft"}</button>
        <button type="button" className="adm-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Drawer>
  );
}
