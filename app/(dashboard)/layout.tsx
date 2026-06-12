// Dashboard shell — Claude design. Server component: resolves the REAL viewer
// context (subscription tier + role) via loadViewerContext(), then hands it to
// the client shell. No demo switches — a normal broker sees no tier/admin/role
// toggle; tier gating + sidebar persona are derived from the signed-in account.
import { loadViewerContext } from "@/lib/portal/data";
import { DashboardShellClient } from "@/components/portal/DashboardShellClient";

// Every dashboard route is per-user and reads auth cookies (viewer context,
// live data). Mark the whole group dynamic so Next never attempts static
// generation (which throws "Dynamic server usage: … used cookies").
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { tier, role, userName } = await loadViewerContext();
  return (
    <DashboardShellClient tier={tier} role={role} userName={userName}>
      {children}
    </DashboardShellClient>
  );
}
