"use client";

// Issue detail drawer — row snapshot, the rule text, why it fired, the fix
// recommendation with rationale and confidence, before/after, related issues
// on the same row, apply (reversible, audited) or edit manually, owner page.
import * as React from "react";
import Link from "next/link";
import { applyFix, getIssue, undoFix } from "@/app/(admin)/admin/data-quality/actions";
import { ISSUE_BADGE, ISSUE_LABEL, SEVERITY_BADGE, type DqIssue, type DqRule } from "@/lib/dq/types";
import { Badge, Drawer, KV, Loading, fmtAgo } from "./ui";
import { useConsole } from "./DataQualityConsole";

export function IssueDrawer({ id, onClose, onChanged, onFix, onStatus }: { id: string; onClose: () => void; onChanged: () => Promise<void> | void; onFix: (i: DqIssue) => Promise<void>; onStatus: (ids: string[], s: DqIssue["status"]) => void }) {
  const { boot, canEdit, nav, tableLabel, toast } = useConsole();
  const [d, setD] = React.useState<{ issue: DqIssue; live: Record<string, unknown> | null; related: DqIssue[]; rule: DqRule | null; ownerHref: string | null } | null>(null);
  const [manual, setManual] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const r = await getIssue(id); if (r.success) setD(r.data); else toast(r.error); }, [id, toast]);
  React.useEffect(() => { setD(null); setManual(null); load(); }, [load]);

  if (!d) return <Drawer label="Issue detail" title="…" onClose={onClose} narrow><Loading /></Drawer>;
  const { issue: i, live, related, rule } = d;
  const fix = i.fix;
  const conf = fix?.confidence ?? (i.source === "ai" ? i.confidence : 1) ?? 1;
  const lowConf = Number(conf) < Number(boot.settings.auto_apply_threshold);
  const snapshot = (live ?? i.snapshot ?? {}) as Record<string, unknown>;
  const keys = Object.keys(snapshot).filter((k) => snapshot[k] != null && snapshot[k] !== "" && !["id", "created_at", "updated_at"].includes(k));
  const primary = [i.field, "ref", "vessel_name", "imo_number", "market_name", "canonical_name", "locode", "trade_name", "commodity_name", "cargo_type", "status", "load_port_name", "load_port_locode", "disch_port_name", "open_port_name", "open_port_locode", "flag", "regime", "hazard_class", "packaging_type", "is_grain_cargo", "qty_min_mt", "qty_max_mt", "laycan_from", "laycan_to"].filter((k): k is string => !!k && keys.includes(k));
  const shown = Array.from(new Set([...primary, ...keys])).slice(0, 18);
  const liveVal = i.field ? snapshot[i.field] : undefined;
  const fixedOutside = i.status === "open" && i.field && fix?.after != null && String(liveVal ?? "") === String(fix.after);

  const doApply = async (value?: string) => {
    setBusy(true);
    if (value != null) {
      const r = await applyFix(i.id, value, i.field ?? undefined);
      setBusy(false);
      if (!r.success) { toast(r.error); return; }
      toast(`${i.row_label ?? i.row_key} · ${i.field} set to "${value}". Audited in record_edit_audit.`, async () => { const u = await undoFix(i.id); if (!u.success) throw new Error(u.error); await onChanged(); await load(); });
      setManual(null); await onChanged(); await load(); return;
    }
    await onFix(i); setBusy(false); await load();
  };

  return (
    <Drawer label="Issue detail" narrow onClose={onClose}
      head={<div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><Badge cls={SEVERITY_BADGE[i.severity]}>{i.severity}</Badge><Badge cls={ISSUE_BADGE[i.status]}>{ISSUE_LABEL[i.status]}</Badge><Badge cls={i.source === "ai" ? "amber" : "closed"}>{i.source === "ai" ? "AI-found" : "rule"}</Badge><span className="dq-muted">{fmtAgo(i.first_seen)} old · {tableLabel(i.table_name)}{i.reason ? ` · ${i.reason}` : ""}</span></div>}
      title={<>{i.row_label ?? i.row_key} <span style={{ color: "var(--asb-gray-400)", fontWeight: 400 }}>·</span> <span className="mono" style={{ fontSize: 13, color: "var(--asb-steel)" }}>{i.field ?? "row"}</span></>}>
      <div className="dq-drawer__body" style={{ gap: 16 }}>
        <div><div className="adm-card__title" style={{ marginBottom: 6 }}>Rule · <a href="#" className="adm-link" onClick={(e) => { e.preventDefault(); nav({ tab: "rules", rule: i.rule_code, issue: null }); }}>{i.rule_code}</a> — {rule?.name ?? (i.rule_code === "AI" ? "AI review (no matching rule)" : "rule deleted")}</div><p style={{ margin: 0, fontSize: 13, color: "var(--asb-ink-secondary)", lineHeight: 1.5 }}>{rule?.description ?? ""}</p></div>
        <div><div className="adm-card__title" style={{ marginBottom: 6 }}>Why it fired</div><p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{i.why ?? rule?.description ?? "—"}</p>
          {i.evidence && <div style={{ marginTop: 8, fontSize: 12, background: "var(--asb-gray-50)", borderLeft: "2px solid var(--asb-tonnage-blue)", padding: "8px 10px", borderRadius: "0 8px 8px 0", color: "var(--asb-ink-secondary)" }}><span className="adm-field__label" style={{ display: "block", marginBottom: 3, color: "var(--asb-steel)" }}>AI evidence · confidence {Math.round(Number(i.confidence ?? 0) * 100)}%</span>{i.evidence}</div>}
        </div>
        <div><div className="adm-card__title" style={{ marginBottom: 6 }}>Row snapshot {live ? <span className="dq-muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· live, PII masked</span> : <span className="dq-muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· as seen by the run (row no longer readable)</span>}</div>
          <KV rows={shown.map((k) => [k, k === i.field ? <span style={{ color: "var(--asb-red)", fontWeight: 600 }}>{String(snapshot[k])}</span> : String(snapshot[k])])} />
        </div>
        {(fix || i.field) && (
          <div className="adm-card" style={{ padding: "12px 14px", borderColor: "var(--asb-tonnage-blue)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}><span className="adm-card__title">{fix ? "Recommended fix" : "Manual fix"}</span>{fix && <span className="dq-muted">confidence <strong style={{ color: lowConf ? "var(--asb-amber)" : "var(--asb-green)" }}>{Math.round(Number(conf) * 100)}%</strong> · {fix.kind ?? rule?.autofix ?? "suggest only"}</span>}</div>
            {fix && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div style={{ background: "var(--asb-red-bg)", borderRadius: 8, padding: "8px 10px" }}><div className="adm-field__label" style={{ color: "var(--asb-red)" }}>Before</div><div style={{ fontSize: 12, marginTop: 3 }}>{fix.before ?? i.observed ?? "—"}</div></div>
              <div style={{ background: "var(--asb-green-bg)", borderRadius: 8, padding: "8px 10px" }}><div className="adm-field__label" style={{ color: "var(--asb-green)" }}>After</div><div style={{ fontSize: 12, marginTop: 3 }}>{fix.after ?? fix.value ?? "—"}</div></div>
            </div>}
            {fix?.rationale && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--asb-ink-secondary)", lineHeight: 1.5 }}><strong>Rationale.</strong> {fix.rationale}</p>}
            {!fix && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--asb-ink-secondary)" }}>No automatic value — expected: {i.expected ?? "see the rule"}. Enter the value manually or open the owning page.</p>}
            {fixedOutside && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--asb-green)" }}>The live row already carries the suggested value — applying will just close the issue.</p>}
            {manual != null ? (
              <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
                <input className="adm-input" value={manual} onChange={(e) => setManual(e.target.value)} style={{ flex: 1, fontSize: 12 }} placeholder={`new value for ${i.field}`} autoFocus />
                <button type="button" className="adm-btn small primary" disabled={busy || !manual.trim()} onClick={() => doApply(manual.trim())}>Apply</button>
                <button type="button" className="adm-btn small ghost" onClick={() => setManual(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <button type="button" className="adm-btn small primary" disabled={!canEdit || busy || i.status !== "open" || !fix?.value || lowConf} title="Writes through the audited edit RPC (record_edit_audit) — undo from Recent edits" onClick={() => doApply()}>{busy ? "Applying…" : "Apply fix"}</button>
                <button type="button" className="adm-btn small" disabled={!canEdit || i.status !== "open" || !i.field} title="Open the field for manual entry" onClick={() => setManual(fix?.value ?? "")}>Edit manually</button>
                <button type="button" className="adm-btn small" disabled={!canEdit || i.status !== "open"} onClick={() => onStatus([i.id], "ignored")}>Ignore…</button>
                <button type="button" className="adm-btn small" disabled={!canEdit || i.status !== "open"} title={`Feeds ${i.rule_code}'s false-positive rate`} onClick={() => onStatus([i.id], "false_positive")}>False positive</button>
                <button type="button" className="adm-btn small ghost" disabled={!canEdit || i.status !== "open"} onClick={() => onStatus([i.id], "escalated")}>Escalate</button>
                {i.status === "fixed" && i.fixed_audit_id && <button type="button" className="adm-btn small" disabled={!canEdit} onClick={async () => { const u = await undoFix(i.id); if (!u.success) { toast(u.error); return; } toast("Fix undone — the row is back to its before-image."); await onChanged(); await load(); }}>Undo fix</button>}
                {i.status !== "open" && i.status !== "fixed" && <button type="button" className="adm-btn small" disabled={!canEdit} onClick={() => onStatus([i.id], "open")}>Reopen</button>}
              </div>
            )}
            {lowConf && fix && i.status === "open" && <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--asb-amber)" }}>Confidence below the {boot.settings.auto_apply_threshold} auto-apply threshold — Apply is disabled until an admin edits or confirms the value manually.</p>}
          </div>
        )}
        {related.length > 0 && (
          <div><div className="adm-card__title" style={{ marginBottom: 6 }}>Related issues on this row</div>
            <div className="adm-list">{related.map((r) => <a key={r.id} href="#" className="adm-list__row" style={{ color: "inherit", textDecoration: "none", padding: "8px 0" }} onClick={(e) => { e.preventDefault(); nav({ issue: r.id }, true); }}><span className={`adm-list__icon ${r.status === "open" ? "is-amber" : ""}`}>{r.status === "open" ? "!" : "✓"}</span><div className="adm-list__body"><div className="adm-list__title">{r.rule_code} · {r.field ?? "row"} <Badge cls={ISSUE_BADGE[r.status]}>{ISSUE_LABEL[r.status]}</Badge></div><div className="adm-list__meta">{r.observed ?? "—"} → {r.fix?.after ?? r.expected ?? "—"}</div></div></a>)}</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid var(--ccx-line2)", fontSize: 12 }}>
          {d.ownerHref && <Link href={d.ownerHref} className="adm-link">Open in {tableLabel(i.table_name)} →</Link>}
          <span style={{ color: "var(--asb-gray-400)" }}>·</span><Link href="/admin/data-sync?view=preview" className="adm-link">Recent edits (undo) →</Link>
          <span className="dq-muted" style={{ marginLeft: "auto" }}>{i.resolved_by_name ? `${ISSUE_LABEL[i.status]} by ${i.resolved_by_name}` : `Assignee · ${i.assignee ?? "—"}`}</span>
        </div>
      </div>
    </Drawer>
  );
}
