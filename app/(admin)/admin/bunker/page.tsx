import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Stat, StatGrid } from "@/components/admin/ui/Stat";
import { PricesTab } from "@/components/admin/bunker/PricesTab";
import { SuppliersTab } from "@/components/admin/bunker/SuppliersTab";
import { HistoryTab } from "@/components/admin/bunker/HistoryTab";
import type { AdminBunkerDashboard } from "@/lib/bunker/admin";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "prices", label: "Current prices" },
  { id: "suppliers", label: "Suppliers & access" },
  { id: "history", label: "Update history" },
] as const;

export default async function AdminBunkerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; message?: string; error?: string }>;
}) {
  const admin = await requireAdmin({ section: "bunker" });
  const canEdit = canAccess("bunker", admin.tier, admin.perms) === "edit";
  const params = await searchParams;
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab! : "prices";

  // admin_bunker_dashboard is service-role only and re-checks the actor.
  const { data, error } = await getSupabaseAdminClient().rpc("admin_bunker_dashboard", { p_actor: admin.rowId });
  const dash = data as AdminBunkerDashboard | null;

  if (error || !dash) {
    return (
      <div className="adm-page">
        <AdminPageHeader title="Bunker ticker" />
        <div className="adm-empty">
          The Fuel Bar is not available on this database yet{error ? ` (${error.message})` : ""}.
        </div>
      </div>
    );
  }

  // Headline counts only prices live now (C2B-011): a scheduled replacement is not live.
  const live = dash.quotes.filter((q) => q.status === "approved" && (q.liveNow ?? q.validNow));
  const pending = dash.quotes.filter((q) => q.status === "submitted");
  const sponsors = dash.suppliers.filter((s) => !s.isPlatform);
  const supplierAlerts = dash.alerts.filter((a) => a.kind !== "pending_approval");
  const counts: Record<string, number> = { prices: live.length + pending.length, suppliers: sponsors.length, history: dash.events.length };

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Bunker ticker"
        subtitle="Supplier price tables, the sponsor strip and the platform fuel index that feeds the Voyage estimator."
        warn={pending.length > 0 ? <span>{pending.length} quote{pending.length > 1 ? "s" : ""} from unverified suppliers awaiting approval.</span> : undefined}
      />
      {params.message && <div className="adm-card" role="status">{params.message}</div>}
      {params.error && <div className="adm-card" role="alert" style={{ borderLeft: "2px solid var(--adm-red)" }}>{params.error}</div>}

      <StatGrid>
        <Stat label="Live quotes" value={live.length} sub={`${live.filter((q) => q.freshness === "current" && q.validNow).length} current`} accent="green" />
        <Stat label="Awaiting approval" value={pending.length} accent={pending.length ? "amber" : "default"} />
        <Stat label="Sponsors" value={sponsors.filter((s) => s.status === "enabled").length} sub={`${sponsors.length} registered`} />
        <Stat label="Freshness alerts" value={supplierAlerts.length} accent={supplierAlerts.length ? "red" : "default"} />
      </StatGrid>

      <nav className="adm-tabs" aria-label="Bunker sections">
        {TABS.map((t) => (
          <Link key={t.id} href={`?tab=${t.id}`} className={`adm-tab${tab === t.id ? " is-on" : ""}`}
                aria-current={tab === t.id ? "page" : undefined}>
            {t.label} <span className="adm-tab__count">{counts[t.id]}</span>
          </Link>
        ))}
      </nav>

      {tab === "prices" && <PricesTab dash={dash} canEdit={canEdit} />}
      {tab === "suppliers" && <SuppliersTab dash={dash} canEdit={canEdit} />}
      {tab === "history" && <HistoryTab dash={dash} />}
    </div>
  );
}
