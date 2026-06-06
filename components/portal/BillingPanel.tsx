"use client";

// Subscription, billing & e-invoicing (customer-facing) — ported from the
// design (asb/billing-panel.jsx + subscription-checkout.jsx + einvoice.jsx).
import * as React from "react";
import { useViewerTier, Tier } from "@/lib/portal/tier";

const PLANS: { id: Tier; name: string; price: string; sub: string; features: string[] }[] = [
  { id: "T1", name: "Free", price: "$0", sub: "no card required", features: ["Post unlimited listings", "Zone-level match counts", "7-day archive"] },
  { id: "T2", name: "Standard", price: "$89", sub: "per user / month", features: ["Everything in Free", "30-day archive", "Smart Parser", "Daily digest"] },
  { id: "T3", name: "Subscriber", price: "$249", sub: "per user / month", features: ["Vessel names + IMO", "Full match intelligence", "Voyage calculators", "6-month archive"] },
  { id: "T4", name: "Partner", price: "Custom", sub: "contact sales", features: ["Everything in Subscriber", "Partner dashboard", "API access", "Account manager"] },
];

const INVOICES = [
  ["INV-2026-0418", "01 Jun 2026", "$249.00", "Paid", "Submitted"],
  ["INV-2026-0392", "01 May 2026", "$249.00", "Paid", "Submitted"],
  ["INV-2026-0361", "01 Apr 2026", "$249.00", "Paid", "Submitted"],
];

function Checkout({ plan, onClose }: { plan: (typeof PLANS)[number]; onClose: () => void }) {
  const [done, setDone] = React.useState(false);
  return (
    <div className="asb-unsaved-backdrop" onMouseDown={onClose}>
      <div className="asb-unsaved" style={{ width: 420, textAlign: "left" }} onMouseDown={(e) => e.stopPropagation()}>
        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 26 }}>✓</div>
            <h2 className="asb-unsaved__title">Upgraded to {plan.name}</h2>
            <p className="asb-unsaved__body">Your plan is active. An e-invoice has been issued and submitted to the ETA.</p>
            <button className="asb-unsaved__btn asb-unsaved__btn--primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h2 className="asb-unsaved__title" style={{ textAlign: "left" }}>Upgrade to {plan.name}</h2>
            <p className="asb-unsaved__body" style={{ textAlign: "left" }}>{plan.price} {plan.sub}. Billed monthly, cancel anytime.</p>
            <div className="pc-grid" style={{ marginBottom: 12 }}>
              <div className="pc-field pc-field--full"><label className="pc-field__label">Card number</label><input placeholder="4242 4242 4242 4242" /></div>
              <div className="pc-field"><label className="pc-field__label">Expiry</label><input placeholder="MM / YY" /></div>
              <div className="pc-field"><label className="pc-field__label">CVC</label><input placeholder="123" /></div>
              <div className="pc-field pc-field--full"><label className="pc-field__label">Billing name (for e-invoice)</label><input placeholder="Company / VAT name" /></div>
            </div>
            <div className="asb-unsaved__actions">
              <button className="asb-unsaved__btn asb-unsaved__btn--primary" onClick={() => setDone(true)}>Pay {plan.price} →</button>
              <button className="asb-unsaved__btn asb-unsaved__btn--secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function BillingPanel({ embedded = false }: { embedded?: boolean }) {
  const tier = useViewerTier();
  const [checkout, setCheckout] = React.useState<(typeof PLANS)[number] | null>(null);
  const current = PLANS.find((p) => p.id === tier);

  const body = (
    <>
        <div className="econ-grid" style={{ marginBottom: 12 }}>
          <div className="econ-card">
            <div className="econ-card__head">Current plan</div>
            <div className="econ-card__body">
              <div style={{ fontSize: 20, fontWeight: 600, color: "var(--asb-navy)" }}>{current?.name} <span style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>({tier})</span></div>
              <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>{current?.price} {current?.sub}</div>
              <div style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 8 }}>Renews 01 Jul 2026</div>
            </div>
          </div>
          <div className="econ-card">
            <div className="econ-card__head">Payment method</div>
            <div className="econ-card__body">
              <div style={{ fontSize: 13, color: "var(--asb-ink)" }}>Visa •••• 4242</div>
              <div style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>Expires 09 / 27</div>
              <button className="asb-btn" style={{ marginTop: 8 }}>Update card</button>
            </div>
          </div>
          <div className="econ-card">
            <div className="econ-card__head">E-invoicing (ETA)</div>
            <div className="econ-card__body">
              <div style={{ fontSize: 13, color: "var(--asb-green)", fontWeight: 600 }}>● Active</div>
              <div style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>Invoices auto-submitted to the Egyptian Tax Authority.</div>
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
                  ) : p.price === "Custom" ? (
                    <button className="asb-btn" style={{ width: "100%", justifyContent: "center" }}>Contact sales →</button>
                  ) : (
                    <button className="asb-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setCheckout(p)}>Choose {p.name} →</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="econ-card">
          <div className="econ-card__head">Invoice history</div>
          <div className="econ-card__body" style={{ padding: 0 }}>
            <table className="econ-table" style={{ width: "100%" }}>
              <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th>ETA</th><th></th></tr></thead>
              <tbody>
                {INVOICES.map(([id, date, amt, status, eta]) => (
                  <tr key={id}>
                    <td className="mono">{id}</td><td className="econ-muted">{date}</td><td>{amt}</td>
                    <td><span className="asb-badge in">{status}</span></td>
                    <td><span className="asb-badge blue">{eta}</span></td>
                    <td><a style={{ color: "var(--asb-blue)", cursor: "pointer", fontSize: 11 }}>PDF ↓</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      {checkout && <Checkout plan={checkout} onClose={() => setCheckout(null)} />}
    </>
  );

  // Embedded: rendered inside the Settings "Subscription & Billing" tab, which
  // already provides the page header — so emit just the body.
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
