"use client";

// Post Cargo — additional parcels (multi-parcel posting, Option C).
// Parcel 1 is the main Commodity/Quantity flow; each extra parcel is a compact
// card holding its OWN single commodity + quantity/tolerance/volume. Shared
// lane/laycan/terms stay posting-level; the RPC inserts one listing per
// parcel under one cargo_group_id.

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { searchCommodityNames, type CommodityNameHit } from "@/sdk/app/ledger";
import type { StepCtx } from "../types";
import type { CargoState, ExtraParcel } from "./state";
import { Field, InlineNote, NumInput, SelectTip } from "../fields";
import { SegmentedToggle } from "../ds";
import { CARGOFORM_DEFS, LEDGER_ENUMS, OPTHOLDER_DEFS } from "../defs";

const srcMeta = (c: NonNullable<ExtraParcel["commodity"]>) => {
  if (c.source === "imsbc") return "IMSBC · Group " + (c.group || "C") + " · dry bulk";
  if (c.source === "grain") return "Grain Code · dry bulk";
  if (c.source === "css") return (c.group ? c.group + " · " : "") + "CSS break-bulk";
  return c.form === "break-bulk" ? "break-bulk" : "dry bulk";
};

function ParcelCommodityPicker({
  value,
  onPick,
  onClear,
}: {
  value: ExtraParcel["commodity"];
  onPick: (hit: CommodityNameHit) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CommodityNameHit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        setResults(await searchCommodityNames(getSupabaseBrowserClient(), q, 10));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (value?.name) {
    return (
      <div className="pp2-port-sel">
        <span className="pp2-port-sel__name">{value.name}</span>
        <span className="pp2-port-sel__loc">{srcMeta(value)}</span>
        <button type="button" className="pp2-vcard__change" onClick={onClear}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="pp2-port">
      <input
        className="pp2-select"
        style={{ backgroundImage: "none" }}
        value={q}
        placeholder="Search commodity…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && q.trim().length >= 2 && (
        <div className="pp2-port__menu">
          {results.map((c) => (
            <button
              type="button"
              className="pp2-port__opt"
              key={c.display_name + c.source}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(c);
                setOpen(false);
                setQ("");
              }}
            >
              <span className="pp2-port__opt-name">{c.display_name}</span>
              <span className="pp2-port__opt-meta">
                {c.source === "grain" ? "Grain Code" : c.source === "imsbc" ? "IMSBC · Group " + (c.group_or_cat || "C") : c.source === "css" ? "CSS" : "market name"} ·{" "}
                {c.form === "break-bulk" ? "break-bulk" : "dry bulk"}
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="pp2-port__empty">No commodity matches “{q}”.</div>}
        </div>
      )}
    </div>
  );
}

export function ParcelsBlock({ state, patch }: StepCtx<CargoState>) {
  const parcels = state.extraParcels ?? [];
  const setParcels = (list: ExtraParcel[]) => patch({ extraParcels: list.length ? list : undefined });
  const patchParcel = (i: number, u: Partial<ExtraParcel>) => setParcels(parcels.map((p, idx) => (idx === i ? { ...p, ...u } : p)));
  const patchParcelCommodity = (i: number, u: Partial<NonNullable<ExtraParcel["commodity"]>>) =>
    patchParcel(i, { commodity: { ...(parcels[i].commodity as NonNullable<ExtraParcel["commodity"]>), ...u } });

  // Only offered once parcel 1 exists.
  if (!state.commodity?.name) return null;

  return (
    <div className="pp2-parcels">
      {parcels.map((p, i) => (
        <div className="pp2-parcel" key={i}>
          <div className="pp2-parcel__head">
            <span className="pp2-parcel__title">Parcel {i + 2}</span>
            <button type="button" className="led-draft__x" aria-label={`Remove parcel ${i + 2}`} onClick={() => setParcels(parcels.filter((_, idx) => idx !== i))}>
              ×
            </button>
          </div>
          <div className="pp2-grid">
            <Field label="Commodity" req help="A single commodity — each parcel is classified and matched on its own.">
              <ParcelCommodityPicker
                value={p.commodity}
                onPick={(c) =>
                  patchParcel(i, {
                    commodity: {
                      name: c.display_name,
                      form: c.form,
                      source: c.source,
                      group: c.group_or_cat,
                      regime: c.regime,
                      marketName: c.source === "market" ? c.display_name : null,
                    },
                  })
                }
                onClear={() => patchParcel(i, { commodity: null })}
              />
            </Field>
            <Field label="Cargo type" req>
              <SegmentedToggle
                className="pp2-yn"
                value={p.commodity?.form || ""}
                onChange={(x) => patchParcelCommodity(i, { form: x as "dry-bulk" | "break-bulk" })}
                options={[
                  { value: "dry-bulk", label: "Dry bulk" },
                  { value: "break-bulk", label: "Break-bulk" },
                ]}
              />
            </Field>
            <Field label="Packaging / form" help="Optional. How it presents on board.">
              <SelectTip
                value={p.commodity?.packaging}
                onChange={(x) => patchParcelCommodity(i, { packaging: x })}
                options={[...LEDGER_ENUMS.cargoForm]}
                defs={CARGOFORM_DEFS}
                placeholder="Select…"
              />
            </Field>
            <Field label="Quantity" req>
              <NumInput value={p.qtyMt} onChange={(x) => patchParcel(i, { qtyMt: x })} unit="MT" placeholder="e.g. 5,000" />
            </Field>
            <Field label="Tolerance">
              <div className="pp2-split">
                <NumInput value={p.molooPct} onChange={(x) => patchParcel(i, { molooPct: x })} unit="%" decimal placeholder="e.g. 7.5" max={25} />
                <SelectTip
                  value={p.optionHolder}
                  onChange={(x) => patchParcel(i, { optionHolder: x })}
                  options={[...LEDGER_ENUMS.optionHolder]}
                  defs={OPTHOLDER_DEFS}
                  placeholder="Select…"
                />
              </div>
            </Field>
            <Field label="Volume" req>
              <div className="pp2-split">
                <NumInput value={p.volume} onChange={(x) => patchParcel(i, { volume: x })} unit={p.unit || "CbM"} decimal placeholder="e.g. 6,500" />
                <SegmentedToggle
                  className="pp2-yn"
                  value={p.unit || "CbM"}
                  onChange={(x) => patchParcel(i, { unit: x as "CbM" | "CbFT" })}
                  options={[
                    { value: "CbM", label: "CbM" },
                    { value: "CbFT", label: "CbFT" },
                  ]}
                />
              </div>
            </Field>
          </div>
        </div>
      ))}

      <button type="button" className="pp2-parcel__add" onClick={() => setParcels([...parcels, { unit: "CbM", optionHolder: "MOLOO" }])}>
        + Add another parcel
      </button>
      {parcels.length > 0 && (
        <InlineNote>
          Each parcel posts as its own cargo listing — classified and matched independently — grouped under this one posting
          (shared lane, laycan and terms).
        </InlineNote>
      )}
    </div>
  );
}

/** Parcels 2..N are complete when each has commodity+form+qty+volume. */
export function extraParcelsComplete(s: CargoState): boolean {
  return (s.extraParcels ?? []).every(
    (p) => !!p.commodity?.name && !!p.commodity?.form && Number(p.qtyMt) > 0 && Number(p.volume) > 0,
  );
}
