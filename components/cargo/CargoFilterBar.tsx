"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  Calendar,
  Globe,
  Package,
  Weight,
  ShieldAlert,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ZONE_LABELS, ZoneCode } from "@/lib/schemas/cargo";
import { useCargoFilterTransition } from "@/components/cargo/CargoFilterTransitionProvider";

const ZONES: ZoneCode[] = [
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
];

interface FilterState {
  laycan_from: string;
  laycan_to: string;
  zone: string;
  cargo_type: string;
  is_dg_only: boolean;
  min_qty: string;
  max_qty: string;
  sort: string;
}

const EMPTY: FilterState = {
  laycan_from: "",
  laycan_to: "",
  zone: "",
  cargo_type: "",
  is_dg_only: false,
  min_qty: "",
  max_qty: "",
  sort: "newest",
};

function FilterLabel({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-asb-gray-400 uppercase tracking-wider mb-1">
      <Icon className="w-3 h-3" />
      {children}
    </span>
  );
}

function Divider() {
  return <div className="w-px h-10 bg-asb-gray-100 shrink-0 hidden lg:block" />;
}

export function CargoFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const transition = useCargoFilterTransition();
  const startTransition = transition?.startTransition;

  const [f, setF] = useState<FilterState>({
    laycan_from: searchParams.get("laycan_from") || "",
    laycan_to: searchParams.get("laycan_to") || "",
    zone: searchParams.get("zone") || "",
    cargo_type: searchParams.get("cargo_type") || "",
    is_dg_only: searchParams.get("is_dg_only") === "true",
    min_qty: searchParams.get("min_qty") || "",
    max_qty: searchParams.get("max_qty") || "",
    sort: searchParams.get("sort") || "newest",
  });

  const activeCount = [
    f.laycan_from,
    f.laycan_to,
    f.zone,
    f.cargo_type,
    f.min_qty,
    f.max_qty,
    f.is_dg_only,
  ].filter((v) => (typeof v === "boolean" ? v : v !== "")).length;

  const set = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
      setF((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const clearAll = () => setF(EMPTY);

  useEffect(() => {
    const params = new URLSearchParams();
    if (f.laycan_from) params.set("laycan_from", f.laycan_from);
    if (f.laycan_to) params.set("laycan_to", f.laycan_to);
    if (f.zone) params.set("zone", f.zone);
    if (f.cargo_type) params.set("cargo_type", f.cargo_type);
    if (f.min_qty) params.set("min_qty", f.min_qty);
    if (f.max_qty) params.set("max_qty", f.max_qty);
    if (f.is_dg_only) params.set("is_dg_only", "true");
    if (f.sort && f.sort !== "newest") params.set("sort", f.sort);
    const start = startTransition ?? ((cb: () => void) => cb());
    start(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }, [f, router, startTransition]);

  const inputCls =
    "h-9 px-2.5 rounded-lg border border-asb-gray-200 bg-asb-gray-50 text-xs font-medium text-asb-ink-soft focus:outline-none  focus:ring-asb-blue focus:border-asb-blue focus:bg-white transition-all";

  const selectCls = cn(inputCls, "pr-7 appearance-none cursor-pointer");

  const filterContent = (
    <div className="flex flex-wrap lg:flex-nowrap items-end gap-3 w-full">
      <div className="flex-1 min-w-40">
        <FilterLabel icon={Calendar}>Date range (laycan)</FilterLabel>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={f.laycan_from}
            onChange={(e) => set("laycan_from", e.target.value)}
            className={cn(inputCls, "flex-1 min-w-0")}
            title="Laycan from"
          />
          <span className="text-asb-gray-400 text-xs shrink-0">–</span>
          <input
            type="date"
            value={f.laycan_to}
            onChange={(e) => set("laycan_to", e.target.value)}
            className={cn(inputCls, "flex-1 min-w-0")}
            title="Laycan to"
          />
        </div>
      </div>

      <Divider />

      <div className="flex-1 min-w-35">
        <FilterLabel icon={Globe}>Geographic zone</FilterLabel>
        <div className="relative">
          <select
            value={f.zone}
            onChange={(e) => set("zone", e.target.value)}
            className={cn(selectCls, "w-full")}
          >
            <option value="">All zones</option>
            {ZONES.map((code) => (
              <option key={code} value={code}>
                {ZONE_LABELS[code]} ({code})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-asb-gray-400" />
        </div>
      </div>

      <Divider />

      <div className="shrink-0">
        <FilterLabel icon={ShieldAlert}>Cargo category</FilterLabel>
        <div className="flex items-center bg-asb-gray-100 p-0.5 rounded-lg h-9">
          {(
            [
              { label: "All", value: false },
              { label: "DG only", value: true },
            ] as const
          ).map(({ label, value }) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => set("is_dg_only", value)}
              className={cn(
                "px-3 h-full text-xs font-semibold rounded-md transition-all whitespace-nowrap",
                f.is_dg_only === value
                  ? "bg-white shadow-sm text-asb-blue"
                  : "text-asb-gray-500 hover:text-asb-ink-soft",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Divider />

      <div className="shrink-0">
        <FilterLabel icon={Package}>Cargo type</FilterLabel>
        <div className="flex items-center bg-asb-gray-100 p-0.5 rounded-lg h-9">
          {(["", "Dry Bulk", "Break Bulk"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("cargo_type", t)}
              className={cn(
                "px-3 h-full text-xs font-semibold rounded-md transition-all whitespace-nowrap",
                f.cargo_type === t
                  ? "bg-white shadow-sm text-asb-blue"
                  : "text-asb-gray-500 hover:text-asb-ink-soft",
              )}
            >
              {t === "" ? "All" : t}
            </button>
          ))}
        </div>
      </div>

      <Divider />

      <div className="flex-1 min-w-37.5">
        <FilterLabel icon={Weight}>Quantity / DWT (MT)</FilterLabel>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            placeholder="Min"
            min={0}
            value={f.min_qty}
            onChange={(e) => set("min_qty", e.target.value)}
            className={cn(inputCls, "flex-1 min-w-0")}
          />
          <span className="text-asb-gray-400 text-xs shrink-0">–</span>
          <input
            type="number"
            placeholder="Max"
            min={0}
            value={f.max_qty}
            onChange={(e) => set("max_qty", e.target.value)}
            className={cn(inputCls, "flex-1 min-w-0")}
          />
        </div>
      </div>

      <Divider />

      <div className="shrink-0 min-w-35">
        <FilterLabel icon={ArrowUpDown}>Sort</FilterLabel>
        <div className="relative">
          <select
            value={f.sort}
            onChange={(e) => set("sort", e.target.value)}
            className={cn(selectCls, "w-full")}
          >
            <option value="newest">Newest first</option>
            <option value="laycan_asc">Laycan — soonest</option>
            <option value="qty_asc">Qty — smallest</option>
            <option value="qty_desc">Qty — largest</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-asb-gray-400" />
        </div>
      </div>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="shrink-0 flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-asb-gray-500 hover:text-red-600 hover:bg-red-50 border border-asb-gray-200 hover:border-red-200 rounded-lg transition-all whitespace-nowrap self-end"
        >
          <X className="w-3.5 h-3.5" /> Clear all
          <span className="ml-0.5 bg-asb-blue-light text-asb-blue text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            {activeCount}
          </span>
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="hidden lg:block w-full bg-white border border-asb-gray-200 rounded px-5 py-4 shadow-sm">
        {filterContent}
      </div>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="w-full flex items-center justify-between bg-white border border-asb-gray-200 text-asb-ink-soft font-semibold px-4 py-2.5 rounded shadow-sm text-sm"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-asb-blue" />
            Filters
            {activeCount > 0 && (
              <span className="bg-asb-blue-light text-asb-blue text-xs px-2 py-0.5 rounded-full font-bold">
                {activeCount}
              </span>
            )}
          </span>
          <ChevronDown className="w-4 h-4 text-asb-gray-400" />
        </button>
      </div>

      <div
        className={cn(
          "lg:hidden fixed inset-0 bg-asb-navy-deep/50 z-40 transition-opacity",
          mobileOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          "lg:hidden fixed bottom-0 left-0 right-0 bg-white z-50 rounded-t-2xl p-5 shadow-2xl transition-transform duration-300",
          mobileOpen ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base text-asb-navy flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Filters
            {activeCount > 0 && (
              <span className="bg-asb-blue-light text-asb-blue text-xs px-2 py-0.5 rounded-full">
                {activeCount}
              </span>
            )}
          </h2>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 text-asb-gray-400 hover:bg-asb-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto max-h-[70vh]">{filterContent}</div>
      </div>
    </>
  );
}
