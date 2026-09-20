"use client";

// Live progress of one run — batches done of total, rows per second, issues by
// severity, pause / resume / cancel. Polls tickRun, which only READS (20 Sep
// 2026): a stalled server chain is reported, and an admin with the run
// permission (or the hourly scheduler) re-kicks it through recoverRun.
import * as React from "react";
import { controlRun, recoverRun, tickRun } from "@/app/(admin)/admin/data-quality/actions";
import { RUN_BADGE, RUN_LABEL, RUN_MODE_LABEL, scopeLabel, type DqRun, type DqRunBatch } from "@/lib/dq/types";
import { Badge, Loading, fmtInt, fmtMoney } from "./ui";
import { useConsole } from "./DataQualityConsole";

export function RunProgress() {
  const { boot, nav, params, tableLabel, toast, confirm, refreshBoot, canRun } = useConsole();
  const runId = params.get("run") ?? boot.activeRun?.id ?? null;
  const [run, setRun] = React.useState<DqRun | null>(null);
  const [batches, setBatches] = React.useState<DqRunBatch[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [reduced, setReduced] = React.useState(false);
  const [now, setNow] = React.useState(0);
  const [stalled, setStalled] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);
  React.useEffect(() => { setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false); }, []);

  React.useEffect(() => {
    if (!runId) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const r = await tickRun(runId);
      if (!alive) return;
      if (!r.success) { setErr(r.error); return; }
      setRun(r.data.run); setBatches(r.data.batches); setStalled(r.data.stalled); setNow(Date.now());
      if (r.data.run.status === "running" || r.data.run.status === "queued") timer = setTimeout(tick, 2000);
      else refreshBoot();
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [runId, refreshBoot]);

  if (!runId) return <div className="adm-empty">No run in progress. <a href="#" className="adm-link" onClick={(e) => { e.preventDefault(); nav({ tab: "newrun" }); }}>Start one</a> or open <a href="#" className="adm-link" onClick={(e) => { e.preventDefault(); nav({ tab: "runs" }); }}>Runs</a>.</div>;
  if (err) return <div className="adm-empty">{err}</div>;
  if (!run) return <Loading label="Reading the run…" />;

  // batches size themselves (workstream H), so progress is rows, not batches
  const pct = run.total_rows ? Math.min(100, Math.round((run.rows_done / run.total_rows) * 100)) : 0;
  const running = run.status === "running", paused = run.status === "paused";
  const elapsed = run.started_at && now ? (now - new Date(run.started_at).getTime()) / 1000 : 0;
  const rps = running && elapsed > 0 ? Math.round(run.rows_done / elapsed) : 0;
  const eta = running && rps > 0 ? `${Math.max(1, Math.round((run.total_rows - run.rows_done) / rps))} s` : "—";
  const failedBatches = batches.filter((b) => b.status === "failed");
  const prepErrors = run.prep_errors ?? [];
  const budgetHit = run.note?.includes("AI budget exhausted");

  const ctl = async (a: "pause" | "resume" | "cancel") => {
    const r = await controlRun(run.id, a);
    if (!r.success) { toast(r.error); return; }
    setRun(r.data); refreshBoot();
    if (a === "resume") { const t = await tickRun(run.id); if (t.success) { setRun(t.data.run); setBatches(t.data.batches); setStalled(t.data.stalled); } }
  };
  const recover = async () => {
    setRecovering(true);
    const r = await recoverRun(run.id);
    setRecovering(false);
    if (!r.success) { toast(r.error); return; }
    setRun(r.data.run); setBatches(r.data.batches); setStalled(r.data.stalled);
    toast(`${run.code} re-kicked — the server chain continues from batch ${r.data.run.batches_done + 1}.`);
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="adm-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span className="mono" style={{ fontWeight: 600, color: "var(--asb-navy)" }}>{run.code}</span>
          <Badge cls={RUN_BADGE[run.status]}>{RUN_LABEL[run.status]}</Badge>
          <span style={{ fontSize: 12, color: "var(--asb-ink-secondary)" }}>{scopeLabel(run.scope, tableLabel)} · {RUN_MODE_LABEL[run.mode]} · started by {run.started_by_name ?? "—"}</span>
          <span style={{ flex: 1 }} />
          {running && <button type="button" className="adm-btn small" disabled={!canRun} onClick={() => ctl("pause")} title="Finish the current batch, then hold the cursor">Pause</button>}
          {(paused || run.status === "queued") && <button type="button" className="adm-btn small primary" disabled={!canRun} onClick={() => ctl("resume")} title="Continue from the saved cursor">Resume</button>}
          {(running || paused || run.status === "queued") && <button type="button" className="adm-btn small" style={{ color: "var(--asb-red)" }} title="Stop the run; finished batches keep their issues" disabled={!canRun} onClick={() => confirm({ title: "Cancel this run?", label: "Cancel run", danger: true, body: "Batches already processed keep their issues in dq_issues. The run is marked cancelled and can be resumed from its cursor later.", undo: "Runs → row → Resume from cursor.", run: () => ctl("cancel") })}>Cancel…</button>}
          {!running && !paused && run.status !== "queued" && <button type="button" className="adm-btn small primary" onClick={() => nav({ tab: "issues", view: "open" })}>Open issues</button>}
          {(run.status === "cancelled" || run.status === "failed") && <button type="button" className="adm-btn small" disabled={!canRun} onClick={() => ctl("resume")} title="Continue from the saved primary-key cursor">Resume from cursor</button>}
        </div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="num" style={{ fontSize: 27, fontWeight: 600, color: "var(--asb-navy)", letterSpacing: "-.02em" }}>{pct}%</span>
          <span className="num" aria-live="polite" style={{ fontSize: 13, color: "var(--asb-ink-secondary)" }}>{fmtInt(run.rows_done)} of {fmtInt(run.total_rows)} rows · {run.batches_done} batch{run.batches_done === 1 ? "" : "es"} so far (each batch is sized to the cost of the rules{run.batch_limit ? `, currently ${fmtInt(run.batch_limit)} rows` : ""}{run.timeout_retries ? ` · ${run.timeout_retries} timeout${run.timeout_retries === 1 ? "" : "s"} at the floor` : ""})</span>
          <span className="num dq-muted" style={{ marginLeft: "auto", fontSize: 12 }}>{rps} rows/s · ETA {eta}</span>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: "var(--asb-gray-100)", overflow: "hidden", marginTop: 8 }}>
          <div className="dq-anim" style={{ height: "100%", width: `${pct}%`, background: running ? "repeating-linear-gradient(45deg,var(--asb-blue) 0 14px,var(--asb-steel) 14px 28px)" : run.status === "completed" ? "var(--asb-green)" : "var(--asb-slate)", backgroundSize: "28px 28px", transition: "width .4s var(--ease)", animation: running && !reduced ? "dq-stripe 1s linear infinite" : "none" }} />
        </div>
        <div className="dq-batches">
          {Array.from({ length: Math.max(run.total_batches, batches.length) }, (_, i) => { const b = batches[i]; const st = b ? (b.status === "failed" ? "failed" : b.status === "done" ? "done" : "running") : i === run.batches_done && running ? "running" : "queued"; return <span key={i} className={`dq-batch${st === "done" ? " is-done" : st === "running" ? " is-running" : st === "failed" ? " is-failed" : ""}`} title={b ? `Batch ${b.n} · ${tableLabel(b.table_name)} · ${fmtInt(b.rows)} rows · ${b.ms ?? "…"} ms${b.error ? ` · ${b.error}` : ""}` : `Batch ${i + 1} · queued`} />; })}
        </div>
      </div>
      <div className="adm-stats" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="adm-stat"><span className="adm-stat__label">Errors found</span><span className="adm-stat__value is-red">{fmtInt(run.found.error)}</span><span className="adm-stat__sub">block the market</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Warnings</span><span className="adm-stat__value is-amber">{fmtInt(run.found.warn)}</span><span className="adm-stat__sub">visible but allowed</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Info</span><span className="adm-stat__value">{fmtInt(run.found.info)}</span><span className="adm-stat__sub">advisory</span></div>
        {run.mode !== "rules" && <div className="adm-stat"><span className="adm-stat__label">AI tokens · cost</span><span className="adm-stat__value" style={{ fontSize: 21 }}>{(run.tokens / 1000).toFixed(0)}k</span><span className="adm-stat__sub">{fmtMoney(Number(run.cost))} · {run.ai_issues} AI issues · cap {fmtInt(boot.settings.ai_daily_tokens)}</span></div>}
      </div>
      {budgetHit && <div className="adm-page__warn" style={{ background: "var(--asb-amber-bg)", borderColor: "var(--asb-amber)", color: "var(--asb-amber)" }}><strong>AI budget exhausted.</strong> {run.note}</div>}
      {failedBatches.length > 0 && <div className="adm-page__warn" style={{ background: "var(--asb-red-bg)", borderColor: "var(--asb-red)", color: "var(--asb-red)" }}><strong>Partial failure.</strong> {failedBatches.map((b) => `Batch ${b.n} (${tableLabel(b.table_name)}): ${b.error}`).join(" · ")} — the run skipped the failing check for that range and continued; fix the rule in Rules, then use Retry failed checks in Runs.</div>}
      {prepErrors.length > 0 && <div className="adm-page__warn" style={{ background: "var(--asb-red-bg)", borderColor: "var(--asb-red)", color: "var(--asb-red)" }}><strong>{prepErrors.length} key quer{prepErrors.length === 1 ? "y" : "ies"} failed at prepare.</strong> {prepErrors.map((e) => `${e.rule} on ${tableLabel(e.table)}${e.check_idx != null ? ` (check ${e.check_idx + 1})` : ""}: ${e.error}`).join(" · ")} — those checks were not evaluated and count as failed; the run ends completed with errors. Fix the rule, then Retry failed checks in Runs.</div>}
      {run.note && !budgetHit && failedBatches.length === 0 && <div className="adm-page__warn"><span>{run.note}</span></div>}
      {run.error && <div className="adm-page__warn" style={{ background: "var(--asb-red-bg)", borderColor: "var(--asb-red)", color: "var(--asb-red)" }}><strong>Failed.</strong> {run.error}</div>}
      {stalled && <div className="adm-page__warn" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><span>No batch has been reported for a while — the server chain may have broken. Polling only reads; {canRun ? "recover it here, or the hourly scheduler will." : "an admin with the run permission can recover it, or the hourly scheduler will."}</span>{canRun && <button type="button" className="adm-btn small primary" disabled={recovering} onClick={recover} title="Process one batch now and re-kick the server chain">{recovering ? "Recovering…" : "Recover"}</button>}</div>}
      <p className="dq-muted" style={{ margin: 0 }}>Runs never lock member-facing tables. You can leave this page — progress stays in the topbar.</p>
    </section>
  );
}
