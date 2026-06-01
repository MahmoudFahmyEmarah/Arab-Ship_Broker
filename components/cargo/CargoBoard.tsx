"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Map as MapIcon, X } from "lucide-react";

import { CargoCard } from "@/components/cargo/CargoCard";
import type { CargoListingRow } from "@/lib/schemas/cargo";
import {
  useMapBase,
  MapBaseToggle,
  type MapPoint,
} from "@/components/map/SharedMap";

const SharedMap = dynamic(
  () => import("@/components/map/SharedMap").then((m) => m.SharedMap),
  { ssr: false },
);

/**
 * Cargo Market board — cards on the left, shared map on the right (50/50).
 * Cards are plotted at their LOAD port; selecting a card reframes the map and
 * vice versa. "Hide map" collapses to a full-width grid. Cards carry no
 * counterparty contact (firewall holds at the card layer).
 */
export function CargoBoard({
  cargos,
  points,
}: {
  cargos: CargoListingRow[];
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
          title={points.length === 0 ? "No cargoes with mappable load ports" : undefined}
        >
          {showMap ? <X className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />}
          {showMap ? "Hide map" : "Show map"}
        </button>
      </div>

      <div className="flex items-start gap-4 max-[900px]:flex-col">
        <div className={hasMap ? "w-1/2 max-[900px]:w-full" : "w-full"}>
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${hasMap ? 270 : 285}px, 1fr))`,
            }}
          >
            {cargos.map((cargo) => (
              <CargoCard
                key={cargo.id}
                cargo={cargo}
                selected={selected === cargo.id}
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
