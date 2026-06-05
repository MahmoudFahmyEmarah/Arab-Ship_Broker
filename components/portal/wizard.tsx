"use client";

// Shared wizard primitives for the Post Cargo / Post Position flows
// (ported from asb/post-cargo.jsx · Stepper + sections + review).
import * as React from "react";

export function Stepper({ steps, step, setStep }: { steps: string[]; step: number; setStep: (n: number) => void }) {
  return (
    <div className="pc-stepper">
      <div className="pc-stepper__row">
        {steps.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <React.Fragment key={label}>
              <button
                type="button"
                className={`pc-stepper__item${done ? " is-done" : ""}${active ? " is-active" : ""}`}
                onClick={() => i <= step && setStep(i)}
              >
                <span className="pc-stepper__circle">{done ? "✓" : i + 1}</span>
                <span className="pc-stepper__label">{label}</span>
              </button>
              {i < steps.length - 1 && <span className={`pc-stepper__line${done ? " is-done" : ""}`} />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pc-section">
      <div className="pc-section__title">{title}</div>
      <div className="pc-grid">{children}</div>
    </div>
  );
}

export function Field({
  label,
  required,
  full,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  // Blocking validation error (red). When set, the control is outlined red.
  error?: string | null;
  // Soft, non-blocking warning (amber) — the design's "Soft Warning" type.
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={`pc-field${full ? " pc-field--full" : ""}${error ? " pc-field--error" : ""}`}>
      <label className="pc-field__label">
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {error ? (
        <div className="pc-field__msg pc-field__msg--error" role="alert">{error}</div>
      ) : hint ? (
        <div className="pc-field__msg pc-field__msg--hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function ReviewRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="pc-review__row">
      <span className="pc-review__k">{k}</span>
      <span className="pc-review__v">{v || "—"}</span>
    </div>
  );
}

export function VisibilityChooser({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="pc-vis">
      <div className={`pc-vis__opt${value === true ? " is-on" : ""}`} onClick={() => onChange(true)}>
        <h5>● In circulation</h5>
        <p>Visible to Subscriber-tier members across the market once approved.</p>
      </div>
      <div className={`pc-vis__opt${value === false ? " is-on" : ""}`} onClick={() => onChange(false)}>
        <h5>○ Private to Arab ShipBroker</h5>
        <p>Held for ASB matching only; not shown on the public market board.</p>
      </div>
    </div>
  );
}

export function Success({ title, sub, onReset }: { title: string; sub: string; onReset: () => void }) {
  return (
    <div className="pc-section" style={{ textAlign: "center", maxWidth: 520, margin: "32px auto" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--asb-gray-500)", lineHeight: 1.6, marginBottom: 16 }}>{sub}</div>
      <button type="button" className="pc-btn pc-btn--primary" onClick={onReset}>Post another →</button>
    </div>
  );
}
