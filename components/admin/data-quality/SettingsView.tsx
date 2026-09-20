"use client";

// Settings — engine defaults, AI sampling and budget, health-score weights,
// notifications, and who may edit rules vs only view and run.
import * as React from "react";
import Link from "next/link";
import { getScheduleState, listConfigEvents, listNotifications, requeueNotification, saveSettings, type DqConfigEvent } from "@/app/(admin)/admin/data-quality/actions";
import { ADMIN_PRESETS, ADMIN_PRESET_ORDER } from "@/lib/admin/sections";
import { NOTIFICATION_BADGE, NOTIFICATION_KIND_LABEL, notificationState } from "@/lib/dq/types";
import type { DqNotification, DqScheduleState, DqSettings } from "@/lib/dq/types";
import { Badge, Loading, Toggle, fmtDateTime, fmtInt } from "./ui";
import { useConsole } from "./DataQualityConsole";

const CONFIG_KIND: Record<string, string> = { channel_mode: "Gate mode", settings: "Settings", notification: "Notification" };
const fmtVal = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
function describeEvent(e: DqConfigEvent): string {
  if (e.kind === "notification") {
    const a = e.after ?? {};
    return `${a.ok ? "sent" : "not sent"} to ${(Array.isArray(a.to) ? a.to : []).join(", ")} — ${String(a.subject ?? "")}${a.ok ? "" : ` (${String(a.detail ?? "")})`}`;
  }
  const keys = Array.from(new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})]));
  return keys.map((k) => `${k}: ${fmtVal(e.before?.[k])} → ${fmtVal(e.after?.[k])}`).join(" · ") || "—";
}

