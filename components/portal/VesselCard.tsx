"use client";

// VesselCard — ported from the Claude design (asb/cards.jsx) to TS.
// (Rules-engine tooltips + voyage deep-link deferred; structure/classes intact.)
import * as React from "react";
import { VesselView, CargoView } from "@/lib/portal/types";
import { MatchesPopover } from "./MatchesPopover";
import { postedAgeLabel } from "@/lib/portal/useMarketVisibility";
import { flagCode } from "@/lib/portal/flags";
import "flag-icons/css/flag-icons.min.css";
import { FieldRow, urgencyDot } from "./ui";
import { PosterLine } from "./PosterLine";

export function VesselCard({
  data,
  selected,
  onSelect,
  compact,
  masked,
  matchPool,
  onFocusMatch,
}: {
  data: VesselView;
  selected?: boolean;
  onSelect?: (id: string) => void;
  compact?: boolean;
  masked?: boolean;
  /** live cargoes this vessel can match against — enables the matches popup on the badge */
  matchPool?: CargoView[];
  /** called with the matched cargo's id when the user picks one in the popup */
  onFocusMatch?: (cargoId: string) => void;
}) {
  const v = data;
  const [matchesOpen, setMatchesOpen] = React.useState(false);
  const canPop = !masked && (v.matches || 0) > 0 && !!matchPool;
  const stripClass = `strip-${v.status}`;
  // Status header strip (Option C) — reuse the app's existing status labels.
  const STATUS_MAP: Record<string, [string, string]> = {
    open: ["open", "OPEN"],
    review: ["review", "REVIEW"],
    fixed: ["fixed", "FIXED"],
    in: ["in", "ACTIVE"],
    partial: ["partial", "PARTIAL"],
  };
  const [sbCls, sbLabel] = STATUS_MAP[v.status] || ["neutral", (v.status || "").toUpperCase()];
  const fuelStr = (n: number | string) => (n !== "—" ? `${n} MT/d` : "—");
  const name = masked ? "Vessel identity — Tier 3+" : v.name;
  const imo = masked ? "IMO ••••" : v.imo;

  return (
    <div
      className={`asb-card vessel-card ${stripClass} ${selected ? "is-selected" : ""} ${compact ? "is-compact" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(v.id);
      }}
    >
      <div className={`vessel-card__statusbar sb-${sbCls}`}>
        <span className="vc-dot" />
        {sbLabel}
      </div>
      <div className="vessel-card__body">
      <div className="row" style={{ marginBottom: 6, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1B3A5C", lineHeight: 1.25 }}>
            {name}
          </div>
          <div style={{ fontSize: "var(--fs-body-sm)", color: "var(--asb-gray-500)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {/* Built year lives in the "Built / age" field row of the full
                card — the meta line keeps just identity: IMO, flag, type. */}
            <span className="mono">{imo}</span> · {flagCode(v.flag) && <><span className={`fi fi-${flagCode(v.flag)}`} style={{ fontSize: 11, borderRadius: 2, marginRight: 4, boxShadow: "0 0 0 0.5px rgba(13,37,69,.18)" }} aria-hidden /></>}{v.flag} · {v.type}
            {postedAgeLabel(v.postedAt) ? <> · <span title={postedAgeLabel(v.postedAt) === "<1d" ? "Posted today" : `Posted ${postedAgeLabel(v.postedAt)?.replace("d", " day(s)")} ago`}>{postedAgeLabel(v.postedAt)} ago</span></> : null}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: compact ? 0 : 8 }}>
        <FieldRow label="DWT" value={`${v.dwt} MT`} valueClass="blue" />
        {!compact && <FieldRow label="Built / age" value={v.built ? `${v.built} (${v.age} yrs)` : "—"} />}
        {!compact && <FieldRow label="Grain cap" value={`${v.grainCap} m³`} />}
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

      {!compact && (
        <div style={{ background: "var(--asb-gray-50)", borderRadius: "var(--r-chip)", padding: "6px 10px", marginBottom: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Fuel consumption</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "4px 8px" }}>
            <FieldRow label="M/E sea" value={fuelStr(v.fuel.vlsfoSea)} />
            <FieldRow label="M/E port" value={fuelStr(v.fuel.vlsfoPort)} />
            <FieldRow label="Aux sea" value={fuelStr(v.fuel.lsmgoSea)} />
            <FieldRow label="Aux port" value={fuelStr(v.fuel.lsmgoPort)} />
          </div>
        </div>
      )}

      <PosterLine poster={v.poster} />

      <div className="row" style={{ paddingTop: 8, borderTop: "var(--bd)" }}>
        <span className="mono" style={{ fontSize: "var(--fs-body-sm)", color: "var(--asb-gray-500)" }}>{imo}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {canPop ? (
            <button type="button" className="asb-match is-btn"
              title={`${v.matches} matching ${v.matches === 1 ? "cargo" : "cargoes"} — click to see ${v.matches === 1 ? "it" : "them"}`}
              onClick={(e) => { e.stopPropagation(); setMatchesOpen(true); }}>
              {v.matches} matches
            </button>
          ) : (
            <span className="asb-match" title={masked ? "Matches are a Subscriber feature" : v.matches === 0 ? "No matching cargoes on the market right now" : undefined}>{v.matches} matches</span>
          )}
          <a style={{ fontSize: "var(--fs-body-sm)", color: "var(--asb-blue)", textDecoration: "none" }}>
            Estimate voyage →
          </a>
        </span>
      </div>
      </div>
      {matchesOpen && (
        <MatchesPopover source={{ kind: "vessel", view: v }} pool={matchPool ?? []} count={v.matches}
          onClose={() => setMatchesOpen(false)} onFocus={(id) => onFocusMatch?.(id)} />
      )}
    </div>
  );
}
