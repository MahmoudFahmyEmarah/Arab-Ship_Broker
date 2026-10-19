// Admin console shell — a distinct privileged surface (per the 14_admin_rebuild
// design, restyled onto the ASB design system): full-height navy grouped rail + amber live-edit
// banner with the signed-in admin (design: Portal standalone 7) + read-only ribbon. It is
// visibly the same product as the broker portal but deliberately marked as the
// operator surface. Per-page requireAdmin() guards remain the real access
// enforcement; the sidebar/ribbon are the UX layer.
import "./admin.css";
import "./admin-dashboard.css";
import "./admin-dq.css";
import "./admin-data-sync.css";
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminBanner } from "@/components/admin/shell/AdminBanner";
import { AdminSidebarNav } from "@/components/admin/shell/AdminSidebarNav";
import { AdminReadonlyRibbon } from "@/components/admin/shell/AdminReadonlyRibbon";
import { DqRunPill } from "@/components/admin/data-quality/DqRunPill";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  // Rail badges: pending reviews, unread messages and the Manual Review
  // backlog (cheap admin-only reads; any failure just hides the badge).
  const counts: Record<string, number> = {};
  try {
    const supabase = await getAdminSupabaseClient();
    const [stats, crq, vrq, pendingPay, dqOpen] = await Promise.all([
      supabase.rpc("get_admin_stats"),
      supabase.from("commodity_review_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("vessel_review_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("dq_issues").select("id", { count: "exact", head: true }).eq("status", "open").eq("severity", "error"),
    ]);
    counts.billing = pendingPay.count ?? 0;
    counts.dq = dqOpen.count ?? 0;
    const s = stats.data as { queue_pending?: number; messages_unread?: number } | null;
    counts.review = s?.queue_pending ?? 0;
    counts.messages = s?.messages_unread ?? 0;
    counts.sync = (crq.count ?? 0) + (vrq.count ?? 0);
  } catch {
    // badges are decorative
  }

  return (
    <div className="adm-shell">
      <div className="adm-body">
        <AdminSidebarNav tier={admin.tier} perms={admin.perms} counts={counts} />
        <div className="adm-col">
          <AdminBanner name={admin.fullName} tier={admin.tier}>
            <DqRunPill />
          </AdminBanner>
          <main className="adm-main">
            <AdminReadonlyRibbon tier={admin.tier} perms={admin.perms} />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
