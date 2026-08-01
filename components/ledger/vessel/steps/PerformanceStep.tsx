"use client";

// Post Vessel — Performance step (lean voyage-calc model; advisory, never
// blocks posting). Ported from reference/handoff/asb/pp2-steps.jsx.

import * as React from "react";
import { useEffect } from "react";
import type { StepCtx } from "../../types";
import type { VesselState } from "../state";
import { Field, InlineNote, NumInput, SelectTip } from "../../fields";
import { Icon, LedgerToggle } from "../../ds";
import { FUEL_DEFS, LEDGER_ENUMS } from "../../defs";

export function PerformanceStep({ state, patch }: StepCtx<VesselState>) {
  const v = state.vessel;
  const perf = state.performance || {};
  const patchP = (u: Partial<NonNullable<VesselState["performance"]>>) => patch({ performance: { ...perf, ...u, _source: "user" } });

  useEffect(() => {
    if (v && v.serviceSpeed && !state.performance) {
      patch({
        performance: {
          serviceSpeed: String(v.serviceSpeed),
          meConsSea: v.meConsSea ? String(v.meConsSea) : "",
          meConsPort: v.meConsPort ? String(v.meConsPort) : "",
          auxConsPort: v.auxConsPort ? String(v.auxConsPort) : "",
          fuelType: v.fuelType || "VLSFO",
          brob: v.brob ? String(v.brob) : "",
          scrubber: !!v.scrubber,
          eco: false,
          _source: "record",
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vessel]);

  const fromRecord = perf._source === "record";
  return (
    <div className="pp2-perf">
      <InlineNote style={{ marginTop: 0 }} icon={<Icon name="VoyCalc" size={14} />}>
        Feeds the voyage estimate. {fromRecord ? "Read from the vessel's record, confirm or adjust." : "A best-guess is fine, Bosun can refine it from the Q88 later."}
      </InlineNote>
      <div className="pp2-grid" style={{ marginTop: 14 }}>
        <Field label="Service speed" req help="Laden, good weather.">
          <NumInput value={perf.serviceSpeed} onChange={(x) => patchP({ serviceSpeed: x })} unit="kn" decimal placeholder="e.g. 12.5" />
        </Field>
        <Field label="Fuel type" req help="Main bunker grade she burns. Hover an option for its definition.">
          <SelectTip value={perf.fuelType} onChange={(x) => patchP({ fuelType: x })} options={[...LEDGER_ENUMS.fuelType]} defs={FUEL_DEFS} placeholder="Select…" />
        </Field>
        <Field label="ME consumption at sea" req help="Main engine, per day at service speed.">
          <NumInput value={perf.meConsSea} onChange={(x) => patchP({ meConsSea: x })} unit="MT/d" decimal placeholder="e.g. 24" />
        </Field>
        <Field label="ME consumption in port" help="Main engine, working / idle.">
          <NumInput value={perf.meConsPort} onChange={(x) => patchP({ meConsPort: x })} unit="MT/d" decimal placeholder="e.g. 2" />
        </Field>
        <Field label="AUX consumption in port" help="Generators while in port.">
          <NumInput value={perf.auxConsPort} onChange={(x) => patchP({ auxConsPort: x })} unit="MT/d" decimal placeholder="e.g. 1.5" />
        </Field>
        <Field label="Bunkers ROB" help="Remaining on board at the open position.">
          <NumInput value={perf.brob} onChange={(x) => patchP({ brob: x })} unit="MT" placeholder="e.g. 120" />
        </Field>
      </div>
      <div className="pp2-toggles">
        <label className="pp2-wog">
          <LedgerToggle checked={!!perf.scrubber} onChange={(e) => patchP({ scrubber: e.target.checked })} />
          <span className="pp2-wog__label">Scrubber fitted</span>
        </label>
        <label className="pp2-wog">
          <LedgerToggle checked={!!perf.eco} onChange={(e) => patchP({ eco: e.target.checked })} />
          <span className="pp2-wog__label">ECA-compliant on low-sulphur</span>
        </label>
      </div>
    </div>
  );
}

export function perfSummary(s: VesselState): string {
  const p = s.performance || {};
  if (!p.serviceSpeed && !p.meConsSea) return "Optional, not set";
  return [p.serviceSpeed ? p.serviceSpeed + " kn" : null, p.meConsSea ? p.meConsSea + " MT/d sea" : null, p.fuelType || null].filter(Boolean).join(" · ");
}

// Performance is advisory; it never blocks the post.
export function perfComplete(): boolean {
  return true;
}
