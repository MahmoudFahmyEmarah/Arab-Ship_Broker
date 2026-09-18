"use client";

// Data Sync → Connections. Every credential the pipeline needs, one card each,
// all of them Vault-backed:
//   • LLM keys — a multi-key manager, exactly one active. Keys live in Supabase
//     Vault; the browser only ever sees a 4-char hint.
//   • Circulation inbox — IMAP connection used by the email source; the
//     password is held in Vault too.
//   • WhatsApp — QR-linked worker or Meta Cloud API.
//
// Each card carries its own status, credentials, schedule and Save/Test row, as
// in the design. The stores and actions behind them are unchanged.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Check, X, KeyRound, Plug, Star, Trash2, Pencil, ShieldCheck, Zap, ArrowRight, MessageCircle,
} from "lucide-react";
import { WhatsappSettingsCard } from "./WhatsappSettingsCard";
import { ScheduleEditor } from "./ScheduleEditor";
import { DEFAULT_SCHEDULE, type ScheduleSpec } from "@/lib/sync/email/schedule";
import {
  listLlmCredentials, saveLlmCredential, activateLlmCredential, deleteLlmCredential,
  testLlmCredential, hasLegacyAiKey, importLegacyAiKey,
  getEmailConfig, saveEmailConfig, getSyncWatermarks, setEmailWatermark,
  type LlmCredentialMeta, type EmailConfigMeta,
} from "@/app/(admin)/admin/data-sync/settings-actions";
import { Badge, Btn, Card, Switch, C, btn } from "./ui";

const VENDORS = ["anthropic", "openai", "google", "mistral", "other"];

// Suggested current text models per vendor (editable — the field stays free-text).
// Google list reflects the live generativelanguage models endpoint.
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  google: [
    "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.5-flash", "gemini-3-pro-preview",
    "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-pro-latest",
    "gemini-2.0-flash",
  ],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  mistral: ["mistral-large-latest", "mistral-small-latest"],
  other: [],
};

