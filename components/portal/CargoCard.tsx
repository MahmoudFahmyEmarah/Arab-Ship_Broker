"use client";

// CargoCard — ported from the Claude design (asb/cards.jsx) to TS.
// The 13-field minimum-display card. (Rules-engine hover tooltips and the
// market-partner tag from the original are deferred to a later phase; the
// visual structure and classes are otherwise identical.)
import * as React from "react";
import { CargoView } from "@/lib/portal/types";
import {
  cargoTypeLabel,
  cargoTypeBadgeVariant,
  cargoStripKey,
  formatQtyVol,
  formatLaycanRange,
  ldRateRender,
} from "@/lib/portal/format";
import { MarketPartnerTag } from "./MarketPartnerPanel";

function CCField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cc-field">
      <div className="cc-field__k">{label}</div>
      <div className="cc-field__v">{children}</div>
    </div>
  );
}

export function CargoCard({
  data,
  selected,
  onSelect,
  compact,
  limited,
}: {
  data: CargoView;
  selected?: boolean;
  onSelect?: (id: string) => void;
  compact?: boolean;
  limited?: boolean;
}) {
  const c = data;
  const stripClass = `strip-${cargoStripKey(c)}`;
  const { weight, volume, sfMissing } = formatQtyVol(c);
  const laycanStr = formatLaycanRange(c.laycanFrom, c.laycanTo);
  const isSpot = !!c.spot;
  const isOverdue = c.laycanDays != null && c.laycanDays < 0;
  const ld = ldRateRender(c);
  const isGroupA = c.imsbcGroup === "A";
  const isDG = c.imsbcGroup === "DG";
  const typeLabel = cargoTypeLabel(c);
  const typeVariant = cargoTypeBadgeVariant(typeLabel);
  const sfText = c.sf != null ? `${c.sf} ${c.volUnit ? `${c.volUnit}/t` : "m³/t"}` : "—";
  const sfDense = c.sf != null && c.sf < 0.5;
  const matches = c.matches || 0;

  return (
    <div
      className={`asb-card cargo-card ${stripClass} ${selected ? "is-selected" : ""} ${compact ? "is-compact" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(c.id);
      }}
    >
      <div className="cc-line1">
        <div className="cc-title">{c.cargo}</div>
        <span className={`cc-cat cc-cat--${typeVariant}`}>{typeLabel}</span>
      </div>

      <div className="cc-line2">
        <div className="cc-route-line">
          <span className="cc-ports">
            <span>{c.route.polCode}</span>
            <span className="cc-arrow"> → </span>
            <span>{c.route.podCode}</span>
          </span>
          <span className="cc-mid">·</span>
          <span className="cc-zones">
            <span>{c.route.polZone}</span>
            <span className="cc-arrow"> → </span>
            <span>{c.route.podZone}</span>
          </span>
        </div>
        {c.wog && <span className="cc-wog">WOG</span>}
      </div>

      <div className="cc-grid-wrap">
        <span className="cc-accent" aria-hidden />
        <div className="cc-grid">
          <CCField label="QTY / VOL">
            <div className="cc-qty">
              <span className="cc-qty__w">{weight}</span>
              <span
                className="cc-qty__v"
                style={{ color: sfMissing ? "#8B95A3" : "#185FA5" }}
              >
                {volume}
              </span>
            </div>
          </CCField>

          <CCField label="LAYCAN">
            {isSpot ? (
              <span className="cc-spot">SPOT</span>
            ) : (
              <span style={isOverdue ? { color: "#A32D2D" } : undefined}>
                {laycanStr}
              </span>
            )}
          </CCField>

          {!compact && (<>
          <CCField label="TERMS">
            <span>{c.loadTerms || "—"}</span>
          </CCField>

          <CCField label="SF">
            {c.sf != null ? (
              <span style={sfDense ? { color: "#854F0B" } : undefined}>
                {sfDense && <span style={{ marginRight: 3 }}>⚠</span>}
                {sfText}
              </span>
            ) : (
              <span className="cc-tbd">
                Not declared <span style={{ color: "#854F0B" }}>⚠</span>
              </span>
            )}
          </CCField>

          <CCField label="L/D RATE">
            {ld.kind === "value" && <span>{ld.text}</span>}
            {ld.kind === "badge" && (
              <span className="cc-cat cc-cat--dryish" style={{ fontSize: 9 }}>
                {ld.label}
              </span>
            )}
            {ld.kind === "tbd" && <span className="cc-tbd">Rate TBD</span>}
          </CCField>

          <CCField label="IMSBC">
            {isGroupA ? (
              <span style={{ color: "#854F0B", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span>⚠</span> Group A
              </span>
            ) : isDG ? (
              <span style={{ color: "#A32D2D", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span>⚠</span> DG
              </span>
            ) : (
              <span>Group {c.imsbcGroup || "—"}</span>
            )}
          </CCField>
          </>)}
          </div>
        </div>

      <div className="cc-footer">
        <div className="cc-foot-col cc-foot-col--freight">
          <div className="cc-freight">
            {limited ? (
              <span style={{ color: "var(--asb-gray-500)" }}>🔒 Subscriber</span>
            ) : (
              <>
                ${c.freightIdea ?? "—"}/MT
                {c.commission != null && <span> · {c.commission}% comm</span>}
              </>
            )}
          </div>
          <div className="cc-partner-slot">{!limited && <MarketPartnerTag slug={c.partnerSlug} />}</div>
        </div>

        <div className="cc-foot-col cc-foot-col--circ">
          <div className="cc-foot-label">Circ</div>
          <span
            className={`cc-circ-dot ${c.forCirculation ? "is-on" : "is-off"}`}
            title={c.forCirculation ? "In circulation" : "Not in circulation"}
          />
        </div>

        <div
          className="cc-foot-col cc-foot-col--match"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(c.id);
          }}
        >
          <div className="cc-foot-label">Match</div>
          <span className={`cc-match-circle ${limited || matches === 0 ? "is-zero" : ""}`}>
            {limited ? "🔒" : matches}
          </span>
        </div>
      </div>
    </div>
  );
}
