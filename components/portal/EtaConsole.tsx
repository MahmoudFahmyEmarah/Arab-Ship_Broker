"use client";

// ETA e-invoicing console (Egyptian Tax Authority) — owner-only admin page,
// on-brand port of the design's e-invoice console (asb/einvoice.jsx).
import * as React from "react";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "red" }) {
  const color = tone === "green" ? "var(--asb-green)" : tone === "amber" ? "var(--asb-amber)" : tone === "red" ? "var(--asb-red)" : "var(--asb-navy)";
  return (
    <div className="econ-card">
      <div className="econ-card__head">{label}</div>
      <div className="econ-card__body"><div style={{ fontSize: 20, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{value}</div></div>
    </div>
  );
}

const QUEUE = [
  ["INV-2026-0418", "Subscriber · Mediterranean Shipping", "$249.00", "Submitted", "green"],
  ["INV-2026-0417", "Partner · Gulf Sea Brokers", "$1,200.00", "Submitted", "green"],
  ["INV-2026-0416", "Subscriber · Navigrains", "$249.00", "Pending", "amber"],
  ["INV-2026-0415", "Standard · Satirbroke", "$89.00", "Rejected", "red"],
];

export function EtaConsole() {
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ marginBottom: 14 }}>
        <div className="eyebrow"><span style={{ color: "#854F0B" }}>Admin</span> / ETA e-invoicing</div>
        <h1 className="page-title" style={{ marginTop: 2 }}>ETA e-invoicing console</h1>
        <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>
          Egyptian Tax Authority submission status, signing credentials and the invoice queue. Owner-only.
        </div>
      </div>

      <div className="econ-grid" style={{ marginBottom: 12 }}>
        <Stat label="Connection" value="● Connected" tone="green" />
        <Stat label="Signing certificate" value="Valid · exp 2027-01" tone="green" />
        <Stat label="Environment" value="Production" />
        <Stat label="Pending submissions" value="1" tone="amber" />
      </div>

      <div className="econ-card">
        <div className="econ-card__head">Invoice submission queue</div>
        <div className="econ-card__body" style={{ padding: 0 }}>
          <table className="econ-table" style={{ width: "100%" }}>
            <thead>
              <tr><th>Invoice</th><th>Account</th><th>Amount</th><th>ETA status</th></tr>
            </thead>
            <tbody>
              {QUEUE.map(([id, acct, amt, status, tone]) => (
                <tr key={id}>
                  <td className="mono">{id}</td>
                  <td className="econ-muted">{acct}</td>
                  <td>{amt}</td>
                  <td><span className={`asb-badge ${tone === "green" ? "in" : tone === "amber" ? "review" : "out"}`}>{status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="asb-btn primary">Submit pending →</button>
        <button className="asb-btn">Download ETA report</button>
        <button className="asb-btn">Credentials &amp; signing config</button>
      </div>
    </div>
  );
}
