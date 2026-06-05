"use client";

// Account Settings — ported from the design (asb/pages.jsx PageSettings):
// tabbed (Account & Profile / Preferences / Security & Privacy / Subscription).
// Uses the real signed-in account where available (no demo identity).
import * as React from "react";
import { useDashboard } from "@/contexts/DashboardContext";
import { useViewerTier } from "@/lib/portal/tier";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getMyProfiles, updateProfile } from "@/sdk/app/profiles";
import type { Profile } from "@/lib/schemas/account";
import * as V from "@/lib/portal/validation";
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
  label, value, onChange, placeholder, error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--asb-gray-500)" }}>{label}</span>
      <input
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

export function SettingsBoard() {
  const [tab, setTab] = React.useState("account");
  const { account } = useDashboard();
  const tier = useViewerTier();
  const fullName = account?.fullName ?? "Account";
  const email = account?.email ?? "—";

  // ── Editable market profile (company + phone), validated per the matrix ──
  const [profiles, setProfiles] = React.useState<Profile[] | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [pForm, setPForm] = React.useState({ company: "", phone: "", displayName: "" });
  const [touched, setTouched] = React.useState(false);

  const loadProfiles = React.useCallback(async () => {
    try {
      const list = await getMyProfiles(getSupabaseBrowserClient());
      setProfiles(list);
      const p = list[0];
      setPForm({ company: p?.company ?? "", phone: p?.phone ?? "", displayName: p?.display_name ?? "" });
    } catch {
      setProfiles([]);
    }
  }, []);
  React.useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const profileErrors = V.collect<"company" | "phone" | "displayName">([
    ["company", V.required(pForm.company, "Company name is required") || V.inRange(pForm.company.length, { min: 2, max: 120, msg: "Company name must be 2–120 characters" })],
    ["phone", V.phone(pForm.phone)],
    ["displayName", pForm.displayName.trim() ? V.inRange(pForm.displayName.length, { min: 2, max: 80, msg: "Display name must be 2–80 characters" }) : null],
  ]);
  const company = profiles?.[0]?.company ?? "—";
  const phoneDisp = profiles?.[0]?.phone ?? "—";

  const saveProfile = async () => {
    setTouched(true);
    if (V.hasIssues(profileErrors)) return;
    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      // Keep company/phone consistent across the account's active profiles.
      await Promise.all(
        (profiles ?? []).map((p) =>
          updateProfile(supabase, p.id, {
            company: pForm.company.trim() || null,
            phone: pForm.phone.trim() || null,
            display_name: pForm.displayName.trim() || null,
          }),
        ),
      );
      await loadProfiles();
      setEditing(false);
      setTouched(false);
    } catch {
      /* best-effort; RLS/network errors leave edit mode open */
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { id: "account", label: "Account & Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "security", label: "Security & Privacy" },
    { id: "billing", label: "Subscription & Billing" },
  ];

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
                  <button className="action">Edit</button>
                </div>
                <SettingsRow k="Full name" v={fullName} />
                <SettingsRow k="Email" v={email} blue />
                <SettingsRow k="Account status" v={account?.isActive === false ? <span style={{ color: "var(--asb-red)" }}>Suspended</span> : <><span className="asb-dot green" /> Active</>} />
                <SettingsRow k="Trust tier" v={<span className="asb-badge blue">{account?.trustTier ?? "—"}</span>} />
              </div>
              <div className="settings-card">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-blue-light)", color: "var(--asb-blue)" }}><IconDoc size={16} /></span>
                  <div>
                    <div className="title">Market Profile</div>
                    <div className="sub">Visible to Arab ShipBroker only</div>
                  </div>
                  {!editing ? (
                    <button className="action" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)} disabled={!profiles?.length}>Edit</button>
                  ) : (
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button className="action" onClick={() => { setEditing(false); setTouched(false); void loadProfiles(); }}>Cancel</button>
                      <button className="action" style={{ color: "var(--asb-blue)", fontWeight: 600 }} onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                    </div>
                  )}
                </div>
                <SettingsRow k="Workspace" v={account?.hasCargoProfile && account?.hasVesselProfile ? "Cargo + Vessels" : account?.hasVesselProfile ? "Vessels" : "Cargo"} />
                {!editing ? (
                  <>
                    <SettingsRow k="Company" v={company} />
                    <SettingsRow k="Phone" v={phoneDisp} />
                    <SettingsRow k="Cargo profile" v={account?.hasCargoProfile ? "Active" : "—"} />
                    <SettingsRow k="Vessel profile" v={account?.hasVesselProfile ? "Active" : "—"} />
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                    <EditField label="Company *" value={pForm.company} onChange={(v) => setPForm((f) => ({ ...f, company: v }))} placeholder="e.g. Gulf Maritime LLC" error={touched ? profileErrors.company : undefined} />
                    <EditField label="Phone" value={pForm.phone} onChange={(v) => setPForm((f) => ({ ...f, phone: v }))} placeholder="e.g. +971 4 000 0000" error={touched ? profileErrors.phone : undefined} />
                    <EditField label="Display name" value={pForm.displayName} onChange={(v) => setPForm((f) => ({ ...f, displayName: v }))} placeholder="Shown to counterparties" error={touched ? profileErrors.displayName : undefined} />
                  </div>
                )}
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
                  <span className="title">Security</span>
                  <button className="action">Manage</button>
                </div>
                <SettingsRow k="2-factor auth" v={<span style={{ color: "var(--asb-red)" }}>Disabled</span>} />
                <button className="asb-btn" style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>Enable 2FA</button>
                <div className="eyebrow" style={{ marginTop: 8, marginBottom: 4 }}>Active sessions</div>
                <div style={{ fontSize: 10 }}>This device · <span style={{ color: "var(--asb-green)" }}>● Active now</span></div>
              </div>
              <div className="settings-card danger">
                <div className="head">
                  <span className="icon-box" style={{ background: "var(--asb-red-bg)", color: "var(--asb-red)" }}><IconShieldLock size={16} /></span>
                  <span className="title">Privacy &amp; Data</span>
                </div>
                <SettingsRow k="Encryption" v={<span style={{ color: "var(--asb-green)" }}>AES-256</span>} />
                <SettingsRow k="3rd-party sharing" v={<span style={{ color: "var(--asb-green)" }}>Never</span>} />
                <SettingsRow k="Retention" v="7 years (maritime regs)" />
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
