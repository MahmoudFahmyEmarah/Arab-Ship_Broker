"use client";

// AI suggestions — two queues: proposed rules (accept as disabled draft, edit,
// dismiss) and proposed fixes (approve in bulk through the audited edit RPC).
import * as React from "react";
import { acceptSuggestion, approveAllFixes, dismissSuggestion, listSuggestions } from "@/app/(admin)/admin/data-quality/actions";
import { SEVERITY_BADGE, type DqSuggestion } from "@/lib/dq/types";
import { Badge, Empty, Loading, fmtInt, fmtDateTime } from "./ui";
import { useConsole } from "./DataQualityConsole";

export function AiView() {
  const { boot, canEdit, nav, params, toast, confirm, refreshBoot, tableLabel } = useConsole();
  const tab = (params.get("sug") as "rules" | "fixes") ?? "rules";
  const [list, setList] = React.useState<DqSuggestion[] | null>(null);
  const [reason, setReason] = React.useState<{ id: string; text: string } | null>(null);
  const load = React.useCallback(async () => { const r = await listSuggestions(); if (r.success) setList(r.data); else toast(r.error); }, [toast]);
  React.useEffect(() => { load(); }, [load]);
  if (!list) return <Loading />;
  const kind = tab === "rules" ? "rule" : "fix";
  const cards = list.filter((c) => c.kind === kind);
  const pending = (k: "rule" | "fix") => list.filter((c) => c.kind === k && c.status === "pending").length;
  const threshold = Number(boot.settings.auto_apply_threshold);
  const budgetOut = boot.aiToday.tokens >= Number(boot.settings.ai_daily_tokens);

  const accept = async (c: DqSuggestion) => {
    const r = await acceptSuggestion(c.id);
    if (!r.success) { toast(r.error); return; }
    await load(); refreshBoot();
    if (c.kind === "rule") toast(`Accepted as ${r.data.ruleCode} (disabled draft). Enable it from Rules.`);
    else toast(`${r.data.applied ?? 0} fix${(r.data.applied ?? 0) === 1 ? "" : "es"} applied via record_edit_audit${r.data.skipped ? ` · ${r.data.skipped} skipped (below threshold or already closed)` : ""}${r.data.errors?.length ? ` · ${r.data.errors.length} failed` : ""}.`);
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="adm-page__warn" style={{ alignItems: "flex-start" }}><span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>Human in the loop.</span><span style={{ fontSize: 12 }}>The model proposes; it never writes. Accepting a rule creates a <em>disabled draft</em> in dq_rules; approving a fix goes through the audited edit RPC. Every acceptance and dismissal is recorded under your name. PII is masked before any text reaches the model; every call is metered.</span></div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <div className="adm-tabs" style={{ border: 0, background: "transparent", padding: 0 }}>
          {(["rules", "fixes"] as const).map((t) => <button key={t} type="button" className={`adm-tab${tab === t ? " is-on" : ""}`} onClick={() => nav({ sug: t }, true)}>{t === "rules" ? "Proposed rules" : "Proposed fixes"}<span className="adm-tab__count">{pending(t === "rules" ? "rule" : "fix")}</span></button>)}
        </div>
        <span className="dq-muted num" style={{ marginLeft: "auto" }}>{boot.activeModel ? `Model ${boot.activeModel.model}` : "No active model"} · today {fmtInt(boot.aiToday.tokens)} of {fmtInt(boot.settings.ai_daily_tokens)} tokens · ${boot.aiToday.cost.toFixed(2)}</span>
        {tab === "fixes" && <button type="button" className="adm-btn small primary" disabled={!canEdit || pending("fix") === 0} title={`Approve every pending fix with confidence ≥ ${threshold} in one audited batch`} onClick={() => confirm({ title: `Approve every pending fix ≥ ${Math.round(threshold * 100)} %?`, label: "Approve all", body: "Each fix is written through the audited edit RPC as a separate record_edit_audit entry under your name. Fixes the gate refuses are skipped and reported.", undo: "Recent edits → batch → Undo, or per issue from the Issues drawer.", run: async () => { const r = await approveAllFixes(); if (!r.success) { toast(r.error); return; } await load(); refreshBoot(); toast(`${r.data.applied} fixes applied across ${r.data.suggestions} suggestions · ${r.data.skipped} skipped${r.data.errors.length ? ` · ${r.data.errors.length} failed` : ""}.`); } })}>Approve all ≥ {Math.round(threshold * 100)} %</button>}
      </div>
      {budgetOut && <div className="adm-page__warn" style={{ background: "var(--asb-amber-bg)", borderColor: "var(--asb-amber)", color: "var(--asb-amber)" }}><strong>AI budget exhausted for today.</strong> No new suggestions will arrive until 00:00 UTC or the budget is raised in Settings. Existing suggestions can still be reviewed.</div>}
      {cards.length === 0 && <Empty title="Queue is clear">{list.length ? "Every suggestion has been accepted or dismissed." : "No suggestions yet."} New ones arrive after the next AI-mode run.</Empty>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 12 }}>
        {cards.map((c) => {
          const conf = Math.round(Number(c.confidence ?? 0) * 100);
          const pendingC = c.status === "pending";
          return (
            <article key={c.id} className="adm-card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", opacity: pendingC ? 1 : .6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Badge cls="amber">{c.kind === "rule" ? "AI · proposed rule" : "AI · proposed fix"}</Badge>
                {c.kind === "rule" && c.severity && <Badge cls={SEVERITY_BADGE[c.severity]}>{c.severity}</Badge>}
                {c.kind === "rule" && <span className="dq-muted" style={{ textTransform: "capitalize" }}>{c.category}</span>}
                <span className="dq-muted">{c.tables.map(tableLabel).join(" · ")}</span>
                <span className="dq-muted" style={{ marginLeft: "auto" }}>confidence <strong style={{ color: conf >= threshold * 100 ? "var(--asb-green)" : "var(--asb-amber)" }}>{conf}%</strong></span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)", letterSpacing: "-.01em" }}>{c.title}</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--asb-ink-secondary)" }}>{c.nl}</p>
              {c.kind === "rule" && c.sql && <pre className="dq-pre">{c.sql}</pre>}
              <div><div className="adm-field__label" style={{ marginBottom: 4 }}>Evidence · {c.kind === "fix" ? `${c.hits} row${c.hits === 1 ? "" : "s"}` : `from ${c.model ?? "the model"}`}</div>
                {c.evidence.length ? <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--asb-ink-secondary)", lineHeight: 1.6 }}>{c.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul> : <span className="dq-muted">Proposed while reviewing {c.tables.map(tableLabel).join(", ")} · {fmtDateTime(c.created_at)}</span>}
              </div>
              {pendingC ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--ccx-line2)" }}>
                  <button type="button" className="adm-btn small primary" disabled={!canEdit} title={c.kind === "rule" ? "Creates a disabled rule in dq_rules (source AI-suggested) for you to enable" : "Applies through the audited edit RPC — undo from Recent edits"} onClick={() => accept(c)}>{c.kind === "rule" ? "Accept as draft" : `Approve ${c.hits} fix${c.hits === 1 ? "" : "es"}`}</button>
                  {c.kind === "fix" && <button type="button" className="adm-btn small" title="Open the affected rows in Issues" onClick={() => nav({ tab: "issues", view: "ai", table: c.tables[0] ?? null })}>Review rows</button>}
                  {c.kind === "rule" && <button type="button" className="adm-btn small" disabled={!canEdit} title="Accept as a draft, then open it in the rule editor" onClick={async () => { const r = await acceptSuggestion(c.id); if (!r.success) { toast(r.error); return; } await load(); nav({ tab: "rules", rule: r.data.ruleCode ?? null }); }}>Edit</button>}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="adm-btn small ghost" disabled={!canEdit} title="Dismiss with a reason — recorded in dq_ai_suggestions" onClick={() => setReason({ id: c.id, text: "" })}>Dismiss…</button>
                </div>
              ) : (
                <div className="dq-muted" style={{ paddingTop: 8, borderTop: "1px solid var(--ccx-line2)", fontSize: 12 }}>{c.status === "accepted" ? (c.kind === "rule" ? "Accepted as disabled draft" : `Approved and applied${c.reason ? ` · ${c.reason}` : ""}`) : `Dismissed${c.reason ? ` · ${c.reason}` : ""}`} by {c.resolved_by_name ?? "—"} · {fmtDateTime(c.resolved_at)}</div>
              )}
            </article>
          );
        })}
      </div>
      {reason && (
        <div className="dq-confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) setReason(null); }}>
          <div className="adm-card" role="dialog" aria-modal="true" style={{ width: "min(440px,100%)", padding: "18px 20px" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)" }}>Dismiss suggestion</div>
            <textarea className="adm-textarea" rows={2} placeholder="Reason (kept with the suggestion)" value={reason.text} onChange={(e) => setReason({ ...reason, text: e.target.value })} style={{ width: "100%", marginTop: 10 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}><button type="button" className="adm-btn" onClick={() => setReason(null)}>Cancel</button><button type="button" className="adm-btn primary" disabled={!reason.text.trim()} onClick={async () => { const r = await dismissSuggestion(reason.id, reason.text.trim()); setReason(null); if (!r.success) { toast(r.error); return; } await load(); refreshBoot(); toast("Dismissed. Recorded in dq_ai_suggestions."); }}>Dismiss</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
