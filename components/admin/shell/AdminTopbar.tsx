"use client";

// Dark navy admin topbar — the deliberate signal that the operator is in a
// privileged surface. Logo + amber "Admin" pill · real logged-in identity with
// Super/Sub badge · "Back to platform" (the broker portal) · Sign out.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { logout } from "@/sdk/auth";
import type { AdminTier } from "@/lib/admin/sections";

export function AdminTopbar({ name, tier }: { name: string; tier: AdminTier }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout(getSupabaseBrowserClient());
      router.push("/auth/login");
      router.refresh();
    } catch {
      toast.error("Couldn't sign out — please try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="adm-topbar">
      <Link href="/admin/dashboard" className="adm-topbar__logo">
        Arab ShipBroker
        <span className="adm-topbar__pill">Admin</span>
      </Link>
      <div className="adm-topbar__spacer" />

      <span className="adm-identity">
        <span className="adm-identity__name">{name}</span>
        <span className={`adm-identity__role is-${tier}`}>{tier === "super" ? "Super" : "Sub"}</span>
      </span>

      <Link href="/dashboard" className="adm-topbar__signout">← Back to platform</Link>
      <button type="button" className="adm-topbar__signout" onClick={handleSignOut} disabled={signingOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
