"use client";

// MarketMap — Leaflet market map, ported from the Claude design (asb/map.jsx +
// asb/map-shared.jsx) to TS. Loaded client-only via next/dynamic(ssr:false).
// Zones, zoom-aware cargo markers, vessel triangles, clustering, custom popup,
// focus sync, layer + base controls. (The Voy-OPEX side panel is deferred to
// the voyage-estimator phase.)
import * as React from "react";
import L from "leaflet";
import { toast } from "sonner";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "@/lib/portal/map.css";
import { CargoView, VesselView } from "@/lib/portal/types";
import { FALLBACK_PORTS, type PortGeo } from "@/lib/portal/port-coords";
import { MapFilterPanel } from "./MapFilterPanel";
import { CARGO_FACETS, VESSEL_FACETS, passesFacets, type Selections } from "@/lib/portal/map-filters";
import { VoyOpexPanel } from "./VoyOpexPanel";
import { useViewerTier } from "@/lib/portal/tier";
import { routeGeometry } from "@/lib/portal/routeGeometry";
import { getPortRoute } from "@/sdk/app/routes";
import { zoneByCode, zoneCentroid } from "@/lib/portal/zones";
import { ZONE_SHAPES } from "@/lib/portal/zone-shapes";
import { pairEligible, fitLabel, cargoQtyMax } from "@/lib/portal/matching";
import { formatLaycanRange, formatShortDate } from "@/lib/portal/format";
import { postedAgeLabel } from "@/lib/portal/useMarketVisibility";
import { flagCode } from "@/lib/portal/flags";
import "flag-icons/css/flag-icons.min.css";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { functionalStore } from "@/lib/consent";
import { getMatchesForCargo } from "@/sdk/app/cargos";
import { getMatchesForAvailability } from "@/sdk/app/vessels";

// Geographic bearing a→b (deg clockwise from north) — for the vector arrowhead.
function bearing(a: [number, number], b: [number, number]): number {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const f1 = a[0] * toR, f2 = b[0] * toR, dl = (b[1] - a[1]) * toR;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * toD + 360) % 360;
}
// Gently curved sample points a→b (preferred-direction vector, never a chord).
function curvePts(a: [number, number], b: [number, number], bend = 0.18): [number, number][] {
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ctrl: [number, number] = [mid[0] + (b[1] - a[1]) * bend, mid[1] - (b[0] - a[0]) * bend];
  const out: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0], u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1]]);
  }
  return out;
}

// Zone shading is drawn from coastline-following polygons (lib/portal/zone-shapes)
// so each zone reads as its real sea basin (the Red Sea looks like the Red Sea)
// rather than a colored rectangle.

// ── Basemap registry ────────────────────────────────────────────────────────
// Leaflet is the engine; these are tile PROVIDERS on top of it. Every entry
// here is key-free and production-safe (the CARTO watermark incident came from
// a keyed provider blocking non-localhost referers). Keyed providers (CARTO /
// Mapbox) can join later behind admin-configured keys.
export type MapBase = "light" | "dark" | "nautical" | "satellite";

