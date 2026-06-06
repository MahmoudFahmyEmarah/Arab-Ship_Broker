"use client";

// Account Settings — ported from the design (asb/pages.jsx PageSettings):
// tabbed (Account & Profile / Preferences / Security & Privacy / Subscription),
// two-column settings-card grid. Uses the real signed-in account (no demo
// identity) and the existing server actions so editing is fully wired.
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDashboard } from "@/contexts/DashboardContext";
import { useViewerTier } from "@/lib/portal/tier";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getMyProfiles, updateProfile } from "@/sdk/app/profiles";
import type { Profile } from "@/lib/schemas/account";
import * as V from "@/lib/portal/validation";
import {
  updateBasicInfo,
  requestEmailChange,
  updatePassword,
} from "@/app/(dashboard)/dashboard/account/actions";
import { IconUser, IconDoc, IconDashboard, IconBell, IconShield, IconShieldLock, IconStar } from "./icons";

function SettingsRow({ k, v, blue }: { k: string; v: React.ReactNode; blue?: boolean }) {
  return (
    <div className="settings-row">
      <span className="k">{k}</span>
      <span className={`v ${blue ? "blue" : ""}`}>{v}</span>
    </div>
  );
}
function EditField({
  label, value, onChange, placeholder, error, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  type?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--asb-gray-500)" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          height: 32, background: "var(--asb-white)", borderRadius: 6, padding: "4px 9px",
          fontSize: 12, color: "var(--asb-ink)", width: "100%",
          border: `1px solid ${error ? "var(--asb-red)" : "var(--asb-gray-200, #DDE5F0)"}`,
        }}
      />
      {error && <span style={{ fontSize: 10.5, color: "var(--asb-red)" }}>{error}</span>}
    </label>
  );
}

function ToggleRow({ label, on }: { label: string; on?: boolean }) {
  const [val, setVal] = React.useState(!!on);
  return (
    <div className="settings-row" onClick={() => setVal((v) => !v)} style={{ cursor: "pointer" }}>
      <span className="k">{label}</span>
      <span className={`toggle ${val ? "is-on" : ""}`} />
    </div>
  );
}

const TIER_LABEL: Record<string, string> = { T1: "Free", T2: "Standard", T3: "Subscriber", T4: "Partner" };
const ROLE_LABEL: Record<string, string> = {
  admin: "ADMIN", broker: "BROKER", cargo_owner: "CARGO OWNER", vessel_owner: "VESSEL OWNER",
};

