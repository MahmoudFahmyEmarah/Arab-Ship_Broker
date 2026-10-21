"use client";

// Suez Canal transit cost calculator — member page (Voyage Economics, Stream S).
// Layout follows the owner's design (Portal standalone 7 · PageSuezToll / TabSuez: rail of vessel facts with
// Record/Manual, transit parameters, a four-cell strip and the three cost groups); the
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
  draftFt: string; beamFt: string; doubleBottom: Tri;
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
    draftFt: "", beamFt: "", doubleBottom: "unknown",
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
    setFacts((f) => ({ ...f, scnt: field(), scgt: field(), gt: field(), buildYear: field(), category: suezCategoryFromVesselType(vessel?.type), mooringCranesOk: "unknown", searchlight: "unknown", firstTransit: "unknown", draftFt: "", beamFt: "", doubleBottom: "unknown" }));
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
          beamFt: f.beamFt === "" && r.data.beamFt != null ? String(r.data.beamFt) : f.beamFt,
          doubleBottom: f.doubleBottom === "unknown" ? boolToTri(r.data.doubleBottom) : f.doubleBottom,
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
    buildYear: profile?.buildYear ?? vessel?.built ?? null,
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
        draftFt: num(facts.draftFt), beamFt: num(facts.beamFt), doubleBottom: triToBool(facts.doubleBottom),
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
        // the escort and age facts are governed too (C2O-050 #5); arrival draft is per voyage and is not saved
        buildYear: buildYear ?? null, beamFt: num(facts.beamFt), doubleBottom: triToBool(facts.doubleBottom),
        craneCount: profile?.craneCount ?? null, craneSwlMt: profile?.craneSwlMt ?? null,
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
  const setF = (p: Partial<VesselFacts>) => setFacts((f) => ({ ...f, ...p }));
  const setV = (p: Partial<VoyageFacts>) => setVoyage((v) => ({ ...v, ...p }));
  const undecidedCount = estimate ? estimate.layers.conditional.filter((f) => f.triggered === null).length : 0;
  // the facts panel opens itself while a flag is undecided and then stays open: settling the last flag inside it
  // never snaps it shut under the user's hands (O2B-052 P2-5)
  const [moreOpen, setMoreOpen] = React.useState(false);
  if (undecidedCount > 0 && !moreOpen) setMoreOpen(true);

  return (
    <div className="ve-page">
      <div className="ve-shell">
        <BunkerTicker />
        {/* design (Portal standalone 7, PageSuezToll): title + eyebrow, ghost "Export estimate" on the right */}
        <div className="ve-head">
          <div className="ve-head__row">
            <div>
              <h1 className="ve-head__title">Suez Canal Toll</h1>
              <div className="ve-head__sub">Proforma transit toll estimate</div>
            </div>
            <div className="ve-head-right">
              {estimate && <span className="sz-version" title={estimate.tariffVersion.sourceRef}>Tariff v{estimate.tariffVersion.versionNo} · {estimate.tariffVersion.effectiveFrom} → {estimate.tariffVersion.effectiveTo ?? "open"}</span>}
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
              <span className="ve-selector__caret" aria-hidden="true">▾</span>
            </span>
          </label>
        </div>

        <div className="ve-content">
          {!vessel ? <div className="ve-empty">Select a vessel to calculate.</div> : (
            <div className="vs-wrap">
              <aside className="vs-rail" aria-label="Vessel and transit facts">
                <div className="vs-h">Vessel, from record {profile?.found && <span className="vs-tag vs-tag--ok">economics profile</span>}</div>
                <div className="vs-f"><span className="vs-f__k">Vessel name</span><span className="is-auto">{vessel.name}</span></div>
                <div className="vs-f"><span className="vs-f__k">IMO</span><span className="is-auto">{vessel.imo}</span></div>
                <div className="vs-f"><span className="vs-f__k">DWT</span><span className="is-auto">{vessel.dwt}</span></div>
                <FactRow label="SCGT" tip="Suez Canal Gross Tonnage, from the Suez Canal Special Tonnage Certificate (floating-unit rule)." value={facts.scgt} record={record.scgt} onChange={(v) => setF({ scgt: v })} />
                <FactRow label="SCNT" tip="Suez Canal Net Tonnage, the toll basis. From the Suez Canal Special Tonnage Certificate." value={facts.scnt} record={record.scnt} onChange={(v) => setF({ scnt: v })} />
                <FactRow label="GT" tip="International gross tonnage: the mooring-service band and the mooring-boat rule, both from the tariff's own thresholds." value={facts.gt} record={record.gt} onChange={(v) => setF({ gt: v })} />
                <FactRow label="Built" tip="Build year: older vessels are inspected on arrival (age threshold from the tariff)." value={facts.buildYear} record={record.buildYear} onChange={(v) => setF({ buildYear: v })} plain />
                <div className="vs-note">From the vessel&apos;s Suez Canal Special Tonnage Certificate. Switch to Manual to type a value for this estimate.{!vessel.vesselId ? " Market listing: facts are entered manually." : ""}</div>

                <div className="vs-h vs-h--gap">Transit parameters</div>
                <div className="vs-f"><span className="vs-f__k">Direction</span>
                  <div className="ve-seg ve-seg--sm">{(["SB", "NB"] as const).map((d) => <button key={d} type="button" className={`ve-seg__btn${voyage.direction === d ? " is-active" : ""}`} onClick={() => setV({ direction: d })}>{d === "SB" ? "Southbound" : "Northbound"}</button>)}</div></div>
                <div className="vs-f"><span className="vs-f__k">Cargo status</span>
                  <div className="ve-seg ve-seg--sm">{(["laden", "ballast"] as const).map((s) => <button key={s} type="button" className={`ve-seg__btn${voyage.cargoStatus === s ? " is-active" : ""}`} onClick={() => setV({ cargoStatus: s })}>{s === "laden" ? "Laden" : "Ballast"}</button>)}</div></div>
                <label className="vs-f"><span className="vs-f__k">Transit date</span><input className="vs-in vs-in--date" type="date" value={voyage.transitDate} onChange={(e) => setV({ transitDate: e.target.value })} /></label>
                <label className="vs-f"><span className="vs-f__k">SCA category</span>
                  <select className="vs-in vs-in--select" value={facts.category ?? ""} onChange={(e) => setF({ category: e.target.value || null })} aria-label="SCA vessel category">
                    <option value="">— select —</option>{SUEZ_VESSEL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select></label>
                <div className="vs-f"><span className="vs-f__k">SDR to USD</span><span className={estimate?.sdrRate.status === "trusted" ? "is-auto" : estimate?.sdrRate.status === "manual" ? "is-manual" : "is-missing"}>{estimate?.sdrRate.rateUsd != null ? `${estimate.sdrRate.rateUsd} (${estimate.sdrRate.status === "manual" ? `manual: ${estimate.sdrRate.manual?.reason ?? "reason not given"}` : estimate.sdrRate.source}, ${estimate.sdrRate.asOf})` : "not on file"}</span></div>
                <div className="vs-f"><span className="vs-f__k">Tariff</span><span className={!estimate ? "is-missing" : scnt == null || estimate.layers.toll.tiers.length > 0 ? "is-auto" : "is-missing"}>{!estimate ? "—" : scnt == null ? `v${estimate.tariffVersion.versionNo} · SDR per SCNT band` : estimate.layers.toll.tiers.length > 0 ? `v${estimate.tariffVersion.versionNo} · ${estimate.layers.toll.tiers.length} SCNT band${estimate.layers.toll.tiers.length > 1 ? "s" : ""}` : `v${estimate.tariffVersion.versionNo} · bands not loaded`}</span></div>
                <div className="vs-note">Toll bands, the SDR rate and every charge come from the published SCA tariff in force on the transit date.</div>

                <details className="vs-more" open={moreOpen || undefined}>
                  <summary>Risk-flag and waste facts{undecidedCount > 0 ? <span className="vs-tag vs-tag--est">{undecidedCount} undecided</span> : null}</summary>
                  <TriRow label="Cranes lift the mooring boats" value={facts.mooringCranesOk} onChange={(v) => setF({ mooringCranesOk: v })} />
                  <TriRow label="Compliant searchlight (art. 28)" value={facts.searchlight} onChange={(v) => setF({ searchlight: v })} />
                  <TriRow label="First Suez transit" value={facts.firstTransit} onChange={(v) => setF({ firstTransit: v })} />
                  <TriRow label="Double-bottom tanks" value={facts.doubleBottom} onChange={(v) => setF({ doubleBottom: v })} />
                  <label className="vs-f"><span className="vs-f__k">Arrival draft (ft)</span><input className="vs-in" type="number" min="0" step="0.1" value={facts.draftFt} onChange={(e) => setF({ draftFt: e.target.value })} placeholder="—" /></label>
                  <label className="vs-f"><span className="vs-f__k">Beam (ft)</span><input className="vs-in" type="number" min="0" step="0.1" value={facts.beamFt} onChange={(e) => setF({ beamFt: e.target.value })} placeholder="—" /></label>
                  <label className="vs-f"><span className="vs-f__k">Arrival for the SB convoy</span>
                    <select className="vs-in vs-in--select" value={voyage.lateArrivalBand} onChange={(e) => setV({ lateArrivalBand: e.target.value as SuezLateBand })}>
                      <option value="none">Before 23:00 LT</option><option value="b1">23:00–00:00</option><option value="b2">00:00–01:00</option><option value="b3">After 01:00</option>
                    </select></label>
                  <label className="vs-check"><input type="checkbox" checked={voyage.heavyLift} onChange={(e) => setV({ heavyLift: e.target.checked })} /> Heavy unit of 250 t or more on board</label>
                  <label className="vs-check"><input type="checkbox" checked={voyage.floatingUnit} onChange={(e) => setV({ floatingUnit: e.target.checked })} /> Floating unit of SCGT 300 or more carried</label>
                  <label className="vs-check"><input type="checkbox" checked={voyage.military} onChange={(e) => setV({ military: e.target.checked })} /> Navy / government charter or military cargo</label>
                  <label className="vs-check"><input type="checkbox" checked={voyage.notReady} onChange={(e) => setV({ notReady: e.target.checked })} /> May be found not ready in the convoy</label>
                  <label className="vs-check"><input type="checkbox" checked={voyage.ladderNoncompliant} onChange={(e) => setV({ ladderNoncompliant: e.target.checked })} /> Pilot / accommodation ladder not in order</label>
                  <label className="vs-f"><span className="vs-f__k">Deck protrusion beyond limit (ft)</span><input className="vs-in vs-in--sm" type="number" min="0" step="0.5" value={voyage.deckProtrusionFt} onChange={(e) => setV({ deckProtrusionFt: e.target.value })} /></label>
                  <label className="vs-f"><span className="vs-f__k">Relieving pilots at the lakes</span><input className="vs-in vs-in--sm" type="number" min="0" step="1" value={voyage.relievingPilots} onChange={(e) => setV({ relievingPilots: e.target.value })} /></label>
                  <div className="vs-sub">Waste delivery (Antipollution Egypt){estimate?.wasteIncludedM3 != null ? ` · ${estimate.wasteIncludedM3} m³ included in the mandatory fee` : ""}</div>
                  <label className="vs-f"><span className="vs-f__k">Non-hazardous waste (m³)</span><input className="vs-in vs-in--sm" type="number" min="0" step="0.5" value={voyage.wasteNormalM3} onChange={(e) => setV({ wasteNormalM3: e.target.value })} /></label>
                  <label className="vs-f"><span className="vs-f__k">Hazardous waste (m³)</span><input className="vs-in vs-in--sm" type="number" min="0" step="0.5" value={voyage.wasteHazardousM3} onChange={(e) => setV({ wasteHazardousM3: e.target.value })} /></label>
                  <label className="vs-f"><span className="vs-f__k">Contractor bags (m³)</span><input className="vs-in vs-in--sm" type="number" min="0" step="0.5" value={voyage.bagsM3} onChange={(e) => setV({ bagsM3: e.target.value })} /></label>
                  <label className="vs-f"><span className="vs-f__k">Barge waiting (h)</span><input className="vs-in vs-in--sm" type="number" min="0" step="0.5" value={voyage.bargeHours} onChange={(e) => setV({ bargeHours: e.target.value })} /></label>
                  <div className="vs-sub">SDR rate override</div>
                  <label className="vs-f"><span className="vs-f__k">Manual rate (needs a reason)</span><input className="vs-in" type="number" step="0.000001" min="0.5" max="5" value={voyage.sdrOverride} onChange={(e) => setV({ sdrOverride: e.target.value })} placeholder="e.g. 1.36" /></label>
                  {sdrOverrideValue != null && (
                    <label className="vs-f vs-f--stack"><span className="vs-f__k">Reason</span><input className="vs-in vs-in--wide" value={voyage.sdrOverrideReason} onChange={(e) => setV({ sdrOverrideReason: e.target.value })} placeholder="e.g. IMF rate of today, not yet on file" aria-label="SDR override reason" />{!sdrReasonOk && <span className="vs-error">Not applied until a reason is given.</span>}</label>
                  )}
                </details>

                {canSave && (
                  <div className="vs-save">
                    <button type="button" className="ve-btn" onClick={saveFacts} disabled={saveState.busy || pending}>{saveState.busy ? "Saving…" : "Save facts to vessel profile"}</button>
                    {saveState.note && <div className={`vs-note${saveState.error ? " vs-error" : ""}`}>{saveState.note}</div>}
                  </div>
                )}
                <div className="vs-grow" />
                <div className="vs-note">Estimate only. Confirm SCNT and current SDR rate with the SCA agent before transit.</div>
              </aside>

              <section className="vs-main" aria-label="Transit estimate">
                {contextError && <div className="vs-notice vs-notice--unavailable">{contextError}</div>}
                {!context.found && !contextError && (
                  <div className="vs-notice vs-notice--unavailable"><strong>No published Suez tariff covers {voyage.transitDate}.</strong> Nothing is shown that cannot be sourced. Admins publish tariff versions under Admin → Voyage estimator data.</div>
                )}
                {context.found && !facts.category && <div className="vs-notice vs-notice--unavailable"><strong>SCA vessel category not known for this vessel type.</strong> Choose it under Transit parameters; the toll bands depend on it.</div>}
                {estimate && <Results estimate={estimate} vessel={vessel} scnt={scnt} />}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One fact with the design's Record / Manual switch on the right (Suez Canal Special Tonnage Certificate facts). */
function FactRow({ label, tip, value, record, onChange, plain }: { label: string; tip: string; value: FactField; record: number | null; onChange: (v: FactField) => void; plain?: boolean }) {
  const manual = value.mode === "manual";
  const shown = record == null ? null : plain ? String(record) : record.toLocaleString("en-US");
  return (
    <div className="vs-f">
      <span className="vs-f__k" title={tip}>{label}</span>
      <span className="vs-f__v">
        <span className="vs-src" role="group" aria-label={`${label} source`}>
          <button type="button" className={!manual ? "is-on" : ""} aria-pressed={!manual} onClick={() => onChange({ ...value, mode: "record" })} title="Use the value from the vessel record">Record</button>
          <button type="button" className={manual ? "is-on" : ""} aria-pressed={manual} onClick={() => onChange({ ...value, mode: "manual" })} title="Type a value for this estimate">Manual</button>
        </span>
        {manual
          ? <input type="number" min="0" className="vs-in" value={value.manual} onChange={(e) => onChange({ ...value, manual: e.target.value })} placeholder={shown ?? "enter"} aria-label={`${label} manual value`} />
          : <span className={shown == null ? "is-missing" : "is-auto"}>{shown ?? "not sourced"}</span>}
      </span>
    </div>
  );
}

function TriRow({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <div className="vs-f">
      <span className="vs-f__k">{label}</span>
      <div className="ve-seg ve-seg--sm" role="group" aria-label={label}>{(["yes", "no", "unknown"] as const).map((o) => <button key={o} type="button" className={`ve-seg__btn${value === o ? " is-active" : ""}`} aria-pressed={value === o} onClick={() => onChange(o)}>{o === "unknown" ? "?" : o === "yes" ? "Yes" : "No"}</button>)}</div>
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
  if (e.scnt == null) return "SCNT is not sourced: switch SCNT to Manual and enter it to compute the toll.";
  if (e.layers.toll.status === "unavailable" && e.layers.toll.tiers.length === 0) return "The SCA toll bands for this version are not loaded, so the transit toll is unavailable; the other layers are priced.";
  if (e.sdrRate.status === "unavailable") return "The SDR rate is not on file: SDR amounts cannot be converted (an override needs a reason).";
  return null;
}

// The design's three groups (Portal standalone 7 · SUEZ_GROUPS). Any fixed line the tariff adds later lands in Services.
const GROUPS = [
  { key: "sca", title: "Canal authority", note: "Toll, pilotage, ETR, mooring", codes: ["pilotage", "sca_etr", "mooring"], toll: true },
  { key: "port", title: "Port & state", note: "Port authorities, lights, quarantine, police", codes: ["port_said_pa", "red_sea_pa", "lights_dues", "quarantine", "security_immigration"], toll: false },
  { key: "svc", title: "Services", note: "Waste, boat, bank, agency", codes: [] as string[], toll: false },
] as const;

function lineClass(status: LineStatus, amount: number | null | undefined): string {
  if (amount == null) return "is-missing";
  return status === "trusted" ? "is-auto" : status === "manual" ? "is-manual" : "is-missing";
}

function Results({ estimate, vessel, scnt }: { estimate: SuezEstimate; vessel: SuezVesselOption; scnt: number | null }) {
  const t = estimate.totals;
  const applied = estimate.layers.conditional.filter((f) => f.triggered === true);
  const undecided = estimate.layers.conditional.filter((f) => f.triggered === null);
  const notApplied = estimate.layers.conditional.filter((f) => f.triggered === false && !f.contingent);
  const contingent = estimate.layers.conditional.filter((f) => f.contingent);
  const head = headline(estimate);
  const known = new Set<string>(GROUPS.flatMap((g) => [...g.codes]));
  const groups = GROUPS.map((g) => {
    const lines = estimate.layers.fixed.filter((l) => (g.key === "svc" ? !known.has(l.code) : (g.codes as readonly string[]).includes(l.code)));
    const tollUsd = g.toll ? estimate.layers.toll.usd : null;
    const surchargeUsd = g.toll ? t.surchargeUsd : 0;
    const parts = lines.map((l) => l.amountUsd);
    const missing = parts.some((a) => a == null) || (g.toll && tollUsd == null);
    const sum = parts.reduce<number>((a, b) => a + (b ?? 0), 0) + (tollUsd ?? 0) + surchargeUsd;
    return { ...g, lines, tollUsd, sum, missing };
  });
  const flagRow = (f: SuezFlag, cls: string) => (
    <div key={f.code} className={`vs-row vs-flag ${cls}`}>
      <span>{f.triggered === true ? <b>Applied · </b> : f.triggered === null ? <b>Undecided · </b> : null}{f.label}<small>{f.reason} · {f.explanation} · payer: {f.payerParty}{f.status !== "trusted" ? ` · ${STATUS_LABEL[f.status]}` : ""}</small></span>
      <span className={f.triggered === true ? "is-manual" : "is-muted"}>{f.triggered === true ? fmtUSD2(f.appliedUsd) : f.potentialUsd != null ? `potential ${fmtUSD(f.potentialUsd)}` : "undetermined"}</span>
    </div>
  );
  return (
    <>
      {estimate.status !== "trusted" && (
        <div className={`vs-notice vs-notice--${estimate.status}`} role="status">
          <span className="vs-notice__k">{estimate.status}</span><span>{statusSummary(estimate)}{head ? <><br />{head}</> : null}</span>
        </div>
      )}

      <div className="vs-strip">
        {groups.map((g) => (
          <div key={g.key} className="vs-cell">
            <div className="vs-cell__k">{g.title}</div>
            <div className={`vs-cell__v${g.missing && g.sum === 0 ? " is-missing" : ""}`}>{g.missing && g.sum === 0 ? "—" : fmtUSD2(g.sum)}</div>
            <div className="vs-cell__n">{g.missing ? "incomplete: computable lines only" : g.note}</div>
          </div>
        ))}
        <div className="vs-cell vs-cell--all">
          <div className="vs-cell__k">Total transit cost</div>
          <div className="vs-cell__v">{t.complete ? fmtUSD2(t.appliedUsd) : "—"}</div>
          <div className="vs-cell__n" title="The Suez total feeds the Voyage Cost Estimator only when a transit leg applies">{t.complete ? "Feeds Voyage Cost Estimator when a transit leg applies" : `Incomplete · computable parts ${fmtUSD(t.appliedUsd)}`}</div>
          {(t.conditionalAppliedUsd > 0 || t.wasteUsd > 0) && <div className="vs-cell__n">= the three groups + risk flags applied {fmtUSD2(t.conditionalAppliedUsd)} + waste extras {fmtUSD2(t.wasteUsd)}</div>}
        </div>
      </div>

      <div className="vs-groups">
        {groups.map((g) => (
          <div key={g.key} className="vs-card">
            <div className="vs-h">{g.title}</div>
            {g.toll && (
              <>
                <div className="vs-row vs-row--hl">
                  <span>Transit toll<small>{scnt != null ? `${scnt.toLocaleString("en-US")} SCNT` : "SCNT not sourced"} · {SUEZ_VESSEL_CATEGORIES.find((c) => c.key === estimate.vesselCategory)?.label ?? estimate.vesselCategory} · {estimate.cargoStatus}{estimate.layers.toll.sdr != null ? ` · ${fmtSDR(estimate.layers.toll.sdr)}` : ""}{estimate.sdrRate.rateUsd != null ? ` × SDR rate ${estimate.sdrRate.rateUsd} (${estimate.sdrRate.status === "manual" ? `manual: ${estimate.sdrRate.manual?.reason ?? "reason not given"}` : estimate.sdrRate.source}, ${estimate.sdrRate.asOf})` : " · SDR rate not on file"}</small></span>
                  <span className={lineClass(estimate.layers.toll.status, estimate.layers.toll.usd)}>{fmtUSD2(estimate.layers.toll.usd)}</span>
                </div>
                {estimate.layers.toll.tiers.filter((tier) => tier.tons > 0).map((tier) => (
                  <div key={tier.tierOrder} className="vs-row vs-row--band"><span>Band {tier.tierOrder + 1}: {tier.scntFrom.toLocaleString("en-US")} → {tier.scntTo == null ? "open" : tier.scntTo.toLocaleString("en-US")} · {tier.tons.toLocaleString("en-US")} t × {tier.sdrPerScnt}</span><span>{fmtSDR(tier.sdr)}</span></div>
                ))}
                {estimate.layers.toll.tiers.length === 0 && scnt != null && <div className="vs-row"><span className="is-missing">{estimate.layers.toll.reason ?? "SCA toll bands not loaded for this tariff version"}</span><span>—</span></div>}
                {estimate.layers.surcharge.lines.map((l) => <div key={l.code} className="vs-row"><span>{l.label}<small>{l.explanation}{l.status !== "trusted" ? ` · ${STATUS_LABEL[l.status]}` : ""}</small></span><span className={lineClass(l.status, l.amountUsd)}>{fmtUSD2(l.amountUsd)}</span></div>)}
                {estimate.layers.surcharge.lines.length === 0 && estimate.layers.toll.sdr != null && estimate.layers.surcharge.status !== "trusted" && <div className="vs-row"><span className="is-missing">Category surcharge: {estimate.layers.surcharge.reason}</span><span>—</span></div>}
                {estimate.layers.toll.status === "placeholder" && <div className="vs-note vs-error">Placeholder bands: not the official SCA circular. The toll is flagged, not trusted.</div>}
              </>
            )}
            {g.lines.map((l) => (
              <div key={l.code} className="vs-row"><span>{l.label}{(l.amountUsd == null || l.status !== "trusted") && <small>{l.explanation}{l.status !== "trusted" ? ` · ${STATUS_LABEL[l.status]}` : ""}</small>}</span><span className={lineClass(l.status, l.amountUsd)}>{fmtUSD2(l.amountUsd)}</span></div>
            ))}
            <div className="vs-row vs-row--sub"><span>Subtotal{g.missing ? " (computable lines)" : ""}</span><span>{fmtUSD2(g.sum)}</span></div>
          </div>
        ))}
      </div>

      <div className="vs-extra">
        <div className="vs-card">
          <div className="vs-h">Conditional charges · risk flags</div>
          {applied.map((f) => flagRow(f, "is-applied"))}
          {undecided.map((f) => flagRow(f, "is-undecided"))}
          {notApplied.map((f) => flagRow(f, ""))}
          {contingent.length > 0 && <div className="vs-row vs-row--sub"><span>Contingent · only if they happen (listed, never added)</span><span /></div>}
          {contingent.map((f) => <div key={f.code} className="vs-row"><span>{f.label}<small>{f.reason}</small></span><span className="is-muted">—</span></div>)}
          <div className="vs-row vs-row--sub"><span>Applied</span><span>{fmtUSD2(t.conditionalAppliedUsd)}</span></div>
          {undecided.length > 0 && <div className="vs-note">Undecided flags need a fact (cranes, searchlight, transit history, build year) under “Risk-flag and waste facts”; they count in the exposure ({fmtUSD(t.potentialUsd)}), never in the applied total.</div>}
        </div>
        <div className="vs-card">
          <div className="vs-h">Waste extras<span className="vs-h__aside">mandatory fee is under Services{estimate.wasteIncludedM3 != null ? ` · ${estimate.wasteIncludedM3} m³ included` : ""}</span></div>
          {estimate.layers.waste.length === 0 ? <div className="vs-row"><span>No extra volumes declared</span><span>{fmtUSD2(0)}</span></div> : estimate.layers.waste.map((l) => <div key={l.code} className="vs-row"><span>{l.label}<small>{l.explanation}</small></span><span className={lineClass(l.status, l.amountUsd)}>{fmtUSD2(l.amountUsd)}</span></div>)}
          <div className="vs-row vs-row--sub"><span>Total transit cost (applied)</span><span>{t.complete ? fmtUSD2(t.appliedUsd) : "incomplete"}</span></div>
          <div className="vs-row"><span>Feeds the Voyage Estimator as a voyage cost plus {estimate.transitDays} transit + {estimate.anchorageDays} anchorage days</span><span><Link href={`/dashboard/voyage-estimator?vessel=${encodeURIComponent(vessel.id)}`} className="sz-link">Open estimator →</Link></span></div>
        </div>
      </div>

      {(estimate.unavailable.length > 0 || estimate.invalid.length > 0 || estimate.warnings.length > 0) && (
        <div className="vs-card">
          <div className="vs-h">Not priced and notes</div>
          <ul className="vs-list">
            {estimate.unavailable.map((u) => <li key={`u-${u.code}`}><b>{u.code}</b>: {u.reason}</li>)}
            {estimate.invalid.map((u) => <li key={`i-${u.code}`} className="vs-error"><b>{u.code}</b> (malformed tariff line): {u.reason}</li>)}
            {estimate.warnings.map((w, i) => <li key={`w-${i}`}>{w}</li>)}
          </ul>
        </div>
      )}
      <div className="vs-card">
        <div className="vs-h">Sources of tariff v{estimate.tariffVersion.versionNo}</div>
        {estimate.sources.length === 0 ? <div className="vs-note vs-error">No source record is cited on this version.</div> : <ul className="vs-list">{estimate.sources.map((s) => <li key={s.id}>{s.title} · {s.issuer}{s.documentNo ? ` · ${s.documentNo}` : ""}{s.issueDate ? ` · ${s.issueDate}` : ""} · {s.authority} · {s.evidenceStatus === "on_file" ? <>on file <code>{s.sha256?.slice(0, 12)}…</code></> : <span className="vs-error">document pending</span>}</li>)}</ul>}
        <div className="vs-note">Estimate only · {estimate.algorithmVersion} · Tariff v{estimate.tariffVersion.versionNo}, {estimate.tariffVersion.sourceRef}. Confirm SCNT, the SDR rate and the circulars in force with the SCA agent before transit.</div>
      </div>
    </>
  );
}