export function SettingsView() {
  const [creds, setCreds] = useState<LlmCredentialMeta[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [editing, setEditing] = useState<LlmCredentialMeta | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reloadKeys = useCallback(async () => {
    const [list, leg] = await Promise.all([listLlmCredentials(), hasLegacyAiKey()]);
    setCreds(list.success ? list.data : []);
    if (!list.success) toast.error(list.error);
    setLegacy(leg);
  }, []);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reloadKeys(); })(); return () => { c = true; }; }, [reloadKeys]);

  const activate = async (id: string) => {
    setBusy(id);
    const r = await activateLlmCredential(id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Active key switched.");
    await reloadKeys();
  };
  const test = async (id: string) => {
    setBusy(id);
    const r = await testLlmCredential(id);
    setBusy(null);
    if (r.success) toast.success("Key authenticated with the provider.");
    else toast.error(r.error);
  };
  const remove = async (cr: LlmCredentialMeta) => {
    if (!confirm(`Delete key "${cr.label}"? Its encrypted secret is destroyed too.`)) return;
    setBusy(cr.id);
    const r = await deleteLlmCredential(cr.id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Key deleted.");
    await reloadKeys();
  };
  const importLegacy = async () => {
    setBusy("legacy");
    const r = await importLegacyAiKey();
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(r.data.imported ? "Legacy key imported and encrypted." : "No legacy key found.");
    await reloadKeys();
  };

  const activeCred = creds?.find((c) => c.is_active) ?? null;

  return (
    <div className="ds-stack" style={{ maxWidth: 860 }}>
      {/* ── LLM keys ── */}
      <Card>
        <Header
          icon={<KeyRound size={17} />} title="Classifier keys"
          subtitle="Used to classify circulars locally. Exactly one key is active; secrets live in Vault."
          status={activeCred ? "Active" : "No active key"}
          statusTone={activeCred ? "new" : "invalid"}
        />

        {legacy && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "11px 13px", marginBottom: 12,
            background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: "var(--r-soft-10)" }}>
            <ShieldCheck size={18} color={C.amber} />
            <div style={{ flex: "1 1 220px", fontSize: 13, color: C.brassDeep }}>
              A plaintext API key is still stored in platform settings. Import it into the encrypted store.
            </div>
            <Btn kind="accent" busy={busy === "legacy"} icon={<ArrowRight size={14} />} onClick={importLegacy}>
              Import &amp; encrypt
            </Btn>
          </div>
        )}

        {creds === null ? (
          <Loading />
        ) : creds.length === 0 ? (
          <Empty text="No keys yet. Add one to enable local email classification." />
        ) : (
          <div style={{ border: "var(--bd-hair)", borderRadius: "var(--r-soft-10)", overflow: "hidden", background: C.card }}>
            {creds.map((cr, i) => (
              <div key={cr.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderTop: i ? "1px solid var(--ccx-line2)" : "none" }}>
                <span style={{ width: 34, height: 34, borderRadius: "var(--r-soft-10)", flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  background: cr.is_active ? C.greenBg : C.sunken, color: cr.is_active ? C.green : C.ink3 }}>
                  <KeyRound size={16} />
                </span>
                <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>{cr.label}</span>
                    {cr.is_active && <Badge tone="new">Active</Badge>}
                  </div>
                  <div className="ds-rowsub">{cr.vendor} · {cr.model} · key ••••{cr.key_hint ?? "----"}</div>
                </div>
                {!cr.is_active && (
                  <Btn size="sm" kind="ghost" busy={busy === cr.id} icon={<Star size={14} />}
                    title="Make active" onClick={() => activate(cr.id)}>Activate</Btn>
                )}
                <Btn size="sm" kind="ghost" busy={busy === cr.id} icon={<Zap size={14} />}
                  title="Test key" onClick={() => test(cr.id)}>Test</Btn>
                <button type="button" onClick={() => setEditing(cr)} title="Edit" style={ICON}><Pencil size={15} /></button>
                <button type="button" onClick={() => remove(cr)} disabled={busy === cr.id} title="Delete" style={{ ...ICON, color: C.red }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Btn kind="primary" icon={<KeyRound size={15} />} onClick={() => setEditing("new")}>Add a key</Btn>
        </div>
      </Card>

      {/* ── Email connection ── */}
      <EmailCard />

      {/* ── WhatsApp connection ── */}
      <Card>
        <Header
          icon={<MessageCircle size={17} />} title="WhatsApp"
          subtitle="Circulation intake over WhatsApp — QR-linked number for testing, Meta Cloud API for production. Secrets in Vault."
        />
        <WhatsappSettingsCard />
      </Card>

      {editing && (
        <KeyModal cred={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reloadKeys(); }} />
      )}
    </div>
  );
}

// ── add / edit key modal ────────────────────────────────────────────────────
function KeyModal({ cred, onClose, onSaved }: {
  cred: LlmCredentialMeta | null; onClose: () => void; onSaved: () => void;
}) {
  const [label, setLabel] = useState(cred?.label ?? "");
  const [vendor, setVendor] = useState(cred?.vendor ?? "anthropic");
  const [model, setModel] = useState(cred?.model ?? "claude-sonnet-4");
  const [baseUrl, setBaseUrl] = useState(cred?.base_url ?? "");
  const [secret, setSecret] = useState("");
  const [makeActive, setMakeActive] = useState(cred ? cred.is_active : true);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    const r = await saveLlmCredential({
      id: cred?.id, label, vendor, model, baseUrl: baseUrl || null,
      secret: secret || null, makeActive,
    });
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(cred ? "Key updated." : "Key added and encrypted.");
    onSaved();
  };

  const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 5, display: "block" };

  return (
    <Modal innerRef={ref} onClose={onClose} title={cred ? "Edit key" : "Add LLM key"}
      subtitle="The secret is encrypted in Vault — it is never stored in plaintext.">
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <div><label style={lab}>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Anthropic — production" className="ds-input" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div>
            <label style={lab}>Vendor</label>
            <select value={vendor} onChange={(e) => {
              const v = e.target.value; setVendor(v);
              const sug = MODEL_SUGGESTIONS[v]; if (sug && sug.length) setModel(sug[0]);
            }} className="ds-input">
              {VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={lab}>Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} list="llm-model-suggestions" className="ds-input" />
            <datalist id="llm-model-suggestions">
              {(MODEL_SUGGESTIONS[vendor] ?? []).map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
        </div>
        <div><label style={lab}>Base URL <span style={{ color: C.ink3, fontWeight: 400 }}>(optional — for proxies/self-host)</span></label><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.anthropic.com" className="ds-input" /></div>
        <div>
          <label style={lab}>API key {cred && <span style={{ color: C.ink3, fontWeight: 400 }}>(leave blank to keep ••••{cred.key_hint})</span>}</label>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cred ? "•••••••••••••••" : "sk-…"} autoComplete="off" className="ds-input" />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink2, cursor: "pointer" }}>
          <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} /> Make this the active key
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button onClick={save} disabled={saving} style={btn("primary")}>
          {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} {cred ? "Save" : "Add key"}
        </button>
        <button onClick={onClose} style={btn("ghost")}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── email connection card ───────────────────────────────────────────────────
