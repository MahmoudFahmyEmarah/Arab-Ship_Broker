"use client";

// FleetMap — the light Leaflet fleet decision-map from the Claude design
// (asb/my-vessels-board.jsx): AIS ship silhouettes at each open port, a curved
// dashed vector toward the vessel's preferred-trade zone, broker-zone shading,
// layer toggles + zone filter, light/dark base, and framing on card select.
// Loaded client-only via next/dynamic(ssr:false) by the board.
import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@/lib/portal/fleet.css";
import { FLEET_ZONES, zoneCentroid } from "@/lib/portal/zones";
import type { FleetVM } from "./FleetVesselCard";

export interface CargoPin { label: string; port: string; lat: number; lon: number }

const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: "© OpenStreetMap contributors © CARTO",
  subdomains: "abcd",
};

// Geographic bearing a→b (degrees clockwise from north).
function bearing(a: [number, number], b: [number, number]): number {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const f1 = a[0] * toR, f2 = b[0] * toR, dl = (b[1] - a[1]) * toR;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * toD + 360) % 360;
}
// Quadratic-bezier sample points for a gently curved route a→b.
function curvePts(a: [number, number], b: [number, number], bend = 0.18): [number, number][] {
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ctrl: [number, number] = [mid[0] + (b[1] - a[1]) * bend, mid[1] - (b[0] - a[0]) * bend];
  const out: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1],
    ]);
  }
  return out;
}
function shipSVG(fill: string): string {
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
    <path d="M12 1.5 L17 9 L17 18.5 L12 22 L7 18.5 L7 9 Z" fill="${fill}" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="12" cy="10.5" r="1.5" fill="#FFFFFF"/>
  </svg>`;
}
function shipIcon(v: FleetVM, isSel: boolean, dim: boolean, brg: number) {
  const size = isSel ? 32 : 25;
  const fill = isSel ? "#2A6FDB" : "#0D2545";
  return L.divIcon({
    className: "mvb-ais-wrap",
    html:
      `<div class="mvb-ais${isSel ? " is-sel" : ""}${dim ? " is-dim" : ""}" style="width:${size}px;height:${size}px;transform:rotate(${brg}deg);">${shipSVG(fill)}</div>` +
      `<div class="mvb-ais__lbl${dim ? " is-dim" : ""}">${v.name}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
function arrowIcon(brg: number, color: string, dim: boolean) {
  return L.divIcon({
    className: "mvb-arrow-wrap",
    html: `<div class="mvb-arrow${dim ? " is-dim" : ""}" style="transform:rotate(${brg}deg);border-bottom-color:${color};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}
function cargoIcon(label: string) {
  return L.divIcon({
    className: "mvb-cargo-wrap",
    html:
      `<div class="mvb-cargo-pin"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg></div>` +
      `<div class="mvb-cargo-lbl">${label}</div>`,
    iconSize: [22, 28],
    iconAnchor: [11, 28],
  });
}

function useMapBase(): ["light" | "dark", (b: "light" | "dark") => void] {
  const [base, setBase] = React.useState<"light" | "dark">("light");
  React.useEffect(() => {
    try {
      const v = localStorage.getItem("asb:mapBase");
      if (v === "light" || v === "dark") setBase(v);
    } catch {}
  }, []);
  const set = (b: "light" | "dark") => {
    setBase(b);
    try { localStorage.setItem("asb:mapBase", b); } catch {}
  };
  return [base, set];
}

type LayerKey = "vessels" | "cargo" | "zones";

export default function FleetMap({
  posted,
  undeclaredCount,
  selected,
  matchesByVessel,
}: {
  posted: FleetVM[];
  undeclaredCount: number;
  selected: string | null;
  matchesByVessel?: Record<string, CargoPin[]>;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerRef = React.useRef<L.LayerGroup | null>(null);
  const baseRef = React.useRef<L.TileLayer | null>(null);
  const ctrlRef = React.useRef<HTMLDivElement>(null);
  const roRef = React.useRef<ResizeObserver | null>(null);
  const [ready, setReady] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [show, setShow] = React.useState<Record<LayerKey, boolean>>({ vessels: true, cargo: true, zones: true });
  const [activeZone, setActiveZone] = React.useState<string | null>(null);
  // Compact map control: collapsed by default (a single Layers button) so the
  // map reads clean — the full Base/Layers/Zone panel opens on demand.
  const [ctrlOpen, setCtrlOpen] = React.useState(false);

  // Fullscreen: reflow Leaflet after the size change; Esc exits.
  React.useEffect(() => {
    const t = setTimeout(() => { try { mapRef.current?.invalidateSize(); } catch {} }, 240);
    return () => clearTimeout(t);
  }, [fullscreen]);
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  const [base, setBase] = useMapBase();

  const sel = posted.find((v) => v.id === selected) || null;

  // Init once.
  React.useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      center: [30, 36], zoom: 5, minZoom: 2, maxZoom: 18,
      zoomControl: true, attributionControl: true, worldCopyJump: false,
    });
    try { map.attributionControl.setPrefix(false); } catch {}
    mapRef.current = map;
    setReady(true);
    const t = setTimeout(() => { try { map.invalidateSize(); } catch {} }, 220);
    // Re-measure on container resize (fixes Leaflet-in-flex gray gap).
    const ro = new ResizeObserver(() => { try { mapRef.current?.invalidateSize(); } catch {} });
    ro.observe(hostRef.current);
    roRef.current = ro;
    return () => clearTimeout(t);
  }, []);

  React.useEffect(
    () => () => {
      try { roRef.current?.disconnect(); mapRef.current?.remove(); } catch {}
      roRef.current = null;
      mapRef.current = null;
    },
    [],
  );

  // Base tiles (swap on light/dark).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (baseRef.current) { try { map.removeLayer(baseRef.current); } catch {} }
    baseRef.current = L.tileLayer(base === "dark" ? TILES.dark : TILES.light, {
      attribution: TILES.attribution, maxZoom: 18, subdomains: TILES.subdomains,
    }).addTo(map);
    try { baseRef.current.bringToBack(); } catch {}
  }, [base, ready]);

  // Keep the control panel from panning/zooming the map underneath.
  React.useEffect(() => {
    if (ctrlRef.current) {
      L.DomEvent.disableClickPropagation(ctrlRef.current);
      L.DomEvent.disableScrollPropagation(ctrlRef.current);
    }
  }, [ready]);

  // (Re)draw zones, vessels + direction vectors, and matched-cargo pins.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    const g = L.layerGroup().addTo(map);
    layerRef.current = g;

    if (show.zones) {
      FLEET_ZONES.forEach((z) => {
        const active = activeZone === z.label;
        L.rectangle(z.bounds, {
          color: z.color, weight: active ? 1.5 : 1,
          opacity: active ? 0.9 : 0.45,
          fillColor: z.color, fillOpacity: active ? 0.22 : 0.06,
          dashArray: active ? undefined : "5 4", interactive: false,
        }).addTo(g);
        const c = L.latLng(...zoneCentroid(z));
        L.marker(c, {
          interactive: false,
          icon: L.divIcon({
            className: "mvb-zone-lbl-wrap",
            html: `<div class="mvb-zone-lbl${active ? " is-active" : ""}" style="color:${z.color}">${z.label}</div>`,
            iconSize: [88, 14], iconAnchor: [44, 7],
          }),
        }).addTo(g);
      });
    }

    if (show.vessels) {
      posted.forEach((v) => {
        if (v.lat == null || v.lon == null) return;
        const isSel = v.id === selected;
        const dim = !!selected && !isSel;
        const line = isSel ? "#2A6FDB" : "#8C9BB5";
        const a: [number, number] = [v.lat, v.lon];
        const hasVec = v.dlat != null && v.dlon != null && (v.dlat !== v.lat || v.dlon !== v.lon);
        if (hasVec) {
          const b: [number, number] = [v.dlat as number, v.dlon as number];
          const pts = curvePts(a, b);
          L.polyline(pts, {
            color: line, weight: isSel ? 3 : 2, dashArray: "7 7",
            opacity: dim ? 0.3 : 0.85, interactive: false,
          }).addTo(g);
          const endBrg = bearing(pts[pts.length - 2], pts[pts.length - 1]);
          L.marker(b, { interactive: false, icon: arrowIcon(endBrg, line, dim) }).addTo(g);
        }
        const shipBrg = hasVec ? bearing(a, [v.dlat as number, v.dlon as number]) : 0;
        const m = L.marker(a, { icon: shipIcon(v, isSel, dim, shipBrg), riseOnHover: true, zIndexOffset: isSel ? 1000 : 0 });
        m.bindTooltip(`${v.name} · ${v.port ?? ""}${v.dir ? ` → ${v.dir}` : ""}`, { direction: "top", offset: [0, -14] });
        if (isSel) m.openTooltip();
        m.addTo(g);
      });
    }

    if (show.cargo && sel && matchesByVessel?.[sel.id]?.length) {
      matchesByVessel[sel.id].forEach((cg) => {
        L.marker([cg.lat, cg.lon], { icon: cargoIcon(cg.label), riseOnHover: true, zIndexOffset: 1200 })
          .bindTooltip(`${cg.label} · loads ${cg.port}`, { direction: "top", offset: [0, -24] })
          .addTo(g);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posted, selected, ready, show, activeZone]);

  // Framing on selection / zone-filter change (not on layer toggles).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (sel && sel.lat != null && sel.lon != null) {
      const pts: [number, number][] = [[sel.lat, sel.lon]];
      if (sel.dlat != null && sel.dlon != null) pts.push([sel.dlat, sel.dlon]);
      if (show.cargo && matchesByVessel?.[sel.id]) matchesByVessel[sel.id].forEach((cg) => pts.push([cg.lat, cg.lon]));
      try { map.fitBounds(L.latLngBounds(pts).pad(0.45), { animate: true, maxZoom: 7 }); } catch {}
    } else if (activeZone) {
      const z = FLEET_ZONES.find((x) => x.label === activeZone);
      if (z) try { map.fitBounds(z.bounds, { animate: true, padding: [40, 40] }); } catch {}
    } else if (posted.length) {
      const pts = posted
        .filter((v) => v.lat != null && v.lon != null)
        .flatMap((v) => {
          const arr: [number, number][] = [[v.lat as number, v.lon as number]];
          if (v.dlat != null && v.dlon != null) arr.push([v.dlat, v.dlon]);
          return arr;
        });
      if (pts.length) try { map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: true }); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, activeZone, ready]);

  const LAYERS: [LayerKey, string][] = [["vessels", "Vessels"], ["cargo", "Cargo"], ["zones", "Zones"]];

  return (
    <div className={"mvb-fmap base-" + base + (fullscreen ? " is-fullscreen" : "")}>
      <div className="mvb-fmap__bar">
        <span className="mvb-fmap__ttl">Fleet positions</span>
        <span className="mvb-fmap__rep">Open port + preferred-trade direction · select a card to frame</span>
        <button
          type="button"
          className="mvb-fmap__fs"
          title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => setFullscreen((f) => !f)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {fullscreen ? (
              <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M16 21v-3a2 2 0 0 1 2-2h3M8 21v-3a2 2 0 0 0-2-2H3" />
            ) : (
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
            )}
          </svg>
        </button>
      </div>
      <div className="mvb-fmap__canvas mvb-fmap__canvas--leaflet">
        <div ref={hostRef} className="mvb-fmap__leaflet" />

        <div className={"mvb-fmap__ctrl" + (ctrlOpen ? " is-open" : "")} ref={ctrlRef}>
          <button
            type="button"
            className={"mvb-fmap__ctoggle" + (ctrlOpen ? " is-open" : "")}
            aria-expanded={ctrlOpen}
            onClick={() => setCtrlOpen((o) => !o)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
            </svg>
            Layers{activeZone ? ` · ${activeZone}` : ""}
            <span className="mvb-fmap__caret">{ctrlOpen ? "▾" : "▸"}</span>
          </button>
          {ctrlOpen && (
            <div className="mvb-fmap__panel">
              <div className="mvb-fmap__cgrp">
                <div className="mvb-fmap__ch">Base</div>
                <div className="mvb-fmap__lyrs">
                  <button type="button" className={"mvb-lyr" + (base === "light" ? " on" : "")} onClick={() => setBase("light")}>Light</button>
                  <button type="button" className={"mvb-lyr" + (base === "dark" ? " on" : "")} onClick={() => setBase("dark")}>Dark</button>
                </div>
              </div>
              <div className="mvb-fmap__cgrp">
                <div className="mvb-fmap__ch">Layers</div>
                <div className="mvb-fmap__lyrs">
                  {LAYERS.map(([k, lbl]) => (
                    <button key={k} type="button" className={"mvb-lyr" + (show[k] ? " on" : "")} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
                      <span className={"dot dot--" + k} />{lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mvb-fmap__cgrp">
                <div className="mvb-fmap__ch">Zone filter</div>
                <div className="mvb-fmap__zones">
                  {FLEET_ZONES.map((z) => (
                    <button key={z.code} type="button" className={"mvb-zchip" + (activeZone === z.label ? " on" : "")}
                      onClick={() => { setActiveZone((a) => (a === z.label ? null : z.label)); setShow((s) => ({ ...s, zones: true })); }}>
                      <span className="sw" style={{ background: z.color }} />{z.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mvb-fmap__legend">
          <div className="lg"><span className="lg-ship" /> Vessel</div>
          <div className="lg"><span className="lg-cargo" /> Cargo</div>
          <div className="lg"><span className="lg-arrow" /> Preferred direction</div>
        </div>

        <div className="mvb-fmap__undecl">
          <span className="dots"><i /><i /><i /></span>
          {undeclaredCount} vessel{undeclaredCount === 1 ? "" : "s"}, no position declared
        </div>
        {sel && <div className="mvb-fmap__framed">Framed to <b>{sel.name}</b>: {sel.port}{sel.dir ? ` → ${sel.dir}` : ""}</div>}
      </div>
    </div>
  );
}
