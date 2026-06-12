"use client";

// Dashboard shell (client). Receives the REAL viewer context (tier / role /
// userName) resolved on the server by `loadViewerContext()`, and renders the
// design chrome: PortalSidebar + TierProvider + MarketPartnerHost. Keeps
// DashboardProvider so client consumers (ProfileGuard + account UI) still work.
//
// The server role is authoritative; if it's null (preview / unconfigured) we
// fall back to deriving the persona from the account's profiles. A normal
// broker still sees no tier/admin/role switch — tier is account-controlled.
import "@/lib/portal/portal.css";
import { DashboardProvider, useDashboard } from "@/contexts/DashboardContext";
import { PortalSidebar, PortalRole } from "@/components/portal/PortalSidebar";
import { PortalMobileNav } from "@/components/portal/PortalMobileNav";
import { PositionCheckin } from "@/components/portal/PositionCheckin";
import { TierProvider, type Tier } from "@/lib/portal/tier";
import { MarketPartnerHost } from "@/components/portal/MarketPartnerPanel";
import type { AppRole } from "@/lib/role";

function profileRole(hasCargo: boolean, hasVessel: boolean): PortalRole {
  return hasCargo && hasVessel ? "broker" : hasVessel ? "vessel_owner" : hasCargo ? "cargo_owner" : "broker";
}

function DashboardShell({
  serverRole,
  userName,
  children,
}: {
  serverRole: AppRole | null;
  userName: string | null;
  children: React.ReactNode;
}) {
  const { account, hasCargoProfile, hasVesselProfile } = useDashboard();
  // Prefer the real server role; fall back to the profile-derived persona.
  // (`admin` never lands here — middleware routes admins to /admin.)
  const role: PortalRole = (serverRole as PortalRole) ?? profileRole(hasCargoProfile, hasVesselProfile);
  const displayName = userName ?? account?.fullName ?? "Account";

  return (
    <div className="asb-portal">
      <div className="shell">
        <PortalSidebar role={role} userName={displayName} basePath="/dashboard" />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            background: "var(--asb-gray-50)",
          }}
        >
          {children}
        </main>
      </div>
      <PortalMobileNav role={role} basePath="/dashboard" />
      {/* Position check-in: vessel persona only, never admin (admins are
          routed to /admin before this shell). Renders nothing for users with
          no open positions, so mounting per-shell is safe. */}
      {(role === "vessel_owner" || role === "broker") && <PositionCheckin />}
      <MarketPartnerHost />
    </div>
  );
}

export function DashboardShellClient({
  tier,
  role,
  userName,
  children,
}: {
  tier: Tier;
  role: AppRole | null;
  userName: string | null;
  children: React.ReactNode;
}) {
  return (
    <TierProvider tier={tier}>
      <DashboardProvider>
        <DashboardShell serverRole={role} userName={userName}>
          {children}
        </DashboardShell>
      </DashboardProvider>
    </TierProvider>
  );
}