function EmailCard() {
  const [cfg, setCfg] = useState<EmailConfigMeta | null | undefined>(undefined);
  const [provider, setProvider] = useState("namecheap");
  const [host, setHost] = useState("server353-4.web-hosting.com");
  const [port, setPort] = useState("993");
  const [username, setUsername] = useState("");
  const [folder, setFolder] = useState("INBOX");
  const [query, setQuery] = useState("");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [watermark, setWm] = useState<string | null>(null);
  const [wmInput, setWmInput] = useState("");
  const [wmBusy, setWmBusy] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleSpec>(DEFAULT_SCHEDULE);
  const [scheduleKey, setScheduleKey] = useState(0); // remounts the editor with a fresh `initial`

  const reloadWm = useCallback(async () => {
    const w = await getSyncWatermarks();
    if (w.success) setWm(w.data.email);
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      await Promise.resolve();
      const [r, w] = await Promise.all([getEmailConfig(), getSyncWatermarks()]);
      if (c) return;
      if (w.success) setWm(w.data.email);
      if (!r.success) { toast.error(r.error); setCfg(null); return; }
      setCfg(r.data);
      if (r.data) {
        setProvider(r.data.provider); setHost(r.data.imap_host ?? "imap.gmail.com");
        setPort(String(r.data.imap_port)); setUsername(r.data.username ?? "");
        setFolder(r.data.folder); setQuery(r.data.search_query ?? ""); setEnabled(r.data.is_enabled);
        setSchedule(r.data.schedule ?? DEFAULT_SCHEDULE); setScheduleKey((k) => k + 1);
      }
    })();
    return () => { c = true; };
  }, [reloadWm]);

  const applyWatermark = async (iso: string | null) => {
    setWmBusy(true);
    const r = await setEmailWatermark(iso);
    setWmBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(iso === null ? "Watermark reset to now — next sync fetches only new mail." : "Sync start point updated.");
    setWmInput("");
    await reloadWm();
  };

  const save = async () => {
    setSaving(true);
    const r = await saveEmailConfig({
      provider, host, port: Number.parseInt(port, 10), username, folder,
      query: query || null, password: password || null, enabled,
    });
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    setPassword("");
    toast.success("Circulation inbox saved.");
  };

  const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 5, display: "block" };

  return (
    <Card>
      <Header
        icon={<Plug size={17} />} title="Circulation inbox"
        subtitle="IMAP connection the email source reads circulars from. Password stored in Vault."
        status={cfg === undefined ? "Checking" : enabled ? "Enabled" : "Disabled"}
        statusTone={cfg === undefined ? "neutral" : enabled ? "new" : "invalid"}
      />
      {cfg === undefined ? <Loading /> : (
        <div>
          <div className="ds-label" style={{ marginBottom: 8 }}>Credentials · Vault</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <div>
              <label style={lab}>Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="ds-input">
                <option value="namecheap">Namecheap Private Email</option>
                <option value="gmail">Gmail</option>
                <option value="imap">Generic IMAP</option>
              </select>
            </div>
            <div><label style={lab}>IMAP host</label><input value={host} onChange={(e) => setHost(e.target.value)} className="ds-input" /></div>
            <div><label style={lab}>Port</label><input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="ds-input" /></div>
            <div><label style={lab}>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ops@arabshipbroker.com" className="ds-input" /></div>
            <div><label style={lab}>Folder / label</label><input value={folder} onChange={(e) => setFolder(e.target.value)} className="ds-input" /></div>
            <div><label style={lab}>Search filter <span style={{ color: C.ink3, fontWeight: 400 }}>(optional)</span></label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="from:broker.com · subject:cargo · or free text" className="ds-input" /></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={lab}>App password {cfg?.password_hint && <span style={{ color: C.ink3, fontWeight: 400 }}>(leave blank to keep ••••{cfg.password_hint})</span>}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cfg?.password_hint ? "•••••••••" : "app password / token"} autoComplete="off" className="ds-input" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <Switch checked={enabled} onChange={setEnabled} label="Enabled" />
            <Btn kind="primary" className="ds-push" busy={saving} icon={<Check size={15} />} onClick={save}>
              Save connection
            </Btn>
          </div>
          <p style={{ fontSize: 12, color: C.ink3, marginTop: 14, marginBottom: 0, lineHeight: 1.5 }}>
            Namecheap cPanel hosting mail uses your server host (e.g. <code>server353-4.web-hosting.com</code>) : 993 SSL with the full mailbox address and its password. Once enabled, run it from the Sync Workspace → &quot;Sync circulation inbox&quot;.
          </p>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--ccx-line2)" }}>
            <div className="ds-label" style={{ marginBottom: 8 }}>Schedule</div>
            <div style={{ marginBottom: 14 }}>
              <ScheduleEditor key={scheduleKey} initial={schedule} connectionEnabled={enabled}
                onSaved={(spec) => { setSchedule(spec); setScheduleKey((k) => k + 1); }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, marginBottom: 3 }}>Start point</div>
            <div style={{ fontSize: 12, color: C.ink3, marginBottom: 10, lineHeight: 1.5 }}>
              &quot;Sync now&quot; fetches only mail received after this point (down to the minute), then advances it automatically after a successful run.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: C.ink2 }}>
                Last sync:{" "}
                <strong style={{ fontFamily: C.mono, color: C.navy }}>
                  {watermark ? `${watermark.slice(0, 10)} ${watermark.slice(11, 16)} UTC` : "never"}
                </strong>
              </span>
              <input className="ds-input" type="datetime-local" value={wmInput}
                onChange={(e) => setWmInput(e.target.value)} style={{ width: "auto" }} />
              <Btn size="sm" busy={wmBusy} disabled={!wmInput}
                onClick={() => wmInput && applyWatermark(new Date(wmInput).toISOString())}>Set start point</Btn>
              <Btn size="sm" kind="ghost" busy={wmBusy} onClick={() => applyWatermark(null)}>Reset to now</Btn>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────
