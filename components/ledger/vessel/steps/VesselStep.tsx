"use client";

// Post Vessel — Vessel step: registry search by name/IMO, minimal add-new
// identity capture (IMO check digit), TBN mode, vessel card with the
// ownership & management chain. Ported from reference/handoff/asb/pp2-steps.jsx
// with the demo fleet replaced by the real registry (searchVesselRegistry).

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { validateImoCheckDigit } from "@/lib/schemas/cargo";
import { searchVesselRegistry, type VesselRegistryHit } from "@/sdk/app/ledger";
import type { StepCtx } from "../../types";
import type { LedgerVessel, VesselState } from "../state";
import { Field, InlineNote, SelectTip, TextInput, fmt } from "../../fields";
import { Icon, LedgerButton, LedgerInput, SegmentedToggle, StatusBadge } from "../../ds";
import { LEDGER_ENUMS, SIZE_GATE_DWT as GATE, VTYPE_DEFS } from "../../defs";
import { OwnershipBlock } from "../OwnershipChain";

export const registryHitToVessel = (v: VesselRegistryHit): LedgerVessel => ({
  id: v.id,
  imo: v.imo_number,
  name: v.vessel_name,
  type: v.vessel_type,
  dwt: v.dwt_grain,
  built: v.build_year ? String(v.build_year) : null,
  flag: v.flag,
  grt: v.gross_tonnage,
  loa: v.max_loa_m,
  beam: v.beam_m,
  draft: v.max_draft_m,
  classSociety: v.class_society,
  verified: !!v.is_verified,
  source: v.source_tag ?? "Registry",
  regOwner: v.registered_owner,
  parentGroup: v.parent_group,
  ismManager: v.technical_operator,
  disponentOwner: v.disponent_owner,
  numHolds: v.num_holds,
  numHatches: v.num_hatches,
  boxShaped: v.box_shaped == null ? null : v.box_shaped ? "Y" : "N",
  hatchType: v.hatch_type,
  strengthenedHeavy: v.strengthened_heavy == null ? null : v.strengthened_heavy ? "Y" : "N",
  holdsMayBeEmpty: v.holds_may_be_empty,
  logFitted: v.log_fitted == null ? null : v.log_fitted ? "Y" : "N",
  isGeared: v.is_geared == null ? null : v.is_geared ? "Y" : "N",
  craneCount: v.crane_count,
  craneSwl: v.crane_swl_mt,
});

export function VesselCard({
  v,
  onChange,
  patch,
}: {
  v: LedgerVessel;
  onChange?: () => void;
  patch?: (u: Partial<LedgerVessel>) => void;
}) {
  const dwt = Number(v.dwt) || 0;
  const over = dwt > GATE;
  const enriched = !!v.numHolds || !!v.serviceSpeed;
  return (
    <div className={"pp2-vcard" + (over ? " is-over" : "")}>
      <div className="pp2-vcard__top">
        <div className="pp2-vcard__idn">
          <div className="pp2-vcard__name">{v.name || "New vessel"}</div>
          <div className="pp2-vcard__imo">
            IMO {v.imo || "-"}
            {v.flag ? " · " + v.flag : ""}
            {v.built ? " · built " + v.built : ""}
          </div>
        </div>
        <div className="pp2-vcard__badges">
          <StatusBadge status={v.verified ? "in" : "review"}>{v.verified ? "Verified" : "Unverified"}</StatusBadge>
          {onChange && (
            <button type="button" className="pp2-vcard__change" onClick={onChange}>
              Change
            </button>
          )}
        </div>
      </div>
      <div className="pp2-vcard__stats">
        <div className="pp2-stat">
          <span className="pp2-stat__k">DWT</span>
          <span className={"pp2-stat__v" + (over ? " is-alert" : "")}>{fmt(v.dwt)} MT</span>
        </div>
        <div className="pp2-stat">
          <span className="pp2-stat__k">Type</span>
          <span className="pp2-stat__v">{v.type || "-"}</span>
        </div>
        <div className="pp2-stat">
          <span className="pp2-stat__k">LOA</span>
          <span className="pp2-stat__v">{v.loa ? v.loa + " m" : "-"}</span>
        </div>
        <div className="pp2-stat">
          <span className="pp2-stat__k">GRT</span>
          <span className="pp2-stat__v">{fmt(v.grt)}</span>
        </div>
        <div className="pp2-stat">
          <span className="pp2-stat__k">Class</span>
          <span className="pp2-stat__v">{v.classSociety || "-"}</span>
        </div>
      </div>
      {over && (
        <InlineNote tone="alert">
          At {fmt(v.dwt)} MT this is over the {fmt(GATE)} DWT niche gate - Arab ShipBroker focuses on tonnage below this size.
        </InlineNote>
      )}
      {!over && !v.verified && (
        <InlineNote>
          Usable right away - flagged <strong>Unverified</strong> until Arab ShipBroker confirms the record.
        </InlineNote>
      )}
      {enriched && <InlineNote tone="ok">Cargo arrangement &amp; performance are on file for this vessel - pre-filled in the next steps.</InlineNote>}
      <OwnershipBlock v={v} patch={patch} />
    </div>
  );
}

