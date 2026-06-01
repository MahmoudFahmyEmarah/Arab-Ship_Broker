"use client";

// Shared Leaflet map — the single map surface used by every board (My Vessels
// fleet map, Tonnage/Cargo markets). Ported from the Claude Design map system
// (asb/map-shared.jsx + map.css): Carto Voyager (light) / Dark Matter (dark)
// base + OpenSeaMap seamark overlay, one zone palette, one persisted light/dark
// toggle, card-select reframes the map.
//
// Leaflet is imported dynamically inside the effect so this client component
// is SSR-safe (Leaflet touches `window` at module load). markercluster is not
// wired in this first cut (noted) — markers render individually.

import { useEffect, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind?: "vessel" | "cargo";
  zone?: string | null;
  scope?: "in" | "partial" | "out";
  sub?: string;
};

const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  seamark: "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors © CARTO",
};

// One zone→colour palette, identical on every map (codes + full names).
const ZONE_COLOR: Record<string, string> = {
  AG: "#534AB7", "Arabian Gulf": "#534AB7",
  "R.SEA": "#EF9F27", "Red Sea North": "#EF9F27", "Red Sea South": "#C76B12",
  "E.MED": "#185FA5", "East Med": "#185FA5",
  "B.SEA": "#2A9962", "Black Sea": "#2A9962",
  "A.SEA": "#1F8A8A", "Arabian Sea": "#1F8A8A",
  "W.MED": "#185FA5", "C.MED": "#185FA5", "NCONT": "#7A5BA6", "ECSA": "#2A9962",
  "F.EAST": "#C0497A", "ECI": "#C76B12", "WCAF": "#1F8A8A", "USG": "#3E7CB1",
};
const SCOPE_COLOR = { in: "#97C459", partial: "#EF9F27", out: "#E24B4A" };

function pointColor(p: MapPoint): string {
  if (p.scope) return SCOPE_COLOR[p.scope];
  if (p.zone && ZONE_COLOR[p.zone]) return ZONE_COLOR[p.zone];
  return "#7BB8F0";
}

export function SharedMap({
  points,
  selectedId,
  onSelect,
  base = "light",
  className,
}: {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  base?: "light" | "dark";
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const LRef = useRef<typeof LType | null>(null);
  const baseLayerRef = useRef<LType.TileLayer | null>(null);
  const markersRef = useRef<Map<string, LType.Marker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default as unknown as typeof LType;
      if (cancelled || !hostRef.current || mapRef.current) return;
      LRef.current = L;

      const map = L.map(hostRef.current, {
        center: [30, 20],
        zoom: 4,
        zoomControl: false,
        attributionControl: true,
        worldCopyJump: true,
      });
      mapRef.current = map;

      baseLayerRef.current = L.tileLayer(TILES[base], {
        attribution: TILES.attribution,
        subdomains: "abcd",
        maxZoom: 18,
      }).addTo(map);
      L.tileLayer(TILES.seamark, { maxZoom: 18, opacity: 0.6 }).addTo(map);

      renderMarkers(L, map);
      fitToPoints(L, map);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap base layer on light/dark toggle.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    baseLayerRef.current = L.tileLayer(TILES[base], {
      attribution: TILES.attribution,
      subdomains: "abcd",
      maxZoom: 18,
    }).addTo(map);
    baseLayerRef.current.bringToBack();
  }, [base]);

  // Re-render markers when points change.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    renderMarkers(L, map);
    fitToPoints(L, map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // Reframe + highlight on selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m, id) => {
      const el = m.getElement();
      if (el) el.classList.toggle("is-selected", id === selectedId);
    });
    if (selectedId) {
      const p = points.find((x) => x.id === selectedId);
      if (p) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 6), { duration: 0.6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function renderMarkers(L: typeof LType, map: LType.Map) {
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current.clear();
    for (const p of points) {
      if (p.lat == null || p.lon == null) continue;
      const color = pointColor(p);
      const shape =
        p.kind === "cargo"
          ? `<span class="asb-pin asb-pin--dot" style="--c:${color}"></span>`
          : `<span class="asb-pin asb-pin--tri" style="--c:${color}"></span>`;
      const icon = L.divIcon({
        className: "asb-pin-wrap",
        html: `${shape}<span class="asb-pin-lbl">${p.name}</span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([p.lat, p.lon], { icon, title: p.name }).addTo(map);
      marker.on("click", () => onSelectRef.current?.(p.id));
      if (p.id === selectedId) marker.getElement()?.classList.add("is-selected");
      markersRef.current.set(p.id, marker);
    }
  }

  function fitToPoints(L: typeof LType, map: LType.Map) {
    const coords = points
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => [p.lat, p.lon] as [number, number]);
    if (coords.length === 1) {
      map.setView(coords[0], 6);
    } else if (coords.length > 1) {
      map.fitBounds(L.latLngBounds(coords).pad(0.25), { maxZoom: 7 });
    }
  }

  function zoom(delta: number) {
    const map = mapRef.current;
    if (map) map.setZoom(map.getZoom() + delta);
  }

  return (
    <div className={`asb-map ${className ?? ""}`} data-base={base}>
      <div ref={hostRef} className="asb-map__host" />
      <div className="asb-map__zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)}>−</button>
      </div>
      {points.filter((p) => p.lat != null).length === 0 && (
        <div className="asb-map__empty">No positions with coordinates to plot</div>
      )}
    </div>
  );
}

// ── Shared light/dark base state (persisted + broadcast across maps) ──────
const BASE_KEY = "asb:mapBase";
const BASE_EVT = "asb-mapbase";

export function useMapBase(): ["light" | "dark", (b: "light" | "dark") => void] {
  const [base, setBaseState] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(BASE_KEY) as "light" | "dark" | null;
      if (stored) setBaseState(stored);
    } catch {}
    const h = (e: Event) => setBaseState((e as CustomEvent).detail as "light" | "dark");
    window.addEventListener(BASE_EVT, h);
    return () => window.removeEventListener(BASE_EVT, h);
  }, []);

  const setBase = (b: "light" | "dark") => {
    try { localStorage.setItem(BASE_KEY, b); } catch {}
    window.dispatchEvent(new CustomEvent(BASE_EVT, { detail: b }));
    setBaseState(b);
  };
  return [base, setBase];
}

export function MapBaseToggle({
  base,
  setBase,
}: {
  base: "light" | "dark";
  setBase: (b: "light" | "dark") => void;
}) {
  return (
    <div className="asb-basetgl" role="radiogroup" aria-label="Map base">
      <button
        type="button"
        role="radio"
        aria-checked={base === "light"}
        className={`asb-basetgl__b${base === "light" ? " is-on" : ""}`}
        onClick={() => setBase("light")}
      >
        Light
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={base === "dark"}
        className={`asb-basetgl__b${base === "dark" ? " is-on" : ""}`}
        onClick={() => setBase("dark")}
      >
        Dark
      </button>
    </div>
  );
}
