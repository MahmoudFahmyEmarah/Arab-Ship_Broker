"use client";

// Small shared pieces for the Billing console: right-hand drawer, labelled
// field, status badges and money formatting on the admin token classes.
import * as React from "react";
import { fmtMoney } from "@/lib/billing/money";
import type { EinvoiceStatus, InvoiceStatus, SubscriptionStatus } from "@/lib/billing/types";

export function Drawer({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div ref={ref} onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(13,37,69,.32)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ width: wide ? "min(760px, 96vw)" : "min(540px, 94vw)", height: "100%", background: "var(--asb-white)", boxShadow: "var(--sh-dropdown)", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "var(--asb-navy)", color: "#fff", padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: "rgba(255,255,255,.75)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, border: 0, borderRadius: 6, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="adm-field" style={{ marginBottom: 12 }}>
      <span className="adm-field__label">{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--adm-muted)" }}>{hint}</span>}
    </label>
  );
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>{children}</div>;
}

export function Money({ n, currency, egp }: { n: number | null | undefined; currency: string; egp?: number | null }) {
  return (
    <span className="num" style={{ whiteSpace: "nowrap" }}>
      {fmtMoney(n, currency)}
      {egp != null && currency !== "EGP" && <span style={{ color: "var(--adm-muted)", fontSize: 11 }}> · {fmtMoney(egp, "EGP")}</span>}
    </span>
  );
}

const INVOICE_BADGE: Record<InvoiceStatus, string> = { draft: "draft", issued: "pending", partially_paid: "amber", paid: "live", void: "expired" };
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`adm-badge ${INVOICE_BADGE[status]}`}>{status.replace("_", " ")}</span>;
}
const SUB_BADGE: Record<SubscriptionStatus, string> = { trialing: "draft", active: "live", past_due: "amber", canceled: "expired", expired: "expired" };
export function SubStatusBadge({ status }: { status: SubscriptionStatus }) {
  return <span className={`adm-badge ${SUB_BADGE[status]}`}>{status.replace("_", " ")}</span>;
}
const ETA_BADGE: Record<EinvoiceStatus, string> = { not_submitted: "inactive", submitted: "pending", valid: "live", invalid: "rejected", rejected: "rejected", cancelled: "expired" };
export function EtaBadge({ status }: { status: EinvoiceStatus }) {
  return <span className={`adm-badge ${ETA_BADGE[status]}`}>ETA · {status.replace("_", " ")}</span>;
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