function Header({ icon, title, subtitle, status, statusTone }: {
  icon: React.ReactNode; title: string; subtitle: string;
  status?: string; statusTone?: "new" | "updated" | "invalid" | "info" | "neutral";
}) {
  return (
    <div className="ds-channel__head" style={{ marginBottom: 14 }}>
      <span className="ds-channel__icon">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="ds-channel__name">{title}</span>
          {status && <Badge tone={statusTone ?? "neutral"}>{status}</Badge>}
        </div>
        <div className="ds-channel__desc" style={{ marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}
function Loading() {
  return <div className="ds-empty" style={{ padding: 30 }}><Loader2 size={18} className="ds-spin" /></div>;
}
function Empty({ text }: { text: string }) {
  return <div className="ds-empty" style={{ padding: "26px 20px", border: "var(--bd-hair)", borderRadius: "var(--r-soft-10)", fontSize: 13.5 }}>{text}</div>;
}
function Modal({ innerRef, title, subtitle, onClose, children }: {
  innerRef: React.RefObject<HTMLDivElement | null>; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div onMouseDown={(e) => { if (e.target === innerRef.current) onClose(); }} ref={innerRef}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.34)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(560px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: C.card, borderRadius: "var(--r-soft-16)", border: "2px ridge var(--asb-line)", boxShadow: "var(--sh-dropdown)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--ccx-line2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ds-drawer__title">{title}</div>
            {subtitle && <div className="ds-drawer__sub">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="ds-close" aria-label="Close"><X size={16} /></button>
        </div>
        <div style={{ padding: "20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}
const ICON: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 5, color: C.ink2,
  display: "inline-flex", alignItems: "center", borderRadius: 6,
};
