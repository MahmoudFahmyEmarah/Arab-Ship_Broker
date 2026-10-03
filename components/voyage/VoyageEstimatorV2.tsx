"use client";

// Voyage cost estimator — member page (Voyage Economics, Stream S).
// Layout follows the approved prototype (result strip, info cards, legs
// table, P&L cards); the arithmetic is lib/voyage/engine.ts fed by the
// vessel's operating profile, measured legs with their ECA share, the deal's
// port times, the Suez estimate (lib/suez/engine.ts) and fuel prices from the
// Fuel Bar index average (or the admin fallback, always labelled).
import * as React from "react";
import Link from "next/link";
import { BunkerTicker } from "@/components/portal/BunkerTicker";
import { estimateVoyage } from "@/lib/voyage/engine";
import { OPERATING_STATES, type ConsumptionMap, type FuelPriceMap, type OperatingState, type VesselClass, type VoyageEstimate, type VoyageInput, type VoyageSettings } from "@/lib/voyage/types";
import { estimateSuezTransit } from "@/lib/suez/engine";
import { suezCategoryFromVesselType, type SuezEstimate, type SuezTariffContextResult } from "@/lib/suez/types";
import type { VoyageVesselOption } from "@/lib/voyage/vessel-options";
import type { FuelPriceLoad } from "@/lib/voyage/fuel-source";
import type { CargoView } from "@/lib/portal/types";
import { detectSuezDirection, needsSuez } from "@/lib/portal/econ";
import { logEvent } from "@/lib/portal/events";
import type { VesselEconomicsProfile } from "@/sdk/app/suez";
import { loadVesselEconomicsAction, saveVesselEconomicsAction } from "@/app/(dashboard)/dashboard/suez-toll/actions";
import { routeLegAction, saveVoyageEstimateAction, type RouteLegResult } from "@/app/(dashboard)/dashboard/voyage-estimator/actions";
import "@/lib/portal/voyage-estimator.css";
import "./voyage-estimator-v2.css";

