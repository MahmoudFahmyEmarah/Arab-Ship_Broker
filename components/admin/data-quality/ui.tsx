"use client";

// Shared pieces for the Data quality console: badges, drawer, confirm dialog,
// undo toast, segmented toggle, switch, sparkline and formatters — all on the
// admin token classes (admin.css / admin-dq.css).
import * as React from "react";
import type { DqSeverity } from "@/lib/dq/types";
import { SEVERITY_BADGE } from "@/lib/dq/types";

export function Badge({ cls, children, title, style }: { cls: string; children: React.ReactNode; title?: string; style?: React.CSSProperties }) {
  return <span className={`adm-badge ${cls}`} title={title} style={style}>{children}</span>;
}
export function Sev({ s }: { s: DqSeverity }) { return <Badge cls={SEVERITY_BADGE[s]}>{s}</Badge>; }

export function sevColor(s: DqSeverity): string { return ({ error: "var(--asb-red)", warn: "var(--asb-amber)", info: "var(--asb-slate)" })[s]; }
export function scoreColor(n: number): string { return n >= 85 ? "var(--asb-green)" : n >= 60 ? "var(--asb-amber)" : "var(--asb-red)"; }

export function Drawer({ head, title, onClose, children, narrow, label, guard, testId }: { head?: React.ReactNode; title: React.ReactNode; onClose: () => void; children: React.ReactNode; narrow?: boolean; label: string; /** return false to keep the drawer open (unsaved edits — audit U5) */ guard?: () => boolean; /** a stable hook for the browser suite; presentation carries no meaning for a test */ testId?: string }) {
  const tryClose = React.useCallback(() => { if (!guard || guard()) onClose(); }, [guard, onClose]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") tryClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tryClose]);
  return (
    <>
      <div className="dq-scrim" onMouseDown={tryClose} />
      <aside className={`dq-drawer${narrow ? " dq-drawer--narrow" : ""}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
        <div className="dq-drawer__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            {head}
            <div className="dq-drawer__title">{title}</div>
          </div>
          <button type="button" className="dq-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}

export interface ConfirmSpec { title: string; body: React.ReactNode; undo: string; label: string; danger?: boolean; run: () => void | Promise<void> }
export function ConfirmDialog({ c, onClose }: { c: ConfirmSpec | null; onClose: () => void }) {
  // Escape closes it like the drawer beside it (audit U6)
  React.useEffect(() => { if (!c) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [c, onClose]);
  const [busy, setBusy] = React.useState(false);
  if (!c) return null;
  return (
    <div className="dq-confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-card" role="dialog" aria-modal="true" style={{ width: "min(440px,100%)", padding: "18px 20px" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)" }}>{c.title}</div>
        <p style={{ fontSize: 13, color: "var(--asb-ink-secondary)", margin: "8px 0 4px" }}>{c.body}</p>
        <p className="dq-muted" style={{ margin: "0 0 16px", display: "flex", gap: 6, alignItems: "center" }}><Badge cls="draft">Undo path</Badge>{c.undo}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button type="button" className="adm-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`adm-btn ${c.danger ? "reject" : "primary"}`} disabled={busy} onClick={async () => { setBusy(true); try { await c.run(); } finally { setBusy(false); onClose(); } }}>{busy ? "Working…" : c.label}</button>
        </div>
      </div>
    </div>
  );
}

export function useToast() {
  const [t, setT] = React.useState<{ msg: string; undo?: () => void | Promise<void> } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = React.useCallback((msg: string, undo?: () => void | Promise<void>) => {
    if (timer.current) clearTimeout(timer.current);
    setT({ msg, undo });
    timer.current = setTimeout(() => setT(null), 7000);
  }, []);
  const node = t ? (
    <div className="dq-toast" role="status">
      <span>{t.msg}</span>
      {t.undo && <button type="button" onClick={async () => { const u = t.undo; setT({ msg: "Reverting…" }); try { await u?.(); setT({ msg: "Reverted." }); } catch (e) { setT({ msg: e instanceof Error ? e.message : "Undo failed." }); } timer.current = setTimeout(() => setT(null), 4000); }}>Undo</button>}
      <button type="button" className="dq-toast__x" onClick={() => setT(null)} aria-label="Dismiss">✕</button>
    </div>
  ) : null;
  return { toast, node };
}

export function Seg<T extends string>({ options, value, onChange, disabled }: { options: { id: T; label: string; tip?: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="dq-seg">
      {options.map((o) => (
        <button key={o.id} type="button" className={`dq-seg__btn${value === o.id ? " is-active" : ""}`} title={o.tip} disabled={disabled} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, disabled, title }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return <button type="button" role="switch" aria-checked={on} className={`adm-toggle${on ? " is-on" : ""}`} title={title} disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(!on); }} />;
}

export function KV({ rows, k = 130 }: { rows: [React.ReactNode, React.ReactNode][]; k?: number }) {
  return (
    <div className="adm-kv" style={{ gridTemplateColumns: `${k}px 1fr`, fontSize: 12 }}>
      {rows.map(([a, b], i) => (<React.Fragment key={i}><span className="adm-kv__k">{a}</span><span className="adm-kv__v num" style={{ wordBreak: "break-word" }}>{b}</span></React.Fragment>))}
    </div>
  );
}

export function Spark({ values, color, w = 80, h = 26 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const min = Math.min(...values) - 2, max = Math.max(...values) + 2;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-label="14-day trend" style={{ overflow: "visible", flex: "none" }}>
      <polyline fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" points={pts.join(" ")} />
      <circle r={2.2} fill={color} cx={last[0]} cy={last[1]} />
    </svg>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="adm-empty" style={{ padding: "40px 20px" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)", marginBottom: 4 }}>{title}</div>
      {children && <p style={{ margin: "0 0 12px" }}>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) { return <div className="adm-empty" style={{ padding: 28 }}>{label}</div>; }

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));
export const fmtMoney = (n: number | null | undefined) => (n == null || n === 0 ? "—" : `$${Number(n).toFixed(2)}`);
export const fmtDur = (ms: number | null | undefined) => { if (ms == null) return "—"; const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`; };
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)} s`; if (s < 3600) return `${Math.round(s / 60)} min`; if (s < 86400) return `${Math.round(s / 3600)} h`; return `${Math.round(s / 86400)} d`;
}
export const pct = (n: number) => `${Math.round(n)}%`;

export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
