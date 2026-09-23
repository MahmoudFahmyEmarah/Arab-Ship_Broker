"use client";

// Gate — the channels × rules enforcement matrix, the rejection log, and the
// preview of the inline messages each channel shows.
import * as React from "react";
import { listGateLog, listRules, setChannelMode } from "@/app/(admin)/admin/data-quality/actions";
import { DQ_CHANNELS, MODE_BADGE, SEVERITY_BADGE, type DqChannel, type DqGateLogRow, type DqMode, type DqRule } from "@/lib/dq/types";

// Member forms reach fn_dq_validate through the database since 17 Sep 2026
// (trg_*_zz_dq_gate on every authenticated write; shadow until Settings →
// "Enforce on member forms" is on). The partner API channel is honoured by the
// same trigger when a route sets the dq.channel setting — no such route exists
// yet, so its cells are shown, not editable.
const UNWIRED = new Set<DqChannel>(["api"]);
import { Badge, Loading, fmtDateTime } from "./ui";
import { useConsole } from "./DataQualityConsole";

const defaultMode = (s: DqRule["severity"]): DqMode => (s === "error" ? "block" : s === "warn" ? "warn" : "audit");

export function GateView() {
  const { boot, canEdit, nav, params, toast } = useConsole();
  const tab = (params.get("gate") as "matrix" | "log" | "preview") ?? "matrix";
  const table = params.get("table") ?? "all";
  const [rules, setRules] = React.useState<DqRule[] | null>(null);
  const [log, setLog] = React.useState<{ rows: DqGateLogRow[]; total24h: number; formsShare: number } | null>(null);
  const [ch, setCh] = React.useState("all"); const [q, setQ] = React.useState(""); const [days, setDays] = React.useState(1);
  React.useEffect(() => { listRules().then((r) => { if (r.success) setRules(r.data); }); }, []);
  React.useEffect(() => { if (tab === "log") listGateLog({ channel: ch, q, days }).then((r) => { if (r.success) setLog(r.data); else toast(r.error); }); }, [tab, ch, q, days, toast]);

  const cycle = async (r: DqRule, c: DqChannel) => {
    if (!canEdit) return;
    const cur = r.channels?.[c] ?? defaultMode(r.severity);
    const next: DqMode = ({ block: "warn", warn: "audit", audit: "block" } as const)[cur];
    setRules((rs) => rs!.map((x) => (x.id === r.id ? { ...x, channels: { ...x.channels, [c]: next } } : x)));
    const res = await setChannelMode(r.id, c, next);
    if (!res.success) { toast(res.error); setRules((rs) => rs!.map((x) => (x.id === r.id ? { ...x, channels: { ...x.channels, [c]: cur } } : x))); return; }
    toast(`${r.code} on ${DQ_CHANNELS.find((x) => x.id === c)?.label}: ${cur} → ${next}. Versioned in dq_rule_channels.`, async () => { await setChannelMode(r.id, c, cur); setRules((rs) => rs!.map((x) => (x.id === r.id ? { ...x, channels: { ...x.channels, [c]: cur } } : x))); });
  };
  const gateRules = (rules ?? []).filter((r) => r.kind !== "ai" && (table === "all" || r.tables.includes(table)));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <div className="adm-tabs" style={{ border: 0, background: "transparent", padding: 0 }}>{(["matrix", "log", "preview"] as const).map((t) => <button key={t} type="button" className={`adm-tab${tab === t ? " is-on" : ""}`} onClick={() => nav({ gate: t }, true)}>{({ matrix: "Enforcement matrix", log: "Gate log", preview: "Channel previews" })[t]}</button>)}</div>
        <span className="dq-muted" style={{ marginLeft: "auto" }}>fn_dq_validate(table, row, channel) · called by DQ fixes today; wired per write path (see lib/dq/gate.ts)</span>
      </div>
      {tab === "matrix" && (<>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "var(--asb-ink-secondary)" }}>
          <span><Badge cls="rejected">block</Badge> database refuses the row</span><span><Badge cls="pending">warn</Badge> stored with the row, member confirms</span><span><Badge cls="draft">audit</Badge> found only by batch runs</span>
          <select className="adm-select" value={table} onChange={(e) => nav({ table: e.target.value === "all" ? null : e.target.value }, true)} style={{ fontSize: 12, padding: "3px 8px" }}><option value="all">All tables</option>{boot.tables.map((t) => <option key={t.table_name} value={t.table_name}>{t.label}</option>)}</select>
          <span style={{ marginLeft: "auto" }}>Click a cell to cycle · every change is a version in dq_rule_channels · SQL-kind rules run in batch audits only</span>
        </div>
        {!rules ? <Loading /> : (
          <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 900 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}><tr><th style={{ minWidth: 260 }}>Rule</th>{DQ_CHANNELS.map((c) => <th key={c.id} style={{ textAlign: "center" }} title={c.label}>{c.label}<div style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", color: "var(--asb-gray-500)" }}>{c.sub}</div>{UNWIRED.has(c.id) && <div style={{ fontWeight: 600, letterSpacing: 0, textTransform: "none", color: "var(--asb-amber)" }}>not wired yet</div>}</th>)}</tr></thead>
            <tbody>{gateRules.map((r) => (
              <tr key={r.id} className="no-hover" style={r.enabled ? undefined : { opacity: .45 }}>
                <td><span className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600, marginRight: 6 }}>{r.code}</span><span style={{ fontSize: 12 }}>{r.name}</span><Badge cls={SEVERITY_BADGE[r.severity]} style={{ marginLeft: 6 }}>{r.severity}</Badge></td>
                {DQ_CHANNELS.map((c) => { const m = r.channels?.[c.id] ?? defaultMode(r.severity); const sqlOnly = r.kind === "sql"; const unwired = UNWIRED.has(c.id); return <td key={c.id} style={{ textAlign: "center", padding: "4px 6px", opacity: unwired ? 0.45 : 1 }}><button type="button" className={`adm-badge ${sqlOnly ? "expired" : MODE_BADGE[m]} dq-mode-cell`} disabled={!canEdit || sqlOnly || unwired} title={sqlOnly ? "SQL predicate — batch audits only" : unwired ? `${c.label} is not wired to the gate yet — this mode has no effect until it is` : `${r.code} on ${c.label} — click to cycle`} onClick={() => cycle(r, c.id)}>{sqlOnly ? "audit" : m}</button></td>; })}
              </tr>))}</tbody>
          </table></div><div className="adm-table__foot"><span>{gateRules.length} rules × {DQ_CHANNELS.length} channels · disabled rules shown dimmed</span><span>Filter by table applies here too</span></div></div>
        )}
      </>)}
      {tab === "log" && (<>
        <div className="adm-filterbar">
          <input className="adm-search" placeholder="Search rejections — rule, actor, message…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="adm-select" value={ch} onChange={(e) => setCh(e.target.value)}><option value="all">All channels</option>{DQ_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <select className="adm-select" value={days} onChange={(e) => setDays(+e.target.value)}><option value={1}>Last 24 h</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select>
          <span className="dq-muted" style={{ marginLeft: "auto", color: "var(--asb-slate)" }}>{log ? `${log.total24h} rejections in 24 h${log.total24h ? ` · ${log.formsShare} % from member forms` : ""}` : "…"}</span>
        </div>
        {!log ? <Loading /> : (
          <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 900 }}><thead><tr><th>Time</th><th>Channel</th><th>Rule</th><th>Actor</th><th>Message shown</th><th>Row</th><th>Payload</th><th /></tr></thead><tbody>
            {log.rows.length === 0 && <tr className="no-hover"><td colSpan={8} style={{ textAlign: "center", padding: 26, color: "var(--asb-gray-500)" }}>No rejections in this window. Block-mode rules log here whenever the gate refuses a row (DQ fixes today; each write path as it is wired).</td></tr>}
            {log.rows.map((l) => <tr key={l.id} className="no-hover"><td className="mono" style={{ color: "var(--asb-ink)" }}>{fmtDateTime(l.at)}</td><td><Badge cls="closed">{DQ_CHANNELS.find((c) => c.id === l.channel)?.label ?? l.channel}</Badge></td><td className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600 }}><a href="#" className="adm-link" onClick={(e) => { e.preventDefault(); nav({ tab: "rules", rule: l.rule_code }); }}>{l.rule_code}</a></td><td>{l.actor ?? "—"}</td><td style={{ maxWidth: 320 }}>{l.message}</td><td className="mono">{l.table_name ? `${l.table_name} · ${l.row_key ?? "new"}` : "—"}</td><td className="mono" title={l.payload_hash ?? ""}>{l.payload_hash ? `sha256 · ${l.payload_hash.slice(0, 4)}…${l.payload_hash.slice(-4)}` : "—"}</td><td style={{ textAlign: "right" }}><button type="button" className="adm-btn small ghost" title="Open the rule's channel modes to tune it" onClick={() => nav({ tab: "rules", rule: l.rule_code })}>Tune</button></td></tr>)}
          </tbody></table></div></div>
        )}
      </>)}
      {tab === "preview" && (<>
        <p style={{ margin: 0, fontSize: 12, color: "var(--asb-ink-secondary)" }}>The same rule, rendered on each channel. Member surfaces use the portal&apos;s visual language (soft card, 15 px body); the gate returns the same issue object to every one.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
          <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="adm-card__title" style={{ padding: "8px 14px", background: "var(--asb-gray-100)" }}>Member form · inline field message</div>
            <div style={{ padding: "16px 18px", fontSize: 15, display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--asb-ink-soft)", marginBottom: 5 }}>IMO number</label><input className="adm-input" value="931234" readOnly style={{ borderColor: "var(--asb-red)", fontSize: 15, width: "100%" }} /><div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6, fontSize: 13, color: "var(--asb-red)" }}><span aria-hidden style={{ fontWeight: 700 }}>!</span><span><strong>IMO must be 7 digits with a valid check digit.</strong> It is required before this position goes live (DQ-V04 · block on member forms).</span></div></div>
              <div><label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--asb-ink-soft)", marginBottom: 5 }}>Open port</label><input className="adm-input" value="Jebel Ali" readOnly style={{ borderColor: "var(--asb-amber)", fontSize: 15, width: "100%" }} /><div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6, fontSize: 13, color: "var(--asb-amber)" }}><span aria-hidden style={{ fontWeight: 700 }}>!</span><span>Resolved to <strong>AEJEA · Jebel Ali</strong> (zone AG). Confirm or pick another port (DQ-P02 · warn).</span></div></div>
            </div>
          </div>
          <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="adm-card__title" style={{ padding: "8px 14px", background: "var(--asb-gray-100)" }}>Member form · pre-submit summary</div>
            <div style={{ padding: "16px 18px", fontSize: 15 }}><div className="adm-card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)" }}>Before you post this position</div>
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
                <li style={{ display: "flex", gap: 8 }}><Badge cls="rejected">Fix</Badge><span>IMO number is missing a digit — the position cannot go live without it.</span></li>
                <li style={{ display: "flex", gap: 8 }}><Badge cls="pending">Confirm</Badge><span>Open port read as <strong>AEJEA · Jebel Ali</strong>.</span></li>
                <li style={{ display: "flex", gap: 8 }}><Badge cls="pending">Confirm</Badge><span>Open date is 19 days before the earliest laycan in AG — allowed, but you may get fewer matches.</span></li>
              </ul>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button type="button" className="adm-btn primary" disabled>Post position</button><button type="button" className="adm-btn">Back to form</button></div>
              <p className="dq-muted" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--asb-slate)" }}>1 item must be fixed · 2 confirmed on submit</p>
            </div></div>
          </div>
          <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="adm-card__title" style={{ padding: "8px 14px", background: "var(--asb-gray-100)" }}>Admin · Manual Review dictionary dialog</div>
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="adm-field"><label className="adm-field__label">Market name (display alias)</label><input className="adm-input" value="Steel Coils" readOnly /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div className="adm-field"><label className="adm-field__label">Regime</label><select className="adm-select" defaultValue="CSS"><option>CSS</option><option>IMSBC</option><option>GRAIN</option></select></div><div className="adm-field"><label className="adm-field__label">Official code (identity)</label><input className="adm-input" value="CSS-06 · Coils" readOnly /></div></div>
              <div className="adm-field"><label className="adm-field__label">Cargo type · derived from regime</label><div style={{ display: "flex", gap: 6, alignItems: "center" }}><input className="adm-input" value="Dry Bulk" readOnly style={{ borderColor: "var(--asb-red)", flex: 1 }} /><Badge cls="rejected">Conflict</Badge></div><div style={{ fontSize: 12, color: "var(--asb-red)" }}>CSS ⇒ Break Bulk. Finished steel is never Dry Bulk (DQ-D02, DQ-D03). Saving is disabled until the pair agrees.</div></div>
              <div className="adm-field"><label className="adm-field__label">Hazard (replaces &quot;Dangerous goods&quot;)</label><div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}><Badge cls="inactive">IMSBC class —</Badge><label style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" disabled /> MHB</label><label style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" disabled /> Marine pollutant</label><span className="dq-muted">UN no. / IMO class apply to packaged CSS cargo only</span></div></div>
            </div>
          </div>
          <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="adm-card__title" style={{ padding: "8px 14px", background: "var(--asb-gray-100)" }}>Data Sync commit · row flag</div>
            <div style={{ padding: "16px 18px" }}><div className="adm-table"><table><thead><tr><th>#</th><th>REF</th><th>Load port</th><th>Flags</th></tr></thead><tbody><tr className="no-hover"><td className="row-num">412</td><td className="mono">CM-1188</td><td>Iskenderun</td><td><Badge cls="pending">warn · DQ-P02</Badge></td></tr><tr className="no-hover"><td className="row-num">413</td><td className="mono">—</td><td>Sohar</td><td><Badge cls="rejected">Needs fixing · DQ-K01</Badge></td></tr></tbody></table></div><p className="dq-muted" style={{ margin: "8px 0 0" }}>Block rules on the sync channel stop the commit for that row only; warn results are stored in sync_staged_row.flags and travel with the row.</p></div>
          </div>
        </div>
      </>)}
    </section>
  );
}
