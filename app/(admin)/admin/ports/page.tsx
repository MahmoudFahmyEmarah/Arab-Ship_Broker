import Link from "next/link";
import { MapPin, Search, AlertTriangle, Plus, Globe, Tag } from "lucide-react";

import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminBadge } from "@/components/admin/AdminBadge";
import { PortRowActions } from "@/components/admin/ports/PortRowActions";
import { CreatePortModal } from "@/components/admin/ports/CreatePortModal";
import type { AdminPortRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const ZONE_TABS = [
  "ALL",
  "B.SEA",
  "E.MED",
  "W.MED",
  "C.MED",
  "ADRIATIC",
  "R.SEA",
  "AG",
  "A.SEA",
  "WCAF",
  "ECAF",
  "NCONT",
  "CARIB",
  "F.EAST",
  "ECI",
] as const;

export default async function AdminPortsPage({
  searchParams,
}: {
  searchParams: Promise<{
    zone?: string;
    q?: string;
    unverified?: string;
    inactive?: string;
    create?: string;
  }>;
}) {
  await requireAdmin({ section: "ports" });
  const params = await searchParams;
  const supabase = await getAdminSupabaseClient();

  const zoneFilter = params.zone ?? "ALL";
  const query = params.q ?? "";
  const unverifiedOnly = params.unverified === "1";
  const showInactive = params.inactive === "1";
  const showCreate = params.create === "1";

  let q = supabase
    .from("ports")
    .select(
      "locode, trade_name, country, zone, port_type, is_active, is_verified, notes, created_at",
    )
    .order("trade_name");

  if (zoneFilter !== "ALL") q = q.eq("zone", zoneFilter);
  if (unverifiedOnly) q = q.eq("is_verified", false);
  if (!showInactive) q = q.eq("is_active", true);
  if (query.trim()) q = q.ilike("trade_name", `%${query.trim()}%`);

  const { data } = await q.limit(500);
  const ports = (data ?? []) as AdminPortRow[];

  const unverifiedCount = ports.filter((p) => !p.is_verified).length;

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      zone: zoneFilter,
      ...(query && { q: query }),
      ...(unverifiedOnly && { unverified: "1" }),
      ...(showInactive && { inactive: "1" }),
      ...overrides,
    });
    return `/admin/ports?${p}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Ports"
        subtitle={`${ports.length} ports · ${unverifiedCount} awaiting verification`}
      >
        <Link
          href={buildHref({ create: "1" })}
          className="flex items-center gap-2 bg-asb-blue hover:bg-asb-navy text-white text-sm font-semibold px-4 py-2 rounded transition-colors"
        >
          <Plus className="w-4 h-4" /> Add port
        </Link>
      </AdminPageHeader>

      {unverifiedCount > 0 && !unverifiedOnly && (
        <Link
          href={buildHref({ unverified: "1" })}
          className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded px-4 py-3 hover:bg-amber-100 transition-colors"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">
            {unverifiedCount} port{unverifiedCount !== 1 ? "s" : ""} awaiting
            verification — click to review
          </p>
        </Link>
      )}

      <div className="flex items-center gap-1 overflow-x-auto pb-1 hide-scrollbar">
        <div className="flex items-center gap-1 dp-card p-1 shrink-0">
          {ZONE_TABS.slice(0, 5).map((tab) => (
            <Link
              key={tab}
              href={buildHref({ zone: tab })}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                zoneFilter === tab
                  ? "bg-asb-blue text-white shadow-sm"
                  : "text-asb-gray-500 hover:bg-asb-gray-50 hover:text-asb-ink",
              )}
            >
              {tab}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1 dp-card p-1 shrink-0">
          {ZONE_TABS.slice(5).map((tab) => (
            <Link
              key={tab}
              href={buildHref({ zone: tab })}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                zoneFilter === tab
                  ? "bg-asb-blue text-white shadow-sm"
                  : "text-asb-gray-500 hover:bg-asb-gray-50 hover:text-asb-ink",
              )}
            >
              {tab}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <form
          method="GET"
          action="/admin/ports"
          className="relative flex-1 max-w-xs"
        >
          <input type="hidden" name="zone" value={zoneFilter} />
          {unverifiedOnly && (
            <input type="hidden" name="unverified" value="1" />
          )}
          {showInactive && <input type="hidden" name="inactive" value="1" />}
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-asb-gray-400" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search port name…"
            className="w-full pl-9 pr-4 h-9 text-sm rounded border border-asb-gray-200 bg-white focus:outline-none  focus:border-asb-blue"
          />
        </form>

        <Link
          href={buildHref({ unverified: unverifiedOnly ? "" : "1" })}
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-2 rounded border font-medium transition-all",
            unverifiedOnly
              ? "bg-amber-500 text-white border-amber-500"
              : "bg-white text-asb-gray-500 border-asb-gray-200 hover:border-amber-300",
          )}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Unverified only
        </Link>

        <Link
          href={buildHref({ inactive: showInactive ? "" : "1" })}
          className={cn(
            "text-xs px-3 py-2 rounded border font-medium transition-all",
            showInactive
              ? "bg-asb-navy-deep text-white border-asb-navy-deep"
              : "bg-white text-asb-gray-500 border-asb-gray-200 hover:border-asb-gray-200",
          )}
        >
          {showInactive ? "Hiding inactive" : "Show inactive"}
        </Link>
      </div>

      {ports.length === 0 ? (
        <div className="dp-card py-16 text-center">
          <MapPin className="w-8 h-8 text-asb-gray-400 mx-auto mb-3" />
          <p className="text-asb-gray-500 font-semibold">No ports found</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {ports.map((port) => (
            <div
              key={port.locode}
              className={cn(
                "bg-white border rounded p-5 flex flex-col gap-4",
                !port.is_verified
                  ? "border-amber-200 bg-amber-50/30"
                  : "border-asb-gray-200",
              )}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4 text-asb-blue" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-asb-navy truncate">
                      {port.trade_name}
                    </p>
                    <p className="text-xs font-mono font-bold text-asb-gray-500 mt-0.5">
                      {port.locode}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  {!port.is_verified && (
                    <AdminBadge variant="pending" label="Unverified" />
                  )}
                  {!port.is_active && (
                    <AdminBadge variant="inactive" label="Inactive" />
                  )}
                  {port.is_verified && port.is_active && (
                    <AdminBadge variant="approved" label="Active" />
                  )}
                </div>
              </div>

              {/* Notes */}
              {port.notes && (
                <p className="text-xs text-asb-gray-500 bg-asb-gray-50 rounded px-3 py-2 border border-asb-gray-100 line-clamp-2">
                  {port.notes}
                </p>
              )}

              {/* Pills */}
              <div className="grid grid-cols-2 gap-2">
                <DataPill icon={Globe} label="Country" value={port.country} />
                <DataPill
                  icon={Tag}
                  label="Zone"
                  value={port.zone}
                  highlight
                />
                <DataPill
                  icon={MapPin}
                  label="Type"
                  value={port.port_type}
                />
              </div>

              {/* Footer actions */}
              <div className="pt-3 border-t border-asb-gray-100 mt-auto">
                <PortRowActions port={port} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreatePortModal />}
    </div>
  );
}

function DataPill({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-2.5 py-2 border",
        highlight
          ? "bg-asb-blue-light border-asb-gray-200"
          : "bg-asb-gray-50 border-asb-gray-100",
      )}
    >
      <p className="text-[10px] text-asb-gray-400 font-semibold uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <Icon
          className={cn(
            "w-3 h-3 shrink-0",
            highlight ? "text-asb-blue" : "text-asb-gray-400",
          )}
        />
        <p
          className={cn(
            "text-xs font-bold truncate",
            highlight ? "text-asb-blue" : "text-asb-ink-soft",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
