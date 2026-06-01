import Link from "next/link";
import { Ship, Search, ArrowRight, MapPin, Calendar, Weight, Tag } from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  ReviewStatusBadge,
  VesselStatusBadge,
} from "@/components/admin/AdminBadge";
import { cn } from "@/lib/utils";

const STATUS_TABS = ["ALL", "OPEN", "ON SUBS", "FIXED", "INACTIVE"] as const;
const REVIEW_TABS = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
] as const;

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminVesselAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; review?: string; q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const statusFilter = params.status ?? "ALL";
  const reviewFilter = params.review ?? "ALL";
  const query = params.q ?? "";

  let q = supabase
    .from("vessel_availability")
    .select(
      `
      id, ref, status, review_status, open_port_name, open_port_locode, open_zone, open_date,
      accepts_part_cargo, freight_idea_usd_mt, goes_live_at, created_at,
      vessel:vessels(vessel_name, imo_number, vessel_type, dwt_grain, risk_level, is_sanctioned)
    `,
    )
    .order("created_at", { ascending: false });

  if (statusFilter !== "ALL") q = q.eq("status", statusFilter);
  if (reviewFilter !== "ALL") q = q.eq("review_status", reviewFilter);
  if (query.trim()) {
    q = q.ilike("open_port_name", `%${query.trim()}%`);
  }

  const { data } = await q.limit(500);
  const listings = (data ?? []) as Record<string, unknown>[];

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      status: statusFilter,
      review: reviewFilter,
      ...(query && { q: query }),
      ...overrides,
    });
    return `/admin/vessel-availability?${p}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Vessel Availability"
        subtitle={`${listings.length} postings shown`}
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

      <form
        method="GET"
        action="/admin/vessel-availability"
        className="relative max-w-xs"
      >
        <input type="hidden" name="status" value={statusFilter} />
        <input type="hidden" name="review" value={reviewFilter} />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          name="q"
          defaultValue={query}
          placeholder="Search open port…"
          className="w-full pl-9 pr-4 h-9 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-ocean-500"
        />
      </form>

      {listings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
          <Ship className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">
            No availability postings found
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {listings.map((va) => {
            const vessel = va.vessel as Record<string, unknown> | null;
            return (
              <Link
                key={va.id as string}
                href={`/admin/vessel-availability/${va.id}`}
                className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-ocean-300 hover:shadow-md transition-all flex flex-col gap-4"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-foam-50 border border-foam-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Ship className="w-4 h-4 text-foam-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 group-hover:text-ocean-700 transition-colors truncate">
                        {(vessel?.vessel_name as string) ?? "—"}
                      </p>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {(vessel?.vessel_type as string) ?? "—"}
                        {vessel?.dwt_grain
                          ? ` · ${Number(vessel.dwt_grain).toLocaleString()} DWT`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <ReviewStatusBadge status={va.review_status as string} />
                </div>

                {/* Open port */}
                {!!(va.open_port_name || va.open_zone) && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-700 truncate">
                      {va.open_port_name as string}
                      {va.open_zone ? ` (${va.open_zone as string})` : ""}
                    </span>
                  </div>
                )}

                {/* Pills */}
                <div className="grid grid-cols-2 gap-2">
                  <DataPill
                    icon={Calendar}
                    label="Open date"
                    value={(va.open_date as string) ?? "—"}
                  />
                  <DataPill
                    icon={Weight}
                    label="DWT"
                    value={
                      vessel?.dwt_grain
                        ? `${Number(vessel.dwt_grain).toLocaleString()} MT`
                        : "—"
                    }
                  />
                  <DataPill
                    icon={Calendar}
                    label="Posted"
                    value={fmt(va.created_at as string)}
                  />
                  {!!(va.ref) && (
                    <DataPill
                      icon={Tag}
                      label="Ref"
                      value={va.ref as string}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto">
                  <VesselStatusBadge status={va.status as string} />
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-ocean-500 group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            );
          })}
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
