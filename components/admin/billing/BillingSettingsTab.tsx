"use client";

// Billing settings (owner-only writes): issuer identity as the ETA needs it,
// bank details printed on invoices, numbering / VAT / grace, the USD→EGP
// rate, and the Paymob + ETA credentials (values go to Vault, never shown).
import * as React from "react";
import { toast } from "sonner";
import type { BillingPeriod, BillingSettings, Plan, PlanCode } from "@/lib/billing/types";
import { getPlanCatalogue, refreshFxAction, saveBillingSecret, saveBillingSettings, savePlanCatalogue, setFxRateAction } from "@/app/(admin)/admin/billing/actions";
import { Field, Grid2 } from "./ui";

export function BillingSettingsTab({ settings, secrets, isOwner, fx, onChanged }: { settings: BillingSettings; secrets: Record<string, boolean>; isOwner: boolean; fx: { rate: number; source: string; day: string } | null; onChanged: () => void }) {
  const [s, setS] = React.useState<BillingSettings>(settings);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rate, setRate] = React.useState(fx ? String(fx.rate) : "");
  const [sec, setSec] = React.useState<Record<string, string>>({});
  const set = (p: Partial<BillingSettings>) => setS((prev) => ({ ...prev, ...p }));
  const addr = (k: string, v: string) => set({ issuer_address: { ...s.issuer_address, [k]: v } });
  const bank = (k: string, v: string) => set({ bank_details: { ...s.bank_details, [k]: v } });
  const ro = !isOwner;

  const save = async () => {
    setBusy("save");
    const r = await saveBillingSettings(s);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Billing settings saved."); onChanged();
  };
  const saveSecret = async (key: "paymob_api_key" | "paymob_hmac" | "eta_client_id" | "eta_client_secret") => {
    const v = sec[key]?.trim(); if (!v) return;
    setBusy(key);
    const r = await saveBillingSecret(key, v);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    setSec((p) => ({ ...p, [key]: "" })); toast.success("Stored in Vault."); onChanged();
  };
  const secretRow = (key: "paymob_api_key" | "paymob_hmac" | "eta_client_id" | "eta_client_secret", label: string) => (
    <Field label={<>{label} · {secrets[key] ? <span style={{ color: "var(--adm-green)" }}>stored in Vault</span> : <span style={{ color: "var(--adm-amber-fg)" }}>not set</span>}</>}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="adm-input" type="password" style={{ flex: 1 }} value={sec[key] ?? ""} onChange={(e) => setSec((p) => ({ ...p, [key]: e.target.value }))} placeholder={secrets[key] ? "•••••• (enter to replace)" : "paste the value"} disabled={ro} />
        <button type="button" className="adm-btn" disabled={ro || busy === key || !sec[key]?.trim()} onClick={() => saveSecret(key)}>Store</button>
      </div>
    </Field>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 860 }}>
      {ro && <div className="adm-readonly" style={{ borderRadius: 10 }}>View only — the owner edits billing settings.</div>}

      <div className="adm-card">
        <div className="adm-card__head"><span className="adm-card__title">Issuer · as registered with the ETA</span><span className="adm-card__sub">printed on every invoice and used in the e-invoice document</span></div>
        <Grid2>
          <Field label="Legal name"><input className="adm-input" value={s.issuer_legal_name ?? ""} onChange={(e) => set({ issuer_legal_name: e.target.value })} disabled={ro} /></Field>
          <Field label="Legal name (Arabic)"><input className="adm-input" dir="rtl" value={s.issuer_legal_name_ar ?? ""} onChange={(e) => set({ issuer_legal_name_ar: e.target.value })} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="Tax registration number"><input className="adm-input" value={s.issuer_tax_id ?? ""} onChange={(e) => set({ issuer_tax_id: e.target.value })} disabled={ro} /></Field>
          <Field label="Activity code" hint="ETA taxpayer activity code"><input className="adm-input" value={s.issuer_activity_code ?? ""} onChange={(e) => set({ issuer_activity_code: e.target.value })} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="Branch id"><input className="adm-input" value={s.issuer_branch_id} onChange={(e) => set({ issuer_branch_id: e.target.value })} disabled={ro} /></Field>
          <Field label="Governorate"><input className="adm-input" value={s.issuer_address.governate ?? ""} onChange={(e) => addr("governate", e.target.value)} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="City"><input className="adm-input" value={s.issuer_address.regionCity ?? ""} onChange={(e) => addr("regionCity", e.target.value)} disabled={ro} /></Field>
          <Field label="Street"><input className="adm-input" value={s.issuer_address.street ?? ""} onChange={(e) => addr("street", e.target.value)} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="Building"><input className="adm-input" value={s.issuer_address.buildingNumber ?? ""} onChange={(e) => addr("buildingNumber", e.target.value)} disabled={ro} /></Field>
          <Field label="Postal code"><input className="adm-input" value={s.issuer_address.postalCode ?? ""} onChange={(e) => addr("postalCode", e.target.value)} disabled={ro} /></Field>
        </Grid2>
      </div>

      <div className="adm-card">
        <div className="adm-card__head"><span className="adm-card__title">Bank details · pay by transfer</span><span className="adm-card__sub">shown to members on unpaid invoices</span></div>
        <Grid2>
          <Field label="Bank"><input className="adm-input" value={s.bank_details.bank ?? ""} onChange={(e) => bank("bank", e.target.value)} disabled={ro} /></Field>
          <Field label="Account name"><input className="adm-input" value={s.bank_details.accountName ?? ""} onChange={(e) => bank("accountName", e.target.value)} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="IBAN"><input className="adm-input" value={s.bank_details.iban ?? ""} onChange={(e) => bank("iban", e.target.value)} disabled={ro} /></Field>
          <Field label="SWIFT / BIC"><input className="adm-input" value={s.bank_details.swift ?? ""} onChange={(e) => bank("swift", e.target.value)} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="Account number"><input className="adm-input" value={s.bank_details.accountNumber ?? ""} onChange={(e) => bank("accountNumber", e.target.value)} disabled={ro} /></Field>
          <Field label="Account currency"><input className="adm-input" value={s.bank_details.currency ?? ""} onChange={(e) => bank("currency", e.target.value)} disabled={ro} /></Field>
        </Grid2>
        <Field label="Transfer notes"><input className="adm-input" value={s.bank_details.notes ?? ""} onChange={(e) => bank("notes", e.target.value)} placeholder="quote the invoice number as the reference" disabled={ro} /></Field>
      </div>

      <div className="adm-card">
        <div className="adm-card__head"><span className="adm-card__title">Numbering, VAT, terms</span></div>
        <Grid2>
          <Field label="Invoice prefix" hint="numbers are PREFIX-YEAR-000001, gapless"><input className="adm-input" value={s.invoice_prefix} onChange={(e) => set({ invoice_prefix: e.target.value.toUpperCase() })} disabled={ro} /></Field>
          <Field label="VAT rate %"><input className="adm-input" type="number" value={s.vat_rate} onChange={(e) => set({ vat_rate: Number(e.target.value) })} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="Grace days after due date"><input className="adm-input" type="number" value={s.grace_days} onChange={(e) => set({ grace_days: Number(e.target.value) })} disabled={ro} /></Field>
          <Field label="Reminder days before due"><input className="adm-input" value={s.reminder_days.join(", ")} onChange={(e) => set({ reminder_days: e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => n > 0) })} disabled={ro} /></Field>
        </Grid2>
        <Grid2>
          <Field label="Raise renewal invoices this many days before the period ends" hint="the daily billing cron drafts, issues and emails them"><input className="adm-input" type="number" value={s.renew_before_days} onChange={(e) => set({ renew_before_days: Number(e.target.value) })} disabled={ro} /></Field>
        </Grid2>
      </div>

      <div className="adm-card">
        <div className="adm-card__head"><span className="adm-card__title">USD → EGP rate</span><span className="adm-card__sub">{fx ? `${fx.rate} · ${fx.source} · ${fx.day}` : "no rate stored today"}</span></div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Override today's rate (manual)"><input className="adm-input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={ro} /></Field>
          <button type="button" className="adm-btn" style={{ marginBottom: 12 }} disabled={ro || !(Number(rate) > 0)} onClick={async () => { const r = await setFxRateAction(Number(rate)); if (!r.success) toast.error(r.error); else { toast.success("Rate set."); onChanged(); } }}>Set manual rate</button>
          <button type="button" className="adm-btn" style={{ marginBottom: 12 }} onClick={async () => { const r = await refreshFxAction(); if (!r.success) toast.error(r.error); else { toast.success(`Fetched ${r.data.rate} from ${r.data.source}.`); setRate(String(r.data.rate)); onChanged(); } }}>Fetch from CBE</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>The CBE page is parsed first; if it does not answer, a public feed fills in and the source says so. The rate is frozen on each invoice at issue.</div>
      </div>

      <PlansCard isOwner={isOwner} onChanged={onChanged} />

      <div className="adm-card">
        <div className="adm-card__head"><span className="adm-card__title">Paymob · card payments</span><span className="adm-card__sub">ids here, secrets in Vault · callbacks below go into the Paymob dashboard</span></div>
        <div style={{ fontSize: 12, color: "var(--adm-muted)", marginBottom: 10, lineHeight: 1.6 }}>
          In Paymob → Developers → Payment integrations → your card integration, set <b>Transaction processed callback</b> to <code>https://www.arabshipbroker.com/api/billing/paymob/webhook</code> and <b>Transaction response callback</b> to <code>https://www.arabshipbroker.com/api/billing/paymob/return</code>. USD invoices are charged in EGP at the invoice&apos;s frozen rate.
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}><input type="checkbox" checked={s.paymob_enabled} onChange={(e) => set({ paymob_enabled: e.target.checked })} disabled={ro} /> Show &quot;Pay by card&quot; to members</label>
        <Grid2>
          <Field label="Merchant id"><input className="adm-input" value={s.paymob_merchant_id ?? ""} onChange={(e) => set({ paymob_merchant_id: e.target.value })} disabled={ro} /></Field>
          <Field label="Integration id"><input className="adm-input" value={s.paymob_integration_id ?? ""} onChange={(e) => set({ paymob_integration_id: e.target.value })} disabled={ro} /></Field>
        </Grid2>
        <Field label="Iframe id"><input className="adm-input" value={s.paymob_iframe_id ?? ""} onChange={(e) => set({ paymob_iframe_id: e.target.value })} disabled={ro} /></Field>
        {secretRow("paymob_api_key", "API key")}
        {secretRow("paymob_hmac", "HMAC secret")}
      </div>

      <div className="adm-card">
        <div className="adm-card__head"><span className="adm-card__title">ETA API (Phase 3)</span><span className="adm-card__sub">client credentials from the ETA developer portal</span></div>
        {secretRow("eta_client_id", "Client id")}
        {secretRow("eta_client_secret", "Client secret")}
      </div>

      <div className="asd-savebar">
        <span className="asd-savebar__note">Settings apply to invoices issued from now on; issued invoices keep their snapshot.</span>
        <span className="asd-savebar__spacer" />
        <button type="button" className="adm-btn primary" disabled={ro || busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}

