"use client";

// Intake → Circulation inbox. Streams live progress from POST /api/sync/email
// (Server-Sent Events) into a log panel, then opens the resulting review batch.
// Also offers a dry run against a pasted email so the classifier can be
// validated without live credentials.
//
// The transport, watermark handling and event parsing are unchanged; only the
// shell is the design's ChannelCard.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail, Play, FlaskConical, ChevronDown, RotateCcw } from "lucide-react";
import { getSyncWatermarks } from "@/app/(admin)/admin/data-sync/settings-actions";
import { ChannelCard, SamplePanel, RunLog } from "./ChannelCard";
import { Btn, C, relTime } from "./ui";

// datetime-local wants local wall time without the zone
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

import type { SyncEvent } from "@/lib/sync/email/types";
type Evt = SyncEvent;

export function EmailSyncCard({ onDone, enabled, onEvent, nextRun }: {
  onDone: (batchId: string) => void;
  /** Whether an IMAP config exists and is switched on (from Connections). */
  enabled: boolean | null;
  /** Every streamed event, so the Intake run panel can draw the run. */
  onEvent?: (e: SyncEvent | { type: "start"; title: string } | { type: "finish" }) => void;
  /** "Tonight 02:00 · nightly" when the cron is armed, else "On demand". */
  nextRun?: string;
}) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [showSample, setShowSample] = useState(false);
  const [sample, setSample] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  // Start point for the fetch. Default = the last SUCCESSFUL sync (a failed
  // run never moves it); the admin can move it back to re-read older mail.
  const [watermark, setWatermark] = useState<string | null>(null);
  const [since, setSince] = useState("");
  const loadWatermark = async () => { const r = await getSyncWatermarks(); if (r.success) { setWatermark(r.data.email); setSince(toLocalInput(r.data.email)); } };
  useEffect(() => { void loadWatermark(); }, []);
  const sinceIso = since ? new Date(since).toISOString() : null;
  const sinceChanged = (sinceIso ?? "") !== (watermark ? new Date(watermark).toISOString() : "");

  const append = (line: string) => {
    setLog((l) => [...l, line]);
    requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; });
  };

  const run = async (body: Record<string, unknown>) => {
    if (running) return;
    setRunning(true);
    setLog([]);
    onEvent?.({ type: "start", title: body.sample ? "Dry run · pasted email" : "Circulation inbox · sync" });
    try {
      const res = await fetch("/api/sync/email", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: Evt;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          onEvent?.(evt);
          if (evt.type === "log") append(evt.msg);
          else if (evt.type === "error") { append(`✗ ${evt.error}`); toast.error(evt.error); }
          else if (evt.type === "empty") { append(`• ${evt.message}`); toast.message(evt.message); }
          else if (evt.type === "skipped") { append(`• ${evt.message}`); toast.message(evt.message); }
          else if (evt.type === "done") {
            append(`✓ staged ${evt.totals.new + evt.totals.updated} record(s)`);
            toast.success(`Staged ${evt.totals.new + evt.totals.updated} record(s) for review.`);
            onDone(evt.batchId);
          }
        }
      }
      await loadWatermark();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Email sync failed.";
      append(`✗ ${msg}`);
      onEvent?.({ type: "error", error: msg });
      toast.error(msg);
    } finally {
      setRunning(false);
      onEvent?.({ type: "finish" });
    }
  };

  return (
    <ChannelCard
      abbr="IMAP"
      icon={<Mail size={19} />}
      iconBg="var(--asb-green-bg)"
      iconColor="var(--asb-green)"
      name="Circulation inbox"
      status={running ? "Running" : enabled === null ? "Checking" : enabled ? "Connected" : "Disabled"}
      statusTone={running ? "updated" : enabled === null ? "neutral" : enabled ? "new" : "invalid"}
      desc="Broker circulars fetched and classified locally through the active LLM key into a review batch."
      last={watermark ? `${relTime(watermark)} · ${new Date(watermark).toLocaleString()}` : "No successful sync yet (default: last 7 days)"}
      next={nextRun ?? "On demand"}
      actions={
        <>
          <Btn
            kind="accent" icon={<Play size={15} />} busy={running}
            title="Fetches mail since the last successful run"
            onClick={() => run({ limit: 25, since: sinceChanged ? sinceIso : undefined })}
          >
            Sync now
          </Btn>
          <Btn
            kind="ghost" disabled={running} onClick={() => setShowSample((v) => !v)}
            icon={<FlaskConical size={14} />}
          >
            Test with a pasted email
            <ChevronDown size={13} style={{ transform: showSample ? "rotate(180deg)" : "none", transition: "transform var(--t-fast) var(--ease)" }} />
          </Btn>
        </>
      }
      footer={
        <div className="ds-note">
          A run whose classification fails never moves the start point.
        </div>
      }
    >
      {/* start point — the window the next run reads */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: C.ink3 }}>
        <label htmlFor="email-since" style={{ fontWeight: 600, color: C.ink }}>Fetch mail since</label>
        <input
          id="email-since" type="datetime-local" value={since} disabled={running}
          onChange={(e) => setSince(e.target.value)}
          className="ds-input"
          style={{ width: "auto", fontSize: 12.5, borderColor: sinceChanged ? C.brass : undefined }}
        />
        {sinceChanged && (
          <Btn size="sm" kind="ghost" disabled={running} icon={<RotateCcw size={12} />}
            title="Back to the last successful sync"
            onClick={() => setSince(toLocalInput(watermark))}>
            Reset
          </Btn>
        )}
      </div>

      {showSample && (
        <SamplePanel
          value={sample} onChange={setSample} rows={5}
          placeholder="Paste a circulation email here to classify it without connecting to the inbox…"
          action={
            <Btn kind="primary" busy={running} disabled={!sample.trim()}
              icon={<FlaskConical size={15} />} onClick={() => run({ sample })}>
              Classify sample
            </Btn>
          }
        />
      )}

      {!onEvent && <RunLog lines={log} innerRef={logRef} max={210} />}
    </ChannelCard>
  );
}
