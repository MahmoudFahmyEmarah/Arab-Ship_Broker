"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  setCommodityActive,
  updateCommoditySortOrder,
} from "@/app/(admin)/admin/commodities/actions";
import type { AdminCommodityRow } from "@/lib/admin/types";

// IMSBC category → the adm-data-card group chip (A / B / C / DG palette).
const GROUP_CHIP: Record<string, { label: string; variant: "a" | "b" | "c" | "dg" }> = {
  Cat_A: { label: "A", variant: "a" },
  Cat_B: { label: "B", variant: "b" },
  Cat_C: { label: "C", variant: "c" },
  DG: { label: "DG", variant: "dg" },
  Non_DG: { label: "ND", variant: "c" },
};

export function CommodityRow({ commodity: c }: { commodity: AdminCommodityRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingSort, setEditingSort] = useState(false);
  const [sortVal, setSortVal] = useState(String(c.sort_order));

  function act(fn: () => Promise<{ success: boolean; error?: string }>, msg: string) {
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

  const chip = GROUP_CHIP[c.imsbc_category];

  return (
    <div className={`adm-data-card${!c.is_active ? " is-inactive" : ""}`}>
      <div className="adm-data-card__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="adm-data-card__title">{c.canonical_name}</div>
          {c.display_aliases && c.display_aliases.length > 0 && (
            <div className="adm-data-card__sub" style={{ fontFamily: "inherit" }}>
              {c.display_aliases.join(", ")}
            </div>
          )}
        </div>
        {chip && <span className={`adm-data-card__group is-${chip.variant}`}>{chip.label}</span>}
      </div>

      <div className="adm-data-card__row">
        <span className="adm-badge draft">{c.cargo_type}</span>
        {c.is_dg && <span className="adm-badge rejected">DG</span>}
        {c.is_grain && <span className="adm-badge amber">Grain</span>}
        {c.default_sf_m3t != null && (
          <span className="adm-badge" style={{ background: "#F7F8FA", color: "#8B95A3" }}>
            SF {c.default_sf_m3t}
          </span>
        )}
        {c.un_number && (
          <span className="adm-badge" style={{ background: "#F7F8FA", color: "#8B95A3" }}>
            UN {c.un_number}
          </span>
        )}
      </div>

      <div className="adm-data-card__foot">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span className="adm-data-card__k">Sort</span>
          {editingSort ? (
            <>
              <input
                type="number"
                value={sortVal}
                onChange={(e) => setSortVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSort();
                  if (e.key === "Escape") setEditingSort(false);
                }}
                className="adm-input"
                style={{ width: 56, padding: "3px 6px" }}
                autoFocus
              />
              <button className="adm-btn small" onClick={saveSort}>✓</button>
              <button className="adm-btn small ghost" onClick={() => setEditingSort(false)}>✕</button>
            </>
          ) : (
            <button
              className="adm-link"
              style={{ fontVariantNumeric: "tabular-nums" }}
              onClick={() => setEditingSort(true)}
              title="Click to edit sort order"
            >
              {c.sort_order}
            </button>
          )}
        </div>

        {c.is_active ? (
          <button
            className="adm-btn small"
            disabled={isPending}
            onClick={() => act(() => setCommodityActive(c.id, false), `${c.canonical_name} deactivated`)}
          >
            {isPending ? "…" : "Deactivate"}
          </button>
        ) : (
          <button
            className="adm-btn small approve"
            disabled={isPending}
            onClick={() => act(() => setCommodityActive(c.id, true), `${c.canonical_name} reactivated`)}
          >
            {isPending ? "…" : "Reactivate"}
          </button>
        )}
      </div>
    </div>
  );
}
