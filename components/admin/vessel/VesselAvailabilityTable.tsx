"use client";

// Compact admin vessel-availability table — replaces the bulky posting cards.
import * as React from "react";
import { DataTable, type Column } from "@/components/admin/ui/DataTable";
import { ReviewStatusBadge, VesselStatusBadge } from "@/components/admin/AdminBadge";

export type AdminVesselAvailRow = {
  id: string;
  ref: string | null;
  status: string;
  review_status: string;
  open_port_name: string | null;
  open_zone: string | null;
  open_date: string | null;
  vessel_name: string;
  imo_number: string | null;
  vessel_type: string | null;
  dwt_grain: number | null;
  is_sanctioned: boolean;
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function VesselAvailabilityTable({ rows }: { rows: AdminVesselAvailRow[] }) {
  const columns: Column<AdminVesselAvailRow>[] = [
    {
      key: "vessel_name",
      label: "Vessel",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <strong style={{ color: "#1B3A5C", fontWeight: 500 }}>{r.vessel_name}</strong>
            {r.is_sanctioned && <span className="adm-badge flagged">Sanctioned</span>}
          </span>
          {r.imo_number && <span className="mono">IMO {r.imo_number}</span>}
        </div>
      ),
    },
    { key: "vessel_type", label: "Type", render: (r) => r.vessel_type ?? "—" },
    {
      key: "dwt_grain",
      label: "DWT",
      cellClass: "num",
      render: (r) => (r.dwt_grain != null ? Number(r.dwt_grain).toLocaleString() : "—"),
    },
    {
      key: "open",
      label: "Open",
      render: (r) => (
        <span>
          {r.open_port_name ?? "—"}
          {r.open_zone ? <span style={{ color: "#8B95A3" }}> · {r.open_zone}</span> : null}
        </span>
      ),
    },
    { key: "open_date", label: "Open date", render: (r) => fmt(r.open_date) },
    { key: "status", label: "Status", render: (r) => <VesselStatusBadge status={r.status} /> },
    { key: "review_status", label: "Review", render: (r) => <ReviewStatusBadge status={r.review_status} /> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchKeys={["vessel_name", "imo_number", "open_port_name", "open_zone", "vessel_type", "ref"]}
      searchPlaceholder="Search vessel, IMO or open port…"
      rowHref={(r) => `/admin/vessel-availability/${r.id}`}
      emptyText="No availability postings found"
    />
  );
}
