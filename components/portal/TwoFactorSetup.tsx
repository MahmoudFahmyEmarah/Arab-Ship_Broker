"use client";

// Real two-factor auth (TOTP) using Supabase's native MFA. Enroll → scan QR /
// enter secret in an authenticator app → verify a 6-digit code. A verified
// factor makes login require the code (enforced in the login page). No external
// service or secret required — this is Supabase Auth MFA.
import * as React from "react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Factor = { id: string; status: string; friendly_name?: string };

export function TwoFactorSetup() {
  const supabase = getSupabaseBrowserClient();
  const [loading, setLoading] = React.useState(true);
  const [verified, setVerified] = React.useState<Factor | null>(null);
  const [enroll, setEnroll] = React.useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error) {
      const totp = (data?.totp ?? []) as Factor[];
      setVerified(totp.find((f) => f.status === "verified") ?? null);
    }
    setLoading(false);
  }, [supabase]);
  React.useEffect(() => { void refresh(); }, [refresh]);

  const begin = async () => {
    setBusy(true);
    try {
      // Clear any stale unverified factor so enroll doesn't collide.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of (list?.totp ?? []) as Factor[]) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (error) throw error;
      setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start 2FA setup");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enroll || code.trim().length < 6) { toast.error("Enter the 6-digit code from your app."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.trim() });
      if (error) throw error;
      setEnroll(null); setCode("");
      await refresh();
      toast.success("Two-factor authentication enabled");
    } catch {
      toast.error("That code didn't match. Check your authenticator and try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!verified) return;
    if (!window.confirm("Turn off two-factor authentication for your account?")) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
      if (error) throw error;
      await refresh();
      toast.success("Two-factor authentication disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    height: 32, background: "var(--asb-white)", borderRadius: 6, padding: "4px 9px",
    fontSize: 12, color: "var(--asb-ink)", width: "100%", border: "1px solid var(--asb-gray-200, #DDE5F0)",
  };

  return (
    <div>
      <div className="settings-row">
        <span className="k">2-factor auth</span>
        <span className="v">
          {loading ? "…" : verified
            ? <span className="asb-badge in" style={{ fontSize: 8.5, letterSpacing: ".04em" }}>ENABLED</span>
            : <span style={{ color: "var(--asb-gray-500)" }}>Disabled</span>}
        </span>
      </div>

      {!loading && verified && !enroll && (
        <button className="asb-btn" onClick={disable} disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 6 }}>
          {busy ? "…" : "Disable 2FA"}
        </button>
      )}

      {!loading && !verified && !enroll && (
        <button className="asb-btn primary" onClick={begin} disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 6 }}>
          {busy ? "…" : "Enable 2FA"}
        </button>
      )}

      {enroll && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--asb-gray-700)", lineHeight: 1.5 }}>
            Scan this with Google Authenticator, 1Password or Authy — then enter the 6-digit code to confirm.
          </div>
          {/* Supabase returns the QR as an SVG data-URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="2FA QR code" width={150} height={150} style={{ alignSelf: "center", border: "1px solid var(--asb-gray-200)", borderRadius: 8, background: "#fff" }} />
          <div style={{ fontSize: 10.5, color: "var(--asb-gray-500)" }}>
            Can&apos;t scan? Enter this key manually: <span className="mono" style={{ color: "var(--asb-ink)", wordBreak: "break-all" }}>{enroll.secret}</span>
          </div>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" inputMode="numeric" style={inputStyle} />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="asb-btn primary" onClick={confirm} disabled={busy} style={{ flex: 1, justifyContent: "center" }}>{busy ? "Verifying…" : "Verify & enable"}</button>
            <button className="asb-btn" onClick={() => { setEnroll(null); setCode(""); }} disabled={busy} style={{ justifyContent: "center" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
