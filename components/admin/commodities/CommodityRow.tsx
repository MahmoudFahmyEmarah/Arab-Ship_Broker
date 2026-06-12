"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff, Eye, Loader2, Check, X, Hash } from "lucide-react";
import {
  setCommodityActive,
  updateCommoditySortOrder,
} from "@/app/(admin)/admin/commodities/actions";
import type { AdminCommodityRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const IMSBC_COLORS: Record<string, string> = {
  Cat_A: "bg-red-50 text-red-700 border-red-200",
  Cat_B: "bg-amber-50 text-amber-700 border-amber-200",
  Cat_C: "bg-green-50 text-green-700 border-green-200",
  DG: "bg-red-100 text-red-800 border-red-300",
  Non_DG: "bg-asb-gray-100 text-asb-gray-700 border-asb-gray-200",
};

export function CommodityRow({
  commodity: c,
}: {
  commodity: AdminCommodityRow;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingSort, setEditingSort] = useState(false);
  const [sortVal, setSortVal] = useState(String(c.sort_order));

  function act(
    fn: () => Promise<{ success: boolean; error?: string }>,
    msg: string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.success) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error ?? "Action failed.");
    });
  }

  const saveSort = () => {
    const n = parseInt(sortVal, 10);
    if (!isNaN(n) && n !== c.sort_order) {
      act(() => updateCommoditySortOrder(c.id, n), "Sort order updated");
    }
    setEditingSort(false);
  };

  return (
    <div
      className={cn(
        "dp-card p-5 flex flex-col gap-4",
        !c.is_active && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-asb-navy truncate">
            {c.canonical_name}
          </p>
          {c.display_aliases && c.display_aliases.length > 0 && (
            <p className="text-[11px] text-asb-gray-400 truncate mt-0.5">
              {c.display_aliases.join(", ")}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md border",
            IMSBC_COLORS[c.imsbc_category] ?? "bg-asb-gray-100 text-asb-gray-700",
          )}
        >
          {c.imsbc_category}
        </span>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-bold text-asb-gray-700 bg-asb-gray-100 border border-asb-gray-200 rounded px-1.5 py-0.5">
          {c.cargo_type}
        </span>
        {c.is_dg && (
          <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
            DG
          </span>
        )}
        {c.is_grain && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            Grain
          </span>
        )}
        {c.default_sf_m3t != null && (
          <span className="text-[10px] font-semibold text-asb-gray-500 bg-asb-gray-50 border border-asb-gray-100 rounded px-1.5 py-0.5">
            SF: {c.default_sf_m3t}
          </span>
        )}
      </div>

      {/* Footer: sort + action */}
      <div className="flex items-center justify-between pt-3 border-t border-asb-gray-100 mt-auto">
        <div className="flex items-center gap-1.5">
          <Hash className="w-3 h-3 text-asb-gray-400" />
          {editingSort ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={sortVal}
                onChange={(e) => setSortVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSort();
                  if (e.key === "Escape") setEditingSort(false);
                }}
                className="w-12 h-7 text-xs px-1.5 border border-asb-blue rounded-lg focus:outline-none"
                autoFocus
              />
              <button onClick={saveSort} className="text-green-600 hover:text-green-700">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setEditingSort(false)} className="text-asb-gray-400 hover:text-asb-ink">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingSort(true)}
              className="text-xs font-mono text-asb-gray-400 hover:text-asb-blue"
              title="Click to edit sort order"
            >
              {c.sort_order}
            </button>
          )}
        </div>

        {c.is_active ? (
          <button
            disabled={isPending}
            onClick={() =>
              act(
                () => setCommodityActive(c.id, false),
                `${c.canonical_name} deactivated`,
              )
            }
            className="flex items-center gap-1.5 text-xs font-semibold text-asb-gray-500 hover:text-red-600 hover:bg-red-50 border border-asb-gray-200 hover:border-red-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            Deactivate
          </button>
        ) : (
          <button
            disabled={isPending}
            onClick={() =>
              act(
                () => setCommodityActive(c.id, true),
                `${c.canonical_name} reactivated`,
              )
            }
            className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}
