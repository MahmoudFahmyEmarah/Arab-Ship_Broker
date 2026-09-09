"use client";

// Subscription & Billing (member). Real data: the account's tier, its
// personal and company billing profiles, subscriptions and invoices, and a
// self-serve subscribe flow (company seats for company admins, or a personal
// seat). Payment: bank transfer with the invoice number as reference; the
// member reports the transfer, the admin confirms it and the seats activate.
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useViewerTier } from "@/lib/portal/tier";
import { fmtMoney } from "@/lib/billing/money";
import { PLAN_FEATURES, type BillingCurrency, type BillingPeriod, type EtaAddress, type Invoice, type PlanCode } from "@/lib/billing/types";
import { useSearchParams } from "next/navigation";
import { getMyBilling, reportBankTransfer, startCardPayment, subscribe, type MyBilling } from "@/app/(dashboard)/dashboard/account/billing-actions";

const TIER_NAME: Record<string, string> = { T1: "Free", T2: "Standard", T3: "Subscriber", T4: "Partner" };
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function BillingPanel({ embedded = false }: { embedded?: boolean }) {
  const tier = useViewerTier();
  const payResult = useSearchParams().get("pay");
  const [data, setData] = React.useState<MyBilling | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [buying, setBuying] = React.useState<{ plan: PlanCode } | null>(null);
  const [paying, setPaying] = React.useState<Invoice | null>(null);

  const load = React.useCallback(async () => {
    const r = await getMyBilling();
    if (!r.success) { setErr(r.error); return; }
    setData(r.data); setErr(null);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const priceOf = (plan: PlanCode, period: BillingPeriod, currency: BillingCurrency) =>
    data?.prices.find((p) => p.plan_code === plan && p.period === period && p.currency === currency)?.unit_amount ?? null;

  const body = (
    <>
      {err && <div className="settings-note" style={{ color: "var(--asb-red)" }}>{err}</div>}
      {payResult === "success" && <div style={{ background: "var(--asb-green-bg)", color: "var(--asb-green)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>Payment received — thank you. Your seats are being activated.</div>}
      {payResult === "pending" && <div style={{ background: "var(--asb-blue-light)", color: "var(--asb-blue)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>Your card payment is being processed. The invoice updates as soon as the bank confirms.</div>}
      {(payResult === "failed" || payResult === "error" || payResult === "unverified") && <div style={{ background: "var(--asb-red-bg)", color: "var(--asb-red)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>The card payment did not go through. Nothing was charged; you can try again or pay by bank transfer.</div>}
      <div className="econ-grid" style={{ marginBottom: 12 }}>
        <div className="econ-card">
          <div className="econ-card__head">Current plan</div>
          <div className="econ-card__body">
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--asb-navy)" }}>{TIER_NAME[tier] ?? tier} <span style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>({tier})</span></div>
            <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>{tier === "T1" ? "no card required" : "seat covered by an active subscription"}</div>
          </div>
        </div>
        <div className="econ-card">
          <div className="econ-card__head">Billing profile</div>
          <div className="econ-card__body" style={{ fontSize: 12.5 }}>
            {data?.company ? <div><b>{data.company.legal_name}</b> · company · {data.company.currency}</div> : data?.companyName ? <div>{data.companyName} · no billing profile yet</div> : null}
            {data?.personal ? <div><b>{data.personal.legal_name}</b> · personal · {data.personal.currency}</div> : null}
            {!data?.company && !data?.personal && <div style={{ color: "var(--asb-gray-500)" }}>Created on your first purchase.</div>}
          </div>
        </div>
        <div className="econ-card">
          <div className="econ-card__head">Open invoices</div>
          <div className="econ-card__body" style={{ fontSize: 12.5 }}>
            {(() => { const open = (data?.invoices ?? []).filter((i) => i.status === "issued" || i.status === "partially_paid"); return open.length ? open.map((i) => <div key={i.id}><b>{i.number}</b> · {fmtMoney(i.total - i.amount_paid, i.currency)} due {fmtDate(i.due_at)}</div>) : <span style={{ color: "var(--asb-gray-500)" }}>Nothing due.</span>; })()}
          </div>
        </div>
      </div>

      <div className="settings-section-title">Plans</div>
      <div className="econ-grid" style={{ marginBottom: 12 }}>
        {(["T1", "T2", "T3", "T4"] as const).map((code) => {
          const usd = code === "T1" ? 0 : code === "T4" ? null : priceOf(code, "monthly", "USD");
          const isCurrent = tier === code;
          return (
            <div key={code} className="econ-card" style={{ border: isCurrent ? "1.5px solid var(--asb-blue)" : undefined }}>
              <div className="econ-card__head" style={{ display: "flex", justifyContent: "space-between" }}><span>{TIER_NAME[code]}</span>{isCurrent && <span className="asb-badge neutral" style={{ fontSize: 8.5 }}>CURRENT</span>}</div>
              <div className="econ-card__body">
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--asb-navy)" }}>{usd == null ? "Custom" : usd === 0 ? "$0" : `$${usd}`}</div>
                <div style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{usd == null ? "contact sales" : usd === 0 ? "no card required" : "per seat / month · annual = 10 months"}</div>
                <ul style={{ margin: "8px 0", paddingLeft: 16, fontSize: 12, color: "var(--asb-gray-700)" }}>{PLAN_FEATURES[code].map((f) => <li key={f}>{f}</li>)}</ul>
                {code === "T1" ? null : code === "T4" ? (
                  <a className="asb-btn" style={{ width: "100%", justifyContent: "center" }} href="mailto:sales@arabshipbroker.com?subject=Partner%20plan">Contact sales →</a>
                ) : (
                  <button type="button" className="asb-btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={!data} onClick={() => setBuying({ plan: code })}>
                    {tier === "T1" ? `Subscribe to ${TIER_NAME[code]} →` : `Switch to ${TIER_NAME[code]} →`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-section-title">Invoices</div>
      {(data?.invoices.length ?? 0) === 0 ? (
        <div className="settings-note">No invoices yet.</div>
      ) : (
        <table className="asb-table asb-table--dense" style={{ width: "100%" }}>
          <thead><tr><th>Number</th><th>Issued</th><th>Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data!.invoices.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.number}</td>
                <td>{fmtDate(i.issued_at)}</td>
                <td className="num">{fmtMoney(i.total, i.currency)}{i.egp_total != null && i.currency !== "EGP" ? <span style={{ color: "var(--asb-gray-500)", fontSize: 11 }}> · {fmtMoney(i.egp_total, "EGP")}</span> : null}</td>
                <td><span className={`asb-badge ${i.status === "paid" ? "green" : i.status === "void" ? "neutral" : "amber"}`}>{i.status.replace("_", " ")}</span></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Link href={`/dashboard/billing/invoices/${i.id}`} target="_blank" className="asb-btn" style={{ padding: "4px 9px", fontSize: 12 }}>View</Link>{" "}
                  {(i.status === "issued" || i.status === "partially_paid") && <button type="button" className="asb-btn primary" style={{ padding: "4px 9px", fontSize: 12 }} onClick={() => setPaying(i)}>Pay</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {buying && data && <SubscribeDialog data={data} plan={buying.plan} onClose={() => setBuying(null)} onDone={(inv) => { setBuying(null); void load(); setPaying(inv); }} />}
      {paying && data && <PayDialog invoice={paying} bank={data.bank} paymob={data.paymobEnabled} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void load(); }} />}
    </>
  );

  if (embedded) return body;
  return <div style={{ padding: 20 }}>{body}</div>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div ref={ref} onMouseDown={(e) => { if (e.target === ref.current) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(13,37,69,.35)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={{ width: "min(640px, 100%)", maxHeight: "92vh", overflow: "auto", background: "var(--asb-white)", borderRadius: 14, boxShadow: "var(--sh-dropdown)" }}>
        <div style={{ background: "var(--asb-navy)", color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontWeight: 600, flex: 1 }}>{title}</div><button type="button" onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,.12)", border: 0, color: "#fff", width: 26, height: 26, borderRadius: 6, cursor: "pointer" }}>×</button></div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
const F = ({ label, children }: { label: string; children: React.ReactNode }) => <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, marginBottom: 10 }}><span style={{ color: "var(--asb-gray-500)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", fontSize: 10.5 }}>{label}</span>{children}</label>;
const INPUT: React.CSSProperties = { padding: "7px 10px", border: "1px solid var(--asb-line)", borderRadius: 8, font: "inherit", fontSize: 13, background: "var(--asb-white)", color: "var(--asb-ink)" };

function SubscribeDialog({ data, plan, onClose, onDone }: { data: MyBilling; plan: PlanCode; onClose: () => void; onDone: (inv: Invoice) => void }) {
  const [scope, setScope] = React.useState<"company" | "personal">(data.canBuyForCompany ? "company" : "personal");
  const [period, setPeriod] = React.useState<BillingPeriod>("monthly");
  const [seats, setSeats] = React.useState(1);
  const existing = scope === "company" ? data.company : data.personal;
  const [p, setP] = React.useState({
    legal_name: existing?.legal_name ?? (scope === "company" ? data.companyName ?? "" : ""), legal_name_ar: existing?.legal_name_ar ?? "", tax_id: existing?.tax_id ?? "",
    country: existing?.country ?? "EG", currency: (existing?.currency ?? "USD") as BillingCurrency, billing_email: existing?.billing_email ?? "", phone: existing?.phone ?? "",
    address: (existing?.address ?? {}) as EtaAddress,
  });
  React.useEffect(() => {
    const e = scope === "company" ? data.company : data.personal;
    setP({ legal_name: e?.legal_name ?? (scope === "company" ? data.companyName ?? "" : ""), legal_name_ar: e?.legal_name_ar ?? "", tax_id: e?.tax_id ?? "", country: e?.country ?? "EG", currency: (e?.currency ?? "USD") as BillingCurrency, billing_email: e?.billing_email ?? "", phone: e?.phone ?? "", address: (e?.address ?? {}) as EtaAddress });
    if (scope === "personal") setSeats(1);
  }, [scope, data]);
  const [busy, setBusy] = React.useState(false);
  const usd = data.prices.find((x) => x.plan_code === plan && x.period === period && x.currency === "USD")?.unit_amount ?? 0;
  const total = usd * seats;
  const set = (k: keyof typeof p, v: string) => setP((prev) => ({ ...prev, [k]: v }));
  const setA = (k: keyof EtaAddress, v: string) => setP((prev) => ({ ...prev, address: { ...prev.address, [k]: v } }));

  const go = async () => {
    setBusy(true);
    const r = await subscribe({ scope, plan_code: plan, period, seats, profile: { ...p, currency: p.currency } });
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Invoice ${r.data.invoice.number} issued. Pay by bank transfer to activate.`);
    onDone(r.data.invoice);
  };

  return (
    <Dialog title={`Subscribe · ${TIER_NAME[plan]}`} onClose={onClose}>
      {data.canBuyForCompany && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["company", "personal"] as const).map((s) => <button key={s} type="button" className={`asb-btn${scope === s ? " primary" : ""}`} onClick={() => setScope(s)}>{s === "company" ? `For ${data.companyName ?? "my company"} (seats)` : "For me only"}</button>)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <F label="Billing period"><select style={INPUT} value={period} onChange={(e) => setPeriod(e.target.value as BillingPeriod)}><option value="monthly">Monthly</option><option value="annual">Annual (pay 10 months)</option></select></F>
        <F label="Seats"><input style={INPUT} type="number" min={1} max={100} value={seats} disabled={scope === "personal"} onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))} /></F>
      </div>
      <div style={{ background: "var(--asb-blue-light)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
        <b>{fmtMoney(total, "USD")}</b> per {period === "monthly" ? "month" : "year"} before VAT{p.currency === "EGP" ? " · invoiced in EGP at the CBE rate of the day" : ""}. VAT is applied according to your country and tax status.
      </div>
      <div style={{ fontSize: 11, color: "var(--asb-gray-500)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", margin: "6px 0 8px" }}>Invoice details</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <F label="Legal name"><input style={INPUT} value={p.legal_name} onChange={(e) => set("legal_name", e.target.value)} /></F>
        <F label="Legal name (Arabic, optional)"><input style={INPUT} dir="rtl" value={p.legal_name_ar} onChange={(e) => set("legal_name_ar", e.target.value)} /></F>
        <F label="Country (ISO-2)"><input style={INPUT} maxLength={2} value={p.country} onChange={(e) => set("country", e.target.value.toUpperCase())} /></F>
        <F label={p.country === "EG" ? "Tax registration / national id" : "Tax id / TRN (optional)"}><input style={INPUT} value={p.tax_id} onChange={(e) => set("tax_id", e.target.value)} /></F>
        <F label="Invoice currency"><select style={INPUT} value={p.currency} onChange={(e) => set("currency", e.target.value)}><option value="USD">USD</option><option value="EGP">EGP</option></select></F>
        <F label="Billing email"><input style={INPUT} type="email" value={p.billing_email} onChange={(e) => set("billing_email", e.target.value)} /></F>
        <F label="Governorate / emirate"><input style={INPUT} value={p.address.governate ?? ""} onChange={(e) => setA("governate", e.target.value)} /></F>
        <F label="City"><input style={INPUT} value={p.address.regionCity ?? ""} onChange={(e) => setA("regionCity", e.target.value)} /></F>
        <F label="Street"><input style={INPUT} value={p.address.street ?? ""} onChange={(e) => setA("street", e.target.value)} /></F>
        <F label="Building"><input style={INPUT} value={p.address.buildingNumber ?? ""} onChange={(e) => setA("buildingNumber", e.target.value)} /></F>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--asb-gray-500)", marginBottom: 12 }}>An invoice is issued now and paid by bank transfer. Your seat{seats > 1 ? "s" : ""} activate when the payment is confirmed{scope === "company" ? "; assign seats to colleagues under My Company" : ""}.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="asb-btn primary" disabled={busy || !p.legal_name.trim() || !p.billing_email.trim()} onClick={go}>{busy ? "Issuing…" : "Issue invoice"}</button>
        <button type="button" className="asb-btn" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function PayDialog({ invoice, bank, paymob, onClose, onDone }: { invoice: Invoice; bank: Record<string, string> | null; paymob: boolean; onClose: () => void; onDone: () => void }) {
  const open = invoice.total - invoice.amount_paid;
  const [ref, setRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [carding, setCarding] = React.useState(false);
  const payByCard = async () => {
    setCarding(true);
    const r = await startCardPayment(invoice.id);
    if (!r.success) { setCarding(false); toast.error(r.error); return; }
    window.location.assign(r.data.url);
  };
  const report = async () => {
    setBusy(true);
    const r = await reportBankTransfer(invoice.id, ref, open);
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Thank you — we will confirm the transfer and activate your seats."); onDone();
  };
  return (
    <Dialog title={`Pay ${invoice.number}`} onClose={onClose}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)", marginBottom: 10 }}>{fmtMoney(open, invoice.currency)} due {fmtDate(invoice.due_at)}{invoice.egp_total != null && invoice.currency !== "EGP" ? <span style={{ fontSize: 12, color: "var(--asb-gray-500)", fontWeight: 400 }}> · {fmtMoney(invoice.egp_total, "EGP")} at the invoice rate</span> : null}</div>
      {bank && (bank.iban || bank.accountNumber) ? (
        <div style={{ border: "1px solid var(--asb-line)", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--asb-gray-500)", marginBottom: 6 }}>Bank transfer</div>
          {bank.bank && <div>Bank: <b>{bank.bank}</b></div>}
          {bank.accountName && <div>Account name: <b>{bank.accountName}</b></div>}
          {bank.iban && <div>IBAN: <b className="mono">{bank.iban}</b></div>}
          {bank.accountNumber && <div>Account no.: <b className="mono">{bank.accountNumber}</b></div>}
          {bank.swift && <div>SWIFT: <b>{bank.swift}</b></div>}
          <div>Reference: <b>{invoice.number}</b></div>
          {bank.notes && <div style={{ color: "var(--asb-gray-500)", marginTop: 4 }}>{bank.notes}</div>}
        </div>
      ) : <div className="settings-note">Bank details will appear here once the platform publishes them; meanwhile contact sales@arabshipbroker.com.</div>}
      {paymob && (
        <div style={{ border: "1px solid var(--asb-line)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200, fontSize: 12.5 }}>
            <b>Pay by card</b> <span style={{ color: "var(--asb-gray-500)" }}>· Visa / Mastercard / Meeza / wallets via Paymob{invoice.currency !== "EGP" && invoice.egp_total != null ? ` · charged ${fmtMoney(invoice.egp_total * (open / invoice.total), "EGP")} at the invoice rate` : ""}</span>
          </div>
          <button type="button" className="asb-btn primary" disabled={carding} onClick={payByCard}>{carding ? "Opening…" : "Pay by card →"}</button>
        </div>
      )}
      <F label="Once transferred, enter your bank reference"><input style={INPUT} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="transfer reference or date + amount" /></F>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="asb-btn primary" disabled={busy || !ref.trim()} onClick={report}>{busy ? "Sending…" : "I have transferred"}</button>
        <Link href={`/dashboard/billing/invoices/${invoice.id}`} target="_blank" className="asb-btn">Open invoice</Link>
      </div>
    </Dialog>
  );
}