const BASES: Record<MapBase, {
  label: string;
  hint: string;
  layers: { url: string; maxNativeZoom?: number }[];
  attribution: string;
  darkish: boolean; // drives contrast styling (route halo, chrome)
}> = {
  light: {
    label: "Light",
    hint: "Esri Light Gray — calm cartographic canvas",
    layers: [{ url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 16 }],
    attribution: "© Esri · © OpenStreetMap contributors",
    darkish: false,
  },
  dark: {
    label: "Dark",
    hint: "Esri Dark Gray — the ops-room look",
    layers: [{ url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 16 }],
    attribution: "© Esri · © OpenStreetMap contributors",
    darkish: true,
  },
  nautical: {
    label: "Nautical",
    hint: "OpenStreetMap + OpenSeaMap seamarks — buoys, lights, marks",
    layers: [
      { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" },
      { url: "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png" },
    ],
    attribution: "© OpenStreetMap contributors · © OpenSeaMap",
    darkish: false,
  },
  satellite: {
    label: "Satellite",
    hint: "Esri World Imagery",
    layers: [{ url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" }],
    attribution: "© Esri · Maxar, Earthstar Geographics",
    darkish: true,
  },
};

const isDarkish = (b: MapBase) => BASES[b].darkish;

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
// Commodity-aware glyphs (09 §6) — inline SVGs (no icon-font dependency, so
// every glyph is guaranteed to render): grain→wheat · bagged→shopping bag ·
// steel/pipes→cylinder · project→crane hook · liquid→droplet · other break
// bulk→packages · dry bulk→layered stack.
function commodityGlyph(c: CargoView, regime: CargoRegime): string {
  const s = `width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const name = `${c.commodity || c.cargo || ""}`.toLowerCase();
  if (/bag|cement|rice|sugar|flour/.test(name)) {
    // shopping bag (bagged cargo)
    return `<svg ${s}><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`;
  }
  if (/steel|pipe|coil|rebar|billet/.test(name)) {
    // cylinder (steel / pipes)
    return `<svg ${s}><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>`;
  }
  if (/project|machinery|equipment|turbine|transformer/.test(name)) {
    // crane hook (project cargo)
    return `<svg ${s}><path d="M12 3v9"/><path d="M12 12a3 3 0 1 0 3 3"/><path d="M4 7l8-4 8 4"/></svg>`;
  }
  if (/oil|liquid|molasses|chemical/.test(name)) {
    // droplet (liquid)
    return `<svg ${s}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/></svg>`;
  }
  if (regime === "grain") {
    // wheat ear
    return `<svg ${s}><path d="M12 22V8"/><path d="M12 8c0-2 1.6-3.5 3.5-3.5C15.5 6.5 14 8 12 8Z"/><path d="M12 8c0-2-1.6-3.5-3.5-3.5C8.5 6.5 10 8 12 8Z"/><path d="M12 13c0-2 1.6-3.5 3.5-3.5C15.5 11.5 14 13 12 13Z"/><path d="M12 13c0-2-1.6-3.5-3.5-3.5C8.5 11.5 10 13 12 13Z"/></svg>`;
  }
  if (regime === "breakbulk") {
    // packages (other break bulk)
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
      html: `<div class="cargo-marker-wrap cargo-pill-marker${rg}${sel}" data-scope="${scope}" data-regime="${regime}" style="border-left-color:${SCOPE_COLOR[scope]}"><span class="pill-glyph" style="color:${SCOPE_COLOR[scope]}">${commodityGlyph(c, regime)}</span><span class="pill-name">${shortCargoName(c)}</span>${hoverTip(c)}</div>`,
      size: [88, 16] as [number, number],
      anchor: [44, 8] as [number, number],
    };
  }
  const wog = c.wog ? '<span class="wog-dot"></span>' : "";
  return {
    html: `<div class="cargo-marker-wrap cargo-thumb-marker${rg}${sel}" data-scope="${scope}" data-regime="${regime}" style="border-left-color:${SCOPE_COLOR[scope]}">${commodityGlyph(c, regime)}<span>${shortCargoName(c)}</span>${wog}${hoverTip(c)}</div>`,
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
// The platform's vessel icon (side profile, brand blue) — ONE source of truth
// for the animated route ship and the focused-vessel marker.
function shipSVG(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><rect x="4" y="9.5" width="3" height="3" fill="#185FA5"/><rect x="5" y="6" width="1.6" height="3.8" fill="#185FA5"/><path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z" fill="#185FA5" stroke="#FFFFFF" stroke-width="0.9"/><rect x="19" y="13" width="1.6" height="1" fill="#fff" opacity="0.85" rx="0.2"/><path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="#185FA5" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>`;
}
// Focused vessel — the ship icon replaces the course triangle so the vessel
// you zoomed to reads as a ship, not another market symbol.
function vesselShipHTML(v: VesselView, dim = false): string {
  return `<div class="vessel-tri-wrap vessel-ship-wrap is-selected${dim ? " is-dim" : ""}">${shipSVG(34)}<div class="v-label">${v.name}</div></div>`;
}

// Pairing eligibility + fit labels come from the ONE matching module —
// the same gates the Top Matches panel uses (no per-surface math).
// ── Persisted light/dark base ──────────────────────────────────────────────
function useMapBase(): [MapBase, (b: MapBase) => void] {
  const [base, setBase] = React.useState<MapBase>("dark");
  React.useEffect(() => {
    try {
      const v = localStorage.getItem("asb:mapBase");
      if (v && v in BASES) setBase(v as MapBase);
    } catch {}
  }, []);
  const set = (b: MapBase) => {
    setBase(b);
    try {
      localStorage.setItem("asb:mapBase", b);
    } catch {}
  };
  return [base, set];
}

// Minimal inline glyphs for the control bar (no icon-font dependency).
// Draws the focused route on a layer: halo + track + end dots + NM chip +
// optional animated ship. End dots come from the line's own endpoints, so
// this works whether the endpoints came from port coordinates or from the
// stored route's geometry (ports missing from the local coords table).
function drawRoute(
  map: L.Map,
  layer: L.LayerGroup,
  line: [number, number][],
  exact: boolean,
  nm: number | null,
  fit: boolean,
  base: MapBase,
  shipOn: boolean,
  animRef: React.MutableRefObject<number | null>,
) {
  if (animRef.current != null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  layer.clearLayers();
  if (line.length < 2) return;
  // 1) soft halo casing for legibility on any basemap
  L.polyline(line, { color: isDarkish(base) ? "#0B1B30" : "#FFFFFF", weight: 6, opacity: 0.6, lineJoin: "round", lineCap: "round", interactive: false }).addTo(layer);
  // 2) the sailed track — high-contrast orange so it reads on any water;
  //    SOLID when exact (ECDIS), DASHED when estimated
  L.polyline(line, { color: "#F97316", weight: 2.6, opacity: 0.95, lineJoin: "round", lineCap: "round", dashArray: exact ? undefined : "7 6", interactive: false }).addTo(layer);
  // 3) POL (green) / POD (red) end dots
  L.circleMarker(line[0], { radius: 6, color: "#97C459", fill: false, weight: 1.8, interactive: false }).addTo(layer);
  L.circleMarker(line[line.length - 1], { radius: 6, color: "#E24B4A", fill: false, weight: 1.8, interactive: false }).addTo(layer);
  // 4) distance chip at the track midpoint (ECDIS vs est. tag)
  if (nm != null) {
    const mid = line[Math.floor(line.length / 2)];
    L.marker(mid, {
      interactive: false,
      zIndexOffset: 100000, // sit flat on top of cargo/vessel + cluster-count markers
      icon: L.divIcon({
        className: "route-tag-wrap",
        html: `<span class="route-tag${exact ? " is-exact" : ""}">${nm.toLocaleString()} NM<i>${exact ? "ECDIS" : "est."}</i></span>`,
        iconSize: [0, 0],
      }),
    }).addTo(layer);
  }
  // 5) fit the WHOLE curved track (corridors swing wide of the chord)
  if (fit) map.fitBounds(L.latLngBounds(line), { padding: [70, 70], maxZoom: 7, animate: true });
  // 6) animated ship tracing the route (map option; off = nothing drawn)
  if (shipOn) {
    const cum: number[] = [0];
    for (let i = 1; i < line.length; i++) {
      const k = Math.cos((((line[i - 1][0] + line[i][0]) / 2) * Math.PI) / 180);
      cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], (line[i][1] - line[i - 1][1]) * k));
    }
    const total = cum[cum.length - 1];
    if (total > 0) {
      // the platform's own vessel icon (side view), flipped to face the
      // direction of travel
      const ship = L.marker(line[0], {
        interactive: false,
        zIndexOffset: 99000,
        icon: L.divIcon({
          className: "route-ship-wrap",
          html: `<div class="route-ship">${shipSVG(30)}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(layer);
      // one full transit every ~10–25s, paced by route length
      const durMs = Math.min(25000, Math.max(10000, total * 500));
      const t0 = performance.now();
      const step = (now: number) => {
        const t = (((now - t0) % durMs) / durMs) * total;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < t) i++;
        const f = (t - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9);
        const [la1, lo1] = line[i - 1], [la2, lo2] = line[i];
        const la = la1 + (la2 - la1) * f, lo = lo1 + (lo2 - lo1) * f;
        ship.setLatLng([la, lo]);
        // Bow leads the track: rotate to the leg's true bearing. The icon's
        // bow faces east, so eastward headings rotate directly; westward
        // headings mirror first (scaleX) so the deck stays upright, then
        // rotate the mirrored bow onto the bearing.
        const k = Math.cos((la * Math.PI) / 180);
        let brg = (Math.atan2((lo2 - lo1) * k, la2 - la1) * 180) / Math.PI; // 0=N, clockwise
        if (brg < 0) brg += 360;
        const el = ship.getElement()?.firstElementChild as HTMLElement | null;
        if (el)
          el.style.transform = brg <= 180
            ? `rotate(${(brg - 90).toFixed(1)}deg)`
            : `scaleX(-1) rotate(${(270 - brg).toFixed(1)}deg)`;
        animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    }
  }
}

const G = {
  cargo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></svg>,
  vessel: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4 L20 19 H4 Z" /></svg>,
  ship: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="9.5" width="3" height="3" /><rect x="5" y="6" width="1.6" height="3.8" /><path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z" /><path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" /></svg>,
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
  vesselVectors = false,
  barLeft = false,
}: {
  cargos: CargoView[];
  vessels: VesselView[];
  focusedCargoId?: string | null;
  focusedVesselId?: string | null;
  onSelectCargo?: (c: CargoView) => void;
  onSelectVessel?: (v: VesselView) => void;
  // Live locode → [lat, lon] from the ports table; falls back to FALLBACK_PORTS.
  portCoords?: Record<string, PortGeo>;
  // My Vessels: draw a dashed vector from each vessel's open port toward its
  // first preferred-trade zone (off elsewhere so other map surfaces are clean).
  vesselVectors?: boolean;
  // Card+map pages (markets, My Cargo/My Vessels): mirror the icon rail to the
  // map's inner-left edge — the map sits right of the cards (09 §5).
  barLeft?: boolean;
}) {
  const geoFor = React.useCallback(
    (locode?: string | null): PortGeo | null => {
      if (!locode) return null;
      const key = locode.trim().toUpperCase().replace(/\s+/g, "");
      return portCoords?.[locode] ?? portCoords?.[key] ?? FALLBACK_PORTS[key] ?? null;
    },
    [portCoords],
  );
  const coordFor = React.useCallback(
    (locode?: string | null): [number, number] | null => {
      const g = geoFor(locode);
      return g ? [g[0], g[1]] : null;
    },
    [geoFor],
  );
  // Where to place a vessel on the map: its open-port coordinates if it has a
  // locode, else fall back to the centroid of its open zone, so vessels whose
  // open port is "—" still appear (and can be focused from the card/list).
  const vesselGeo = React.useCallback(
    (v: VesselView): PortGeo | null => {
      const g = geoFor(v.openPortLocode);
      if (g) return g;
      // No locode → fall back to the open zone's registry centroid (null for
      // unplaceable zones like "Unknown", in which case the vessel is hidden).
      const z = zoneByCode(v.openPortZone);
      const c = z ? zoneCentroid(z) : null;
      return c ? [c[0], c[1]] : null;
    },
    [geoFor],
  );
  // Geographic anchoring (09 §7): when the port carries a seaward bearing,
  // cargo is placed LANDWARD of it (goods at the terminal — never in the sea)
  // and vessels SEAWARD (in the approaches — never on land); same-port jitter
  // runs along the coast-parallel axis only, so spreading can never flip a
  // marker across the coastline. Ports without a bearing keep plain jitter.
  const anchoredLL = React.useCallback(
    (geo: PortGeo, side: "land" | "sea", seedA: number, seedB: number): [number, number] => {
      const [lat, lon, bearing] = geo;
      const fa = (seedA % 7) / 7; // 0..1 deterministic from the id
      const fb = (seedB % 7) / 7;
      if (bearing == null) {
        // legacy fallback: plain bounded jitter
        return [lat + fa * 0.28 - 0.14, lon + fb * 0.28 - 0.14];
      }
      const D2R = Math.PI / 180;
      const b = bearing * D2R;
      const lonScale = 1 / Math.max(0.2, Math.cos(lat * D2R));
      const sign = side === "sea" ? 1 : -1;
      const dist = side === "sea" ? 0.10 + fa * 0.08 : 0.08 + fa * 0.05;
      const along = (fb - 0.5) * 0.18;
      const uLat = Math.cos(b), uLon = Math.sin(b) * lonScale; // seaward unit
      const vLat = -Math.sin(b), vLon = Math.cos(b) * lonScale; // coast-parallel
      return [lat + sign * dist * uLat + along * vLat, lon + sign * dist * uLon + along * vLon];
    },
    [],
  );

  const hostRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const clusterRef = React.useRef<L.MarkerClusterGroup | null>(null);
  const zonesRef = React.useRef<L.LayerGroup | null>(null);
  const routeRef = React.useRef<L.LayerGroup | null>(null);
  const vecRef = React.useRef<L.LayerGroup | null>(null);
  const baseRef = React.useRef<L.Layer | null>(null);
  const flowsRef = React.useRef<L.LayerGroup | null>(null);
  const matchLinesRef = React.useRef<L.LayerGroup | null>(null);
  const cargoMk = React.useRef<Record<string, L.Marker>>({});
  const roRef = React.useRef<ResizeObserver | null>(null);
  // True once the viewer pans/zooms by hand — after that, container resizes
  // must never yank the view back to the default region.
  const interactedRef = React.useRef(false);

  const [ready, setReady] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [basePickerOpen, setBasePickerOpen] = React.useState(false);
  const [layersOpen, setLayersOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQ, setSearchQ] = React.useState("");
  const [namesOn, setNamesOn] = React.useState(true);
  const [flowsOn, setFlowsOn] = React.useState(true);
  // one panel at a time — opening any chrome panel closes the others
  const closePanels = () => { setBasePickerOpen(false); setLayersOpen(false); setSearchOpen(false); setFiltersOpen(false); setVoyOpen(false); };
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [voyOpen, setVoyOpen] = React.useState(false);
  const tier = useViewerTier();
  const voyLocked = tier === "T1" || tier === "T2";
  const [selections, setSelections] = React.useState<Selections>({});
  const [qtyMin, setQtyMin] = React.useState<number | "">("");
  const [qtyMax, setQtyMax] = React.useState<number | "">("");
  // Click-to-pair (09 §8): any cargo OR vessel marker becomes the pair anchor;
  // eligible counterparts stay bright, everything else fades; clicking an
  // eligible counterpart completes the pair. Enabled wherever both market
  // sides are on the map (the layer-registry equivalent).
  const pairingEnabled = cargos.length > 0 && vessels.length > 0;
  const [pairAnchor, setPairAnchor] = React.useState<{ kind: "cargo" | "vessel"; id: string } | null>(null);
  const [pairDone, setPairDone] = React.useState<{ cargo: CargoView; vessel: VesselView } | null>(null);
  const clearPairing = React.useCallback(() => { setPairAnchor(null); setPairDone(null); }, []);
  const [cargoOn, setCargoOn] = React.useState(true);
  const [vesselsOn, setVesselsOn] = React.useState(true);
  // Animated ship on the focused route — persisted map option.
  const [routeShipOn, setRouteShipOn] = React.useState(true);
  React.useEffect(() => {
    let x = false;
    (async () => {
      await Promise.resolve();
      if (!x && localStorage.getItem("asb:routeShip") === "off") setRouteShipOn(false);
    })();
    return () => { x = true; };
  }, []);
  const toggleRouteShip = () => setRouteShipOn((v) => {
    try { localStorage.setItem("asb:routeShip", v ? "off" : "on"); } catch { /* private mode */ }
    return !v;
  });
  const shipAnimRef = React.useRef<number | null>(null);
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
  const anchorCargo = pairAnchor?.kind === "cargo" ? cargos.find((c) => c.id === pairAnchor.id) ?? null : null;
  const anchorVessel = pairAnchor?.kind === "vessel" ? vessels.find((v) => v.id === pairAnchor.id) ?? null : null;

  // AUTHORITATIVE eligibility (09 §9): on anchor, fetch the match set from the
  // SAME database RPC the count badges use (get_matches_for_cargo /
  // get_matches_for_availability). dbEligible holds the opposite-side ids
  // (vessel ids when a cargo is anchored, cargo ids when a vessel is anchored).
  // If the DB is unreachable (sample/offline), we fall back to the client gates
  // in lib/portal/matching, which mirror the same funnel.
  const [dbEligible, setDbEligible] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (!pairAnchor) { setDbEligible(null); return; }
    let cancelled = false;
    setDbEligible(null);
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        if (pairAnchor.kind === "cargo") {
          const res = await getMatchesForCargo(supabase, pairAnchor.id);
          if (!cancelled) setDbEligible(new Set(res.map((r) => r.availability_id)));
        } else {
          const res = await getMatchesForAvailability(supabase, pairAnchor.id);
          if (!cancelled) setDbEligible(new Set(res.map((r) => r.cargo_id)));
        }
      } catch {
        if (!cancelled) setDbEligible(null); // -> client fallback below
      }
    })();
    return () => { cancelled = true; };
  }, [pairAnchor]);

  const eligibleVesselIds = React.useMemo(
    () => (anchorCargo ? (dbEligible ?? new Set(visVessels.filter((v) => pairEligible(anchorCargo, v)).map((v) => v.id))) : null),
    [anchorCargo, visVessels, dbEligible],
  );
  const eligibleCargoIds = React.useMemo(
    () => (anchorVessel ? (dbEligible ?? new Set(visCargos.filter((c) => pairEligible(c, anchorVessel)).map((c) => c.id))) : null),
    [anchorVessel, visCargos, dbEligible],
  );
  // Marker pair-state class (styled on .leaflet-marker-icon in map.css).
  const pairCls = (kind: "cargo" | "vessel", id: string): string => {
    if (!pairingEnabled || !pairAnchor) return "";
    if (pairAnchor.kind === kind) return pairAnchor.id === id ? " is-anchor" : " is-faded";
    const elig = kind === "vessel" ? eligibleVesselIds : eligibleCargoIds;
    return elig?.has(id) ? " is-eligible" : " is-faded";
  };
  const handlePairClick = (kind: "cargo" | "vessel", id: string): boolean => {
    if (!pairingEnabled) return false;
    if (!pairAnchor || pairAnchor.kind === kind) {
      setPairAnchor({ kind, id });
      setPairDone(null);
      return true;
    }
    // Completion uses the SAME eligible set that drives the highlighting, so
    // a pairing can only be formed with a marker the DB (or the mirrored
    // fallback) actually matched — map and badges can never disagree.
    const elig = kind === "vessel" ? eligibleVesselIds : eligibleCargoIds;
    const cargo = kind === "cargo" ? cargos.find((c) => c.id === id) : cargos.find((c) => c.id === pairAnchor.id);
    const vessel = kind === "vessel" ? vessels.find((v) => v.id === id) : vessels.find((v) => v.id === pairAnchor.id);
    if (cargo && vessel && elig?.has(id)) {
      setPairDone({ cargo, vessel });
    } else {
      setPairAnchor({ kind, id }); // ineligible pick re-anchors instead
      setPairDone(null);
    }
    return true;
  };

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
    flowsRef.current = L.layerGroup().addTo(map);
    matchLinesRef.current = L.layerGroup().addTo(map);
    vecRef.current = L.layerGroup().addTo(map);
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
    // settles, on map toggle, and on window resize). Until the viewer pans or
    // zooms by hand, also re-fit the MENA region so a layout change (split ↔
    // wide, divider drags) keeps the market centered instead of drifting.
    const markInteracted = () => { interactedRef.current = true; };
    hostRef.current.addEventListener("pointerdown", markInteracted);
    hostRef.current.addEventListener("wheel", markInteracted, { passive: true });
    const ro = new ResizeObserver(() => {
      try {
        mapRef.current?.invalidateSize();
        if (!interactedRef.current) {
          mapRef.current?.fitBounds([[12, 22], [47, 60]], { padding: [20, 20], animate: false });
        }
        // Short pane (wide-layout divider dragged down): let the icon rail
        // scroll rather than clip its top/bottom entries.
        const h = hostRef.current?.clientHeight ?? 0;
        rootRef.current?.classList.toggle("rail-tight", h > 0 && h < 520);
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

  // Base tiles — a provider may serve 1–2 layers (nautical = OSM + seamark
  // overlay). If a provider starts failing (outage, policy change), fall back
  // to the keyless Esri canvas automatically instead of showing a broken sea.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (baseRef.current) {
      try { map.removeLayer(baseRef.current); } catch {}
    }
    const def = BASES[base];
    const group = L.layerGroup();
    let errors = 0;
    let fellBack = false;
    def.layers.forEach((l, i) => {
      const tl = L.tileLayer(l.url, {
        attribution: i === 0 ? def.attribution : undefined,
        maxZoom: 18,
        ...(l.maxNativeZoom ? { maxNativeZoom: l.maxNativeZoom } : {}),
      });
      if (i === 0 && base !== "dark" && base !== "light") {
        tl.on("tileerror", () => {
          errors++;
          if (errors > 12 && !fellBack) {
            fellBack = true;
            setBase(isDarkish(base) ? "dark" : "light");
          }
        });
      }
      group.addLayer(tl);
    });
    group.addTo(map);
    group.eachLayer((l) => (l as L.TileLayer).bringToBack());
    baseRef.current = group;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    ZONE_SHAPES.forEach((z) => {
      // Coastline-following basin outline (dashed casing + soft tint), not a box.
      L.polygon(z.poly, {
        color: z.color,
        weight: 1.6,
        opacity: 0.85,
        fillColor: z.color,
        fillOpacity: 0.12,
        dashArray: "6 5",
        lineJoin: "round",
        interactive: false,
      }).addTo(lyr);
      // Floating zone code, placed at the basin's label anchor — sits above the
      // polygons and fades out as you zoom in (see .asb-zone-label in map.css).
      L.marker(z.labelAt, {
        interactive: false,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "asb-zone-label-wrap",
          html: `<div class="asb-zone-label" style="color:${z.color}">${z.code}</div>`,
          iconSize: [80, 16],
          iconAnchor: [40, 8],
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
    vecRef.current?.clearLayers();

    if (cargoOn) {
      const state = cargoStateForZoom(map.getZoom());
      visCargos.forEach((c) => {
        const geo = geoFor(c.route?.polCode);
        if (!geo) return;
        // Cargo anchors LANDWARD of the port (09 §7) — never in the sea.
        const pos = anchoredLL(geo, "land", (c.id || "").charCodeAt(0) || 0, (c.id || "").charCodeAt(1) || 0);
        const sel = focusedCargoId === c.id;
        const ic = cargoIcon(c, state, sel);
        const mk = L.marker(pos, {
          icon: L.divIcon({ html: ic.html, className: "cargo-marker" + pairCls("cargo", c.id), iconSize: ic.size, iconAnchor: ic.anchor }),
          riseOnHover: true,
        });
        mk.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          // Pairing-enabled surfaces: the click drives the pairing state machine.
          if (handlePairClick("cargo", c.id)) { onSelectCargo?.(c); return; }
          closePanels();
          setPopup({ kind: "cargo", data: c, ll: mk.getLatLng() });
          onSelectCargo?.(c);
        });
        cargoMk.current[c.id] = mk;
        cluster.addLayer(mk);
      });
    }

    if (vesselsOn) {
      visVessels.forEach((v) => {
        const geo = vesselGeo(v);
        if (!geo) return;
        // Vessels anchor SEAWARD — in or just off the approaches, never on land.
        const pos = anchoredLL(geo, "sea", (v.id || "").charCodeAt(0) || 0, (v.id || "").charCodeAt(1) || 0);
        const sel = focusedVesselId === v.id;
        const dim = pairCls("vessel", v.id) === " is-faded";

        // Preferred-direction vector (My Vessels): dashed curve open port →
        // first preferred-zone centroid, with an arrowhead at the far end.
        if (vesselVectors && vecRef.current) {
          const z = v.preferredZones?.[0] ? zoneByCode(v.preferredZones[0]) : null;
          const dest = z ? zoneCentroid(z) : null;
          const a: [number, number] = pos;
          if (dest && (dest[0] !== a[0] || dest[1] !== a[1])) {
            const pts = curvePts(a, dest);
            const line = sel ? "#2A6FDB" : "#8C9BB5";
            L.polyline(pts, { color: line, weight: sel ? 3 : 2, dashArray: "7 7", opacity: dim ? 0.25 : 0.8, interactive: false }).addTo(vecRef.current);
            const endBrg = bearing(pts[pts.length - 2], pts[pts.length - 1]);
            L.marker(dest, {
              interactive: false,
              icon: L.divIcon({
                className: "vessel-vec-arrow",
                html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${line};transform:rotate(${endBrg}deg);opacity:${dim ? 0.25 : 0.85}"></div>`,
                iconSize: [10, 10],
                iconAnchor: [5, 5],
              }),
            }).addTo(vecRef.current);
          }
        }
        const box = sel ? 40 : Math.max(vesselSize(v).w, vesselSize(v).h, 28);
        const mk = L.marker(pos, {
          icon: L.divIcon({ html: sel ? vesselShipHTML(v, dim) : vesselTriangleHTML(v, sel, dim), className: "vessel-marker" + pairCls("vessel", v.id), iconSize: [box, box], iconAnchor: [box / 2, box / 2] }),
          riseOnHover: true,
        });
        mk.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (handlePairClick("vessel", v.id)) { onSelectVessel?.(v); return; }
          closePanels();
          setPopup({ kind: "vessel", data: v, ll: mk.getLatLng() });
          onSelectVessel?.(v);
        });
        cluster.addLayer(mk);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visCargos, visVessels, cargoOn, vesselsOn, focusedCargoId, focusedVesselId, ready, pairAnchor, pairDone, pairingEnabled, vesselVectors]);

  // Focused cargo → route + fit
  React.useEffect(() => {
    const map = mapRef.current;
    const route = routeRef.current;
    if (!map || !route || !ready) return;
    if (shipAnimRef.current != null) { cancelAnimationFrame(shipAnimRef.current); shipAnimRef.current = null; }
    route.clearLayers();
    const c = cargos.find((x) => x.id === focusedCargoId);
    if (!c) return;
    const pol = coordFor(c.route?.polCode);
    const pod = coordFor(c.route?.podCode);
    // No coordinates for one or both ends (backstop ports, or email-ingested
    // listings that carry a RANGE like "Egypt Med" instead of a port):
    //   1. a stored route may still know the exact geometry → draw it;
    //   2. else, different known zones → dashed zone-to-zone estimate;
    //   3. else nothing can honestly be drawn.
    if (!pol || !pod) {
      let cancelled = false;
      const zoneFallback = () => {
        if (cancelled) return;
        const zP = zoneByCode(c.route?.polZone);
        const zD = zoneByCode(c.route?.podZone);
        const cP = zP ? zoneCentroid(zP) : null;
        const cD = zD ? zoneCentroid(zD) : null;
        const zPol = pol ?? (cP ? ([cP[0], cP[1]] as [number, number]) : null);
        const zPod = pod ?? (cD ? ([cD[0], cD[1]] as [number, number]) : null);
        if (!zPol || !zPod || (zPol[0] === zPod[0] && zPol[1] === zPod[1])) {
          // Same-zone range or unknown zone — no honest lane to draw, but the
          // click still responds: fly to the trading area.
          const at = zPol ?? zPod;
          if (at) map.flyTo(at, 6, { duration: 1.0 });
          return;
        }
        const geo = routeGeometry({
          polCode: null, podCode: null, polLL: zPol, podLL: zPod,
          polZone: c.route?.polZone, podZone: c.route?.podZone,
        });
        if (geo && geo.pts.length >= 2) drawRoute(map, route, geo.pts as [number, number][], false, null, true, base, routeShipOn, shipAnimRef);
      };
      if (c.route?.polCode && c.route?.podCode) {
        (async () => {
          const stored = await getPortRoute(getSupabaseBrowserClient(), c.route?.polCode, c.route?.podCode);
          if (cancelled) return;
          if (stored && stored.waypoints.length >= 2) {
            const pts = stored.waypoints.map((w) => [Number(w[0]), Number(w[1])] as [number, number]);
            drawRoute(map, route, pts, stored.source.toUpperCase().startsWith("ECDIS"), Math.round(stored.totalNm), true, base, routeShipOn, shipAnimRef);
          } else {
            zoneFallback();
          }
        })();
      } else {
        zoneFallback();
      }
      return () => {
        cancelled = true;
        if (shipAnimRef.current != null) { cancelAnimationFrame(shipAnimRef.current); shipAnimRef.current = null; }
      };
    }

    // Draws the track (halo + line + end dots + NM chip) and optionally refits.
    const draw = (line: [number, number][], exact: boolean, nm: number | null, fit: boolean) =>
      drawRoute(map, route, line, exact, nm, fit, base, routeShipOn, shipAnimRef);

    // Resolve the best route ONCE, then draw ONCE — no estimated line that
    // gets replaced moments later. Bundled exact geometry draws immediately;
    // otherwise the stored route is awaited (typically <300ms) and only if
    // the DB has nothing does the corridor/arc estimate render.
    const geo =
      routeGeometry({
        polCode: c.route?.polCode,
        podCode: c.route?.podCode,
        polLL: pol,
        podLL: pod,
        polZone: c.route?.polZone,
        podZone: c.route?.podZone,
      }) ?? { pts: [pol, pod], nm: null, exact: false, source: "arc" as const };
    const estLine = geo.pts.length >= 2 ? (geo.pts as [number, number][]) : [pol, pod];

    let cancelled = false;
    if (geo.exact) {
      draw(estLine, true, geo.nm, true);
    } else if (c.route?.polCode && c.route?.podCode) {
      (async () => {
        const stored = await getPortRoute(getSupabaseBrowserClient(), c.route?.polCode, c.route?.podCode);
        if (cancelled) return;
        if (stored && stored.waypoints.length >= 2) {
          // stored geometry — solid "ECDIS" for measured, dashed for computed
          const pts = stored.waypoints.map((w) => [Number(w[0]), Number(w[1])] as [number, number]);
          draw(pts, stored.source.toUpperCase().startsWith("ECDIS"), Math.round(stored.totalNm), true);
        } else if (stored) {
          // distance-only row — corridor geometry with the calibrated distance
          draw(estLine, false, Math.round(stored.totalNm), true);
        } else {
          draw(estLine, false, geo.nm, true);
        }
      })();
    } else {
      draw(estLine, false, geo.nm, true);
    }
    return () => {
      cancelled = true;
      if (shipAnimRef.current != null) { cancelAnimationFrame(shipAnimRef.current); shipAnimRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCargoId, ready, base, routeShipOn]);

  // Focused vessel → deep flyTo down to the vessel itself, then open its card.
  const prevFocusVessel = React.useRef<string | null>(null);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const prev = prevFocusVessel.current;
    prevFocusVessel.current = focusedVesselId ?? null;
    const v = vessels.find((x) => x.id === focusedVesselId);
    if (!v) {
      // Toggle-off: close the card we opened for the previously focused vessel.
      if (prev) setPopup((p) => (p && p.kind === "vessel" && p.data.id === prev ? null : p));
      return;
    }
    let geo = vesselGeo(v);
    let zoom = 13;
    if (!geo) {
      // The position carries NO open location (some circular-sourced rows) —
      // fall back to the vessel's first preferred trading zone so the click
      // still answers, at zone scale instead of berth scale.
      const z = v.preferredZones?.[0] ? zoneByCode(v.preferredZones[0]) : null;
      const c = z ? zoneCentroid(z) : null;
      if (c) { geo = [c[0], c[1]]; zoom = 6; }
    }
    if (!geo) {
      toast.info("This position carries no open location — ask the owner to confirm where she opens.");
      return;
    }
    // Same anchored position as the marker, so the card points at the vessel.
    const pos = anchoredLL(geo, "sea", (v.id || "").charCodeAt(0) || 0, (v.id || "").charCodeAt(1) || 0);
    map.flyTo(pos, zoom, { duration: 1.2 });
    const onEnd = () => setPopup({ kind: "vessel", data: v, ll: L.latLng(pos[0], pos[1]) });
    map.once("moveend", onEnd);
    return () => {
      map.off("moveend", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedVesselId, ready]);

  // Match lines (P4): while a cargo's deal card is open, draw dashed lines to
  // its top matching tonnage — same eligibility gates as Top Matches/pairing.
  React.useEffect(() => {
    const lyr = matchLinesRef.current;
    if (!lyr || !ready) return;
    lyr.clearLayers();
    if (!popup || popup.kind !== "cargo") return;
    const c = popup.data;
    const from: [number, number] = [popup.ll.lat, popup.ll.lng];
    const rank: Record<string, number> = { Strong: 0, Good: 1 };
    const ms = visVessels
      .filter((v) => pairEligible(c, v))
      .map((v) => ({ v, fit: fitLabel(c, v) }))
      .sort((a, b) => (rank[a.fit] ?? 2) - (rank[b.fit] ?? 2))
      .slice(0, 3);
    for (const { v, fit } of ms) {
      const g = vesselGeo(v);
      if (!g) continue;
      const to = anchoredLL(g, "sea", (v.id || "").charCodeAt(0) || 0, (v.id || "").charCodeAt(1) || 0);
      const color = fit === "Strong" ? "#97C459" : fit === "Good" ? "#7BB8F0" : "#8C9BB5";
      L.polyline(curvePts(from, to, 0.12), { color, weight: 2, dashArray: "4 6", opacity: 0.85, interactive: false }).addTo(lyr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup, visVessels, ready]);

  // Trade-lane flows (P5): animated corridors for the busiest visible lanes —
  // the market's pulse, ShipMap-style, weighted by live listing volume.
  React.useEffect(() => {
    const lyr = flowsRef.current;
    if (!lyr || !ready) return;
    lyr.clearLayers();
    if (!flowsOn) return;
    const counts = new Map<string, number>();
    for (const c of visCargos) {
      const a = c.route?.polZone, b = c.route?.podZone;
      if (!a || !b || a === b) continue;
      counts.set(`${a}→${b}`, (counts.get(`${a}→${b}`) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
    const max = top[0]?.[1] ?? 1;
    for (const [lane, n] of top) {
      const [a, b] = lane.split("→");
      const za = zoneByCode(a), zb = zoneByCode(b);
      const ca = za ? zoneCentroid(za) : null, cb = zb ? zoneCentroid(zb) : null;
      if (!ca || !cb) continue;
      L.polyline(curvePts([ca[0], ca[1]], [cb[0], cb[1]], 0.22), {
        className: "flow-line",
        color: "#7BB8F0",
        weight: 1.5 + 2.5 * (n / max),
        opacity: 0.45,
        interactive: false,
      }).addTo(lyr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visCargos, flowsOn, ready]);

  // Deep links (P3): the open card writes #/cargo/{ref} · #/vessel/{id}, and
  // an arriving hash opens that listing once the data is on board.
  // The inbound hash must be captured at FIRST render — the popup-sync effect
  // below would otherwise clear it (popup starts null) before it can be read.
  const initialHash = React.useRef<string>(typeof window !== "undefined" ? window.location.hash : "");
  const hashHandled = React.useRef(!/^#\/(cargo|vessel)\//.test(initialHash.current));
  React.useEffect(() => {
    try {
      if (!popup) {
        if (hashHandled.current && window.location.hash.startsWith("#/"))
          history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
      const tag = popup.kind === "cargo"
        ? `#/cargo/${encodeURIComponent(popup.data.refId)}`
        : `#/vessel/${popup.data.id}`;
      history.replaceState(null, "", tag);
    } catch {}
  }, [popup]);
  React.useEffect(() => {
    if (hashHandled.current || !ready) return;
    const m = /^#\/(cargo|vessel)\/(.+)$/.exec(initialHash.current);
    if (!m) { hashHandled.current = true; return; }
    if (m[1] === "cargo") {
      const c = cargos.find((x) => x.refId === decodeURIComponent(m[2]));
      if (!c) return; // data may still be loading — retry on next change
      hashHandled.current = true;
      const g = geoFor(c.route?.polCode);
      const ll = g ? anchoredLL(g, "land", (c.id || "").charCodeAt(0) || 0, (c.id || "").charCodeAt(1) || 0) : null;
      setPopup({ kind: "cargo", data: c, ll: ll ? L.latLng(ll[0], ll[1]) : L.latLng(24, 40) });
      onSelectCargo?.(c);
    } else {
      const v = vessels.find((x) => x.id === m[2]);
      if (!v) return;
      hashHandled.current = true;
      onSelectVessel?.(v); // focus effect deep-zooms and opens the card
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cargos, vessels]);

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



  const BarIcon = ({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
    <div className={`bar-icon${on ? " active" : ""}`} onClick={onClick}>
      {children}
      <span className="tooltip-l">{title}</span>
    </div>
  );

  return (
    <div ref={rootRef} data-zoom="far" className={`asb-map base-${base}${(basePickerOpen || layersOpen || searchOpen || filtersOpen || voyOpen) ? " panel-open" : ""}${namesOn ? "" : " names-off"}${barLeft ? " bar-inner-left" : ""}${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="map-canvas">
        <div ref={hostRef} className="leaflet-host" />

        <div className="map-title">
          Arab ShipBroker Platform <span className="map-title__beta">BETA</span>
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
          <div className={`layer-pill ${routeShipOn ? "on" : "off"}`} onClick={toggleRouteShip}
            title="Animate a ship along the focused cargo's route">
            <span className="pill-dot" style={{ background: "#F97316" }} /> Ship
          </div>
        </div>

        {popup && (
          <DealCard
            popup={popup}
            cargoList={visCargos}
            vesselList={visVessels}
            onClose={() => setPopup(null)}
            onStep={(dir) => {
              const list = popup.kind === "cargo" ? visCargos : visVessels;
              const i = list.findIndex((x) => x.id === popup.data.id);
              if (i < 0 || list.length < 2) return;
              const next = list[(i + dir + list.length) % list.length];
              if (popup.kind === "cargo") {
                const c = next as CargoView;
                const g = geoFor(c.route?.polCode);
                const ll = g ? anchoredLL(g, "land", (c.id || "").charCodeAt(0) || 0, (c.id || "").charCodeAt(1) || 0) : null;
                setPopup({ kind: "cargo", data: c, ll: ll ? L.latLng(ll[0], ll[1]) : popup.ll });
                onSelectCargo?.(c);
              } else {
                const v = next as VesselView;
                const g = vesselGeo(v);
                const ll = g ? anchoredLL(g, "sea", (v.id || "").charCodeAt(0) || 0, (v.id || "").charCodeAt(1) || 0) : null;
                setPopup({ kind: "vessel", data: v, ll: ll ? L.latLng(ll[0], ll[1]) : popup.ll });
                onSelectVessel?.(v);
              }
            }}
            onPickVessel={(v) => {
              const g = vesselGeo(v);
              const ll = g ? anchoredLL(g, "sea", (v.id || "").charCodeAt(0) || 0, (v.id || "").charCodeAt(1) || 0) : null;
              if (ll) setPopup({ kind: "vessel", data: v, ll: L.latLng(ll[0], ll[1]) });
              onSelectVessel?.(v);
            }}
            onVoyOpex={() => {
              if (voyLocked) { toast.info("Voy OPEX is a Subscriber (T3+) tool."); return; }
              setVoyOpen(true);
            }}
            onCopyLink={() => {
              try {
                navigator.clipboard.writeText(window.location.href);
                toast.success("Link copied — opens the map centred on this listing.");
              } catch { toast.error("Could not copy the link."); }
            }}
          />
        )}
      </div>

      <div className="right-bar">
        {/* Region chips — moved from the top-left strip to the control bar */}
        {[["A.Gulf", "AG"], ["R.Sea", "RS"], ["E.Med", "EM"], ["B.Sea", "BS"]].map(([full, short]) => (
          <div key={full} className="bar-zone" title={full}>{short}</div>
        ))}
        <div className="bar-divider" />
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
        <BarIcon on={routeShipOn} onClick={toggleRouteShip} title="Animated ship on the focused route">
          {G.ship}
        </BarIcon>
        <div className="bar-divider" />
        <BarIcon on={layersOpen} onClick={() => { const n = !layersOpen; closePanels(); setLayersOpen(n); }} title="Layers — what the chart shows">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 8l10 5 10-5-10-5Z" /><path d="m2 13 10 5 10-5" /><path d="m2 18 10 5 10-5" opacity=".55" /></svg>
        </BarIcon>
        <BarIcon on={searchOpen} onClick={() => { const n = !searchOpen; closePanels(); setSearchOpen(n); }} title="Search — jump to a port, vessel or cargo">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
        </BarIcon>
        <BarIcon on={filtersOpen} onClick={() => { const n = !filtersOpen; closePanels(); setFiltersOpen(n); }} title="Filters">
          {G.filter}
          {Object.values(selections).some((s) => s.size > 0) && <span className="bar-badge bar-badge--cargo" />}
        </BarIcon>
        {layersOpen && (
          <div className="map-flyout" style={{ bottom: "auto", top: 46 }} onClick={(e) => e.stopPropagation()}>
            <div className="base-picker__title">Chart layers</div>
            {[
              { label: "Cargo positions", on: cargoOn, set: () => setCargoOn((v) => !v), dot: "#97C459" },
              { label: "Open tonnage", on: vesselsOn, set: () => setVesselsOn((v) => !v), dot: "#7BB8F0" },
              { label: "Trading zones", on: zonesOn, set: () => setZonesOn((v) => !v), dot: "#EF9F27" },
              { label: "Route ship animation", on: routeShipOn, set: toggleRouteShip, dot: "#F97316" },
              { label: "Trade-lane flows", on: flowsOn, set: () => setFlowsOn((v) => !v), dot: "#7BB8F0" },
              { label: "Vessel names", on: namesOn, set: () => setNamesOn((v) => !v), dot: "#B8C4D4" },
            ].map((r) => (
              <button key={r.label} className="map-flyout__row" onClick={r.set}>
                <span className="map-flyout__dot" style={{ background: r.dot, opacity: r.on ? 1 : 0.25 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{r.label}</span>
                <span className={`map-switch${r.on ? " is-on" : ""}`}><i /></span>
              </button>
            ))}
          </div>
        )}
        {searchOpen && (
          <div className="map-flyout map-flyout--wide" style={{ bottom: "auto", top: 84 }} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="map-flyout__input"
              placeholder="Port, vessel or cargo…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ.trim().length >= 2 && (() => {
              const q = searchQ.trim().toLowerCase();
              const portHits = Object.entries({ ...FALLBACK_PORTS, ...(portCoords ?? {}) })
                .filter(([code]) => code.toLowerCase().includes(q))
                .slice(0, 5);
              const vesselHits = vessels.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 5);
              const cargoHits = cargos.filter((c) =>
                (c.commodity || c.cargo || "").toLowerCase().includes(q) || c.refId.toLowerCase().includes(q)).slice(0, 5);
              const none = !portHits.length && !vesselHits.length && !cargoHits.length;
              return (
                <div className="map-flyout__results">
                  {portHits.length > 0 && <div className="map-flyout__group">Ports</div>}
                  {portHits.map(([code, geo]) => (
                    <button key={code} className="map-flyout__row" onClick={() => {
                      mapRef.current?.flyTo([geo[0], geo[1]], 9, { duration: 1.1 });
                      setSearchOpen(false);
                    }}>
                      <span className="mono" style={{ fontSize: 11 }}>{code}</span>
                    </button>
                  ))}
                  {vesselHits.length > 0 && <div className="map-flyout__group">Vessels</div>}
                  {vesselHits.map((v) => (
                    <button key={v.id} className="map-flyout__row" onClick={() => { onSelectVessel?.(v); setSearchOpen(false); }}>
                      <span style={{ flex: 1, textAlign: "left" }}>{v.name}</span>
                      <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>{v.dwt} DWT</span>
                    </button>
                  ))}
                  {cargoHits.length > 0 && <div className="map-flyout__group">Cargo</div>}
                  {cargoHits.map((c) => (
                    <button key={c.id} className="map-flyout__row" onClick={() => { onSelectCargo?.(c); setSearchOpen(false); }}>
                      <span style={{ flex: 1, textAlign: "left" }}>{c.cargo}</span>
                      <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>{c.route.polZone}→{c.route.podZone}</span>
                    </button>
                  ))}
                  {none && <div className="map-flyout__group">No matches</div>}
                </div>
              );
            })()}
          </div>
        )}
        <BarIcon
          on={voyOpen && !voyLocked}
          onClick={() => { if (voyLocked) return; const n = !voyOpen; closePanels(); setVoyOpen(n); }}
          title={voyLocked ? "Voy OPEX — upgrade to Subscriber (T3) to unlock" : "Voy OPEX estimator"}
        >
          {voyLocked ? G.lock : G.voy}
        </BarIcon>
        <div className="bar-spacer" />
        <div className="bar-divider" />
        <BarIcon on={basePickerOpen} onClick={() => { const n = !basePickerOpen; closePanels(); setBasePickerOpen(n); }} title="Basemap — choose the chart style">
          {isDarkish(base) ? G.moon : G.sun}
        </BarIcon>
        {basePickerOpen && (
          <div className="base-picker" onClick={(e) => e.stopPropagation()}>
            <div className="base-picker__title">Chart style</div>
            {(Object.keys(BASES) as MapBase[]).map((b) => (
              <button
                key={b}
                className={`base-picker__opt${b === base ? " is-on" : ""}`}
                title={BASES[b].hint}
                onClick={() => { setBase(b); setBasePickerOpen(false); }}
              >
                <span className={`base-picker__dot bp-${b}`} />
                {BASES[b].label}
                {b === base && <span className="base-picker__check">✓</span>}
              </button>
            ))}
          </div>
        )}
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

      {/* Armed-pairing hint (09 §8) — visible legend state while anchored. */}
      {pairingEnabled && pairAnchor && !pairDone && (
        <div className="dash-pair-hint" onClick={(e) => e.stopPropagation()}>
          <span className="dash-pair-hint__dot" />
          {pairAnchor.kind === "cargo"
            ? <>Cargo anchored — click a <strong>highlighted vessel</strong> to estimate the pairing</>
            : <>Vessel anchored — click a <strong>highlighted cargo</strong> to estimate the pairing</>}
          <button type="button" onClick={clearPairing} aria-label="Clear">✕</button>
        </div>
      )}

      {pairDone && (
        <div className="pair-card">
          <div className="pair-card__head">
            <span className="pair-card__ttl">Pairing</span>
            <button type="button" className="pair-card__close" aria-label="Clear pairing" onClick={clearPairing}>×</button>
          </div>
          <div className="pair-card__route">{pairDone.cargo.cargo} · <span className="mono">{pairDone.cargo.refId}</span></div>
          {(() => {
            const band = fitLabel(pairDone.cargo, pairDone.vessel);
            return (
              <>
                <div className="pair-card__to">→ {pairDone.vessel.name}</div>
                <div className={`pair-band band-${band.toLowerCase()}`}>{band} fit</div>
                <div className="pair-card__chips">
                  <span>{pairDone.vessel.type}</span>
                  <span>{pairDone.vessel.dwt} DWT</span>
                  <span>{pairDone.vessel.openPortZone}</span>
                </div>
                <div className="pair-card__note">
                  Indicative fit label via Arab ShipBroker — open the Voyage
                  Estimator for full economics. No counterparty contact is shared.
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Deal card — the docked listing card (SeaRates-style) ────────────────────
// Replaces the small anchored popup: full details, ‹ › carousel through the
// filtered market, inline top matches (same gates as Top Matches / pairing),
// and actions — all without leaving the chart.
function DealCard({
  popup,
  cargoList,
  vesselList,
  onClose,
  onStep,
  onPickVessel,
  onVoyOpex,
  onCopyLink,
}: {
  popup: Popup;
  cargoList: CargoView[];
  vesselList: VesselView[];
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  onPickVessel: (v: VesselView) => void;
  onVoyOpex: () => void;
  onCopyLink: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const list = popup.kind === "cargo" ? cargoList : vesselList;
  const idx = list.findIndex((x) => x.id === popup.data.id);
  const matches = React.useMemo(() => {
    if (popup.kind !== "cargo") return [];
    const c = popup.data;
    const rank: Record<string, number> = { Strong: 0, Good: 1 };
    return vesselList
      .filter((v) => pairEligible(c, v))
      .map((v) => ({ v, fit: fitLabel(c, v) }))
      .sort((a, b) => (rank[a.fit] ?? 2) - (rank[b.fit] ?? 2))
      .slice(0, 3);
  }, [popup, vesselList]);

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="deal-card__row"><span className="deal-card__k">{k}</span><span className="deal-card__v">{v}</span></div>
  );

  return (
    <div className="deal-card" onClick={stop} onMouseDown={stop} onDoubleClick={stop} onWheel={stop}>
      <div className="deal-card__head">
        <button className="deal-card__nav" onClick={() => onStep(-1)} title="Previous listing">‹</button>
        <div className="deal-card__headmid">
          <div className="deal-card__title">{popup.kind === "cargo" ? popup.data.cargo : popup.data.name}</div>
          {idx >= 0 && <div className="deal-card__count">{idx + 1} / {list.length}</div>}
        </div>
        <button className="deal-card__nav" onClick={() => onStep(1)} title="Next listing">›</button>
        <button className="deal-card__close" onClick={onClose}>×</button>
      </div>

      {popup.kind === "cargo" ? (() => {
        const c = popup.data;
        const hasPorts = !!(c.route.polCode && c.route.podCode);
        return (
          <div className="deal-card__body">
            <div className="deal-card__tags">
              <span className="deal-card__tag">{c.type}</span>
              {c.spot && <span className="deal-card__tag is-spot">SPOT</span>}
              {postedAgeLabel(c.postedAt) && <span className="deal-card__tag is-age">{postedAgeLabel(c.postedAt)}</span>}
            </div>
            <Row k="Route" v={hasPorts
              ? <>{c.route.polCode} → {c.route.podCode} <span className="deal-card__dim">{c.route.polZone} → {c.route.podZone}</span></>
              : <>{c.route.polZone || "—"} → {c.route.podZone || "—"}</>} />
            <Row k="Laycan" v={c.spot ? "SPOT" : formatLaycanRange(c.laycanFrom, c.laycanTo)} />
            <Row k="Quantity" v={`${c.qtyMt} MT${c.sf != null ? ` · SF ${c.sf} m³/t` : ""}`} />
            {(c.loadRate != null || c.dischRate != null) && (
              <Row k="Rates" v={`${c.loadRate ?? "—"} / ${c.dischRate ?? "—"}${c.loadTerms ? ` · ${c.loadTerms}` : ""}`} />
            )}
            {c.freightIdea != null && (
              <Row k="Freight idea" v={`$${c.freightIdea}/MT${c.commission != null ? ` · ${c.commission}%` : ""}`} />
            )}
            {matches.length > 0 && (
              <div className="deal-card__matches">
                <div className="deal-card__mtitle">Top matching tonnage</div>
                {matches.map(({ v, fit }) => (
                  <button key={v.id} className="deal-card__match" onClick={() => onPickVessel(v)}>
                    <span className={`deal-card__fit fit-${fit.toLowerCase()}`}>{fit}</span>
                    <span className="deal-card__mname">{v.name}</span>
                    <span className="deal-card__dim">{v.dwt} DWT</span>
                  </button>
                ))}
              </div>
            )}
            <div className="deal-card__actions">
              <button className="deal-card__btn" onClick={onVoyOpex}>Voy OPEX</button>
              <button className="deal-card__btn deal-card__btn--ghost" onClick={onCopyLink}>Copy link</button>
            </div>
          </div>
        );
      })() : (() => {
        const v = popup.data;
        const fc = flagCode(v.flag);
        return (
          <div className="deal-card__body">
            <div className="deal-card__tags">
              <span className="deal-card__tag">{v.type}</span>
              <span className={`deal-card__tag ${v.status === "open" ? "is-open" : ""}`}>{v.status.toUpperCase()}</span>
              {postedAgeLabel(v.postedAt) && <span className="deal-card__tag is-age">{postedAgeLabel(v.postedAt)}</span>}
            </div>
            <Row k="DWT" v={`${v.dwt} MT${v.built ? ` · Built ${v.built}` : ""} · ${v.geared ? "Geared" : "Gearless"}`} />
            {v.flag && v.flag !== "—" && (
              <Row k="Flag" v={<>{fc && <span className={`fi fi-${fc}`} style={{ fontSize: 11, borderRadius: 2, marginRight: 5 }} aria-hidden />}{v.flag}</>} />
            )}
            <Row k="Open" v={`${v.openPort !== "—" ? v.openPort : v.openPortZone} · ${formatShortDate(v.openDate)}`} />
            {v.preferredZones && v.preferredZones.length > 0 && (
              <Row k="Prefers" v={v.preferredZones.join(" · ")} />
            )}
            <div className="deal-card__actions">
              <button className="deal-card__btn" onClick={onVoyOpex}>Voy OPEX</button>
              <button className="deal-card__btn deal-card__btn--ghost" onClick={onCopyLink}>Copy link</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
