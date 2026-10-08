"use client";

// Fixture Room notification delivery settings (C2O-092 #7): in-app on/off, email instant / daily digest / off and the
// digest hour, read and written through the shared core's member RPCs. The defaults are stated, never implied.
import * as React from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { IconBell } from "./icons";

type EmailMode = "instant" | "digest" | "off";
interface Prefs { inAppEnabled: boolean; emailMode: EmailMode; digestHourUtc: number; isDefault: boolean }

const MODE_LABEL: Record<EmailMode, string> = { instant: "Each one by email", digest: "One daily digest", off: "No email" };
const hour = (h: number) => `${String(h).padStart(2, "0")}:00 UTC`;

export function NotificationDeliveryCard() {
  const [prefs, setPrefs] = React.useState<Prefs | null>(null);
  const [draft, setDraft] = React.useState<Prefs | null>(null);
  const [state, setState] = React.useState<{ busy: boolean; error: string | null; saved: boolean }>({ busy: false, error: null, saved: false });

  const load = React.useCallback(async () => {
    const { data, error } = await getSupabaseBrowserClient().rpc("get_my_notification_preferences");
    if (error || !data) { setState((s) => ({ ...s, error: "Your notification settings could not be loaded." })); return; }
    const d = data as { inAppEnabled: boolean; emailMode: EmailMode; digestHourUtc: number; isDefault: boolean };
    setPrefs({ inAppEnabled: d.inAppEnabled, emailMode: d.emailMode, digestHourUtc: d.digestHourUtc, isDefault: d.isDefault });
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setState({ busy: true, error: null, saved: false });
    const { error } = await getSupabaseBrowserClient().rpc("set_notification_preferences", {
      p_in_app_enabled: draft.inAppEnabled, p_email_mode: draft.emailMode, p_digest_hour_utc: draft.digestHourUtc,
    });
    if (error) { setState({ busy: false, error: "The settings were not saved. Please try again.", saved: false }); return; }
    setDraft(null);
    await load();
    setState({ busy: false, error: null, saved: true });
  };

  const shown = draft ?? prefs;
  return (
    <div className="settings-card" data-testid="notification-delivery">
      <div className="head">
        <span className="icon-box" style={{ background: "var(--asb-amber-bg)", color: "var(--asb-amber)" }}><IconBell size={16} /></span>
        <span className="title">Fixture notifications</span>
        {prefs && !draft && <button className="action" onClick={() => { setDraft(prefs); setState((s) => ({ ...s, saved: false })); }}>Edit</button>}
        {draft && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button className="action" onClick={() => setDraft(null)} disabled={state.busy}>Cancel</button>
            <button className="action" style={{ color: "var(--asb-blue)", fontWeight: 600 }} onClick={() => void save()} disabled={state.busy}>Save</button>
          </div>
        )}
      </div>
      {!shown ? (
        <div style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{state.error ?? "Loading…"}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input type="checkbox" checked={shown.inAppEnabled} disabled={!draft} onChange={(e) => setDraft((d) => d && { ...d, inAppEnabled: e.target.checked })} aria-label="Show notifications in the bell" />
            Show them in the bell
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <span className="eyebrow">Email</span>
            <select value={shown.emailMode} disabled={!draft} aria-label="Email delivery" onChange={(e) => setDraft((d) => d && { ...d, emailMode: e.target.value as EmailMode })}>
              {(Object.keys(MODE_LABEL) as EmailMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </label>
          {shown.emailMode === "digest" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
              <span className="eyebrow">Digest time</span>
              <select value={shown.digestHourUtc} disabled={!draft} aria-label="Digest hour" onChange={(e) => setDraft((d) => d && { ...d, digestHourUtc: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}
              </select>
            </label>
          )}
          <div style={{ fontSize: 11, color: "var(--asb-gray-500)", lineHeight: 1.45 }}>
            {shown.emailMode === "off"
              ? "No email at all: anything still waiting is cancelled straight away (an email already on its way at that moment may still arrive). The bell still shows everything."
              : "Urgent items — an invitation, an offer with a deadline, the other side confirming a fixture, a recap to acknowledge — are emailed at once. "
                + (shown.emailMode === "digest" ? `Everything else arrives in one email at ${hour(shown.digestHourUtc)}.` : "Everything else is emailed as it happens.")}
            {prefs?.isDefault && !draft && " These are the platform defaults (daily digest at 07:00 UTC); you have not changed them."}
          </div>
          {state.error && <div role="alert" style={{ fontSize: 11, color: "var(--asb-red)" }}>{state.error}</div>}
          {state.saved && <div role="status" style={{ fontSize: 11, color: "var(--asb-green)" }}>Saved.</div>}
        </div>
      )}
    </div>
  );
}
