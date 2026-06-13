// Admin pages now live INSIDE the portal shell — an admin is a broker who also
// does admin work, so they get the same UI/UX (sidebar, chrome) with the Admin
// tool section added (PortalSidebar shows it for role === "admin"). No separate
// grey console. Per-page requireAdmin() guards still enforce access.
import { loadViewerContext } from "@/lib/portal/data";
import { DashboardShellClient } from "@/components/portal/DashboardShellClient";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tier, role, userName } = await loadViewerContext();
  return (
    <DashboardShellClient tier={tier} role={role} userName={userName}>
      <div className="p-8 max-[768px]:p-4 max-w-screen-2xl mx-auto w-full">
        {children}
      </div>
    </DashboardShellClient>
  );
}
