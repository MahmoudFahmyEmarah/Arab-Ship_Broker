"use client";

// Context-aware, data-driven map filter panel. Renders a Cargo section when
// cargo data is present and an Open-tonnage section when vessel data is present
// (so the dashboard `both` shows the full set). Each section has a layer on/off
// switch and a row of chips per facet (from the shared §2b facet model). Chips
// drive real marker visibility via the parent's marker-build effect.
import * as React from "react";
import { CargoView, VesselView } from "@/lib/portal/types";
import {
  CARGO_FACETS,
  VESSEL_FACETS,
  facetOptions,
  type Selections,
  type EnumFacet,
  type FacetItem,
} from "@/lib/portal/map-filters";

function FacetRow<T extends FacetItem>({
  facet,
  items,
  selected,
  onToggle,
  disabled,
}: {
  facet: EnumFacet<T>;
  items: T[];
  selected: Set<string> | undefined;
  onToggle: (facetId: string, value: string) => void;
  disabled: boolean;
}) {
  const opts = facetOptions(facet, items);
  if (opts.length === 0) return null;
  return (
    <div className="filter-facet">
      <div className="filter-facet__label">{facet.label}</div>
      <div className="filter-chips">
        {opts.map((o) => {
          const on = selected?.has(o.toUpperCase());
          return (
            <button
              key={o}
              type="button"
              disabled={disabled}
              className={`filter-chip${on ? " is-on" : ""}`}
              onClick={() => onToggle(facet.id, o.toUpperCase())}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MapFilterPanel({
  open,
  onClose,
  cargos,
  vessels,
  cargoLayer,
  vesselLayer,
  onToggleCargoLayer,
  onToggleVesselLayer,
  selections,
  onToggleOption,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  cargos: CargoView[];
  vessels: VesselView[];
  cargoLayer: boolean;
  vesselLayer: boolean;
  onToggleCargoLayer: () => void;
  onToggleVesselLayer: () => void;
  selections: Selections;
  onToggleOption: (facetId: string, value: string) => void;
  onReset: () => void;
}) {
  if (!open) return null;
  const hasCargo = cargos.length > 0;
  const hasVessel = vessels.length > 0;
  return (
    <div className="filter-panel open">
      <div className="filter-panel__inner">
        <div className="filter-panel__head">
          <span className="filter-panel__title">Filters</span>
          <button type="button" className="filter-panel__close" onClick={onClose} aria-label="Close filters">
            ×
          </button>
        </div>

        {hasCargo && (
          <div className="filter-section">
            <label className="filter-section__head">
              <span>Cargo positions</span>
              <input type="checkbox" checked={cargoLayer} onChange={onToggleCargoLayer} />
            </label>
            {CARGO_FACETS.map((f) => (
              <FacetRow
                key={f.id}
                facet={f}
                items={cargos}
                selected={selections[f.id]}
                onToggle={onToggleOption}
                disabled={!cargoLayer}
              />
            ))}
          </div>
        )}

        {hasVessel && (
          <div className="filter-section">
            <label className="filter-section__head">
              <span>Open tonnage</span>
              <input type="checkbox" checked={vesselLayer} onChange={onToggleVesselLayer} />
            </label>
            {VESSEL_FACETS.map((f) => (
              <FacetRow
                key={f.id}
                facet={f}
                items={vessels}
                selected={selections[f.id]}
                onToggle={onToggleOption}
                disabled={!vesselLayer}
              />
            ))}
          </div>
        )}

        <button type="button" className="filter-reset" onClick={onReset}>
          Reset filters
        </button>
      </div>
    </div>
  );
}
