"use client";

// Runs — history with status, scope, mode, duration, rows, issues, AI cost, who
// started it, and a compare-with-previous view (same scope).
import * as React from "react";
import { controlRun, listRuns } from "@/app/(admin)/admin/data-quality/actions";
import { RUN_BADGE, RUN_MODE_LABEL, scopeLabel, type DqRun } from "@/lib/dq/types";
import { Badge, Loading, fmtDateTime, fmtDur, fmtInt, fmtMoney } from "./ui";
import { useConsole } from "./DataQualityConsole";

export function RunsView() {
  const { nav, tableLabel, toast, params } = useConsole();
  const [runs, setRuns] = React.useState<DqRun[] | null>(null);
  const [cmpId, setCmpId] = React.useState<string | null>(params.get("run"));
  const [now, setNow] = React.useState(0);
  const load = React.useCallback(async () => { const r = await listRuns(40); if (r.success) { setRuns(r.data); setNow(Date.now()); } else toast(r.error); }, [toast]);
  React.useEffect(() => { load(); }, [load]);
  if (!runs) return <Loading />;
  const a = runs.find((r) => r.id === cmpId) ?? null;
  const b = a ? runs.slice(runs.indexOf(a) + 1).find((r) => r.status === "completed" && JSON.stringify(r.scope.kind) === JSON.stringify(a.scope.kind) && (r.scope.filter ?? "") === (a.scope.filter ?? "")) ?? runs[runs.indexOf(a) + 1] ?? null : null;
  const delta = (x: number, y: number) => { const v = x - y; return { d: `${v > 0 ? "+" : ""}${Number.isInteger(v) ? v : v.toFixed(2)}`, color: v > 0 ? "var(--asb-red)" : v < 0 ? "var(--asb-green)" : "var(--asb-gray-500)" }; };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 980 }}>
        <thead><tr><th>Run</th><th>Status</th><th>Scope</th><th>Mode</th><th>Started</th><th>By</th><th className="num">Duration</th><th className="num">Rows</th><th className="num">Issues</th><th className="num">AI cost</th><th /></tr></thead>
        <tbody>
          {runs.length === 0 && <tr className="no-hover"><td colSpan={11} style={{ textAlign: "center", padding: 26, color: "var(--asb-gray-500)" }}>No runs yet.</td></tr>}
          {runs.map((r) => {
            const live = r.status === "running" || r.status === "paused" || r.status === "queued";
            const dur = r.duration_ms ?? (r.started_at && live && now ? now - new Date(r.started_at).getTime() : null);
            return (
              <tr key={r.id} className={cmpId === r.id ? "is-selected" : ""} onClick={() => (live ? nav({ tab: "progress", run: r.id }) : setCmpId(r.id))}>
                <td className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600 }}>{r.code}</td>
                <td><Badge cls={RUN_BADGE[r.status]}>{r.status}</Badge></td>
                <td>{scopeLabel(r.scope, tableLabel)}{r.rule_ids?.length ? <span className="dq-muted"> · {r.rule_ids.length} rules</span> : null}</td>
                <td style={{ textTransform: "capitalize" }}>{RUN_MODE_LABEL[r.mode]}</td>
                <td>{r.status === "queued" && r.scheduled_for ? `Scheduled ${fmtDateTime(r.scheduled_for)}` : fmtDateTime(r.started_at ?? r.created_at)}</td>
                <td>{r.started_by_name ?? (r.trigger === "scheduler" ? "Scheduler (nightly)" : "—")}</td>
                <td className="num">{fmtDur(dur)}</td><td className="num">{fmtInt(r.rows_done)}{r.total_rows && r.rows_done < r.total_rows ? <span className="dq-muted"> / {fmtInt(r.total_rows)}</span> : null}</td>
                <td className="num"><span style={{ color: "var(--asb-red)", fontWeight: 600 }}>{r.found.error}</span> <span style={{ color: "var(--asb-gray-400)" }}>/</span> <span style={{ color: "var(--asb-amber)" }}>{r.found.warn}</span> <span style={{ color: "var(--asb-gray-400)" }}>/</span> <span style={{ color: "var(--asb-slate)" }}>{r.found.info}</span></td>
                <td className="num">{fmtMoney(Number(r.cost))}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {(r.status === "cancelled" || r.status === "failed" || r.status === "paused") && <button type="button" className="adm-btn small" title="Continue from the saved primary-key cursor" onClick={async () => { const x = await controlRun(r.id, "resume"); if (!x.success) { toast(x.error); return; } toast(`${r.code} resumed from batch ${r.batches_done + 1} of ${r.total_batches}.`); nav({ tab: "progress", run: r.id }); }}>Resume</button>}{" "}
                  {!live && <button type="button" className="adm-btn small ghost" title="Compare this run with the previous one on the same scope" onClick={() => setCmpId(r.id)}>Compare</button>}
                </td>
              </tr>
            );
          })}
        </tbody></table></div>
        <div className="adm-table__foot"><span>Showing 1–{runs.length} of {runs.length} · queued runs appear with the scheduler as actor</span></div>
      </div>
      {a && b && (
        <div className="adm-card">
          <div className="adm-card__head"><span className="adm-card__title">Compare {a.code} with previous {b.code}</span><span className="adm-card__sub">{fmtDateTime(a.finished_at ?? a.created_at)} vs {fmtDateTime(b.finished_at ?? b.created_at)} · {scopeLabel(a.scope, tableLabel)}</span></div>
          <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 520 }}><thead><tr><th>Metric</th><th className="num">{b.code}</th><th className="num">{a.code}</th><th className="num">Δ</th></tr></thead><tbody>
            {([["Rows checked", a.rows_done, b.rows_done], ["Errors", a.found.error, b.found.error], ["Warnings", a.found.warn, b.found.warn], ["Info", a.found.info, b.found.info], ["Duration (s)", Math.round((a.duration_ms ?? 0) / 1000), Math.round((b.duration_ms ?? 0) / 1000)], ["AI cost ($)", Number(a.cost), Number(b.cost)], ["AI issues", a.ai_issues, b.ai_issues]] as [string, number, number][]).map(([k, x, y]) => { const d = delta(x, y); return <tr key={k} className="no-hover"><td>{k}</td><td className="num">{Number.isInteger(y) ? fmtInt(y) : y.toFixed(2)}</td><td className="num" style={{ fontWeight: 600 }}>{Number.isInteger(x) ? fmtInt(x) : x.toFixed(2)}</td><td className="num" style={{ fontWeight: 600, color: k === "Rows checked" || k === "Duration (s)" ? "var(--asb-gray-500)" : d.color }}>{d.d}</td></tr>; })}
          </tbody></table></div></div>
          {a.note && <p className="dq-muted" style={{ margin: "10px 0 0" }}>{a.code}: {a.note}</p>}
        </div>
      )}
      {a && !b && <div className="dq-muted">No earlier run to compare {a.code} with.</div>}
    </section>
  );
}
