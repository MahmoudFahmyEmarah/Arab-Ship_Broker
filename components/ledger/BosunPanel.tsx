"use client";

// Broker Ledger — corner AI assistant (Foreman on Post Cargo, Bosun on Post
// Vessel). The FAB/panel chrome is ported from the Concept 4 shells
// (reference/handoff/asb/post-cargo2.jsx / post-position2.jsx); the mock regex
// extractor is replaced by the real parser service (/api/circulars/parse,
// same endpoint SmartParser uses). Extracted fields are shown for review and
// applied only on explicit confirmation — never silently.

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { OFF_TOPIC_WARNING, type CircularParseResult, type ParsedCargo, type ParsedVessel } from "@/lib/circulars/types";
import { Icon } from "./ds";
import type { CargoState } from "./cargo/state";
import type { VesselState } from "./vessel/state";
import { cargoExToPatch, cargoExRows } from "./cargo/exToPatch";
import { vesselExToPatch, vesselExRows } from "./vessel/exToPatch";

const ASSISTANT_ENABLED = process.env.NEXT_PUBLIC_ASSISTANT_ENABLED === "true";

const SendSVG = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12 L20 5 L14 20 L11 13 Z" />
  </svg>
);

// The assistant wears the page's own identity glyph (ASB DS icon set):
// Foreman = Cargo on Post Cargo, Bosun = Vessel on Post Vessel.
const PersonaIcon = ({ mode, size = 20 }: { mode: Mode; size?: number }) => (
  <Icon name={mode === "cargo" ? "Cargo" : "Vessel"} size={size} />
);

interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "extract";
  text?: string;
  rows?: { label: string; value: string }[];
  extract?: ParsedCargo & ParsedVessel;
}

type Mode = "cargo" | "vessel";

const PERSONA: Record<Mode, { name: string; role: string; greet: string; sample: string }> = {
  cargo: {
    name: "Foreman AI",
    role: "Smart Assistant",
    greet: "Ahoy, I'm Foreman. Paste a cargo circular below — or attach one — and I'll read it and fill the form for you to check.",
    sample: "12,500 MT +/- 10% BAGGED SUGAR\nLOAD 1SB SANTOS / DISCH 1SB LAGOS\nLAYCAN 10-20 SEP\nFRT IDEA USD 45/MT FIOST, 3.75% TTL COMM",
  },
  vessel: {
    name: "Bosun AI",
    role: "Smart Assistant",
    greet: "Ahoy, I'm Bosun. Paste a position circular or Q88 text below — or attach the Q88 as PDF/Excel — and I'll read her particulars and fill the form for you to check.",
    sample: "MV GULF TRADER - IMO 9235945\nGEARED BULK CARRIER 28,000 DWT BLT 2006 PANAMA FLAG\n4 HO / 4 HA - CR 2 X 30 T\nOPEN JEDDAH 05-10 AUG - INT RED SEA / EAST MED",
  },
};

// Canonical media type by extension (browsers often report '' for .xlsx).
const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

const AttachSVG = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5 L12.5 20 a5.5 5.5 0 0 1 -7.8 -7.8 L13.2 3.7 a3.7 3.7 0 0 1 5.2 5.2 L9.9 17.4 a1.9 1.9 0 0 1 -2.7 -2.7 L15.6 6.3" />
  </svg>
);

let msgSeq = 0;
const nextId = () => "m" + ++msgSeq;

