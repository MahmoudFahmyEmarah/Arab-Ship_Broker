"use client";

// VesselCard — ported from the Claude design (asb/cards.jsx) to TS.
// (Rules-engine tooltips + voyage deep-link deferred; structure/classes intact.)
import * as React from "react";
import { VesselView } from "@/lib/portal/types";
import { FieldRow, statusBadge, urgencyDot } from "./ui";

export function VesselCard({
  data,
  selected,
  onSelect,
  compact,
  masked,
}: {
  data: VesselView;
  selected?: boolean;
  onSelect?: (id: string) => void;
  compact?: boolean;
  masked?: boolean;
}) {
  const v = data;
  const stripClass = `strip-${v.status}`;
  const fuelStr = (n: number | string) => (n !== "—" ? `${n} MT/d` : "—");
  const name = masked ? "Vessel identity — Tier 3+" : v.name;
  const imo = masked ? "IMO ••••" : v.imo;

  return (
    <div
      className={`asb-card ${stripClass} ${selected ? "is-selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(v.id);
      }}
    >
      <div className="row" style={{ marginBottom: 6, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-h)", fontWeight: 500, color: "var(--asb-ink)", lineHeight: 1.2 }}>
            {name}
          </div>
          <div style={{ fontSize: "var(--fs-body-sm)", color: "var(--asb-gray-500)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            <span className="mono">{imo}</span> · {v.flag} · {v.type}
            {v.built ? ` · Built ${v.built}` : ""}
          </div>
        </div>
        {statusBadge(v.status)}
      </div>

      {!compact && (
        <>
          <div className="grid-2" style={{ marginBottom: 8 }}>
            <FieldRow label="DWT" value={`${v.dwt} MT`} valueClass="blue" />
            <FieldRow label="Built / age" value={v.built ? `${v.built} (${v.age} yrs)` : "—"} />
            <FieldRow label="Grain cap" value={`${v.grainCap} m³`} />
            <FieldRow
              label="Open port"
              value={
                <>
                  {v.openPort} <span style={{ color: "var(--asb-gray-500)" }}>· {v.openPortZone}</span>
                </>
              }
            />
            <FieldRow
              label="Open date"
              value={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {urgencyDot(v.openDateUrgency)} {v.openDate}
                </span>
              }
            />
            <FieldRow label="Gear" value={v.geared ? "Geared" : "Gearless"} />
          </div>

          <div style={{ background: "var(--asb-gray-50)", borderRadius: "var(--r-chip)", padding: "6px 10px", marginBottom: 8 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Fuel consumption</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "4px 8px" }}>
              <FieldRow label="M/E sea" value={fuelStr(v.fuel.vlsfoSea)} />
              <FieldRow label="M/E port" value={fuelStr(v.fuel.vlsfoPort)} />
              <FieldRow label="Aux sea" value={fuelStr(v.fuel.lsmgoSea)} />
              <FieldRow label="Aux port" value={fuelStr(v.fuel.lsmgoPort)} />
            </div>
          </div>
        </>
      )}

      <div className="row" style={{ paddingTop: 8, borderTop: "var(--bd)" }}>
        <span className="mono" style={{ fontSize: "var(--fs-body-sm)", color: "var(--asb-gray-500)" }}>{imo}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="asb-match">{v.matches} matches</span>
          <a style={{ fontSize: "var(--fs-body-sm)", color: "var(--asb-blue)", textDecoration: "none" }}>
            Estimate voyage →
          </a>
        </span>
      </div>
    </div>
  );
}
