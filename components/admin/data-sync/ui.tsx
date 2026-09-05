// Shared visual language for the Data Sync module. Every value resolves to a
// design-system token (app/design-tokens.css) so the module reads exactly
// like the rest of the platform: navy + steel-blue accent on the gray-50 canvas.
// Imported by every view so the Workspace, Review, Preview and Manual-Review
// screens stay pixel-consistent.
import type * as React from "react";

export const C = {
  navy: "var(--asb-navy)", navy2: "var(--asb-navy-global)",
  brass: "var(--asb-steel)", brassDeep: "var(--asb-steel-deep)", brassBg: "var(--asb-blue-light)",
  ink: "var(--asb-ink)", ink2: "var(--asb-ink-secondary)", ink3: "var(--asb-gray-500)",
  line: "var(--asb-line)", card: "var(--asb-white)", sunken: "var(--asb-gray-50)",
  green: "var(--asb-green)", greenBg: "var(--asb-green-bg)", amber: "var(--asb-amber)", amberBg: "var(--asb-amber-bg)",
  red: "var(--asb-red)", redBg: "var(--asb-red-bg)",
  mono: "var(--asb-font-mono)",
};

export const btn = (kind: "primary" | "ghost" | "dark" | "danger"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: "var(--r-soft-10)",
  cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
  border: "1px solid transparent", transition: "background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease)",
  ...(kind === "primary" && { background: C.navy, color: "#fff", boxShadow: "var(--sh-card)" }),
  ...(kind === "dark" && { background: C.brass, color: "#fff", boxShadow: "var(--sh-card)" }),
  ...(kind === "ghost" && { background: C.card, color: C.ink2, border: `1px solid ${C.line}` }),
  ...(kind === "danger" && { background: C.card, color: C.red, border: `1px solid ${C.redBg}` }),
});

/** Render any DB scalar as a compact display string. */
export const cell = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
};
