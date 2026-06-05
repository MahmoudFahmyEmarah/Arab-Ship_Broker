"use client";

// MarketMap — Leaflet market map, ported from the Claude design (asb/map.jsx +
// asb/map-shared.jsx) to TS. Loaded client-only via next/dynamic(ssr:false).
// Zones, zoom-aware cargo markers, vessel triangles, clustering, custom popup,
// focus sync, layer + base controls. (The Voy-OPEX side panel is deferred to
// the voyage-estimator phase.)
import * as React from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "@/lib/portal/map.css";
import { CargoView, VesselView } from "@/lib/portal/types";
import { FALLBACK_PORTS } from "@/lib/portal/port-coords";
import { MapFilterPanel } from "./MapFilterPanel";
import { CARGO_FACETS, VESSEL_FACETS, passesFacets, type Selections } from "@/lib/portal/map-filters";
import { VoyOpexPanel } from "./VoyOpexPanel";
import { useViewerTier } from "@/lib/portal/tier";
import { routeGeometry } from "@/lib/portal/routeGeometry";

const ZONE_COLOR: Record<string, string> = {
  AG: "#534AB7",
  "R.SEA": "#EF9F27",
  "E.MED": "#185FA5",
  "B.SEA": "#2A9962",
  "A.SEA": "#1F8A8A",
  "E.AFR": "#7A5BA6",
};
const ZONES: Record<string, { bounds: [[number, number], [number, number]]; color: string }> = {
  "B.SEA": { bounds: [[40.5, 27], [47, 42]], color: ZONE_COLOR["B.SEA"] },
  "E.MED": { bounds: [[30, 22], [37, 37]], color: ZONE_COLOR["E.MED"] },
  "R.SEA": { bounds: [[12, 32.5], [30, 44]], color: ZONE_COLOR["R.SEA"] },
  AG: { bounds: [[23, 48], [30, 58]], color: ZONE_COLOR["AG"] },
};

const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: "© OpenStreetMap contributors © CARTO",
  subdomains: "abcd",
};

// ── Marker helpers ─────────────────────────────────────────────────────────
const SCOPE_COLOR: Record<string, string> = { in: "#97C459", partial: "#EF9F27", out: "#E24B4A" };