function AssistantPanel({
  mode,
  onApply,
}: {
  mode: Mode;
  onApply: (extract: ParsedCargo & ParsedVessel) => void;
}) {
  const persona = PERSONA[mode];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: nextId(), role: "bot", kind: "text", text: persona.greet },
  ]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const push = (m: Omit<Message, "id">) => setMessages((list) => [...list, { ...m, id: nextId() }]);

  const runParse = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/circulars/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        push({
          role: "bot",
          kind: "text",
          text:
            res.status === 503
              ? "I'm not switched on yet — please fill the form manually for now."
              : res.status === 401
                ? "Please sign in so I can help."
                : res.status === 415 || res.status === 413
                  ? "I can't read that — please attach the Q88 as PDF or Excel, or paste the text."
                  : `I'm unavailable right now (${res.status}) — please try again.`,
        });
        return;
      }
      const result = (await res.json()) as CircularParseResult;
      // Hard scope lock: off-topic input gets the fixed refusal, nothing else.
      if (result.kind === "unknown" && result.warnings?.some((w) => w.startsWith("OFF_TOPIC"))) {
        push({ role: "bot", kind: "text", text: OFF_TOPIC_WARNING.replace(/^OFF_TOPIC:\s*/, "") });
        return;
      }
      const rows = mode === "cargo" ? cargoExRows(result.extracted) : vesselExRows(result.extracted);
      if (!rows.length) {
        push({ role: "bot", kind: "text", text: "I couldn't pick out any fields from that — try pasting the full circular text." });
        return;
      }
      push({ role: "bot", kind: "extract", rows, extract: result.extracted });
      if (result.warnings?.length) {
        push({ role: "bot", kind: "text", text: "Note: " + result.warnings.join(" · ") });
      }
    } catch {
      push({ role: "bot", kind: "text", text: "I couldn't be reached — please try again." });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push({ role: "user", kind: "text", text });
    await runParse({ text });
  };

  const onFile = async (file: File) => {
    if (busy) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mediaType = FILE_TYPES[ext];
    if (!mediaType) {
      push({ role: "bot", kind: "text", text: "Please attach the Q88 as a PDF or Excel (.pdf, .xlsx, .xls) file." });
      return;
    }
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    push({ role: "user", kind: "text", text: `📎 ${file.name}` });
    const extra = input.trim();
    if (extra) setInput("");
    await runParse({ fileBase64: base64, fileMediaType: mediaType, ...(extra ? { text: extra } : {}) });
  };

  if (!ASSISTANT_ENABLED) return null;

  if (!open) {
    return (
      <button className="pp2-fab" type="button" onClick={() => setOpen(true)} aria-label={`Open ${persona.name} assistant`}>
        <span className="pp2-fab__ic">
          <PersonaIcon mode={mode} />
        </span>
        <span className="pp2-fab__label">
          <b>Ask {persona.name.replace(" AI", "")}</b>
          <span>{persona.role}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="pp2-agent" role="dialog" aria-label={`${persona.name} assistant`}>
      <div className="pp2-agent__head">
        <span className="pp2-agent__ava">
          <PersonaIcon mode={mode} />
        </span>
        <div className="pp2-agent__id">
          <div className="pp2-agent__name">{persona.name}</div>
          <div className="pp2-agent__role">{persona.role}</div>
        </div>
        <button className="pp2-agent__x" type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
          ×
        </button>
      </div>
      <div className="pp2-agent__body" ref={listRef}>
        {messages.map((m) =>
          m.kind === "extract" ? (
            <div className="pp2-agent__msg pp2-agent__msg--bosun pp2-agent__msg--extract" key={m.id}>
              <div className="pp2-agent__extract">
                {m.rows!.map((r, i) => (
                  <div className="pp2-agent__xrow" key={i}>
                    <span className="pp2-agent__xk">{r.label}</span>
                    <span className="pp2-agent__xv">{r.value}</span>
                  </div>
                ))}
              </div>
              <button
                className="pp2-agent__apply"
                type="button"
                onClick={() => {
                  onApply(m.extract!);
                  push({ role: "bot", kind: "text", text: "Applied. Check each section and adjust anything I misread." });
                }}
              >
                Apply to form
              </button>
            </div>
          ) : (
            <div className={"pp2-agent__msg" + (m.role === "bot" ? " pp2-agent__msg--bosun" : " pp2-agent__msg--user")} key={m.id}>
              {m.text}
            </div>
          ),
        )}
        {busy ? <div className="pp2-agent__msg pp2-agent__msg--bosun">Reading…</div> : null}
        <button
          className="pp2-agent__chip pp2-agent__chip--link"
          type="button"
          onClick={() => {
            setInput(persona.sample);
            inputRef.current?.focus();
          }}
        >
          Try a sample
        </button>
      </div>
      <div className="pp2-agent__foot">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
        <button
          className="pp2-agent__send"
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Attach a Q88 or circular (PDF / Excel)"
          title="Attach a Q88 or circular (PDF / Excel)"
        >
          <AttachSVG />
        </button>
        <textarea
          ref={inputRef}
          className="pp2-agent__input"
          rows={3}
          value={input}
          placeholder={mode === "cargo" ? "Paste a cargo circular…" : "Paste a position circular or Q88 text…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="pp2-agent__send" type="button" onClick={send} disabled={busy || !input.trim()} aria-label="Send">
          <SendSVG />
        </button>
      </div>
    </div>
  );
}

export function ForemanPanel({
  onApplyCargo,
}: {
  mode: "cargo";
  onApplyCargo: (p: Partial<CargoState> | ((s: CargoState) => Partial<CargoState>), msg?: string) => void;
}) {
  return <AssistantPanel mode="cargo" onApply={(ex) => onApplyCargo((s) => cargoExToPatch(ex, s), "Applied from circular")} />;
}

export function BosunVesselPanel({
  onApplyVessel,
}: {
  onApplyVessel: (p: Partial<VesselState> | ((s: VesselState) => Partial<VesselState>), msg?: string) => void;
}) {
  return <AssistantPanel mode="vessel" onApply={(ex) => onApplyVessel((s) => vesselExToPatch(ex, s), "Applied from circular")} />;
}
