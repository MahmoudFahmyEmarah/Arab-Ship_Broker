// Dashboard shell — Claude design. Server component: resolves the REAL viewer
// context (subscription tier + role) via loadViewerContext(), then hands it to
// the client shell. No demo switches — a normal broker sees no tier/admin/role
// toggle; tier gating + sidebar persona are derived from the signed-in account.
import { loadViewerContext } from "@/lib/portal/data";
import { DashboardShellClient } from "@/components/portal/DashboardShellClient";
import { getBetaMode, getComingSoonDesign, getSidebarStyle } from "@/lib/app-settings";
import { BetaGate } from "@/components/portal/BetaGate";
import { PortalEventTracker } from "@/components/portal/PortalEventTracker";

// Every dashboard route is per-user and reads auth cookies (viewer context,
// live data). Mark the whole group dynamic so Next never attempts static
// generation (which throws "Dynamic server usage: … used cookies").
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ tier, role, userName }, betaMode, comingSoonDesign, sidebarStyle] = await Promise.all([
    loadViewerContext(),
    getBetaMode(),
    getComingSoonDesign(),
    getSidebarStyle(),
  ]);
  // Beta mode (set in admin → Platform settings) restricts non-admin members to
  // the Dashboard; BetaGate covers every other page with a "coming soon" lock,
  // using the admin-selected design(s) (radar / beacon / compass, rotating).
  return (
    <DashboardShellClient tier={tier} role={role} userName={userName} sidebarStyle={sidebarStyle}>
      <PortalEventTracker />
      <BetaGate betaMode={betaMode} isAdmin={role === "admin"} comingSoonDesign={comingSoonDesign}>
        {children}
      </BetaGate>
    </DashboardShellClient>
  );
}
