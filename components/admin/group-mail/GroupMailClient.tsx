"use client";

// Group Mail — owner console for the cPanel/Mailman mailing lists + branded
// circulars. Four views: Mailing Lists (cPanel CRUD + Mailman members),
// Compose (branded circular + preview + test + broadcast), History, Settings
// (hosts + Vault secrets). Visual language matches the Data Sync module.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Mail, Plus, Trash2, Check, X, Users, Settings2, Send, Eye,
  RefreshCw, Pencil, KeyRound, History as HistoryIcon, ShieldCheck, Wand2, SpellCheck, Clock,
} from "lucide-react";
import {
  getGroupMailState, saveGroupMailConfig, saveGroupMailSecret,
  testCpanelConnection, testSmtpConnection,
  listMailingLists, createMailingList, deleteMailingList, updateMailingList, saveListPassword,
  getListMembers, addListMembers, removeListMembers, replaceListMember,
  previewCircular, startCircular, sendCircularBatch, finishCircular, listCircularHistory,
  reviewCircularBody, getCircularDetail, cancelScheduledCircular, runDispatcherNow,
} from "@/app/(admin)/admin/group-mail/actions";
import type {
  GroupMailConfig, GroupMailSecretStatus, MailingListRow, ListMember, CampaignInput, CampaignRow, CampaignLink,
} from "@/lib/groupmail/types";
import { OFFICES, SCHEDULE_ZONES, type Office } from "@/lib/groupmail/types";

// "Riyadh (UTC+3)" — live offset per zone, computed once at module load (a
// render-time Date would trip the purity lint; offsets only shift overnight).
function utcOffsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date());
    return (parts.find((p) => p.type === "timeZoneName")?.value ?? "").replace("GMT", "UTC") || "UTC";
  } catch {
    return "UTC";
  }
}
const SCHED_ZONE_OPTS = Object.entries(SCHEDULE_ZONES).map(([label, tz]) => ({
  label, tz, off: utcOffsetLabel(tz),
}));

// Wall-clock time in a timezone → UTC instant. Two-pass offset resolution
// handles DST correctly for the practical range we schedule in.
function wallTimeToUtc(dateStr: string, timeStr: string, tz: string): Date | null {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  const tzOffsetAt = (utcMs: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(utcMs));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return asUtc - utcMs; // how far local wall time sits ahead of UTC
  };
  let utc = wallAsUtc - tzOffsetAt(wallAsUtc);
  utc = wallAsUtc - tzOffsetAt(utc); // second pass fixes DST-boundary guesses
  return new Date(utc);
}
import { C, btn } from "../data-sync/ui";

const BATCH = 10;
const spin = { animation: "spin 1s linear infinite" } as const;

type View = "lists" | "compose" | "history" | "settings";

export function GroupMailClient() {
  const [view, setView] = useState<View>("lists");
  const [config, setConfig] = useState<GroupMailConfig | null>(null);
  const [secrets, setSecrets] = useState<GroupMailSecretStatus | null>(null);
  const [lists, setLists] = useState<MailingListRow[] | null>(null);
  const [listsLoading, setListsLoading] = useState(false);

  const reloadState = useCallback(async () => {
    const r = await getGroupMailState();
    if (!r.success) { toast.error(r.error); return; }
    setConfig(r.data.config);
    setSecrets(r.data.secrets);
  }, []);

  useEffect(() => { let x = false; (async () => { await Promise.resolve(); if (!x) await reloadState(); })(); return () => { x = true; }; }, [reloadState]);

  const loadLists = useCallback(async () => {
    setListsLoading(true);
    const r = await listMailingLists();
    setListsLoading(false);
    if (!r.success) { toast.error(r.error); setLists([]); return; }
    setLists(r.data);
  }, []);

  useEffect(() => {
    if ((view === "lists" || view === "compose") && lists === null && config?.cpanel_host) {
      let x = false;
      (async () => { await Promise.resolve(); if (!x) await loadLists(); })();
      return () => { x = true; };
    }
  }, [view, lists, config, loadLists]);

  const needsSetup = config !== null && (!config.cpanel_host || !secrets?.cpanel_token || !config.smtp_host || !secrets?.smtp_password);

  return (
    <div style={{ color: C.ink }}>
      <div className="gm-tabs" style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.line}`, marginBottom: 20 }}>
        {([
          { id: "lists", label: "Mailing Lists", icon: <Users size={14} /> },
          { id: "compose", label: "Compose", icon: <Mail size={14} /> },
          { id: "history", label: "History", icon: <HistoryIcon size={14} /> },
          { id: "settings", label: "Settings", icon: <Settings2 size={14} /> },
        ] as { id: View; label: string; icon: React.ReactNode }[]).map((t) => {
          const on = view === t.id;
          return (
            <button key={t.id} onClick={() => setView(t.id)}
              style={{ padding: "9px 16px", border: "none", background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
                font: "inherit", fontSize: 14, fontWeight: on ? 600 : 500, color: on ? C.navy : C.ink2,
                borderBottom: `2px solid ${on ? C.brass : "transparent"}`, marginBottom: -1 }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {needsSetup && view !== "settings" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 16, background: C.brassBg, border: `1px solid ${C.brass}`, borderRadius: 8, fontSize: 13.5, color: C.brassDeep }}>
          <KeyRound size={16} /> Connect the module first: enter the cPanel host, username + API token and the SMTP mailbox in
          <button onClick={() => setView("settings")} style={{ ...btn("dark"), padding: "5px 12px" }}>Settings</button>
        </div>
      )}

      {view === "lists" && (
        <ListsView lists={lists} loading={listsLoading} onReload={loadLists}
          secrets={secrets} onSecretsChanged={reloadState} />
      )}
      {view === "compose" && (
        <ComposeView lists={lists ?? []} config={config} />
      )}
      {view === "history" && <HistoryView />}
      {view === "settings" && config && secrets && (
        <SettingsView config={config} secrets={secrets} onSaved={reloadState} />
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .gm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .gm-grid21{display:grid;grid-template-columns:2fr 1fr;gap:12px}
        .gm-scroll{overflow-x:auto}
        .gm-scroll table{min-width:560px}
        .gm-preview{height:720px}
        .gm-detail-frame{height:620px}
        .gm-cards{display:none}
        @media (max-width: 760px){
          .gm-tabs{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
          .gm-tabs button{white-space:nowrap;flex:none;padding:8px 11px !important;font-size:13px !important}
          .gm-grid2,.gm-grid21{grid-template-columns:1fr}
          .gm-pane{min-width:0 !important;flex-basis:100% !important}
          .gm-preview{height:480px}
          .gm-detail-frame{height:62vh}
          .gm-card{padding:14px !important}
          .gm-toolbar{flex-wrap:wrap}
          .gm-toolbar-desc{flex:1 1 100%}
          /* tables become stacked cards on phones */
          .gm-table{display:none}
          .gm-cards{display:flex;flex-direction:column;gap:10px}
          .gm-linkrow{flex-wrap:wrap}
          .gm-linkrow input:first-of-type{flex:1 1 100% !important}
          .gm-actions{gap:8px}
          .gm-actions button{flex:1 1 46%;justify-content:center;margin-left:0 !important}
        }
      `}</style>
    </div>
  );
}