const fmtUSD = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US");
const fmtUSD2 = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNM = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const fmtDays = (n: number) => n.toFixed(2);
const fmtMT = (n: number) => n.toFixed(1);
const num = (s: string): number | null => { if (s.trim() === "") return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const str = (n: number | null | undefined) => (n == null ? "" : String(n));
const MED_ZONES = new Set(["E.MED", "W.MED", "MED"]);
const STATE_LABEL: Record<OperatingState, string> = { sea_laden: "Sea · laden", sea_ballast: "Sea · ballast", port_working: "Port · working", port_idle: "Port · idle", anchorage: "Anchorage", eca_sea: "Sea inside ECA" };

interface LegState { auto: RouteLegResult | null; loading: boolean; manualNm: string; manualEcaNm: string; useManual: boolean }
const emptyLeg = (): LegState => ({ auto: null, loading: false, manualNm: "", manualEcaNm: "", useManual: false });

interface ProfileForm {
  speedLaden: string; speedBallast: string; hasScrubber: boolean; vesselClass: VesselClass | "";
  cons: Record<OperatingState, { residual: string; distillate: string }>;
  scnt: string; gt: string;
}

export function VoyageEstimatorV2({ vessels, cargos, settings, suezContext, fuel, initialVesselId, initialCargoId }: {
  vessels: VoyageVesselOption[]; cargos: CargoView[]; settings: VoyageSettings; suezContext: SuezTariffContextResult; fuel: FuelPriceLoad; initialVesselId?: string; initialCargoId?: string;
}) {
  const [vesselId, setVesselId] = React.useState(initialVesselId && vessels.some((v) => v.id === initialVesselId) ? initialVesselId : vessels[0]?.id ?? "");
  const [cargoId, setCargoId] = React.useState(initialCargoId && cargos.some((c) => c.id === initialCargoId) ? initialCargoId : cargos[0]?.id ?? "");
  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const cargo = cargos.find((c) => c.id === cargoId) ?? null;
  const [profile, setProfile] = React.useState<VesselEconomicsProfile | null>(null);
  const [form, setForm] = React.useState<ProfileForm>(() => blankProfile());
  const [ballast, setBallast] = React.useState<LegState>(emptyLeg());
  const [laden, setLaden] = React.useState<LegState>(emptyLeg());
  const [voy, setVoy] = React.useState({ seaMargin: str(settings.seaMargin.defaultPct), anchorageDays: str(settings.anchorageDaysDefault), anchorageInEca: false, suezOverride: "auto" as "auto" | "yes" | "no", loadAllowance: "0.5", dischAllowance: "0.5", loadInEca: false, dischInEca: false, pdaLoad: "", pdaDisch: "", freight: "", commission: "", insurance: "", stevedoring: "", other: "", bunkerPort: "" });
  const [save, setSave] = React.useState<{ busy: boolean; note: string | null; error: boolean; id?: string }>({ busy: false, note: null, error: false });
  const [profileSave, setProfileSave] = React.useState<{ busy: boolean; note: string | null; error: boolean }>({ busy: false, note: null, error: false });
  const [, startTransition] = React.useTransition();

  // ── vessel → economics profile (or the listing's figures) ─────────────────
  React.useEffect(() => {
    setProfile(null);
    setForm(blankProfile(vessel));
    if (!vessel?.vesselId) return;
    let alive = true;
    loadVesselEconomicsAction(vessel.vesselId).then((r) => {
      if (!alive || !r.ok || !r.data.found) return;
      setProfile(r.data);
      setForm(profileToForm(r.data, vessel));
    });
    return () => { alive = false; };
  }, [vessel?.vesselId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── cargo → deal figures ──────────────────────────────────────────────────
  React.useEffect(() => {
    setVoy((v) => ({ ...v, freight: str(cargo?.freightIdea ?? null), commission: str(cargo?.commission ?? null), loadInEca: MED_ZONES.has(cargo?.route.polZone ?? ""), dischInEca: MED_ZONES.has(cargo?.route.podZone ?? ""), bunkerPort: cargo?.route.polCode ?? "" }));
  }, [cargo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── legs: measured distance + ECA share through the member session ───────
  const polCode = cargo?.route.polCode ?? null;
  const podCode = cargo?.route.podCode ?? null;
  const openCode = vessel?.openPortLocode ?? null;
  React.useEffect(() => { fetchLeg(openCode, polCode, setBallast); }, [openCode, polCode]);
  React.useEffect(() => { fetchLeg(polCode, podCode, setLaden); }, [polCode, podCode]);

  React.useEffect(() => { if (vesselId && cargoId) logEvent("voyage_estimate", { target: vesselId, meta: { cargo: cargoId } }); }, [vesselId, cargoId]);

  // ── Suez ───────────────────────────────────────────────────────────────
  const ladenAuto = laden.auto;
  const suezDetected = ladenAuto?.chokepoints?.includes("SUEZ") ?? (cargo ? needsSuez(cargo.route.polZone, cargo.route.podZone) : false);
  const suezRequired = voy.suezOverride === "auto" ? suezDetected : voy.suezOverride === "yes";
  const suezEstimate: SuezEstimate | null = React.useMemo(() => {
    if (!suezRequired || !suezContext.found || !cargo) return null;
    const dir = detectSuezDirection(cargo.route.polZone, cargo.route.podZone) === "Northbound" ? "NB" : "SB";
    return estimateSuezTransit({
      vessel: { scnt: num(form.scnt), gt: num(form.gt), category: profile?.suezCategory ?? suezCategoryFromVesselType(vessel?.type), buildYear: vessel?.built ?? null, mooringCranesOk: profile?.mooringCranesOk ?? null, searchlightCompliant: profile?.searchlightCompliant ?? null, firstTransit: profile?.firstTransit ?? false },
      voyage: { direction: dir, cargoStatus: "laden", transitDate: suezContext.date },
    }, suezContext);
  }, [suezRequired, suezContext, cargo, form.scnt, form.gt, profile, vessel]);

  // ── engine input ────────────────────────────────────────────────────────
  const legValue = (l: LegState) => ({ nm: l.useManual ? num(l.manualNm) : l.auto?.nm ?? null, ecaNm: l.useManual ? num(l.manualEcaNm) ?? 0 : l.auto?.ecaNm ?? null, source: l.useManual ? "manual" as const : l.auto?.found ? "measured" as const : null });
  const bl = legValue(ballast);
  const ld = legValue(laden);
  const qty = cargo?.qty.max ?? cargo?.qty.min ?? 0;
  const prices: FuelPriceMap = fuel.prices;
  const input: VoyageInput | null = React.useMemo(() => {
    if (!vessel || !cargo) return null;
    const consumption: ConsumptionMap = {};
    for (const s of OPERATING_STATES) {
      const r = num(form.cons[s].residual), d = num(form.cons[s].distillate);
      if (r != null || d != null) consumption[s] = { residual: r, distillate: d };
    }
    return {
      vessel: { name: vessel.name, speedLadenKn: num(form.speedLaden), speedBallastKn: num(form.speedBallast), consumption, hasScrubber: form.hasScrubber, vesselClass: form.vesselClass || null },
      legs: {
        ballast: openCode && openCode !== polCode ? { key: "ballast", from: openCode, to: polCode, nm: bl.nm, ecaNm: bl.ecaNm, nmSource: bl.source } : null,
        laden: { key: "laden", from: polCode, to: podCode, nm: ld.nm, ecaNm: ld.ecaNm, nmSource: ld.source },
      },
      canal: suezRequired ? { required: true, name: "Suez", transitDays: suezEstimate?.transitDays ?? settings.suez.transitDays, anchorageDays: suezEstimate?.anchorageDays ?? settings.suez.anchorageDays, anchorageInEca: (suezEstimate?.direction ?? "SB") === "SB", costUsd: suezEstimate?.totals.appliedUsd ?? 0, nm: settings.suez.nm, tariffVersionNo: suezEstimate?.tariffVersion.versionNo ?? null, ok: suezEstimate ? suezEstimate.ok : false } : null,
      ports: {
        load: { key: "load", port: polCode, qtyMt: qty, rateMtDay: cargo.loadRate, allowanceDays: num(voy.loadAllowance) ?? 0, inEca: voy.loadInEca, pdaUsd: num(voy.pdaLoad), pdaSource: num(voy.pdaLoad) != null ? "manual" : "none" },
        disch: { key: "disch", port: podCode, qtyMt: qty, rateMtDay: cargo.dischRate, allowanceDays: num(voy.dischAllowance) ?? 0, inEca: voy.dischInEca, pdaUsd: num(voy.pdaDisch), pdaSource: num(voy.pdaDisch) != null ? "manual" : "none" },
      },
      anchorageDays: num(voy.anchorageDays),
      anchorageInEca: voy.anchorageInEca,
      seaMarginPct: num(voy.seaMargin),
      prices,
      settings,
      revenue: num(voy.freight) ? { qtyMt: qty, freightUsdMt: num(voy.freight), commissionPct: num(voy.commission) ?? 0 } : null,
      extras: { insuranceUsd: num(voy.insurance) ?? 0, stevedoringUsd: num(voy.stevedoring) ?? 0, otherUsd: num(voy.other) ?? 0 },
    };
  }, [vessel, cargo, form, openCode, polCode, podCode, bl.nm, bl.ecaNm, bl.source, ld.nm, ld.ecaNm, ld.source, suezRequired, suezEstimate, settings, qty, voy, prices]);
  const estimate: VoyageEstimate | null = React.useMemo(() => (input ? estimateVoyage(input) : null), [input]);

  // ── actions ─────────────────────────────────────────────────────────────
  const saveProfile = () => {
    if (!vessel?.vesselId) return;
    setProfileSave({ busy: true, note: null, error: false });
    const consumption: Record<string, { residual?: number | null; distillate?: number | null }> = {};
    for (const s of OPERATING_STATES) consumption[s] = { residual: num(form.cons[s].residual), distillate: num(form.cons[s].distillate) };
    startTransition(async () => {
      const r = await saveVesselEconomicsAction(vessel.vesselId!, {
        scnt: num(form.scnt), gt: num(form.gt), scgt: profile?.scgt ?? null, suezCategory: profile?.suezCategory ?? suezCategoryFromVesselType(vessel.type),
        mooringCranesOk: profile?.mooringCranesOk ?? null, searchlightCompliant: profile?.searchlightCompliant ?? null, firstTransit: profile?.firstTransit ?? false,
        speedLadenKn: num(form.speedLaden), speedBallastKn: num(form.speedBallast), consumption, hasScrubber: form.hasScrubber, vesselClass: form.vesselClass || null,
      });
      if (r.ok) { setProfile(r.data); setProfileSave({ busy: false, note: "Operating profile saved for this vessel.", error: false }); }
      else setProfileSave({ busy: false, note: r.error, error: true });
    });
  };
  const saveEstimate = () => {
    if (!input || !estimate || !vessel || !cargo) return;
    setSave({ busy: true, note: null, error: false });
    startTransition(async () => {
      const r = await saveVoyageEstimateAction({
        label: `${vessel.name} · ${cargo.refId} · ${cargo.route.polCode} → ${cargo.route.podCode}`,
        vesselId: vessel.vesselId ?? null, availabilityId: vessel.id, cargoListingId: cargo.id,
        input, result: estimate, suez: suezEstimate, fuel: fuel.snapshot,
        routeLegs: [
          ...(input.legs.ballast ? [{ key: "ballast", pol: openCode, pod: polCode, totalNm: bl.nm, ecaNm: bl.ecaNm, method: ballast.useManual ? "manual" as const : ballast.auto?.method ?? "none" as const, chokepoints: ballast.auto?.chokepoints }] : []),
          { key: "laden", pol: polCode, pod: podCode, totalNm: ld.nm, ecaNm: ld.ecaNm, method: laden.useManual ? "manual" as const : laden.auto?.method ?? "none" as const, chokepoints: laden.auto?.chokepoints },
        ],
        portCosts: { load: { port: polCode, usd: num(voy.pdaLoad), source: num(voy.pdaLoad) != null ? "manual" : "none" }, disch: { port: podCode, usd: num(voy.pdaDisch), source: num(voy.pdaDisch) != null ? "manual" : "none" } },
      });
      if (r.ok) { logEvent("voyage_estimate", { target: vessel.id, meta: { action: "save" } }); setSave({ busy: false, note: `Estimate saved (${r.data.id.slice(0, 8)}…).`, error: false, id: r.data.id }); }
      else setSave({ busy: false, note: r.error, error: true });
    });
  };
  const exportEstimate = () => {
    if (!estimate || !vessel || !cargo) return;
    logEvent("voyage_export", { target: vessel.id });
    const L: string[] = [];
    L.push("ARAB SHIPBROKER · VOYAGE COST ESTIMATE", `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${vessel.name} (IMO ${vessel.imo}) · ${cargo.refId} ${cargo.route.polCode} → ${cargo.route.podCode}`, "");
    L.push("LEGS"); estimate.legs.forEach((l) => L.push(`  ${l.label.padEnd(28)} ${fmtNM(l.nm).padStart(7)} NM ${fmtDays(l.days).padStart(7)} d  ${l.burns.map((b) => `${b.productKey} ${fmtMT(b.mt)} MT`).join(", ")}`));
    L.push(`  ${"Total days".padEnd(28)} ${"".padStart(7)}    ${fmtDays(estimate.days.total).padStart(7)} d`, "");
    L.push("FUEL"); estimate.fuel.lines.forEach((f) => L.push(`  ${f.productKey.padEnd(10)} ${fmtMT(f.mt).padStart(8)} MT × $${f.usdMt}/MT (${f.priceSource}) = ${fmtUSD2(f.usd)}`));
    L.push(`  Total fuel ${fmtUSD2(estimate.fuel.totalUsd)}`, "");
    L.push("COSTS", `  Fuel ${fmtUSD2(estimate.costs.fuelUsd)}`, `  Suez transit ${fmtUSD2(estimate.costs.canalUsd)}`, `  Port DAs ${fmtUSD2(estimate.costs.pdaLoadUsd + estimate.costs.pdaDischUsd)}`, `  Extras ${fmtUSD2(estimate.costs.extrasUsd)}`, `  Voyage costs ${fmtUSD2(estimate.costs.voyageCostsUsd)}`, `  Running cost ${fmtUSD2(estimate.costs.opexUsd)} (class ${estimate.opex.vesselClass} · ${fmtUSD2(estimate.opex.usdDay)}/day × ${fmtDays(estimate.days.total)} d)`, `  TOTAL ${fmtUSD2(estimate.costs.totalUsd)}`, "");
    if (estimate.revenue) L.push("REVENUE", `  Gross freight ${fmtUSD2(estimate.revenue.grossFreightUsd)}`, `  Commission ${fmtUSD2(estimate.revenue.commissionUsd)}`, `  Net freight ${fmtUSD2(estimate.revenue.netFreightUsd)}`, `  TCE ${fmtUSD2(estimate.revenue.tceUsdDay)} / day`, `  Result after running cost ${fmtUSD2(estimate.revenue.resultAfterOpexUsd)}`, "");
    if (estimate.assumptions.length) { L.push("ASSUMPTIONS"); estimate.assumptions.forEach((a) => L.push(`  - ${a}`)); }
    if (estimate.warnings.length) { L.push("WARNINGS"); estimate.warnings.forEach((w) => L.push(`  - ${w}`)); }
    const blob = new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ASB-voyage-${vessel.imo}-${cargo.refId}.txt`; a.click(); URL.revokeObjectURL(a.href);
  };

  const usedProducts = estimate ? estimate.fuel.lines.map((l) => l.productKey) : ["VLSFO", "LSMGO"];

  return (
    <div className="ve-page">
      <div className="ve-shell">
        <BunkerTicker />
        <div className="ve-head">
          <div className="ve-head__row">
            <div><div className="ve-head__title">Voyage Cost Estimator</div><div className="ve-head__sub">Days per state, fuel per product, running cost and TCE from the vessel&apos;s operating profile and the deal</div></div>
            <div className="ve-head-right">
              <span className="vy-muted" title={fuel.live ? "Fuel Bar index average" : "No live index: admin fallback prices"}>
                {usedProducts.map((k) => prices[k] ? <span key={k} className="vy-pill">{k} <b>${prices[k].usdMt}</b>/MT <span className={`vy-badge ${prices[k].source === "index" ? "vy-badge--auto" : "vy-badge--fallback"}`}>{prices[k].source}</span></span> : null)}
              </span>
              <button className="ve-btn" type="button" onClick={saveEstimate} disabled={!estimate || save.busy}>{save.busy ? "Saving…" : "Save estimate"}</button>
              <button className="ve-btn" type="button" onClick={exportEstimate} disabled={!estimate}>Export</button>
            </div>
          </div>
          {save.note && <div className={`ve-note-sub${save.error ? " vy-error" : ""}`}>{save.note}{save.id && !save.error ? <> · <Link href={`/dashboard/voyage-estimator?vessel=${vesselId}&cargo=${cargoId}`} className="sz-link">keep working</Link></> : null}</div>}
        </div>

        <div className="ve-selector ve-selector--two">
          <label className="ve-selector__field"><span className="ve-selector__label">Vessel</span><span className="ve-selector__control"><select value={vesselId} onChange={(e) => setVesselId(e.target.value)} aria-label="Vessel"><option value="">Select vessel…</option>{vessels.map((v) => <option key={v.id} value={v.id}>{v.name}, IMO {v.imo}{v.openPortLocode ? ` · open ${v.openPortLocode}` : ""}</option>)}</select></span></label>
          <label className="ve-selector__field"><span className="ve-selector__label">Cargo</span><span className="ve-selector__control"><select value={cargoId} onChange={(e) => setCargoId(e.target.value)} aria-label="Cargo"><option value="">Select cargo…</option>{cargos.map((c) => <option key={c.id} value={c.id}>{c.refId} · {c.commodity} · {c.route.polCode} → {c.route.podCode}</option>)}</select></span></label>
        </div>

        <div className="ve-content">
          {!vessel || !cargo ? <div className="ve-empty">Select a vessel and a cargo to estimate.</div> : (
            <div className="vy-layout">
              <aside className="vy-rail">
                <div className="ve-input-card">
                  <div className="ve-input-card__head">Operating profile · {profile?.found ? "economics profile" : "from the listing"}</div>
                  <div className="ve-input-card__body">
                    <div className="vy-row2">
                      <label className="vy-field"><span>Speed laden (kn)</span><input type="number" step="0.1" value={form.speedLaden} onChange={(e) => setForm({ ...form, speedLaden: e.target.value })} placeholder={String(settings.speeds.ladenKn)} /></label>
                      <label className="vy-field"><span>Speed ballast (kn)</span><input type="number" step="0.1" value={form.speedBallast} onChange={(e) => setForm({ ...form, speedBallast: e.target.value })} placeholder={String(settings.speeds.ballastKn)} /></label>
                    </div>
                    <table className="vy-cons"><thead><tr><th>State</th><th>Residual MT/d</th><th>Distillate MT/d</th></tr></thead>
                      <tbody>{OPERATING_STATES.map((s) => <tr key={s}><td>{STATE_LABEL[s]}</td><td><input type="number" step="0.1" min="0" value={form.cons[s].residual} onChange={(e) => setForm({ ...form, cons: { ...form.cons, [s]: { ...form.cons[s], residual: e.target.value } } })} aria-label={`${STATE_LABEL[s]} residual`} /></td><td><input type="number" step="0.1" min="0" value={form.cons[s].distillate} onChange={(e) => setForm({ ...form, cons: { ...form.cons, [s]: { ...form.cons[s], distillate: e.target.value } } })} aria-label={`${STATE_LABEL[s]} distillate`} /></td></tr>)}</tbody></table>
                    <div className="vy-row2">
                      <label className="vy-check"><input type="checkbox" checked={form.hasScrubber} onChange={(e) => setForm({ ...form, hasScrubber: e.target.checked })} /> Scrubber fitted (HSFO)</label>
                      <label className="vy-field"><span>Cost class</span><select value={form.vesselClass} onChange={(e) => setForm({ ...form, vesselClass: e.target.value as VesselClass | "" })}><option value="">— (C assumed)</option><option value="A">A × {settings.classMultipliers.A}</option><option value="B">B × {settings.classMultipliers.B}</option><option value="C">C × {settings.classMultipliers.C}</option></select></label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>SCNT (Suez)</span><input type="number" min="0" value={form.scnt} onChange={(e) => setForm({ ...form, scnt: e.target.value })} placeholder="from certificate" /></label>
                      <label className="vy-field"><span>GT</span><input type="number" min="0" value={form.gt} onChange={(e) => setForm({ ...form, gt: e.target.value })} /></label>
                    </div>
                    {vessel.vesselId && <div className="vy-save"><button type="button" className="ve-btn" onClick={saveProfile} disabled={profileSave.busy}>{profileSave.busy ? "Saving…" : "Save profile to vessel"}</button>{profileSave.note && <div className={`ve-note-sub${profileSave.error ? " vy-error" : ""}`}>{profileSave.note}</div>}</div>}
                  </div>
                </div>

                <div className="ve-input-card">
                  <div className="ve-input-card__head">Legs · measured routes with ECA share</div>
                  <div className="ve-input-card__body">
                    <LegEditor title="Ballast" from={openCode} to={polCode} leg={ballast} onChange={setBallast} hidden={!openCode || openCode === polCode} />
                    <LegEditor title="Laden" from={polCode} to={podCode} leg={laden} onChange={setLaden} />
                    <div className="vy-row2">
                      <label className="vy-field"><span>Sea margin (%)</span><input type="number" step="0.5" min="0" value={voy.seaMargin} onChange={(e) => setVoy({ ...voy, seaMargin: e.target.value })} /></label>
                      <label className="vy-field"><span>Suez transit</span><select value={voy.suezOverride} onChange={(e) => setVoy({ ...voy, suezOverride: e.target.value as "auto" | "yes" | "no" })}><option value="auto">Auto ({suezDetected ? "required" : "not required"})</option><option value="yes">Required</option><option value="no">Not required</option></select></label>
                    </div>
                    {suezRequired && (
                      <div className="vy-leg__meta">
                        {suezEstimate ? <>Suez: {suezEstimate.ok ? <b>{fmtUSD(suezEstimate.totals.appliedUsd)}</b> : <span className="vy-error">unavailable</span>} · {suezEstimate.direction} · tariff v{suezEstimate.tariffVersion.versionNo} · {suezEstimate.transitDays} + {suezEstimate.anchorageDays} days · <Link href={`/dashboard/suez-toll?vessel=${vesselId}`} className="sz-link">details →</Link>{!suezEstimate.ok && suezEstimate.warnings[0] ? <div className="vy-error">{suezEstimate.warnings[0]}</div> : null}</> : <span className="vy-error">No published Suez tariff for today; the canal cost is 0 and flagged.</span>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="ve-input-card">
                  <div className="ve-input-card__head">Ports, waiting and costs</div>
                  <div className="ve-input-card__body">
                    <div className="vy-row3">
                      <label className="vy-field"><span>Qty (MT)</span><input readOnly value={qty.toLocaleString("en-US")} /></label>
                      <label className="vy-field"><span>Load rate</span><input readOnly value={cargo.loadRate ?? "—"} /></label>
                      <label className="vy-field"><span>Disch rate</span><input readOnly value={cargo.dischRate ?? "—"} /></label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>Load allowance (days)</span><input type="number" step="0.1" min="0" value={voy.loadAllowance} onChange={(e) => setVoy({ ...voy, loadAllowance: e.target.value })} /></label>
                      <label className="vy-field"><span>Disch allowance (days)</span><input type="number" step="0.1" min="0" value={voy.dischAllowance} onChange={(e) => setVoy({ ...voy, dischAllowance: e.target.value })} /></label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-check"><input type="checkbox" checked={voy.loadInEca} onChange={(e) => setVoy({ ...voy, loadInEca: e.target.checked })} /> Load port inside ECA</label>
                      <label className="vy-check"><input type="checkbox" checked={voy.dischInEca} onChange={(e) => setVoy({ ...voy, dischInEca: e.target.checked })} /> Discharge port inside ECA</label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>Waiting at anchorage (days)</span><input type="number" step="0.5" min="0" value={voy.anchorageDays} onChange={(e) => setVoy({ ...voy, anchorageDays: e.target.value })} /></label>
                      <label className="vy-check"><input type="checkbox" checked={voy.anchorageInEca} onChange={(e) => setVoy({ ...voy, anchorageInEca: e.target.checked })} /> Anchorage inside ECA</label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>Load port DA (USD)</span><input type="number" min="0" value={voy.pdaLoad} onChange={(e) => setVoy({ ...voy, pdaLoad: e.target.value })} placeholder="manual" /></label>
                      <label className="vy-field"><span>Disch port DA (USD)</span><input type="number" min="0" value={voy.pdaDisch} onChange={(e) => setVoy({ ...voy, pdaDisch: e.target.value })} placeholder="manual" /></label>
                    </div>
                    <div className="vy-muted">Port DAs: enter the Ports DA Calculator figure or an agent quote (manual, labelled). <Link href={`/dashboard/ports-da?from=voyage&vesselId=${vesselId}&cargoId=${cargoId}`} className="sz-link">Ports DA →</Link></div>
                    <div className="vy-row3">
                      <label className="vy-field"><span>Insurance (USD)</span><input type="number" min="0" value={voy.insurance} onChange={(e) => setVoy({ ...voy, insurance: e.target.value })} /></label>
                      <label className="vy-field"><span>Stevedoring (USD)</span><input type="number" min="0" value={voy.stevedoring} onChange={(e) => setVoy({ ...voy, stevedoring: e.target.value })} /></label>
                      <label className="vy-field"><span>Other (USD)</span><input type="number" min="0" value={voy.other} onChange={(e) => setVoy({ ...voy, other: e.target.value })} /></label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>Freight (USD/MT)</span><input type="number" step="0.01" min="0" value={voy.freight} onChange={(e) => setVoy({ ...voy, freight: e.target.value })} /></label>
                      <label className="vy-field"><span>Commission (%)</span><input type="number" step="0.25" min="0" value={voy.commission} onChange={(e) => setVoy({ ...voy, commission: e.target.value })} /></label>
                    </div>
                  </div>
                </div>
              </aside>

              <main className="vy-main">{estimate && <Results estimate={estimate} settings={settings} />}</main>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fetchLeg(from: string | null, to: string | null, set: React.Dispatch<React.SetStateAction<LegState>>) {
  if (!from || !to || from === to) { set((l) => ({ ...l, auto: null, loading: false })); return; }
  set((l) => ({ ...l, loading: true }));
  routeLegAction(from, to).then((r) => set((l) => ({ ...l, loading: false, auto: r.ok ? r.data : { found: false, nm: null, ecaNm: null, chokepoints: [], method: "none", source: null, reversed: false } })));
}

function LegEditor({ title, from, to, leg, onChange, hidden }: { title: string; from: string | null; to: string | null; leg: LegState; onChange: (l: LegState) => void; hidden?: boolean }) {
  if (hidden) return null;
  const a = leg.auto;
  return (
    <div className="vy-leg">
      <div className="vy-leg__title"><span>{title} · {from ?? "?"} → {to ?? "?"}</span>
        {leg.loading ? <span className="vy-badge vy-badge--fallback">looking up</span> : leg.useManual ? <span className="vy-badge vy-badge--manual">manual</span> : a?.found ? <span className="vy-badge vy-badge--auto">{a.method === "waypoints" ? "measured + ECA" : "measured"}</span> : <span className="vy-badge vy-badge--missing">no route</span>}
      </div>
      {!leg.useManual && a?.found && <div className="vy-leg__meta">{fmtNM(a.nm)} NM{a.ecaNm != null ? ` · ${fmtNM(a.ecaNm)} NM in ECA` : " · ECA share unknown"}{a.chokepoints.length ? ` · via ${a.chokepoints.join(", ")}` : ""}{a.reversed ? " · reversed track" : ""}</div>}
      {!leg.useManual && a && !a.found && <div className="vy-leg__meta vy-error">No measured route for this pair; switch to manual.</div>}
      <div className="vy-row3">
        <label className="vy-check"><input type="checkbox" checked={leg.useManual} onChange={(e) => onChange({ ...leg, useManual: e.target.checked })} /> Manual</label>
        <label className="vy-field"><span>NM</span><input type="number" min="0" value={leg.manualNm} onChange={(e) => onChange({ ...leg, manualNm: e.target.value })} disabled={!leg.useManual} /></label>
        <label className="vy-field"><span>of which ECA NM</span><input type="number" min="0" value={leg.manualEcaNm} onChange={(e) => onChange({ ...leg, manualEcaNm: e.target.value })} disabled={!leg.useManual} /></label>
      </div>
    </div>
  );
}

function Results({ estimate, settings }: { estimate: VoyageEstimate; settings: VoyageSettings }) {
  const c = estimate.costs;
  return (
    <>
      {!estimate.ok && <div className="vy-unavailable">Some core figures are missing (see the notes below); the totals exclude them.</div>}
      <div className="ve-results">
        <div className="ve-result"><div className="ve-result__k">Total voyage days</div><div className="ve-result__v ve-result__v--navy">{fmtDays(estimate.days.total)}</div><div className="ve-note-sub">sea {fmtDays(estimate.days.seaBallast + estimate.days.seaLaden)} · port {fmtDays(estimate.days.portLoad + estimate.days.portDisch)} · canal {fmtDays(estimate.days.canalTransit + estimate.days.canalAnchorage)} · wait {fmtDays(estimate.days.anchorage)}</div></div>
        <div className="ve-result"><div className="ve-result__k">Fuel cost</div><div className="ve-result__v ve-result__v--amber">{fmtUSD(c.fuelUsd)}</div><div className="ve-note-sub">{fmtMT(estimate.fuel.totalMt)} MT{estimate.fuel.ecaMt > 0 ? ` · ${fmtMT(estimate.fuel.ecaMt)} MT in ECA` : ""}</div></div>
        <div className="ve-result"><div className="ve-result__k">Total voyage cost</div><div className="ve-result__v ve-result__v--navy">{fmtUSD(c.totalUsd)}</div><div className="ve-note-sub">voyage costs {fmtUSD(c.voyageCostsUsd)} + running {fmtUSD(c.opexUsd)}</div></div>
        <div className="ve-result ve-result--tce"><div className="ve-result__k">{estimate.revenue ? "TCE estimate" : "Running cost / day"}</div><div className="ve-result__v">{estimate.revenue ? fmtUSD(estimate.revenue.tceUsdDay) : fmtUSD(estimate.opex.usdDay)}<span className="ve-result__unit">/day</span></div><div className="ve-note-sub">{estimate.revenue ? `net freight ${fmtUSD(estimate.revenue.netFreightUsd)}` : `class ${estimate.opex.vesselClass} × ${estimate.opex.multiplier}`}</div></div>
      </div>

      <div className="ve-pl-card" style={{ marginTop: 16 }}>
        <div className="ve-pl-card__title">Legs</div>
        <table className="vy-table"><thead><tr><th>Leg</th><th>From → To</th><th className="num">NM</th><th className="num">ECA NM</th><th className="num">Days</th><th>Fuel</th></tr></thead>
          <tbody>{estimate.legs.map((l) => <tr key={l.key}><td>{l.label}<small>{l.note}</small></td><td>{l.from ?? "—"}{l.to ? ` → ${l.to}` : ""}</td><td className="num">{l.kind === "sea" ? fmtNM(l.nm) : l.kind === "canal" ? fmtNM(l.nm) : "—"}</td><td className="num">{l.ecaNm ? fmtNM(l.ecaNm) : "—"}</td><td className="num">{fmtDays(l.days)}</td><td>{l.burns.map((b) => `${b.productKey} ${fmtMT(b.mt)}`).join(" · ") || "—"}</td></tr>)}
            <tr><td><b>Total</b></td><td /><td className="num"><b>{fmtNM(estimate.legs.reduce((a, l) => a + (l.kind === "sea" || l.kind === "canal" ? l.nm ?? 0 : 0), 0))}</b></td><td className="num"><b>{fmtNM(estimate.legs.reduce((a, l) => a + (l.ecaNm ?? 0), 0))}</b></td><td className="num"><b>{fmtDays(estimate.days.total)}</b></td><td><b>{fmtMT(estimate.fuel.totalMt)} MT</b></td></tr></tbody></table>
      </div>

      <div className="ve-pl-grid">
        <div className="ve-pl-card">
          <div className="ve-pl-card__title">Fuel by product</div>
          {estimate.fuel.lines.map((f) => <div key={f.productKey} className="ve-pl-row ve-pl-row--linked"><span>{f.productKey} · {fmtMT(f.mt)} MT × ${f.usdMt}/MT<small className="sz-muted">{f.priceSource === "index" ? `Fuel Bar average${f.pricePort ? ` @ ${f.pricePort}` : ""}${f.priceAsOf ? ` · ${f.priceAsOf}` : ""}` : "admin fallback price — no live index"}</small></span><span className={f.priceSource === "index" ? "is-auto" : "is-amber"}>{fmtUSD2(f.usd)}</span></div>)}
          <div className="ve-pl-row is-subtotal"><span>Total fuel</span><span>{fmtUSD2(c.fuelUsd)}</span></div>
          <div className="ve-pl-row"><span>Residual product</span><span>{estimate.fuel.residualProduct}</span></div>
          <div className="ve-pl-row"><span>Inside ECA</span><span>{estimate.fuel.ecaProduct}</span></div>
        </div>
        <div className="ve-pl-card">
          <div className="ve-pl-card__title">Voyage costs</div>
          <div className="ve-pl-row"><span>Fuel</span><span>{fmtUSD2(c.fuelUsd)}</span></div>
          <div className="ve-pl-row ve-pl-row--linked"><span>Suez Canal transit<small className="sz-muted">from the Suez calculator</small></span><span className={c.canalUsd > 0 ? "is-auto" : "is-muted"}>{c.canalUsd > 0 ? fmtUSD2(c.canalUsd) : "not applicable / unavailable"}</span></div>
          <div className="ve-pl-row"><span>Load port DA</span><span className={c.pdaLoadUsd > 0 ? "is-editable" : "is-amber"}>{c.pdaLoadUsd > 0 ? fmtUSD2(c.pdaLoadUsd) : "manual · not entered"}</span></div>
          <div className="ve-pl-row"><span>Discharge port DA</span><span className={c.pdaDischUsd > 0 ? "is-editable" : "is-amber"}>{c.pdaDischUsd > 0 ? fmtUSD2(c.pdaDischUsd) : "manual · not entered"}</span></div>
          <div className="ve-pl-row"><span>Insurance, stevedoring, other</span><span>{fmtUSD2(c.extrasUsd)}</span></div>
          <div className="ve-pl-row is-subtotal"><span>Voyage costs</span><span>{fmtUSD2(c.voyageCostsUsd)}</span></div>
          <div className="ve-pl-row ve-pl-row--linked"><span>Running cost<small className="sz-muted">crew ${settings.opex.crewUsdDay} + maintenance ${settings.opex.maintenanceUsdDay} = ${estimate.opex.baseUsdDay}/day × class {estimate.opex.vesselClass} ({estimate.opex.multiplier}) × {fmtDays(estimate.days.total)} days</small></span><span>{fmtUSD2(c.opexUsd)}</span></div>
          <div className="ve-pl-row is-grand"><span>Total voyage cost</span><span>{fmtUSD2(c.totalUsd)}</span></div>
        </div>
        {estimate.revenue && (
          <div className="ve-pl-card">
            <div className="ve-pl-card__title">Revenue</div>
            <div className="ve-pl-row"><span>Gross freight</span><span>{fmtUSD2(estimate.revenue.grossFreightUsd)}</span></div>
            <div className="ve-pl-row"><span>Less commission</span><span>−{fmtUSD2(estimate.revenue.commissionUsd)}</span></div>
            <div className="ve-pl-row is-subtotal"><span>Net freight</span><span>{fmtUSD2(estimate.revenue.netFreightUsd)}</span></div>
            <div className="ve-pl-row"><span>TCE (net − voyage costs) ÷ days</span><span>{fmtUSD2(estimate.revenue.tceUsdDay)} / day</span></div>
            <div className="ve-pl-row is-grand"><span>Result after running cost</span><span className={estimate.revenue.resultAfterOpexUsd >= 0 ? "is-auto" : "is-amber"}>{fmtUSD2(estimate.revenue.resultAfterOpexUsd)}</span></div>
          </div>
        )}
      </div>

      {(estimate.assumptions.length > 0 || estimate.warnings.length > 0) && (
        <div className="vy-notes">
          {estimate.warnings.length > 0 && <><h4>Warnings</h4><ul className="is-warn">{estimate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
          {estimate.assumptions.length > 0 && <><h4>Assumptions</h4><ul>{estimate.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
        </div>
      )}
    </>
  );
}

function blankProfile(vessel?: VoyageVesselOption | null): ProfileForm {
  const cons = {} as ProfileForm["cons"];
  for (const s of OPERATING_STATES) {
    const lc = vessel?.listingConsumption[s];
    cons[s] = { residual: str(lc?.residual ?? null), distillate: str(lc?.distillate ?? null) };
  }
  return { speedLaden: str(vessel?.serviceSpeedKn ?? null), speedBallast: "", hasScrubber: !!vessel?.scrubberFitted, vesselClass: "", cons, scnt: str(vessel?.scnrt ?? null), gt: str(vessel?.gt ?? null) };
}

function profileToForm(p: VesselEconomicsProfile, vessel: VoyageVesselOption): ProfileForm {
  const base = blankProfile(vessel);
  for (const s of OPERATING_STATES) {
    const c = p.consumption?.[s];
    if (c && (c.residual != null || c.distillate != null)) base.cons[s] = { residual: str(c.residual ?? null), distillate: str(c.distillate ?? null) };
  }
  return { ...base, speedLaden: str(p.speedLadenKn ?? vessel.serviceSpeedKn ?? null), speedBallast: str(p.speedBallastKn ?? null), hasScrubber: p.hasScrubber ?? !!vessel.scrubberFitted, vesselClass: p.vesselClass ?? "", scnt: str(p.scnt ?? vessel.scnrt ?? null), gt: str(p.gt ?? vessel.gt ?? null) };
}
