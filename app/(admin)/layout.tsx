// Admin console shell — a distinct privileged surface (per the 14_admin_rebuild
// design): dark navy topbar + amber live-edit banner + grouped light sidebar +
// read-only ribbon. It is visibly the same product as the broker portal but
// deliberately marked as the operator surface. Per-page requireAdmin() guards
// remain the real access enforcement; the sidebar/ribbon are the UX layer.
import "./admin.css";
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminTopbar } from "@/components/admin/shell/AdminTopbar";
import { AdminSidebarNav } from "@/components/admin/shell/AdminSidebarNav";
import { AdminReadonlyRibbon } from "@/components/admin/shell/AdminReadonlyRibbon";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  // Pending-review count for the sidebar badge (cheap, admin-only RPC).
  let reviewCount = 0;
  try {
    const supabase = await getAdminSupabaseClient();
    const { data } = await supabase.rpc("get_admin_stats");
    reviewCount = (data as { queue_pending?: number } | null)?.queue_pending ?? 0;
  } catch {
    reviewCount = 0;
  }

  return (
    <div className="adm-shell">
      <AdminTopbar name={admin.fullName} tier={admin.tier} />
      <div className="adm-banner">
        <span aria-hidden>⚠</span>
        Admin panel: changes here affect the live platform immediately.
      </div>
      <div className="adm-body">
        <AdminSidebarNav tier={admin.tier} perms={admin.perms} counts={{ review: reviewCount }} />
        <main className="adm-main">
          <AdminReadonlyRibbon tier={admin.tier} perms={admin.perms} />
          {children}
        </main>
      </div>
    </div>
  );
}