export function SettingsBoard({ role, memberSince }: { role?: string | null; memberSince?: string | null }) {
  const [tab, setTab] = React.useState("account");
  const router = useRouter();
  const { account } = useDashboard();
  const tier = useViewerTier();
  const email = account?.email ?? "—";
  const roleLabel = role ? ROLE_LABEL[role] ?? role.toUpperCase() : "—";

  // ── Profiles (display name / company / phone live on the profile rows) ──
  const [profiles, setProfiles] = React.useState<Profile[] | null>(null);
  const loadProfiles = React.useCallback(async () => {
    try {
      setProfiles(await getMyProfiles(getSupabaseBrowserClient()));
    } catch {
      setProfiles([]);
    }
  }, []);
  React.useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const displayName = profiles?.[0]?.display_name ?? "—";
  const company = profiles?.[0]?.company ?? "—";
  const phoneDisp = profiles?.[0]?.phone ?? "—";

  // ── Account & Identity edit (full name + display name + company + phone) ──
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [form, setForm] = React.useState({ fullName: "", displayName: "", company: "", phone: "" });
  const beginEdit = () => {
    setForm({
      fullName: account?.fullName ?? "",
      displayName: profiles?.[0]?.display_name ?? "",
      company: profiles?.[0]?.company ?? "",
      phone: profiles?.[0]?.phone ?? "",
    });
    setTouched(false);
    setEditing(true);
  };
  const errors = V.collect<"fullName" | "company" | "phone" | "displayName">([
    ["fullName", V.required(form.fullName, "Full name is required") || V.inRange(form.fullName.length, { min: 2, max: 120, msg: "Full name must be 2–120 characters" })],
    ["company", form.company.trim() ? V.inRange(form.company.length, { min: 2, max: 120, msg: "Company must be 2–120 characters" }) : null],
    ["phone", V.phone(form.phone)],
    ["displayName", form.displayName.trim() ? V.inRange(form.displayName.length, { min: 2, max: 80, msg: "Display name must be 2–80 characters" }) : null],
  ]);
  const saveIdentity = async () => {
    setTouched(true);
    if (V.hasIssues(errors)) return;
    setSaving(true);
    try {
      const res = await updateBasicInfo(form.fullName);
      if (!res.success) throw new Error(res.error);
      const supabase = getSupabaseBrowserClient();
      await Promise.all(
        (profiles ?? []).map((p) =>
          updateProfile(supabase, p.id, {
            display_name: form.displayName.trim() || null,
            company: form.company.trim() || null,
            phone: form.phone.trim() || null,
          }),
        ),
      );
      await loadProfiles();
      setEditing(false);
      setTouched(false);
      router.refresh();
      toast.success("Account updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  // ── Email change + password (Security tab) ──
  const [newEmail, setNewEmail] = React.useState("");
  const [emailBusy, setEmailBusy] = React.useState(false);
  const sendEmailChange = async () => {
    const err = V.email(newEmail);
    if (err) { toast.error(err); return; }
    setEmailBusy(true);
    try {
      const res = await requestEmailChange(newEmail);
      if (!res.success) throw new Error(res.error);
      setNewEmail("");
      toast.success("Confirmation sent to both your old and new email.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start email change");
    } finally {
      setEmailBusy(false);
    }
  };
  const [pw, setPw] = React.useState({ cur: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = React.useState(false);
  const changePassword = async () => {
    if (pw.next.length < 8) { toast.error("New password must be at least 8 characters."); return; }
    if (pw.next !== pw.confirm) { toast.error("Passwords do not match."); return; }
    setPwBusy(true);
    try {
      const res = await updatePassword(pw.cur, pw.next);
      if (!res.success) throw new Error(res.error);
      setPw({ cur: "", next: "", confirm: "" });
      toast.success("Password updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update password");
    } finally {
      setPwBusy(false);
    }
  };

  const workspace = account?.hasCargoProfile && account?.hasVesselProfile
    ? "Cargo + Vessels" : account?.hasVesselProfile ? "Vessels" : "Cargo";

  const TABS = [
    { id: "account", label: "Account & Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "security", label: "Security & Privacy" },
    { id: "billing", label: "Subscription & Billing" },
  ];
  const muted = { color: "var(--asb-gray-500)", fontStyle: "italic" as const };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 20px 0", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <h1 className="page-title">Account Settings</h1>
        <div style={{ fontSize: 12, color: "var(--asb-gray-500)", marginTop: 2 }}>Manage your identity, preferences and security</div>
        <div className="settings-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`settings-tab${tab === t.id ? " is-active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, gridAutoRows: "min-content" }}>
          {tab === "account" && (
            <>
              <div className="settings-card">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-blue-light)", color: "var(--asb-blue)" }}><IconUser size={16} /></span>
                  <span className="title">Account &amp; Identity</span>
                  {!editing ? (
                    <button className="action" onClick={beginEdit}>Edit</button>
                  ) : (
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button className="action" onClick={() => { setEditing(false); setTouched(false); }}>Cancel</button>
                      <button className="action" style={{ color: "var(--asb-blue)", fontWeight: 600 }} onClick={saveIdentity} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                    </div>
                  )}
                </div>
                {!editing ? (
                  <>
                    <SettingsRow k="Full name" v={account?.fullName ?? "—"} />
                    <SettingsRow k="Display name" v={displayName} />
                    <SettingsRow k="Company" v={company} />
                    <SettingsRow k="Email" v={email} blue />
                    <SettingsRow k="Phone" v={phoneDisp} />
                    <SettingsRow k="Role" v={<span className="asb-badge blue">{roleLabel}</span>} />
                    <SettingsRow k="Member since" v={memberSince ?? "—"} />
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                    <EditField label="Full name *" value={form.fullName} onChange={(v) => setForm((f) => ({ ...f, fullName: v }))} error={touched ? errors.fullName : undefined} />
                    <EditField label="Display name" value={form.displayName} onChange={(v) => setForm((f) => ({ ...f, displayName: v }))} placeholder="Shown to counterparties" error={touched ? errors.displayName : undefined} />
                    <EditField label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} placeholder="e.g. Gulf Maritime LLC" error={touched ? errors.company : undefined} />
                    <EditField label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="e.g. +971 4 000 0000" error={touched ? errors.phone : undefined} />
                    <div style={{ fontSize: 10.5, color: "var(--asb-gray-500)" }}>To change your email or password, use the Security &amp; Privacy tab.</div>
                  </div>
                )}
              </div>

              <div className="settings-card">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-blue-light)", color: "var(--asb-blue)" }}><IconDoc size={16} /></span>
                  <div>
                    <div className="title">Market Profile</div>
                    <div className="sub">Visible to Arab ShipBroker only</div>
                  </div>
                </div>
                <SettingsRow k="Workspace" v={workspace} />
                <SettingsRow k="Operating zones" v={<span style={muted}>Not set</span>} />
                <SettingsRow k="Preferred cargo" v={<span style={muted}>Not set</span>} />
                <SettingsRow k="DWT range focus" v={<span style={muted}>Not set</span>} />
                <SettingsRow k="Account status" v={account?.isActive === false ? <span style={{ color: "var(--asb-red)" }}>Suspended</span> : <><span className="asb-dot green" /> Active</>} />
              </div>
            </>
          )}

          {tab === "preferences" && (
            <>
              <div className="settings-card">
                <div className="head">
                  <span className="icon-box" style={{ background: "#F3E5F5", color: "#4B0082" }}><IconDashboard size={16} /></span>
                  <span className="title">Display &amp; Preferences</span>
                  <button className="action">Edit</button>
                </div>
                <SettingsRow k="Theme" v="Light" />
                <SettingsRow k="Default board view" v="Cards + Map" />
                <SettingsRow k="Map default state" v="Hidden" />
                <SettingsRow k="Card density" v="Compact" />
                <SettingsRow k="Default sort" v="By urgency" />
                <SettingsRow k="Date format" v="DD/MM/YYYY" />
                <SettingsRow k="Currency" v="USD" />
                <SettingsRow k="Language" v="English" />
              </div>
              <div className="settings-card">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-amber-bg)", color: "var(--asb-amber)" }}><IconBell size={16} /></span>
                  <span className="title">Notifications &amp; Alerts</span>
                  <button className="action">Configure</button>
                </div>
                <div className="eyebrow" style={{ marginBottom: 2 }}>Email alerts</div>
                <ToggleRow label="Listing approved" on />
                <ToggleRow label="New match found" on />
                <ToggleRow label="Laycan closing < 72 hrs" on />
                <ToggleRow label="Open date overdue" on />
                <ToggleRow label="ASB correction" />
              </div>
            </>
          )}

          {tab === "security" && (
            <>
              <div className="settings-card">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-blue-light)", color: "var(--asb-blue)" }}><IconShield size={16} /></span>
                  <span className="title">Sign-in &amp; Email</span>
                </div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Change email</div>
                <div style={{ fontSize: 11, color: "var(--asb-gray-500)", marginBottom: 6 }}>Requires confirmation from both your old and new address.</div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <EditField label="New email" value={newEmail} onChange={setNewEmail} placeholder="new@example.com" type="email" />
                  </div>
                  <button className="asb-btn primary" onClick={sendEmailChange} disabled={emailBusy} style={{ height: 32 }}>{emailBusy ? "Sending…" : "Send"}</button>
                </div>
                <div className="eyebrow" style={{ marginTop: 12, marginBottom: 4 }}>Change password</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <EditField label="Current password" value={pw.cur} onChange={(v) => setPw((p) => ({ ...p, cur: v }))} type="password" />
                  <EditField label="New password" value={pw.next} onChange={(v) => setPw((p) => ({ ...p, next: v }))} type="password" />
                  <EditField label="Confirm new password" value={pw.confirm} onChange={(v) => setPw((p) => ({ ...p, confirm: v }))} type="password" />
                  <button className="asb-btn" onClick={changePassword} disabled={pwBusy} style={{ width: "100%", justifyContent: "center" }}>{pwBusy ? "Updating…" : "Update password"}</button>
                </div>
                <div className="eyebrow" style={{ marginTop: 12, marginBottom: 4 }}>Two-factor auth</div>
                <SettingsRow k="2-factor auth" v={<span style={{ color: "var(--asb-red)" }}>Disabled</span>} />
              </div>
              <div className="settings-card danger">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-red-bg)", color: "var(--asb-red)" }}><IconShieldLock size={16} /></span>
                  <span className="title">Privacy &amp; Data</span>
                </div>
                <SettingsRow k="Encryption" v={<span style={{ color: "var(--asb-green)" }}>AES-256 at rest + in transit</span>} />
                <SettingsRow k="3rd-party sharing" v={<span style={{ color: "var(--asb-green)" }}>Never</span>} />
                <SettingsRow k="Retention" v="7 years per maritime regs" />
                <SettingsRow k="Visibility" v="Arab ShipBroker only until your listing is approved" />
                <button className="asb-btn danger" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>Delete my account →</button>
              </div>
            </>
          )}

          {tab === "billing" && (
            <div className="settings-card" style={{ gridColumn: "1 / -1" }}>
              <div className="head">
                <span className="icon-box" style={{ background: "var(--asb-green-bg)", color: "var(--asb-green)" }}><IconStar size={16} /></span>
                <div>
                  <div className="title">Subscription &amp; Access</div>
                  <div className="sub">Your current plan and billing</div>
                </div>
                <button className="action" style={{ marginLeft: "auto" }}>Manage billing</button>
              </div>
              <SettingsRow k="Current plan" v={<span className="asb-badge blue">{TIER_LABEL[tier]} ({tier})</span>} />
              <SettingsRow k="Match intelligence" v={tier === "T1" || tier === "T2" ? "Limited" : "Full"} />
              <SettingsRow k="Voyage calculators" v={tier === "T1" || tier === "T2" ? <span style={{ color: "var(--asb-amber)" }}>Locked</span> : "Unlocked"} />
              <SettingsRow k="Listings archive" v={tier === "T4" ? "12 months" : tier === "T3" ? "6 months" : tier === "T2" ? "30 days" : "7 days"} />
              {(tier === "T1" || tier === "T2") && (
                <button className="asb-btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>Upgrade to Subscriber →</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