export function SettingsView() {
  const { boot, canEdit, toast, refreshBoot } = useConsole();
  const [s, setS] = React.useState<DqSettings>(boot.settings);
  const [saving, setSaving] = React.useState(false);
  const [events, setEvents] = React.useState<DqConfigEvent[] | null>(null);
  const [notes, setNotes] = React.useState<DqNotification[] | null>(null);
  const [schedule, setSchedule] = React.useState<DqScheduleState | null>(null);
  const loadEvents = React.useCallback(async () => {
    const [r, n, sc] = await Promise.all([listConfigEvents(40), listNotifications(40), getScheduleState()]);
    setEvents(r.success ? r.data : []); setNotes(n.success ? n.data : []); setSchedule(sc.success ? sc.data : null);
  }, []);
  const requeue = async (id: number) => { const r = await requeueNotification(id); if (!r.success) { toast(r.error); return; } toast(r.data.requeued ? "Queued again — delivery is being attempted now." : "That notification is not in a failed state."); void loadEvents(); };
  React.useEffect(() => { void loadEvents(); }, [loadEvents]);
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
    toast(`Settings saved (v${r.data.version}). The change is listed under Configuration history.`);
    void loadEvents();
  };
  const access = (id: string, tier?: "super") => {
    const lvl = tier === "super" ? "edit" : (ADMIN_PRESETS[id]?.perms.dataquality ?? "none");
    const cells = lvl === "edit" ? ["edit", "run", "edit", "edit", id === "it" ? "view" : "edit"] : lvl === "run" ? ["view", "run", "view", "view", "none"] : lvl === "view" ? ["view", "none", "view", "view", "none"] : ["none", "none", "none", "none", "none"];
    return cells;
  };

  return (
    <section className="dq-settings">
      <div className="adm-card dq-settings__card"><div className="adm-card__head"><span className="adm-card__title">Engine</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="adm-field"><label className="adm-field__label">Default batch size · {fmtInt(s.batch_size)} rows</label><input type="range" min={100} max={5000} step={100} value={s.batch_size} disabled={!canEdit} onChange={(e) => set({ batch_size: +e.target.value })} /><span className="dq-muted">One batch per invocation within the 60 s budget; the run re-schedules itself until done.</span></div>
          <div className="adm-field"><label className="adm-field__label">Nightly schedule</label><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><input className="adm-input" value={s.nightly_time} style={{ width: 72 }} disabled={!canEdit} onChange={(e) => set({ nightly_time: e.target.value })} /><span style={{ fontSize: 12, whiteSpace: "nowrap" }}>UTC</span><select className="adm-select" value={s.nightly_mode} disabled={!canEdit} onChange={(e) => set({ nightly_mode: e.target.value as DqSettings["nightly_mode"] })} style={{ fontSize: 12, padding: "5px 8px" }}><option value="rules">rules</option><option value="ai">AI review</option><option value="both">rules + AI</option></select><span style={{ marginLeft: "auto" }}><Toggle on={s.nightly_enabled} disabled={!canEdit} onChange={(v) => set({ nightly_enabled: v })} title={s.nightly_enabled ? "Nightly run enabled" : "Nightly run disabled"} /></span></div><span className="dq-muted">Whole database, once a night: the scheduler (hourly) starts it at its first tick at or after this UTC time and catches up a missed night once — never twice for the same night.</span>{schedule && <span className="dq-muted" style={{ display: "block" }}>{schedule.enabled ? `Next run ${fmtDateTime(schedule.next_at)}` : "Not scheduled"} · last scheduled {schedule.last_scheduled ? `${schedule.last_scheduled.code} (${schedule.last_scheduled.status}, ${fmtDateTime(schedule.last_scheduled.created_at)})` : "none"} · last successful {schedule.last_successful ? `${schedule.last_successful.code} (${fmtDateTime(schedule.last_successful.finished_at)})` : "none"}{schedule.missed ? <strong style={{ color: "var(--asb-amber)" }}> · missed: the current slot has no run — the next tick creates it (catch-up)</strong> : null}{schedule.catch_up ? " · the current slot's run started late (catch-up)" : ""}</span>}</div>
          <div className="adm-field"><label className="adm-field__label">Enforce on member forms</label><div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12 }}>{s.gate_forms_enforce ? "Refusing: a block-mode rule stops the post, and the gate fails closed if it cannot run." : "Shadow: every Post Cargo / Post Position / vessel write is evaluated and blocks are logged in Gate → log; nothing is refused."}</span><span style={{ marginLeft: "auto" }}><Toggle on={!!s.gate_forms_enforce} disabled={!canEdit} onChange={(v) => set({ gate_forms_enforce: v })} title={s.gate_forms_enforce ? "Enforcing on member forms" : "Shadow mode on member forms"} /></span></div><span className="dq-muted">Review the forms column of the enforcement matrix before switching on — every error-severity rule blocks there by default. Routable ports on live cargo are refused by the database regardless of this switch.</span></div>
          <div className="adm-field"><label className="adm-field__label">Registry refresh</label><span style={{ fontSize: 12 }}>{s.registry_release ? `UN/LOCODE ${s.registry_release} in use.` : "No release imported yet."} Two releases a year — refresh from the Ports registry tab.</span></div>
        </div>
      </div>
      <div className="adm-card dq-settings__card"><div className="adm-card__head"><span className="adm-card__title">AI review</span><span className="adm-card__sub">credential managed in Data Sync</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="adm-field"><label className="adm-field__label">Active model (read-only here)</label><input className="adm-input" value={boot.activeModel ? `${boot.activeModel.model} · ${boot.activeModel.vendor}` : "none active"} readOnly /><span className="dq-muted">One Vault-stored key; vendor-agnostic (Anthropic, OpenAI-compatible, Gemini). Managed in <Link href="/admin/data-sync?view=settings" className="adm-link" style={{ fontSize: 11 }}>Data Sync → Settings</Link>.</span></div>
          <div className="adm-field"><label className="adm-field__label">Sample size per batch · {s.ai_sample} rows</label><input type="range" min={5} max={200} step={5} value={s.ai_sample} disabled={!canEdit} onChange={(e) => set({ ai_sample: +e.target.value })} /></div>
          <div className="adm-field"><label className="adm-field__label">Daily token budget</label><input className="adm-input num" value={s.ai_daily_tokens} style={{ width: 140 }} disabled={!canEdit} onChange={(e) => set({ ai_daily_tokens: Number(e.target.value.replace(/\D/g, "")) || 0 })} /><span className="dq-muted num">≈ ${perDay.toFixed(2)} / day at ${s.ai_price_per_mtok} per Mtok · used today {fmtInt(used)} ({pctUsed} %)</span><div style={{ height: 6, borderRadius: 3, background: "var(--asb-gray-100)", overflow: "hidden" }}><div style={{ height: "100%", width: `${pctUsed}%`, background: pctUsed >= 80 ? "var(--asb-amber)" : "var(--asb-steel)" }} /></div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="adm-field"><label className="adm-field__label">Price per million tokens ($)</label><input className="adm-input" value={s.ai_price_per_mtok} disabled={!canEdit} onChange={(e) => set({ ai_price_per_mtok: Number(e.target.value) || 0 })} /></div>
            <div className="adm-field"><label className="adm-field__label">Auto-apply threshold</label><input className="adm-input" value={s.auto_apply_threshold} disabled={!canEdit} onChange={(e) => set({ auto_apply_threshold: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} /></div>
          </div>
          <div className="adm-field"><label className="adm-field__label">Reply cap per review call (output tokens)</label><input className="adm-input num" value={s.ai_max_output_tokens} style={{ width: 140 }} disabled={!canEdit} onChange={(e) => set({ ai_max_output_tokens: Number(e.target.value.replace(/\D/g, "")) || 0 })} /><span className="dq-muted">256 – 32,000. Bounds what the model may write back for one batch; the budget reservation is settled with the real usage.</span></div>
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
          <span className="dq-muted">Sent through the platform mailer (Group Mail SMTP settings): run mails when a run ends, the budget mail once a day at 80 %, the digest on Monday 07:00 UTC. The database queues each notification when its event happens; it is marked sent only after SMTP accepted it, a failed send is retried with growing delays (8 attempts), and every state is listed under Notifications below.</span>
        </div>
      </div>
      <div className="adm-card dq-settings__wide"><div className="adm-card__head"><span className="adm-card__title">Who may edit rules</span><span className="adm-card__sub">owner and the IT preset edit; Broker views and runs; other presets have no access (Admin accounts)</span></div>
        <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 560 }}><thead><tr><th>Preset</th><th>Rules</th><th>Run audits</th><th>Fix issues</th><th>Gate matrix</th><th>Settings</th></tr></thead><tbody>
          {[{ label: "Owner (super)", cells: access("", "super") }, ...ADMIN_PRESET_ORDER.map((id) => ({ label: ADMIN_PRESETS[id].label, cells: access(id) }))].map((p) => (
            <tr key={p.label} className="no-hover"><td style={{ fontWeight: 600, color: "var(--asb-navy)" }}>{p.label}</td>{p.cells.map((c, i) => <td key={i}><Badge cls={c === "edit" ? "live" : c === "view" ? "closed" : c === "run" ? "tier" : "inactive"}>{c}</Badge></td>)}</tr>
          ))}
        </tbody></table></div></div>
      </div>
      <div className="adm-card dq-settings__wide"><div className="adm-card__head"><span className="adm-card__title">Notifications</span><span className="adm-card__sub">queued by the database · pending → sending → sent, or retrying with back-off, or failed after 8 attempts (requeue) · newest first</span></div>
        {notes == null ? <Loading /> : notes.length === 0 ? <span className="dq-muted">Nothing queued yet.</span> : (
          <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 640 }}><thead><tr><th>State</th><th>What</th><th className="num">Attempts</th><th>Next / sent</th><th>Note</th><th /></tr></thead><tbody>
            {notes.map((n) => { const st = notificationState(n); return (
              <tr key={n.id} className="no-hover">
                <td><Badge cls={NOTIFICATION_BADGE[st]}>{st}</Badge></td>
                <td style={{ whiteSpace: "nowrap" }}>{NOTIFICATION_KIND_LABEL[n.kind] ?? n.kind} <span className="dq-muted mono">{n.idem_key}</span>{n.recipients?.length ? <div className="dq-muted">to {n.recipients.join(", ")}</div> : null}</td>
                <td className="num">{n.attempts}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{st === "sent" ? fmtDateTime(n.sent_at) : st === "failed" ? "—" : fmtDateTime(n.next_attempt_at)}</td>
                <td style={{ fontSize: 12 }}>{n.last_error ?? ""}</td>
                <td style={{ textAlign: "right" }}>{st === "failed" && <button type="button" className="adm-btn small" disabled={!canEdit} onClick={() => requeue(n.id)} title="Queue it again and try to send now">Requeue</button>}</td>
              </tr>
            ); })}
          </tbody></table></div></div>
        )}
      </div>
      <div className="adm-card dq-settings__wide"><div className="adm-card__head"><span className="adm-card__title">Configuration history</span><span className="adm-card__sub">gate modes, settings and notification deliveries · newest first</span></div>
        {events == null ? <Loading /> : events.length === 0 ? <span className="dq-muted">No changes recorded yet.</span> : (
          <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 560 }}><thead><tr><th>When</th><th>What</th><th>Change</th><th>By</th></tr></thead><tbody>
            {events.map((e) => <tr key={e.id} className="no-hover"><td className="num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.at)}</td><td style={{ whiteSpace: "nowrap" }}>{CONFIG_KIND[e.kind] ?? e.kind} · {e.key}</td><td style={{ fontSize: 12 }}>{describeEvent(e)}</td><td>{e.actor_name ?? "system"}</td></tr>)}
          </tbody></table></div></div>
        )}
      </div>
      <div className="dq-settings__wide" style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 4 }}><span className="dq-muted">Settings are versioned (v{s.version}); each change is listed above with its previous value.</span><span style={{ flex: 1 }} /><button type="button" className="adm-btn" disabled={!canEdit || !dirty} onClick={() => setS(boot.settings)}>Discard</button><button type="button" className="adm-btn primary" disabled={!canEdit || !dirty || saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button></div>
    </section>
  );
}
