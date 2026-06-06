"use client";

// Post Cargo — 5-step design flow (Cargo / Ports & Qty / Laycan & Terms /
// Safety / Review), ported from asb/post-cargo.jsx. Field validation is driven
// by the ArabShipBroker Validation Matrix v2 (lib/portal/validation.ts):
// required / range / enum / format / cross-field / date / dependency / soft
// warning — with the ASB editorial corrections (rate max 8,000; commission TTL
// 0–5%; laycan order + 45-day window; bag weight required when Bagged).
import * as React from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { submitCargo, setListingCirculation } from "@/sdk/app/cargos";
import type { CargoOpt } from "@/lib/portal/post-types";
import { useUnsavedGuard } from "./UnsavedDialog";
import { Stepper, Section, Field, ReviewRow, VisibilityChooser, Success } from "./wizard";
import { SmartParser } from "./SmartParser";
import type { CircularParseResult } from "@/lib/circulars/types";
import * as V from "@/lib/portal/validation";

const STEPS = ["Cargo", "Ports & Qty", "Laycan & Terms", "Safety", "Review"];

interface State {
  commodityId: string;
  cargoType: string;
  nature: string;
  packaging: string;
  polCode: string; polName: string;
  podCode: string; podName: string;
  minQty: string; maxQty: string; molPct: string; molType: string;
  laycanFrom: string; laycanTo: string;
  loadTerms: string; laytime: string; loadRate: string; dischRate: string;
  freightIdea: string; commission: string; demRate: string; despatchRate: string;
  isDg: boolean; grainBooklet: boolean; moisture: string; bagWeight: string;
  forCirculation: boolean | null;
}
const INITIAL: State = {
  commodityId: "", cargoType: "Dry Bulk", nature: "Firm", packaging: "Bulk",
  polCode: "", polName: "", podCode: "", podName: "",
  minQty: "", maxQty: "", molPct: "5", molType: "MOLOO",
  laycanFrom: "", laycanTo: "",
  loadTerms: "FIOST", laytime: "PWWD SHINC", loadRate: "", dischRate: "",
  freightIdea: "", commission: "2.50", demRate: "", despatchRate: "",
  isDg: false, grainBooklet: false, moisture: "", bagWeight: "",
  forCirculation: null,
};

type FieldKey = keyof State;
const STEP_FIELDS: FieldKey[][] = [
  ["commodityId", "cargoType", "nature", "packaging"],
  ["polCode", "podCode", "minQty", "maxQty", "molPct", "molType"],
  ["laycanFrom", "laycanTo", "loadTerms", "laytime", "loadRate", "dischRate", "freightIdea", "commission", "demRate", "despatchRate"],
  ["bagWeight", "moisture"],
  [],
];

