"use client";

// Post Cargo — Load & Discharge step (POL/POD + rates + rate mechanism + day
// exceptions + turn time + reversible laytime).
// Ported from reference/handoff/asb/pc2-steps.jsx.

import * as React from "react";
import type { StepCtx } from "../../types";
import type { CargoState } from "../state";
import { Field, NumInput, SelectTip } from "../../fields";
import { SegmentedToggle } from "../../ds";
import { PortPicker } from "../../PortPicker";
import { DAY_DEFS, LEDGER_ENUMS, RATE_DEFS } from "../../defs";

export function PortsStep({ state, patch }: StepCtx<CargoState>) {
  const cur = state.ports || {};
  const patchP = (u: Partial<NonNullable<CargoState["ports"]>>) => patch({ ports: { ...cur, ...u } });
  return (
    <div className="pp2-ports">
      <div className="pp2-grid">
        <Field label="Load port (POL)" req help="Where the cargo loads. Resolves to a UN/LOCODE.">
          <PortPicker value={cur.pol} onChange={(p) => patchP({ pol: p })} placeholder="Search load port…" />
        </Field>
        <Field label="Discharge port (POD)" req help="Where it discharges.">
          <PortPicker value={cur.pod} onChange={(p) => patchP({ pod: p })} placeholder="Search discharge port…" />
        </Field>
        <Field label="Load rate" help="Guaranteed load rate for laytime.">
          <NumInput value={cur.loadRate} onChange={(x) => patchP({ loadRate: x })} unit="MT/day" placeholder="e.g. 4,000" />
        </Field>
        <Field label="Discharge rate" help="Guaranteed discharge rate.">
          <NumInput value={cur.dischRate} onChange={(x) => patchP({ dischRate: x })} unit="MT/day" placeholder="e.g. 3,000" />
        </Field>
        <Field label="Rate mechanism" help="How the load / discharge rate is expressed. Hover an option for its definition.">
          <SelectTip
            value={cur.rateMechanism}
            onChange={(x) => patchP({ rateMechanism: x })}
            options={[...LEDGER_ENUMS.rateMechanism]}
            defs={RATE_DEFS}
            placeholder="Select…"
          />
        </Field>
        <Field label="Day type & exceptions" help="Which days count toward laytime. Hover an option for its definition.">
          <SelectTip
            value={cur.dayExceptions}
            onChange={(x) => patchP({ dayExceptions: x })}
            options={[...LEDGER_ENUMS.dayExceptions]}
            defs={DAY_DEFS}
            placeholder="Select…"
          />
        </Field>
        <Field
          label="Turn time"
          help="Free period after NOR is tendered before laytime starts to count (BIMCO Laytime Definitions). Often a fixed allowance in the Gulf / Red Sea, e.g. 12 hours."
        >
          <NumInput value={cur.turnTime} onChange={(x) => patchP({ turnTime: x })} unit="hrs" placeholder="e.g. 12" />
        </Field>
      </div>
      {cur.loadRate && cur.dischRate && (
        <div style={{ marginTop: 15 }}>
          <Field
            full
            label="Laytime, load vs discharge"
            help="Reversible = load and discharge laytime added together, one running total (BIMCO def 24). Average = time saved at one end offsets excess at the other (def 23). Separate = each end counted on its own."
          >
            <SegmentedToggle
              className="pp2-yn"
              value={cur.reversible || "Non-reversible"}
              onChange={(x) => patchP({ reversible: x })}
              options={[
                { value: "Non-reversible", label: "Separate" },
                { value: "Reversible", label: "Reversible" },
                { value: "Average", label: "Average" },
              ]}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export function portsSummary(s: CargoState): string {
  const p = s.ports || {};
  if (!p.pol && !p.pod) return "Not set";
  return (p.pol ? p.pol.name : "?") + " → " + (p.pod ? p.pod.name : "?");
}

export function portsComplete(s: CargoState): boolean {
  const p = s.ports;
  return !!(p && p.pol && p.pol.locode && p.pod && p.pod.locode);
}
