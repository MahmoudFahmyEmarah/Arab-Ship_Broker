import Link from "next/link";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ReviewStatusBadge, TrustTierBadge } from "@/components/admin/AdminBadge";
import type { QueueItem } from "@/lib/admin/types";

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED" | "ALL";
type TypeFilter = "cargo" | "vessel_availability" | "all";

function formatAge(iso: string): { label: string; urgent: boolean } {
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  const urgent = minutes > 120;
  if (minutes < 60) return { label: `${Math.round(minutes)}m ago`, urgent };
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return { label: m > 0 ? `${h}h ${m}m ago` : `${h}h ago`, urgent };
}

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Flagged", value: "FLAGGED" },
  { label: "All", value: "ALL" },
];

const TYPE_TABS: { label: string; value: TypeFilter }[] = [
  { label: "All", value: "all" },
  { label: "Cargo", value: "cargo" },
  { label: "Vessel", value: "vessel_availability" },
];

export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  await requireAdmin({ section: "review" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter = (params.status as StatusFilter) ?? "PENDING";
  const typeFilter = (params.type as TypeFilter) ?? "all";

  let query = supabase
    .from("v_admin_queue_detail")
    .select("*")
    .order("created_at", { ascending: true });

  if (statusFilter !== "ALL") query = query.eq("status", statusFilter);
  if (typeFilter !== "all") query = query.eq("listing_type", typeFilter);

  const { data } = await query.limit(200);
  const items = (data ?? []) as QueueItem[];

  const { data: counts } = await supabase
    .from("review_queue")
    .select("status")
    .in("status", ["PENDING", "APPROVED", "REJECTED", "FLAGGED"]);

  const countMap: Record<string, number> = {};
  (counts ?? []).forEach((r: { status: string }) => {
    countMap[r.status] = (countMap[r.status] ?? 0) + 1;
  });

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Listing review queue"
        subtitle="Approve, request changes, or reject pending submissions"
      />

      <div className="adm-tabs">
        {STATUS_TABS.map((tab) => {
          const count = tab.value !== "ALL" ? countMap[tab.value] : undefined;
          return (
            <Link
              key={tab.value}
              href={`/admin/queue?status=${tab.value}&type=${typeFilter}`}
              className={`adm-tab${statusFilter === tab.value ? " is-on" : ""}`}
            >
              {tab.label}
              {count !== undefined && count > 0 && <span className="adm-tab__count">{count}</span>}
            </Link>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "var(--adm-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
          Type
        </span>
        {TYPE_TABS.map((t) => (
          <Link
            key={t.value}
            href={`/admin/queue?status=${statusFilter}&type=${t.value}`}
            className={`adm-filter-chip${typeFilter === t.value ? " is-on" : ""}`}
          >
            {t.label}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "var(--adm-muted)" }}>
          {items.length} shown · oldest first
        </span>
      </div>

      {items.length === 0 ? (
        <div className="adm-empty">
          {statusFilter === "PENDING"
            ? "Queue is clear. All submissions have been reviewed."
            : `No ${statusFilter.toLowerCase()} items. Adjust the filter to see others.`}
        </div>
      ) : (
        <div className="adm-card" style={{ padding: "4px 16px" }}>
          {items.map((item) => {
            const isCargo = item.listing_type === "cargo";
            const age = formatAge(item.created_at);
            return (
              <div key={item.id} className="adm-list__row">
                <span className={`adm-list__icon ${isCargo ? "is-cargo" : "is-vessel"}`}>
                  {isCargo ? "C" : "V"}
                </span>
                <div className="adm-list__body">
                  <div className="adm-list__title">
                    {isCargo ? (item.commodity_name ?? "Cargo") : (item.vessel_name ?? "Vessel")}
                    {isCargo && item.qty_max_mt ? (
                      <span style={{ color: "var(--adm-muted)", fontWeight: 400 }}> · {item.qty_max_mt.toLocaleString()} MT</span>
                    ) : null}
                    {!isCargo && item.dwt_grain ? (
                      <span style={{ color: "var(--adm-muted)", fontWeight: 400 }}> · {item.dwt_grain.toLocaleString()} DWT</span>
                    ) : null}
                  </div>
                  <div className="adm-list__meta">
                    {isCargo
                      ? item.load_zone && item.disch_zone
                        ? `${item.load_zone} → ${item.disch_zone}`
                        : (item.cargo_type ?? "Cargo listing")
                      : `${item.vessel_type ?? "Vessel"} · open ${item.open_port_name ?? "—"}`}
                  </div>
                  <div className="adm-list__meta" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    <span>{item.submitter_name ?? item.submitter_email ?? "Unknown"}</span>
                    {item.submitter_trust_tier && <TrustTierBadge tier={item.submitter_trust_tier} />}
                    <span style={{ color: age.urgent && item.status === "PENDING" ? "#C84A4A" : undefined, fontWeight: age.urgent ? 600 : 400 }}>
                      · {age.label}
                    </span>
                    {item.is_random_sample && <span className="adm-badge draft">Sample</span>}
                  </div>
                </div>
                <div className="adm-list__actions" style={{ alignItems: "center" }}>
                  <ReviewStatusBadge status={item.status} />
                  <Link href={`/admin/queue/${item.id}`} className="adm-btn small primary">
                    {item.status === "PENDING" ? "Review →" : "Open →"}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