// ── Mailing Lists ───────────────────────────────────────────────────────────
function ListsView({ lists, loading, onReload, secrets, onSecretsChanged }: {
  lists: MailingListRow[] | null; loading: boolean; onReload: () => Promise<void>;
  secrets: GroupMailSecretStatus | null; onSecretsChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<MailingListRow | null>(null);
  const [configuring, setConfiguring] = useState<MailingListRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const doDelete = async (l: MailingListRow) => {
    if (!confirm(`Delete the mailing list ${l.list}?\n\nThis removes the list AND its membership from the server. This cannot be undone.`)) return;
    setBusy(l.list);
    const r = await deleteMailingList(l.list);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Deleted ${l.list}.`);
    await onReload(); await onSecretsChanged();
  };

  return (
    <div>
      <div className="gm-toolbar" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div className="gm-toolbar-desc" style={{ fontSize: 13.5, color: C.ink2 }}>
          Lists live on the Namecheap hosting (cPanel → Mailing Lists); members are managed on the list itself.
        </div>
        <button onClick={onReload} disabled={loading} style={{ ...btn("ghost"), marginLeft: "auto" }}>
          {loading ? <Loader2 size={14} style={spin} /> : <RefreshCw size={14} />} Refresh
        </button>
        <button onClick={() => setCreating(true)} style={btn("primary")}><Plus size={15} /> New list</button>
      </div>

      {/* phone: one card per list */}
      <div className="gm-cards">
        {lists === null || loading ? (
          <div style={{ padding: 30, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></div>
        ) : lists.length === 0 ? (
          <div style={{ padding: "30px 16px", textAlign: "center", color: C.ink3, fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff" }}>
            No mailing lists yet — create the first one.
          </div>
        ) : lists.map((l) => {
          const hasPw = secrets?.lists.includes(l.list);
          return (
            <div key={l.list} style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff", padding: "13px 14px" }}>
              <div style={{ fontFamily: C.mono, fontWeight: 600, color: C.navy, fontSize: 13.5, wordBreak: "break-all" }}>{l.list}</div>
              <div style={{ display: "flex", gap: 12, fontSize: 12.5, color: C.ink2, margin: "6px 0 10px" }}>
                <span>{l.accesstype ?? "—"}</span>
                {hasPw
                  ? <span style={{ color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldCheck size={13} /> password saved</span>
                  : <span style={{ color: C.amber }}>password not saved</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setManaging(l)} style={{ ...btn("ghost"), padding: "7px 11px", flex: 1, justifyContent: "center" }}><Users size={13} /> Members</button>
                <button onClick={() => setConfiguring(l)} style={{ ...btn("ghost"), padding: "7px 11px", flex: 1, justifyContent: "center" }}><Pencil size={13} /> Config</button>
                <button onClick={() => doDelete(l)} disabled={busy === l.list} style={{ ...btn("danger"), padding: "7px 11px" }}>
                  {busy === l.list ? <Loader2 size={13} style={spin} /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="gm-scroll gm-table" style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            <th style={TH}>List address</th><th style={TH}>Access</th><th style={TH}>Admin password</th>
            <th style={{ ...TH, textAlign: "right" }}>Actions</th>
          </tr></thead>
          <tbody>
            {lists === null || loading ? (
              <tr><td colSpan={4} style={{ padding: 40, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></td></tr>
            ) : lists.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: "40px 20px", textAlign: "center", color: C.ink3, fontSize: 14 }}>
                No mailing lists on the account yet — create the first one.
              </td></tr>
            ) : lists.map((l) => {
              const hasPw = secrets?.lists.includes(l.list);
              return (
                <tr key={l.list}>
                  <td style={{ ...TD, fontFamily: C.mono, fontWeight: 600, color: C.navy }}>{l.list}</td>
                  <td style={TD}>{l.accesstype ?? "—"}</td>
                  <td style={TD}>
                    {hasPw
                      ? <span style={{ color: C.green, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}><ShieldCheck size={14} /> saved</span>
                      : <span style={{ color: C.amber, fontSize: 12.5 }}>not saved</span>}
                  </td>
                  <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => setManaging(l)} style={{ ...btn("ghost"), padding: "6px 11px", marginRight: 6 }}><Users size={13} /> Members</button>
                    <button onClick={() => setConfiguring(l)} style={{ ...btn("ghost"), padding: "6px 11px", marginRight: 6 }}><Pencil size={13} /> Config</button>
                    <button onClick={() => doDelete(l)} disabled={busy === l.list} style={{ ...btn("danger"), padding: "6px 11px" }}>
                      {busy === l.list ? <Loader2 size={13} style={spin} /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && <CreateListDrawer onClose={() => setCreating(false)}
        onDone={async () => { setCreating(false); await onReload(); await onSecretsChanged(); }} />}
      {managing && <MembersDrawer list={managing} hasPassword={!!secrets?.lists.includes(managing.list)}
        onClose={() => setManaging(null)} onSecretsChanged={onSecretsChanged} />}
      {configuring && <ListConfigDrawer list={configuring} onClose={() => setConfiguring(null)}
        onDone={async () => { setConfiguring(null); await onReload(); await onSecretsChanged(); }} />}
    </div>
  );
}

function CreateListDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [local, setLocal] = useState("");
  const [domain, setDomain] = useState("arabshipbroker.com");
  const [password, setPassword] = useState("");
  const [priv, setPriv] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await createMailingList(local, domain, password, priv);
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`List ${local}@${domain} created.`);
    await onDone();
  };
  return (
    <Drawer title="New mailing list" subtitle="cPanel → Mailing Lists" onClose={onClose}>
      <Field label="List name">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="circulation" style={INPUT} />
          <span style={{ color: C.ink3 }}>@</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} style={INPUT} />
        </div>
      </Field>
      <Field label="List admin password (min 8 chars — stored encrypted for member management)">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={INPUT} />
      </Field>
      <Field label="Access">
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
          Private — archives and member roster hidden from the public
        </label>
      </Field>
      <DrawerActions saving={saving} onSave={save} onCancel={onClose} saveLabel="Create list" />
    </Drawer>
  );
}

function ListConfigDrawer({ list, onClose, onDone }: {
  list: MailingListRow; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [priv, setPriv] = useState(list.accesstype !== "public");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await updateMailingList(list.list, {
      password: password || undefined,
      isPrivate: priv,
    });
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Updated ${list.list}.`);
    await onDone();
  };
  return (
    <Drawer title={`Configure ${list.list}`} subtitle="Password & privacy (cPanel)" onClose={onClose}>
      <Field label="New admin password (leave empty to keep the current one)">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={INPUT} />
      </Field>
      <Field label="Access">
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
          Private list
        </label>
      </Field>
      <DrawerActions saving={saving} onSave={save} onCancel={onClose} saveLabel="Save changes" />
    </Drawer>
  );
}

