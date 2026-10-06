"use client";

// A small modal form for the room's one-line inputs (a reason, a date, a close
// reason), replacing window.prompt (release audit PR-08): it is styled with the
// room's dialog (nrx), validates before it calls the command, and keeps focus
// the way the recap composer does (C2O-012 item 1): focus once on open, Tab
// stays inside, Escape closes, focus returns to the control that opened it.
import * as React from "react";

export type PromptField =
  | { name: string; label: string; kind: "text" | "textarea"; required?: boolean; maxLength?: number; placeholder?: string; initial?: string }
  | { name: string; label: string; kind: "date"; required?: boolean; min?: string; max?: string; initial?: string }
  | { name: string; label: string; kind: "select"; options: { value: string; label: string }[]; initial?: string };

export interface PromptConfig {
  title: string;
  description?: string;
  fields: PromptField[];
  confirmLabel: string;
  danger?: boolean;
  testId?: string;
  onSubmit: (values: Record<string, string>) => void;
}

export function PromptDialog({ config, onClose }: { config: PromptConfig; onClose: () => void }) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.name, f.initial ?? (f.kind === "select" ? f.options[0]?.value ?? "" : "")])));
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLFormElement | null>(null);
  const closeRef = React.useRef(onClose);
  React.useEffect(() => { closeRef.current = onClose; });
  React.useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])") ?? [])
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !dialog) return;
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    (dialog?.querySelector<HTMLElement>("input, textarea, select") ?? focusables()[0])?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const f of config.fields) {
      const v = (values[f.name] ?? "").trim();
      if (f.kind !== "select" && f.required && !v) { setError(`${f.label} is required.`); return; }
      if (f.kind === "date" && v) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { setError(`${f.label} must be a date.`); return; }
        if ((f.min && v < f.min) || (f.max && v > f.max)) { setError(`${f.label} must be between ${f.min ?? "…"} and ${f.max ?? "…"}.`); return; }
      }
    }
    config.onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
    onClose();
  };

  return (
    <div className="nrx-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="nrx nrx--small" role="dialog" aria-modal="true" aria-label={config.title} ref={dialogRef} onSubmit={submit} data-testid={config.testId ?? "prompt-dialog"}>
        <div className="nrx__hd">
          <div>
            <div className="nrx__title">{config.title}</div>
            {config.description && <div className="nrx__sub">{config.description}</div>}
          </div>
          <button type="button" className="nrx__x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="nrx__body">
          {config.fields.map((f) => {
            const id = `pd-${f.name}`;
            const set = (v: string) => { setError(null); setValues((s) => ({ ...s, [f.name]: v })); };
            return (
              <div className="nrx__field" key={f.name}>
                <label htmlFor={id}>{f.label}</label>
                {f.kind === "textarea" ? (
                  <textarea id={id} className="nrx__ta" rows={3} maxLength={f.maxLength} placeholder={f.placeholder} value={values[f.name]} onChange={(e) => set(e.target.value)} />
                ) : f.kind === "select" ? (
                  <select id={id} className="asb-input" value={values[f.name]} onChange={(e) => set(e.target.value)}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.kind === "date" ? (
                  <input id={id} type="date" className="asb-input" min={f.min} max={f.max} value={values[f.name]} onChange={(e) => set(e.target.value)} />
                ) : (
                  <input id={id} className="asb-input" maxLength={f.maxLength} placeholder={f.placeholder} value={values[f.name]} onChange={(e) => set(e.target.value)} />
                )}
              </div>
            );
          })}
          {error && <div className="nrx__err" role="alert">{error}</div>}
        </div>
        <div className="nrx__ft">
          <span className="nrx__note" />
          <div className="nrx__actions">
            <button type="button" className="asb-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className={`asb-btn ${config.danger ? "danger" : "primary"}`} data-testid={`${config.testId ?? "prompt-dialog"}-confirm`}>{config.confirmLabel}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
