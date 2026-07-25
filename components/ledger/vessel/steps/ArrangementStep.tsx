"use client";

// Post Vessel — Cargo Arrangement step (the "5 human fields"; pre-filled from
// the vessel record with confirm-or-adjust chips).
// Ported from reference/handoff/asb/pp2-steps.jsx.

import * as React from "react";
import { useEffect, useState } from "react";
import type { StepCtx } from "../../types";
import type { VesselState } from "../state";
import { Field, InlineNote, SelectTip, TextInput, YesNo, capFirst } from "../../fields";
import { CONFIG_DEFS, HATCH_DEFS, LEDGER_ENUMS } from "../../defs";

export function ArrangementStep({ state, patch }: StepCtx<VesselState>) {
  const v = state.vessel;
  const isTBN = state.entryMode === "tbn";
  const [showFields, setShowFields] = useState(false);

  useEffect(() => {
    if (v && (v.numHolds || v.hatchType) && !state.arrangement) {
      patch({
        arrangement: {
          numHolds: v.numHolds ? String(v.numHolds) : "",
          numHatches: v.numHatches ? String(v.numHatches) : v.numHolds ? String(v.numHolds) : "",
          boxShaped: v.boxShaped || "",
          hatchType: v.hatchType || "",
          strengthenedHeavy: v.strengthenedHeavy || "",
          holdsMayBeEmpty: v.holdsMayBeEmpty || "",
          logFitted: v.logFitted || "",
          _source: "record",
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vessel]);

  const cur = state.arrangement || {};
  const patchA = (u: Partial<NonNullable<VesselState["arrangement"]>>) => patch({ arrangement: { ...cur, ...u, _source: "user" } });
  const fromRecord = cur._source === "record";
  const showForm = !fromRecord || showFields;
  const yn = (x: string | null | undefined, on: string, off: string) => (x === "Y" ? on : x === "N" ? off : null);
  const chips = [
    cur.config || null,
    cur.numHolds ? cur.numHolds + " holds" : null,
    yn(cur.boxShaped, "box-shaped", "not box-shaped"),
    cur.hatchType ? capFirst(cur.hatchType) + " hatches" : null,
    yn(cur.strengthenedHeavy, "heavy-strengthened", "not heavy-strengthened"),
    yn(cur.logFitted, "log-fitted", "not log-fitted"),
  ].filter(Boolean) as string[];

  return (
    <div className="pp2-arr">
      {isTBN && (
        <InlineNote style={{ marginTop: 0 }}>
          Even for a TBN listing the cargo arrangement is essential to match. Give the basics now; the vessel&apos;s identity stays hidden until you have a
          fixture.
        </InlineNote>
      )}
      {fromRecord && (
        <InlineNote tone="ok" style={{ marginTop: 0 }}>
          Read from <strong>{v?.name}</strong>&apos;s record on file - confirm or adjust.
        </InlineNote>
      )}
      {fromRecord && !showFields && (
        <div className="pp2-arr-sum">
          <div className="pp2-arr-sum__chips">
            {chips.map((c, i) => (
              <span className="pp2-arr-chip" key={i}>
                {c}
              </span>
            ))}
          </div>
          <button type="button" className="pp2-vcard__change" onClick={() => setShowFields(true)}>
            Adjust
          </button>
        </div>
      )}
      {showForm && (
        <div className="pp2-grid" style={{ marginTop: fromRecord || isTBN ? 14 : 4 }}>
          <Field
            label="Vessel Configuration"
            help="Special design types (geared, multipurpose, open-hatch). Leave blank for a standard bulker or general-cargo ship. Hover an option for its definition."
          >
            <SelectTip value={cur.config} onChange={(x) => patchA({ config: x })} options={[...LEDGER_ENUMS.vesselConfig]} defs={CONFIG_DEFS} placeholder="Standard — none of these" />
          </Field>
          <Field label="Number Of Holds" req help="Holds = hatches by default.">
            <TextInput
              value={cur.numHolds}
              style={{ maxWidth: 120 }}
              onChange={(x) => patchA({ numHolds: x.replace(/\D/g, "").slice(0, 1) })}
              placeholder="e.g. 2"
            />
          </Field>
          <Field label="Number Of Hatches" help="Override only - blank = same as holds.">
            <TextInput
              value={cur.numHatches}
              style={{ maxWidth: 120 }}
              onChange={(x) => patchA({ numHatches: x.replace(/\D/g, "").slice(0, 1) })}
              placeholder={cur.numHolds || "-"}
            />
          </Field>
          <Field label="Box-Shaped Holds" req help="Clean stow for containers, steel, packaged cargo.">
            <YesNo value={cur.boxShaped} onChange={(x) => patchA({ boxShaped: x })} />
          </Field>
          <Field label="Hatch Type" req help="Hatch cover design. Hover an option for its definition.">
            <SelectTip value={cur.hatchType} onChange={(x) => patchA({ hatchType: x })} options={[...LEDGER_ENUMS.hatchType]} defs={HATCH_DEFS} placeholder="Select…" />
          </Field>
          <Field label="Strengthened For Heavy Cargo" req help="Tank-top strengthened for dense cargo (ore, steel).">
            <YesNo value={cur.strengthenedHeavy} onChange={(x) => patchA({ strengthenedHeavy: x })} />
          </Field>
          <Field label="Holds May Be Left Empty" help="Alternate-hold loading for heavy parcels.">
            <YesNo value={cur.holdsMayBeEmpty} onChange={(x) => patchA({ holdsMayBeEmpty: x })} />
          </Field>
          <Field label="Fitted For Logs" req help="Stanchions for log / timber trades.">
            <YesNo value={cur.logFitted} onChange={(x) => patchA({ logFitted: x })} />
          </Field>
        </div>
      )}
    </div>
  );
}

export function arrSummary(s: VesselState): string {
  const a = s.arrangement || {};
  const parts = [
    a.config || null,
    a.numHolds ? a.numHolds + " holds" : null,
    a.hatchType ? capFirst(a.hatchType) : null,
    a.strengthenedHeavy === "Y" ? "heavy-strengthened" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not set";
}

export function arrComplete(s: VesselState): boolean {
  const a = s.arrangement;
  if (!a) return false;
  if (a._source === "record") return true;
  return !!(a.numHolds && a.boxShaped && a.hatchType && a.strengthenedHeavy && a.logFitted);
}
