import Link from "next/link";
import { Ship, Search, ArrowRight, ShieldAlert, Weight, Flag, Calendar, Anchor } from "lucide-react";

import { requireAdmin } from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { RiskLevelBadge } from "@/components/admin/AdminBadge";
import type { AdminVesselRow, RiskLevel } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const RISK_TABS: { label: string; value: RiskLevel | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "CLEAR", value: "CLEAR" },
  { label: "LOW", value: "LOW" },
  { label: "MEDIUM", value: "MEDIUM" },
  { label: "HIGH", value: "HIGH" },
];

const SCOPE_COLORS: Record<string, string> = {
  "In Scope": "text-green-700 bg-green-50 border-green-200",
  Marginal: "text-amber-700 bg-amber-50 border-amber-200",
  "Out of Scope": "text-slate-500 bg-slate-50 border-slate-200",
};

export default async function AdminVesselsPage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; q?: string; sanctioned?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const riskFilter = (params.risk ?? "ALL") as RiskLevel | "ALL";
  const query = params.q ?? "";
  const sanctionedOnly = params.sanctioned === "1";

  const { getSupabaseAdminClient: getAdmin } =
    await import("@/lib/supabase/admin");
  const adminClient = getAdmin();

  let q = adminClient
    .from("vessels")
    .select(
      "id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, scope, risk_level, is_sanctioned, owner_company, is_geared, grain_certified, dg_certified, created_at",
    )
    .order("vessel_name");

  if (riskFilter !== "ALL") q = q.eq("risk_level", riskFilter);
  if (sanctionedOnly) q = q.eq("is_sanctioned", true);
  if (query.trim()) {
    q = q.or(
      `vessel_name.ilike.%${query.trim()}%,imo_number.ilike.%${query.trim()}%`,
    );
  }

  const { data } = await q.limit(500);
  const vessels = (data ?? []) as AdminVesselRow[];

  const sanctionedCount = vessels.filter((v) => v.is_sanctioned).length;
  const highRiskCount = vessels.filter((v) => v.risk_level === "HIGH").length;

  const buildHref = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      risk: riskFilter,
      ...(query && { q: query }),
      ...(sanctionedOnly && { sanctioned: "1" }),
      ...overrides,
    });
    return `/admin/vessels?${p}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Vessel Intelligence"
        subtitle={`${vessels.length} vessels · ${sanctionedCount} sanctioned · ${highRiskCount} HIGH risk`}
      />

      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit flex-wrap">
        {RISK_TABS.map((tab) => {
          const active = riskFilter === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildHref({ risk: tab.value })}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                active
                  ? "bg-ocean-600 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <form
          method="GET"
          action="/admin/vessels"
          className="relative flex-1 max-w-xs"
        >
          <input type="hidden" name="risk" value={riskFilter} />
          {sanctionedOnly && (
            <input type="hidden" name="sanctioned" value="1" />
          )}
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search vessel name or IMO…"
            className="w-full pl-9 pr-4 h-9 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-ocean-500"
          />
        </form>
        <Link
          href={buildHref({ sanctioned: sanctionedOnly ? "" : "1" })}
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border font-medium transition-all",
            sanctionedOnly
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-slate-500 border-slate-200 hover:border-red-300 hover:text-red-600",
          )}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Sanctioned only
        </Link>
      </div>

      {vessels.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
          <Ship className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">No vessels found</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {vessels.map((v) => (
            <Link
              key={v.id}
              href={`/admin/vessels/${v.id}`}
              className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-ocean-300 hover:shadow-md transition-all flex flex-col gap-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                    <Ship className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <p className="text-sm font-bold text-slate-900 group-hover:text-ocean-700 transition-colors truncate">
                        {v.vessel_name}
                      </p>
                      {v.is_sanctioned && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 rounded px-1.5 py-0.5">
                          <ShieldAlert className="w-3 h-3" /> SANCTIONED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      {v.imo_number ? `IMO ${v.imo_number}` : "No IMO"}
                      {v.vessel_type ? ` · ${v.vessel_type}` : ""}
                    </p>
                  </div>
                </div>
                <RiskLevelBadge level={v.risk_level} />
              </div>

              {/* Pills */}
              <div className="grid grid-cols-2 gap-2">
                <DataPill
                  icon={Weight}
                  label="DWT"
                  value={
                    v.dwt_grain
                      ? `${v.dwt_grain.toLocaleString()} MT`
                      : "—"
                  }
                />
                <DataPill
                  icon={Calendar}
                  label="Built"
                  value={v.build_year ? String(v.build_year) : "—"}
                />
                <DataPill
                  icon={Flag}
                  label="Flag"
                  value={v.flag ?? "—"}
                />
                <DataPill
                  icon={Anchor}
                  label="Scope"
                  value={v.scope}
                />
              </div>

              {/* Cert badges */}
              {(v.is_geared || v.grain_certified || v.dg_certified) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {v.is_geared && (
                    <span className="text-[10px] font-bold text-ocean-700 bg-ocean-50 border border-ocean-200 rounded px-1.5 py-0.5">
                      Geared
                    </span>
                  )}
                  {v.grain_certified && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      Grain
                    </span>
                  )}
                  {v.dg_certified && (
                    <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                      DG
                    </span>
                  )}
                </div>
              )}

              {/* Scope badge + arrow */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto">
                <span
                  className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-lg border",
                    SCOPE_COLORS[v.scope] ?? "bg-slate-100 text-slate-500 border-slate-200",
                  )}
                >
                  {v.scope}
                </span>
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
