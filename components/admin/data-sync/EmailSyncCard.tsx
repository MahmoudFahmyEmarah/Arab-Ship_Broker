"use client";

// The circulation-inbox card in the Sync Workspace. Streams live progress from
// POST /api/sync/email (Server-Sent Events) into a log panel, then opens the
// resulting review batch. Also offers a dry run against a pasted email so the
// classifier can be validated without live credentials.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail, Loader2, Play, FlaskConical, ChevronDown, RotateCcw } from "lucide-react";
import { getSyncWatermarks } from "@/app/(admin)/admin/data-sync/settings-actions";
import { C, btn } from "./ui";

// datetime-local wants local wall time without the zone
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface DoneEvent { type: "done"; batchId: string; totals: { new: number; updated: number } }
type Evt =
  | { type: "log"; msg: string }
  | { type: "error"; error: string }
  | { type: "empty"; message: string }
  | DoneEvent;

export function EmailSyncCard({ onDone }: { onDone: (batchId: string) => void }) {
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
          if (evt.type === "log") append(evt.msg);
          else if (evt.type === "error") { append(`✗ ${evt.error}`); toast.error(evt.error); }
          else if (evt.type === "empty") { append(`• ${evt.message}`); toast.message(evt.message); }
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
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "22px 24px", background: C.card }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ width: 40, height: 40, borderRadius: 9, background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Mail size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: C.navy }}>Sync circulation inbox</div>
          <div style={{ fontSize: 13, color: C.ink3, marginTop: 3, lineHeight: 1.45 }}>
            Fetch recent circulars and classify them locally through the active LLM key into a review batch.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={() => run({ limit: 25, since: sinceChanged ? sinceIso : undefined })} disabled={running} style={btn("dark")}>
              {running ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={15} />} Sync now
            </button>
            <button onClick={() => setShowSample((s) => !s)} disabled={running} style={btn("ghost")}>
              <FlaskConical size={14} /> Test with a pasted email
              <ChevronDown size={13} style={{ transform: showSample ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: C.ink3 }}>
        <label htmlFor="email-since" style={{ fontWeight: 600, color: C.ink }}>Fetch mail since</label>
        <input id="email-since" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} disabled={running}
          style={{ padding: "5px 8px", borderRadius: 8, border: `1px solid ${sinceChanged ? C.brass : C.line}`, font: "inherit", fontSize: 12.5, background: "#fff", color: C.ink }} />
        {sinceChanged && (
          <button type="button" onClick={() => setSince(toLocalInput(watermark))} disabled={running} title="Back to the last successful sync" style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12 }}>
            <RotateCcw size={12} /> Reset
          </button>
        )}
        <span>
          {watermark ? `Last successful sync ${new Date(watermark).toLocaleString()}` : "No successful sync yet (default: last 7 days)"} · a run whose classification fails never moves this point.
        </span>
      </div>

      {showSample && (
        <div style={{ marginTop: 14 }}>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={5}
            placeholder="Paste a circulation email here to classify it without connecting to the inbox…"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13, resize: "vertical", background: "#fff", color: C.ink }} />
          <button onClick={() => run({ sample })} disabled={running || !sample.trim()}
            style={{ ...btn("primary"), marginTop: 8, opacity: running || !sample.trim() ? 0.5 : 1 }}>
            {running ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <FlaskConical size={15} />} Classify sample
          </button>
        </div>
      )}

      {log.length > 0 && (
        <div ref={logRef} style={{ marginTop: 16, maxHeight: 200, overflowY: "auto", background: C.navy, color: "#cfe0d6",
          borderRadius: 8, padding: "12px 14px", fontFamily: C.mono, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✗") ? "#f0b4b4" : l.startsWith("✓") ? "#9fe0b8" : "#cfe0d6" }}>{l}</div>
          ))}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
