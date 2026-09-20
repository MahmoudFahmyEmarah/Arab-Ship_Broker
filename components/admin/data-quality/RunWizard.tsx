"use client";

// New run — four steps: scope → rules → mode → execution, with a live summary.
import * as React from "react";
import { createRun, estimateScope, listRules } from "@/app/(admin)/admin/data-quality/actions";
import { SEVERITY_BADGE, type DqRule, type DqRunMode, type DqScope } from "@/lib/dq/types";
import { Badge, Seg, Toggle, fmtInt } from "./ui";
import { useConsole } from "./DataQualityConsole";

type Est = { tables: { table: string; rows: number }[]; table_names: string[]; total_rows: number; batches: number };

export function RunWizard() {
  const { boot, nav, tableLabel, toast, canRun } = useConsole();
  const [step, setStep] = React.useState(1);
  const [scopeKind, setScopeKind] = React.useState<DqScope["kind"]>("db");
  const [tables, setTables] = React.useState<string[]>(["cargo_listings", "vessel_availability"]);
  const [filter, setFilter] = React.useState<"live" | "sync" | "open">("live");
  const [rulesMode, setRulesMode] = React.useState<"all" | "pick">("all");
  const [picked, setPicked] = React.useState<Record<string, boolean>>({});
  const [mode, setMode] = React.useState<DqRunMode>(boot.activeModel ? "both" : "rules");
  const [batch, setBatch] = React.useState(boot.settings.batch_size);
  const [when, setWhen] = React.useState<"now" | "nightly">("now");
  const [notify, setNotify] = React.useState(true);
  const [rules, setRules] = React.useState<DqRule[]>([]);
  const [est, setEst] = React.useState<Est | null>(null);
  const [starting, setStarting] = React.useState(false);
  const scopeKey = `${scopeKind}|${tables.join(",")}|${filter}`;
  const scope = React.useMemo<DqScope>(() => (scopeKind === "db" ? { kind: "db" } : scopeKind === "tables" ? { kind: "tables", tables } : { kind: "filter", filter }), [scopeKind, tables, filter]);

  React.useEffect(() => { listRules().then((r) => { if (r.success) setRules(r.data.filter((x) => x.enabled)); }); }, []);
  // settle the slider / chips for 300 ms before counting every table in scope (audit P6)
  React.useEffect(() => { let alive = true; setEst(null); const t = setTimeout(() => { estimateScope(scope, batch).then((r) => { if (alive && r.success) setEst(r.data); }); }, 300); return () => { alive = false; clearTimeout(t); }; }, [scope, batch, scopeKey]);

  const scopeTables = est?.table_names ?? [];
  const applicable = rules.filter((r) => r.tables.some((t) => scopeTables.includes(t)));
  const chosen = rulesMode === "all" ? applicable : applicable.filter((r) => picked[r.id]);
  const sample = boot.settings.ai_sample;
  const batches = est?.batches ?? 0;
  const tokens = batches * sample * 1100;
  const cost = (tokens / 1e6) * Number(boot.settings.ai_price_per_mtok);
  const budgetLeft = Math.max(0, Number(boot.settings.ai_daily_tokens) - boot.aiToday.tokens);
  const steps = [["Scope", scopeKind === "db" ? "Whole database" : scopeKind === "tables" ? `${tables.length} tables` : "Filtered"], ["Rules", `${chosen.length} rules`], ["Mode", ({ rules: "Rule-based", ai: "AI review", both: "Rules + AI" })[mode]], ["Execution", when === "now" ? "Run now" : `Nightly ${boot.settings.nightly_time}`]];

  async function start() {
    if (!est || est.total_rows === 0) { toast("The scope has no rows."); return; }
    if (mode !== "rules" && !boot.activeModel) { toast("No active LLM key — choose Rule-based or add a key in Data Sync → Settings."); return; }
    setStarting(true);
    const r = await createRun({ scope, mode, batch, ruleIds: rulesMode === "all" ? null : chosen.map((x) => x.id), when, notify });
    setStarting(false);
    if (!r.success) { toast(r.error); return; }
    if (when === "nightly") { toast(`Scheduled nightly at ${boot.settings.nightly_time} UTC — visible in Runs as queued.`); nav({ tab: "runs" }); return; }
    nav({ tab: "progress", run: r.data.id });
  }

  return (
    <section className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--asb-line)", background: "var(--asb-gray-100)", overflowX: "auto" }}>
        {steps.map(([label, sub], i) => { const n = i + 1; const on = step === n, done = step > n; return (
          <button key={label} type="button" className={`dq-wizard-step${on ? " is-on" : ""}`} onClick={() => setStep(n)}>
            <span className={`dq-step-dot${on || done ? " is-on" : ""}`}>{n}</span>
            <span><span className="adm-field__label" style={{ display: "block" }}>Step {n}</span><span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--asb-navy)" }}>{label}</span><span className="dq-muted">{sub}</span></span>
          </button>); })}
      </div>
      <div className="dq-two" style={{ padding: "18px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {step === 1 && (<>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)" }}>What should this run look at?</div>
            <div className="dq-modes">
              {([["db", "Whole database", `${est && scopeKind === "db" ? fmtInt(est.total_rows) : "every"} rows across ${boot.tables.length} tables`], ["tables", "Selected tables", "Pick one or more tables"], ["filter", "A filter", "Live cargo + open positions · last sync batch · open positions"]] as const).map(([id, label, desc]) => (
                <button key={id} type="button" className={`asd-mode${scopeKind === id ? " is-on" : ""}`} onClick={() => setScopeKind(id)} style={{ minHeight: 0 }}><span className="asd-mode__name">{label}</span><span className="asd-mode__desc">{desc}</span></button>
              ))}
            </div>
            {scopeKind === "tables" && <div className="adm-field"><label className="adm-field__label">Tables</label><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{boot.tables.map((t) => <button key={t.table_name} type="button" className={`adm-filter-chip${tables.includes(t.table_name) ? " is-on" : ""}`} onClick={() => setTables((x) => (x.includes(t.table_name) ? x.filter((y) => y !== t.table_name) : [...x, t.table_name]))}>{t.label}</button>)}</div></div>}
            {scopeKind === "filter" && <div className="adm-field"><label className="adm-field__label">Filter</label><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {([["live", "Live cargo + open positions", "cargo_listings IN/PARTIAL approved · vessel_availability OPEN"], ["sync", "Last sync batch", "rows committed by the most recent Data Sync batch"], ["open", "Open positions", "vessel_availability status OPEN"]] as const).map(([id, label, tip]) => <button key={id} type="button" className={`adm-filter-chip${filter === id ? " is-on" : ""}`} title={tip} onClick={() => setFilter(id)}>{label}</button>)}
            </div></div>}
            {est && <div className="dq-muted">{est.tables.map((t) => `${tableLabel(t.table)} ${fmtInt(t.rows)}`).join(" · ") || "no tables in scope"}</div>}
          </>)}
          {step === 2 && (<>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)" }}>Which rules?</div>
            <Seg options={[{ id: "all", label: `All rules for the scope (${applicable.length})` }, { id: "pick", label: "Hand-pick" }]} value={rulesMode} onChange={(v) => { setRulesMode(v); if (v === "pick" && !Object.keys(picked).length) setPicked(Object.fromEntries(applicable.map((r) => [r.id, true]))); }} />
            <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 520 }}><thead><tr><th style={{ width: 36 }} /><th>Rule</th><th>Applies to</th><th>Severity</th></tr></thead><tbody>
              {applicable.map((r) => <tr key={r.id} className="no-hover"><td><input type="checkbox" checked={rulesMode === "all" || !!picked[r.id]} disabled={rulesMode === "all"} onChange={() => setPicked((p) => ({ ...p, [r.id]: !p[r.id] }))} aria-label={`Include ${r.code}`} /></td><td><span className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600, marginRight: 6 }}>{r.code}</span>{r.name}{r.kind === "ai" && <span className="dq-muted"> · AI mode only</span>}{r.checks.length === 0 && r.kind !== "ai" && <span className="dq-muted"> · match-time rule, not batch-evaluated</span>}</td><td className="dq-muted">{r.tables.filter((t) => scopeTables.includes(t)).map(tableLabel).join(" · ")}</td><td><Badge cls={SEVERITY_BADGE[r.severity]}>{r.severity}</Badge></td></tr>)}
              {applicable.length === 0 && <tr className="no-hover"><td colSpan={4} style={{ textAlign: "center", padding: 20, color: "var(--asb-gray-500)" }}>No enabled rule reads the tables in this scope.</td></tr>}
            </tbody></table></div></div>
          </>)}
          {step === 3 && (<>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)" }}>How should the rows be checked?</div>
            <div className="dq-modes">
              {([["rules", "Rule-based", "Declarative + SQL rules only. Free, deterministic."], ["ai", "AI review", "Model reads sampled rows and finds what the rules miss."], ["both", "Both", "Rules first, then AI on the same batches."]] as const).map(([id, label, desc]) => (
                <button key={id} type="button" className={`asd-mode${mode === id ? " is-on" : ""}`} onClick={() => setMode(id)}><span className="asd-mode__name">{label}</span><span className="asd-mode__desc">{desc}</span></button>
              ))}
            </div>
            {mode !== "rules" && (
              <div className="adm-page__warn" style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
                <div style={{ fontWeight: 600 }}>How AI review samples</div>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>Each batch sends <strong>{sample} rows</strong> to the model, PII masked (contact columns dropped in the database, e-mails and phones scrubbed), together with the rules that apply to the table and general data-quality heuristics. The model returns proposed issues with a confidence and an evidence snippet; it never writes.</div>
                <div className="num" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}><span><strong>{fmtInt(tokens)}</strong> tokens est.</span><span><strong>${cost.toFixed(2)}</strong> est. cost</span><span><strong>{fmtInt(budgetLeft)}</strong> tokens left today (cap {fmtInt(boot.settings.ai_daily_tokens)})</span><span className="dq-muted">Model: {boot.activeModel ? `${boot.activeModel.model} · ${boot.activeModel.vendor}` : "none active"} · vendor-agnostic credential in Vault</span></div>
                {tokens > budgetLeft && <div style={{ fontSize: 12, color: "var(--asb-amber)" }}>Estimate exceeds today&apos;s remaining budget — AI review stops at the cap; rule-based checks continue.</div>}
              </div>
            )}
          </>)}
          {step === 4 && (<>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--asb-navy)" }}>Execution</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
              <div className="adm-field"><label className="adm-field__label">Batch size · {fmtInt(batch)} rows</label><input type="range" min={100} max={5000} step={100} value={batch} onChange={(e) => setBatch(+e.target.value)} title="Rows per batch — each batch runs within the 60 s budget and re-schedules itself" /><span className="dq-muted">{batches} batches for {fmtInt(est?.total_rows ?? 0)} rows</span></div>
              <div className="adm-field"><label className="adm-field__label">When</label><Seg options={[{ id: "now", label: "Run now" }, { id: "nightly", label: `Schedule nightly ${boot.settings.nightly_time}` }]} value={when} onChange={setWhen} /></div>
              <div className="adm-field"><label className="adm-field__label">Notify on completion</label><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><Toggle on={notify} onChange={setNotify} />{(boot.settings.notify.recipients ?? []).join(" · ") || "recipients in Settings"}</label></div>
            </div>
            <p style={{ fontSize: 12, color: "var(--asb-ink-secondary)", margin: 0, background: "var(--asb-gray-50)", borderRadius: 10, padding: "10px 12px" }}>Runs read by primary-key range and never lock member-facing tables. Issues land in dq_issues as each batch finishes; fixes are only ever applied by an admin afterwards.</p>
          </>)}
          <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--ccx-line2)" }}>
            <button type="button" className="adm-btn" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>Back</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn ghost" onClick={() => nav({ tab: "overview" })}>Cancel</button>
            {step < 4 && <button type="button" className="adm-btn primary" onClick={() => setStep((s) => Math.min(4, s + 1))}>Continue</button>}
            {step === 4 && <button type="button" className="adm-btn primary" onClick={start} disabled={starting || !est || !canRun} title={canRun ? "Runs in batches within the 60 s budget; never locks member tables" : "Starting audits needs the run permission on Data quality"}>{starting ? "Starting…" : when === "now" ? "Start run" : "Schedule"}</button>}
          </div>
        </div>
        <aside className="adm-card" style={{ background: "var(--asb-gray-50)", alignSelf: "start" }}>
          <div className="adm-card__title" style={{ marginBottom: 10 }}>Run summary</div>
          <div className="adm-kv" style={{ gridTemplateColumns: "96px 1fr" }}>
            <span className="adm-kv__k">Scope</span><span className="adm-kv__v">{steps[0][1]}</span>
            <span className="adm-kv__k">Rows</span><span className="adm-kv__v num">{est ? fmtInt(est.total_rows) : "…"}</span>
            <span className="adm-kv__k">Rules</span><span className="adm-kv__v">{chosen.length} of {rules.length}</span>
            <span className="adm-kv__k">Mode</span><span className="adm-kv__v">{steps[2][1]}</span>
            <span className="adm-kv__k">Batches</span><span className="adm-kv__v num">{batches} × {fmtInt(batch)}</span>
            <span className="adm-kv__k">AI cost</span><span className="adm-kv__v num">{mode === "rules" ? "—" : `$${cost.toFixed(2)}`}</span>
            <span className="adm-kv__k">Schedule</span><span className="adm-kv__v">{when === "now" ? "Now" : `Nightly ${boot.settings.nightly_time} UTC`}</span>
          </div>
          <div className="dq-muted" style={{ marginTop: 12 }}>Rules know their tables: {scopeTables.map((t) => `${tableLabel(t)} ${rules.filter((r) => r.tables.includes(t)).length}`).join(" · ") || "—"}</div>
        </aside>
      </div>
    </section>
  );
}
