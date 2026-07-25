"use client";

// Broker Ledger — interactive trading-zone map picker.
// Renders the SAME coastline-following zone polygons the dashboard market map
// uses (lib/portal/zone-shapes, colours/centroids from the canonical
// lib/zones registry) as a lightweight inline SVG — no Leaflet in the form.
// Click a basin (or a marker for zones without a drawn polygon) to toggle it;
// fully two-way synced with the chip list, which stays the accessible path.

import * as React from "react";
import { useMemo, useState } from "react";
import { ZONES, type ZoneCode } from "@/lib/zones";
import { ZONE_SHAPES } from "@/lib/portal/zone-shapes";
import { TRADING_ZONES } from "./defs";

// Viewport spans every selectable zone: Caribbean (−92°) → Far East (128°),
// ECSA (−38°) → Baltic/Continent (63°). Equirectangular.
const LON_MIN = -95;
const LON_MAX = 132;
const LAT_MIN = -42;
const LAT_MAX = 64;
const W = 940;
const H = ((LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN)) * W * 1.18; // slight vertical stretch for legibility

const px = (lon: number) => ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W;
const py = (lat: number) => ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
const toPoints = (poly: [number, number][]) => poly.map(([lat, lon]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join(" ");

const SHAPE_BY_CODE = new Map(ZONE_SHAPES.map((s) => [s.code, s]));

export function ZoneMapPicker({
  value = [],
  onChange,
}: {
  /** Selected zone display labels (same values the chip list uses). */
  value?: string[];
  onChange: (labels: string[]) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const selectedCodes = useMemo(
    () => new Set(value.map((label) => TRADING_ZONES.find((z) => z.label === label)?.code).filter(Boolean) as ZoneCode[]),
    [value],
  );
  const toggle = (label: string) => onChange(value.includes(label) ? value.filter((x) => x !== label) : [...value, label]);

  return (
    <div className="pp2-zonemap" role="group" aria-label="Trading zones map">
      <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} preserveAspectRatio="xMidYMid meet">
        {/* graticule */}
        {Array.from({ length: 8 }, (_, i) => LON_MIN + ((i + 1) * (LON_MAX - LON_MIN)) / 9).map((lon) => (
          <line key={"v" + lon} x1={px(lon)} y1={0} x2={px(lon)} y2={H} className="pp2-zonemap__grid" />
        ))}
        {Array.from({ length: 4 }, (_, i) => LAT_MIN + ((i + 1) * (LAT_MAX - LAT_MIN)) / 5).map((lat) => (
          <line key={"h" + lat} x1={0} y1={py(lat)} x2={W} y2={py(lat)} className="pp2-zonemap__grid" />
        ))}
        {/* equator hint */}
        <line x1={0} y1={py(0)} x2={W} y2={py(0)} className="pp2-zonemap__grid pp2-zonemap__grid--eq" />

        {/* basin polygons (selectable when part of the trading-zone list) */}
        {TRADING_ZONES.map(({ label, code }) => {
          const shape = SHAPE_BY_CODE.get(code);
          if (!shape) return null;
          const on = selectedCodes.has(code);
          return (
            <polygon
              key={code}
              points={toPoints(shape.poly)}
              className={"pp2-zonemap__poly" + (on ? " is-on" : "") + (hover === label ? " is-hover" : "")}
              style={{ fill: shape.color, stroke: shape.color }}
              onClick={() => toggle(label)}
              onMouseEnter={() => setHover(label)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{label}</title>
            </polygon>
          );
        })}

        {/* Red Sea North/South share the drawn R.SEA basin as a backdrop */}
        {(() => {
          const rsea = SHAPE_BY_CODE.get("R.SEA");
          if (!rsea) return null;
          return <polygon points={toPoints(rsea.poly)} className="pp2-zonemap__poly pp2-zonemap__poly--ghost" style={{ fill: rsea.color, stroke: rsea.color }} />;
        })()}

        {/* marker dots for zones without a drawn polygon (incl. Red Sea N/S) */}
        {TRADING_ZONES.map(({ label, code }) => {
          if (SHAPE_BY_CODE.has(code)) return null;
          const meta = ZONES[code];
          if (!meta?.centroid) return null;
          const [lat, lon] = meta.centroid;
          const on = selectedCodes.has(code);
          return (
            <g
              key={code}
              className={"pp2-zonemap__dotg" + (on ? " is-on" : "") + (hover === label ? " is-hover" : "")}
              onClick={() => toggle(label)}
              onMouseEnter={() => setHover(label)}
              onMouseLeave={() => setHover(null)}
            >
              <circle cx={px(lon)} cy={py(lat)} r={13} className="pp2-zonemap__dothit" />
              <circle cx={px(lon)} cy={py(lat)} r={on ? 8 : 6} className="pp2-zonemap__dot" style={{ fill: meta.color, stroke: meta.color }} />
              <text x={px(lon)} y={py(lat) - 12} className="pp2-zonemap__dotlbl">
                {meta.short}
              </text>
              <title>{label}</title>
            </g>
          );
        })}

        {/* labels for drawn basins */}
        {TRADING_ZONES.map(({ label, code }) => {
          const shape = SHAPE_BY_CODE.get(code);
          if (!shape) return null;
          const [lat, lon] = shape.labelAt;
          return (
            <text key={"l" + code} x={px(lon)} y={py(lat)} className={"pp2-zonemap__lbl" + (selectedCodes.has(code) ? " is-on" : "")}>
              {ZONES[code].short}
            </text>
          );
        })}
      </svg>
      <div className="pp2-zonemap__hint">{hover ?? (value.length ? value.join(" · ") : "Click a basin or marker to toggle a zone — same zones as the market map.")}</div>
    </div>
  );
}