export function VesselStep({ state, patch }: StepCtx<VesselState>) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<VesselRegistryHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawMode = state.entryMode || "search";
  const mode = rawMode === "tbn" ? "tbn" : "search";
  const setMode = (m: string) => patch({ entryMode: m as "search" | "tbn" });

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) {
        setMatches([]);
        return;
      }
      setSearching(true);
      try {
        const supabase = getSupabaseBrowserClient();
        setMatches(await searchVesselRegistry(supabase, q));
      } catch {
        setMatches([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const chooseFleet = (hit: VesselRegistryHit) => {
    const v = registryHitToVessel(hit);
    patch({ vessel: v, vesselImo: v.imo ?? null, arrangement: null, performance: null, gear: null });
  };
  const clearVessel = () => patch({ vessel: null, vesselImo: null, arrangement: null, performance: null, gear: null });

  const startNew = () => {
    const digits = q.replace(/\D/g, "");
    const asImo = digits.length === 7 && validateImoCheckDigit(digits);
    patch({
      vessel: {
        imo: asImo ? digits : "",
        name: asImo ? "" : q.trim().toUpperCase(),
        type: "Bulk Carrier",
        dwt: "",
        built: "",
        flag: "",
        grt: "",
        loa: "",
        classSociety: "",
        verified: false,
        source: "User entry",
      },
      vesselImo: asImo ? digits : null,
      arrangement: null,
    });
  };
  const patchVessel = (u: Partial<LedgerVessel>) => patch({ vessel: { ...(state.vessel || {}), ...u } });

  const isRegistryVessel = !!state.vessel?.id;

  const tbn = state.tbn || { type: "Bulk Carrier", dwt: "", built: "", flag: "", loa: "", beam: "", draft: "", grt: "", classSociety: "" };
  const patchTbn = (u: Partial<NonNullable<VesselState["tbn"]>>) => patch({ tbn: { ...tbn, ...u } });

  return (
    <div className="pp2-vessel">
      {!state.vessel && (
        <div className="pp2-spine">
          <div className="pp2-spine__ic">
            <Icon name="Vessel" size={22} />
          </div>
          <div className="pp2-spine__txt">
            <div className="pp2-spine__k">Vessel lookup</div>
            <div className="pp2-spine__h">Search by name or IMO, or add a new vessel</div>
          </div>
        </div>
      )}
      <SegmentedToggle
        className="pp2-modes"
        value={mode}
        onChange={(m) => {
          setMode(m);
          if (m !== "tbn") clearVessel();
        }}
        options={[
          { value: "search", label: "Search vessel" },
          { value: "tbn", label: "TBN" },
        ]}
      />

      {/* MODE: search — the live registry */}
      {mode === "search" && !state.vessel && (
        <div className="pp2-fleet">
          <LedgerInput search placeholder="Search by vessel name or IMO…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!q.trim() ? (
            <div className="pp2-fleet__hint">
              <span>Start typing a vessel name or IMO to find her.</span>
            </div>
          ) : matches.length > 0 ? (
            <div className="pp2-vlist">
              {matches.map((v) => (
                <button type="button" className="pp2-vrow" key={v.id} onClick={() => chooseFleet(v)}>
                  <span className="pp2-vrow__main">
                    <span className="pp2-vrow__name">{v.vessel_name}</span>
                    <span className="pp2-vrow__meta">
                      IMO {v.imo_number || "-"} · {v.vessel_type} · {fmt(v.dwt_grain)} MT
                      {v.flag ? " · " + v.flag : ""}
                    </span>
                  </span>
                  <span className="pp2-vrow__right">
                    <StatusBadge status={v.is_verified ? "in" : "review"}>{v.is_verified ? "Verified" : "Unverified"}</StatusBadge>
                    <Icon name="Caret" size={14} direction="right" />
                  </span>
                </button>
              ))}
            </div>
          ) : searching ? (
            <div className="pp2-fleet__hint">
              <span>Searching the registry…</span>
            </div>
          ) : (
            <div className="pp2-nomatch">
              <div className="pp2-nomatch__t">
                <Icon name="Vessel" size={16} /> No vessel matches “{q.trim()}”.
              </div>
              <div className="pp2-nomatch__hint">Add her with a few essentials, or let Bosun read them off a Q88 or pasted details.</div>
              <div className="pp2-nomatch__actions">
                <LedgerButton variant="primary" onClick={startNew}>
                  Add “{q.trim()}”
                </LedgerButton>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Identity capture for a brand-new vessel */}
      {mode === "search" && state.vessel && !isRegistryVessel && (
        <div className="pp2-newform">
          <VesselCard v={state.vessel} onChange={clearVessel} patch={patchVessel} />
          <div className="pp2-grid" style={{ marginTop: 14 }}>
            <Field label="IMO number" req help="7-digit permanent ship ID we build the vessel against.">
              <input
                className="pp2-select"
                style={{ backgroundImage: "none", letterSpacing: ".04em", fontVariantNumeric: "tabular-nums" }}
                inputMode="numeric"
                maxLength={7}
                value={state.vessel.imo ?? ""}
                onChange={(e) => patchVessel({ imo: e.target.value.replace(/\D/g, "").slice(0, 7) })}
                placeholder="e.g. 9235945"
              />
            </Field>
            <Field label="Vessel name" req help="Plain name, no MV / M/V prefix.">
              <TextInput value={state.vessel.name} onChange={(x) => patchVessel({ name: x.toUpperCase() })} placeholder="e.g. GULF TRADER" />
            </Field>
            <Field label="Vessel type" req help="The vessel category. Hover an option for its definition.">
              <SelectTip value={state.vessel.type} onChange={(v) => patchVessel({ type: v })} options={[...LEDGER_ENUMS.vesselType]} defs={VTYPE_DEFS} placeholder="Select…" />
            </Field>
            <Field label="DWT (MT)" req help="Deadweight in metric tonnes. Drives the size gate and the cargo match.">
              <TextInput value={String(state.vessel.dwt ?? "")} onChange={(x) => patchVessel({ dwt: x.replace(/[^\d]/g, "") })} placeholder="e.g. 8,200" />
            </Field>
            <Field label="Flag" req help="Flag state of registry.">
              <TextInput value={state.vessel.flag} onChange={(x) => patchVessel({ flag: x })} placeholder="e.g. Panama" />
            </Field>
            <Field label="Built">
              <TextInput value={state.vessel.built} maxLength={4} onChange={(x) => patchVessel({ built: x.replace(/\D/g, "").slice(0, 4) })} placeholder="e.g. 2006" />
            </Field>
            <Field label="LOA (m)">
              <TextInput value={String(state.vessel.loa ?? "")} onChange={(x) => patchVessel({ loa: x.replace(/[^\d.]/g, "") })} placeholder="e.g. 120" />
            </Field>
          </div>
          {state.vessel.imo && state.vessel.imo.length === 7 && !validateImoCheckDigit(state.vessel.imo) && (
            <InlineNote tone="alert">That IMO number fails the check digit — please double-check it.</InlineNote>
          )}
        </div>
      )}

      {/* Selected vessel from the registry */}
      {state.vessel && !(mode === "search" && !isRegistryVessel) && <VesselCard v={state.vessel} onChange={clearVessel} patch={patchVessel} />}

      {/* MODE: TBN */}
      {mode === "tbn" && (
        <div className="pp2-tbn">
          <InlineNote icon={<Icon name="Vessel" size={14} />}>
            To-be-nominated. Give her full particulars so charterers can match and estimate; only the IMO and name stay hidden until you have a fixture.
          </InlineNote>
          <div className="pp2-grid" style={{ marginTop: 12 }}>
            <Field label="Vessel type" req help="The vessel category. Hover an option for its definition.">
              <SelectTip value={tbn.type} onChange={(v) => patchTbn({ type: v })} options={[...LEDGER_ENUMS.vesselType]} defs={VTYPE_DEFS} placeholder="Select…" />
            </Field>
            <Field label="DWT (abt, MT)" req help="Approximate deadweight. Drives the size gate and the cargo match.">
              <TextInput value={tbn.dwt} onChange={(x) => patchTbn({ dwt: x.replace(/[^\d]/g, "") })} placeholder="e.g. 12,000" />
            </Field>
            <Field label="Flag" req help="Flag state of registry.">
              <TextInput value={tbn.flag} onChange={(x) => patchTbn({ flag: x })} placeholder="e.g. Panama" />
            </Field>
            <Field label="Built">
              <TextInput value={tbn.built} maxLength={4} onChange={(x) => patchTbn({ built: x.replace(/\D/g, "").slice(0, 4) })} placeholder="e.g. 2010" />
            </Field>
            <Field label="LOA (m)">
              <TextInput value={tbn.loa} onChange={(x) => patchTbn({ loa: x.replace(/[^\d.]/g, "") })} placeholder="e.g. 140" />
            </Field>
            <Field label="Beam (m)">
              <TextInput value={tbn.beam} onChange={(x) => patchTbn({ beam: x.replace(/[^\d.]/g, "") })} placeholder="e.g. 22" />
            </Field>
            <Field label="Draft (m)">
              <TextInput value={tbn.draft} onChange={(x) => patchTbn({ draft: x.replace(/[^\d.]/g, "") })} placeholder="e.g. 9" />
            </Field>
            <Field label="GRT">
              <TextInput value={tbn.grt} onChange={(x) => patchTbn({ grt: x.replace(/[^\d]/g, "") })} placeholder="e.g. 9,600" />
            </Field>
            <Field label="Class society">
              <TextInput value={tbn.classSociety} onChange={(x) => patchTbn({ classSociety: x })} placeholder="e.g. BV" />
            </Field>
          </div>
          {Number(tbn.dwt) > GATE && (
            <InlineNote tone="alert" style={{ marginTop: 10 }}>
              DWT is over the {fmt(GATE)} niche gate.
            </InlineNote>
          )}
        </div>
      )}
    </div>
  );
}

export function vesselSummary(s: VesselState): string {
  if (s.entryMode === "tbn" && s.tbn) return "TBN · " + (s.tbn.type || "") + (s.tbn.dwt ? " · " + fmt(s.tbn.dwt) + " MT" : "");
  if (s.vessel) return s.vessel.name + " · IMO " + (s.vessel.imo || "-") + " · " + fmt(s.vessel.dwt) + " MT" + (s.vessel.verified ? "" : " · Unverified");
  return "Not set";
}

export function vesselComplete(s: VesselState): boolean {
  if (s.entryMode === "tbn") {
    const t = s.tbn;
    return !!(t && t.type && t.dwt && Number(t.dwt) > 0 && Number(t.dwt) <= GATE && t.flag);
  }
  if (!s.vessel) return false;
  const dwt = Number(s.vessel.dwt) || 0;
  const imoOk = !!s.vessel.imo && (!s.vessel.id ? validateImoCheckDigit(s.vessel.imo) : true);
  // Flag is marked required on the hand-entry form; registry picks carry
  // whatever the record holds.
  const flagOk = s.vessel.id ? true : !!s.vessel.flag;
  return !!s.vessel.name && imoOk && flagOk && dwt > 0 && dwt <= GATE;
}
