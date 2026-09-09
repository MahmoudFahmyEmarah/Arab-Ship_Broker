"use client";

// Settings — engine defaults, AI sampling and budget, health-score weights,
// notifications, and who may edit rules vs only view and run.
import * as React from "react";
import Link from "next/link";
import { saveSettings } from "@/app/(admin)/admin/data-quality/actions";
import { ADMIN_PRESETS, ADMIN_PRESET_ORDER } from "@/lib/admin/sections";
import type { DqSettings } from "@/lib/dq/types";
import { Badge, Toggle, fmtInt } from "./ui";
import { useConsole } from "./DataQualityConsole";

export function SettingsView() {
  const { boot, canEdit, toast, refreshBoot } = useConsole();
  const [s, setS] = React.useState<DqSettings>(boot.settings);
  const [saving, setSaving] = React.useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(boot.settings);
  const set = (p: Partial<DqSettings>) => setS((x) => ({ ...x, ...p }));
  const used = boot.aiToday.tokens; const pctUsed = Math.min(100, Math.round((used / Math.max(1, Number(s.ai_daily_tokens))) * 100));
  const perDay = (Number(s.ai_daily_tokens) / 1e6) * Number(s.ai_price_per_mtok);

  const save = async () => {
    setSaving(true);
    const r = await saveSettings(s);
    setSaving(false);
    if (!r.success) { toast(r.error); return; }
    setS(r.data); await refreshBoot();
    toast(`Settings saved (v${r.data.version}). Previous values kept in the audit log.`);
  };
  const access = (id: string, tier?: "super") => {
    const lvl = tier === "super" ? "edit" : (ADMIN_PRESETS[id]?.perms.dataquality ?? "none");
    const cells = lvl === "edit" ? ["edit", "run", "edit", "edit", id === "it" ? "view" : "edit"] : lvl === "view" ? ["view", "run", "view", "view", "none"] : ["none", "none", "none", "none", "none"];
    return cells;
  };

  return (
    <section className="dq-settings">
      <div className="adm-card dq-settings__card"><div className="adm-card__head"><span className="adm-card__title">Engine</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="adm-field"><label className="adm-field__label">Default batch size · {fmtInt(s.batch_size)} rows</label><input type="range" min={500} max={1000} step={100} value={s.batch_size} disabled={!canEdit} onChange={(e) => set({ batch_size: +e.target.value })} /><span className="dq-muted">One batch per invocation within the 60 s budget; the run re-schedules itself until done.</span></div>
          <div className="adm-field"><label className="adm-field__label">Nightly schedule</label><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><input className="adm-input" value={s.nightly_time} style={{ width: 72 }} disabled={!canEdit} onChange={(e) => set({ nightly_time: e.target.value })} /><span style={{ fontSize: 12, whiteSpace: "nowrap" }}>UTC</span><select className="adm-select" value={s.nightly_mode} disabled={!canEdit} onChange={(e) => set({ nightly_mode: e.target.value as DqSettings["nightly_mode"] })} style={{ fontSize: 12, padding: "5px 8px" }}><option value="rules">rules</option><option value="ai">AI review</option><option value="both">rules + AI</option></select><span style={{ marginLeft: "auto" }}><Toggle on={s.nightly_enabled} disabled={!canEdit} onChange={(v) => set({ nightly_enabled: v })} title={s.nightly_enabled ? "Nightly run enabled" : "Nightly run disabled"} /></span></div><span className="dq-muted">Whole database. The Vercel cron fires at 22:00 UTC (see vercel.json); the time here is recorded on the queued run.</span></div>
          <div className="adm-field"><label className="adm-field__label">Registry refresh</label><span style={{ fontSize: 12 }}>{s.registry_release ? `UN/LOCODE ${s.registry_release} in use.` : "No release imported yet."} Two releases a year — refresh from the Ports registry tab.</span></div>
        </div>
      </div>
      <div className="adm-card dq-settings__card"><div className="adm-card__head"><span className="adm-card__title">AI review</span><span className="adm-card__sub">credential managed in Data Sync</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="adm-field"><label className="adm-field__label">Active model (read-only here)</label><input className="adm-input" value={boot.activeModel ? `${boot.activeModel.model} · ${boot.activeModel.vendor}` : "none active"} readOnly /><span className="dq-muted">One Vault-stored key; vendor-agnostic (Anthropic, OpenAI-compatible, Gemini). Managed in <Link href="/admin/data-sync?view=settings" className="adm-link" style={{ fontSize: 11 }}>Data Sync → Settings</Link>.</span></div>
          <div className="adm-field"><label className="adm-field__label">Sample size per batch · {s.ai_sample} rows</label><input type="range" min={10} max={100} step={10} value={s.ai_sample} disabled={!canEdit} onChange={(e) => set({ ai_sample: +e.target.value })} /></div>
          <div className="adm-field"><label className="adm-field__label">Daily token budget</label><input className="adm-input num" value={s.ai_daily_tokens} style={{ width: 140 }} disabled={!canEdit} onChange={(e) => set({ ai_daily_tokens: Number(e.target.value.replace(/\D/g, "")) || 0 })} /><span className="dq-muted num">≈ ${perDay.toFixed(2)} / day at ${s.ai_price_per_mtok} per Mtok · used today {fmtInt(used)} ({pctUsed} %)</span><div style={{ height: 6, borderRadius: 3, background: "var(--asb-gray-100)", overflow: "hidden" }}><div style={{ height: "100%", width: `${pctUsed}%`, background: pctUsed >= 80 ? "var(--asb-amber)" : "var(--asb-steel)" }} /></div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="adm-field"><label className="adm-field__label">Price per million tokens ($)</label><input className="adm-input" value={s.ai_price_per_mtok} disabled={!canEdit} onChange={(e) => set({ ai_price_per_mtok: Number(e.target.value) || 0 })} /></div>
            <div className="adm-field"><label className="adm-field__label">Auto-apply threshold</label><input className="adm-input" value={s.auto_apply_threshold} disabled={!canEdit} onChange={(e) => set({ auto_apply_threshold: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} /></div>
          </div>
          <span className="dq-muted">Fixes with confidence ≥ threshold may be approved in bulk; below it, per-row review is required. PII columns never leave the database before sampling.</span>
        </div>
      </div>
      <div className="adm-card dq-settings__card"><div className="adm-card__head"><span className="adm-card__title">Health-score weights</span><span className="adm-card__sub">score = 100 − Σ(open × weight) ÷ rows × 100</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {([["error", "Error", "rejected"], ["warn", "Warn", "pending"], ["info", "Info", "draft"]] as const).map(([k, label, badge]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "70px 1fr 44px", gap: 10, alignItems: "center" }}><Badge cls={badge}>{label}</Badge><input type="range" min={0} max={5} step={0.1} value={s.weights[k]} disabled={!canEdit} onChange={(e) => set({ weights: { ...s.weights, [k]: +e.target.value } })} /><span className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{s.weights[k]}</span></div>
          ))}
          <span className="dq-muted">Changing weights recomputes every tile on the Overview; snapshots keep the old scores.</span>
        </div>
      </div>
      <div className="adm-card dq-settings__card"><div className="adm-card__head"><span className="adm-card__title">Notifications</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div className="adm-field"><label className="adm-field__label">Recipients (comma-separated e-mails)</label><input className="adm-input" value={(s.notify.recipients ?? []).join(", ")} disabled={!canEdit} onChange={(e) => set({ notify: { ...s.notify, recipients: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} placeholder="ops@arabshipbroker.com" /></div>
          {([["on_complete", "Run completed or failed"], ["on_errors", "New error issues after the nightly run"], ["digest", "AI suggestions waiting > 3 days → weekly digest"], ["budget80", "AI budget 80 % reached"]] as const).map(([k, label]) => (
            <label key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!s.notify[k]} disabled={!canEdit} onChange={(e) => set({ notify: { ...s.notify, [k]: e.target.checked } })} />{label}</label>
          ))}
          <span className="dq-muted">Delivery uses the platform mailer once recipients are set; the flags are stored now.</span>
        </div>
      </div>
      <div className="adm-card dq-settings__wide"><div className="adm-card__head"><span className="adm-card__title">Who may edit rules</span><span className="adm-card__sub">owner and the IT preset edit; Broker views and runs; other presets have no access (Admin accounts)</span></div>
        <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 560 }}><thead><tr><th>Preset</th><th>Rules</th><th>Run audits</th><th>Fix issues</th><th>Gate matrix</th><th>Settings</th></tr></thead><tbody>
          {[{ label: "Owner (super)", cells: access("", "super") }, ...ADMIN_PRESET_ORDER.map((id) => ({ label: ADMIN_PRESETS[id].label, cells: access(id) }))].map((p) => (
            <tr key={p.label} className="no-hover"><td style={{ fontWeight: 600, color: "var(--asb-navy)" }}>{p.label}</td>{p.cells.map((c, i) => <td key={i}><Badge cls={c === "edit" ? "live" : c === "view" ? "closed" : c === "run" ? "tier" : "inactive"}>{c}</Badge></td>)}</tr>
          ))}
        </tbody></table></div></div>
      </div>
      <div className="dq-settings__wide" style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 4 }}><span className="dq-muted">Settings are versioned (v{s.version}); the previous value is one click away in the audit log.</span><span style={{ flex: 1 }} /><button type="button" className="adm-btn" disabled={!canEdit || !dirty} onClick={() => setS(boot.settings)}>Discard</button><button type="button" className="adm-btn primary" disabled={!canEdit || !dirty || saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button></div>
    </section>
  );
}
