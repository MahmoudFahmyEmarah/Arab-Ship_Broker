"use client";

// Small shared portal primitives ported from the Claude design
// (asb/cards.jsx helpers): status dot, badges, labelled field row.
import * as React from "react";

export function urgencyDot(urg: string) {
  return <span className={`asb-dot ${urg} ${urg === "red" ? "pulse" : ""}`} />;
}

export function scopeBadge(scope: string) {
  const map: Record<string, [string, string]> = {
    in: ["in", "IN"],
    partial: ["partial", "PARTIAL"],
    out: ["out", "OUT"],
  };
  const [cls, lbl] = map[scope] || ["neutral", scope?.toUpperCase()];
  return <span className={`asb-badge ${cls}`}>{lbl}</span>;
}

export function statusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    open: ["open", "OPEN"],
    review: ["review", "REVIEW"],
    fixed: ["fixed", "FIXED"],
    in: ["in", "ACTIVE"],
    partial: ["partial", "PARTIAL"],
  };
  const [cls, lbl] = map[status] || ["neutral", status?.toUpperCase()];
  return <span className={`asb-badge ${cls}`}>{lbl}</span>;
}

export function FieldRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="field-row">
      <span className="lbl">{label}</span>
      <span className={`val ${valueClass || ""}`}>{value}</span>
    </div>
  );
}
