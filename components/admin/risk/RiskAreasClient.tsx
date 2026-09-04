"use client";

// Leaflet needs `window` — load the editor client-only (same pattern as MarketMap).
import dynamic from "next/dynamic";
import type { RiskAreaRow } from "@/app/(admin)/admin/risk-areas/actions";

const RiskAreasEditor = dynamic(() => import("./RiskAreasEditor").then((m) => m.RiskAreasEditor), {
  ssr: false,
  loading: () => <div className="adm-card" style={{ padding: 24, color: "#6B7A99", fontSize: 13 }}>Loading chart…</div>,
});

export function RiskAreasClient({ initial, canEdit }: { initial: RiskAreaRow[]; canEdit: boolean }) {
  return <RiskAreasEditor initial={initial} canEdit={canEdit} />;
}
