// Shared visual language for the Data Sync module (prototype palette: navy /
// brass on parchment). Imported by every view so the Workspace, Review,
// Preview and Manual-Review screens stay pixel-consistent.
import type * as React from "react";

export const C = {
  navy: "#0a1a2f", navy2: "#13314f", brass: "#c69749", brassDeep: "#8a6420", brassBg: "#f4e7c9",
  ink: "#1c2530", ink2: "#55606d", ink3: "#8a929c", line: "#e6e8ec", card: "#ffffff", sunken: "#f6f7f9",
  green: "#2f7d52", greenBg: "#e4f1ea", amber: "#a9761a", amberBg: "#f6e9cf",
  red: "#b23b3b", redBg: "#f8e0e0",
  mono: "ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace",
};

export const btn = (kind: "primary" | "ghost" | "dark" | "danger"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 7,
  cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap",
  border: "1px solid transparent", transition: "background .12s,border-color .12s",
  ...(kind === "primary" && { background: C.brass, color: "#fff" }),
  ...(kind === "dark" && { background: C.navy, color: "#faf6ee" }),
  ...(kind === "ghost" && { background: "#fff", color: C.ink2, border: `1px solid ${C.line}` }),
  ...(kind === "danger" && { background: "#fff", color: C.red, border: `1px solid ${C.redBg}` }),
});

/** Render any DB scalar as a compact display string. */
export const cell = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
};
