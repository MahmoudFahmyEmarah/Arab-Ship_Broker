"use client";

// Subscription & billing (customer-facing). The current plan/tier is real
// (from the viewer's account); online payment, invoices and ETA e-invoicing
// are NOT live yet — those areas are clearly marked as a preview so nothing
// here is mistaken for a working billing system.
import * as React from "react";
import { toast } from "sonner";
import { useViewerTier, Tier } from "@/lib/portal/tier";

const PLANS: { id: Tier; name: string; price: string; sub: string; features: string[] }[] = [
  { id: "T1", name: "Free", price: "$0", sub: "no card required", features: ["Post unlimited listings", "Zone-level match counts", "7-day archive"] },
  { id: "T2", name: "Standard", price: "$89", sub: "per user / month", features: ["Everything in Free", "30-day archive", "Smart Parser", "Daily digest"] },
  { id: "T3", name: "Subscriber", price: "$249", sub: "per user / month", features: ["Vessel names + IMO", "Full match intelligence", "Voyage calculators", "6-month archive"] },
  { id: "T4", name: "Partner", price: "Custom", sub: "contact sales", features: ["Everything in Subscriber", "Partner dashboard", "API access", "Account manager"] },
];

// Illustrative only — real invoices arrive once online billing is live.
const SAMPLE_INVOICES = [
  ["INV-2026-0418", "01 Jun 2026", "$249.00", "Paid"],
  ["INV-2026-0392", "01 May 2026", "$249.00", "Paid"],
];

const Preview = () => (
  <span className="asb-badge neutral" style={{ fontSize: 8.5, letterSpacing: ".04em" }}>PREVIEW</span>
);

export function BillingPanel({ embedded = false }: { embedded?: boolean }) {
  const tier = useViewerTier();
  const current = PLANS.find((p) => p.id === tier);
  const requestPlan = (name: string) =>
    toast("Subscriptions are arranged manually", {
      description: `Email sales@arabshipbroker.com to move to ${name} — online checkout is coming soon.`,
    });

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--asb-blue-light)", border: "0.5px solid #9EC4E6", color: "var(--asb-blue)", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, marginBottom: 12 }}>
        <Preview />
        <span>Online payment, invoices &amp; ETA e-invoicing aren&apos;t live yet — subscriptions are arranged manually. Your current plan below is real; payment &amp; invoice details are illustrative.</span>
      </div>

      <div className="econ-grid" style={{ marginBottom: 12 }}>
        <div className="econ-card">
          <div className="econ-card__head">Current plan</div>
          <div className="econ-card__body">
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--asb-navy)" }}>{current?.name} <span style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>({tier})</span></div>
            <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>{current?.price} {current?.sub}</div>
          </div>
        </div>
        <div className="econ-card">
          <div className="econ-card__head">Payment method <Preview /></div>
          <div className="econ-card__body">
            <div style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>No card on file. Subscriptions are invoiced manually for now.</div>
          </div>
        </div>
        <div className="econ-card">
          <div className="econ-card__head">E-invoicing (ETA) <Preview /></div>
          <div className="econ-card__body">
            <div style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>Automated Egyptian Tax Authority submission is planned, not yet active.</div>
          </div>
        </div>
      </div>

      <div className="eyebrow" style={{ margin: "4px 0 8px" }}>Available plans</div>
      <div className="econ-grid" style={{ marginBottom: 16 }}>
        {PLANS.map((p) => (
          <div key={p.id} className="econ-card" style={p.id === tier ? { borderColor: "var(--asb-blue)" } : undefined}>
            <div className="econ-card__head">{p.name} <span style={{ float: "right", color: "var(--asb-gray-500)" }}>{p.id}</span></div>
            <div className="econ-card__body">
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--asb-navy)" }}>{p.price}</div>
              <div style={{ fontSize: 10, color: "var(--asb-gray-500)", marginBottom: 8 }}>{p.sub}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11, color: "var(--asb-gray-700)", lineHeight: 1.7 }}>
                {p.features.map((fe) => <li key={fe}>✓ {fe}</li>)}
              </ul>
              <div style={{ marginTop: 10 }}>
                {p.id === tier ? (
                  <button className="asb-btn" disabled style={{ width: "100%", justifyContent: "center" }}>Current plan</button>
                ) : (
                  <button className="asb-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => requestPlan(p.name)}>
                    {p.price === "Custom" ? "Contact sales →" : `Request ${p.name} →`}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="econ-card">
        <div className="econ-card__head">Invoice history <Preview /></div>
        <div className="econ-card__body" style={{ padding: 0 }}>
          <table className="econ-table" style={{ width: "100%" }}>
            <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {SAMPLE_INVOICES.map(([id, date, amt, status]) => (
                <tr key={id}>
                  <td className="mono">{id}</td><td className="econ-muted">{date}</td><td>{amt}</td>
                  <td><span className="asb-badge in">{status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: "var(--asb-gray-500)", padding: "8px 12px" }}>Sample rows — real invoices appear here once online billing is live.</div>
        </div>
      </div>
    </>
  );

  if (embedded) return body;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <h1 className="page-title">Subscription &amp; Billing</h1>
        <div className="eyebrow" style={{ marginTop: 2 }}>Plan, payment method, invoices &amp; e-invoicing</div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>{body}</div>
    </div>
  );
}
