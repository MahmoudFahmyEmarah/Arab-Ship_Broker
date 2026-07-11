"use client";

// Sync Workspace → WhatsApp intake card: sweep controls + a pasted-message dry
// run. Messages are NOT listed inline — the "Inbox" button opens a WhatsApp-
// styled popup where relevant messages can be reviewed, deleted, or cleared.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageCircle, Loader2, RefreshCcw, FlaskConical, ChevronDown, Play, Inbox, Trash2, X,
} from "lucide-react";
import {
  listWhatsappMessages, processWhatsapp, simulateWhatsapp, getBatch,
  deleteWhatsappMessage, clearWhatsappInbox,
  type WhatsappMessageRow, type BatchMeta,
} from "@/app/(admin)/admin/data-sync/actions";
import { C, btn } from "./ui";

const WA = { header: "#075e54", bg: "#e5ddd5", bubble: "#ffffff", meta: "#667781", accent: "#25d366" };

const STATUS_META: Record<string, { c: string; bg: string }> = {
  pending: { c: "#a9761a", bg: "#f6e9cf" },
  staged: { c: "#2f7d52", bg: "#e4f1ea" },
  failed: { c: "#b23b3b", bg: "#f8e0e0" },
};

export function WhatsappCard({ onOpenBatch }: { onOpenBatch: (b: BatchMeta) => void }) {
  const [rows, setRows] = useState<WhatsappMessageRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [sample, setSample] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);

  const reload = useCallback(async () => {
    const r = await listWhatsappMessages(30);
    if (r.success) setRows(r.data);
  }, []);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reload(); })(); return () => { c = true; }; }, [reload]);

  const sweep = async (includeFailed: boolean) => {
    setBusy("sweep");
    const r = await processWhatsapp(includeFailed);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    setLog(r.data.log);
    toast.success(`Processed ${r.data.processed} · staged ${r.data.staged}${r.data.failed ? ` · ${r.data.failed} failed` : ""}`);
    await reload();
  };

  const simulate = async () => {
    setBusy("sim");
    const r = await simulateWhatsapp(sample);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    setLog(r.data.log);
    toast.success("Sample classified — open the Inbox or Review.");
    setSample("");
    await reload();
  };

  const failedCount = rows?.filter((r) => r.status === "failed").length ?? 0;
  const pendingCount = rows?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "22px 24px", background: C.card }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <span style={{ width: 40, height: 40, borderRadius: 9, background: "#e7f6ee", color: "#1f8a4c", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <MessageCircle size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: C.navy }}>WhatsApp intake</div>
          <div style={{ fontSize: 13, color: C.ink3, marginTop: 3, lineHeight: 1.45 }}>
            Inbound broker messages classify automatically into review batches, with an instant acknowledgment reply. Configure in Settings.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={() => setInboxOpen(true)} style={btn("primary")}>
          <Inbox size={14} /> Inbox{rows?.length ? ` (${rows.length})` : ""}
        </button>
        <button onClick={() => sweep(false)} disabled={!!busy} style={btn("dark")} title="Classify any pending messages">
          {busy === "sweep" ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={14} />} Process pending{pendingCount ? ` (${pendingCount})` : ""}
        </button>
        {failedCount > 0 && (
          <button onClick={() => sweep(true)} disabled={!!busy} style={btn("danger")}>
            <RefreshCcw size={14} /> Retry failed ({failedCount})
          </button>
        )}
        <button onClick={() => setShowSample((s) => !s)} disabled={!!busy} style={btn("ghost")}>
          <FlaskConical size={14} /> Test with a pasted message
          <ChevronDown size={13} style={{ transform: showSample ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>
      </div>

      {showSample && (
        <div style={{ marginTop: 14 }}>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={4}
            placeholder="Paste a WhatsApp circulation message here — classified without any WhatsApp connection…"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13, resize: "vertical", background: "#fff", color: C.ink }} />
          <button onClick={simulate} disabled={!!busy || !sample.trim()} style={{ ...btn("primary"), marginTop: 8, opacity: busy || !sample.trim() ? 0.5 : 1 }}>
            {busy === "sim" ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <FlaskConical size={15} />} Classify sample
          </button>
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 14, maxHeight: 120, overflowY: "auto", background: C.navy, color: "#cfe0d6", borderRadius: 8, padding: "10px 14px", fontFamily: C.mono, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {log.map((l, i) => <div key={i} style={{ color: l.startsWith("✗") ? "#f0b4b4" : l.startsWith("✓") ? "#9fe0b8" : "#cfe0d6" }}>{l}</div>)}
        </div>
      )}

      {inboxOpen && (
        <WhatsappInbox rows={rows ?? []} onClose={() => setInboxOpen(false)} onChanged={reload} onOpenBatch={onOpenBatch} />
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── the WhatsApp-styled inbox popup ─────────────────────────────────────────
function WhatsappInbox({ rows, onClose, onChanged, onOpenBatch }: {
  rows: WhatsappMessageRow[]; onClose: () => void; onChanged: () => Promise<void>; onOpenBatch: (b: BatchMeta) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const remove = async (id: string) => {
    setBusy(id);
    const r = await deleteWhatsappMessage(id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    await onChanged();
  };

  const clearAll = async () => {
    if (!confirm("Clear the whole WhatsApp inbox? Review batches and synced data are NOT affected.")) return;
    setBusy("clear");
    const r = await clearWhatsappInbox();
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Inbox cleared (${r.data.deleted} message${r.data.deleted === 1 ? "" : "s"}).`);
    await onChanged();
  };

  const openBatch = async (batchId: string) => {
    const m = await getBatch(batchId);
    if (m.success && m.data) { onClose(); onOpenBatch(m.data); }
    else toast.error("Could not open the batch.");
  };

  return (
    <div ref={ref} onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.4)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ width: "min(560px, 96vw)", height: "min(680px, 92vh)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
        {/* WhatsApp-style header */}
        <div style={{ background: WA.header, color: "#fff", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: WA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MessageCircle size={19} color="#fff" />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Circulation inbox</div>
            <div style={{ fontSize: 11.5, opacity: 0.85 }}>{rows.length} relevant message{rows.length === 1 ? "" : "s"} · personal chats are never stored</div>
          </div>
          <button onClick={clearAll} disabled={busy === "clear" || rows.length === 0}
            title="Clear all messages"
            style={{ border: "1px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", borderRadius: 7, padding: "6px 10px", cursor: "pointer", font: "inherit", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, opacity: rows.length ? 1 : 0.5 }}>
            {busy === "clear" ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={13} />} Clear all
          </button>
          <button onClick={onClose} aria-label="Close"
            style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", padding: 4 }}><X size={19} /></button>
        </div>

        {/* chat area */}
        <div style={{ flex: 1, overflowY: "auto", background: WA.bg, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: WA.meta, fontSize: 13.5, background: "rgba(255,255,255,.8)", borderRadius: 10, padding: "18px 22px" }}>
              No messages — the inbox is clean.
            </div>
          ) : rows.map((r) => {
            const sm = STATUS_META[r.status] ?? STATUS_META.pending;
            return (
              <div key={r.id} style={{ background: WA.bubble, borderRadius: "0 10px 10px 10px", padding: "9px 12px", maxWidth: "88%", boxShadow: "0 1px 1px rgba(0,0,0,.08)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: WA.header }}>{r.contact_name ?? r.wa_from.replace(/@.*/, "")}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: sm.c, background: sm.bg, padding: "1px 6px", borderRadius: 3, textTransform: "uppercase" }}>{r.status}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: WA.meta }}>{new Date(r.received_at).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 13, color: "#111b21", margin: "6px 0 4px", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 110, overflowY: "auto" }}>
                  {r.body}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: WA.meta }}>
                  {r.status === "staged" && <span>{r.staged_cargo} cargo · {r.staged_vessels} vessel · ack {r.ack_status}</span>}
                  {r.status === "failed" && r.error && <span style={{ color: "#b23b3b" }}>{r.error.slice(0, 60)}</span>}
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                    {r.batch_id && (
                      <button onClick={() => openBatch(r.batch_id!)}
                        style={{ border: "none", background: "transparent", color: WA.header, cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 700, padding: 2 }}>
                        Review ↗
                      </button>
                    )}
                    <button onClick={() => remove(r.id)} disabled={busy === r.id} title="Delete message"
                      style={{ border: "none", background: "transparent", color: "#b23b3b", cursor: "pointer", padding: 2, display: "inline-flex" }}>
                      {busy === r.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={13} />}
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
