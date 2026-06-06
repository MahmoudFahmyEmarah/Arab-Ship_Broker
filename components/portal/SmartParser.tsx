"use client";

// Bosun AI — the floating Smart Assistant. A chat-style AI-agent widget on the
// Post Cargo and Post Vessel forms: paste a circular (or, for a vessel, upload a
// Q88) and it reads it and fills the form for the user to review.
//
// COMMERCIAL GATE: the full extraction runs on the server via Claude
// (/api/circulars/parse) — a paid capability. The whole structure is built and
// ready, but it stays in a "Coming soon" marketing state until it's switched on
// by setting NEXT_PUBLIC_ASSISTANT_ENABLED=true (and the server ANTHROPIC_API_KEY).
// Flip the flag to go live — no code change needed.
import * as React from "react";
import type { CircularParseResult } from "@/lib/circulars/types";

// Switched on commercially via env; defaults to the "coming soon" teaser.
const ASSISTANT_ENABLED = process.env.NEXT_PUBLIC_ASSISTANT_ENABLED === "true";

// Classy line-art bosun (peaked cap + old-salt profile) — not a cartoon.
function BosunAvatar({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="var(--asb-navy, #0B1F3A)" />
      <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M13 20c1.5-5 6-8 11-8s9.5 3 11 8" />
        <path d="M12 20h24" />
        <path d="M16 20c0-2.6 3.6-4 8-4s8 1.4 8 4" />
        <path d="M24 13.6v3.2M22.6 15.1h2.8M24 17a1 1 0 100-2 1 1 0 000 2Z" strokeWidth="1.2" />
        <path d="M17 21v3a7 7 0 007 7 7 7 0 007-7v-3" />
        <path d="M18.5 30c1.2 3.2 3.1 5 5.5 5s4.3-1.8 5.5-5" />
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
    const h = el?.offsetHeight ?? 460;
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
    if (window.innerWidth < 640) return;
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
    setApplied(null);
    setNote(
      res.status === 503
        ? "I'm not switched on yet — please fill the form manually for now."
        : res.status === 401
          ? "Please sign in so I can help."
          : res.status === 415 || res.status === 413
            ? "I can't read that file — please paste the text instead."
            : `I'm unavailable right now (${res.status}) — please try again.`,
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
      setApplied(null);
      setNote("I couldn't be reached — please try again.");
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

  // ── Collapsed: round agent bubble ──
  if (!open) {
    return (
      <button
        className="bosun-fab"
        onClick={() => setOpen(true)}
        title="Bosun AI — Smart Assistant"
        aria-label="Open Bosun AI assistant"
      >
        <BosunAvatar size={30} />
        <span className={`bosun-fab__dot ${ASSISTANT_ENABLED ? "is-on" : "is-soon"}`} />
      </button>
    );
  }

  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  const greeting =
    mode === "vessel"
      ? "Ahoy! Paste a position circular or upload the vessel's Q88 — I'll read it and fill the form for you to check."
      : "Ahoy! Paste a cargo circular and I'll read it and fill the form for you to check.";

  return (
    <div ref={cardRef} className="bosun-card" style={style} role="dialog" aria-label="Bosun AI assistant">
      {/* Header (drag handle) */}
      <div
        className="bosun-card__head"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <div className="bosun-card__id">
          <span className="bosun-card__ava"><BosunAvatar size={34} /></span>
          <div className="bosun-card__titles">
            <div className="bosun-card__title">Bosun AI</div>
            <div className="bosun-card__status">
              <span className={`bosun-card__sdot ${ASSISTANT_ENABLED ? "is-on" : "is-soon"}`} />
              {ASSISTANT_ENABLED ? "Smart Assistant · online" : "Smart Assistant · coming soon"}
            </div>
          </div>
        </div>
        <button className="bosun-card__x" onClick={() => setOpen(false)} aria-label="Minimise">–</button>
      </div>

      {/* Chat transcript */}
      <div className="bosun-chat">
        <div className="bosun-msg">
          <span className="bosun-msg__ava"><BosunAvatar size={22} /></span>
          <div className="bosun-msg__bubble">{greeting}</div>
        </div>

        {!ASSISTANT_ENABLED && (
          <div className="bosun-msg">
            <span className="bosun-msg__ava"><BosunAvatar size={22} /></span>
            <div className="bosun-msg__bubble">
              <span className="bosun-soon-pill">Coming soon</span>
              <p style={{ margin: "6px 0 0" }}>
                I&apos;m being fitted out — soon I&apos;ll turn a pasted circular or a Q88 into a
                ready-to-review {mode === "vessel" ? "position" : "cargo"} in seconds. For now,
                please fill the form below.
              </p>
            </div>
          </div>
        )}

        {applied != null && (
          <div className="bosun-msg">
            <span className="bosun-msg__ava"><BosunAvatar size={22} /></span>
            <div className="bosun-msg__bubble is-ok">✓ Filled {applied} field{applied === 1 ? "" : "s"} — please review before submitting.</div>
          </div>
        )}
        {warnings.map((w, i) => (
          <div className="bosun-msg" key={i}>
            <span className="bosun-msg__ava"><BosunAvatar size={22} /></span>
            <div className="bosun-msg__bubble is-warn">⚠ {w}</div>
          </div>
        ))}
        {note && (
          <div className="bosun-msg">
            <span className="bosun-msg__ava"><BosunAvatar size={22} /></span>
            <div className="bosun-msg__bubble">{note}</div>
          </div>
        )}
      </div>

      {/* Composer */}
      {ASSISTANT_ENABLED ? (
        <div className="bosun-composer">
          {mode === "vessel" && (
            <>
              <button type="button" className="bosun-attach" onClick={() => fileRef.current?.click()} disabled={busy} title="Upload a Q88 (PDF)">
                📎 {fileName ?? "Q88 (PDF)"}
              </button>
              <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
            </>
          )}
          <textarea
            className="bosun-composer__ta"
            placeholder={mode === "vessel" ? "Paste a position circular…" : "Paste a cargo circular…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
          <button className="bosun-send" onClick={runText} disabled={busy || !text.trim()} aria-label="Send" title="Read & fill">
            {busy ? "…" : "➤"}
          </button>
        </div>
      ) : (
        <div className="bosun-composer is-disabled">
          <textarea className="bosun-composer__ta" placeholder="Paste a circular here once the Bosun is on watch…" disabled rows={2} />
          <button className="bosun-send" disabled aria-label="Coming soon">➤</button>
        </div>
      )}
    </div>
  );
}
