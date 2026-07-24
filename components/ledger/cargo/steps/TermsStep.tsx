"use client";

// Post Cargo — Laycan & Terms step (laycan w/ 45-day cap, NOR, freight idea,
// despatch, commission, spot + IAC toggles).
// Ported from reference/handoff/asb/pc2-steps.jsx.

import * as React from "react";
import type { StepCtx } from "../../types";
import type { CargoState } from "../state";
import { Field, InlineNote, NumInput, SelectTip, addDaysISO, diffDaysISO, todayISO } from "../../fields";
import { LedgerToggle } from "../../ds";
import { DESPATCH_DEFS, FBASIS_DEFS, LAYCAN_CAP_DAYS as CAP, LEDGER_ENUMS, NOR_DEFS } from "../../defs";

export function TermsStep({ state, patch }: StepCtx<CargoState>) {
  const cur = state.terms || { freightBasis: "Per MT", spot: false };
  const patchT = (u: Partial<NonNullable<CargoState["terms"]>>) => patch({ terms: { ...cur, ...u } });
  const capExceeded = !!(cur.laycanFrom && cur.laycanTo && diffDaysISO(cur.laycanFrom, cur.laycanTo) > CAP);
  const toBeforeFrom = !!(cur.laycanFrom && cur.laycanTo && new Date(cur.laycanTo) < new Date(cur.laycanFrom));
  const maxTo = cur.laycanFrom ? addDaysISO(cur.laycanFrom, CAP) : undefined;
  const TODAY = todayISO();
  return (
    <div className="pp2-terms">
      <div className="pp2-grid">
        <Field label="Laycan from" req help="Earliest the vessel can present.">
          <input
            type="date"
            className="pp2-select"
            style={{ backgroundImage: "none" }}
            min={TODAY}
            value={cur.laycanFrom || ""}
            onChange={(e) => patchT({ laycanFrom: e.target.value })}
          />
        </Field>
        <Field label="Laycan to" help={"Latest, within " + CAP + " days of laycan-from."}>
          <input
            type="date"
            className="pp2-select"
            style={{ backgroundImage: "none" }}
            min={cur.laycanFrom || TODAY}
            max={maxTo}
            value={cur.laycanTo || ""}
            onChange={(e) => patchT({ laycanTo: e.target.value })}
          />
        </Field>
      </div>
      {toBeforeFrom && <InlineNote tone="alert">Laycan-to is before laycan-from.</InlineNote>}
      {capExceeded && <InlineNote tone="alert">Laycan spread exceeds the {CAP}-day cap - tighten the dates.</InlineNote>}
      <Field full label="NOR clause" help="When notice of readiness can be tendered.">
        <SelectTip value={cur.norClause} onChange={(x) => patchT({ norClause: x })} options={[...LEDGER_ENUMS.norClause]} defs={NOR_DEFS} placeholder="Select…" />
      </Field>
      <div className="pp2-grid" style={{ marginTop: 15 }}>
        <Field label="Freight idea" help="Indication only, guides offers.">
          <div className="pp2-split">
            <span className="pp2-prefix">USD</span>
            <NumInput
              value={cur.freight}
              onChange={(x) => patchT({ freight: x })}
              unit={cur.freightBasis === "Lumpsum" ? "LS" : "/MT"}
              decimal
              placeholder="e.g. 45"
            />
          </div>
        </Field>
        <Field label="Freight basis">
          <SelectTip value={cur.freightBasis} onChange={(x) => patchT({ freightBasis: x })} options={[...LEDGER_ENUMS.freightBasis]} defs={FBASIS_DEFS} placeholder="Select…" />
        </Field>
        <Field label="Despatch" help="Reward for finishing early.">
          <SelectTip value={cur.despatch} onChange={(x) => patchT({ despatch: x })} options={[...LEDGER_ENUMS.despatch]} defs={DESPATCH_DEFS} placeholder="Select…" />
        </Field>
        <Field label="Total commission" help="Address + brokerage, all-in.">
          <NumInput value={cur.commissionPct} onChange={(x) => patchT({ commissionPct: x })} unit="%" decimal placeholder="e.g. 3.75" max={15} />
        </Field>
      </div>
      <div className="pp2-toggles">
        <label className="pp2-wog">
          <LedgerToggle checked={!!cur.spot} onChange={(e) => patchT({ spot: e.target.checked })} />
          <span className="pp2-wog__label">Spot / prompt cargo</span>
        </label>
        <label className="pp2-wog">
          <LedgerToggle checked={!!cur.iac} onChange={(e) => patchT({ iac: e.target.checked })} />
          <span className="pp2-wog__label">Freight incl. address commission (IAC)</span>
        </label>
      </div>
    </div>
  );
}

export function termsSummary(s: CargoState): string {
  const t = s.terms || {};
  if (!t.laycanFrom) return "Not set";
  return "Laycan " + t.laycanFrom + (t.laycanTo ? " to " + t.laycanTo : "") + (t.freight ? " · USD " + t.freight : "");
}

export function termsComplete(s: CargoState): boolean {
  const t = s.terms;
  if (!t || !t.laycanFrom) return false;
  if (t.laycanTo && (new Date(t.laycanTo) < new Date(t.laycanFrom) || diffDaysISO(t.laycanFrom, t.laycanTo) > CAP)) return false;
  return true;
}
