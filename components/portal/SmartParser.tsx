"use client";

// Smart Assistant — the floating "AI Bosun". Paste a circular (or, for a
// vessel, upload a Q88) and the assistant reads it and pre-fills the form. The
// extraction runs on the server via POST /api/circulars/parse (Anthropic /
// Claude-backed, auth-gated); the host flow's `onApply` maps the returned fields
// into its form state and returns the count applied. If the parser is
// unavailable (no key → 503, not authed → 401, network), we call onApply(null)
// so the flow falls back to its sample and stays usable.
//
// It floats over the page (fixed, bottom-right by default), is draggable by its
// header within the viewport, remembers its position, and docks to a bottom
// sheet on small screens. It is NOT in the sidebar.
import * as React from "react";
import type { CircularParseResult } from "@/lib/circulars/types";

// Classy line-art bosun (peaked cap + old-salt profile) — not a cartoon.
function BosunAvatar({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="var(--asb-navy, #0B1F3A)" />
      <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* peaked cap */}
        <path d="M13 20c1.5-5 6-8 11-8s9.5 3 11 8" />
        <path d="M12 20h24" />
        <path d="M16 20c0-2.6 3.6-4 8-4s8 1.4 8 4" />
        {/* cap badge anchor */}
        <path d="M24 13.6v3.2M22.6 15.1h2.8M24 17a1 1 0 100-2 1 1 0 000 2Z" strokeWidth="1.2" />
        {/* face + jaw (old salt) */}
        <path d="M17 21v3a7 7 0 007 7 7 7 0 007-7v-3" />
        <path d="M18.5 30c1.2 3.2 3.1 5 5.5 5s4.3-1.8 5.5-5" />
        {/* collar */}
        <path d="M15 36l9 3 9-3" />
      </g>
    </svg>
  );
}

const STORE_KEY = "asb:bosunPos";

export function SmartParser({
  onApply,
  mode = "cargo",
}: {
  onApply: (result: CircularParseResult | null) => number;
  mode?: "cargo" | "vessel";
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [applied, setApplied] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);

  const cardRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const drag = React.useRef<{ dx: number; dy: number } | null>(null);

  React.useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (v) setPos(JSON.parse(v));
    } catch {}
  }, []);

  const clamp = React.useCallback((x: number, y: number) => {
    const el = cardRef.current;
    const w = el?.offsetWidth ?? 360;
    const h = el?.offsetHeight ?? 420;
    const maxX = window.innerWidth - w - 8;
    const maxY = window.innerHeight - h - 8;
    return { x: Math.max(8, Math.min(x, maxX)), y: Math.max(8, Math.min(y, maxY)) };
  }, []);

  React.useEffect(() => {
    if (!open || !pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, pos, clamp]);

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (window.innerWidth < 640) return; // bottom-sheet on mobile, no drag
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onHeaderPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  }
  function onHeaderPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    try {
      if (pos) localStorage.setItem(STORE_KEY, JSON.stringify(pos));
    } catch {}
  }

  function handleResult(res: Response, result: CircularParseResult | null) {
    if (result) {
      setApplied(onApply(result));
      setWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      return;
    }
    setApplied(onApply(null));
    setNote(
      res.status === 503
        ? "Assistant not configured — applied a sample instead."
        : res.status === 401
          ? "Sign in to use the assistant — applied a sample instead."
          : res.status === 415 || res.status === 413
            ? "That file can't be read — please paste the text instead."
            : `Assistant unavailable (${res.status}) — applied a sample instead.`,
    );
  }

  async function postParse(body: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    setApplied(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/circulars/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        handleResult(res, null);
        return;
      }
      handleResult(res, (await res.json()) as CircularParseResult);
    } catch {
      setApplied(onApply(null));
      setNote("Assistant unreachable — applied a sample instead.");
    } finally {
      setBusy(false);
    }
  }

  const runText = () => {
    if (!text.trim() || busy) return;
    postParse({ text });
  };

  async function onFile(file: File) {
    if (busy) return;
    if (file.type !== "application/pdf") {
      setNote("Please upload the Q88 as a PDF.");
      return;
    }
    setFileName(file.name);
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    postParse({ fileBase64: base64, fileMediaType: "application/pdf", text: text.trim() || undefined });
  }

  // ── Collapsed: floating launcher ──
  if (!open) {
    return (
      <button className="bosun-fab" onClick={() => setOpen(true)} title="Smart Assistant — AI Bosun">
        <BosunAvatar size={26} />
        <span className="bosun-fab__label">AI&nbsp;Bosun</span>
      </button>
    );
  }

  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;

  return (
    <div ref={cardRef} className="bosun-card" style={style} role="dialog" aria-label="Smart Assistant">
      <div
        className="bosun-card__head"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <BosunAvatar size={34} />
        <div className="bosun-card__titles">
          <div className="bosun-card__title">Smart Assistant</div>
          <div className="bosun-card__sub">Our AI Bosun is ready to help</div>
        </div>
        <button className="bosun-card__x" onClick={() => setOpen(false)} aria-label="Minimise">–</button>
      </div>

      <div className="bosun-card__body">
        <p className="bosun-card__hint">
          Save the effort — just paste the {mode === "vessel" ? "position circular" : "cargo circular"} below.
          The Bosun reads it and fills the form for you to review.
        </p>

        <textarea
          className="bosun-card__ta"
          placeholder={
            mode === "vessel"
              ? "e.g.\nMV ABC OPEN JEBEL ALI 12-15 APR\n28,000 DWT / 2009 BLT\nGEARED 4x30T\nlast: clinker"
              : "e.g.\nACCT: 8/10,000 MT Wheat in bulk\nNovorossiysk / Damietta\n14-18 April\nFIOST, 2.5% comm\nfrt idea USD 28/mt"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <button
          className="pc-btn pc-btn--primary"
          style={{ width: "100%", justifyContent: "center" }}
          disabled={busy || !text.trim()}
          onClick={runText}
        >
          {busy ? "Reading…" : "Read & fill →"}
        </button>

        {mode === "vessel" && (
          <>
            <div className="bosun-card__or"><span>or</span></div>
            <button
              type="button"
              className="bosun-drop"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <span className="bosun-drop__title">📄 Upload a Q88 (PDF)</span>
              <span className="bosun-drop__sub">{fileName ?? "the market-standard vessel questionnaire"}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
            />
          </>
        )}

        {applied != null && (
          <div className="pc-success" style={{ marginTop: 4 }}>
            <span>✓</span> {applied} fields applied. Review before submitting.
          </div>
        )}
        {note && <div className="bosun-card__note">{note}</div>}
        {warnings.length > 0 && (
          <ul className="bosun-card__warn">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
