// ETA e-invoicing console (Egyptian Tax Authority) — owner-only admin page.
// Now fed by the billing ledger: every issued invoice with its e-invoice
// status, the UUIDs recorded from the portal, and what is still to submit.
// The API connection itself is Phase 3; until then this is the work queue for
// keying documents into the ETA portal and recording the result.
import Link from "next/link";
import type { EinvoiceStatus, Invoice } from "@/lib/billing/types";
import { fmtMoney } from "@/lib/billing/money";

type Row = Invoice & { customer_name: string };

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "amber" | "red" }) {
  const color = tone === "green" ? "var(--asb-green)" : tone === "amber" ? "var(--asb-amber)" : tone === "red" ? "var(--asb-red)" : "var(--asb-navy)";
  return (
    <div className="econ-card">
      <div className="econ-card__head">{label}</div>
      <div className="econ-card__body"><div style={{ fontSize: 20, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{value}</div></div>
    </div>
  );
}

const BADGE: Record<EinvoiceStatus, string> = { not_submitted: "amber", submitted: "neutral", valid: "green", invalid: "red", rejected: "red", cancelled: "neutral" };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function EtaConsole({ rows, issuerReady, apiConfigured }: { rows: Row[]; issuerReady: boolean; apiConfigured: boolean }) {
  const toSubmit = rows.filter((r) => r.einvoice_status === "not_submitted");
  const valid = rows.filter((r) => r.einvoice_status === "valid");
  const problems = rows.filter((r) => r.einvoice_status === "invalid" || r.einvoice_status === "rejected");
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ marginBottom: 14 }}>
        <div className="eyebrow"><span style={{ color: "var(--asb-steel)" }}>Admin</span> / ETA e-invoicing</div>
        <h1 className="page-title" style={{ marginTop: 2 }}>ETA e-invoicing console</h1>
        <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>
          Every issued invoice and its status with the Egyptian Tax Authority. Owner-only.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: apiConfigured ? "var(--asb-green-bg)" : "var(--asb-blue-light)", border: `0.5px solid ${apiConfigured ? "var(--asb-green)" : "var(--asb-steel)"}`, color: apiConfigured ? "var(--asb-green)" : "var(--asb-blue)", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, marginTop: 10 }}>
          <span className="asb-badge neutral" style={{ fontSize: 8.5, letterSpacing: ".04em" }}>{apiConfigured ? "API" : "PORTAL"}</span>
          <span>
            {apiConfigured
              ? "ETA client credentials are stored; direct submission is the next release. Until then key each document into the portal and record its UUID."
              : "Portal mode: open each invoice, key it into the ETA portal, then record the UUID it returns from the invoice drawer in Billing. Direct API submission arrives with the e-seal (Phase 3)."}
            {!issuerReady && " Issuer tax details are not set yet — fill them in Billing → Settings first."}
          </span>
        </div>
      </div>

      <div className="econ-grid" style={{ marginBottom: 12 }}>
        <Stat label="Issuer" value={issuerReady ? "● Ready" : "● Incomplete"} tone={issuerReady ? "green" : "amber"} />
        <Stat label="To submit" value={toSubmit.length} tone={toSubmit.length ? "amber" : "green"} />
        <Stat label="Accepted (valid)" value={valid.length} tone="green" />
        <Stat label="Invalid / rejected" value={problems.length} tone={problems.length ? "red" : undefined} />
      </div>

      <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="asb-table asb-table--dense" style={{ width: "100%" }}>
          <thead><tr><th>Number</th><th>Customer</th><th>Type</th><th>Issued</th><th className="num">EGP total</th><th>ETA status</th><th>UUID</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--asb-gray-500)", padding: 24 }}>No issued invoices yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.number}</td>
                <td>{r.customer_name}</td>
                <td>{r.document_type === "I" ? "Invoice" : r.document_type === "C" ? "Credit note" : "Debit note"}</td>
                <td>{fmtDate(r.issued_at)}</td>
                <td className="num">{fmtMoney(r.egp_total ?? (r.currency === "EGP" ? r.total : null), "EGP")}</td>
                <td><span className={`asb-badge ${BADGE[r.einvoice_status]}`}>{r.einvoice_status.replace("_", " ")}</span></td>
                <td className="mono" style={{ fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.eta_uuid ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}><Link href={`/admin/billing/invoices/${r.id}`} target="_blank" className="asb-btn" style={{ padding: "4px 9px", fontSize: 12 }}>Document</Link> <Link href="/admin/billing" className="asb-btn" style={{ padding: "4px 9px", fontSize: 12 }}>Billing</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
