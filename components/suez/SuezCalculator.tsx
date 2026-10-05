"use client";

// Suez Canal transit cost calculator — member page (Voyage Economics, Stream S).
// Layout follows the approved prototype's Suez page (rail of vessel facts with
// Record/Manual, transit parameters, result strip, grouped cost cards); the
// arithmetic is lib/suez/engine.ts (suez-engine/2) over the published tariff
// version in force on the transit date. Nothing here is a constant, and nothing
// is substituted: a missing fact or tariff layer reads "unavailable", a flag
// the facts cannot decide reads "undecided", a broker-supplied SDR rate is
// labelled manual with its reason.
import * as React from "react";
import Link from "next/link";
import { BunkerTicker } from "@/components/portal/BunkerTicker";
import { estimateSuezTransit } from "@/lib/suez/engine";
import {
  SUEZ_VESSEL_CATEGORIES, suezCategoryFromVesselType,
  type LineStatus, type SuezCargoStatus, type SuezDirection, type SuezEstimate, type SuezFlag, type SuezInput, type SuezLateBand, type SuezTariffContextResult,
} from "@/lib/suez/types";
import type { SuezVesselOption } from "@/lib/suez/vessel-options";
import { logEvent } from "@/lib/portal/events";
import type { VesselEconomicsProfile } from "@/sdk/app/suez";
import { loadSuezContextAction, loadVesselEconomicsAction, saveVesselEconomicsAction } from "@/app/(dashboard)/dashboard/suez-toll/actions";
import "@/lib/portal/voyage-estimator.css";
import "./suez-calculator.css";

