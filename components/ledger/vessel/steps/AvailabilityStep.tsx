"use client";

// Post Vessel — Availability step (status, charter type, open port → derived
// zone, open-from date, trading zones, direction, WOG).
// Ported from reference/handoff/asb/pp2-steps.jsx.

import * as React from "react";
import type { StepCtx } from "../../types";
import type { VesselState } from "../state";
import { Field, SelectTip, TextInput, ZoneChips, todayISO } from "../../fields";
import { LedgerToggle } from "../../ds";
import { PortPicker } from "../../PortPicker";
import { CHARTER_DEFS, LEDGER_ENUMS, STATUS_DEFS, TRADING_ZONES } from "../../defs";

export function AvailabilityStep({ state, patch }: StepCtx<VesselState>) {
  const av = state.availability || {};
  const patchAv = (u: Partial<NonNullable<VesselState["availability"]>>) => patch({ availability: { ...av, ...u } });
  const isTC = av.charterType === "T/C short" || av.charterType === "T/C long" || av.charterType === "Bareboat";
  return (
    <div className="pp2-avail">
      <div className="pp2-grid">
        <Field label="Status" req help="Where she stands right now. Hover an option for its definition.">
          <SelectTip value={av.status} onChange={(x) => patchAv({ status: x })} options={[...LEDGER_ENUMS.status]} defs={STATUS_DEFS} placeholder="Select…" />
        </Field>
        <Field
          label="Charter type"
          help={
            isTC
              ? "Disponent operator - Arab ShipBroker quietly confirms the charter is valid before fixing."
              : "How she currently trades. Owner and manager often differ, which is normal."
          }
        >
          <SelectTip value={av.charterType} onChange={(x) => patchAv({ charterType: x })} options={[...LEDGER_ENUMS.charterType]} defs={CHARTER_DEFS} placeholder="Select…" />
        </Field>
        <Field label="Open port" req help="Where she becomes free. Resolves to a UN/LOCODE.">
          <PortPicker value={av.openPort} onChange={(p) => patchAv({ openPort: p })} />
        </Field>
        <Field label="Zone" help="Derived from the open port.">
          {av.openPort?.zoneName ? <span className="pp2-derived">{av.openPort.zoneName}</span> : <span className="pp2-derived is-empty">-</span>}
        </Field>
        <Field label="Open from" req help="Earliest date she's free.">
          <input
            type="date"
            className="pp2-select"
            style={{ backgroundImage: "none" }}
            min={todayISO()}
            value={av.openFrom || ""}
            onChange={(e) => patchAv({ openFrom: e.target.value })}
          />
        </Field>
      </div>
      <Field full label="Trading zones" help="Regions she'll trade. Red Sea North & South are separate.">
        <ZoneChips zones={TRADING_ZONES.map((z) => z.label)} value={av.zones} onChange={(z) => patchAv({ zones: z })} />
      </Field>
      <Field full label="Next direction / preference" help="Where she would prefer to trade next. Guides matching.">
        <TextInput value={av.direction} onChange={(x) => patchAv({ direction: x })} placeholder="e.g. prompt Red Sea; prefers Med redelivery" />
      </Field>
      <label className="pp2-wog">
        <LedgerToggle checked={!!av.wog} onChange={(e) => patchAv({ wog: e.target.checked })} />
        <span className="pp2-wog__label">Rates without guarantee (WOG)</span>
      </label>
      <div className="pp2-wog__hint">Position details shown as indication only, subject to reconfirmation.</div>
    </div>
  );
}

export function avSummary(s: VesselState): string {
  const a = s.availability || {};
  if (!a.status && !a.openPort) return "Not set";
  return [a.status || null, a.openPort ? a.openPort.name + " (" + a.openPort.locode + ")" : null, a.openFrom ? "from " + a.openFrom : null]
    .filter(Boolean)
    .join(" · ");
}

export function avComplete(s: VesselState): boolean {
  const a = s.availability;
  if (!a) return false;
  return !!(a.status && a.openPort && a.openPort.locode && a.openFrom);
}
