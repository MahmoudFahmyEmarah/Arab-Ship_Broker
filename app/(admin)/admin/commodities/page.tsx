import { AlertTriangle } from "lucide-react";

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
  await requireAdmin();
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
    <div className="space-y-8">
      <AdminPageHeader
        title="Commodities"
        subtitle={`${all.length} total · ${inactive.length} inactive`}
      />

      {/* Warning about question_key analogue */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 leading-relaxed">
          <strong>Note:</strong> Deactivating a commodity hides it from the
          cargo form dropdown — existing listings that reference it are
          preserved. Changing <code>canonical_name</code> will break matchmaking
          on existing listings. Create a new record instead.
        </p>
      </div>

      {/* Dry Bulk section */}
      <CommoditySection title="Dry Bulk" commodities={dryBulk} />

      {/* Break Bulk section */}
      <CommoditySection title="Break Bulk" commodities={breakBulk} />

      {/* Inactive section */}
      {(showInactive || inactive.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-asb-gray-400 uppercase tracking-wider">
              Inactive ({inactive.length})
            </h2>
            {!showInactive && inactive.length > 0 && (
              <a
                href="?inactive=1"
                className="text-xs text-asb-blue hover:text-asb-blue font-semibold"
              >
                Show inactive
              </a>
            )}
          </div>
          {showInactive && inactive.length > 0 && (
            <CommodityTable commodities={inactive} />
          )}
        </div>
      )}

      {/* Create new */}
      <div>
        <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider mb-3">
          Add new commodity
        </h2>
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
      <h2 className="text-sm font-bold text-asb-gray-500 uppercase tracking-wider mb-3">
        {title}{" "}
        <span className="text-asb-gray-400 font-normal normal-case ml-1">
          ({commodities.length})
        </span>
      </h2>
      {commodities.length === 0 ? (
        <p className="text-sm text-asb-gray-400 py-4">None</p>
      ) : (
        <CommodityTable commodities={commodities} />
      )}
    </div>
  );
}

function CommodityTable({ commodities }: { commodities: AdminCommodityRow[] }) {
  return (
    <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
      {commodities.map((c) => (
        <CommodityRow key={c.id} commodity={c} />
      ))}
    </div>
  );
}
