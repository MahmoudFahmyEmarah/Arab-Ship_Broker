"use client";

// Rule editor drawer — definition (plain-language description, category,
// severity, scope, kind-specific checks with "Test on 200 rows" and the EXPLAIN
// cost hint, enforcement per channel), live preview, version history, stats.
import * as React from "react";
import { getRuleVersions, restoreRuleVersion, setChannelMode, testRule, saveRule as saveRuleAction } from "@/app/(admin)/admin/data-quality/actions";
import { DQ_CATEGORIES, DQ_CHANNELS, MODE_BADGE, SEVERITY_BADGE, SOURCE_BADGE, type DqCheck, type DqChannel, type DqMode, type DqRule, type DqRuleVersion, type DqSeverity } from "@/lib/dq/types";
import { Badge, Drawer, Seg, fmtDateTime, fmtInt } from "./ui";
import { useConsole } from "./DataQualityConsole";

type Tab = "definition" | "preview" | "history" | "stats";
const defaultMode = (s: DqSeverity): DqMode => (s === "error" ? "block" : s === "warn" ? "warn" : "audit");
const KIND_LABEL: Record<DqRule["kind"], string> = { declarative: "Declarative — a boolean SQL expression over the row (alias r)", sql: "SQL predicate — a full SELECT returning the table's rows", classification: "Classification regime — workbook decision tree as an expression over r", ai: "AI-assisted — a natural-language check the model evaluates on sampled rows" };
const KIND_HINT: Record<DqRule["kind"], string> = { declarative: "Compiles into the batch INSERT and the gate", sql: "EXPLAIN runs before save; keys pinned once per batch", classification: "Editable as text; the engine parses it", ai: "Evaluated on sampled rows, PII masked" };

