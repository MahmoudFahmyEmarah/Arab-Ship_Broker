"use client";

// Issues — the triage table with saved views, table filter, keyboard triage
// (j/k move, f fix, i ignore), bulk actions, export, and the detail drawer.
import * as React from "react";
import { applyFix, applyFixes, exportIssuesCsv, listIssues, setIssueStatus, undoFix, type IssueFilter } from "@/app/(admin)/admin/data-quality/actions";
import { ISSUE_BADGE, ISSUE_LABEL, SEVERITY_BADGE, type DqIssue } from "@/lib/dq/types";
import { Badge, Loading, downloadText, fmtAgo, fmtInt } from "./ui";
import { useConsole } from "./DataQualityConsole";
import { IssueDrawer } from "./IssueDrawer";

const VIEWS: { id: NonNullable<IssueFilter["view"]>; label: string; tip: string }[] = [
  { id: "all", label: "All", tip: "Every issue regardless of status" }, { id: "open", label: "Open", tip: "Not yet actioned" },
  { id: "blocks", label: "Blocks matching", tip: "Open errors — rows the matcher skips" }, { id: "class", label: "Classification conflicts", tip: "Regime, cargo type and code disagreements" },
  { id: "ai", label: "AI-found only", tip: "Raised by the model with an evidence snippet" }, { id: "fixed", label: "Fixed", tip: "Applied here or cleared on re-check" },
];