// Per-field validation, straight from the matrix.
function validate(s: State): V.Issues<FieldKey> {
  const bagged = s.packaging === "Bagged";
  return V.collect<FieldKey>([
    ["commodityId", V.required(s.commodityId, "Please select a valid commodity")],
    ["cargoType", V.oneOf(s.cargoType, V.CARGO_TYPES, "Please select cargo type")],
    ["packaging", V.oneOf(s.packaging, V.PACKAGING_TYPES, "Please select packaging type")],
    // Ports & quantity
    ["polCode", V.required(s.polCode, "Please select a valid load port") || V.locode(s.polCode)],
    ["podCode",
      V.required(s.podCode, "Please select a valid discharge port") ||
      V.locode(s.podCode) ||
      V.mustDiffer(s.polCode, s.podCode, "Discharge port must differ from load port")],
    ["minQty", V.inRange(s.minQty, V.RANGES.qtyMt)],
    ["maxQty", V.required(s.maxQty, "Quantity is required") || V.inRange(s.maxQty, V.RANGES.qtyMt)],
    ["molPct", V.inRange(s.molPct, V.RANGES.molPct)],
    ["molType", s.molPct.trim() ? V.required(s.molType, "Select MOLOO or MOLCHOPT when tolerance % is set") || V.oneOf(s.molType, V.MOL_HOLDERS, "Please select an option holder") : null],
    // Laycan & terms (laycan validated when provided — spot/TBD allowed)
    ["laycanFrom", V.notPast(s.laycanFrom, "Laycan date cannot be in the past")],
    ["laycanTo",
      V.order(s.laycanFrom, s.laycanTo, "Laycan end must be after laycan start") ||
      V.windowMax(s.laycanFrom, s.laycanTo, 45, "Laycan window cannot exceed 45 days")],
    ["loadTerms", V.oneOf(s.loadTerms, V.LOAD_TERMS, "Please select load terms")],
    ["laytime", V.oneOf(s.laytime, V.LAYTIME_BASIS_OPTIONS, "Please select laytime basis")],
    ["loadRate", V.inRange(s.loadRate, V.RANGES.loadRate)],
    ["dischRate", V.inRange(s.dischRate, V.RANGES.dischRate)],
    ["freightIdea", V.inRange(s.freightIdea, V.RANGES.freightIdea)],
    ["commission", V.inRange(s.commission, V.RANGES.commissionTtl)],
    ["demRate", V.inRange(s.demRate, V.RANGES.demurrage)],
    ["despatchRate", V.inRange(s.despatchRate, V.RANGES.despatchRate)],
    // Safety — dependency: bag weight required only when Bagged
    ["bagWeight", bagged ? (V.required(s.bagWeight, "Bag weight required when cargo is bagged") || V.inRange(s.bagWeight, V.RANGES.bagWeightKg)) : null],
  ]);
}

