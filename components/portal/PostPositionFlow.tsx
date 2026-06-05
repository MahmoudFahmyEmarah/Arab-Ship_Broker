"use client";

// Post Position — 4-step design flow (Vessel / Port & Date / Performance /
// Review), ported from asb/post-position.jsx. Field validation is driven by the
// ArabShipBroker Validation Matrix v2 (lib/portal/validation.ts): required /
// format / range / date / dependency — incl. the ASB corrections (open date
// capped at +90 days) and the geared→grab dependency group (grab type/capacity/
// number appear and become required only when the vessel is geared).
import * as React from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { submitVesselAvailability } from "@/sdk/app/vessels";
import { setListingCirculation } from "@/sdk/app/cargos";
import type { VesselOpt } from "@/lib/portal/post-types";
import { useUnsavedGuard } from "./UnsavedDialog";
import { Stepper, Section, Field, ReviewRow, VisibilityChooser, Success } from "./wizard";
import { SmartParser } from "./SmartParser";
import type { CircularParseResult } from "@/lib/circulars/types";
import * as V from "@/lib/portal/validation";

const STEPS = ["Vessel", "Port & Date", "Performance", "Review"];
const GEAR_OPTS = ["Gearless", "Geared"] as const;

interface State {
  vesselId: string;
  openCode: string; openName: string; openDate: string; rangeDays: string;
  lastCargo: string; partCargo: boolean;
  speed: string; meSea: string; mePort: string; auxSea: string; auxPort: string; fuel: string;
  gear: string; grabType: string; grabCap: string; grabCount: string;
  notes: string;
  forCirculation: boolean | null;
}
const INITIAL: State = {
  vesselId: "", openCode: "", openName: "", openDate: "", rangeDays: "7",
  lastCargo: "", partCargo: false,
  speed: "", meSea: "", mePort: "", auxSea: "", auxPort: "", fuel: "VLSFO",
  gear: "Gearless", grabType: "None", grabCap: "", grabCount: "",
  notes: "", forCirculation: null,
};

type FieldKey = keyof State;
const STEP_FIELDS: FieldKey[][] = [
  ["vesselId"],
  ["openCode", "openDate", "rangeDays"],
  ["speed", "meSea", "auxSea", "gear", "grabType", "grabCap", "grabCount"],
  [],
];

function validate(s: State): V.Issues<FieldKey> {
  const geared = s.gear === "Geared";
  const grabActive = geared && !!s.grabType && s.grabType !== "None";
  return V.collect<FieldKey>([
    ["vesselId", V.required(s.vesselId, "Please select one of your vessels")],
    // Port & date — open date must be today … today + 90 (ASB correction R87/R88)
    ["openCode", V.required(s.openCode, "Please select a valid open port") || V.locode(s.openCode)],
    ["openDate", V.required(s.openDate, "Open date is required") || V.within(s.openDate, 90, "Open date must be within the next 90 days")],
    ["rangeDays", V.inRange(s.rangeDays, V.RANGES.openDateFlex)],
    // Performance ranges
    ["speed", V.inRange(s.speed, V.RANGES.serviceSpeed)],
    ["meSea", V.inRange(s.meSea, V.RANGES.meConsumption)],
    ["auxSea", V.inRange(s.auxSea, V.RANGES.auxConsumption)],
    // Gear + grab dependency (R40, R95–R97)
    ["gear", V.oneOf(s.gear, GEAR_OPTS, "Please select gear type")],
    ["grabType", geared ? (V.required(s.grabType, "Please select grab type for geared vessel") || V.oneOf(s.grabType, V.GRAB_TYPES, "Please select grab type")) : null],
    ["grabCap", grabActive ? (V.required(s.grabCap, "Grab capacity required — 3–20 t") || V.inRange(s.grabCap, V.RANGES.grabCapacity)) : null],
    ["grabCount", grabActive ? (V.required(s.grabCount, "Number of grabs required — 1–4") || V.inRange(s.grabCount, V.RANGES.grabCount)) : null],
  ]);
}

