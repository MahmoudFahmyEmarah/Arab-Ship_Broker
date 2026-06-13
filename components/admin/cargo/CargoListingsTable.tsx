"use client";

// Compact admin cargo table — replaces the oversized QTY/LAYCAN/REF tile cards.
// Receives plain server-fetched rows; defines the columns client-side (render
// fns can't cross the server→client boundary).
import * as React from "react";
import { DataTable, type Column } from "@/components/admin/ui/DataTable";
import { AdminBadge, ReviewStatusBadge } from "@/components/admin/AdminBadge";

export type AdminCargoListRow = {
  id: string;
  ref: string | null;
  status: string;
  review_status: string;
  cargo_type: string;
  commodity_name: string;
  is_dg_cargo: boolean;
  is_grain_cargo: boolean;
  qty_min_mt: number | null;
  qty_max_mt: number | null;
  load_zone: string | null;
  disch_zone: string | null;
  load_port_name: string | null;
  disch_port_name: string | null;
  laycan_from: string | null;
  laycan_to: string | null;
  is_spot: boolean;
  freight_idea_usd_mt: number | null;
};

const STATUS_BADGE: Record<string, { label: string; variant: Parameters<typeof AdminBadge>[0]["variant"] }> = {
  IN: { label: "Active", variant: "active" },
  PARTIAL: { label: "Partial", variant: "subs" },
  OUT: { label: "Out of scope", variant: "inactive" },
  CLOSED: { label: "Closed", variant: "fixed" },
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function laycan(r: AdminCargoListRow) {
  if (r.is_spot) return "SPOT";
  if (!r.laycan_from && !r.laycan_to) return "—";
  if (r.laycan_from && r.laycan_to) return `${fmt(r.laycan_from)}–${fmt(r.laycan_to)}`;
  return fmt(r.laycan_from ?? r.laycan_to);
}
function qty(r: AdminCargoListRow) {
  if (r.qty_max_mt == null) return "—";
  const max = Number(r.qty_max_mt).toLocaleString();
  if (r.qty_min_mt != null && r.qty_min_mt !== r.qty_max_mt) {
    return `${Number(r.qty_min_mt).toLocaleString()}–${max}`;
  }
  return max;
}

export function CargoListingsTable({ rows }: { rows: AdminCargoListRow[] }) {
  const columns: Column<AdminCargoListRow>[] = [
    {
      key: "commodity_name",
      label: "Commodity",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <strong style={{ color: "#1B3A5C", fontWeight: 500 }}>{r.commodity_name}</strong>
            {r.is_dg_cargo && <span className="adm-badge rejected">DG</span>}
            {r.is_grain_cargo && <span className="adm-badge amber">Grain</span>}
          </span>
          {r.ref && <span className="mono">{r.ref}</span>}
        </div>
      ),
    },
    { key: "cargo_type", label: "Type" },
    {
      key: "route",
      label: "Route",
      render: (r) => (
        <span title={`${r.load_port_name ?? ""} → ${r.disch_port_name ?? ""}`}>
          {r.load_zone ?? "—"} <span style={{ color: "#8B95A3" }}>→</span> {r.disch_zone ?? "—"}
        </span>
      ),
    },
    { key: "qty", label: "Qty (MT)", cellClass: "num", render: (r) => qty(r) },
    { key: "laycan", label: "Laycan", render: (r) => laycan(r) },
    {
      key: "freight_idea_usd_mt",
      label: "Freight",
      cellClass: "num",
      render: (r) => (r.freight_idea_usd_mt != null ? `$${r.freight_idea_usd_mt}/MT` : "—"),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const s = STATUS_BADGE[r.status] ?? { label: r.status, variant: "neutral" as const };
        return <AdminBadge variant={s.variant} label={s.label} />;
      },
    },
    { key: "review_status", label: "Review", render: (r) => <ReviewStatusBadge status={r.review_status} /> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchKeys={["commodity_name", "ref", "load_zone", "disch_zone", "cargo_type"]}
      searchPlaceholder="Search commodity, ref or zone…"
      rowHref={(r) => `/admin/cargo/${r.id}`}
      emptyText="No listings found"
    />
  );
}