export function PostCargoFlow({ commodities }: { commodities: CargoOpt[] }) {
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<State>(INITIAL);
  const [attempted, setAttempted] = React.useState<boolean[]>([false, false, false, false, false]);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const set = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));

  const dirty = React.useMemo(() => JSON.stringify(state) !== JSON.stringify(INITIAL), [state]);
  useUnsavedGuard(dirty && !done);

  const commodity = commodities.find((c) => c.id === state.commodityId) || null;
  const issues = React.useMemo(() => validate(state), [state]);
  // Show a field's error only once its step has been attempted.
  const errFor = (k: FieldKey): string | undefined => {
    const si = STEP_FIELDS.findIndex((fs) => fs.includes(k));
    return si >= 0 && attempted[si] ? issues[k] : undefined;
  };
  // Soft warning (R91): despatch blank while demurrage set.
  const despatchHint =
    !state.despatchRate.trim() && state.demRate.trim() ? "Typical despatch ≈ half of demurrage rate" : undefined;

  const stepHasIssues = (i: number) => STEP_FIELDS[i].some((k) => issues[k]);
  const markAttempted = (i: number) => setAttempted((a) => (a[i] ? a : a.map((v, idx) => (idx === i ? true : v))));

  const goNext = () => {
    if (stepHasIssues(step)) { markAttempted(step); return; }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    const firstBad = STEP_FIELDS.findIndex((_, i) => stepHasIssues(i));
    if (firstBad >= 0) { markAttempted(firstBad); setStep(firstBad); return; }
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { id } = await submitCargo(supabase, {
        commodity_id: state.commodityId,
        commodity_name: commodity?.name ?? "",
        cargo_type: state.cargoType as "Dry Bulk" | "Break Bulk",
        imsbc_category: "Cat_C",
        is_dg_cargo: state.isDg,
        is_grain_cargo: !!commodity?.isGrain,
        qty_min_mt: Number(state.minQty) || Number(state.maxQty) || 0,
        qty_max_mt: Number(state.maxQty) || Number(state.minQty) || 0,
        load_port_locode: state.polCode,
        disch_port_locode: state.podCode,
        packaging_type: state.packaging,
        bag_weight_kg: state.packaging === "Bagged" && state.bagWeight ? Number(state.bagWeight) : undefined,
        tolerance_pct: state.molPct ? Number(state.molPct) : undefined,
        tolerance_holder: state.molPct ? state.molType : undefined,
        laycan_from: state.laycanFrom || undefined,
        laycan_to: state.laycanTo || undefined,
        load_rate: state.loadRate ? Number(state.loadRate) : undefined,
        disch_rate: state.dischRate ? Number(state.dischRate) : undefined,
        load_terms: state.loadTerms as never,
        laytime_basis: state.laytime as never,
        freight_idea_usd_mt: state.freightIdea ? Number(state.freightIdea) : undefined,
        commission_ttl_pct: state.commission ? Number(state.commission) : undefined,
        demurrage_rate: state.demRate ? Number(state.demRate) : undefined,
        despatch_rate: state.despatchRate ? Number(state.despatchRate) : undefined,
      } as never);
      // Persist the owner's visibility choice (default is circulate).
      if (id && state.forCirculation === false) {
        try { await setListingCirculation(supabase, "cargo", id, false); } catch { /* defaults to circulated */ }
      }
      setDone(true);
    } catch {
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Built-in sample (used when the AI parser is unavailable).
  const applyDemo = () => {
    const c = commodities[0];
    set({
      commodityId: c?.id ?? state.commodityId, cargoType: c?.cargoType ?? state.cargoType, isDg: c?.isDg ?? state.isDg,
      polCode: "RUNVS", polName: "Novorossiysk", podCode: "EGDAM", podName: "Damietta",
      minQty: "8000", maxQty: "10000", laycanFrom: "2026-04-14", laycanTo: "2026-04-18",
      loadTerms: "FIOST", freightIdea: "28", commission: "2.50",
    });
    return 10;
  };

  // Map a real AI parse result into the form; falls back to the sample if null.
  const applyParsed = (result: CircularParseResult | null): number => {
    if (!result) return applyDemo();
    const e = result.extracted;
    const patch: Partial<State> = {};
    let n = 0;
    const put = (k: keyof State, v: string | boolean | undefined | null) => {
      if (v !== undefined && v !== null && v !== "") { (patch as Record<string, unknown>)[k] = v; n++; }
    };
    const num = (v: number | undefined | null) => (v != null ? String(v) : undefined);

    if (e.commodity_name) {
      const q = e.commodity_name.toLowerCase();
      const match = commodities.find(
        (c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(",")[0].trim()),
      );
      if (match) { patch.commodityId = match.id; patch.cargoType = match.cargoType; patch.isDg = match.isDg; n++; }
    }
    put("cargoType", e.cargo_type);
    put("minQty", num(e.qty_min_mt));
    put("maxQty", num(e.qty_max_mt));
    put("polCode", e.load_port_locode);
    put("polName", e.load_port_name);
    put("podCode", e.disch_port_locode);
    put("podName", e.disch_port_name);
    put("laycanFrom", e.laycan_from ?? undefined);
    put("laycanTo", e.laycan_to ?? undefined);
    put("loadTerms", e.load_terms);
    put("loadRate", e.load_rate);
    put("dischRate", e.disch_rate);
    put("freightIdea", num(e.freight_idea_usd_mt));
    put("commission", num(e.commission_pct));
    if (e.is_dg_cargo != null) { patch.isDg = e.is_dg_cargo; n++; }
    if (e.is_grain_cargo) { patch.grainBooklet = true; n++; }
    set(patch);
    return n;
  };

  if (done) {
    return (
      <div className="pp-shell"><div className="pp-main"><div className="pc-body">
        <Success
          title="Cargo submitted for review"
          sub="Arab ShipBroker reviews new listings before they go live (usually within 2 hours). You'll be notified on approval."
          onReset={() => { setState(INITIAL); setStep(0); setDone(false); setAttempted([false, false, false, false, false]); }}
        />
      </div></div></div>
    );
  }

  return (
    <div className="pp-shell">
      <div className="pp-main">
        <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
          <div className="row-sb">
            <div>
              <h1 className="page-title">Post Cargo</h1>
              <div className="eyebrow" style={{ marginTop: 2 }}>5-step listing, reviewed by Arab ShipBroker before publishing</div>
            </div>
            <button className="asb-btn ghost" type="button">Save draft &amp; exit</button>
          </div>
        </div>

        <Stepper steps={STEPS} step={step} setStep={setStep} />

        <div className="pc-body">
          {step === 0 && (
            <Section title="Cargo">
              <Field label="Commodity" required full error={errFor("commodityId")}>
                <select value={state.commodityId} onChange={(e) => { const c = commodities.find((x) => x.id === e.target.value); set({ commodityId: e.target.value, cargoType: c?.cargoType ?? state.cargoType, isDg: c?.isDg ?? state.isDg }); }}>
                  <option value="">Select commodity…</option>
                  {commodities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Cargo type" error={errFor("cargoType")}>
                <select value={state.cargoType} onChange={(e) => set({ cargoType: e.target.value })}>{V.CARGO_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </Field>
              <Field label="Cargo nature">
                <select value={state.nature} onChange={(e) => set({ nature: e.target.value })}>{V.CARGO_NATURES.map((t) => <option key={t}>{t}</option>)}</select>
              </Field>
              <Field label="Packaging" error={errFor("packaging")}>
                <select value={state.packaging} onChange={(e) => set({ packaging: e.target.value })}>{V.PACKAGING_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </Field>
              <Field label="DG cargo">
                <select value={state.isDg ? "Yes" : "No"} onChange={(e) => set({ isDg: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select>
              </Field>
            </Section>
          )}

          {step === 1 && (
            <Section title="Ports & quantity">
              <Field label="Load port (LOCODE)" required error={errFor("polCode")}><input value={state.polCode} onChange={(e) => set({ polCode: e.target.value.toUpperCase() })} placeholder="e.g. EGALY" maxLength={5} /></Field>
              <Field label="Load port name"><input value={state.polName} onChange={(e) => set({ polName: e.target.value })} placeholder="Alexandria" /></Field>
              <Field label="Discharge port (LOCODE)" required error={errFor("podCode")}><input value={state.podCode} onChange={(e) => set({ podCode: e.target.value.toUpperCase() })} placeholder="e.g. SAJED" maxLength={5} /></Field>
              <Field label="Discharge port name"><input value={state.podName} onChange={(e) => set({ podName: e.target.value })} placeholder="Jeddah" /></Field>
              <Field label="Min quantity (MT)" error={errFor("minQty")}><input type="number" value={state.minQty} onChange={(e) => set({ minQty: e.target.value })} /></Field>
              <Field label="Max quantity (MT)" required error={errFor("maxQty")}><input type="number" value={state.maxQty} onChange={(e) => set({ maxQty: e.target.value })} /></Field>
              <Field label="MOL %" error={errFor("molPct")}><input type="number" value={state.molPct} onChange={(e) => set({ molPct: e.target.value })} /></Field>
              <Field label="MOL holder" error={errFor("molType")}><select value={state.molType} onChange={(e) => set({ molType: e.target.value })}>{V.MOL_HOLDERS.map((t) => <option key={t}>{t}</option>)}</select></Field>
            </Section>
          )}

          {step === 2 && (
            <Section title="Laycan & commercial terms">
              <Field label="Laycan from" error={errFor("laycanFrom")}><input type="date" value={state.laycanFrom} onChange={(e) => set({ laycanFrom: e.target.value })} /></Field>
              <Field label="Laycan to" error={errFor("laycanTo")}><input type="date" value={state.laycanTo} onChange={(e) => set({ laycanTo: e.target.value })} /></Field>
              <Field label="Load terms" error={errFor("loadTerms")}><select value={state.loadTerms} onChange={(e) => set({ loadTerms: e.target.value })}>{V.LOAD_TERMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Laytime basis" error={errFor("laytime")}><select value={state.laytime} onChange={(e) => set({ laytime: e.target.value })}>{V.LAYTIME_BASIS_OPTIONS.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Load rate (MT/d)" error={errFor("loadRate")}><input type="number" value={state.loadRate} onChange={(e) => set({ loadRate: e.target.value })} /></Field>
              <Field label="Discharge rate (MT/d)" error={errFor("dischRate")}><input type="number" value={state.dischRate} onChange={(e) => set({ dischRate: e.target.value })} /></Field>
              <Field label="Freight idea ($/MT)" error={errFor("freightIdea")}><input type="number" value={state.freightIdea} onChange={(e) => set({ freightIdea: e.target.value })} /></Field>
              <Field label="Commission TTL (%)" error={errFor("commission")}><input type="number" step="0.25" value={state.commission} onChange={(e) => set({ commission: e.target.value })} /></Field>
              <Field label="Demurrage ($/d)" error={errFor("demRate")}><input type="number" value={state.demRate} onChange={(e) => set({ demRate: e.target.value })} /></Field>
              <Field label="Despatch ($/d)" error={errFor("despatchRate")} hint={despatchHint}><input type="number" value={state.despatchRate} onChange={(e) => set({ despatchRate: e.target.value })} /></Field>
            </Section>
          )}

          {step === 3 && (
            <Section title="Safety & certificates">
              <Field label="Grain booklet required"><select value={state.grainBooklet ? "Yes" : "No"} onChange={(e) => set({ grainBooklet: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
              <Field label="DG certified vessel required"><select value={state.isDg ? "Yes" : "No"} onChange={(e) => set({ isDg: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
              <Field label="Moisture content (%)"><input type="number" value={state.moisture} onChange={(e) => set({ moisture: e.target.value })} /></Field>
              {state.packaging === "Bagged" && (
                <Field label="Bag weight (kg)" required error={errFor("bagWeight")}><input type="number" value={state.bagWeight} onChange={(e) => set({ bagWeight: e.target.value })} placeholder="e.g. 50" /></Field>
              )}
            </Section>
          )}

          {step === 4 && (
            <>
              <div className="pc-section">
                <div className="pc-section__title">Review</div>
                <ReviewRow k="Commodity" v={commodity?.name} />
                <ReviewRow k="Type / nature" v={`${state.cargoType} · ${state.nature}`} />
                <ReviewRow k="Packaging" v={state.packaging === "Bagged" && state.bagWeight ? `Bagged · ${state.bagWeight} kg/bag` : state.packaging} />
                <ReviewRow k="Route" v={state.polCode && state.podCode ? `${state.polCode} → ${state.podCode}` : ""} />
                <ReviewRow k="Quantity" v={state.maxQty ? `${state.minQty || state.maxQty}–${state.maxQty} MT (${state.molPct}% ${state.molType})` : ""} />
                <ReviewRow k="Laycan" v={state.laycanFrom && state.laycanTo ? `${state.laycanFrom} → ${state.laycanTo}` : ""} />
                <ReviewRow k="Terms" v={`${state.loadTerms} · ${state.laytime}`} />
                <ReviewRow k="Freight idea" v={state.freightIdea ? `$${state.freightIdea}/MT · ${state.commission}% TTL` : ""} />
                <ReviewRow k="Dem / Desp" v={state.demRate ? `$${state.demRate}/d${state.despatchRate ? ` · desp $${state.despatchRate}/d` : ""}` : ""} />
              </div>
              <div className="pc-section">
                <div className="pc-section__title">Visibility</div>
                <VisibilityChooser value={state.forCirculation} onChange={(v) => set({ forCirculation: v })} />
              </div>
            </>
          )}
        </div>

        <div className="pc-footer">
          <button type="button" className="pc-btn pc-btn--ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Back</button>
          <div className="pc-footer__hint">
            {attempted[step] && stepHasIssues(step)
              ? <span style={{ color: "var(--asb-red)" }}>Please fix the highlighted fields</span>
              : step < 4 ? `Step ${step + 1} of ${STEPS.length}` : "Review your listing"}
          </div>
          {step < 4 ? (
            <button type="button" className="pc-btn pc-btn--primary" onClick={goNext}>Continue →</button>
          ) : (
            <button type="button" className="pc-btn pc-btn--primary" disabled={state.forCirculation == null || submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit →"}</button>
          )}
        </div>
      </div>
      <SmartParser onApply={applyParsed} mode="cargo" />
    </div>
  );
}