export function PostPositionFlow({ vessels }: { vessels: VesselOpt[] }) {
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<State>(INITIAL);
  const [attempted, setAttempted] = React.useState<boolean[]>([false, false, false, false]);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const set = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  const dirty = React.useMemo(() => JSON.stringify(state) !== JSON.stringify(INITIAL), [state]);
  useUnsavedGuard(dirty && !done);

  const vessel = vessels.find((v) => v.id === state.vesselId) || null;
  const issues = React.useMemo(() => validate(state), [state]);
  const errFor = (k: FieldKey): string | undefined => {
    const si = STEP_FIELDS.findIndex((fs) => fs.includes(k));
    return si >= 0 && attempted[si] ? issues[k] : undefined;
  };
  const geared = state.gear === "Geared";
  const grabActive = geared && state.grabType !== "None";

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
      const { id } = await submitVesselAvailability(supabase, {
        vessel_id: state.vesselId,
        open_port_locode: state.openCode,
        open_date: state.openDate,
        open_date_range_days: Number(state.rangeDays) || 7,
        last_cargo: state.lastCargo || undefined,
        service_speed_kn: state.speed ? Number(state.speed) : undefined,
        me_consumption_mt_day: state.meSea ? Number(state.meSea) : undefined,
        me_consumption_port_mt_day: state.mePort ? Number(state.mePort) : undefined,
        aux_consumption_mt_day: state.auxSea ? Number(state.auxSea) : undefined,
        aux_consumption_port_mt_day: state.auxPort ? Number(state.auxPort) : undefined,
        fuel_type: state.fuel as never,
        accepts_part_cargo: state.partCargo,
        grab_type: grabActive ? state.grabType : undefined,
        grab_capacity_mt: grabActive && state.grabCap ? Number(state.grabCap) : undefined,
        num_grabs: grabActive && state.grabCount ? Number(state.grabCount) : undefined,
        notes: state.notes || undefined,
      } as never);
      // Persist the owner's visibility choice (default is circulate).
      if (id && state.forCirculation === false) {
        try { await setListingCirculation(supabase, "vessel_availability", id, false); } catch { /* defaults to circulated */ }
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
    set({
      vesselId: vessels[0]?.id ?? state.vesselId,
      openCode: "GRPIR", openName: "Piraeus", openDate: "2026-06-20", rangeDays: "7",
      speed: "10.5", meSea: "8.5", mePort: "1.2", auxSea: "0.4", auxPort: "1.2", fuel: "VLSFO",
    });
    return 8;
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

    if (e.vessel_name) {
      const q = e.vessel_name.toLowerCase();
      const match = vessels.find((v) => v.name.toLowerCase().includes(q) || q.includes(v.name.toLowerCase()));
      if (match) { patch.vesselId = match.id; n++; }
    }
    put("openCode", e.open_port_locode);
    put("openName", e.open_port_name);
    put("openDate", e.open_date ?? undefined);
    put("rangeDays", num(e.open_date_range_days));
    put("lastCargo", e.last_cargo);
    put("speed", num(e.service_speed_kn));
    put("meSea", num(e.vlsfo_sea_mt_day));
    put("auxSea", num(e.lsmgo_sea_mt_day));
    put("notes", e.notes);
    set(patch);
    return n;
  };

  if (done) {
    return (
      <div className="pp-shell"><div className="pp-main"><div className="pc-body">
        <Success
          title="Position submitted for review"
          sub="Arab ShipBroker reviews new positions before they go live. You'll be notified on approval."
          onReset={() => { setState(INITIAL); setStep(0); setDone(false); setAttempted([false, false, false, false]); }}
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
              <h1 className="page-title">Post Position</h1>
              <div className="eyebrow" style={{ marginTop: 2 }}>4-step open position, reviewed by Arab ShipBroker before publishing</div>
            </div>
            <button className="asb-btn ghost" type="button">Save draft &amp; exit</button>
          </div>
        </div>

        <Stepper steps={STEPS} step={step} setStep={setStep} />

        <div className="pc-body">
          {step === 0 && (
            <Section title="Vessel">
              <Field label="Vessel" required full error={errFor("vesselId")}>
                <select value={state.vesselId} onChange={(e) => set({ vesselId: e.target.value })}>
                  <option value="">Select one of your vessels…</option>
                  {vessels.map((v) => <option key={v.id} value={v.id}>{v.name} · IMO {v.imo}</option>)}
                </select>
              </Field>
              {vessels.length === 0 && (
                <div className="pc-field--full" style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>
                  No vessels in your registry yet — add one first, then post its open position.
                </div>
              )}
            </Section>
          )}

          {step === 1 && (
            <Section title="Open port & date">
              <Field label="Open port (LOCODE)" required error={errFor("openCode")}><input value={state.openCode} onChange={(e) => set({ openCode: e.target.value.toUpperCase() })} placeholder="e.g. EGPSD" maxLength={5} /></Field>
              <Field label="Open port name"><input value={state.openName} onChange={(e) => set({ openName: e.target.value })} placeholder="Port Said" /></Field>
              <Field label="Open date" required error={errFor("openDate")}><input type="date" value={state.openDate} onChange={(e) => set({ openDate: e.target.value })} /></Field>
              <Field label="Flexibility (± days)" error={errFor("rangeDays")}><input type="number" value={state.rangeDays} onChange={(e) => set({ rangeDays: e.target.value })} /></Field>
              <Field label="Last cargo"><input value={state.lastCargo} onChange={(e) => set({ lastCargo: e.target.value })} placeholder="e.g. Wheat (bulk)" /></Field>
              <Field label="Accepts part cargo"><select value={state.partCargo ? "Yes" : "No"} onChange={(e) => set({ partCargo: e.target.value === "Yes" })}><option>No</option><option>Yes</option></select></Field>
            </Section>
          )}

          {step === 2 && (
            <Section title="Speed, consumption & gear">
              <Field label="Service speed (kn)" error={errFor("speed")}><input type="number" step="0.1" value={state.speed} onChange={(e) => set({ speed: e.target.value })} /></Field>
              <Field label="Fuel type"><select value={state.fuel} onChange={(e) => set({ fuel: e.target.value })}>{V.FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="M/E at sea (MT/d)" error={errFor("meSea")}><input type="number" step="0.1" value={state.meSea} onChange={(e) => set({ meSea: e.target.value })} /></Field>
              <Field label="M/E in port (MT/d)"><input type="number" step="0.1" value={state.mePort} onChange={(e) => set({ mePort: e.target.value })} /></Field>
              <Field label="Aux at sea (MT/d)" error={errFor("auxSea")}><input type="number" step="0.1" value={state.auxSea} onChange={(e) => set({ auxSea: e.target.value })} /></Field>
              <Field label="Aux in port (MT/d)"><input type="number" step="0.1" value={state.auxPort} onChange={(e) => set({ auxPort: e.target.value })} /></Field>
              <Field label="Gear" required error={errFor("gear")}><select value={state.gear} onChange={(e) => set({ gear: e.target.value })}>{GEAR_OPTS.map((t) => <option key={t}>{t}</option>)}</select></Field>
              {geared && (
                <Field label="Grab type" required error={errFor("grabType")}><select value={state.grabType} onChange={(e) => set({ grabType: e.target.value })}>{V.GRAB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              )}
              {grabActive && (
                <>
                  <Field label="Grab capacity (t)" required error={errFor("grabCap")}><input type="number" value={state.grabCap} onChange={(e) => set({ grabCap: e.target.value })} placeholder="3–20" /></Field>
                  <Field label="Number of grabs" required error={errFor("grabCount")}><input type="number" value={state.grabCount} onChange={(e) => set({ grabCount: e.target.value })} placeholder="1–4" /></Field>
                </>
              )}
              <Field label="Notes" full><textarea value={state.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional notes for the broker…" /></Field>
            </Section>
          )}

          {step === 3 && (
            <>
              <div className="pc-section">
                <div className="pc-section__title">Review</div>
                <ReviewRow k="Vessel" v={vessel ? `${vessel.name} · IMO ${vessel.imo}` : ""} />
                <ReviewRow k="Open" v={state.openCode ? `${state.openCode}${state.openName ? ` · ${state.openName}` : ""}` : ""} />
                <ReviewRow k="Open date" v={state.openDate ? `${state.openDate} (± ${state.rangeDays}d)` : ""} />
                <ReviewRow k="Last cargo" v={state.lastCargo} />
                <ReviewRow k="Part cargo" v={state.partCargo ? "Accepts" : "No"} />
                <ReviewRow k="Speed / fuel" v={state.speed ? `${state.speed} kn · ${state.fuel}` : ""} />
                <ReviewRow k="Consumption" v={state.meSea ? `M/E ${state.meSea}/${state.mePort || "—"} · Aux ${state.auxSea || "—"}/${state.auxPort || "—"} MT/d` : ""} />
                <ReviewRow k="Gear" v={geared ? (grabActive ? `Geared · ${state.grabType} · ${state.grabCap || "—"}t × ${state.grabCount || "—"}` : "Geared") : "Gearless"} />
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
              : step < 3 ? `Step ${step + 1} of ${STEPS.length}` : "Review your position"}
          </div>
          {step < 3 ? (
            <button type="button" className="pc-btn pc-btn--primary" onClick={goNext}>Continue →</button>
          ) : (
            <button type="button" className="pc-btn pc-btn--primary" disabled={state.forCirculation == null || submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit →"}</button>
          )}
        </div>
      </div>
      <SmartParser onApply={applyParsed} />
    </div>
  );
}
