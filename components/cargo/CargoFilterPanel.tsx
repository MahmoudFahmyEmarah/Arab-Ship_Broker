"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Filter, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZONE_LABELS, ZoneCode } from "@/lib/schemas/cargo";

const OPERATING_ZONES: ZoneCode[] = [
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
];

interface FilterState {
  zone: string;
  cargo_type: string;
  min_qty: string;
  max_qty: string;
  is_dg_only: boolean;
  sort: string;
}

export function CargoFilterPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    zone: searchParams.get("zone") || "",
    cargo_type: searchParams.get("cargo_type") || "",
    min_qty: searchParams.get("min_qty") || "",
    max_qty: searchParams.get("max_qty") || "",
    is_dg_only: searchParams.get("is_dg_only") === "true",
    sort: searchParams.get("sort") || "newest",
  });

  const activeCount = [
    filters.zone,
    filters.cargo_type,
    filters.min_qty,
    filters.max_qty,
    filters.is_dg_only,
  ].filter((v) =>
    typeof v === "boolean" ? v : v !== "" && v !== "newest",
  ).length;

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.zone) params.set("zone", filters.zone);
    if (filters.cargo_type) params.set("cargo_type", filters.cargo_type);
    if (filters.min_qty) params.set("min_qty", filters.min_qty);
    if (filters.max_qty) params.set("max_qty", filters.max_qty);
    if (filters.is_dg_only) params.set("is_dg_only", "true");
    if (filters.sort && filters.sort !== "newest")
      params.set("sort", filters.sort);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [filters, router]);

  const clearAll = () =>
    setFilters({
      zone: "",
      cargo_type: "",
      min_qty: "",
      max_qty: "",
      is_dg_only: false,
      sort: "newest",
    });

  const panelContent = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-base text-asb-navy flex items-center gap-2">
          <Filter className="w-4 h-4" /> Filters
          {activeCount > 0 && (
            <span className="bg-asb-blue-light text-asb-blue text-xs px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </h2>
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-asb-gray-500 hover:text-asb-blue font-semibold"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-asb-gray-500 uppercase tracking-wide">
          Zone
        </label>
        <select
          className="w-full p-2.5 border border-asb-gray-200 rounded bg-asb-gray-50 text-sm focus:outline-none  focus:ring-asb-blue focus:border-asb-blue transition-all"
          value={filters.zone}
          onChange={(e) => setFilters((f) => ({ ...f, zone: e.target.value }))}
        >
          <option value="">All zones</option>
          {OPERATING_ZONES.map((code) => (
            <option key={code} value={code}>
              {ZONE_LABELS[code]} ({code})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-asb-gray-500 uppercase tracking-wide">
          Cargo Type
        </label>
        <div className="flex bg-asb-gray-100 p-1 rounded gap-1">
          {(["", "Dry Bulk", "Break Bulk"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilters((f) => ({ ...f, cargo_type: t }))}
              className={cn(
                "flex-1 text-xs py-2 rounded-lg font-semibold transition-colors",
                filters.cargo_type === t
                  ? "bg-white shadow-sm text-asb-blue"
                  : "text-asb-gray-500 hover:text-asb-ink-soft",
              )}
            >
              {t === "" ? "All" : t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-asb-gray-500 uppercase tracking-wide">
          Quantity (MT)
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            placeholder="Min"
            value={filters.min_qty}
            onChange={(e) =>
              setFilters((f) => ({ ...f, min_qty: e.target.value }))
            }
            className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-asb-blue focus:border-asb-blue"
          />
          <span className="text-asb-gray-400 text-sm">–</span>
          <input
            type="number"
            placeholder="Max"
            value={filters.max_qty}
            onChange={(e) =>
              setFilters((f) => ({ ...f, max_qty: e.target.value }))
            }
            className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-asb-gray-200 bg-asb-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-asb-blue focus:border-asb-blue"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer group">
        <div
          className={cn(
            "w-9 h-5 rounded-full transition-colors relative",
            filters.is_dg_only ? "bg-asb-blue" : "bg-asb-gray-200",
          )}
          onClick={() =>
            setFilters((f) => ({ ...f, is_dg_only: !f.is_dg_only }))
          }
        >
          <div
            className={cn(
              "w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform shadow-sm",
              filters.is_dg_only ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </div>
        <span className="text-sm font-semibold text-asb-ink-soft">
          Dangerous goods only
        </span>
      </label>

      <div className="space-y-2">
        <label className="text-xs font-bold text-asb-gray-500 uppercase tracking-wide">
          Sort By
        </label>
        <select
          className="w-full p-2.5 border border-asb-gray-200 rounded bg-asb-gray-50 text-sm focus:outline-none  focus:ring-asb-blue focus:border-asb-blue transition-all"
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
        >
          <option value="newest">Newest first</option>
          <option value="laycan_asc">Laycan (soonest first)</option>
          <option value="qty_asc">Quantity (smallest first)</option>
          <option value="qty_desc">Quantity (largest first)</option>
        </select>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setIsMobileOpen(true)}
        className="hidden max-[1024px]:flex w-full items-center justify-center gap-2 bg-white border border-asb-gray-200 text-asb-ink-soft font-semibold px-4 py-2.5 rounded shadow-sm text-sm mb-4 cursor-pointer"
      >
        <SlidersHorizontal className="w-4 h-4" /> Filters
      </button>

      <div
        className={cn(
          "fixed inset-0 bg-asb-navy-deep/50 z-40 hidden max-[1024px]:block transition-opacity",
          isMobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={() => setIsMobileOpen(false)}
      />

      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[90vw] max-w-sm bg-white z-50 p-6 max-[768px]:p-4 pt-12 max-[768px]:pt-11 overflow-y-auto transition-transform duration-300 hidden max-[1024px]:block",
          isMobileOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <button
          onClick={() => setIsMobileOpen(false)}
          className="absolute top-3 right-3 p-2 text-asb-gray-500 hover:bg-asb-gray-100 rounded-full"
        >
          <X className="w-5 h-5" />
        </button>
        {panelContent}
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-asb-gray-200 h-fit sticky top-8 max-[1024px]:hidden">
        {panelContent}
      </div>
    </>
  );
}