function PlansCard({ isOwner, onChanged }: { isOwner: boolean; onChanged: () => void }) {
  const [plans, setPlans] = React.useState<Plan[] | null>(null);
  const [prices, setPrices] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    void (async () => {
      const r = await getPlanCatalogue();
      if (!r.success) { toast.error(r.error); return; }
      setPlans(r.data.plans);
      const map: Record<string, number> = {};
      for (const p of r.data.prices) if (p.currency === "USD") map[`${p.plan_code}:${p.period}`] = Number(p.unit_amount);
      setPrices(map);
    })();
  }, []);
  const setPlan = (code: PlanCode, patch: Partial<Plan>) => setPlans((prev) => (prev ?? []).map((p) => (p.code === code ? { ...p, ...patch } : p)));
  const save = async () => {
    if (!plans) return;
    setBusy(true);
    const r = await savePlanCatalogue({
      plans: plans.map((p) => ({ code: p.code, egs_code: p.egs_code, gpc_code: p.gpc_code, name: p.name, name_ar: p.name_ar })),
      prices: (["T2", "T3"] as PlanCode[]).flatMap((code) => (["monthly", "annual"] as BillingPeriod[]).map((period) => ({ plan_code: code, period, unit_amount: prices[`${code}:${period}`] ?? 0 }))),
    });
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Catalogue saved — new invoices use it from now."); onChanged();
  };
  if (!plans) return <div className="adm-card"><div className="adm-card__head"><span className="adm-card__title">Plans, prices &amp; EGS codes</span></div><div style={{ color: "var(--adm-muted)", fontSize: 12 }}>Loading…</div></div>;
  return (
    <div className="adm-card">
      <div className="adm-card__head"><span className="adm-card__title">Plans, prices &amp; EGS codes</span><span className="adm-card__sub">EGS code format EG-&lt;tax id&gt;-SUB-T3 · approved on the ETA portal first</span></div>
      <div className="adm-table" style={{ boxShadow: "none" }}>
        <table>
          <thead><tr><th>Plan</th><th>Name</th><th>Arabic name</th><th>EGS item code</th><th>GPC code</th><th className="num">USD / seat / month</th><th className="num">USD / seat / year</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.code} className="no-hover">
                <td className="mono">{p.code}</td>
                <td><input className="adm-input" style={{ width: "100%" }} value={p.name} onChange={(e) => setPlan(p.code, { name: e.target.value })} disabled={!isOwner} /></td>
                <td><input className="adm-input" dir="rtl" style={{ width: "100%" }} value={p.name_ar ?? ""} onChange={(e) => setPlan(p.code, { name_ar: e.target.value })} disabled={!isOwner} /></td>
                <td><input className="adm-input" style={{ width: "100%", fontFamily: "var(--adm-font-mono)" }} placeholder="EG-000000000-SUB-T3" value={p.egs_code ?? ""} onChange={(e) => setPlan(p.code, { egs_code: e.target.value })} disabled={!isOwner} /></td>
                <td><input className="adm-input" style={{ width: 120 }} value={p.gpc_code ?? ""} onChange={(e) => setPlan(p.code, { gpc_code: e.target.value })} disabled={!isOwner} /></td>
                <td className="num">{p.code === "T4" ? <span className="adm-badge tier">custom</span> : <input className="adm-input" style={{ width: 90, textAlign: "right" }} inputMode="decimal" value={prices[`${p.code}:monthly`] ?? ""} onChange={(e) => setPrices((x) => ({ ...x, [`${p.code}:monthly`]: Number(e.target.value) }))} disabled={!isOwner} />}</td>
                <td className="num">{p.code === "T4" ? "—" : <input className="adm-input" style={{ width: 90, textAlign: "right" }} inputMode="decimal" value={prices[`${p.code}:annual`] ?? ""} onChange={(e) => setPrices((x) => ({ ...x, [`${p.code}:annual`]: Number(e.target.value) }))} disabled={!isOwner} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button type="button" className="adm-btn primary" disabled={!isOwner || busy} onClick={save}>{busy ? "Saving…" : "Save catalogue"}</button>
      </div>
    </div>
  );
}
