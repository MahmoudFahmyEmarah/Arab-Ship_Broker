"use client";

// Group Mail — owner console for the cPanel/Mailman mailing lists + branded
// circulars. Four views: Mailing Lists (cPanel CRUD + Mailman members),
// Compose (branded circular + preview + test + broadcast), History, Settings
// (hosts + Vault secrets). Visual language matches the Data Sync module.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Mail, Plus, Trash2, Check, X, Users, Settings2, Send, Eye,
  RefreshCw, Pencil, KeyRound, History as HistoryIcon, ShieldCheck,
} from "lucide-react";
import {
  getGroupMailState, saveGroupMailConfig, saveGroupMailSecret,
  testCpanelConnection, testSmtpConnection,
  listMailingLists, createMailingList, deleteMailingList, updateMailingList, saveListPassword,
  getListMembers, addListMembers, removeListMembers, replaceListMember,
  previewCircular, startCircular, sendCircularBatch, finishCircular, listCircularHistory,
} from "@/app/(admin)/admin/group-mail/actions";
import type {
  GroupMailConfig, GroupMailSecretStatus, MailingListRow, ListMember, CampaignInput, CampaignRow, CampaignLink,
} from "@/lib/groupmail/types";
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
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.line}`, marginBottom: 20 }}>
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

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, color: C.ink2 }}>
          Lists live on the Namecheap hosting (cPanel → Mailing Lists); members are managed on the list itself.
        </div>
        <button onClick={onReload} disabled={loading} style={{ ...btn("ghost"), marginLeft: "auto" }}>
          {loading ? <Loader2 size={14} style={spin} /> : <RefreshCw size={14} />} Refresh
        </button>
        <button onClick={() => setCreating(true)} style={btn("primary")}><Plus size={15} /> New list</button>
      </div>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
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

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 9, overflow: "hidden", marginBottom: 16 }}>
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
    list_email: "", badge: "Circulation", subject: "", title: "", body: "", links: [],
  });
  const [testTo, setTestTo] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; done: number; ok: number; fail: number } | null>(null);

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
      <div style={{ flex: "1 1 420px", minWidth: 360, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px" }}>
        <Field label="Mailing list">
          <select value={input.list_email} onChange={(e) => patch({ list_email: e.target.value })} style={INPUT}>
            {lists.length === 0 && <option value="">— no lists —</option>}
            {lists.map((l) => <option key={l.list} value={l.list}>{l.list}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Badge (header pill)">
            <input value={input.badge} onChange={(e) => patch({ badge: e.target.value })} style={INPUT} />
          </Field>
          <Field label="Subject line">
            <input value={input.subject} onChange={(e) => patch({ subject: e.target.value })} style={INPUT} placeholder="Weekly cargo circular — 01 Aug" />
          </Field>
        </div>
        <Field label="Title (headline inside the mail — defaults to the subject)">
          <input value={input.title} onChange={(e) => patch({ title: e.target.value })} style={INPUT} />
        </Field>
        <Field label="Body — blank line starts a new paragraph">
          <textarea value={input.body} onChange={(e) => patch({ body: e.target.value })} rows={10}
            style={{ ...INPUT, resize: "vertical", lineHeight: 1.6 }} placeholder={"Dear members,\n\nPlease find below this week's open cargoes…"} />
        </Field>
        <Field label="Links (become buttons under the body)">
          {input.links.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={doPreview} disabled={!!busy} style={btn("ghost")}>
              {busy === "preview" ? <Loader2 size={14} style={spin} /> : <Eye size={14} />} Preview
            </button>
            <button onClick={() => runSend("test")} disabled={!!busy} style={btn("dark")}>
              {busy === "test" ? <Loader2 size={14} style={spin} /> : <Send size={14} />} Send test
            </button>
            <button onClick={() => runSend("broadcast")} disabled={!!busy} style={{ ...btn("primary"), marginLeft: "auto" }}>
              {busy === "broadcast" ? <Loader2 size={14} style={spin} /> : <Mail size={14} />} Broadcast to list
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
      <div style={{ flex: "1 1 460px", minWidth: 380 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.ink3, marginBottom: 8 }}>Preview</div>
        {preview ? (
          <iframe title="Email preview" srcDoc={preview}
            style={{ width: "100%", height: 720, border: `1px solid ${C.line}`, borderRadius: 10, background: "#eef2f7" }} />
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
  useEffect(() => {
    let x = false;
    (async () => {
      await Promise.resolve();
      if (x) return;
      const r = await listCircularHistory(30);
      if (!x) setRows(r.success ? r.data : []);
      if (!r.success) toast.error(r.error);
    })();
    return () => { x = true; };
  }, []);
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>
          <th style={TH}>Sent</th><th style={TH}>Mode</th><th style={TH}>Subject</th><th style={TH}>List</th>
          <th style={TH}>Recipients</th><th style={TH}>Result</th>
        </tr></thead>
        <tbody>
          {rows === null ? (
            <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: C.ink3 }}><Loader2 size={20} style={spin} /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={6} style={{ padding: "40px 20px", textAlign: "center", color: C.ink3, fontSize: 14 }}>No circulars sent yet.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id}>
              <td style={{ ...TD, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString()}</td>
              <td style={TD}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 3,
                  color: r.mode === "broadcast" ? C.brassDeep : C.ink2, background: r.mode === "broadcast" ? C.brassBg : C.sunken }}>
                  {r.mode.toUpperCase()}
                </span>
              </td>
              <td style={{ ...TD, fontWeight: 600, color: C.navy }}>{r.subject}</td>
              <td style={{ ...TD, fontFamily: C.mono, fontSize: 12 }}>{r.list_email}</td>
              <td style={TD}>{r.recipients_total}</td>
              <td style={TD}>
                <span style={{ color: C.green }}>{r.sent_ok} ok</span>
                {r.sent_fail > 0 && <span style={{ color: C.red }}> · {r.sent_fail} failed</span>}
                {r.status === "sending" && <span style={{ color: C.amber }}> · in progress</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

  const save = async () => {
    setBusy("save");
    const r = await saveGroupMailConfig({
      ...cfg,
      test_recipients: typeof cfg.test_recipients === "string"
        ? String(cfg.test_recipients).split(/,|;/).map((s) => s.trim()).filter(Boolean)
        : cfg.test_recipients,
    });
    let secretErr: string | null = null;
    if (cpToken.trim()) {
      const s = await saveGroupMailSecret("cpanel_token", cpToken);
      if (!s.success) secretErr = s.error; else setCpToken("");
    }
    if (smtpPw.trim()) {
      const s = await saveGroupMailSecret("smtp_password", smtpPw);
      if (!s.success) secretErr = s.error; else setSmtpPw("");
    }
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    if (secretErr) { toast.error(secretErr); return; }
    toast.success("Settings saved.");
    await onSaved();
  };

  const testCp = async () => {
    setBusy("cp");
    const r = await testCpanelConnection();
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`cPanel OK — ${r.data.lists} mailing list${r.data.lists === 1 ? "" : "s"} found.`);
  };
  const testSmtp = async () => {
    setBusy("smtp");
    const r = await testSmtpConnection();
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("SMTP OK — login accepted.");
  };

  const set = (p: Partial<GroupMailConfig>) => setCfg((prev) => ({ ...prev, ...p }));
  const secretBadge = (saved: boolean) =>
    saved
      ? <span style={{ color: C.green, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldCheck size={13} /> stored in Vault</span>
      : <span style={{ color: C.amber, fontSize: 12 }}>not set</span>;

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
        <div style={SECTION}>cPanel (Namecheap hosting) — list management</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
        <div style={SECTION}>SMTP — the mailbox circulars are sent from</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <Field label="SMTP host">
            <input value={cfg.smtp_host ?? ""} onChange={(e) => set({ smtp_host: e.target.value })} placeholder="server353-4.web-hosting.com" style={INPUT} />
          </Field>
          <Field label="Port (465 SSL / 587 STARTTLS)">
            <input type="number" value={cfg.smtp_port} onChange={(e) => set({ smtp_port: Number(e.target.value) || 465 })} style={INPUT} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "18px 20px", marginBottom: 16 }}>
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
