import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataSyncClient } from "@/components/admin/data-sync/DataSyncClient";
import { countCommodityQueuePending, countVesselQueuePending, type BatchMeta } from "./actions";
import { SHEET_SPECS } from "@/lib/sync/sheets";

export const dynamic = "force-dynamic";

export default async function DataSyncPage() {
  await requireAdmin({ section: "datasync" });
  const supabase = await getAdminSupabaseClient();

  const [{ data: batches }, commodityPending, vesselPending] = await Promise.all([
    supabase
      .from("sync_batch")
      .select("id, label, source, status, counts, file_name, created_at, committed_at")
      .order("created_at", { ascending: false })
      .limit(12),
    countCommodityQueuePending(),
    countVesselQueuePending(),
  ]);
  const queuePending = commodityPending + vesselPending;

  const sheets = SHEET_SPECS.map((s) => ({ id: s.id, label: s.label, table: s.targetTable }));

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Data Sync"
        subtitle="Upload the CargoMap workbook, review only what changed, then commit to the database."
        warn={
          <span>
            Commits write to live tables — but every commit is reversible with{" "}
            <strong>Undo batch</strong>.
          </span>
        }
      />
      <DataSyncClient
        sheets={sheets}
        initialBatches={(batches ?? []) as BatchMeta[]}
        initialQueuePending={queuePending}
      />
    </div>
  );
}
