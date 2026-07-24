"use client";

// Post Vessel — Review step. Blocks the post when a named vessel exceeds the
// 66,000 DWT niche gate. Ported from reference/handoff/asb/pp2-steps.jsx.

import * as React from "react";
import type { StepCtx } from "../../types";
import type { VesselState } from "../state";
import { InlineNote, fmt } from "../../fields";
import { StatusBadge } from "../../ds";
import { SIZE_GATE_DWT as GATE } from "../../defs";
import { vesselComplete } from "./VesselStep";
import { arrComplete } from "./ArrangementStep";
import { avComplete } from "./AvailabilityStep";
import { gearComplete } from "./GearStep";

function ReviewRow({ label, value, alert }: { label: string; value?: string | null; alert?: boolean }) {
  return (
    <div className="pp2-rev__row">
      <span className="pp2-rev__k">{label}</span>
      <span className={"pp2-rev__v" + (alert ? " is-alert" : "")}>{value || "-"}</span>
    </div>
  );
}

export function ReviewStep({ state }: StepCtx<VesselState>) {
  const v = state.vessel;
  const a = state.availability || {};
  const arr = state.arrangement || {};
  const p = state.performance || {};
  const g = state.gear || {};
  const isTBN = state.entryMode === "tbn";
  const dwt = Number(isTBN ? state.tbn?.dwt : v?.dwt) || 0;
  const over = dwt > GATE;
  const yn = (x: string | null | undefined) => (x === "Y" ? "Yes" : x === "N" ? "No" : "-");
  return (
    <div className="pp2-rev">
      {!isTBN && v && !v.verified && (
        <InlineNote style={{ marginTop: 0 }}>
          This position will post immediately, flagged <strong>Unverified</strong> until Arab ShipBroker confirms the vessel record.
        </InlineNote>
      )}
      {over && (
        <InlineNote tone="alert" style={{ marginTop: isTBN ? 0 : 12 }}>
          DWT is over the {fmt(GATE)} niche gate, this position cannot be posted.
        </InlineNote>
      )}

      <div className="pp2-rev__card">
        <div className="pp2-rev__head">
          {isTBN ? "TBN" : v?.name}
          {!isTBN && v && <StatusBadge status={v.verified ? "in" : "review"}>{v.verified ? "Verified" : "Unverified"}</StatusBadge>}
        </div>
        <div className="pp2-rev__grid">
          {isTBN ? (
            <>
              <ReviewRow label="Type" value={state.tbn?.type} />
              <ReviewRow label="DWT" value={fmt(state.tbn?.dwt) + " MT"} alert={over} />
              <ReviewRow label="Flag" value={state.tbn?.flag} />
              <ReviewRow label="LOA / Beam" value={state.tbn?.loa ? state.tbn.loa + " m" + (state.tbn.beam ? " / " + state.tbn.beam + " m" : "") : null} />
              <ReviewRow label="Built" value={state.tbn?.built} />
              <ReviewRow label="Class" value={state.tbn?.classSociety} />
            </>
          ) : (
            <>
              <ReviewRow label="IMO" value={v?.imo} />
              <ReviewRow label="DWT" value={fmt(dwt) + " MT"} alert={over} />
              <ReviewRow label="Type" value={v?.type} />
              <ReviewRow label="Flag" value={v?.flag} />
            </>
          )}
        </div>
      </div>

      <div className="pp2-rev__card">
        <div className="pp2-rev__sub">Cargo Arrangement</div>
        <div className="pp2-rev__grid">
          <ReviewRow label="Configuration" value={arr.config} />
          <ReviewRow label="Holds / Hatches" value={(arr.numHolds || "-") + "H / " + (arr.numHatches || arr.numHolds || "-") + "Ha"} />
          <ReviewRow label="Box-Shaped" value={yn(arr.boxShaped)} />
          <ReviewRow label="Hatch Type" value={arr.hatchType} />
          <ReviewRow label="Heavy-Strengthened" value={yn(arr.strengthenedHeavy)} />
          <ReviewRow label="Log-Fitted" value={yn(arr.logFitted)} />
        </div>
      </div>

      <div className="pp2-rev__card">
        <div className="pp2-rev__sub">Availability</div>
        <div className="pp2-rev__grid">
          <ReviewRow label="Status" value={a.status} />
          <ReviewRow label="Open Port" value={a.openPort ? a.openPort.name + " (" + a.openPort.locode + ")" : null} />
          <ReviewRow label="Open From" value={a.openFrom || null} />
          <ReviewRow label="Zone" value={a.openPort?.zoneName} />
          <ReviewRow label="Charter" value={a.charterType} />
          <ReviewRow label="Terms" value={a.wog ? "WOG" : "Firm"} />
        </div>
        {a.zones && a.zones.length > 0 && (
          <div className="pp2-rev__chips">
            {a.zones.map((z) => (
              <span className="pp2-arr-chip" key={z}>
                {z}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pp2-rev__card">
        <div className="pp2-rev__sub">Performance &amp; Gear</div>
        <div className="pp2-rev__grid">
          <ReviewRow label="Service Speed" value={p.serviceSpeed ? p.serviceSpeed + " kn" : null} />
          <ReviewRow label="ME At Sea" value={p.meConsSea ? p.meConsSea + " MT/d " + (p.fuelType || "") : null} />
          <ReviewRow label="Bunkers ROB" value={p.brob ? p.brob + " MT" : null} />
          <ReviewRow
            label="Gear"
            value={g.geared == null ? null : g.geared ? (g.craneCount || "") + "× " + (g.craneSwl || "") + " MT" + (g.grabs ? " + grabs" : "") : "Gearless"}
          />
        </div>
      </div>
    </div>
  );
}

export function revComplete(s: VesselState): boolean {
  // The whole form must be sound; the size gate holds for TBN too (its DWT is
  // gated in vesselComplete). Server enforces the same cap in the RPC.
  if (!vesselComplete(s) || !arrComplete(s) || !avComplete(s) || !gearComplete(s)) return false;
  const dwt = Number(s.entryMode === "tbn" ? s.tbn?.dwt : s.vessel?.dwt) || 0;
  return dwt > 0 && dwt <= GATE;
}
