"use client";

// Post Cargo — Review step. Ported from reference/handoff/asb/pc2-steps.jsx.

import * as React from "react";
import type { StepCtx } from "../../types";
import type { CargoState } from "../state";
import { InlineNote, fmt } from "../../fields";

function RRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="pp2-rev__row">
      <span className="pp2-rev__k">{label}</span>
      <span className="pp2-rev__v">{value || "-"}</span>
    </div>
  );
}

export function ReviewStep({ state }: StepCtx<CargoState>) {
  const c = state.commodity || ({} as NonNullable<CargoState["commodity"]>);
  const q = state.quantity || {};
  const p = state.ports || {};
  const t = state.terms || {};
  return (
    <div className="pp2-rev">
      <div className="pp2-rev__card">
        <div className="pp2-rev__head">{c.name || "Cargo"}</div>
        <div className="pp2-rev__grid">
          <RRow label="Cargo type" value={c.form === "break-bulk" ? "Break-bulk" : c.form ? "Dry bulk" : null} />
          <RRow label="Packaging" value={c.packaging} />
          <RRow label="Quantity" value={q.qtyMt ? fmt(q.qtyMt) + " MT" + (q.molooPct ? " +/- " + q.molooPct + "% " + (q.optionHolder || "") : "") : null} />
          <RRow label="Volume" value={q.volume ? fmt(q.volume) + " " + (q.unit || "CbM") : null} />
        </div>
      </div>
      <div className="pp2-rev__card">
        <div className="pp2-rev__sub">Lane &amp; terms</div>
        <div className="pp2-rev__grid">
          <RRow label="Load" value={p.pol ? p.pol.name + " (" + p.pol.locode + ")" : null} />
          <RRow label="Discharge" value={p.pod ? p.pod.name + " (" + p.pod.locode + ")" : null} />
          <RRow label="Laytime" value={p.reversible && p.loadRate && p.dischRate ? p.reversible : null} />
          <RRow label="Turn time" value={p.turnTime ? p.turnTime + " hrs" : null} />
          <RRow label="Laycan" value={t.laycanFrom ? t.laycanFrom + (t.laycanTo ? " to " + t.laycanTo : "") : null} />
          <RRow label="Freight idea" value={t.freight ? "USD " + t.freight + (t.freightBasis === "Lumpsum" ? " LS" : "/MT") : null} />
          <RRow label="Commission" value={t.commissionPct ? t.commissionPct + "%" + (t.iac ? " (IAC)" : "") : null} />
          <RRow label="NOR" value={t.norClause} />
        </div>
      </div>
      <InlineNote>On posting, the platform resolves the IMSBC group, CSS regime, stowage factor and any safety controls from the commodity name.</InlineNote>
    </div>
  );
}
