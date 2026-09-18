"use client";

// Intake → WhatsApp intake card: sweep controls + a pasted-message dry run.
// Messages are NOT listed inline — the "Inbox" button opens a WhatsApp-styled
// popup where relevant messages can be reviewed, deleted, or cleared.
//
// Sweeping, simulation and inbox handling are unchanged; the card body is the
// design's ChannelCard so all three intake sources read alike.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageCircle, Loader2, RefreshCcw, FlaskConical, ChevronDown, Play, Inbox, Trash2, X,
} from "lucide-react";
import { ChannelCard, SamplePanel, RunLog } from "./ChannelCard";
import { Btn, relTime } from "./ui";
import {
  listWhatsappMessages, processWhatsapp, simulateWhatsapp, getBatch,
  deleteWhatsappMessage, clearWhatsappInbox,
  type WhatsappMessageRow, type BatchMeta,
} from "@/app/(admin)/admin/data-sync/actions";

const WA = { header: "#075e54", bg: "#e5ddd5", bubble: "#ffffff", meta: "#667781", accent: "#25d366" };

const STATUS_META: Record<string, { c: string; bg: string }> = {
  pending: { c: "var(--asb-amber)", bg: "var(--asb-amber-bg)" },
  staged: { c: "var(--asb-green)", bg: "var(--asb-green-bg)" },
  failed: { c: "var(--asb-red)", bg: "var(--asb-red-bg)" },
};

type Sweep = Awaited<ReturnType<typeof processWhatsapp>>;
export function WhatsappCard({ onOpenBatch, linked, onRun }: {
  onOpenBatch: (b: BatchMeta) => void;
  /** Worker pairing state from whatsapp_runtime, or null while it loads. */
  linked: boolean | null;
  /** Sweep lifecycle for the Intake run panel. */
  onRun?: (phase: "start" | "finish", title: string, result?: Sweep) => void;
}) {
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
    onRun?.("start", includeFailed ? "WhatsApp · retry failed" : "WhatsApp · process pending");
    const r = await processWhatsapp(includeFailed);
    setBusy(null);
    onRun?.("finish", "WhatsApp sweep", r);
    if (!r.success) { toast.error(r.error); return; }
    setLog(r.data.log);
    toast.success(`Processed ${r.data.processed} · staged ${r.data.staged}${r.data.failed ? ` · ${r.data.failed} failed` : ""}`);
    await reload();
  };

  const simulate = async () => {
    setBusy("sim");
    onRun?.("start", "Dry run · pasted WhatsApp message");
    const r = await simulateWhatsapp(sample);
    setBusy(null);
    onRun?.("finish", "WhatsApp dry run", r.success ? { success: true, data: { processed: 1, staged: 0, irrelevant: 0, failed: 0, log: r.data.log, steps: r.data.steps, usage: r.data.usage } } : r);
    if (!r.success) { toast.error(r.error); return; }
    setLog(r.data.log);
    toast.success("Sample classified — open the Inbox or Review.");
    setSample("");
    await reload();
  };

  const failedCount = rows?.filter((r) => r.status === "failed").length ?? 0;
  const pendingCount = rows?.filter((r) => r.status === "pending").length ?? 0;

  const lastSeen = rows?.[0]?.received_at ?? null;

  return (
    <>
      <ChannelCard
        abbr="WA"
        icon={<MessageCircle size={19} />}
        iconBg="var(--asb-blue-light)"
        iconColor="var(--asb-steel-deep)"
        name="WhatsApp intake"
        status={linked === null ? "Checking" : linked ? "Linked" : "Paused"}
        statusTone={linked === null ? "neutral" : linked ? "new" : "updated"}
        desc="Circulars from the linked number classify into review batches, with an instant acknowledgement reply."
        last={lastSeen ? `${relTime(lastSeen)} · ${rows?.length ?? 0} message${rows?.length === 1 ? "" : "s"} held` : "No messages received"}
        lastTone={!linked && pendingCount ? "var(--asb-amber)" : undefined}
        next={linked ? "Continuous" : pendingCount ? `Paused · ${pendingCount} queued` : "Paused"}
        actions={
          <>
            <Btn kind="accent" icon={<Play size={15} />} busy={busy === "sweep"} disabled={!!busy}
              title="Classify the queued messages into a batch"
              onClick={() => sweep(false)}>
              Process pending{pendingCount ? ` (${pendingCount})` : ""}
            </Btn>
            <Btn kind="ghost" icon={<Inbox size={14} />} onClick={() => setInboxOpen(true)}>
              Inbox{rows?.length ? ` (${rows.length})` : ""}
            </Btn>
            {failedCount > 0 && (
              <Btn kind="danger" icon={<RefreshCcw size={14} />} disabled={!!busy} onClick={() => sweep(true)}>
                Retry failed ({failedCount})
              </Btn>
            )}
            <Btn kind="ghost" icon={<FlaskConical size={14} />} disabled={!!busy}
              onClick={() => setShowSample((v) => !v)}>
              Test a message
              <ChevronDown size={13} style={{ transform: showSample ? "rotate(180deg)" : "none", transition: "transform var(--t-fast) var(--ease)" }} />
            </Btn>
          </>
        }
        footer={<div className="ds-note">Personal chats are never stored. Pair the number in Connections.</div>}
      >
        {showSample && (
          <SamplePanel
            value={sample} onChange={setSample}
            placeholder="Paste a WhatsApp circulation message here — classified without any WhatsApp connection…"
            action={
              <Btn kind="primary" busy={busy === "sim"} disabled={!!busy || !sample.trim()}
                icon={<FlaskConical size={15} />} onClick={simulate}>
                Classify sample
              </Btn>
            }
          />
        )}
        {!onRun && <RunLog lines={log} max={130} />}
      </ChannelCard>

      {inboxOpen && (
        <WhatsappInbox rows={rows ?? []} onClose={() => setInboxOpen(false)} onChanged={reload} onOpenBatch={onOpenBatch} />
      )}
    </>
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
                  {r.status === "failed" && r.error && <span style={{ color: "var(--asb-red)" }}>{r.error.slice(0, 60)}</span>}
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                    {r.batch_id && (
                      <button onClick={() => openBatch(r.batch_id!)}
                        style={{ border: "none", background: "transparent", color: WA.header, cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 700, padding: 2 }}>
                        Review ↗
                      </button>
                    )}
                    <button onClick={() => remove(r.id)} disabled={busy === r.id} title="Delete message"
                      style={{ border: "none", background: "transparent", color: "var(--asb-red)", cursor: "pointer", padding: 2, display: "inline-flex" }}>
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
