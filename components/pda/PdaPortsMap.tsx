"use client";

// PDA · Ports workspace map (increment C). Client-only (loaded through next/dynamic with ssr:false): one pin per port
// SHOWN in the table, filled where a published tariff is in force. The map follows the search and the scope filter.
// Same light basemap and attribution as the portal market map.
import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { PdaWorkspacePort } from "@/lib/pda/ports-workspace";

const BASEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

export default function PdaPortsMap({
  ports,
  selected,
  onSelect,
}: {
  ports: readonly PdaWorkspacePort[];
  selected: string | null;
  onSelect: (locode: string) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const layerRef = React.useRef<L.LayerGroup | null>(null);
  const fittedRef = React.useRef<readonly PdaWorkspacePort[] | null>(null);
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;

  React.useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { center: [24, 45], zoom: 4, minZoom: 2, maxZoom: 12, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer(BASEMAP, { maxNativeZoom: 16, attribution: "© Esri · © OpenStreetMap contributors" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points: L.LatLngTuple[] = [];
    for (const port of ports) {
      if (port.latitude == null || port.longitude == null) continue;
      const held = port.tariffs.length > 0;
      const isSelected = port.locode === selected;
      const size = isSelected ? 16 : held ? 12 : 9;
      const icon = L.divIcon({
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<span class="pda-ports-pin${held ? " is-held" : ""}${isSelected ? " is-selected" : ""}" style="width:${size}px;height:${size}px"></span>`,
      });
      const marker = L.marker([port.latitude, port.longitude], { icon, keyboard: false, title: `${port.name} · ${port.locode}` });
      marker.on("click", () => onSelectRef.current(port.locode));
      marker.addTo(layer);
      points.push([port.latitude, port.longitude]);
    }
    // fit only when the SET of shown ports changes (search/filter), never on a selection: the view must not jump
    if (fittedRef.current === ports) return;
    fittedRef.current = ports;
    const fit = () => {
      map.invalidateSize();
      if (points.length) map.fitBounds(points, { padding: [28, 28], maxZoom: 8 });
    };
    fit();
    // the tab can mount before its pane has its final size: fit once more after layout
    const timer = window.setTimeout(fit, 90);
    return () => window.clearTimeout(timer);
  }, [ports, selected]);

  return <div ref={hostRef} className="pda-ports__map" role="img" aria-label="Map of the ports shown below; filled pins hold a published tariff" />;
}
