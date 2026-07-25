"use client";

// Broker Ledger — interactive trading-zone picker on a REAL map.
// Leaflet + the same CARTO Voyager tiles and coastline-following basin
// polygons as the dashboard market map (lib/portal/zone-shapes; colours and
// centroids from the canonical lib/zones registry). Hidden behind a toggle by
// default — the chip list below stays the compact, accessible path and both
// stay two-way synced. The visibility preference is remembered per browser.

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { ZONES, type ZoneCode } from "@/lib/zones";
import { ZONE_SHAPES } from "@/lib/portal/zone-shapes";
import { TRADING_ZONES } from "./defs";

const TILES = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  attribution: "© OpenStreetMap contributors © CARTO",
  subdomains: "abcd",
};

const OPEN_KEY = "asb.led.zonemap.open";
const SHAPE_BY_CODE = new Map(ZONE_SHAPES.map((s) => [s.code, s]));

export function ZoneMapPicker({
  value = [],
  onChange,
}: {
  /** Selected zone display labels (same values the chip list uses). */
  value?: string[];
  onChange: (labels: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layersRef = useRef<Map<ZoneCode, Leaflet.Path>>(new Map());
  // Latest selection for click handlers created once at map init.
  const valueRef = useRef(value);
  valueRef.current = value;

  const selectedCodes = useMemo(
    () => new Set(value.map((label) => TRADING_ZONES.find((z) => z.label === label)?.code).filter(Boolean) as ZoneCode[]),
    [value],
  );

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* default hidden */
    }
  }, []);

  const toggleOpen = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };

  // Build / destroy the Leaflet map with the panel.
  useEffect(() => {
    if (!open || !mapEl.current || mapRef.current) return;
    const layers = layersRef.current;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css" as string);
      if (cancelled || !mapEl.current) return;

      const map = L.map(mapEl.current, {
        zoomControl: true,
        scrollWheelZoom: false, // don't hijack the form's page scroll
        attributionControl: true,
        minZoom: 2,
        maxZoom: 7,
      });
      L.tileLayer(TILES.url, { attribution: TILES.attribution, subdomains: TILES.subdomains, maxZoom: 18 }).addTo(map);

      const toggleZone = (label: string) => {
        const cur = valueRef.current;
        onChange(cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]);
      };

      const bounds = L.latLngBounds([]);

      // Ghost backdrop: the combined Red Sea basin behind its N/S markers.
      const rsea = SHAPE_BY_CODE.get("R.SEA");
      if (rsea) {
        L.polygon(rsea.poly, {
          color: rsea.color,
          weight: 1,
          dashArray: "4 5",
          opacity: 0.35,
          fillColor: rsea.color,
          fillOpacity: 0.06,
          interactive: false,
        }).addTo(map);
      }

      for (const { label, code } of TRADING_ZONES) {
        const shape = SHAPE_BY_CODE.get(code);
        const meta = ZONES[code];
        if (shape) {
          const poly = L.polygon(shape.poly, {
            color: shape.color,
            weight: 1.4,
            opacity: 0.55,
            fillColor: shape.color,
            fillOpacity: 0.16,
          })
            .addTo(map)
            .on("click", () => toggleZone(label));
          poly.bindTooltip(label, { sticky: true, className: "pp2-zonemap__tt" });
          layersRef.current.set(code, poly);
          bounds.extend(poly.getBounds());
        } else if (meta?.centroid) {
          const marker = L.circleMarker(meta.centroid, {
            radius: 8,
            color: meta.color,
            weight: 1.6,
            opacity: 0.8,
            fillColor: meta.color,
            fillOpacity: 0.4,
          })
            .addTo(map)
            .on("click", () => toggleZone(label));
          marker.bindTooltip(meta.short, {
            permanent: true,
            direction: "top",
            offset: L.point(0, -6),
            className: "pp2-zonemap__lbl",
          });
          layersRef.current.set(code, marker);
          bounds.extend(meta.centroid);
        }
      }

      map.fitBounds(bounds.pad(0.06));
      mapRef.current = map;
      // Reflect the current selection immediately.
      applySelection();
    })();
    return () => {
      cancelled = true;
      layers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Restyle layers whenever the selection changes.
  const applySelection = () => {
    for (const [code, layer] of layersRef.current) {
      const on = selectedCodes.has(code);
      const isMarker = "setRadius" in layer;
      layer.setStyle({
        fillOpacity: on ? (isMarker ? 0.9 : 0.45) : isMarker ? 0.4 : 0.16,
        opacity: on ? 1 : isMarker ? 0.8 : 0.55,
        weight: on ? (isMarker ? 2.4 : 2.4) : isMarker ? 1.6 : 1.4,
      });
      if (isMarker) (layer as Leaflet.CircleMarker).setRadius(on ? 10 : 8);
    }
  };
  useEffect(applySelection, [selectedCodes]);

  return (
    <div className="pp2-zonemap">
      <div className="pp2-zonemap__bar">
        <span className="pp2-zonemap__sel">{value.length ? value.join(" · ") : "No trading zones picked yet."}</span>
        <button type="button" className="pp2-vcard__change" onClick={toggleOpen}>
          {open ? "Hide map" : "Pick on map"}
        </button>
      </div>
      {open ? <div ref={mapEl} className="pp2-zonemap__map" role="application" aria-label="Trading zones map" /> : null}
    </div>
  );
}
