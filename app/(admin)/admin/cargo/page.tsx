import Link from "next/link";
import { Package, Search, ArrowRight, Calendar, Weight, MapPin, Tag } from "lucide-react";
import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ReviewStatusBadge } from "@/components/admin/AdminBadge";
import { cn } from "@/lib/utils";

type StatusFilter = "IN" | "PARTIAL" | "OUT" | "CLOSED" | "ALL";
type ReviewFilter = "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED" | "ALL";

const STATUS_TABS = ["ALL", "IN", "PARTIAL", "OUT", "CLOSED"] as const;
const REVIEW_TABS = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
] as const;

const STATUS_COLORS: Record<string, string> = {
  IN: "text-green-700 bg-green-50 border-green-200",
  PARTIAL: "text-amber-700 bg-amber-50 border-amber-200",
  OUT: "text-slate-500 bg-slate-50 border-slate-200",
  CLOSED: "text-slate-400 bg-slate-50 border-slate-100",
};

const STATUS_LABELS: Record<string, string> = {
  IN: "Active",
  PARTIAL: "Partial",
  OUT: "Out of scope",
  CLOSED: "Closed",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function laycanLabel(fromIso: string | null, toIso: string | null) {
  if (!fromIso && !toIso) return "—";
  if (fromIso && toIso) return `${fmt(fromIso)} - ${fmt(toIso)}`;
  return fmt(fromIso ?? toIso);
}

export default async function AdminCargoPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    review?: string;
    q?: string;
    zone?: string;
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter = (params.status ?? "IN") as StatusFilter;
  const reviewFilter = (params.review ?? "ALL") as ReviewFilter;
  const query = params.q ?? "";
  const zoneFilter = params.zone ?? "";

  let q = supabase
    .from("cargo_listings")
    .select(
      "id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo, qty_min_mt, qty_max_mt, load_port_name, load_zone, disch_port_name, disch_zone, laycan_from, laycan_to, is_spot, freight_idea_usd_mt, broker, goes_live_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (statusFilter !== "ALL") q = q.eq("status", statusFilter);
  if (reviewFilter !== "ALL") q = q.eq("review_status", reviewFilter);
  if (zoneFilter)
    q = q.or(`load_zone.eq.${zoneFilter},disch_zone.eq.${zoneFilter}`);
  if (query.trim())
    q = q.or(
      `commodity_name.ilike.%${query.trim()}%,ref.ilike.%${query.trim()}%`,
    );

  const { data } = await q.limit(500);
  const listings = (data ?? []) as Record<string, unknown>[];

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      status: statusFilter,
      review: reviewFilter,
      ...(query && { q: query }),
      ...(zoneFilter && { zone: zoneFilter }),
      ...overrides,
    });
    return `/admin/cargo?${p}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Cargo Listings"
        subtitle={`${listings.length} listings shown`}
      />

      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab}
            href={buildHref({ status: tab })}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              statusFilter === tab
                ? "bg-ocean-600 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
            )}
          >
            {tab}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 font-medium">Review:</span>
        {REVIEW_TABS.map((tab) => (
          <Link
            key={tab}
            href={buildHref({ review: tab })}
            className={cn(
              "text-xs px-2.5 py-1 rounded-lg font-medium border transition-all",
              reviewFilter === tab
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
            )}
          >
            {tab}
          </Link>
        ))}
      </div>

      <form method="GET" action="/admin/cargo" className="relative max-w-xs">
        <input type="hidden" name="status" value={statusFilter} />
        <input type="hidden" name="review" value={reviewFilter} />
        {zoneFilter && <input type="hidden" name="zone" value={zoneFilter} />}
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          name="q"
          defaultValue={query}
          placeholder="Search commodity or ref…"
          className="w-full pl-9 pr-4 h-9 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-ocean-500"
        />
      </form>

      {listings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
          <Package className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">No listings found</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {listings.map((cl) => (
            <Link
              key={cl.id as string}
              href={`/admin/cargo/${cl.id}`}
              className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-ocean-300 hover:shadow-md transition-all flex flex-col gap-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Package className="w-4 h-4 text-ocean-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <p className="text-sm font-bold text-slate-900 group-hover:text-ocean-700 transition-colors truncate">
                        {cl.commodity_name as string}
                      </p>
                      {(cl.is_dg_cargo as boolean) && (
                        <span className="shrink-0 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                          DG
                        </span>
                      )}
                      {(cl.is_grain_cargo as boolean) && (
                        <span className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          Grain
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      {cl.cargo_type as string}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg border uppercase tracking-wide",
                    STATUS_COLORS[cl.status as string] ?? "bg-slate-100 text-slate-500 border-slate-200",
                  )}
                >
                  {STATUS_LABELS[cl.status as string] ?? (cl.status as string)}
                </span>
              </div>

              {/* Route */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-700 truncate">
                  {(cl.load_zone as string) ?? "—"}
                </span>
                <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-700 truncate">
                  {(cl.disch_zone as string) ?? "—"}
                </span>
              </div>

              {/* Pills */}
              <div className="grid grid-cols-2 gap-2">
                <DataPill
                  icon={Weight}
                  label="Qty (max)"
                  value={
                    cl.qty_max_mt
                      ? `${Number(cl.qty_max_mt).toLocaleString()} MT`
                      : "—"
                  }
                />
                <DataPill
                  icon={Calendar}
                  label="Laycan"
                  value={
                    cl.is_spot
                      ? "SPOT"
                      : laycanLabel(
                          cl.laycan_from as string | null,
                          cl.laycan_to as string | null,
                        )
                  }
                />
                {!!(cl.ref) && (
                  <DataPill icon={Tag} label="Ref" value={cl.ref as string} />
                )}
                {cl.freight_idea_usd_mt != null && (
                  <DataPill
                    icon={Tag}
                    label="Freight"
                    value={`$${cl.freight_idea_usd_mt as number}/MT`}
                  />
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto">
                <ReviewStatusBadge status={cl.review_status as string} />
                <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-ocean-500 group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          ))}
        </div>
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
    <div className="bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <Icon className="w-3 h-3 text-slate-400 shrink-0" />
        <p className="text-xs font-bold text-slate-700 truncate">{value}</p>
      </div>
    </div>
  );
}