export function RuleDrawer({ rule, isNew, onClose, onSaved, onToggle, onDuplicate, onDelete }: {
  rule: DqRule; isNew: boolean; onClose: () => void; onSaved: (r: DqRule) => void | Promise<void>; onToggle: () => void; onDuplicate: () => void; onDelete: () => void; save: typeof saveRuleAction;
}) {
  const { boot, canEdit, toast, tableLabel, nav } = useConsole();
  const [tab, setTab] = React.useState<Tab>("definition");
  const [d, setD] = React.useState<DqRule>(rule);
  const [test, setTest] = React.useState<{ rows: { table: string; key: string; label: string; field: string | null; observed: string | null; expected: string | null }[]; matches: number; checked: number; ms: number; cost: { table: string; total_cost?: string; node?: string; rows?: string; error?: string }[] } | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [versions, setVersions] = React.useState<DqRuleVersion[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [channels, setChannels] = React.useState<Partial<Record<DqChannel, DqMode>>>(rule.channels ?? {});
  React.useEffect(() => { setD(rule); setChannels(rule.channels ?? {}); setTest(null); setVersions(null); setTab("definition"); }, [rule]);
  React.useEffect(() => { if (tab === "history" && !versions && rule.id) getRuleVersions(rule.id).then((r) => setVersions(r.success ? r.data : [])); }, [tab, versions, rule.id]);

  const dirty = JSON.stringify(d) !== JSON.stringify(rule);
  const upd = (p: Partial<DqRule>) => setD((x) => ({ ...x, ...p }));
  const updCheck = (i: number, p: Partial<DqCheck>) => upd({ checks: d.checks.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const st = d.stats ?? { open: 0, raised: 0, fp: 0, checked: 0 };

  const runTest = React.useCallback(async () => {
    if (!rule.id) { toast("Save the rule first, then test it."); return; }
    if (dirty) { toast("Unsaved changes — the test runs the saved version."); }
    setTesting(true);
    const r = await testRule(rule.id, null, 200);
    setTesting(false);
    if (r.success) setTest(r.data); else toast(r.error);
  }, [rule.id, dirty, toast]);
  const previewWanted = tab === "preview" && !test && !!rule.id && !testing;
  React.useEffect(() => { if (previewWanted) void runTest(); }, [previewWanted, runTest]);
  async function doSave() {
    setSaving(true);
    const payload: Partial<DqRule> = { ...(d.id ? { id: d.id } : {}), code: d.code || undefined, name: d.name, description: d.description, category: d.category, severity: d.severity, kind: d.kind, definition: d.definition, checks: d.kind === "ai" ? [] : d.checks, ai_prompt: d.ai_prompt, tables: d.tables, autofix: d.autofix, enabled: d.enabled, source: d.source };
    const r = await saveRuleAction(payload, isNew ? "Created in the rule editor" : "Edited in the rule editor");
    setSaving(false);
    if (!r.success) { toast(r.error); return; }
    toast(`${r.data.code} saved as v${r.data.version}. Form-time and gate pick it up immediately.`);
    await onSaved(r.data);
  }
  async function cycle(ch: DqChannel) {
    const cur = channels[ch] ?? defaultMode(d.severity);
    const next: DqMode = ({ block: "warn", warn: "audit", audit: "block" } as const)[cur];
    setChannels((c) => ({ ...c, [ch]: next }));
    const r = await setChannelMode(rule.id, ch, next);
    if (!r.success) { toast(r.error); setChannels((c) => ({ ...c, [ch]: cur })); return; }
    toast(`${rule.code} on ${DQ_CHANNELS.find((c) => c.id === ch)?.label}: ${cur} → ${next}. Versioned in dq_rule_channels.`, async () => { await setChannelMode(rule.id, ch, cur); setChannels((c) => ({ ...c, [ch]: cur })); });
  }
  const costHint = test?.cost?.length ? test.cost.map((c) => c.error ? `${tableLabel(c.table)}: ${c.error}` : `${tableLabel(c.table)}: ${c.node} · cost ${Number(c.total_cost).toFixed(0)} · ~${c.rows} rows`).join(" · ") : d.kind === "ai" ? "~1.1k tokens per sampled row" : "run a test to see the EXPLAIN cost";

  return (
    <Drawer guard={() => !dirty || window.confirm("Discard unsaved changes to this rule?")} label="Rule editor" onClose={onClose} title={<input className="adm-input" value={d.name} disabled={!canEdit} onChange={(e) => upd({ name: e.target.value })} style={{ width: "100%", fontSize: 17, fontWeight: 600, color: "var(--asb-navy)", border: 0, padding: 0, background: "transparent" }} />}
      head={<div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {isNew ? <input className="adm-input" placeholder="DQ-N01 (auto)" value={d.code} onChange={(e) => upd({ code: e.target.value.toUpperCase() })} style={{ width: 110, fontSize: 11, padding: "2px 6px" }} /> : <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--asb-steel)", letterSpacing: ".04em" }}>{d.code}</span>}
        <Badge cls={SEVERITY_BADGE[d.severity]}>{d.severity}</Badge><Badge cls={SOURCE_BADGE[d.source]}>{d.source}</Badge>
        <span className="dq-muted">v{d.version} · owner {d.owner ?? "—"}{d.enabled ? "" : " · disabled"}</span>
      </div>}>
      <div className="adm-tabs" style={{ borderRadius: 0, padding: "0 10px" }}>
        {(["definition", "preview", "history", "stats"] as Tab[]).map((t) => <button key={t} type="button" className={`adm-tab${tab === t ? " is-on" : ""}`} onClick={() => setTab(t)}>{({ definition: "Definition", preview: "Live preview", history: "Version history", stats: "Statistics" })[t]}</button>)}
      </div>
      <div className="dq-drawer__body">
        {tab === "definition" && (
          <>
            <div className="adm-field"><label className="adm-field__label">Description (plain language — shown to members as the field message)</label><textarea className="adm-textarea" rows={3} value={d.description} disabled={!canEdit} onChange={(e) => upd({ description: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <div className="adm-field"><label className="adm-field__label">Category</label><select className="adm-select" value={d.category} disabled={!canEdit} onChange={(e) => upd({ category: e.target.value as DqRule["category"] })}>{DQ_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="adm-field"><label className="adm-field__label">Severity</label><Seg options={[{ id: "error", label: "error", tip: "Defaults to block on every channel; the Gate tab decides per channel" }, { id: "warn", label: "warn", tip: "Visible but allowed" }, { id: "info", label: "info", tip: "Advisory only" }]} value={d.severity} disabled={!canEdit} onChange={(v) => upd({ severity: v })} /></div>
              <div className="adm-field"><label className="adm-field__label">Kind</label><select className="adm-select" value={d.kind} disabled={!canEdit} onChange={(e) => upd({ kind: e.target.value as DqRule["kind"] })}><option value="declarative">declarative</option><option value="sql">SQL predicate</option><option value="classification">classification</option><option value="ai">AI-assisted</option></select></div>
              <div className="adm-field"><label className="adm-field__label">Auto-fix</label><select className="adm-select" value={d.autofix} disabled={!canEdit} onChange={(e) => upd({ autofix: e.target.value as DqRule["autofix"] })}>{["none", "normalise", "set from registry", "reclassify", "suggest only"].map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
            </div>
            <div className="adm-field"><label className="adm-field__label">Scope · tables</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {boot.tables.map((t) => { const on = d.tables.includes(t.table_name); return <button key={t.table_name} type="button" className={`adm-filter-chip${on ? " is-on" : ""}`} disabled={!canEdit} onClick={() => { if (d.kind === "ai") upd({ tables: on ? d.tables.filter((x) => x !== t.table_name) : [...d.tables, t.table_name] }); else if (on) upd({ tables: d.tables.filter((x) => x !== t.table_name), checks: d.checks.filter((c) => c.table !== t.table_name) }); else upd({ tables: [...d.tables, t.table_name], checks: [...d.checks, { table: t.table_name, field: null, violation_sql: "", expected_text: "" }] }); }}>{t.label}</button>; })}
              </div>
              <span className="dq-muted">A table added here gets its own check below; rules know their tables so the wizard and the gate pick them by table.</span>
            </div>
            <div className="adm-field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><label className="adm-field__label">Kind · {KIND_LABEL[d.kind]}</label><span className="dq-muted">{KIND_HINT[d.kind]}</span></div>
              <textarea className="adm-textarea" rows={2} placeholder="Definition shown in the list (plain summary of the check)" value={d.definition} disabled={!canEdit} onChange={(e) => upd({ definition: e.target.value })} style={{ background: "var(--asb-gray-50)" }} />
            </div>
            {d.kind === "ai" ? (
              <div className="adm-field"><label className="adm-field__label">Natural-language check (sent with the sampled rows)</label><textarea className="adm-textarea" rows={4} value={d.ai_prompt ?? ""} disabled={!canEdit} onChange={(e) => upd({ ai_prompt: e.target.value })} /></div>
            ) : d.checks.map((c, i) => (
              <div key={i} className="adm-card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}><strong style={{ fontSize: 12, color: "var(--asb-navy)" }}>{tableLabel(c.table)}</strong><span className="dq-muted">check {i + 1} of {d.checks.length}</span><span style={{ flex: 1 }} /><input className="adm-input" placeholder="field (column the issue points at)" value={c.field ?? ""} disabled={!canEdit} onChange={(e) => updCheck(i, { field: e.target.value || null })} style={{ width: 220, fontSize: 12, padding: "3px 8px" }} /></div>
                {d.kind === "sql" ? (
                  <div className="adm-field"><label className="adm-field__label">SQL query — a SELECT returning the table&apos;s rows (must include the key column {boot.tables.find((t) => t.table_name === c.table)?.key_column})</label><textarea className="adm-textarea" rows={3} value={c.query_sql ?? ""} disabled={!canEdit} onChange={(e) => updCheck(i, { query_sql: e.target.value })} style={{ fontFamily: "var(--asb-font-mono, monospace)", fontSize: 12 }} /></div>
                ) : (
                  <div className="adm-field"><label className="adm-field__label">Violation — boolean SQL over alias r (true = the row fails)</label><textarea className="adm-textarea" rows={3} value={c.violation_sql ?? ""} disabled={!canEdit} onChange={(e) => updCheck(i, { violation_sql: e.target.value })} style={{ fontFamily: "var(--asb-font-mono, monospace)", fontSize: 12 }} placeholder="r.commission_pct is not null and (r.commission_pct < 0 or r.commission_pct > 10)" /></div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div className="adm-field"><label className="adm-field__label">Expected (text or SQL expression)</label><input className="adm-input" value={c.expected_sql ?? c.expected_text ?? ""} disabled={!canEdit} onChange={(e) => { const v = e.target.value; updCheck(i, /\br\./.test(v) || /\(/.test(v) ? { expected_sql: v, expected_text: null } : { expected_text: v, expected_sql: null }); }} style={{ fontSize: 12 }} /></div>
                  <div className="adm-field"><label className="adm-field__label">Fix expression (SQL → replacement value, optional)</label><input className="adm-input" value={c.fix_sql ?? ""} disabled={!canEdit} onChange={(e) => updCheck(i, { fix_sql: e.target.value || null })} style={{ fontSize: 12, fontFamily: "var(--asb-font-mono, monospace)" }} placeholder="public.fn_normalize_flag(r.flag)" /></div>
                </div>
                <div className="adm-field"><label className="adm-field__label">Message shown on forms (optional; defaults to the description)</label><input className="adm-input" value={c.message ?? ""} disabled={!canEdit} onChange={(e) => updCheck(i, { message: e.target.value || null })} style={{ fontSize: 12 }} /></div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="adm-btn small" onClick={runTest} disabled={testing || !rule.id} title="Run the checks on the live tables (up to 200 matches); nothing is written">{testing ? "Testing…" : "Test on 200 rows"}</button>
              <span className="dq-muted">Cost hint · {costHint}</span>
              {test && <Badge cls="live" style={{ marginLeft: "auto" }}>{fmtInt(test.matches)} of {fmtInt(test.checked)} rows match · {test.ms} ms</Badge>}
            </div>
            {rule.id && (
              <div className="adm-field"><label className="adm-field__label">Enforcement per channel</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
                  {DQ_CHANNELS.map((ch) => { const m = channels[ch.id] ?? defaultMode(d.severity); return (
                    <button key={ch.id} type="button" disabled={!canEdit || d.kind === "ai" || d.kind === "sql"} title={d.kind === "ai" || d.kind === "sql" ? "SQL and AI rules run in batch audits only" : "Click to cycle block → warn → audit-only"} onClick={() => cycle(ch.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, font: "inherit", fontSize: 12, background: "#fff", border: "1px solid var(--asb-gray-200)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ color: "var(--asb-ink-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch.label}</span><Badge cls={MODE_BADGE[m]}>{m === "audit" ? "audit-only" : m}</Badge>
                    </button>); })}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid var(--ccx-line2)" }}>
              <button type="button" className="adm-btn primary" disabled={!canEdit || saving || (!isNew && !dirty)} onClick={doSave}>{saving ? "Saving…" : isNew ? "Create rule" : `Save as v${d.version + 1}`}</button>
              {!isNew && <button type="button" className="adm-btn" disabled={!canEdit} onClick={onDuplicate}>Duplicate</button>}
              {!isNew && <button type="button" className="adm-btn" disabled={!canEdit} onClick={onToggle}>{rule.enabled ? "Disable" : "Enable"}</button>}
              <span style={{ flex: 1 }} />
              {!isNew && <button type="button" className="adm-btn ghost" style={{ color: "var(--asb-red)" }} disabled={!canEdit} onClick={onDelete}>Delete…</button>}
            </div>
          </>
        )}
        {tab === "preview" && (
          <>
            <div style={{ fontSize: 12, color: "var(--asb-ink-secondary)" }}>Live preview — rows matching this rule right now (read-only sample from the live tables). <a href="#" className="adm-link" onClick={(e) => { e.preventDefault(); nav({ tab: "issues", rule: rule.code, view: "open" }); }}>Open issues for {rule.code} →</a></div>
            <div className="adm-table"><table><thead><tr><th>Row</th><th>Field</th><th>Observed</th><th>Expected</th></tr></thead><tbody>
              {testing && <tr className="no-hover"><td colSpan={4} style={{ textAlign: "center", padding: 26 }}>Testing…</td></tr>}
              {!testing && test && test.rows.map((p, i) => <tr key={i} className="no-hover"><td className="mono" style={{ color: "var(--asb-navy)" }}>{p.label}</td><td>{p.field ?? "—"}</td><td style={{ color: "var(--asb-red)" }}>{p.observed ?? "—"}</td><td style={{ color: "var(--asb-green)" }}>{p.expected ?? "—"}</td></tr>)}
              {!testing && test && test.rows.length === 0 && <tr className="no-hover"><td colSpan={4} style={{ textAlign: "center", color: "var(--asb-gray-500)", padding: 26 }}>No rows match — the rule is currently clean.</td></tr>}
            </tbody></table></div>
          </>
        )}
        {tab === "history" && (
          <div className="adm-list">
            {!versions && <div className="dq-muted">Loading…</div>}
            {versions?.map((h) => { const snap = h.snapshot; return (
              <div key={h.id} className="adm-list__row"><span className="adm-list__icon">v{h.version}</span>
                <div className="adm-list__body"><div className="adm-list__title">{h.note ?? "Edited"}</div><div className="adm-list__meta">{h.changed_by_name ?? "—"} · {fmtDateTime(h.changed_at)}</div>
                  <pre className="dq-pre" style={{ marginTop: 6, fontSize: 11, color: "var(--asb-ink-secondary)" }}>{`severity ${snap.severity} · ${snap.category} · ${snap.kind} · autofix ${snap.autofix}${snap.enabled ? "" : " · disabled"}\n${snap.definition ?? ""}`}</pre></div>
                <button type="button" className="adm-btn small" disabled={!canEdit || h.version === rule.version} onClick={async () => { const r = await restoreRuleVersion(rule.id, h.version); if (r.success) { toast(`Restored v${h.version} as v${r.data.version}.`); await onSaved(r.data); } else toast(r.error); }}>Restore</button>
              </div>); })}
          </div>
        )}
        {tab === "stats" && (
          <>
            <div className="adm-stats" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
              <div className="adm-stat"><span className="adm-stat__label">Rows checked</span><span className="adm-stat__value" style={{ fontSize: 21 }}>{fmtInt(st.checked)}</span><span className="adm-stat__sub">last completed run, tables in scope</span></div>
              <div className="adm-stat"><span className="adm-stat__label">Issues</span><span className="adm-stat__value is-red" style={{ fontSize: 21 }}>{fmtInt(st.open)}</span><span className="adm-stat__sub">open now · {fmtInt(st.raised)} ever raised</span></div>
              <div className="adm-stat"><span className="adm-stat__label">False-positive rate</span><span className="adm-stat__value" style={{ fontSize: 21 }}>{st.raised ? `${Math.round((st.fp / st.raised) * 100)} %` : "—"}</span><span className="adm-stat__sub">from &quot;mark false positive&quot;</span></div>
            </div>
            <p className="dq-muted" style={{ margin: 0 }}>Statistics come from dq_issues (status = false_positive ÷ raised). A rate above 10 % surfaces the rule on the Overview as &quot;noisy&quot;.</p>
          </>
        )}
      </div>
    </Drawer>
  );
}
