"use client";

// Intake → run panel. The design's five-step progress card, fed by the real
// `step` events the pipeline now emits (connect → fetch → classify → stage →
// gate) plus the streamed log, the metered token usage and the result figures.
// One panel serves both channels: the inbox streams events over SSE, the
// WhatsApp sweep returns its steps in one summary.

import { useEffect, useState } from "react";
import type { SyncStepKey, SyncStepState } from "@/lib/sync/email/types";
import { Badge, Btn, Card, C } from "./ui";
import { RunLog } from "./ChannelCard";

export interface RunTotals { new: number; updated: number; invalid: number; errors: number; gateBlocked?: number; queued?: number }

/** "Staged 12 records · 2 blocked by the gate · 1 failed parsing or missing a required field · 3 vessels without IMO → Manual Review" */
export function runSummary(t: RunTotals): string {
  const staged = t.new + t.updated;
  const parts = [`Staged ${staged} record${staged === 1 ? "" : "s"}`];
  if (t.gateBlocked == null) {
    if (t.invalid) parts.push(`${t.invalid} held back (gate or parsing)`);
  } else {
    const parse = Math.max(0, t.invalid - t.gateBlocked);
    if (t.gateBlocked) parts.push(`${t.gateBlocked} blocked by the gate`);
    if (parse) parts.push(`${parse} failed parsing or missing a required field`);
  }
  if (t.queued) parts.push(`${t.queued} vessel${t.queued === 1 ? "" : "s"} without IMO → Manual Review`);
  if (parts.length === 1) parts.push("nothing held back");
  return parts.join(" · ");
}


export interface RunState {
  title: string;
  channel: "email" | "whatsapp";
  state: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  steps: Partial<Record<SyncStepKey, { state: SyncStepState; detail?: string }>>;
  log: string[];
  usage: { tokens: number; cost: number; calls: number } | null;
  result: { batchId: string | null; totals?: RunTotals; message?: string } | null;
  error: string | null;
}

export const STEP_ORDER: { key: SyncStepKey; label: string }[] = [
  { key: "connect", label: "Connect" },
  { key: "fetch", label: "Fetch" },
  { key: "classify", label: "Classify" },
  { key: "stage", label: "Stage" },
  { key: "gate", label: "Gate" },
];

export function emptyRun(title: string, channel: RunState["channel"]): RunState {
  return { title, channel, state: "running", startedAt: Date.now(), steps: {}, log: [], usage: null, result: null, error: null };
}

const stateWord = (s: SyncStepState | undefined) =>
  s === "done" ? "done" : s === "running" ? "running…" : s === "failed" ? "failed" : s === "skipped" ? "skipped" : "waiting";

export function RunPanel({ run, onDismiss, onOpenBatch }: {
  run: RunState;
  onDismiss: () => void;
  onOpenBatch: (batchId: string) => void;
}) {
  // Elapsed seconds: a live run ticks from an interval (the setState happens in
  // the timer callback, never in the effect body); a finished run is fixed.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (run.finishedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [run.finishedAt, run.startedAt]);
  const secs = run.finishedAt ? Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000)) : tick;
  const doneSteps = STEP_ORDER.filter((s) => run.steps[s.key]?.state === "done").length;
  const t = run.result?.totals;

  return (
    <Card accent={run.state === "running"}>
      <div className="ds-row" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: C.navy }}>{run.title}</span>
        <Badge tone={run.state === "done" ? "new" : run.state === "failed" ? "invalid" : "updated"}>
          {run.state === "done" ? "Finished" : run.state === "failed" ? "Failed" : "Running"}
        </Badge>
        <span className="ds-note">
          {run.state === "running" ? `step ${Math.min(doneSteps + 1, 5)} of 5 · ${secs}s` : `took ${secs}s · logged to job_runs`}
          {run.usage ? ` · ${run.usage.tokens.toLocaleString()} tokens · USD ${run.usage.cost.toFixed(4)}` : ""}
        </span>
        {run.state !== "running" && <Btn size="sm" kind="ghost" className="ds-push" onClick={onDismiss}>Dismiss</Btn>}
      </div>

      <div className="ds-run__steps">
        {STEP_ORDER.map((s, i) => {
          const st = run.steps[s.key]?.state;
          const cls = st === "done" ? " is-done" : st === "running" ? " is-active" : st === "failed" ? " is-failed" : st === "skipped" ? " is-skipped" : "";
          return (
            <div key={s.key} className={`ds-run__step${cls}`}>
              <span className="ds-run__n">{st === "done" ? "✓" : st === "failed" ? "✕" : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ds-run__label">{s.label}</div>
                <div className="ds-run__detail">{run.steps[s.key]?.detail ?? stateWord(st)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {run.state !== "running" && (
        <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: "var(--r-soft-10)", background: run.state === "failed" ? C.redBg : C.greenBg }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: run.state === "failed" ? C.red : C.navy }}>
            {run.state === "failed"
              ? run.error
              : t
                ? runSummary(t)
                : run.result?.message ?? "Finished"}
          </div>
          {run.state === "done" && t && (
            <div className="ds-figs" style={{ marginTop: 9, background: "transparent", gap: 12 }}>
              {[
                { n: t.new, label: "new", color: C.green },
                { n: t.updated, label: "updated", color: C.amber },
                { n: t.invalid, label: "blocked", color: t.invalid ? C.red : C.ink3 },
                { n: t.errors, label: "flagged", color: t.errors ? C.amber : C.ink3 },
              ].map((f) => (
                <div key={f.label} style={{ background: "transparent", padding: 0 }}>
                  <div className="ds-fig__n" style={{ color: f.color }}>{f.n}</div>
                  <div className="ds-fig__label">{f.label}</div>
                </div>
              ))}
            </div>
          )}
          <div className="ds-note" style={{ marginTop: 8 }}>
            {run.state === "failed"
              ? "The start point did not move — fix the cause and run again; nothing was skipped."
              : run.result?.batchId
                ? "Next: open the batch in Review, clear anything blocked, then commit. The start point moved because the run succeeded."
                : "Nothing to review from this run."}
          </div>
          {run.result?.batchId && (
            <div style={{ marginTop: 10 }}>
              <Btn kind="primary" size="sm" onClick={() => onOpenBatch(run.result!.batchId!)}>Open in Review</Btn>
            </div>
          )}
        </div>
      )}

      {run.log.length > 0 && <div style={{ marginTop: 12 }}><RunLog lines={run.log} max={160} /></div>}
    </Card>
  );
}
