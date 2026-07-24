"use client";

// Post Vessel — Gear step (geared/gearless, cranes + SWL, grabs, kick-plate;
// conditional predicates return null when gearless so the progress ring
// excludes them). Ported from reference/handoff/asb/pp2-steps.jsx.

import * as React from "react";
import { useEffect } from "react";
import type { StepCtx } from "../../types";
import type { VesselState } from "../state";
import { Field, InlineNote, NumInput } from "../../fields";
import { Icon, LedgerToggle, SegmentedToggle } from "../../ds";

export function GearStep({ state, patch }: StepCtx<VesselState>) {
  const v = state.vessel;
  const gear = state.gear || {};
  const patchG = (u: Partial<NonNullable<VesselState["gear"]>>) => patch({ gear: { ...gear, ...u, _source: "user" } });

  useEffect(() => {
    if (v && v.isGeared && !state.gear) {
      const geared = v.isGeared === "Y";
      patch({
        gear: {
          geared,
          craneCount: v.craneCount ? String(v.craneCount) : "",
          craneSwl: v.craneSwl ? String(v.craneSwl) : "",
          grabs: !!v.numGrabs,
          numGrabs: v.numGrabs ? String(v.numGrabs) : "",
          grabCapacity: v.grabCapacity ? String(v.grabCapacity) : "",
          _source: "record",
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vessel]);

  const geared = gear.geared;
  const setGeared = (val: boolean) => patchG({ geared: val });
  return (
    <div className="pp2-gear">
      <Field label="Gear" req help="Cranes/derricks aboard, or gearless (shore cranes only).">
        <SegmentedToggle
          className="pp2-yn"
          value={geared == null ? "" : geared ? "geared" : "gearless"}
          onChange={(x) => setGeared(x === "geared")}
          options={[
            { value: "geared", label: "Geared" },
            { value: "gearless", label: "Gearless" },
          ]}
        />
      </Field>
      {geared && (
        <div className="pp2-grid" style={{ marginTop: 15 }}>
          <Field label="Number of cranes" req help="Cranes or derricks aboard.">
            <NumInput value={gear.craneCount} onChange={(x) => patchG({ craneCount: x })} unit="×" placeholder="e.g. 4" max={4} />
          </Field>
          <Field label="SWL per crane" req help="Safe working load.">
            <NumInput value={gear.craneSwl} onChange={(x) => patchG({ craneSwl: x })} unit="MT" decimal placeholder="e.g. 30" />
          </Field>
        </div>
      )}
      {geared && (
        <label className="pp2-wog" style={{ marginTop: 14 }}>
          <LedgerToggle checked={!!gear.grabs} onChange={(e) => patchG({ grabs: e.target.checked })} />
          <span className="pp2-wog__label">Grabs fitted</span>
        </label>
      )}
      {geared && gear.grabs && (
        <div className="pp2-grid" style={{ marginTop: 12 }}>
          <Field label="Number of grabs" help="Grabs aboard for self-discharge.">
            <NumInput value={gear.numGrabs} onChange={(x) => patchG({ numGrabs: x })} unit="×" placeholder="e.g. 2" max={5} />
          </Field>
          <Field label="Grab capacity" help="Volume each grab lifts.">
            <NumInput value={gear.grabCapacity} onChange={(x) => patchG({ grabCapacity: x })} unit="m³" decimal placeholder="e.g. 8" />
          </Field>
        </div>
      )}
      {geared && (
        <label className="pp2-wog" style={{ marginTop: 14 }}>
          <LedgerToggle checked={!!gear.kickPlate} onChange={(e) => patchG({ kickPlate: e.target.checked })} />
          <span className="pp2-wog__label">Kick-plate fitted</span>
        </label>
      )}
      {geared === false && (
        <InlineNote icon={<Icon name="Vessel" size={14} />}>Gearless, she&apos;ll rely on shore cranes at the load and discharge ports.</InlineNote>
      )}
    </div>
  );
}

export function gearSummary(s: VesselState): string {
  const g = s.gear;
  if (!g || g.geared == null) return "Not set";
  if (!g.geared) return "Gearless";
  return [g.craneCount ? g.craneCount + " cranes" : "Geared", g.craneSwl ? g.craneSwl + " MT SWL" : null, g.grabs ? "grabs" : null, g.kickPlate ? "kick-plate" : null]
    .filter(Boolean)
    .join(" · ");
}

export function gearComplete(s: VesselState): boolean {
  const g = s.gear;
  if (!g || g.geared == null) return false;
  if (g.geared) return !!(g.craneCount && g.craneSwl);
  return true;
}
