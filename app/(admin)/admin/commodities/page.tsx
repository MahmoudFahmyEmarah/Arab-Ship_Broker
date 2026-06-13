import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CommodityRow } from "@/components/admin/commodities/CommodityRow";
import { CreateCommodityForm } from "@/components/admin/commodities/CreateCommodityForm";
import type { AdminCommodityRow } from "@/lib/admin/types";

export default async function AdminCommoditiesPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  await requireAdmin({ section: "commodities" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();
  const showInactive = params.inactive === "1";

  const { data } = await supabase
    .from("commodities")
    .select("*")
    .order("sort_order", { ascending: true });

  const all = (data ?? []) as AdminCommodityRow[];
  const commodities = showInactive ? all : all.filter((c) => c.is_active);

  const dryBulk = commodities.filter((c) => c.cargo_type === "Dry Bulk");
  const breakBulk = commodities.filter((c) => c.cargo_type === "Break Bulk");
  const inactive = all.filter((c) => !c.is_active);

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Commodities"
        subtitle={`${all.length} total · ${inactive.length} inactive`}
      >
        {!showInactive && inactive.length > 0 && (
          <Link href="?inactive=1" className="adm-filter-chip">Show inactive</Link>
        )}
      </AdminPageHeader>

      <div className="adm-card" style={{ borderLeft: "2px solid var(--adm-amber-bd)" }}>
        <p style={{ margin: 0, fontSize: 11, color: "var(--adm-muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--adm-ink)" }}>Note:</strong> Deactivating a commodity hides it
          from the cargo form dropdown. Existing listings that reference it are preserved. Changing the
          canonical name breaks matchmaking on existing listings, so create a new record instead.
        </p>
      </div>

      <CommoditySection title="Dry Bulk" commodities={dryBulk} />
      <CommoditySection title="Break Bulk" commodities={breakBulk} />

      {showInactive && inactive.length > 0 && (
        <CommoditySection title="Inactive" commodities={inactive} />
      )}

      <div>
        <div className="adm-card__head">
          <span className="adm-card__title">Add new commodity</span>
        </div>
        <CreateCommodityForm />
      </div>
    </div>
  );
}

function CommoditySection({
  title,
  commodities,
}: {
  title: string;
  commodities: AdminCommodityRow[];
}) {
  return (
    <div>
      <div className="adm-card__head">
        <span className="adm-card__title">
          {title} <span style={{ color: "var(--adm-muted)", fontWeight: 400 }}>({commodities.length})</span>
        </span>
      </div>
      {commodities.length === 0 ? (
        <div className="adm-empty">None</div>
      ) : (
        <div className="adm-card-grid">
          {commodities.map((c) => (
            <CommodityRow key={c.id} commodity={c} />
          ))}
        </div>
      )}
    </div>
  );
}
