import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CurrentPrices, OverridePrice, PendingApprovals, ScheduledPrices } from "@/components/admin/bunker/PricesTab";
import { AddSponsor, SponsorAccess } from "@/components/admin/bunker/SuppliersTab";
import { HistoryTab } from "@/components/admin/bunker/HistoryTab";
import { SponsorGrid } from "@/components/admin/bunker/SponsorGrid";
import type { AdminBunkerDashboard } from "@/lib/bunker/admin";
import type { PortChoice } from "@/lib/ports/port-search";

export const dynamic = "force-dynamic";

// One page, as the design draws it (Portal standalone 7 · PageBunker): sponsor list → current prices → update
// history, with "+ Add sponsor" in the head. The approval queue, scheduled prices, the price form (each row's
// Edit), sponsor access (each card's "Manage access") and the add form follow on the same page.
export default async function AdminBunkerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; message?: string; error?: string }>;
}) {
  const admin = await requireAdmin({ section: "bunker" });
  const canEdit = canAccess("bunker", admin.tier, admin.perms) === "edit";
  const params = await searchParams;

  // admin_bunker_dashboard is service-role only and re-checks the actor.
  const { data, error } = await getSupabaseAdminClient().rpc("admin_bunker_dashboard", { p_actor: admin.rowId });
  const dash = data as AdminBunkerDashboard | null;
  // supplier ports are searched from the verified ports, never typed as LOCODEs (owner, 19 Oct 2026)
  const portChoices: PortChoice[] = canEdit
    ? ((await getSupabaseAdminClient().from("ports").select("locode,trade_name,country").eq("is_active", true).eq("is_verified", true).order("trade_name").limit(2000)).data ?? [])
        .map((p) => ({ locode: p.locode, name: p.trade_name, country: p.country }))
    : [];

  if (error || !dash) {
    return (
      <div className="adm-page">
        <AdminPageHeader title="Bunker ticker management" />
        <div className="adm-empty">
          The Fuel Bar is not available on this database yet{error ? ` (${error.message})` : ""}.
        </div>
      </div>
    );
  }

  const sponsors = dash.suppliers.filter((s) => !s.isPlatform);
  const pending = dash.quotes.filter((q) => q.status === "submitted");

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Bunker ticker management"
        subtitle="Sponsor list, manual price overrides and update history"
        warn={pending.length > 0 ? <span>{pending.length} quote{pending.length > 1 ? "s" : ""} from unverified suppliers awaiting approval.</span> : undefined}
      >
        {canEdit && <a className="adm-btn primary" href="#add-sponsor">+ Add sponsor</a>}
      </AdminPageHeader>
      {params.message && <div className="adm-card" role="status">{params.message}</div>}
      {params.error && <div className="adm-card" role="alert" style={{ borderLeft: "2px solid var(--adm-red)" }}>{params.error}</div>}

      <PendingApprovals dash={dash} canEdit={canEdit} />

      <div>
        <div className="adm-card__head" style={{ marginBottom: 8 }}>
          <span className="adm-card__title">Sponsor list</span>
          <span className="adm-card__sub">{sponsors.length} registered</span>
        </div>
        <SponsorGrid sponsors={sponsors} alerts={dash.alerts} canEdit={canEdit} />
      </div>

      <CurrentPrices dash={dash} canEdit={canEdit} />
      <ScheduledPrices dash={dash} canEdit={canEdit} />
      <HistoryTab dash={dash} />
      {canEdit && <OverridePrice dash={dash} />}
      <SponsorAccess dash={dash} canEdit={canEdit} portChoices={portChoices} />
      {canEdit && <AddSponsor portChoices={portChoices} />}
    </div>
  );
}