// ── Members drawer ──────────────────────────────────────────────────────────
function MembersDrawer({ list, hasPassword, onClose, onSecretsChanged }: {
  list: MailingListRow; hasPassword: boolean; onClose: () => void; onSecretsChanged: () => Promise<void>;
}) {
  const [pw, setPw] = useState("");
  const [pwSaved, setPwSaved] = useState(hasPassword);
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    const r = await getListMembers(list.list);
    setBusy(null);
    if (!r.success) { toast.error(r.error); setMembers([]); return; }
    setMembers(r.data);
  }, [list.list]);

  useEffect(() => {
    if (!pwSaved) return;
    let x = false;
    (async () => { await Promise.resolve(); if (!x) await load(); })();
    return () => { x = true; };
  }, [pwSaved, load]);

  const savePw = async () => {
    setBusy("pw");
    const r = await saveListPassword(list.list, pw);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Password stored — loading members…");
    setPwSaved(true);
    await onSecretsChanged();
  };

  const doAdd = async () => {
    const entries = addText.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean);
    setBusy("add");
    const r = await addListMembers(list.list, entries);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Added ${r.data.added} member${r.data.added > 1 ? "s" : ""}.`);
    setAddText("");
    await load();
  };

  const doRemove = async (email: string) => {
    if (!confirm(`Remove ${email} from ${list.list}?`)) return;
    setBusy(email);
    const r = await removeListMembers(list.list, [email]);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Removed ${email}.`);
    await load();
  };

  const doReplace = async (oldEmail: string) => {
    setBusy(oldEmail);
    const r = await replaceListMember(list.list, oldEmail, editValue);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Member updated.");
    setEditing(null);
    await load();
  };

  return (
    <Drawer title={`Members — ${list.list}`} subtitle="Mailman membership" onClose={onClose} wide>
      {!pwSaved ? (
        <div>
          <p style={{ fontSize: 13.5, color: C.ink2, lineHeight: 1.6, marginTop: 0 }}>
            To manage members the module needs this list&apos;s <strong>admin password</strong> (the one set when
            the list was created in cPanel). It is stored encrypted in the Vault and never shown again.
          </p>
          <Field label="List admin password">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={INPUT} />
          </Field>
          <button onClick={savePw} disabled={busy === "pw" || !pw} style={btn("primary")}>
            {busy === "pw" ? <Loader2 size={14} style={spin} /> : <KeyRound size={14} />} Save password
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: C.ink2 }}>
              {members === null ? "Loading…" : `${members.length} member${members.length === 1 ? "" : "s"}`}
            </span>
            <button onClick={load} disabled={busy === "load"} style={{ ...btn("ghost"), marginLeft: "auto", padding: "6px 11px" }}>
              {busy === "load" ? <Loader2 size={13} style={spin} /> : <RefreshCw size={13} />} Refresh
            </button>
          </div>

          {/* phone: one card per member */}
          <div className="gm-cards" style={{ marginBottom: 16 }}>
            {members === null ? (
              <div style={{ padding: 24, textAlign: "center", color: C.ink3 }}><Loader2 size={18} style={spin} /></div>
            ) : members.length === 0 ? (
              <div style={{ padding: "22px 14px", textAlign: "center", color: C.ink3, fontSize: 13.5, border: `1px solid ${C.line}`, borderRadius: 9 }}>No members yet.</div>
            ) : members.map((m) => (
              <div key={m.email} style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 12px" }}>
                {editing === m.email ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={editValue} onChange={(e) => setEditValue(e.target.value)} style={{ ...INPUT, padding: "7px 9px", fontSize: 12.5 }} />
                    <button onClick={() => doReplace(m.email)} disabled={busy === m.email} style={{ ...btn("primary"), padding: "6px 10px" }}>
                      {busy === m.email ? <Loader2 size={12} style={spin} /> : <Check size={12} />}
                    </button>
                    <button onClick={() => setEditing(null)} style={{ ...btn("ghost"), padding: "6px 10px" }}><X size={12} /></button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: C.mono, fontSize: 12.5, color: C.navy, fontWeight: 600, wordBreak: "break-all" }}>{m.email}</div>
                      {m.name && <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>{m.name}</div>}
                    </div>
                    <button title="Change address" onClick={() => { setEditing(m.email); setEditValue(m.email); }} style={{ ...btn("ghost"), padding: "6px 9px" }}><Pencil size={12} /></button>
                    <button title="Remove" onClick={() => doRemove(m.email)} disabled={busy === m.email} style={{ ...btn("danger"), padding: "6px 9px" }}>
                      {busy === m.email ? <Loader2 size={12} style={spin} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="gm-scroll gm-table" style={{ border: `1px solid ${C.line}`, borderRadius: 9, marginBottom: 16 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={TH}>Email</th><th style={TH}>Name</th><th style={{ ...TH, width: 110, textAlign: "right" }}></th></tr></thead>
              <tbody>
                {members === null ? (
                  <tr><td colSpan={3} style={{ padding: 30, textAlign: "center", color: C.ink3 }}><Loader2 size={18} style={spin} /></td></tr>
                ) : members.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: "26px 16px", textAlign: "center", color: C.ink3, fontSize: 13.5 }}>No members yet.</td></tr>
                ) : members.map((m) => (
                  <tr key={m.email}>
                    <td style={{ ...TD, fontFamily: C.mono, fontSize: 12.5 }}>
                      {editing === m.email ? (
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)} style={{ ...INPUT, padding: "6px 9px", fontSize: 12.5 }} />
                      ) : m.email}
                    </td>
                    <td style={TD}>{m.name ?? "—"}</td>
                    <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                      {editing === m.email ? (
                        <>
                          <button onClick={() => doReplace(m.email)} disabled={busy === m.email} style={{ ...btn("primary"), padding: "5px 9px", marginRight: 4 }}>
                            {busy === m.email ? <Loader2 size={12} style={spin} /> : <Check size={12} />}
                          </button>
                          <button onClick={() => setEditing(null)} style={{ ...btn("ghost"), padding: "5px 9px" }}><X size={12} /></button>
                        </>
                      ) : (
                        <>
                          <button title="Change address" onClick={() => { setEditing(m.email); setEditValue(m.email); }} style={{ ...btn("ghost"), padding: "5px 9px", marginRight: 4 }}><Pencil size={12} /></button>
                          <button title="Remove" onClick={() => doRemove(m.email)} disabled={busy === m.email} style={{ ...btn("danger"), padding: "5px 9px" }}>
                            {busy === m.email ? <Loader2 size={12} style={spin} /> : <Trash2 size={12} />}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Field label='Add members — one per line (or comma-separated); "Name <email>" keeps the name'>
            <textarea value={addText} onChange={(e) => setAddText(e.target.value)} rows={4} style={{ ...INPUT, resize: "vertical", fontFamily: C.mono, fontSize: 12.5 }}
              placeholder={"chartering@example.com\nCapt Ahmed <ahmed@example.com>"} />
          </Field>
          <button onClick={doAdd} disabled={busy === "add" || !addText.trim()} style={btn("primary")}>
            {busy === "add" ? <Loader2 size={14} style={spin} /> : <Plus size={14} />} Add to list
          </button>
        </div>
      )}
    </Drawer>
  );
}

// ── Compose ─────────────────────────────────────────────────────────────────
function ComposeView({ lists, config }: { lists: MailingListRow[]; config: GroupMailConfig | null }) {
  const [input, setInput] = useState<CampaignInput>({
    list_email: "", badge: "Circulation", subject: "", title: "", body: "", links: [], office: "Cairo",
  });
  const [testTo, setTestTo] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("09:00");
  const [schedZone, setSchedZone] = useState("Cairo");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; done: number; ok: number; fail: number } | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const runReview = async (mode: "proofread" | "rephrase") => {
    setBusy(mode);
    const r = await reviewCircularBody(input.body, mode);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    if (r.data.text.trim() === input.body.trim()) { toast.success("Nothing to change — the text already reads well."); return; }
    setSuggestion(r.data.text);
  };

  useEffect(() => {
    if (input.list_email || !lists.length) return;
    let x = false;
    (async () => { await Promise.resolve(); if (!x) setInput((p) => ({ ...p, list_email: lists[0].list })); })();
    return () => { x = true; };
  }, [lists, input.list_email]);
  useEffect(() => {
    if (testTo || !config?.test_recipients?.length) return;
    const val = config.test_recipients.join(", ");
    let x = false;
    (async () => { await Promise.resolve(); if (!x) setTestTo(val); })();
    return () => { x = true; };
  }, [config, testTo]);

  const patch = (p: Partial<CampaignInput>) => setInput((prev) => ({ ...prev, ...p }));
  const patchLink = (i: number, p: Partial<CampaignLink>) =>
    setInput((prev) => ({ ...prev, links: prev.links.map((l, x) => (x === i ? { ...l, ...p } : l)) }));

  const doPreview = async () => {
    setBusy("preview");
    const r = await previewCircular(input);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    setPreview(r.data.html);
  };

  const runSend = async (mode: "test" | "broadcast") => {
    // Scheduled path: store the circular; the dispatcher sends it at the time.
    if (scheduleOn) {
      const at = schedDate ? wallTimeToUtc(schedDate, schedTime, SCHEDULE_ZONES[schedZone] ?? "Africa/Cairo") : null;
      if (!at) { toast.error("Pick a schedule date and time."); return; }
      if (at.getTime() < Date.now()) { toast.error(`${schedTime} ${schedZone} time on ${schedDate} is already in the past.`); return; }
      if (mode === "broadcast" && !confirm(`Schedule "${input.subject}" to broadcast to every member of ${input.list_email} at ${schedTime} on ${schedDate} (${schedZone} time)?`)) return;
      setBusy(mode);
      const r = await startCircular(input, mode, undefined, { at: at.toISOString(), tz: schedZone });
      setBusy(null);
      if (!r.success) { toast.error(r.error); return; }
      toast.success(`Scheduled — sends ${schedDate} at ${schedTime} (${schedZone} time)${mode === "test" ? " to the saved test addresses" : ""}. Manage it from History.`);
      return;
    }
    if (mode === "broadcast" && !confirm(`Broadcast "${input.subject}" to every member of ${input.list_email}?\n\nEach member receives an individual branded email.`)) return;
    setBusy(mode);
    const start = await startCircular(input, mode, mode === "test" ? testTo.split(/,|;|\n/) : undefined);
    if (!start.success) { setBusy(null); toast.error(start.error); return; }
    const { campaignId, recipients } = start.data;
    setProgress({ total: recipients.length, done: 0, ok: 0, fail: 0 });
    let ok = 0, failCount = 0;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const slice = recipients.slice(i, i + BATCH);
      const r = await sendCircularBatch(campaignId, slice);
      if (!r.success) { toast.error(r.error); break; }
      ok += r.data.ok; failCount += r.data.fail;
      setProgress({ total: recipients.length, done: Math.min(i + BATCH, recipients.length), ok, fail: failCount });
    }
    await finishCircular(campaignId);
    setBusy(null);
    setProgress(null);
    if (failCount === 0) toast.success(mode === "test" ? `Test sent to ${ok} address${ok > 1 ? "es" : ""}.` : `Broadcast delivered to ${ok} of ${recipients.length} members.`);
    else toast.warning(`Sent ${ok} · failed ${failCount} — details in History.`);
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* form */}
      <div className="gm-pane gm-card" style={{ flex: "1 1 420px", minWidth: 360, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px" }}>
        <Field label="Mailing list">
          <select value={input.list_email} onChange={(e) => patch({ list_email: e.target.value })} style={INPUT}>
            {lists.length === 0 && <option value="">— no lists —</option>}
            {lists.map((l) => <option key={l.list} value={l.list}>{l.list}</option>)}
          </select>
        </Field>
        <div className="gm-grid2">
          <Field label="Badge (header pill)">
            <input value={input.badge} onChange={(e) => patch({ badge: e.target.value })} style={INPUT} />
          </Field>
          <Field label="Subject line">
            <input value={input.subject} onChange={(e) => patch({ subject: e.target.value })} style={INPUT} placeholder="Weekly cargo circular — 01 Aug" />
          </Field>
        </div>
        <Field label="Signature office — the mail's date line shows this office's local time">
          <div style={{ display: "flex", gap: 8 }}>
            {(Object.keys(OFFICES) as Office[]).map((o) => (
              <button key={o} onClick={() => patch({ office: o })}
                style={{ ...btn(input.office === o ? "dark" : "ghost"), flex: 1, justifyContent: "center" }}>
                {o}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Title (headline inside the mail — defaults to the subject)">
          <input value={input.title} onChange={(e) => patch({ title: e.target.value })} style={INPUT} />
        </Field>
        <Field label="Body — blank line starts a new paragraph">
          <textarea value={input.body} onChange={(e) => patch({ body: e.target.value })} rows={10}
            style={{ ...INPUT, resize: "vertical", lineHeight: 1.6 }} placeholder={"Dear members,\n\nPlease find below this week's open cargoes…"} />
        </Field>
        {/* AI review — suggestion only; nothing changes until Apply */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: -6, marginBottom: 14 }}>
          <button onClick={() => runReview("proofread")} disabled={!!busy || !input.body.trim()} style={{ ...btn("ghost"), padding: "6px 12px", fontSize: 12.5 }}>
            {busy === "proofread" ? <Loader2 size={13} style={spin} /> : <SpellCheck size={13} />} Fix grammar
          </button>
          <button onClick={() => runReview("rephrase")} disabled={!!busy || !input.body.trim()} style={{ ...btn("ghost"), padding: "6px 12px", fontSize: 12.5 }}>
            {busy === "rephrase" ? <Loader2 size={13} style={spin} /> : <Wand2 size={13} />} Polish tone
          </button>
          <span style={{ fontSize: 11.5, color: C.ink3, alignSelf: "center" }}>AI keeps facts, figures and terms untouched — you approve before it applies.</span>
        </div>
        {suggestion && (
          <div style={{ border: `1px solid ${C.brass}`, background: C.brassBg, borderRadius: 9, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.brassDeep, marginBottom: 8 }}>
              AI suggestion — review, then apply or discard
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.6, color: C.ink, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 7, padding: "10px 12px", maxHeight: 260, overflowY: "auto" }}>
              {suggestion}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => { patch({ body: suggestion }); setSuggestion(null); toast.success("Applied — your original was replaced."); }} style={{ ...btn("dark"), padding: "6px 13px", fontSize: 12.5 }}>
                <Check size={13} /> Apply
              </button>
              <button onClick={() => setSuggestion(null)} style={{ ...btn("ghost"), padding: "6px 13px", fontSize: 12.5 }}>
                <X size={13} /> Keep mine
              </button>
            </div>
          </div>
        )}
        <Field label="Links (become buttons under the body)">
          {input.links.map((l, i) => (
            <div key={i} className="gm-linkrow" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={l.label} onChange={(e) => patchLink(i, { label: e.target.value })} placeholder="Open the cargo board" style={{ ...INPUT, flex: "0 0 40%" }} />
              <input value={l.url} onChange={(e) => patchLink(i, { url: e.target.value })} placeholder="https://…" style={INPUT} />
              <button onClick={() => setInput((p) => ({ ...p, links: p.links.filter((_, x) => x !== i) }))} style={{ ...btn("ghost"), padding: "6px 10px" }}><X size={13} /></button>
            </div>
          ))}
          <button onClick={() => setInput((p) => ({ ...p, links: [...p.links, { label: "", url: "" }] }))} style={{ ...btn("ghost"), padding: "6px 11px" }}>
            <Plus size={13} /> Add link
          </button>
        </Field>

        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 16 }}>
          <Field label="Test addresses (comma-separated)">
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} style={INPUT} placeholder="cap.mdawod@hotmail.com" />
          </Field>

          {/* schedule instead of sending now — prepare at 2 AM, send at 09:00 */}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.ink2, cursor: "pointer", marginBottom: 12, userSelect: "none" }}>
            <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
            Schedule for later — send during working hours
          </label>
          {scheduleOn && (
            <div className="gm-grid2" style={{ marginBottom: 14 }}>
              <Field label="Send date">
                <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} style={INPUT} />
              </Field>
              <Field label={`Send time (${schedZone} local time)`}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={INPUT} />
                  <select value={schedZone} onChange={(e) => setSchedZone(e.target.value)} style={{ ...INPUT, width: 170 }}>
                    {SCHED_ZONE_OPTS.map((z) => <option key={z.label} value={z.label}>{z.label} ({z.off})</option>)}
                  </select>
                </div>
              </Field>
            </div>
          )}
          {scheduleOn && (
            <div style={{ fontSize: 12, color: C.ink3, marginBottom: 12 }}>
              Scheduled test sends go to the <strong>saved</strong> test addresses in Settings; membership for a
              scheduled broadcast is read at send time. The scheduler fires within 10 minutes of the chosen time.
            </div>
          )}

          <div className="gm-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={doPreview} disabled={!!busy} style={btn("ghost")}>
              {busy === "preview" ? <Loader2 size={14} style={spin} /> : <Eye size={14} />} Preview
            </button>
            <button onClick={() => runSend("test")} disabled={!!busy} style={btn("dark")}>
              {busy === "test" ? <Loader2 size={14} style={spin} /> : scheduleOn ? <Clock size={14} /> : <Send size={14} />} {scheduleOn ? "Schedule test" : "Send test"}
            </button>
            <button onClick={() => runSend("broadcast")} disabled={!!busy} style={btn("primary")}>
              {busy === "broadcast" ? <Loader2 size={14} style={spin} /> : scheduleOn ? <Clock size={14} /> : <Mail size={14} />} {scheduleOn ? "Schedule broadcast" : "Broadcast to list"}
            </button>
          </div>
          {progress && (
            <div style={{ marginTop: 14 }}>
              <div style={{ height: 8, background: C.sunken, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round((progress.done / progress.total) * 100)}%`, background: C.brass, transition: "width .3s" }} />
              </div>
              <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 6 }}>
                {progress.done} / {progress.total} sent · {progress.ok} ok{progress.fail ? ` · ${progress.fail} failed` : ""}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* preview */}
      <div className="gm-pane" style={{ flex: "1 1 460px", minWidth: 380 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.ink3, marginBottom: 8 }}>Preview</div>
        {preview ? (
          <iframe title="Email preview" srcDoc={preview} className="gm-preview"
            style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, background: "#eef2f7" }} />
        ) : (
          <div style={{ border: `1px dashed ${C.line}`, borderRadius: 10, padding: "60px 24px", textAlign: "center", color: C.ink3, fontSize: 13.5, background: "#fff" }}>
            Fill the form and press <strong>Preview</strong> to see the branded circular exactly as members receive it.
          </div>
        )}
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────
function HistoryView() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [detail, setDetail] = useState<CampaignRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await listCircularHistory(30);
    setRows(r.success ? r.data : []);
    if (!r.success) toast.error(r.error);
  }, []);
  useEffect(() => {
    let x = false;
    (async () => { await Promise.resolve(); if (!x) await load(); })();
    return () => { x = true; };
  }, [load]);

  const doCancel = async (r: CampaignRow) => {
    if (!confirm(`Cancel the scheduled circular "${r.subject}"?`)) return;
    setBusy(r.id);
    const res = await cancelScheduledCircular(r.id);
    setBusy(null);
    if (!res.success) { toast.error(res.error); return; }
    toast.success("Canceled.");
    await load();
  };
  const doRunNow = async () => {
    setBusy("run");
    const res = await runDispatcherNow();
    setBusy(null);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Scheduler tick: ${res.data.note}${res.data.sent ? ` · ${res.data.sent} sent` : ""}${res.data.failed ? ` · ${res.data.failed} failed` : ""}`);
    await load();
  };
  const hasDue = (rows ?? []).some(
    (r) => r.status === "scheduled" || (r.status === "sending" && r.scheduled_at != null),
  );

  const scheduleLine = (r: CampaignRow) =>
    r.scheduled_at
      ? `${new Date(r.scheduled_at).toLocaleString()}${r.schedule_tz ? ` · set for ${r.schedule_tz} time` : ""}`
      : null;
  const modeChip = (mode: "test" | "broadcast") => (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 3,
      color: mode === "broadcast" ? C.brassDeep : C.ink2, background: mode === "broadcast" ? C.brassBg : C.sunken }}>
      {mode.toUpperCase()}
    </span>
  );
  const resultCell = (r: CampaignRow) =>
    r.status === "scheduled" ? (
      <span style={{ color: C.amber, display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {scheduleLine(r)}</span>
    ) : r.status === "canceled" ? (
      <span style={{ color: C.ink3 }}>canceled</span>
    ) : (
      <>
        <span style={{ color: C.green }}>{r.sent_ok} ok</span>
        {r.sent_fail > 0 && <span style={{ color: C.red }}> · {r.sent_fail} failed</span>}
        {r.status === "sending" && <span style={{ color: C.amber }}> · in progress</span>}
      </>
    );

  return (
    <>
    {/* toolbar: refresh + manual scheduler tick (same path pg_cron drives) */}
    <div className="gm-toolbar" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <span className="gm-toolbar-desc" style={{ fontSize: 12.5, color: C.ink3 }}>
        Scheduled circulars send automatically within 10 minutes of their time.
      </span>
      <button onClick={load} style={{ ...btn("ghost"), marginLeft: "auto", padding: "6px 11px" }}>
        <RefreshCw size={13} /> Refresh
      </button>
      {hasDue && (
        <button onClick={doRunNow} disabled={busy === "run"} style={{ ...btn("primary"), padding: "6px 12px" }}>
          {busy === "run" ? <Loader2 size={13} style={spin} /> : <Send size={13} />} Send due now
        </button>
      )}
    </div>
    {/* phone: one card per circular, tap to view */}
    <div className="gm-cards">
      {rows === null ? (
        <div style={{ padding: 30, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "30px 16px", textAlign: "center", color: C.ink3, fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff" }}>No circulars sent yet.</div>
      ) : rows.map((r) => (
        <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff", padding: "12px 14px" }}>
          <button onClick={() => setDetail(r)} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {modeChip(r.mode)}
              <span style={{ fontSize: 12, color: C.ink3 }}>{new Date(r.created_at).toLocaleString()}</span>
              <Eye size={14} color={C.ink3} style={{ marginLeft: "auto" }} />
            </div>
            <div style={{ fontWeight: 600, color: C.navy, fontSize: 13.5, margin: "6px 0 4px" }}>{r.subject}</div>
            <div style={{ fontSize: 12, color: C.ink2 }}>
              <span style={{ fontFamily: C.mono }}>{r.list_email}</span>
              {r.status !== "scheduled" && r.status !== "canceled" && <> · {r.recipients_total} recipient{r.recipients_total === 1 ? "" : "s"}</>} · {resultCell(r)}
            </div>
          </button>
          {r.status === "scheduled" && (
            <button onClick={() => doCancel(r)} disabled={busy === r.id} style={{ ...btn("danger"), padding: "6px 11px", marginTop: 10 }}>
              {busy === r.id ? <Loader2 size={13} style={spin} /> : <X size={13} />} Cancel schedule
            </button>
          )}
        </div>
      ))}
    </div>
    <div className="gm-scroll gm-table" style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>
          <th style={TH}>Sent</th><th style={TH}>Mode</th><th style={TH}>Subject</th><th style={TH}>List</th>
          <th style={TH}>Recipients</th><th style={TH}>Result</th><th style={{ ...TH, width: 70 }}></th>
        </tr></thead>
        <tbody>
          {rows === null ? (
            <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} style={{ padding: "40px 20px", textAlign: "center", color: C.ink3, fontSize: 14 }}>No circulars sent yet.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} onClick={() => setDetail(r)} style={{ cursor: "pointer" }}
              title="View the mail as sent">
              <td style={{ ...TD, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString()}</td>
              <td style={TD}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 3,
                  color: r.mode === "broadcast" ? C.brassDeep : C.ink2, background: r.mode === "broadcast" ? C.brassBg : C.sunken }}>
                  {r.mode.toUpperCase()}
                </span>
              </td>
              <td style={{ ...TD, fontWeight: 600, color: C.navy }}>{r.subject}</td>
              <td style={{ ...TD, fontFamily: C.mono, fontSize: 12 }}>{r.list_email}</td>
              <td style={TD}>{r.status === "scheduled" || r.status === "canceled" ? "—" : r.recipients_total}</td>
              <td style={TD}>{resultCell(r)}</td>
              <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                {r.status === "scheduled" && (
                  <button onClick={(e) => { e.stopPropagation(); doCancel(r); }} disabled={busy === r.id}
                    style={{ ...btn("danger"), padding: "5px 9px", fontSize: 12, marginRight: 6 }}>
                    {busy === r.id ? <Loader2 size={12} style={spin} /> : <X size={12} />}
                  </button>
                )}
                <span style={{ ...btn("ghost"), padding: "5px 10px", fontSize: 12 }}><Eye size={13} /> View</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {detail && <CircularDetailDrawer row={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

// The mail exactly as members received it, rebuilt from the stored campaign.
function CircularDetailDrawer({ row, onClose }: { row: CampaignRow; onClose: () => void }) {
  const [data, setData] = useState<{ html: string; failures: { email: string; error?: string }[] } | null>(null);
  useEffect(() => {
    let x = false;
    (async () => {
      await Promise.resolve();
      if (x) return;
      const r = await getCircularDetail(row.id);
      if (x) return;
      if (!r.success) { toast.error(r.error); onClose(); return; }
      setData({ html: r.data.html, failures: r.data.failures });
    })();
    return () => { x = true; };
  }, [row.id, onClose]);
  return (
    <Drawer title={row.subject} subtitle={`${row.mode} · ${row.list_email} · ${new Date(row.created_at).toLocaleString()}`} onClose={onClose} wide>
      {data === null ? (
        <div style={{ padding: 40, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.ink2, marginBottom: 12 }}>
            <span>{row.recipients_total} recipient{row.recipients_total === 1 ? "" : "s"}</span>
            <span style={{ color: C.green }}>{row.sent_ok} delivered</span>
            {row.sent_fail > 0 && <span style={{ color: C.red }}>{row.sent_fail} failed</span>}
          </div>
          {data.failures.length > 0 && (
            <div style={{ border: `1px solid ${C.redBg}`, background: "#fdf6f6", borderRadius: 8, padding: "10px 13px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.red, marginBottom: 6 }}>Failed addresses</div>
              {data.failures.map((f, i) => (
                <div key={i} style={{ fontSize: 12.5, fontFamily: C.mono, color: C.ink, marginBottom: 3 }}>
                  {f.email}{f.error ? <span style={{ color: C.ink3 }}> — {f.error}</span> : null}
                </div>
              ))}
            </div>
          )}
          <iframe title="Sent circular" srcDoc={data.html} className="gm-detail-frame"
            style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, background: "#eef2f7" }} />
        </>
      )}
    </Drawer>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
function SettingsView({ config, secrets, onSaved }: {
  config: GroupMailConfig; secrets: GroupMailSecretStatus; onSaved: () => Promise<void>;
}) {
  const [cfg, setCfg] = useState<GroupMailConfig>(config);
  const [cpToken, setCpToken] = useState("");
  const [smtpPw, setSmtpPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Persist the form (config + any entered secrets). Only the Save button
  // writes — the Test buttons pass the on-screen values to the server without
  // saving, so a failed experiment never overwrites a working config.
  const persist = async (): Promise<boolean> => {
    // light normalisation: hosts pasted with a scheme/port still work
    const host = (v: string | null) => (v ?? "").trim().replace(/^https?:\/\//i, "").replace(/[/:].*$/, "") || null;
    const r = await saveGroupMailConfig({
      ...cfg,
      cpanel_host: host(cfg.cpanel_host),
      smtp_host: host(cfg.smtp_host),
      cpanel_user: cfg.cpanel_user?.trim() || null,
      smtp_user: cfg.smtp_user?.trim() || null,
      mailman_base: cfg.mailman_base?.trim().replace(/\/$/, "") || null,
      test_recipients: typeof cfg.test_recipients === "string"
        ? String(cfg.test_recipients).split(/,|;/).map((s) => s.trim()).filter(Boolean)
        : cfg.test_recipients,
    });
    if (!r.success) { toast.error(r.error); return false; }
    if (cpToken.trim()) {
      const s = await saveGroupMailSecret("cpanel_token", cpToken);
      if (!s.success) { toast.error(s.error); return false; }
      setCpToken("");
    }
    if (smtpPw.trim()) {
      const s = await saveGroupMailSecret("smtp_password", smtpPw);
      if (!s.success) { toast.error(s.error); return false; }
      setSmtpPw("");
    }
    await onSaved();
    return true;
  };

  const save = async () => {
    setBusy("save");
    const ok = await persist();
    setBusy(null);
    if (ok) toast.success("Settings saved.");
  };

  const testCp = async () => {
    setBusy("cp");
    const r = await testCpanelConnection({
      host: cfg.cpanel_host, user: cfg.cpanel_user, token: cpToken || undefined,
    });
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`cPanel OK — ${r.data.lists} mailing list${r.data.lists === 1 ? "" : "s"} found. Press Save settings to keep these values.`);
  };
  const testSmtp = async () => {
    setBusy("smtp");
    const r = await testSmtpConnection({
      host: cfg.smtp_host, port: cfg.smtp_port, user: cfg.smtp_user, password: smtpPw || undefined,
    });
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("SMTP OK — login accepted. Press Save settings to keep these values.");
  };

  const set = (p: Partial<GroupMailConfig>) => setCfg((prev) => ({ ...prev, ...p }));
  const secretBadge = (saved: boolean) =>
    saved
      ? <span style={{ color: C.green, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldCheck size={13} /> stored in Vault</span>
      : <span style={{ color: C.amber, fontSize: 12 }}>not set</span>;

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="gm-card" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
        <div style={SECTION}>cPanel (Namecheap hosting) — list management</div>
        <div className="gm-grid2">
          <Field label="cPanel host">
            <input value={cfg.cpanel_host ?? ""} onChange={(e) => set({ cpanel_host: e.target.value })} placeholder="server353-4.web-hosting.com" style={INPUT} />
          </Field>
          <Field label="cPanel username">
            <input value={cfg.cpanel_user ?? ""} onChange={(e) => set({ cpanel_user: e.target.value })} style={INPUT} />
          </Field>
        </div>
        <Field label={<>API token — cPanel → Security → Manage API Tokens · {secretBadge(secrets.cpanel_token)}</>}>
          <input type="password" value={cpToken} onChange={(e) => setCpToken(e.target.value)}
            placeholder={secrets.cpanel_token ? "•••••• (enter to replace)" : "paste the token"} style={INPUT} />
        </Field>
        <Field label="Mailman base URL (default: https://{cpanel host}/mailman)">
          <input value={cfg.mailman_base ?? ""} onChange={(e) => set({ mailman_base: e.target.value })}
            placeholder="https://server353-4.web-hosting.com/mailman" style={INPUT} />
        </Field>
        <button onClick={testCp} disabled={!!busy} style={btn("ghost")}>
          {busy === "cp" ? <Loader2 size={14} style={spin} /> : <Check size={14} />} Test cPanel connection
        </button>
      </div>

      <div className="gm-card" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
        <div style={SECTION}>SMTP — the mailbox circulars are sent from</div>
        <div className="gm-grid21">
          <Field label="SMTP host">
            <input value={cfg.smtp_host ?? ""} onChange={(e) => set({ smtp_host: e.target.value })} placeholder="server353-4.web-hosting.com" style={INPUT} />
          </Field>
          <Field label="Port (465 SSL / 587 STARTTLS)">
            <input type="number" value={cfg.smtp_port} onChange={(e) => set({ smtp_port: Number(e.target.value) || 465 })} style={INPUT} />
          </Field>
        </div>
        <div className="gm-grid2">
          <Field label="Mailbox (full address — also the From)">
            <input value={cfg.smtp_user ?? ""} onChange={(e) => set({ smtp_user: e.target.value })} placeholder="circ@arabshipbroker.com" style={INPUT} />
          </Field>
          <Field label="From name">
            <input value={cfg.from_name} onChange={(e) => set({ from_name: e.target.value })} style={INPUT} />
          </Field>
        </div>
        <Field label={<>Mailbox password · {secretBadge(secrets.smtp_password)}</>}>
          <input type="password" value={smtpPw} onChange={(e) => setSmtpPw(e.target.value)}
            placeholder={secrets.smtp_password ? "•••••• (enter to replace)" : "mailbox password"} style={INPUT} />
        </Field>
        <button onClick={testSmtp} disabled={!!busy} style={btn("ghost")}>
          {busy === "smtp" ? <Loader2 size={14} style={spin} /> : <Check size={14} />} Test SMTP login
        </button>
      </div>

      <div className="gm-card" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
        <div style={SECTION}>Testing</div>
        <Field label="Default test addresses (comma-separated)">
          <input value={Array.isArray(cfg.test_recipients) ? cfg.test_recipients.join(", ") : (cfg.test_recipients ?? "")}
            onChange={(e) => set({ test_recipients: e.target.value as unknown as string[] })}
            placeholder="cap.mdawod@hotmail.com" style={INPUT} />
        </Field>
      </div>

      <button onClick={save} disabled={!!busy} style={btn("primary")}>
        {busy === "save" ? <Loader2 size={15} style={spin} /> : <Check size={15} />} Save settings
      </button>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

function Drawer({ title, subtitle, onClose, children, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div ref={ref} onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.34)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: wide ? "min(680px, 96vw)" : "min(520px, 94vw)", height: "100%", background: "#fff", boxShadow: "-8px 0 32px rgba(0,0,0,.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 22px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.navy }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: C.ink3, fontFamily: C.mono, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: C.ink2, padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function DrawerActions({ saving, onSave, onCancel, saveLabel }: {
  saving: boolean; onSave: () => void; onCancel: () => void; saveLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
      <button onClick={onSave} disabled={saving} style={btn("primary")}>
        {saving ? <Loader2 size={15} style={spin} /> : <Check size={15} />} {saveLabel}
      </button>
      <button onClick={onCancel} style={btn("ghost")}>Cancel</button>
    </div>
  );
}

const TH: React.CSSProperties = {
  textAlign: "left", padding: "9px 14px", fontSize: 11, fontWeight: 600, letterSpacing: ".03em",
  textTransform: "uppercase", color: C.ink3, background: "#fafbfc", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "9px 14px", borderBottom: `1px solid ${C.line}`, fontSize: 13, color: C.ink,
};
const INPUT: React.CSSProperties = {
  width: "100%", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.line}`,
  font: "inherit", fontSize: 13.5, color: C.ink, background: "#fff", boxSizing: "border-box",
};
const SECTION: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.ink3, marginBottom: 14,
};