function cargoStripColor(c: CargoView): "in" | "partial" | "out" {
  const d = c.laycanDays;
  if (d != null && d < 3) return "out";
  if (c.scope === "out") return "out";
  if (c.scope === "partial") return "partial";
  if (d != null && d <= 7) return "partial";
  return "in";
}
function shortCargoName(c: CargoView): string {
  const src = c.commodity || c.cargo || "";
  return src.replace(/\s*\(.+?\)\s*/g, "").trim() || src;
}
function vesselSize(v: VesselView): { w: number; h: number } {
  const dwt = parseInt(String(v.dwt || "").replace(/[,\s]/g, ""), 10) || 0;
  if (dwt < 5000) return { w: 10, h: 17 };
  if (dwt < 35000) return { w: 12, h: 20 };
  if (dwt < 55000) return { w: 14, h: 24 };
  return { w: 16, h: 28 };
}
function vesselColor(v: VesselView): string {
  if (v.status === "open") return "#97C459";
  if (v.status === "review") return "#EF9F27";
  if (v.openDateUrgency === "red" || (v.openDateDays != null && v.openDateDays < 0)) return "#E24B4A";
  if (v.status === "fixed") return "rgba(255,255,255,0.30)";
  return "#97C459";
}
function vesselCourse(v: VesselView): number {
  const id = String(v.id || v.name || "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}
function cargoThumbIcon(): string {
  // small inline "stack" glyph (replaces the tabler webfont in the design)
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`;
}
function hoverTip(c: CargoView): string {
  const route = c.route ? `${c.route.polCode} → ${c.route.podCode}` : "";
  return `<div class="cargo-hover-tip">${shortCargoName(c)} · ${c.qtyMt} MT · ${route}</div>`;
}

// Cargo regime → one of three families, each with a distinct map glyph + shape
// (color stays the laycan-urgency scope; shape/glyph encodes the commodity
// regime). Grain (dry-bulk grain), IMSBC (dry-bulk non-grain), Break-bulk.
type CargoRegime = "grain" | "imsbc" | "breakbulk";
function cargoRegime(c: CargoView): CargoRegime {
  if (c.type === "Break Bulk") return "breakbulk";
  if (c.isGrain) return "grain";
  return "imsbc";
}
function regimeGlyph(regime: CargoRegime): string {
  const s = `width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  if (regime === "grain") {
    // wheat ear
    return `<svg ${s}><path d="M12 22V8"/><path d="M12 8c0-2 1.6-3.5 3.5-3.5C15.5 6.5 14 8 12 8Z"/><path d="M12 8c0-2-1.6-3.5-3.5-3.5C8.5 6.5 10 8 12 8Z"/><path d="M12 13c0-2 1.6-3.5 3.5-3.5C15.5 11.5 14 13 12 13Z"/><path d="M12 13c0-2-1.6-3.5-3.5-3.5C8.5 11.5 10 13 12 13Z"/></svg>`;
  }
  if (regime === "breakbulk") {
    // crate / box
    return `<svg ${s}><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18"/></svg>`;
  }
  // IMSBC dry bulk — layered stack
  return `<svg ${s}><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`;
}

type CargoState = "dot" | "pill" | "thumb";
function cargoStateForZoom(z: number): CargoState {
  if (z <= 6) return "dot";
  if (z <= 8) return "pill";
  return "thumb";
}
// SCAMIN / compilation-scale tier — drives scale-dependent decluttering in CSS
// (which labels/feature detail are allowed to display at the current scale).
function zoomTier(z: number): "far" | "mid" | "near" {
  if (z <= 6) return "far";
  if (z <= 8) return "mid";
  return "near";
}
function cargoIcon(c: CargoView, state: CargoState, selected: boolean) {
  const scope = cargoStripColor(c);
  const sel = selected ? " is-selected" : "";
  const regime = cargoRegime(c);
  const rg = ` rg-${regime}`;
  if (state === "dot") {
    // shape encodes regime (circle / square / diamond), colour encodes urgency.
    return {
      html: `<div class="cargo-marker-wrap cargo-dot-marker${rg}${sel}" data-scope="${scope}" data-regime="${regime}">${hoverTip(c)}</div>`,
      size: [12, 12] as [number, number],
      anchor: [6, 6] as [number, number],
    };
  }
  if (state === "pill") {
    return {
      html: `<div class="cargo-marker-wrap cargo-pill-marker${rg}${sel}" data-scope="${scope}" data-regime="${regime}" style="border-left-color:${SCOPE_COLOR[scope]}"><span class="pill-glyph" style="color:${SCOPE_COLOR[scope]}">${regimeGlyph(regime)}</span><span class="pill-name">${shortCargoName(c)}</span>${hoverTip(c)}</div>`,
      size: [88, 16] as [number, number],
      anchor: [44, 8] as [number, number],
    };
  }
  const wog = c.wog ? '<span class="wog-dot"></span>' : "";
  return {
    html: `<div class="cargo-marker-wrap cargo-thumb-marker${rg}${sel}" data-scope="${scope}" data-regime="${regime}" style="border-left-color:${SCOPE_COLOR[scope]}">${regimeGlyph(regime)}<span>${shortCargoName(c)}</span>${wog}${hoverTip(c)}</div>`,
    size: [44, 30] as [number, number],
    anchor: [22, 30] as [number, number],
  };
}
function vesselTriangleHTML(v: VesselView, selected: boolean, dim = false): string {
  const { w, h } = vesselSize(v);
  const colour = vesselColor(v);
  const course = vesselCourse(v);
  return `<div class="vessel-tri-wrap${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}" style="width:${Math.max(w, 28)}px;height:${Math.max(h, 28)}px;"><div class="v-tri" style="border-left:${w / 2}px solid transparent;border-right:${w / 2}px solid transparent;border-bottom:${h}px solid ${colour};filter:drop-shadow(0 0 3px ${colour}80);transform:rotate(${course}deg);"></div><div class="v-label">${v.name}</div></div>`;
}

// ── Dashboard click-to-pair (firewall-safe: qualitative LABEL, never a raw
//    score or TCE number; no counterparty contact anywhere) ──────────────────
function dwtNum(v: VesselView): number {
  return parseInt(String(v.dwt || "").replace(/[,\s]/g, ""), 10) || 0;
}
function cargoQtyMax(c: CargoView): number {
  if (c.qty?.max != null) return c.qty.max;
  return parseInt(String(c.qtyMt || "").replace(/[^\d]/g, ""), 10) || 0;
}
function pairEligible(c: CargoView, v: VesselView): boolean {
  const z = v.openPortZone;
  const zoneOk = !!z && (z === c.route.polZone || z === c.route.podZone);
  const dwt = dwtNum(v);
  const q = cargoQtyMax(c);
  const dwtOk = dwt > 0 && q > 0 && dwt >= q * 0.8 && dwt <= q * 1.2;
  const grainOk = !c.isGrain || v.grainCertified === true; // grain hard-block
  const dgOk = !c.isDg || v.dgCertified === true; // DG hard-block
  return zoneOk && dwtOk && grainOk && dgOk;
}
type FitBand = "Strong" | "Good" | "Possible" | "Weak";
function fitLabel(c: CargoView, v: VesselView): FitBand {
  if (c.isGrain && !v.grainCertified) return "Weak";
  if (c.isDg && !v.dgCertified) return "Weak";
  const dwt = dwtNum(v);
  const q = cargoQtyMax(c);
  const util = dwt > 0 ? q / dwt : 0;
  let s = 0;
  if (util >= 0.9 && util <= 1.0) s += 2;
  else if (util >= 0.8 && util <= 1.1) s += 1;
  const z = v.openPortZone;
  if (z === c.route.polZone) s += 2;
  else if (z === c.route.podZone) s += 1;
  if (!c.requiresGeared || v.geared) s += 1;
  return s >= 4 ? "Strong" : s >= 3 ? "Good" : s >= 1 ? "Possible" : "Weak";
}

// ── Persisted light/dark base ──────────────────────────────────────────────
function useMapBase(): ["light" | "dark", (b: "light" | "dark") => void] {
  const [base, setBase] = React.useState<"light" | "dark">("dark");
  React.useEffect(() => {
    try {
      const v = localStorage.getItem("asb:mapBase");
      if (v === "light" || v === "dark") setBase(v);
    } catch {}
  }, []);
  const set = (b: "light" | "dark") => {
    setBase(b);
    try {
      localStorage.setItem("asb:mapBase", b);
    } catch {}
  };
  return [base, set];
}

// Minimal inline glyphs for the control bar (no icon-font dependency).
const G = {
  cargo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></svg>,
  vessel: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4 L20 19 H4 Z" /></svg>,
  zones: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><polygon points="3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20" /></svg>,
  sun: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></svg>,
  moon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  minus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>,
  maximize: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>,
  minimize: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M16 21v-3a2 2 0 0 1 2-2h3M8 21v-3a2 2 0 0 0-2-2H3" /></svg>,
  filter: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>,
  voy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h8M8 14h3M8 18h3M15 14v4" /></svg>,
  lock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
};

type Popup =
  | { kind: "cargo"; data: CargoView; ll: L.LatLng }
  | { kind: "vessel"; data: VesselView; ll: L.LatLng };

export default function MarketMap({
  cargos,
  vessels,
  focusedCargoId,
  focusedVesselId,
  onSelectCargo,
  onSelectVessel,
  portCoords,
}: {
  cargos: CargoView[];
  vessels: VesselView[];
  focusedCargoId?: string | null;
  focusedVesselId?: string | null;
  onSelectCargo?: (c: CargoView) => void;
  onSelectVessel?: (v: VesselView) => void;
  // Live locode → [lat, lon] from the ports table; falls back to FALLBACK_PORTS.
  portCoords?: Record<string, [number, number]>;
}) {
  const coordFor = React.useCallback(
    (locode?: string | null): [number, number] | null => {
      if (!locode) return null;
      const key = locode.trim().toUpperCase().replace(/\s+/g, "");
      return portCoords?.[locode] ?? portCoords?.[key] ?? FALLBACK_PORTS[key] ?? null;
    },
    [portCoords],
  );

  const hostRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const clusterRef = React.useRef<L.MarkerClusterGroup | null>(null);
  const zonesRef = React.useRef<L.LayerGroup | null>(null);
  const routeRef = React.useRef<L.LayerGroup | null>(null);
  const baseRef = React.useRef<L.TileLayer | null>(null);
  const cargoMk = React.useRef<Record<string, L.Marker>>({});
  const roRef = React.useRef<ResizeObserver | null>(null);

  const [ready, setReady] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [voyOpen, setVoyOpen] = React.useState(false);
  const tier = useViewerTier();
  const voyLocked = tier === "T1" || tier === "T2";
  const [selections, setSelections] = React.useState<Selections>({});
  const [qtyMin, setQtyMin] = React.useState<number | "">("");
  const [qtyMax, setQtyMax] = React.useState<number | "">("");
  // Click-to-pair (dashboard = both sides present): anchor cargo + picked vessel.
  const [pairCargo, setPairCargo] = React.useState<CargoView | null>(null);
  const [pairVessel, setPairVessel] = React.useState<VesselView | null>(null);
  const isDashboard = cargos.length > 0 && vessels.length > 0;
  const [cargoOn, setCargoOn] = React.useState(true);
  const [vesselsOn, setVesselsOn] = React.useState(true);
  const [zonesOn, setZonesOn] = React.useState(true);
  const [base, setBase] = useMapBase();
  const [popup, setPopup] = React.useState<Popup | null>(null);

  // Filter facets drive real marker visibility (§2b shared facet model).
  const visCargos = React.useMemo(
    () =>
      cargos.filter((c) => {
        if (!passesFacets(c, CARGO_FACETS, selections)) return false;
        const q = cargoQtyMax(c);
        if (qtyMin !== "" && q < qtyMin) return false;
        if (qtyMax !== "" && q > qtyMax) return false;
        return true;
      }),
    [cargos, selections, qtyMin, qtyMax],
  );
  const visVessels = React.useMemo(
    () => vessels.filter((v) => passesFacets(v, VESSEL_FACETS, selections)),
    [vessels, selections],
  );
  const toggleOption = React.useCallback((facetId: string, value: string) => {
    setSelections((prev) => {
      const set = new Set(prev[facetId] ?? []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [facetId]: set };
    });
  }, []);
  const [, force] = React.useReducer((x) => x + 1, 0);

  // Init once
  React.useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      center: [24, 40],
      zoom: 4,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      worldCopyJump: false,
    });
    map.attributionControl.setPrefix(false);
    routeRef.current = L.layerGroup().addTo(map);
    zonesRef.current = L.layerGroup();
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 38,
      showCoverageOnHover: false,
      spiderfyDistanceMultiplier: 1.5,
      iconCreateFunction: (cl) => {
        const count = cl.getChildCount();
        const size = count < 10 ? 28 : count < 50 ? 34 : 40;
        return L.divIcon({
          html: `<div class="asb-cluster" style="width:${size}px;height:${size}px;">${count}</div>`,
          className: "asb-cluster-wrap",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });
    map.addLayer(cluster);
    clusterRef.current = cluster;

    map.on("click", () => {
      setPopup(null);
      routeRef.current?.clearLayers();
    });
    map.on("move zoom", () => force());
    map.on("zoomend", () => {
      rootRef.current?.setAttribute("data-zoom", zoomTier(map.getZoom()));
      const state = cargoStateForZoom(map.getZoom());
      Object.entries(cargoMk.current).forEach(([id, mk]) => {
        const c = cargos.find((x) => x.id === id);
        if (!c) return;
        const sel = focusedCargoId === id;
        const ic = cargoIcon(c, state, sel);
        mk.setIcon(L.divIcon({ html: ic.html, className: "cargo-marker", iconSize: ic.size, iconAnchor: ic.anchor }));
      });
    });

    mapRef.current = map;
    setReady(true);
    setTimeout(() => {
      try {
        map.fitBounds([[12, 22], [47, 60]], { padding: [20, 20] });
        map.invalidateSize();
        rootRef.current?.setAttribute("data-zoom", zoomTier(map.getZoom()));
      } catch {}
    }, 60);

    // Keep the map filling its flex panel: re-measure whenever the container
    // resizes (fixes the Leaflet-in-flex "gray gap" once the 50/50 layout
    // settles, on map toggle, and on window resize).
    const ro = new ResizeObserver(() => {
      try {
        mapRef.current?.invalidateSize();
      } catch {}
    });
    ro.observe(hostRef.current);
    roRef.current = ro;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(
    () => () => {
      try {
        roRef.current?.disconnect();
        mapRef.current?.remove();
      } catch {}
      roRef.current = null;
      mapRef.current = null;
    },
    [],
  );

  // Base tiles (swap on light/dark)
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (baseRef.current) {
      try {
        map.removeLayer(baseRef.current);
      } catch {}
    }
    baseRef.current = L.tileLayer(base === "dark" ? TILES.dark : TILES.light, {
      attribution: TILES.attribution,
      maxZoom: 18,
      subdomains: TILES.subdomains,
    }).addTo(map);
    baseRef.current.bringToBack();
  }, [base, ready]);

  // Zones
  React.useEffect(() => {
    const map = mapRef.current;
    const lyr = zonesRef.current;
    if (!map || !lyr || !ready) return;
    lyr.clearLayers();
    if (!zonesOn) {
      map.removeLayer(lyr);
      return;
    }
    Object.entries(ZONES).forEach(([key, z]) => {
      L.rectangle(z.bounds, { color: z.color, weight: 1, opacity: 0.6, fillOpacity: 0.06, dashArray: "5 4" }).addTo(lyr);
      const c = L.latLng((z.bounds[0][0] + z.bounds[1][0]) / 2, (z.bounds[0][1] + z.bounds[1][1]) / 2);
      L.marker(c, {
        interactive: false,
        icon: L.divIcon({
          className: "asb-zone-label-wrap",
          html: `<div class="asb-zone-label" style="color:${z.color}">${key}</div>`,
          iconSize: [60, 14],
          iconAnchor: [30, 7],
        }),
      }).addTo(lyr);
    });
    map.addLayer(lyr);
  }, [zonesOn, ready, base]);

  // Markers
  React.useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map || !ready) return;
    cluster.clearLayers();
    cargoMk.current = {};

    if (cargoOn) {
      const state = cargoStateForZoom(map.getZoom());
      visCargos.forEach((c) => {
        const ll = coordFor(c.route?.polCode);
        if (!ll) return;
        const jx = ((c.id || "").charCodeAt(0) % 7) * 0.04 - 0.12;
        const jy = ((c.id || "").charCodeAt(1) % 7) * 0.04 - 0.12;
        const sel = focusedCargoId === c.id;
        const ic = cargoIcon(c, state, sel);
        const mk = L.marker([ll[0] + jy, ll[1] + jx], {
          icon: L.divIcon({ html: ic.html, className: "cargo-marker", iconSize: ic.size, iconAnchor: ic.anchor }),
          riseOnHover: true,
        });
        mk.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          setPopup({ kind: "cargo", data: c, ll: mk.getLatLng() });
          onSelectCargo?.(c);
          // Dashboard: clicking a cargo anchors a pairing — eligible vessels highlight.
          if (isDashboard) {
            setPairCargo(c);
            setPairVessel(null);
          }
        });
        cargoMk.current[c.id] = mk;
        cluster.addLayer(mk);
      });
    }

    if (vesselsOn) {
      visVessels.forEach((v) => {
        const ll = coordFor(v.openPortLocode);
        if (!ll) return;
        const jx = ((v.id || "").charCodeAt(0) % 7) * 0.05 - 0.15;
        const jy = ((v.id || "").charCodeAt(1) % 7) * 0.05 - 0.15;
        const sel = focusedVesselId === v.id;
        const dim = !!pairCargo && !pairEligible(pairCargo, v);
        const box = Math.max(vesselSize(v).w, vesselSize(v).h, 28);
        const mk = L.marker([ll[0] + jy, ll[1] + jx], {
          icon: L.divIcon({ html: vesselTriangleHTML(v, sel, dim), className: "vessel-marker", iconSize: [box, box], iconAnchor: [box / 2, box / 2] }),
          riseOnHover: true,
        });
        mk.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          // If a cargo is anchored, picking a vessel forms the pair card instead
          // of the normal vessel popup.
          if (pairCargo) {
            setPairVessel(v);
          } else {
            setPopup({ kind: "vessel", data: v, ll: mk.getLatLng() });
            onSelectVessel?.(v);
          }
        });
        cluster.addLayer(mk);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visCargos, visVessels, cargoOn, vesselsOn, focusedCargoId, focusedVesselId, ready, pairCargo, isDashboard]);

  // Focused cargo → route + fit
  React.useEffect(() => {
    const map = mapRef.current;
    const route = routeRef.current;
    if (!map || !route || !ready) return;
    route.clearLayers();
    const c = cargos.find((x) => x.id === focusedCargoId);
    if (!c) return;
    const pol = coordFor(c.route?.polCode);
    const pod = coordFor(c.route?.podCode);
    if (!pol || !pod) return;

    // Sea-following route: exact stored geometry (ECDIS) if the pair is in the
    // table, else a land-avoiding corridor/arc estimate. Never a straight chord.
    const geo =
      routeGeometry({
        polCode: c.route?.polCode,
        podCode: c.route?.podCode,
        polLL: pol,
        podLL: pod,
        polZone: c.route?.polZone,
        podZone: c.route?.podZone,
      }) ?? { pts: [pol, pod], nm: null, exact: false, source: "arc" as const };
    const line = geo.pts.length >= 2 ? geo.pts : [pol, pod];

    // 1) soft halo casing for legibility on any basemap
    L.polyline(line, { color: base === "dark" ? "#0B1B30" : "#FFFFFF", weight: 5.5, opacity: 0.55, lineJoin: "round", lineCap: "round", interactive: false }).addTo(route);
    // 2) the sailed track — SOLID when exact (ECDIS), DASHED when estimated
    L.polyline(line, { color: "#185FA5", weight: 2.2, opacity: 0.95, lineJoin: "round", lineCap: "round", dashArray: geo.exact ? undefined : "7 6", interactive: false }).addTo(route);
    // 3) POL (green) / POD (red) end dots
    L.circleMarker(pol, { radius: 6, color: "#97C459", fill: false, weight: 1.8, interactive: false }).addTo(route);
    L.circleMarker(pod, { radius: 6, color: "#E24B4A", fill: false, weight: 1.8, interactive: false }).addTo(route);
    // 4) distance chip at the track midpoint (ECDIS vs est. tag)
    if (geo.nm != null) {
      const mid = line[Math.floor(line.length / 2)];
      L.marker(mid, {
        interactive: false,
        zIndexOffset: 100000, // sit flat on top of cargo/vessel + cluster-count markers
        icon: L.divIcon({
          className: "route-tag-wrap",
          html: `<span class="route-tag${geo.exact ? " is-exact" : ""}">${geo.nm.toLocaleString()} NM<i>${geo.exact ? "ECDIS" : "est."}</i></span>`,
          iconSize: [0, 0],
        }),
      }).addTo(route);
    }
    // 5) fit the WHOLE curved track (corridors swing wide of the chord)
    map.fitBounds(L.latLngBounds(line as [number, number][]), { padding: [70, 70], maxZoom: 7, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCargoId, ready, base]);

  // Focused vessel → flyTo
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const v = vessels.find((x) => x.id === focusedVesselId);
    const ll = v ? coordFor(v.openPortLocode) : null;
    if (ll) map.flyTo(ll, 7, { duration: 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedVesselId, ready]);

  // Fullscreen: reflow Leaflet tiles after the size change; Esc exits.
  React.useEffect(() => {
    const t = setTimeout(() => {
      try { mapRef.current?.invalidateSize(); } catch {}
    }, 240);
    return () => clearTimeout(t);
  }, [fullscreen]);
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const point = popup && mapRef.current ? mapRef.current.latLngToContainerPoint(popup.ll) : null;

  const BarIcon = ({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
    <div className={`bar-icon${on ? " active" : ""}`} onClick={onClick}>
      {children}
      <span className="tooltip-l">{title}</span>
    </div>
  );

  return (
    <div ref={rootRef} data-zoom="far" className={`asb-map base-${base}${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="map-canvas">
        <div ref={hostRef} className="leaflet-host" />

        <div className="map-title">
          Arab ShipBroker Platform <span className="map-title__beta">BETA</span>
        </div>

        <div className="filter-bar">
          {["A.Gulf", "R.Sea", "E.Med", "B.Sea"].map((k, i) => (
            <div key={k} className={`filter-chip${i < 2 ? " active" : ""}`}>{k}</div>
          ))}
        </div>

        <div className="layer-strip">
          <div className={`layer-pill ${cargoOn ? "on" : "off"}`} onClick={() => setCargoOn((v) => !v)}>
            <span className="pill-dot" style={{ background: "#97C459" }} /> Cargo
          </div>
          <div className={`layer-pill ${vesselsOn ? "on" : "off"}`} onClick={() => setVesselsOn((v) => !v)}>
            <span className="pill-tri" style={{ borderBottom: "7px solid #7BB8F0" }} /> Tonnage
          </div>
          <div className={`layer-pill ${zonesOn ? "on" : "off"}`} onClick={() => setZonesOn((v) => !v)}>
            <span className="pill-hex" /> Zones
          </div>
        </div>

        {popup && point && (
          <MapPopup popup={popup} point={point} onClose={() => setPopup(null)} onView={() => {
            if (popup.kind === "cargo") onSelectCargo?.(popup.data);
            else onSelectVessel?.(popup.data);
            setPopup(null);
          }} />
        )}
      </div>

      <div className="right-bar">
        <BarIcon on={cargoOn} onClick={() => setCargoOn((v) => !v)} title="Cargo positions">
          {G.cargo}
          {cargoOn && <span className="bar-badge bar-badge--cargo" />}
        </BarIcon>
        <BarIcon on={vesselsOn} onClick={() => setVesselsOn((v) => !v)} title="Open tonnage">
          {G.vessel}
          {vesselsOn && <span className="bar-badge bar-badge--vessel" />}
        </BarIcon>
        <BarIcon on={zonesOn} onClick={() => setZonesOn((v) => !v)} title="Trading zones">
          {G.zones}
          {zonesOn && <span className="bar-badge bar-badge--zone" />}
        </BarIcon>
        <div className="bar-divider" />
        <BarIcon on={filtersOpen} onClick={() => setFiltersOpen((o) => !o)} title="Filters">
          {G.filter}
          {Object.values(selections).some((s) => s.size > 0) && <span className="bar-badge bar-badge--cargo" />}
        </BarIcon>
        <BarIcon
          on={voyOpen && !voyLocked}
          onClick={() => (voyLocked ? undefined : setVoyOpen((o) => !o))}
          title={voyLocked ? "Voy OPEX — upgrade to Subscriber (T3) to unlock" : "Voy OPEX estimator"}
        >
          {voyLocked ? G.lock : G.voy}
        </BarIcon>
        <div className="bar-spacer" />
        <div className="bar-divider" />
        <BarIcon onClick={() => setBase(base === "light" ? "dark" : "light")} title={base === "light" ? "Light base · switch to dark" : "Dark base · switch to light"}>
          {base === "light" ? G.sun : G.moon}
        </BarIcon>
        <BarIcon onClick={() => mapRef.current?.zoomIn()} title="Zoom in">{G.plus}</BarIcon>
        <BarIcon onClick={() => mapRef.current?.zoomOut()} title="Zoom out">{G.minus}</BarIcon>
        <div className="bar-divider" />
        <BarIcon on={fullscreen} onClick={() => setFullscreen((f) => !f)} title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}>
          {fullscreen ? G.minimize : G.maximize}
        </BarIcon>
      </div>

      <MapFilterPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        cargos={cargos}
        vessels={vessels}
        cargoLayer={cargoOn}
        vesselLayer={vesselsOn}
        onToggleCargoLayer={() => setCargoOn((v) => !v)}
        onToggleVesselLayer={() => setVesselsOn((v) => !v)}
        selections={selections}
        onToggleOption={toggleOption}
        qtyMin={qtyMin}
        qtyMax={qtyMax}
        onQtyMin={setQtyMin}
        onQtyMax={setQtyMax}
        onReset={() => {
          setSelections({});
          setQtyMin("");
          setQtyMax("");
        }}
      />

      <VoyOpexPanel open={voyOpen && !voyLocked} onClose={() => setVoyOpen(false)} />

      {pairCargo && (
        <div className="pair-card">
          <div className="pair-card__head">
            <span className="pair-card__ttl">Pairing</span>
            <button
              type="button"
              className="pair-card__close"
              aria-label="Clear pairing"
              onClick={() => { setPairCargo(null); setPairVessel(null); }}
            >×</button>
          </div>
          <div className="pair-card__route">{pairCargo.cargo} · <span className="mono">{pairCargo.refId}</span></div>
          {!pairVessel ? (
            <div className="pair-card__hint">
              Pick a highlighted vessel — {visVessels.filter((v) => pairEligible(pairCargo, v)).length} eligible
            </div>
          ) : (
            (() => {
              const band = fitLabel(pairCargo, pairVessel);
              return (
                <>
                  <div className="pair-card__to">→ {pairVessel.name}</div>
                  <div className={`pair-band band-${band.toLowerCase()}`}>{band} fit</div>
                  <div className="pair-card__chips">
                    <span>{pairVessel.type}</span>
                    <span>{pairVessel.dwt} DWT</span>
                    <span>{pairVessel.openPortZone}</span>
                  </div>
                  <div className="pair-card__note">
                    Indicative fit label via Arab ShipBroker — open the Voyage
                    Estimator for full economics. No counterparty contact is shared.
                  </div>
                </>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}

function MapPopup({
  popup,
  point,
  onClose,
  onView,
}: {
  popup: Popup;
  point: L.Point;
  onClose: () => void;
  onView: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const style: React.CSSProperties = { left: point.x, top: point.y };
  if (popup.kind === "cargo") {
    const c = popup.data;
    const laycan = c.laycanFrom && c.laycanTo ? `${c.laycanFrom} – ${c.laycanTo}` : "—";
    return (
      <div className="map-popup" style={style} onClick={stop} onMouseDown={stop}>
        <button className="map-popup__close" onClick={onClose}>×</button>
        <div className="map-popup__title">{c.cargo}</div>
        <div className="map-popup__sub">
          {c.route.polCode} → {c.route.podCode} · {c.route.polZone} → {c.route.podZone}
        </div>
        <div className="map-popup__grid">
          <div><div className="map-popup__k">QTY</div><div className="map-popup__v">{c.qtyMt} MT</div></div>
          <div><div className="map-popup__k">Laycan</div><div className="map-popup__v">{laycan}</div></div>
          <div><div className="map-popup__k">Terms</div><div className="map-popup__v">{c.loadTerms || "—"}</div></div>
          <div><div className="map-popup__k">SF</div><div className="map-popup__v">{c.sf != null ? `${c.sf} m³/t` : "—"}</div></div>
        </div>
        <div className="map-popup__actions">
          <button className="map-popup__btn map-popup__btn--view" onClick={onView}>View card</button>
          <button className="map-popup__btn map-popup__btn--match" onClick={onView}>Match</button>
        </div>
      </div>
    );
  }
  const v = popup.data;
  return (
    <div className="map-popup" style={style} onClick={stop} onMouseDown={stop}>
      <button className="map-popup__close" onClick={onClose}>×</button>
      <div className="map-popup__title">{v.name}</div>
      <div className="map-popup__sub">{v.type} · {v.flag}{v.built ? ` · Built ${v.built}` : ""}</div>
      <div className="map-popup__grid">
        <div><div className="map-popup__k">DWT</div><div className="map-popup__v">{v.dwt} MT</div></div>
        <div><div className="map-popup__k">Open port</div><div className="map-popup__v">{v.openPort}</div></div>
        <div><div className="map-popup__k">Open date</div><div className="map-popup__v">{v.openDate}</div></div>
        <div><div className="map-popup__k">Status</div><div className="map-popup__v">{v.status.toUpperCase()}</div></div>
      </div>
      <div className="map-popup__actions">
        <button className="map-popup__btn map-popup__btn--view" onClick={onView}>View card</button>
        <button className="map-popup__btn map-popup__btn--match" onClick={onView}>Match</button>
      </div>
    </div>
  );
}