export function IssuesView() {
  const { boot, canEdit, nav, params, tableLabel, toast, confirm, refreshBoot } = useConsole();
  const view = (params.get("view") as IssueFilter["view"]) ?? "open";
  const table = params.get("table") ?? "all";
  const rule = params.get("rule");
  const severity = params.get("severity");
  const issueId = params.get("issue");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<Awaited<ReturnType<typeof listIssues>> extends infer R ? (R extends { success: true; data: infer D } ? D : never) : never>();
  const [loading, setLoading] = React.useState(true);
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [reason, setReason] = React.useState<{ status: "ignored" | "false_positive"; ids: string[] } | null>(null);
  const [reasonText, setReasonText] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await listIssues({ view, table, rule, severity, q, page, pageSize: 25 });
    setLoading(false);
    if (r.success) setData(r.data); else toast(r.error);
  }, [view, table, rule, severity, q, page, toast]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { setPage(1); }, [view, table, rule, severity, q]);

  const rows = data?.rows ?? [];
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const patchLocal = (ids: string[], p: Partial<DqIssue>) => setData((d) => (d ? { ...d, rows: d.rows.map((x) => (ids.includes(x.id) ? { ...x, ...p } : x)) } : d));

  const setStatus = async (ids: string[], status: DqIssue["status"], why?: string) => {
    const prev = rows.filter((x) => ids.includes(x.id)).map((x) => [x.id, x.status] as const);
    patchLocal(ids, { status });
    const r = await setIssueStatus(ids, status, why);
    if (!r.success) { toast(r.error); await load(); return; }
    refreshBoot();
    toast(`${ids.length} issue${ids.length > 1 ? "s" : ""} → ${ISSUE_LABEL[status]}.`, async () => { for (const [id, s] of prev) await setIssueStatus([id], s); await load(); refreshBoot(); });
  };
  const fixOne = async (i: DqIssue) => {
    if (!i.fix?.value) { toast("No suggested value — open the issue and enter one."); return; }
    const r = await applyFix(i.id);
    if (!r.success) { toast(r.error); return; }
    patchLocal([i.id], { status: "fixed" }); refreshBoot();
    toast(r.data.noop ? `${i.row_label ?? i.row_key} was already fixed outside the module — closed.` : `${i.row_label ?? i.row_key} · ${i.fix.field} set to "${i.fix.value}". Audited in record_edit_audit.`, r.data.noop ? undefined : async () => { const u = await undoFix(i.id); if (!u.success) throw new Error(u.error); await load(); });
  };
  const bulkFix = () => {
    const eligible = rows.filter((x) => selIds.includes(x.id) && x.status === "open" && x.fix?.value);
    confirm({ title: `Apply ${eligible.length} suggested fix${eligible.length === 1 ? "" : "es"}?`, label: "Apply fixes", body: `Each fix is written through the audited edit RPC as its own record_edit_audit entry under your name. Fixes with confidence below ${boot.settings.auto_apply_threshold} are skipped.`, undo: "Data Sync → Recent edits → Undo per row, or the toast.", run: async () => { const r = await applyFixes(eligible.map((x) => x.id)); if (!r.success) { toast(r.error); return; } setSel({}); await load(); refreshBoot(); toast(`${r.data.applied} applied · ${r.data.skipped} skipped${r.data.errors.length ? ` · ${r.data.errors.length} failed: ${r.data.errors[0]}` : ""}`); } });
  };

  // keyboard triage
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || !rows.length) return;
      let i = Math.max(0, rows.findIndex((x) => x.id === issueId));
      if (e.key === "j") { i = Math.min(rows.length - 1, i + 1); nav({ issue: rows[i].id }, true); }
      else if (e.key === "k") { i = Math.max(0, i - 1); nav({ issue: rows[i].id }, true); }
      else if (e.key === "f" && issueId && canEdit) { const it = rows.find((x) => x.id === issueId); if (it && it.status === "open") fixOne(it); }
      else if (e.key === "i" && issueId && canEdit) { const it = rows.find((x) => x.id === issueId); if (it && it.status === "open") setReason({ status: "ignored", ids: [it.id] }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [rows, issueId, canEdit]);

  const counts = data?.counts;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {VIEWS.map((v) => <button key={v.id} type="button" className={`adm-filter-chip${view === v.id ? " is-on" : ""}`} title={v.tip} onClick={() => nav({ view: v.id }, true)}>{v.label} {counts && <span className="num" style={{ opacity: .7 }}>{fmtInt(counts[v.id])}</span>}</button>)}
        <span style={{ width: 1, height: 18, background: "var(--asb-gray-200)", margin: "0 4px" }} className="dq-hide-phone" />
        <select className="adm-select" value={table} onChange={(e) => nav({ table: e.target.value === "all" ? null : e.target.value }, true)} title="Filter by table" style={{ fontSize: 12, padding: "4px 8px" }}><option value="all">All tables</option>{boot.tables.map((t) => <option key={t.table_name} value={t.table_name}>{t.label}</option>)}</select>
        <select className="adm-select" value={severity ?? "all"} onChange={(e) => nav({ severity: e.target.value === "all" ? null : e.target.value }, true)} title="Severity" style={{ fontSize: 12, padding: "4px 8px" }}><option value="all">All severities</option><option value="error">Error</option><option value="warn">Warn</option><option value="info">Info</option></select>
        {rule && <button type="button" className="adm-filter-chip is-on" title="Clear the rule filter" onClick={() => nav({ rule: null }, true)}>rule {rule} ✕</button>}
        <input className="adm-search" style={{ minWidth: 160, flex: "0 1 260px", padding: "4px 8px", fontSize: 12 }} placeholder="Search row, field, value…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="dq-muted dq-hide-phone" style={{ marginLeft: "auto", color: "var(--asb-slate)" }}>Keyboard · <kbd className="dq-kbd">j</kbd>/<kbd className="dq-kbd">k</kbd> move · <kbd className="dq-kbd">f</kbd> fix · <kbd className="dq-kbd">i</kbd> ignore</span>
      </div>
      {selIds.length > 0 && (
        <div className="adm-filterbar" style={{ background: "var(--asb-blue-light)", borderColor: "var(--asb-tonnage-blue)" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--asb-navy)" }}>{selIds.length} selected</span>
          <button type="button" className="adm-btn small primary" disabled={!canEdit} title="Writes through the audited edit RPC; undo from Recent edits" onClick={bulkFix}>Apply suggested fix</button>
          <button type="button" className="adm-btn small" disabled={!canEdit} title="Requires a reason; hidden from open views" onClick={() => setReason({ status: "ignored", ids: selIds })}>Ignore with reason…</button>
          <button type="button" className="adm-btn small" disabled={!canEdit} title="Feeds the rule's false-positive rate" onClick={() => setReason({ status: "false_positive", ids: selIds })}>Mark false positive</button>
          <button type="button" className="adm-btn small" title="CSV of the selected rows" onClick={async () => { const r = await exportIssuesCsv(selIds); if (r.success) downloadText("dq-issues.csv", r.data, "text/csv"); else toast(r.error); }}>Export</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="adm-btn small ghost" onClick={() => setSel({})}>Clear</button>
        </div>
      )}
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <div className="adm-empty"><div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)", marginBottom: 4 }}>Nothing here</div>No issues match this view. The gate is holding — new issues appear after the next write or run.</div>
      ) : (
        <div className="adm-table" style={{ overflow: "visible", opacity: loading ? .7 : 1 }}><div style={{ overflowX: "auto" }}><table style={{ minWidth: 1040 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2 }}><tr><th style={{ width: 34 }}><input type="checkbox" checked={rows.length > 0 && rows.every((i) => sel[i.id])} onChange={() => { const on = !rows.every((i) => sel[i.id]); setSel(Object.fromEntries(rows.map((i) => [i.id, on]))); }} aria-label="Select all" /></th><th>Rule</th><th>Table · row</th><th>Field</th><th>Observed</th><th>Expected / suggested</th><th>Sev</th><th>Source</th><th>Status</th><th>Assignee</th><th className="num">Age</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className={i.id === issueId ? "is-selected" : ""} style={i.status !== "open" ? { opacity: .6 } : undefined} onClick={() => nav({ issue: i.id }, true)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!sel[i.id]} onChange={() => setSel((s) => ({ ...s, [i.id]: !s[i.id] }))} aria-label={`Select ${i.row_label}`} /></td>
                <td className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600 }} title={i.why ?? ""}>{i.rule_code}</td>
                <td><div className="dq-muted">{tableLabel(i.table_name)}</div><div style={{ fontWeight: 500, color: "var(--asb-navy)", whiteSpace: "nowrap" }}>{i.row_label ?? i.row_key}</div></td>
                <td className="mono">{i.field ?? "—"}</td>
                <td style={{ color: "var(--asb-red)", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={i.observed ?? ""}>{i.observed ?? "—"}</td>
                <td style={{ color: "var(--asb-green)", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={i.fix?.after ?? i.expected ?? ""}>{i.fix?.after ?? i.expected ?? "—"}</td>
                <td><Badge cls={SEVERITY_BADGE[i.severity]}>{i.severity}</Badge></td>
                <td><Badge cls={i.source === "ai" ? "amber" : "closed"} title={i.source === "ai" ? "Found by AI review — see evidence in the drawer" : "Raised by a deterministic rule"}>{i.source === "ai" ? `AI ${Math.round(Number(i.confidence ?? 0) * 100)}%` : "rule"}</Badge></td>
                <td><Badge cls={ISSUE_BADGE[i.status]}>{ISSUE_LABEL[i.status]}</Badge></td>
                <td style={{ whiteSpace: "nowrap" }}>{i.assignee ?? "—"}</td>
                <td className="num dq-muted">{fmtAgo(i.first_seen)}</td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="adm-table__foot">
            <span>{fmtInt(data?.total ?? 0)} issue{(data?.total ?? 0) === 1 ? "" : "s"} · page {page} of {Math.max(1, Math.ceil((data?.total ?? 0) / 25))}</span>
            <span className="adm-table__pager"><button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button><button type="button" disabled={page * 25 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next ›</button></span>
          </div>
        </div>
      )}
      {issueId && <IssueDrawer id={issueId} onClose={() => nav({ issue: null }, true)} onChanged={async () => { await load(); refreshBoot(); }} onFix={fixOne} onStatus={(ids, s) => (s === "ignored" || s === "false_positive" ? setReason({ status: s, ids }) : setStatus(ids, s))} />}
      {reason && (
        <div className="dq-confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) setReason(null); }}>
          <div className="adm-card" role="dialog" aria-modal="true" style={{ width: "min(440px,100%)", padding: "18px 20px" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)" }}>{reason.status === "ignored" ? "Ignore" : "Mark false positive"} · {reason.ids.length} issue{reason.ids.length > 1 ? "s" : ""}</div>
            <p style={{ fontSize: 13, color: "var(--asb-ink-secondary)", margin: "8px 0" }}>{reason.status === "ignored" ? "Hidden from open views; the reason is kept on the issue." : "Feeds the rule's false-positive rate so noisy rules surface on the Overview."}</p>
            <textarea className="adm-textarea" rows={2} placeholder="Reason" value={reasonText} onChange={(e) => setReasonText(e.target.value)} style={{ width: "100%" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
              <button type="button" className="adm-btn" onClick={() => setReason(null)}>Cancel</button>
              <button type="button" className="adm-btn primary" disabled={!reasonText.trim()} onClick={async () => { const r = reason; setReason(null); await setStatus(r.ids, r.status, reasonText.trim()); setReasonText(""); setSel({}); }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
