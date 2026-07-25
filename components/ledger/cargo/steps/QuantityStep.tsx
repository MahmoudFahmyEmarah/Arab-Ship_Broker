"use client";

// Post Cargo — Quantity step (MT + tolerance/option holder + volume + unit).
// Ported from reference/handoff/asb/pc2-steps.jsx.

import * as React from "react";
import type { StepCtx } from "../../types";
import type { CargoState } from "../state";
import { Field, NumInput, SelectTip, fmt } from "../../fields";
import { SegmentedToggle } from "../../ds";
import { LEDGER_ENUMS, OPTHOLDER_DEFS } from "../../defs";

export function QuantityStep({ state, patch }: StepCtx<CargoState>) {
  const cur = state.quantity || { unit: "CbM" as const, optionHolder: "MOLOO" };
  const patchQ = (u: Partial<NonNullable<CargoState["quantity"]>>) => patch({ quantity: { ...cur, ...u } });
  return (
    <div className="pp2-qty">
      <div className="pp2-grid">
        <Field label="Quantity" req help="The cargo weight. Matched against vessel DWT for Strong / Good / Possible / Weak.">
          <NumInput value={cur.qtyMt} onChange={(x) => patchQ({ qtyMt: x })} unit="MT" placeholder="e.g. 12,500" />
        </Field>
        <Field label="Tolerance" help="Margin on quantity, at the option-holder's choice.">
          <div className="pp2-split">
            <NumInput value={cur.molooPct} onChange={(x) => patchQ({ molooPct: x })} unit="%" decimal placeholder="e.g. 7.5" max={25} />
            <SelectTip
              value={cur.optionHolder}
              onChange={(x) => patchQ({ optionHolder: x })}
              options={[...LEDGER_ENUMS.optionHolder]}
              defs={OPTHOLDER_DEFS}
              placeholder="Select…"
            />
          </div>
        </Field>
        <Field label="Volume" req help="Cargo cubic. Required so the platform can stow-check against the vessel's grain / bale capacity.">
          <NumInput value={cur.volume} onChange={(x) => patchQ({ volume: x })} unit={cur.unit} decimal placeholder="e.g. 16,500" />
        </Field>
        <Field label="Volume unit" req>
          <SegmentedToggle
            className="pp2-yn"
            value={cur.unit || "CbM"}
            onChange={(x) => patchQ({ unit: x as "CbM" | "CbFT" })}
            options={[
              { value: "CbM", label: "CbM" },
              { value: "CbFT", label: "CbFT" },
            ]}
          />
        </Field>
      </div>
    </div>
  );
}

export function qtySummary(s: CargoState): string {
  const q = s.quantity || {};
  if (!q.qtyMt) return "Not set";
  return (
    fmt(q.qtyMt) +
    " MT" +
    (q.molooPct ? " +/- " + q.molooPct + "%" : "") +
    (q.volume ? " · " + fmt(q.volume) + " " + (q.unit || "CbM") : "")
  );
}

export function qtyComplete(s: CargoState): boolean {
  const q = s.quantity;
  return !!(q && q.qtyMt && Number(q.qtyMt) > 0 && q.volume && Number(q.volume) > 0 && q.unit);
}