const fmtUSD = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const fmtUSD2 = (n: number | null | undefined) => (n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtSDR = (n: number | null | undefined) => (n == null ? "SDR —" : "SDR " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (s: string | number | null | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = typeof s === "number" ? s : Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const today = () => new Date().toISOString().slice(0, 10);

type Mode = "record" | "manual";
type Tri = "unknown" | "yes" | "no";
interface FactField { mode: Mode; manual: string }
const field = (manual = ""): FactField => ({ mode: "record", manual });
const triToBool = (t: Tri): boolean | null => (t === "unknown" ? null : t === "yes");
const boolToTri = (b: boolean | null | undefined): Tri => (b == null ? "unknown" : b ? "yes" : "no");
const STATUS_LABEL: Record<LineStatus, string> = { trusted: "trusted", placeholder: "placeholder", manual: "manual", unavailable: "unavailable", invalid: "invalid" };

interface VesselFacts {
  scnt: FactField; scgt: FactField; gt: FactField; category: string | null; buildYear: FactField;
  mooringCranesOk: Tri; searchlight: Tri; firstTransit: Tri;
}
interface VoyageFacts {
  direction: SuezDirection; cargoStatus: SuezCargoStatus; transitDate: string; lateArrivalBand: SuezLateBand;
  notReady: boolean; heavyLift: boolean; floatingUnit: boolean; military: boolean; deckProtrusionFt: string;
  ladderNoncompliant: boolean; relievingPilots: string; wasteNormalM3: string; wasteHazardousM3: string; bagsM3: string; bargeHours: string;
  sdrOverride: string; sdrOverrideReason: string;
}

export function SuezCalculator({ vessels, initialContext, viewerUserId, initialVesselId }: { vessels: SuezVesselOption[]; initialContext: SuezTariffContextResult; viewerUserId: string | null; initialVesselId?: string }) {
  const [vesselId, setVesselId] = React.useState(initialVesselId && vessels.some((v) => v.id === initialVesselId) ? initialVesselId : vessels[0]?.id ?? "");
  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const [context, setContext] = React.useState<SuezTariffContextResult>(initialContext);
  const [contextError, setContextError] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<VesselEconomicsProfile | null>(null);
  const [facts, setFacts] = React.useState<VesselFacts>(() => ({
    scnt: field(), scgt: field(), gt: field(), category: suezCategoryFromVesselType(vessel?.type), buildYear: field(),
    mooringCranesOk: "unknown", searchlight: "unknown", firstTransit: "unknown",
  }));
  const [voyage, setVoyage] = React.useState<VoyageFacts>({
    direction: "SB", cargoStatus: "laden", transitDate: today(), lateArrivalBand: "none", notReady: false, heavyLift: false,
    floatingUnit: false, military: false, deckProtrusionFt: "", ladderNoncompliant: false, relievingPilots: "",
    wasteNormalM3: "", wasteHazardousM3: "", bagsM3: "", bargeHours: "", sdrOverride: "", sdrOverrideReason: "",
  });
  const [saveState, setSaveState] = React.useState<{ busy: boolean; note: string | null; error: boolean }>({ busy: false, note: null, error: false });
  const [pending, startTransition] = React.useTransition();
  const [sessionAt] = React.useState(() => new Date().toISOString()); // stable per session; the server re-stamps every manual value

  // Vessel change: reset manual facts, load the economics profile when the raw vessel id is known.
  React.useEffect(() => {
    setProfile(null);
    setFacts((f) => ({ ...f, scnt: field(), scgt: field(), gt: field(), buildYear: field(), category: suezCategoryFromVesselType(vessel?.type), mooringCranesOk: "unknown", searchlight: "unknown", firstTransit: "unknown" }));
    if (!vessel?.vesselId) return;
    let alive = true;
    loadVesselEconomicsAction(vessel.vesselId).then((r) => {
      if (!alive) return;
      if (r.ok && r.data.found) {
        setProfile(r.data);
        // The profile arrives asynchronously: it fills only the facts the member has not set meanwhile.
        setFacts((f) => ({
          ...f,
          category: f.category ?? r.data.suezCategory ?? null,
          mooringCranesOk: f.mooringCranesOk === "unknown" ? boolToTri(r.data.mooringCranesOk) : f.mooringCranesOk,
          searchlight: f.searchlight === "unknown" ? boolToTri(r.data.searchlightCompliant) : f.searchlight,
          firstTransit: f.firstTransit === "unknown" ? boolToTri(r.data.firstTransit) : f.firstTransit,
        }));
      }
    });
    return () => { alive = false; };
  }, [vessel?.vesselId, vessel?.type]);

  // Transit date change: the tariff version, its sources and the SDR rate in force on that date.
  React.useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(voyage.transitDate)) return;
    if (voyage.transitDate === initialContext.date) { setContext(initialContext); setContextError(null); return; }
    let alive = true;
    loadSuezContextAction(voyage.transitDate).then((r) => {
      if (!alive) return;
      if (r.ok) { setContext(r.data); setContextError(null); } else setContextError(r.error);
    });
    return () => { alive = false; };
  }, [voyage.transitDate, initialContext]);

  React.useEffect(() => { if (vesselId) logEvent("suez_calc", { target: vesselId, meta: { dir: voyage.direction, status: voyage.cargoStatus } }); }, [vesselId, voyage.direction, voyage.cargoStatus]);

  // Record values: the economics profile first, then the vessel listing.
  const record = {
    scnt: profile?.scnt ?? vessel?.scnrt ?? null,
    scgt: profile?.scgt ?? null,
    gt: profile?.gt ?? vessel?.gt ?? null,
    buildYear: vessel?.built ?? null,
  };
  const resolve = (f: FactField, rec: number | null) => (f.mode === "manual" ? num(f.manual) : rec);
  const scnt = resolve(facts.scnt, record.scnt);
  const scgt = resolve(facts.scgt, record.scgt);
  const gt = resolve(facts.gt, record.gt);
  const buildYear = resolve(facts.buildYear, record.buildYear);

  const sdrOverrideValue = num(voyage.sdrOverride);
  const sdrReasonOk = voyage.sdrOverrideReason.trim().length >= 3;
  const input: SuezInput | null = React.useMemo(() => {
    if (!facts.category) return null;
    return {
      vessel: {
        scnt, scgt, gt, category: facts.category, buildYear,
        mooringCranesOk: triToBool(facts.mooringCranesOk),
        searchlightCompliant: triToBool(facts.searchlight),
        firstTransit: triToBool(facts.firstTransit),
      },
      voyage: {
        direction: voyage.direction, cargoStatus: voyage.cargoStatus, transitDate: voyage.transitDate,
        lateArrivalBand: voyage.lateArrivalBand, notReady: voyage.notReady, heavyLiftOver250t: voyage.heavyLift,
        floatingUnitScgt300: voyage.floatingUnit, militaryCargo: voyage.military,
        deckProtrusionFt: num(voyage.deckProtrusionFt) ?? 0, ladderNoncompliant: voyage.ladderNoncompliant,
        relievingPilots: num(voyage.relievingPilots) ?? 0, wasteNormalM3: num(voyage.wasteNormalM3) ?? 0,
        wasteHazardousM3: num(voyage.wasteHazardousM3) ?? 0, bagsM3: num(voyage.bagsM3) ?? 0, bargeHours: num(voyage.bargeHours) ?? 0,
      },
      // A broker-supplied SDR rate is a manual value: it needs a reason and is labelled on every figure it touches.
      overrides: sdrOverrideValue != null && sdrReasonOk ? { sdrRate: { value: sdrOverrideValue, reason: voyage.sdrOverrideReason.trim(), actorUserId: viewerUserId ?? "viewer", at: sessionAt } } : undefined,
    };
  }, [scnt, scgt, gt, buildYear, facts, voyage, sdrOverrideValue, sdrReasonOk, viewerUserId, sessionAt]);

  const estimate: SuezEstimate | null = React.useMemo(() => (context.found && input ? estimateSuezTransit(input, context) : null), [context, input]);

  const canSave = !!vessel?.vesselId && (profile?.allowed ?? true);
  const saveFacts = () => {
    if (!vessel?.vesselId) return;
    setSaveState({ busy: true, note: null, error: false });
    startTransition(async () => {
      const r = await saveVesselEconomicsAction(vessel.vesselId!, {
        scnt: scnt ?? null, scgt: scgt ?? null, gt: gt ?? null, suezCategory: facts.category,
        mooringCranesOk: triToBool(facts.mooringCranesOk),
        searchlightCompliant: triToBool(facts.searchlight),
        firstTransit: triToBool(facts.firstTransit),
        speedLadenKn: profile?.speedLadenKn ?? null, speedBallastKn: profile?.speedBallastKn ?? null,
        consumption: profile?.consumption ?? {}, hasScrubber: profile?.hasScrubber ?? null, vesselClass: profile?.vesselClass ?? null,
      });
      if (r.ok) { setProfile(r.data); setFacts((f) => ({ ...f, scnt: field(), scgt: field(), gt: field() })); setSaveState({ busy: false, note: "Vessel facts saved to the economics profile.", error: false }); }
      else setSaveState({ busy: false, note: r.error, error: true });
    });
  };

  const exportEstimate = () => {
    if (!vessel || !estimate) return;
    logEvent("suez_export", { target: vessel.id });
    const L: string[] = [];
    L.push("ARAB SHIPBROKER · SUEZ CANAL TRANSIT COST ESTIMATE");
    L.push(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${estimate.algorithmVersion} · status ${estimate.status.toUpperCase()}`);
    L.push(`Tariff v${estimate.tariffVersion.versionNo} (${estimate.tariffVersion.sourceRef}) · SDR ${estimate.sdrRate.rateUsd != null ? `${estimate.sdrRate.rateUsd} USD as of ${estimate.sdrRate.asOf} (${estimate.sdrRate.status}${estimate.sdrRate.manual ? `: ${estimate.sdrRate.manual.reason}` : ""})` : "not on file"}`);
    L.push(`Vessel: ${vessel.name} · IMO ${vessel.imo} · ${SUEZ_VESSEL_CATEGORIES.find((c) => c.key === estimate.vesselCategory)?.label ?? estimate.vesselCategory} · SCNT ${scnt?.toLocaleString() ?? "not sourced"} · GT ${gt?.toLocaleString() ?? "not sourced"}`);
    L.push(`Transit: ${voyage.direction === "SB" ? "Southbound" : "Northbound"} · ${voyage.cargoStatus} · ${voyage.transitDate}`);
    L.push("");
    L.push(`1 · TRANSIT TOLL       ${fmtUSD2(estimate.layers.toll.usd)}   (${fmtSDR(estimate.layers.toll.sdr)}) [${estimate.layers.toll.status}${estimate.layers.toll.reason ? `: ${estimate.layers.toll.reason}` : ""}]`);
    L.push("2 · FIXED CHARGES");
    estimate.layers.fixed.forEach((l) => L.push(`    ${l.label.padEnd(48)} ${fmtUSD2(l.amountUsd).padStart(14)}  [${l.status}]`));
    L.push(`    ${"Subtotal (computable lines)".padEnd(48)} ${fmtUSD2(estimate.totals.fixedUsd).padStart(14)}`);
    L.push("3 · CONDITIONAL CHARGES (applied only when the condition holds)");
    estimate.layers.conditional.forEach((f) => L.push(`    ${(f.triggered === true ? "[APPLIED]  " : f.triggered === null ? "[UNDECIDED]" : "[flag]     ") + f.label.slice(0, 36).padEnd(36)} ${f.triggered === true ? fmtUSD2(f.appliedUsd) : f.potentialUsd != null ? `potential ${fmtUSD2(f.potentialUsd)}` : "undetermined"}`));
    if (estimate.layers.waste.length) { L.push("4 · WASTE EXTRAS"); estimate.layers.waste.forEach((l) => L.push(`    ${l.label.padEnd(48)} ${fmtUSD2(l.amountUsd).padStart(14)}`)); }
    L.push("");
    L.push(`TOTAL TRANSIT COST (applied)   ${estimate.totals.complete ? fmtUSD2(estimate.totals.appliedUsd) : `${fmtUSD2(estimate.totals.appliedUsd)} — INCOMPLETE`}`);
    L.push(`Potential exposure incl. untriggered flags ${fmtUSD2(estimate.totals.potentialUsd)}`);
    if (estimate.unavailable.length) { L.push(""); L.push("Unavailable:"); estimate.unavailable.forEach((u) => L.push(`- ${u.code}: ${u.reason}`)); }
    if (estimate.warnings.length) { L.push(""); L.push("Notes:"); estimate.warnings.forEach((w) => L.push(`- ${w}`)); }
    if (estimate.sources.length) { L.push(""); L.push("Sources:"); estimate.sources.forEach((s) => L.push(`- ${s.title} (${s.issuer}${s.documentNo ? `, ${s.documentNo}` : ""}; ${s.authority}; ${s.evidenceStatus}${s.sha256 ? `; sha256 ${s.sha256}` : ""})`)); }
    L.push(""); L.push("Estimate only. Confirm SCNT, the SDR rate and the circulars in force with the SCA agent before transit.");
    const blob = new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ASB-suez-${vessel.imo}-${voyage.transitDate}.txt`; a.click(); URL.revokeObjectURL(a.href);
  };

  const options = vessels.map((v) => ({ value: v.id, label: `${v.name}, IMO ${v.imo}` }));

  return (
    <div className="ve-page">
      <div className="ve-shell">
        <BunkerTicker />
        <div className="ve-head">
          <div className="ve-head__row">
            <div>
              <div className="ve-head__title">Suez Canal Transit Cost</div>
              <div className="ve-head__sub">Transit toll, accompanying charges and conditional risk flags from the published SCA tariff</div>
            </div>
            <div className="ve-head-right">
              {estimate && <span className="sz-version" title={estimate.tariffVersion.sourceRef}>Tariff v{estimate.tariffVersion.versionNo} · {estimate.tariffVersion.effectiveFrom} → {estimate.tariffVersion.effectiveTo ?? "open"} · {estimate.algorithmVersion}</span>}
              <button className="ve-btn" type="button" onClick={exportEstimate} disabled={!estimate || !vessel}>Export estimate</button>
            </div>
          </div>
        </div>

        <div className="ve-selector ve-selector--one">
          <label className="ve-selector__field">
            <span className="ve-selector__label">Vessel</span>
            <span className="ve-selector__control">
              <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} aria-label="Vessel">
                <option value="">Select vessel…</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </span>
          </label>
        </div>

        <div className="ve-content">
          {!vessel ? <div className="ve-empty">Select a vessel to calculate.</div> : (
            <div className="sz-layout">
              <aside className="sz-rail">
                <div className="ve-input-card">
                  <div className="ve-input-card__head">Vessel · from record {profile?.found && <span className="sz-tag">economics profile</span>}</div>
                  <div className="ve-input-card__body">
                    <div className="ve-kv"><span>Vessel</span><span className="is-auto">{vessel.name}</span></div>
                    <div className="ve-kv"><span>IMO</span><span className="is-auto">{vessel.imo}</span></div>
                    <div className="ve-kv"><span>DWT</span><span className="is-auto">{vessel.dwt}</span></div>
                    <FactInput label="SCNT" tip="Suez Canal Net Tonnage from the Suez Canal special tonnage certificate — the toll basis." value={facts.scnt} record={record.scnt} onChange={(v) => setFacts({ ...facts, scnt: v })} />
                    <FactInput label="SCGT" tip="Suez Canal Gross Tonnage, from the same certificate (floating-unit rule)." value={facts.scgt} record={record.scgt} onChange={(v) => setFacts({ ...facts, scgt: v })} />
                    <FactInput label="GT" tip="International gross tonnage: mooring-service band and the mooring-boat rule, both from the tariff's own thresholds." value={facts.gt} record={record.gt} onChange={(v) => setFacts({ ...facts, gt: v })} />
                    <FactInput label="Built (year)" tip="Older vessels are inspected on arrival (age threshold from the tariff)." value={facts.buildYear} record={record.buildYear} onChange={(v) => setFacts({ ...facts, buildYear: v })} />
                    <label className="sz-field"><span>SCA vessel category</span>
                      <select value={facts.category ?? ""} onChange={(e) => setFacts({ ...facts, category: e.target.value || null })}><option value="">— select —</option>{SUEZ_VESSEL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
                    </label>
                    <TriState label="Cranes lift the mooring boats (tariff SWL / count)" value={facts.mooringCranesOk} onChange={(v) => setFacts({ ...facts, mooringCranesOk: v })} />
                    <TriState label="Compliant searchlight (art. 28)" value={facts.searchlight} onChange={(v) => setFacts({ ...facts, searchlight: v })} />
                    <TriState label="First Suez transit (measurement on arrival)" value={facts.firstTransit} onChange={(v) => setFacts({ ...facts, firstTransit: v })} />
                    {canSave && (
                      <div className="sz-save">
                        <button type="button" className="ve-btn" onClick={saveFacts} disabled={saveState.busy || pending}>{saveState.busy ? "Saving…" : "Save facts to vessel profile"}</button>
                        {saveState.note && <div className={`ve-note-sub${saveState.error ? " sz-error" : ""}`}>{saveState.note}</div>}
                      </div>
                    )}
                    {!vessel.vesselId && <div className="ve-note-sub">Market listing: facts are entered manually for this estimate.</div>}
                  </div>
                </div>

                <div className="ve-input-card">
                  <div className="ve-input-card__head">Transit parameters</div>
                  <div className="ve-input-card__body">
                    <div className="ve-field"><div className="ve-field__label">Direction</div><div className="ve-seg">{(["SB", "NB"] as const).map((d) => <button key={d} type="button" className={`ve-seg__btn${voyage.direction === d ? " is-active" : ""}`} onClick={() => setVoyage({ ...voyage, direction: d })}>{d === "SB" ? "Southbound" : "Northbound"}</button>)}</div></div>
                    <div className="ve-field"><div className="ve-field__label">Cargo status</div><div className="ve-seg">{(["laden", "ballast"] as const).map((s) => <button key={s} type="button" className={`ve-seg__btn${voyage.cargoStatus === s ? " is-active" : ""}`} onClick={() => setVoyage({ ...voyage, cargoStatus: s })}>{s === "laden" ? "Laden" : "Ballast"}</button>)}</div></div>
                    <label className="sz-field"><span>Expected transit date</span><input type="date" value={voyage.transitDate} onChange={(e) => setVoyage({ ...voyage, transitDate: e.target.value })} /></label>
                    <div className="ve-kv"><span>SDR → USD</span><span className={estimate?.sdrRate.status === "trusted" ? "is-auto" : estimate?.sdrRate.status === "manual" ? "is-manual" : "is-amber"}>{estimate?.sdrRate.rateUsd != null ? `${estimate.sdrRate.rateUsd} (${estimate.sdrRate.status === "manual" ? "manual" : estimate.sdrRate.source}, ${estimate.sdrRate.asOf})` : "not on file"}</span></div>
                    <label className="sz-field"><span>SDR rate override (manual, needs a reason)</span><input type="number" step="0.000001" min="0.5" max="5" value={voyage.sdrOverride} onChange={(e) => setVoyage({ ...voyage, sdrOverride: e.target.value })} placeholder="e.g. 1.36" /></label>
                    {sdrOverrideValue != null && (
                      <label className="sz-field"><span>Reason for the override</span><input value={voyage.sdrOverrideReason} onChange={(e) => setVoyage({ ...voyage, sdrOverrideReason: e.target.value })} placeholder="e.g. IMF rate of today, not yet on file" aria-label="SDR override reason" />{!sdrReasonOk && <span className="sz-error">The override is not applied until a reason is given.</span>}</label>
                    )}
                    <label className="sz-field"><span>Arrival for the SB convoy</span>
                      <select value={voyage.lateArrivalBand} onChange={(e) => setVoyage({ ...voyage, lateArrivalBand: e.target.value as SuezLateBand })}>
                        <option value="none">Before 23:00 LT (on time)</option><option value="b1">23:00–00:00</option><option value="b2">00:00–01:00</option><option value="b3">After 01:00</option>
                      </select>
                    </label>
                    <label className="sz-check"><input type="checkbox" checked={voyage.heavyLift} onChange={(e) => setVoyage({ ...voyage, heavyLift: e.target.checked })} /> Heavy unit of 250 t or more on board</label>
                    <label className="sz-check"><input type="checkbox" checked={voyage.floatingUnit} onChange={(e) => setVoyage({ ...voyage, floatingUnit: e.target.checked })} /> Floating unit of SCGT 300 or more carried</label>
                    <label className="sz-check"><input type="checkbox" checked={voyage.military} onChange={(e) => setVoyage({ ...voyage, military: e.target.checked })} /> Navy / government charter or military cargo</label>
                    <label className="sz-check"><input type="checkbox" checked={voyage.notReady} onChange={(e) => setVoyage({ ...voyage, notReady: e.target.checked })} /> Vessel may be found not ready in the convoy</label>
                    <label className="sz-check"><input type="checkbox" checked={voyage.ladderNoncompliant} onChange={(e) => setVoyage({ ...voyage, ladderNoncompliant: e.target.checked })} /> Pilot / accommodation ladder not in order</label>
                    <label className="sz-field"><span>Deck cargo protrusion beyond the limit (ft)</span><input type="number" min="0" step="0.5" value={voyage.deckProtrusionFt} onChange={(e) => setVoyage({ ...voyage, deckProtrusionFt: e.target.value })} /></label>
                    <label className="sz-field"><span>Relieving pilots at the lakes</span><input type="number" min="0" step="1" value={voyage.relievingPilots} onChange={(e) => setVoyage({ ...voyage, relievingPilots: e.target.value })} /></label>
                  </div>
                </div>

                <div className="ve-input-card">
                  <div className="ve-input-card__head">Waste delivery (Antipollution Egypt)</div>
                  <div className="ve-input-card__body">
                    <div className="ve-note-sub">The mandatory fee is charged by SCNT whether or not waste is delivered{estimate?.wasteIncludedM3 != null ? `; ${estimate.wasteIncludedM3} m³ are included` : ""}. Declare volumes to price the extras.</div>
                    <label className="sz-field"><span>Non-hazardous waste (m³, categories A–I)</span><input type="number" min="0" step="0.5" value={voyage.wasteNormalM3} onChange={(e) => setVoyage({ ...voyage, wasteNormalM3: e.target.value })} /></label>
                    <label className="sz-field"><span>Hazardous waste (m³, category F hazardous)</span><input type="number" min="0" step="0.5" value={voyage.wasteHazardousM3} onChange={(e) => setVoyage({ ...voyage, wasteHazardousM3: e.target.value })} /></label>
                    <label className="sz-field"><span>Bags supplied by the contractor (m³)</span><input type="number" min="0" step="0.5" value={voyage.bagsM3} onChange={(e) => setVoyage({ ...voyage, bagsM3: e.target.value })} /></label>
                    <label className="sz-field"><span>Barge waiting (hours)</span><input type="number" min="0" step="0.5" value={voyage.bargeHours} onChange={(e) => setVoyage({ ...voyage, bargeHours: e.target.value })} /></label>
                  </div>
                </div>
              </aside>

              <main className="sz-main">
                {contextError && <div className="sz-unavailable">{contextError}</div>}
                {!context.found && !contextError && (
                  <div className="sz-unavailable"><strong>No published Suez tariff covers {voyage.transitDate}.</strong> The calculator shows nothing it cannot source. Admins publish tariff versions under Admin → Voyage estimator data.</div>
                )}
                {context.found && !facts.category && <div className="sz-unavailable"><strong>SCA vessel category not known for this vessel type.</strong> Select it in the rail; the toll bands depend on it.</div>}
                {estimate && <Results estimate={estimate} vessel={vessel} />}
              </main>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FactInput({ label, tip, value, record, onChange }: { label: string; tip: string; value: FactField; record: number | null; onChange: (v: FactField) => void }) {
  const manual = value.mode === "manual";
  return (
    <div className="sz-fact">
      <div className="sz-fact__row">
        <span className="sz-fact__label" title={tip}>{label}</span>
        <div className="ve-seg ve-seg--sm">
          <button type="button" className={`ve-seg__btn${!manual ? " is-active" : ""}`} onClick={() => onChange({ ...value, mode: "record" })}>Record</button>
          <button type="button" className={`ve-seg__btn${manual ? " is-active" : ""}`} onClick={() => onChange({ ...value, mode: "manual" })}>Manual</button>
        </div>
      </div>
      {manual
        ? <input type="number" min="0" className="ve-inp ve-inp--num" value={value.manual} onChange={(e) => onChange({ ...value, manual: e.target.value })} placeholder={record != null ? String(record) : "enter"} aria-label={`${label} manual value`} />
        : <div className={`sz-fact__value${record == null ? " is-missing" : ""}`}>{record != null ? record.toLocaleString() : "not sourced"}</div>}
    </div>
  );
}

function TriState({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <div className="sz-fact">
      <div className="sz-fact__row"><span className="sz-fact__label">{label}</span>
        <div className="ve-seg ve-seg--sm">{(["yes", "no", "unknown"] as const).map((o) => <button key={o} type="button" className={`ve-seg__btn${value === o ? " is-active" : ""}`} onClick={() => onChange(o)}>{o === "unknown" ? "?" : o}</button>)}</div>
      </div>
    </div>
  );
}

function statusSummary(e: SuezEstimate): string {
  if (e.status === "invalid") return `Invalid input: ${(e.errors ?? []).join("; ")}`;
  if (e.status === "trusted") return "Every layer is priced from the published tariff (base dues and the category surcharge in force) and known facts.";
  const parts: string[] = [];
  if (e.layers.toll.status !== "trusted") parts.push(`toll ${e.layers.toll.status}${e.layers.toll.reason ? ` (${e.layers.toll.reason})` : ""}`);
  if (e.layers.surcharge.status !== "trusted" && e.layers.toll.sdr != null) parts.push(`category surcharge ${e.layers.surcharge.status === "placeholder" ? "reported, not on file" : e.layers.surcharge.status}${e.layers.surcharge.reason ? ` (${e.layers.surcharge.reason})` : ""}`);
  if (e.sdrRate.status === "manual") parts.push(`SDR rate manual (${e.sdrRate.manual?.reason ?? "reason not given"})`);
  const undecided = e.layers.conditional.filter((f) => f.triggered === null).length;
  if (undecided) parts.push(`${undecided} flag${undecided > 1 ? "s" : ""} undecided from the facts`);
  const other = e.unavailable.filter((u) => u.code !== "transit_toll" && u.code !== "category_surcharge" && u.code !== "sdr_rate").length;
  if (other) parts.push(`${other} line${other > 1 ? "s" : ""} unavailable`);
  if (e.invalid.length) parts.push(`${e.invalid.length} malformed tariff line${e.invalid.length > 1 ? "s" : ""}`);
  return (e.status === "unavailable" ? "The transit cannot be priced: " : "Priced with gaps: ") + (parts.join(" · ") || "see the notes");
}

function headline(e: SuezEstimate): string | null {
  if (e.ok) return null;
  if (e.scnt == null) return "SCNT is not sourced: enter it in Manual mode to compute the toll.";
  if (e.layers.toll.status === "unavailable" && e.layers.toll.tiers.length === 0) return "The SCA toll bands for this version are not loaded, so the transit toll is unavailable; the other layers are priced.";
  if (e.sdrRate.status === "unavailable") return "The SDR rate is not on file: SDR amounts cannot be converted (an override needs a reason).";
  return null;
}

function Results({ estimate, vessel }: { estimate: SuezEstimate; vessel: SuezVesselOption }) {
  const t = estimate.totals;
  const applied = estimate.layers.conditional.filter((f) => f.triggered === true);
  const undecided = estimate.layers.conditional.filter((f) => f.triggered === null);
  const notApplied = estimate.layers.conditional.filter((f) => f.triggered === false);
  const head = headline(estimate);
  const flagRow = (f: SuezFlag, cls: string) => (
    <div key={f.code} className={`ve-pl-row ve-pl-row--linked sz-flag ${cls}`}>
      <span>{f.triggered === true ? <b>APPLIED</b> : f.triggered === null ? <b>UNDECIDED</b> : null} {f.label}<small className="sz-muted">{f.reason} · {f.explanation} · payer: {f.payerParty}{f.status !== "trusted" ? ` · ${STATUS_LABEL[f.status]}` : ""}</small></span>
      <span className={f.triggered === true ? "is-amber" : "is-muted"}>{f.triggered === true ? fmtUSD2(f.appliedUsd) : f.potentialUsd != null ? `potential ${fmtUSD(f.potentialUsd)}` : "undetermined"}</span>
    </div>
  );
  return (
    <>
      <div className={`sz-status sz-status--${estimate.status}`}><span className="sz-status__k">{estimate.status}</span><span>{statusSummary(estimate)}</span></div>
      {head && <div className="sz-unavailable">{head}</div>}
      <div className="ve-results sz-results">
        <div className="ve-result"><div className="ve-result__k">1 · Transit toll</div><div className={`ve-result__v ${estimate.layers.toll.usd != null ? "ve-result__v--navy" : "is-missing"}`}>{fmtUSD(estimate.layers.toll.usd)}</div><div className="ve-note-sub">{fmtSDR(estimate.layers.toll.sdr)} · {STATUS_LABEL[estimate.layers.toll.status]}{t.surchargeUsd > 0 ? ` · + category surcharge ${fmtUSD(t.surchargeUsd)} (${STATUS_LABEL[estimate.layers.surcharge.status]})` : ""}</div></div>
        <div className="ve-result"><div className="ve-result__k">2 · Fixed charges</div><div className="ve-result__v ve-result__v--navy">{fmtUSD(t.fixedUsd)}</div><div className="ve-note-sub">{estimate.layers.fixed.filter((l) => l.amountUsd != null).length} of {estimate.layers.fixed.length} items priced</div></div>
        <div className="ve-result"><div className="ve-result__k">3 · Conditional (applied)</div><div className={`ve-result__v ${t.conditionalAppliedUsd > 0 ? "ve-result__v--amber" : "ve-result__v--green"}`}>{fmtUSD(t.conditionalAppliedUsd)}</div><div className="ve-note-sub">{applied.length} applied · {undecided.length} undecided · {notApplied.length} not applicable</div></div>
        <div className="ve-result ve-result--tce"><div className="ve-result__k">Total transit cost</div><div className="ve-result__v">{t.complete ? fmtUSD(t.appliedUsd) : "—"}</div><div className="ve-note-sub">{t.complete ? `Exposure incl. flags ${fmtUSD(t.potentialUsd)}` : `Incomplete: computable parts ${fmtUSD(t.appliedUsd)}`}{t.wasteUsd > 0 ? ` · waste extras ${fmtUSD(t.wasteUsd)}` : ""}</div></div>
      </div>

      <div className="ve-pl-grid sz-cards">
        <div className="ve-pl-card">
          <div className="ve-pl-card__title">1 · Transit toll <span className="sz-muted">· {SUEZ_VESSEL_CATEGORIES.find((c) => c.key === estimate.vesselCategory)?.label ?? estimate.vesselCategory} · {estimate.cargoStatus}</span></div>
          {estimate.layers.toll.tiers.length === 0 ? <div className="ve-pl-row"><span className="is-amber">{estimate.layers.toll.reason ?? "SCA toll bands not loaded for this tariff version"}</span><span>—</span></div> : estimate.layers.toll.tiers.map((tier) => (
            <div key={tier.tierOrder} className="ve-pl-row"><span>Band {tier.tierOrder + 1}: {tier.scntFrom.toLocaleString()} → {tier.scntTo == null ? "open" : tier.scntTo.toLocaleString()} SCNT · {tier.tons.toLocaleString()} t × {tier.sdrPerScnt} SDR</span><span>{fmtSDR(tier.sdr)}</span></div>
          ))}
          <div className="ve-pl-row is-subtotal"><span>Toll in SDR</span><span>{fmtSDR(estimate.layers.toll.sdr)}</span></div>
          <div className="ve-pl-row"><span>× SDR rate {estimate.sdrRate.rateUsd != null ? `${estimate.sdrRate.rateUsd} (${estimate.sdrRate.asOf}, ${estimate.sdrRate.status})` : "not on file"}</span><span className={estimate.layers.toll.status === "trusted" ? "is-auto" : estimate.layers.toll.status === "manual" ? "is-manual" : "is-amber"}>{fmtUSD2(estimate.layers.toll.usd)}</span></div>
          {estimate.layers.surcharge.lines.map((l) => <div key={l.code} className="ve-pl-row"><span>{l.label}<small className="sz-muted">{l.explanation}{l.status !== "trusted" ? ` · ${STATUS_LABEL[l.status]}` : ""}</small></span><span className={l.status === "trusted" ? "" : "is-amber"}>{fmtUSD2(l.amountUsd)}</span></div>)}
          {estimate.layers.surcharge.lines.length === 0 && estimate.layers.toll.sdr != null && <div className={`ve-pl-row${estimate.layers.surcharge.status === "trusted" ? "" : " sz-surcharge-missing"}`}><span className={estimate.layers.surcharge.status === "trusted" ? "sz-muted" : "is-amber"}>Category surcharge: {estimate.layers.surcharge.reason}</span><span>{estimate.layers.surcharge.status === "trusted" ? fmtUSD2(0) : "—"}</span></div>}
          {estimate.layers.toll.status === "placeholder" && <div className="ve-warn is-placeholder">Placeholder bands: not the official SCA circular. The toll is flagged, not trusted.</div>}
          {estimate.layers.toll.status === "unavailable" && estimate.layers.toll.tiers.length > 0 && <div className="ve-warn">{estimate.layers.toll.reason}</div>}
        </div>

        <div className="ve-pl-card">
          <div className="ve-pl-card__title">2 · Fixed accompanying charges</div>
          {estimate.layers.fixed.map((l) => <div key={l.code} className="ve-pl-row ve-pl-row--linked"><span>{l.label}<small className="sz-muted">{l.explanation}{l.status !== "trusted" ? ` · ${STATUS_LABEL[l.status]}` : ""}</small></span><span className={l.amountUsd == null ? "is-amber" : l.status === "trusted" ? "is-auto" : "is-manual"}>{fmtUSD2(l.amountUsd)}</span></div>)}
          <div className="ve-pl-row is-subtotal"><span>Subtotal (computable lines)</span><span>{fmtUSD2(estimate.totals.fixedUsd)}</span></div>
        </div>

        <div className="ve-pl-card">
          <div className="ve-pl-card__title">3 · Conditional charges · risk flags</div>
          {applied.map((f) => flagRow(f, "is-applied"))}
          {undecided.map((f) => flagRow(f, "is-undecided"))}
          {notApplied.map((f) => flagRow(f, ""))}
          <div className="ve-pl-row is-subtotal"><span>Applied</span><span>{fmtUSD2(estimate.totals.conditionalAppliedUsd)}</span></div>
          {undecided.length > 0 && <div className="ve-note-sub">Undecided flags need a fact (cranes, searchlight, transit history, build year); they are counted in the exposure, never in the applied total.</div>}
        </div>

        <div className="ve-pl-card">
          <div className="ve-pl-card__title">4 · Waste extras <span className="sz-muted">· mandatory fee is in layer 2{estimate.wasteIncludedM3 != null ? ` (${estimate.wasteIncludedM3} m³ included)` : ""}</span></div>
          {estimate.layers.waste.length === 0 ? <div className="ve-pl-row"><span className="is-muted">No extra volumes declared</span><span>{fmtUSD2(0)}</span></div> : estimate.layers.waste.map((l) => <div key={l.code} className="ve-pl-row ve-pl-row--linked"><span>{l.label}<small className="sz-muted">{l.explanation}</small></span><span>{fmtUSD2(l.amountUsd)}</span></div>)}
          <div className="ve-pl-row is-grand"><span>Total transit cost (applied)</span><span>{t.complete ? fmtUSD2(estimate.totals.appliedUsd) : "incomplete"}</span></div>
          <div className="ve-pl-row"><span>Feeds the Voyage Estimator as a voyage cost plus {estimate.transitDays} transit + {estimate.anchorageDays} anchorage days</span><span><Link href={`/dashboard/voyage-estimator?vessel=${encodeURIComponent(vessel.id)}`} className="sz-link">Open estimator →</Link></span></div>
        </div>
      </div>

      {(estimate.unavailable.length > 0 || estimate.invalid.length > 0) && (
        <div className="sz-warnings"><div className="ve-pl-card__title">Not priced</div><ul className="sz-list">{estimate.unavailable.map((u) => <li key={`u-${u.code}`}><b>{u.code}</b>: {u.reason}</li>)}{estimate.invalid.map((u) => <li key={`i-${u.code}`} className="is-placeholder"><b>{u.code}</b> (malformed tariff line): {u.reason}</li>)}</ul></div>
      )}
      {estimate.warnings.length > 0 && (
        <div className="sz-warnings"><div className="ve-pl-card__title">Notes on this estimate</div><ul>{estimate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      <div className="sz-sources">
        <div className="ve-pl-card__title">Sources of tariff v{estimate.tariffVersion.versionNo}</div>
        {estimate.sources.length === 0 ? <div className="is-placeholder">No source record is cited on this version.</div> : <ul>{estimate.sources.map((s) => <li key={s.id}>{s.title} · {s.issuer}{s.documentNo ? ` · ${s.documentNo}` : ""}{s.issueDate ? ` · ${s.issueDate}` : ""} · {s.authority} · {s.evidenceStatus === "on_file" ? <>on file <code>{s.sha256?.slice(0, 12)}…</code></> : <span className="is-placeholder">document pending</span>}</li>)}</ul>}
      </div>
      <div className="ve-note-line">Estimate only · {estimate.algorithmVersion} · Tariff v{estimate.tariffVersion.versionNo} — {estimate.tariffVersion.sourceRef}. Confirm SCNT, the SDR rate and the circulars in force with the SCA agent before transit.</div>
    </>
  );
}
