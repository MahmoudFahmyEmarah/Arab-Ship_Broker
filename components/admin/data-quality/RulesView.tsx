"use client";

// Rules — filterable list grouped by table (rules know their tables, so the
// table chips and the rule rows filter each other) + the rule editor drawer.
import * as React from "react";
import { deleteRule, duplicateRule, exportRulesJson, importWorkbookRules, listRules, saveRule, toggleRule } from "@/app/(admin)/admin/data-quality/actions";
import { DQ_CATEGORIES, SEVERITY_BADGE, SOURCE_BADGE, type DqRule } from "@/lib/dq/types";
import { Badge, Loading, Toggle, downloadText, fmtInt, sevColor } from "./ui";
import { useConsole } from "./DataQualityConsole";
import { RuleDrawer } from "./RuleDrawer";

export function RulesView() {
  const { boot, canEdit, nav, params, tableLabel, toast, confirm } = useConsole();
  const [rules, setRules] = React.useState<DqRule[] | null>(null);
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("all");
  const [sev, setSev] = React.useState("all");
  const [src, setSrc] = React.useState("all");
  const table = params.get("table") ?? "all";
  const ruleCode = params.get("rule");
  const [draft, setDraft] = React.useState<DqRule | null>(null);

  const load = React.useCallback(async () => { const r = await listRules(); if (r.success) setRules(r.data); else toast(r.error); }, [toast]);
  React.useEffect(() => { load(); }, [load]);

  if (!rules) return <Loading />;
  const ql = q.toLowerCase();
  const list = rules.filter((r) => (table === "all" || r.tables.includes(table)) && (cat === "all" || r.category === cat) && (sev === "all" || r.severity === sev) && (src === "all" || r.source === src) && (!ql || `${r.code} ${r.name} ${r.description} ${r.tables.join(" ")}`.toLowerCase().includes(ql)));
  const groupKeys = table === "all" ? boot.tables.map((t) => t.table_name) : [table];
  const groups = groupKeys.map((t) => ({ t, rules: list.filter((r) => r.tables.includes(t)) })).filter((g) => g.rules.length);
  const selected = draft ?? rules.find((r) => r.code === ruleCode) ?? null;
  const rowsOf = (t: string) => boot.tables.find((x) => x.table_name === t);

  const onToggle = async (r: DqRule) => {
    const was = r.enabled;
    setRules((rs) => rs!.map((x) => (x.id === r.id ? { ...x, enabled: !was } : x)));
    const res = await toggleRule(r.id, !was);
    if (!res.success) { toast(res.error); setRules((rs) => rs!.map((x) => (x.id === r.id ? { ...x, enabled: was } : x))); return; }
    toast(`${r.code} ${was ? "disabled" : "enabled"} — the gate applies it on the next write.`, async () => { await toggleRule(r.id, was); await load(); });
  };
  const onDelete = (r: DqRule) => confirm({
    title: `Delete rule ${r.code}?`, label: "Delete rule", danger: true,
    body: 'Open issues raised by this rule stay in the triage table and are marked "rule deleted". Form-time and write-time channels stop applying it immediately.',
    undo: "Soft delete — restore from the toast, or ask the owner within 30 days.",
    run: async () => { const res = await deleteRule(r.id); if (!res.success) { toast(res.error); return; } nav({ rule: null }); await load(); toast(`${r.code} deleted.`, async () => { await deleteRule(r.id, true); await load(); }); },
  });
  const onDuplicate = async (r: DqRule) => { const res = await duplicateRule(r.id); if (!res.success) { toast(res.error); return; } await load(); nav({ rule: res.data.code }); toast(`Duplicated as ${res.data.code} (disabled draft).`); };
  const onNew = () => {
    const t = table === "all" ? "cargo_listings" : table;
    setDraft({ id: "", code: "", name: "New rule", description: "", category: "validity", severity: "warn", kind: "declarative", definition: "", checks: [{ table: t, field: null, violation_sql: "", expected_text: "" }], ai_prompt: null, tables: [t], autofix: "none", enabled: false, queue: true, source: "admin", owner: boot.viewerName, version: 0, created_at: "", updated_at: "", deleted_at: null, stats: { open: 0, raised: 0, fp: 0, checked: 0 }, channels: {} });
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="adm-filterbar">
        <input className="adm-search" placeholder="Search rules — code, name, table, column…" value={q} onChange={(e) => setQ(e.target.value)} title="Filters by code, name and description" />
        <select className="adm-select" value={cat} onChange={(e) => setCat(e.target.value)} title="Rule category"><option value="all">All categories</option>{DQ_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select>
        <select className="adm-select" value={sev} onChange={(e) => setSev(e.target.value)} title="Severity"><option value="all">All severities</option><option value="error">Error</option><option value="warn">Warn</option><option value="info">Info</option></select>
        <select className="adm-select" value={src} onChange={(e) => setSrc(e.target.value)} title="Where the rule came from"><option value="all">All sources</option><option value="built-in">Built-in</option><option value="workbook">Workbook</option><option value="admin">Admin</option><option value="AI-suggested">AI-suggested</option></select>
        <span style={{ flex: 1 }} />
        <button type="button" className="adm-btn small" disabled={!canEdit} title="Re-import the MASTER Cargo Classification Map v2 decision tree and the built-in rules (missing codes only; edited rules are kept)" onClick={async () => { const r = await importWorkbookRules(); if (!r.success) { toast(r.error); return; } await load(); toast(r.data.inserted ? `${r.data.inserted} rule${r.data.inserted > 1 ? "s" : ""} imported.` : "Workbook v2 already imported — every seeded rule is present (no changes)."); }}>Import workbook rules</button>
        <button type="button" className="adm-btn small" title="Download every rule as JSON (dq_rules + dq_rule_channels)" onClick={async () => { const r = await exportRulesJson(); if (r.success) downloadText(`dq-rules-${new Date().toISOString().slice(0, 10)}.json`, r.data, "application/json"); else toast(r.error); }}>Export JSON</button>
        <button type="button" className="adm-btn small primary" disabled={!canEdit} title="Create a declarative, SQL or AI-assisted rule" onClick={onNew}>+ New rule</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="adm-field__label" style={{ marginRight: 4 }}>Table</span>
        {[{ id: "all", label: "All", n: rules.length }, ...boot.tables.map((t) => ({ id: t.table_name, label: t.label, n: rules.filter((r) => r.tables.includes(t.table_name)).length }))].map((c) => (
          <button key={c.id} type="button" className={`adm-filter-chip${table === c.id ? " is-on" : ""}`} title={`Show rules that read ${c.label}`} onClick={() => nav({ table: c.id === "all" ? null : c.id }, true)}>{c.label} <span className="num" style={{ opacity: .7 }}>{c.n}</span></button>
        ))}
        <span className="num" style={{ marginLeft: "auto", fontSize: 11, color: "var(--asb-slate)" }}>{list.length} of {rules.length} rules</span>
      </div>
      {groups.length === 0 && <div className="adm-empty">No rules match these filters.</div>}
      {groups.map((g) => (
        <div key={g.t} className="adm-table" style={{ overflow: "visible" }}>
          <div className="dq-group-head"><strong>{tableLabel(g.t)}</strong><span>{g.rules.length} rules · {g.rules.filter((r) => r.enabled).length} enabled{rowsOf(g.t) ? ` · key ${rowsOf(g.t)!.key_column}` : ""}</span></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ minWidth: 860 }}>
              <thead><tr><th style={{ width: 84 }}>Code</th><th>Rule</th><th>Category</th><th style={{ width: 70 }}>Severity</th><th>Kind</th><th>Auto-fix</th><th>Source</th><th className="num">Open</th><th className="num">FP rate</th><th style={{ width: 60 }}>On</th></tr></thead>
              <tbody>
                {g.rules.map((r) => {
                  const st = r.stats ?? { open: 0, raised: 0, fp: 0, checked: 0 };
                  return (
                    <tr key={r.id} className={r.code === ruleCode ? "is-selected" : ""} onClick={() => { setDraft(null); nav({ rule: r.code }, true); }} title={r.description} style={r.enabled ? undefined : { opacity: .6 }}
                      tabIndex={0} role="button" aria-label={`Open rule ${r.code}`} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDraft(null); nav({ rule: r.code }, true); } }}>
                      <td className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600 }}>{r.code}</td>
                      <td><div style={{ fontWeight: 500, color: "var(--asb-navy)" }}>{r.name}</div><div className="dq-muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 420 }}>{r.tables.map(tableLabel).join(" · ")}</div></td>
                      <td style={{ textTransform: "capitalize" }}>{r.category}</td>
                      <td><Badge cls={SEVERITY_BADGE[r.severity]}>{r.severity}</Badge></td>
                      <td style={{ textTransform: "capitalize" }}>{r.kind}</td>
                      <td style={{ color: "var(--asb-ink-secondary)" }}>{r.autofix}</td>
                      <td><Badge cls={SOURCE_BADGE[r.source]}>{r.source}</Badge></td>
                      <td className="num" style={{ fontWeight: 600, color: st.open ? sevColor(r.severity) : "var(--asb-gray-500)" }}>{fmtInt(st.open)}</td>
                      <td className="num" style={{ color: "var(--asb-gray-500)" }}>{st.raised ? `${Math.round((st.fp / st.raised) * 100)} %` : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}><Toggle on={r.enabled} disabled={!canEdit} title={r.enabled ? "Enabled — click to disable on every channel" : "Disabled — click to enable"} onChange={() => onToggle(r)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {selected && (
        <RuleDrawer
          rule={selected}
          isNew={!selected.id}
          onClose={() => { setDraft(null); nav({ rule: null }, true); }}
          onSaved={async (saved) => { setDraft(null); await load(); nav({ rule: saved.code }, true); }}
          onToggle={() => onToggle(selected)}
          onDuplicate={() => onDuplicate(selected)}
          onDelete={() => onDelete(selected)}
          save={saveRule}
        />
      )}
    </section>
  );
}
