"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Map as MapIcon, X } from "lucide-react";

import { VesselCard, type VesselCardData } from "@/components/vessels/VesselCard";
import {
  useMapBase,
  MapBaseToggle,
  type MapPoint,
} from "@/components/map/SharedMap";

// Leaflet is browser-only — load the map with SSR disabled.
const SharedMap = dynamic(
  () => import("@/components/map/SharedMap").then((m) => m.SharedMap),
  { ssr: false },
);

/**
 * My Vessels fleet board — cards on the left, shared map on the right (50/50).
 * Selecting a card reframes the map; clicking a marker selects its card.
 * "Hide map" collapses to a full-width card grid. Identity stays masked at the
 * card layer; the map plots only open-position coordinates (no contact).
 */
export function FleetBoard({
  vessels,
  points,
}: {
  vessels: VesselCardData[];
  points: MapPoint[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [base, setBase] = useMapBase();

  const hasMap = showMap && points.length > 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        {hasMap && <MapBaseToggle base={base} setBase={setBase} />}
        <button
          type="button"
          onClick={() => setShowMap((s) => !s)}
          disabled={points.length === 0}
          className="inline-flex items-center gap-1.5 rounded border border-asb-gray-200 bg-asb-white px-3 py-1.5 text-xs font-medium text-asb-gray-700 transition-colors hover:bg-asb-gray-50 disabled:opacity-40"
          title={
            points.length === 0
              ? "No positions with coordinates to map"
              : undefined
          }
        >
          {showMap ? <X className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />}
          {showMap ? "Hide map" : "Show map"}
        </button>
      </div>

      <div className="flex items-start gap-4 max-[900px]:flex-col">
        <div className={hasMap ? "w-1/2 max-[900px]:w-full" : "w-full"}>
          <div
            className="mvb-cardhost"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${hasMap ? 265 : 290}px, 1fr))`,
            }}
          >
            {vessels.map((v) => (
              <VesselCard
                key={v.imo}
                vessel={v}
                selected={selected === v.imo}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>

        {hasMap && (
          <div className="sticky top-4 h-[calc(100vh-140px)] w-1/2 max-[900px]:static max-[900px]:h-[60vh] max-[900px]:w-full">
            <SharedMap
              points={points}
              selectedId={selected}
              onSelect={setSelected}
              base={base}
              className="h-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
