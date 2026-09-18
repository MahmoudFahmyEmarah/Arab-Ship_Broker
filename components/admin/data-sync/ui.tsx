// Shared visual language for the Data Sync module. Every value resolves to a
// design-system token (app/design-tokens.css) so the module reads exactly
// like the rest of the platform: navy + steel-blue accent on the gray-50 canvas.
//
// The layout/skin classes live in app/(admin)/admin-data-sync.css (.ds-*); the
// helpers here are the small typed primitives the views compose — Btn, Badge,
// Chip, Seg, Card and the value formatters. Imported by every view so Intake,
// Review, Database, Queues, History and Connections stay pixel-consistent.
import type * as React from "react";
import { Loader2 } from "lucide-react";

export const C = {
  navy: "var(--asb-navy)", navy2: "var(--asb-navy-global)",
  brass: "var(--asb-steel)", brassDeep: "var(--asb-steel-deep)", brassBg: "var(--asb-blue-light)",
  blue: "var(--asb-blue)",
  ink: "var(--asb-ink)", ink2: "var(--asb-ink-secondary)", ink3: "var(--asb-gray-500)",
  slate: "var(--asb-slate)",
  line: "var(--asb-line)", card: "var(--asb-white)", sunken: "var(--asb-gray-50)",
  green: "var(--asb-green)", greenBg: "var(--asb-green-bg)", amber: "var(--asb-amber)", amberBg: "var(--asb-amber-bg)",
  red: "var(--asb-red)", redBg: "var(--asb-red-bg)",
  mono: "var(--asb-font-mono)",
};

/** Legacy inline-style button kept so views migrate one at a time; new markup
 *  should use <Btn>, which is the same shape driven by .ds-btn. */
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

// ── primitives ──────────────────────────────────────────────────────────────

type BtnKind = "default" | "primary" | "accent" | "ghost" | "danger";

/** The design's .asb-btn. `busy` swaps the leading glyph for a spinner and
 *  disables the control, so callers never hand-roll a pending state. */
export function Btn({
  kind = "default", size, busy = false, icon, children, className, disabled, ...rest
}: {
  kind?: BtnKind; size?: "sm"; busy?: boolean; icon?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={[
        "ds-btn",
        kind !== "default" ? `ds-btn--${kind}` : "",
        size === "sm" ? "ds-btn--sm" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {busy ? <Loader2 size={size === "sm" ? 13 : 15} className="ds-spin" /> : icon}
      {children}
    </button>
  );
}

export type BadgeTone = "new" | "updated" | "invalid" | "info" | "neutral";

/** Maps a batch/row status word onto the badge palette. Anything unrecognised
 *  falls back to neutral rather than inventing a colour. */
export const toneForStatus = (status: string): BadgeTone => {
  const s = status.toLowerCase();
  if (s === "committed" || s === "new" || s === "resolved" || s === "connected" || s === "ok") return "new";
  if (s === "draft" || s === "gated" || s === "partial" || s === "updated" || s === "pending" || s === "committing" || s === "running") return "updated";
  if (s === "failed" || s === "gate_failed" || s === "invalid" || s === "error" || s === "blocked") return "invalid";
  if (s === "undone" || s === "ignored" || s === "unchanged" || s === "idle") return "neutral";
  return "info";
};

export function Badge({ tone = "neutral", children, title }: {
  tone?: BadgeTone; children: React.ReactNode; title?: string;
}) {
  return <span className={`ds-badge ds-badge--${tone}`} title={title}>{children}</span>;
}

/** Filter chip with an optional count pill. */
export function Chip({
  active = false, count, countTone, icon, children, ...rest
}: {
  active?: boolean; count?: number; countTone?: "warn" | "danger"; icon?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`ds-chip${active ? " is-active" : ""}`}>
      {children}
      {count !== undefined && count > 0 && (
        <span className={`ds-chip__count${countTone ? ` ds-chip__count--${countTone}` : ""}`}>{count}</span>
      )}
      {icon}
    </button>
  );
}

/** Segmented toggle — the design's SegmentedToggle. */
export function Seg<T extends string>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void;
  options: readonly { value: T; label: string; count?: number }[];
  disabled?: boolean;
}) {
  return (
    <div className="ds-seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value} type="button" role="tab" aria-selected={o.value === value} disabled={disabled}
          className={`ds-seg__btn${o.value === value ? " is-active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Card({ flush = false, hoverable = false, accent = false, className, children, ...rest }: {
  flush?: boolean; hoverable?: boolean; accent?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={[
        "ds-card",
        flush ? "ds-card--flush" : "",
        hoverable ? "ds-card--hoverable" : "",
        accent ? "ds-card--accent" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

/** Uppercase section label — the design's .asb-detail__label. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`ds-label${className ? ` ${className}` : ""}`}>{children}</div>;
}

/** Toggle switch with its label, used for "Changes only" and connection enables. */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: C.ink2, cursor: disabled ? "default" : "pointer", userSelect: "none" }}>
      <input type="checkbox" className="ds-switch" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Right slide-over used by Review, Queues and Database. Renders its own scrim. */
export function Drawer({ title, sub, onClose, narrow = false, head, foot, children }: {
  title: string; sub?: React.ReactNode; onClose: () => void; narrow?: boolean;
  head?: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <>
      <div className="ds-scrim" onClick={onClose} />
      <aside className={`ds-drawer${narrow ? " ds-drawer--narrow" : ""}`} role="dialog" aria-label={title}>
        <div className="ds-drawer__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ds-drawer__title">{title}</div>
            {sub && <div className="ds-drawer__sub">{sub}</div>}
          </div>
          {head}
          <button type="button" className="ds-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ds-drawer__body">{children}</div>
        {foot && <div className="ds-drawer__foot">{foot}</div>}
      </aside>
    </>
  );
}

export function DrawerSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="ds-drawer__section">
      {label && <SectionLabel>{label}</SectionLabel>}
      {label && <div style={{ height: 8 }} />}
      {children}
    </section>
  );
}

/** Hydration-safe timestamp: the server (and the first client render) show a
 *  deterministic UTC string; after mount we swap to the viewer's local format.
 *  Rendering toLocaleString() directly would mismatch server vs browser locale. */
export const utcShort = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** "3 min ago" / "2 d ago" — used by the channel cards and History. */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return iso.slice(0, 10);
}
