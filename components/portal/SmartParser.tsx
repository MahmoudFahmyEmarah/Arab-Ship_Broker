"use client";

// Smart Parser side panel (paste a circular → autofill the wizard). Now wired to
// the real AI parser at POST /api/circulars/parse (Anthropic-backed, auth-gated).
// The host flow supplies `onApply`, which maps the extracted fields into its form
// state and returns the count applied. If the parser is unavailable (no API key
// → 503, not authed → 401, or a network error) we call `onApply(null)` so the
// host applies its built-in sample instead — the flow always stays usable.
import * as React from "react";
import type { CircularParseResult } from "@/lib/circulars/types";

export function SmartParser({
  onApply,
}: {
  onApply: (result: CircularParseResult | null) => number;
}) {
  const [open, setOpen] = React.useState(true);
  const [text, setText] = React.useState("");
  const [applied, setApplied] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    setApplied(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/circulars/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setApplied(onApply(null));
        setNote(
          res.status === 503
            ? "AI parser not configured — applied a sample instead."
            : res.status === 401
              ? "Sign in to use the AI parser — applied a sample instead."
              : `Parser unavailable (${res.status}) — applied a sample instead.`,
        );
        return;
      }
      const result = (await res.json()) as CircularParseResult;
      setApplied(onApply(result));
      setWarnings(Array.isArray(result.warnings) ? result.warnings : []);
    } catch {
      setApplied(onApply(null));
      setNote("Parser unreachable — applied a sample instead.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="sp-tab" onClick={() => setOpen(true)} title="Smart Parser">⚡ Parser</button>
    );
  }
  return (
    <div className="sp-panel">
      <div className="sp-panel__head">
        <span className="sp-panel__title">⚡ Smart Parser</span>
        <button className="sp-panel__close" onClick={() => setOpen(false)}>✕</button>
      </div>
      <div className="sp-panel__body">
        <p className="sp-panel__hint">Paste a cargo/position circular or email. We extract the fields and pre-fill the form for you to review.</p>
        <textarea
          className="sp-panel__ta"
          placeholder={"e.g.\nACCT: 8/10,000 MT Wheat in bulk\nNovorossiysk / Damietta\n14-18 April\nFIOST, 2.5% comm\nfrt idea USD 28/mt"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="pc-btn pc-btn--primary"
          style={{ width: "100%", justifyContent: "center" }}
          disabled={busy || !text.trim()}
          onClick={run}
        >
          {busy ? "Parsing…" : "Parse & apply →"}
        </button>
        {applied != null && (
          <div className="pc-success" style={{ marginTop: 10 }}>
            <span>✓</span> {applied} fields applied. Review before submitting.
          </div>
        )}
        {note && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--asb-gray-500)" }}>{note}</div>
        )}
        {warnings.length > 0 && (
          <ul style={{ marginTop: 8, fontSize: 11, color: "var(--asb-amber-600, #b45309)", paddingLeft: 16 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
