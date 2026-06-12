import Link from "next/link";
import {
  Package,
  Ship,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Filter,
  User,
  Calendar,
  Weight,
  MapPin,
} from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  ReviewStatusBadge,
  TrustTierBadge,
} from "@/components/admin/AdminBadge";
import type { QueueItem } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_TABS: {
  label: string;
  value: StatusFilter;
  icon: React.ElementType;
}[] = [
  { label: "Pending", value: "PENDING", icon: Clock },
  { label: "Approved", value: "APPROVED", icon: CheckCircle2 },
  { label: "Rejected", value: "REJECTED", icon: XCircle },
  { label: "Flagged", value: "FLAGGED", icon: AlertTriangle },
  { label: "All", value: "ALL", icon: Filter },
];

export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter = (params.status as StatusFilter) ?? "PENDING";
  const typeFilter = (params.type as TypeFilter) ?? "all";

  let query = supabase
    .from("v_admin_queue_detail")
    .select("*")
    .order("created_at", { ascending: true });

  if (statusFilter !== "ALL") {
    query = query.eq("status", statusFilter);
  }
  if (typeFilter !== "all") {
    query = query.eq("listing_type", typeFilter);
  }

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
    <div className="space-y-6">
      <AdminPageHeader
        title="Review Queue"
        subtitle={`${countMap["PENDING"] ?? 0} items pending review`}
      />

      <div className="flex items-center gap-1 dp-card p-1 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value;
          const Icon = tab.icon;
          const count = tab.value !== "ALL" ? countMap[tab.value] : undefined;
          return (
            <Link
              key={tab.value}
              href={`/admin/queue?status=${tab.value}&type=${typeFilter}`}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                active
                  ? "bg-asb-blue text-white shadow-sm"
                  : "text-asb-gray-500 hover:bg-asb-gray-50 hover:text-asb-ink",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                    active
                      ? "bg-white/20 text-white"
                      : tab.value === "PENDING"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-asb-gray-100 text-asb-gray-700",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-asb-gray-400 font-medium">Type:</span>
        {[
          { label: "All", value: "all" },
          { label: "Cargo", value: "cargo" },
          { label: "Vessel", value: "vessel_availability" },
        ].map((t) => (
          <Link
            key={t.value}
            href={`/admin/queue?status=${statusFilter}&type=${t.value}`}
            className={cn(
              "text-xs px-2.5 py-1 rounded-lg font-medium border transition-all",
              typeFilter === t.value
                ? "bg-asb-navy-deep text-white border-asb-navy-deep"
                : "bg-white text-asb-gray-500 border-asb-gray-200 hover:border-asb-gray-200",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="dp-card py-20 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
          <p className="text-asb-gray-700 font-semibold">
            {statusFilter === "PENDING"
              ? "Queue is clear — nothing pending"
              : `No ${statusFilter.toLowerCase()} items`}
          </p>
          <p className="text-asb-gray-400 text-sm mt-1">
            {statusFilter === "PENDING"
              ? "All submissions have been reviewed."
              : "Adjust the filter to see other items."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {items.map((item) => {
            const isCargo = item.listing_type === "cargo";
            const age = formatAge(item.created_at);

            return (
              <Link
                key={item.id}
                href={`/admin/queue/${item.id}`}
                className="group dp-card p-5 hover:border-asb-blue hover:shadow-md transition-all flex flex-col gap-4"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "w-9 h-9 rounded flex items-center justify-center shrink-0 mt-0.5",
                        isCargo ? "bg-asb-blue-light border border-asb-gray-200" : "bg-foam-50 border border-foam-100",
                      )}
                    >
                      {isCargo ? (
                        <Package className="w-4 h-4 text-asb-blue" />
                      ) : (
                        <Ship className="w-4 h-4 text-foam-600" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-asb-navy group-hover:text-asb-blue transition-colors truncate">
                        {isCargo
                          ? (item.commodity_name ?? "Cargo")
                          : (item.vessel_name ?? "Vessel")}
                      </p>
                      <p className="text-xs text-asb-gray-400 truncate mt-0.5">
                        {isCargo
                          ? (item.cargo_type ?? "Cargo listing")
                          : (item.vessel_type ?? "Vessel availability")}
                      </p>
                    </div>
                  </div>
                  <ReviewStatusBadge status={item.status} />
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-2">
                  {isCargo ? (
                    <>
                      <DataPill
                        icon={Weight}
                        label="Quantity"
                        value={
                          item.qty_max_mt
                            ? `${item.qty_max_mt.toLocaleString()} MT`
                            : "—"
                        }
                      />
                      <DataPill
                        icon={MapPin}
                        label="Route"
                        value={
                          item.load_zone && item.disch_zone
                            ? `${item.load_zone} → ${item.disch_zone}`
                            : "—"
                        }
                      />
                    </>
                  ) : (
                    <>
                      <DataPill
                        icon={Weight}
                        label="DWT"
                        value={
                          item.dwt_grain
                            ? `${item.dwt_grain.toLocaleString()} MT`
                            : "—"
                        }
                      />
                      <DataPill
                        icon={MapPin}
                        label="Open at"
                        value={item.open_port_name ?? "—"}
                      />
                    </>
                  )}
                  <DataPill
                    icon={Calendar}
                    label={isCargo ? "Laycan" : "Open date"}
                    value={
                      isCargo
                        ? item.is_spot
                          ? "SPOT"
                          : (item.laycan_from ?? "—")
                        : (item.open_date ?? "—")
                    }
                  />
                  <DataPill
                    icon={User}
                    label="Submitter"
                    value={item.submitter_name ?? "—"}
                  />
                </div>

                {/* Reason */}
                {item.review_reason && (
                  <p className="text-xs text-asb-gray-500 bg-asb-gray-50 rounded px-3 py-2 border border-asb-gray-100 line-clamp-2">
                    {item.review_reason}
                  </p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-asb-gray-100 mt-auto">
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.submitter_trust_tier && (
                      <TrustTierBadge tier={item.submitter_trust_tier} />
                    )}
                    <div className="flex items-center gap-1">
                      {age.urgent && item.status === "PENDING" && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                        </span>
                      )}
                      <span
                        title={formatDate(item.created_at)}
                        className={cn(
                          "text-[11px]",
                          age.urgent && item.status === "PENDING"
                            ? "text-red-600 font-semibold"
                            : "text-asb-gray-400",
                        )}
                      >
                        {age.label}
                      </span>
                    </div>
                    {item.is_random_sample && (
                      <span className="text-[10px] font-bold text-asb-gray-400 bg-asb-gray-100 px-1.5 py-0.5 rounded">
                        Sample
                      </span>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-asb-gray-400 group-hover:text-asb-blue group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <p className="text-xs text-asb-gray-400 text-right">
          Showing {items.length} item{items.length !== 1 ? "s" : ""}
          {statusFilter !== "ALL" ? ` · ${statusFilter}` : ""}
        </p>
      )}
    </div>
  );
}

function DataPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-asb-gray-50 rounded-lg px-2.5 py-2 border border-asb-gray-100">
      <p className="text-[10px] text-asb-gray-400 font-semibold uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <Icon className="w-3 h-3 text-asb-gray-400 shrink-0" />
        <p className="text-xs font-bold text-asb-ink-soft truncate">{value}</p>
      </div>
    </div>
  );
}
