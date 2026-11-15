"use client";

// Intake → Circulation inbox. Streams live progress from POST /api/sync/email
// (Server-Sent Events) into a log panel, then opens the resulting review batch.
// Also offers a dry run against a pasted email so the classifier can be
// validated without live credentials.
//
// The transport, watermark handling and event parsing are unchanged; only the
// shell is the design's ChannelCard.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail, Play, FlaskConical, ChevronDown, RotateCcw } from "lucide-react";
import { getSyncWatermarks } from "@/app/(admin)/admin/data-sync/settings-actions";
import { ChannelCard, SamplePanel, RunLog } from "./ChannelCard";
import { Btn, C, relTime } from "./ui";
import { CEILING_MESSAGE, CLIENT_CEILING_MS, boxFor, pointAfterRun, runErrorText, startPointChanged, startPointToSend, toLocalInput } from "@/lib/sync/email/start-point";

import type { SyncEvent } from "@/lib/sync/email/types";
type Evt = SyncEvent;

export function EmailSyncCard({ onDone, enabled, onEvent, nextRun, resumeFrom, onResume, running, onRunning }: {
  onDone: (batchId: string) => void;
  /** Where a stopped backfill continues from (ISO), held by the page: this card unmounts when a run opens its batch. */
  resumeFrom: string | null;
  /** Hold (or clear, with null) that point. */
  onResume: (iso: string | null) => void;
  /** Whether an inbox run is streaming, held by the page: a card mounted again mid-run stays busy (B2O-132 P2-2). */
  running: boolean;
  onRunning: (running: boolean) => void;
  /** Whether an IMAP config exists and is switched on (from Connections). */
  enabled: boolean | null;
  /** Every streamed event, so the Intake run panel can draw the run. */
  onEvent?: (e: SyncEvent | { type: "start"; title: string } | { type: "finish" }) => void;
  /** "Tonight 02:00 · nightly" when the cron is armed, else "On demand". */
  nextRun?: string;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [showSample, setShowSample] = useState(false);
  const [sample, setSample] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  // Start point for the fetch. Default = the last SUCCESSFUL sync (a failed
  // run never moves it); the admin can move it back to re-read older mail.
  const [watermark, setWatermark] = useState<string | null>(null);
  const [since, setSince] = useState(() => boxFor(resumeFrom, null));
  // A stopped backfill's point outlives this card (held by the page) and wins over the checkpoint when the box is
  // filled: on mount, and after a run that handed one back (B2O-131 P1-2). Kept in a ref for the async reload.
  const resume = useRef<string | null>(resumeFrom);
  const holdResume = (iso: string | null) => { resume.current = iso; onResume(iso); };
  // Follow the page's point while mounted, to a new point AND to "cleared": a card shown again mid-run receives what
  // the earlier instance's run does with the page's point (B2O-132 P2-2, B2O-133 P2). The box changes during render
  // (React's pattern for state that follows a prop); the ref follows in a layout effect, which runs before any async
  // continuation (a reload) can read it (B2O-133 P3).
  const [shownResume, setShownResume] = useState(resumeFrom);
  if (resumeFrom !== shownResume) {
    setShownResume(resumeFrom);
    setSince(boxFor(resumeFrom, watermark));
  }
  useLayoutEffect(() => { resume.current = resumeFrom; }, [resumeFrom]);
  const loadWatermark = async () => { const r = await getSyncWatermarks(); if (r.success) { setWatermark(r.data.email); setSince(boxFor(resume.current, r.data.email)); } };
  useEffect(() => { void loadWatermark(); }, []);
  // judged in the box's own form (local wall time, to the minute): an untouched box is never a backfill (B2O-131 P1-1);
  // a held point always shows the border and Reset, even in the checkpoint's own minute (B2O-132 P3)
  const sinceChanged = resumeFrom != null || startPointChanged(since, watermark);

  const append = (line: string) => {
    setLog((l) => [...l, line]);
    requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; });
  };

  const run = async (body: Record<string, unknown>) => {
    if (running) return;
    onRunning(true);
    setLog([]);
    onEvent?.({ type: "start", title: body.sample ? "Dry run · pasted email" : "Circulation inbox · sync" });
    let resumed = false;   // the run handed back where a backfill stopped
    let settled = false;   // a terminal event arrived (done / empty / skipped / error)
    // An inbox run that handed back no point, however it ended — a clean stream end, or a cut that surfaces as a
    // throw (B2O-133 P3): settled → nothing to continue; cut → the point it was sent is held again.
    const settlePoint = () => {
      if (body.sample || resumed) return;
      const next = pointAfterRun({ settled, sentSince: typeof body.since === "string" ? body.since : undefined });
      // a clear also refills the box: with no point held before, the prop stays null and the render-phase refill does
      // not fire, so a typed date would linger (B2O-134 P3)
      if (next === "clear") { holdResume(null); setSince(boxFor(null, watermark)); }
      else if (next !== "keep") holdResume(next.hold);
    };
    // A request that never settles would keep this card, and any card shown later (the page holds `running`), busy
    // until a reload. The route stops at 300 s, so the card gives up a little after that (B2O-133 P3).
    const ceiling = new AbortController();
    const timer = setTimeout(() => ceiling.abort(new Error(CEILING_MESSAGE)), CLIENT_CEILING_MS);
    try {
      const res = await fetch("/api/sync/email", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ceiling.signal,
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
          if (evt.type === "done" || evt.type === "empty" || evt.type === "skipped" || evt.type === "error") settled = true;
          if (evt.type === "log") append(evt.msg);
          else if (evt.type === "error") { append(`✗ ${evt.error}`); toast.error(evt.error); }
          else if (evt.type === "empty") { append(`• ${evt.message}`); toast.message(evt.message); }
          else if (evt.type === "skipped") { append(`• ${evt.message}`); toast.message(evt.message); }
          else if (evt.type === "resume") { resumed = true; holdResume(evt.since); setSince(toLocalInput(evt.since)); }
          else if (evt.type === "done") {
            append(`✓ staged ${evt.totals.new + evt.totals.updated} record(s)`);
            toast.success(`Staged ${evt.totals.new + evt.totals.updated} record(s) for review.`);
            onDone(evt.batchId);
          }
        }
      }
      settlePoint();
      await loadWatermark();
    } catch (e) {
      settlePoint();
      const msg = runErrorText(e, ceiling.signal.aborted);
      append(`✗ ${msg}`);
      onEvent?.({ type: "error", error: msg });
      toast.error(msg);
    } finally {
      clearTimeout(timer);
      onRunning(false);
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
            onClick={() => run({ limit: 25, since: startPointToSend(since, watermark, resume.current) })}
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
            onClick={() => { holdResume(null); setSince(toLocalInput(watermark)); }}>
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
