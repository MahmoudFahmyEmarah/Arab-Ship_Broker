"use client";

// The admin console's amber live-edit banner (design: Portal standalone 7, `.asb-admin-banner` + `.asb-adminrole`).
// It replaces the old navy topbar: the warning on the left; on the right, who is signed in and with what reach
// ("Viewing as" · name · level · Full access / Scoped), the Data Quality run pill, and Sign out. The design's level
// switcher is a demo control; here the level is the signed-in admin's real tier, shown read-only.
import * as React from "react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { hardNavigate } from "@/lib/auth/hard-navigate";
import { logout } from "@/sdk/auth";
import type { AdminTier } from "@/lib/admin/sections";

export function AdminBanner({ name, tier, children }: { name: string; tier: AdminTier; children?: React.ReactNode }) {
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout(getSupabaseBrowserClient());
      hardNavigate("/auth/login");
    } catch {
      toast.error("Couldn't sign out — please try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="adm-banner" role="region" aria-label="Admin session">
      <span className="adm-banner__icon" aria-hidden="true">⚠</span>
      <span className="adm-banner__text">Admin panel, changes here affect the live platform immediately.</span>
      <div className="adm-role">
        {children}
        <span className="adm-role__viewing">Viewing as</span>
        <span className="adm-role__name">{name}</span>
        <span className="adm-role__level">{tier === "super" ? "Superior Admin" : "Sub-admin"}</span>
        <span className={`adm-role__tag ${tier === "super" ? "is-super" : "is-sub"}`}>{tier === "super" ? "Full access" : "Scoped"}</span>
        <button type="button" className="adm-role__signout" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
