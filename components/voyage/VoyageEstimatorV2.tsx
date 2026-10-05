"use client";

// Voyage cost estimator — member page (Voyage Economics, Stream S).
// Layout follows the approved prototype (result strip, info cards, legs
// table, P&L cards); the arithmetic is lib/voyage/engine.ts (voyage-engine/2)
// fed by the vessel's operating profile, measured legs with their ECA share,
// the deal's port times, the Suez estimate (lib/suez/engine.ts) and the Fuel
// Bar index snapshot. Every figure carries its status — trusted, fallback,
// manual (with a reason) or unavailable — and nothing missing is invented.
// The save is recomputed on the server from governed truth.
import * as React from "react";
import Link from "next/link";
import { BunkerTicker } from "@/components/portal/BunkerTicker";
import { estimateVoyage, seasonOf } from "@/lib/voyage/engine";
import { OPERATING_STATES, type CanalInput, type ComponentStatus, type ConsumptionMap, type OperatingState, type PortCallInput, type SeaLegInput, type SettingsSource, type VesselClass, type VoyageEstimate, type VoyageInput, type VoyageSettings } from "@/lib/voyage/types";
import type { FuelIndexSnapshot } from "@/lib/voyage/snapshots";
import { estimateSuezTransit } from "@/lib/suez/engine";
import { suezCategoryFromVesselType, type SuezEstimate, type SuezInput, type SuezTariffContextResult } from "@/lib/suez/types";
import type { VoyageVesselOption } from "@/lib/voyage/vessel-options";
import type { CargoView } from "@/lib/portal/types";
import { detectSuezDirection, needsSuez } from "@/lib/portal/econ";
import { logEvent } from "@/lib/portal/events";
import type { VesselEconomicsProfile } from "@/sdk/app/suez";
import { loadVesselEconomicsAction, saveVesselEconomicsAction } from "@/app/(dashboard)/dashboard/suez-toll/actions";
import { routeLegAction, saveVoyageEstimateAction, type RouteLegResult } from "@/app/(dashboard)/dashboard/voyage-estimator/actions";
import { canalFromSuez } from "@/lib/voyage/canal";
import "@/lib/portal/voyage-estimator.css";
import "./voyage-estimator-v2.css";

const fmtUSD = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const fmtUSD2 = (n: number | null | undefined) => (n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtNM = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const fmtDays = (n: number) => n.toFixed(2);
const fmtMT = (n: number) => n.toFixed(1);
const num = (s: string): number | null => { if (s.trim() === "") return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const str = (n: number | null | undefined) => (n == null ? "" : String(n));
type Tri = "unknown" | "yes" | "no";
const triToBool = (t: Tri): boolean | null => (t === "unknown" ? null : t === "yes");
const boolToTri = (b: boolean | null | undefined): Tri => (b == null ? "unknown" : b ? "yes" : "no");
const MED_ZONES = new Set(["E.MED", "W.MED", "MED"]);
const STATE_LABEL: Record<OperatingState, string> = { sea_laden: "Sea · laden", sea_ballast: "Sea · ballast", port_working: "Port · working", port_idle: "Port · idle", anchorage: "Anchorage", eca_sea: "Sea inside ECA" };
const BADGE: Record<ComponentStatus, string> = { trusted: "trusted", fallback: "fallback", manual: "manual", unavailable: "missing", invalid: "invalid" };
const laneKey = (a?: string | null, b?: string | null): string | null => {
  if (!a || !b) return null;
  const k = `${a}>${b}`.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9.]+>[A-Z0-9.]+$/.test(k) ? k : null;
};

interface LegState { auto: RouteLegResult | null; loading: boolean; manualNm: string; manualEcaNm: string; manualReason: string; useManual: boolean }
const emptyLeg = (): LegState => ({ auto: null, loading: false, manualNm: "", manualEcaNm: "", manualReason: "", useManual: false });

interface ProfileForm {
  speedLaden: string; speedBallast: string; hasScrubber: Tri; vesselClass: VesselClass | "";
  cons: Record<OperatingState, { residual: string; distillate: string }>;
  scnt: string; gt: string;
}

export function VoyageEstimatorV2({ vessels, cargos, settings, settingsSource, settingsError, suezContext, fuel, viewerUserId, initialVesselId, initialCargoId }: {
  vessels: VoyageVesselOption[]; cargos: CargoView[]; settings: VoyageSettings; settingsSource: SettingsSource; settingsError: string | null;
  suezContext: SuezTariffContextResult; fuel: FuelIndexSnapshot; viewerUserId: string | null; initialVesselId?: string; initialCargoId?: string;
}) {
  const [vesselId, setVesselId] = React.useState(initialVesselId && vessels.some((v) => v.id === initialVesselId) ? initialVesselId : vessels[0]?.id ?? "");
  const [cargoId, setCargoId] = React.useState(initialCargoId && cargos.some((c) => c.id === initialCargoId) ? initialCargoId : cargos[0]?.id ?? "");
  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const cargo = cargos.find((c) => c.id === cargoId) ?? null;
  const [profile, setProfile] = React.useState<VesselEconomicsProfile | null>(null);
  const [form, setForm] = React.useState<ProfileForm>(() => blankProfile());
  const [ballast, setBallast] = React.useState<LegState>(emptyLeg());
  const [laden, setLaden] = React.useState<LegState>(emptyLeg());
  const [voy, setVoy] = React.useState({
    seaMargin: "", anchorageDays: str(settings.anchorageDaysDefault), anchorageInEca: false, suezOverride: "auto" as "auto" | "yes" | "no",
    loadAllowance: "0.5", dischAllowance: "0.5", loadInEca: false, dischInEca: false, loadOpenLoopBan: false, dischOpenLoopBan: false, loadEuBerth: false, dischEuBerth: false,
    pdaLoad: "", pdaLoadReason: "", pdaDisch: "", pdaDischReason: "", freight: "", commission: "", insurance: "", stevedoring: "", other: "",
  });
  const [save, setSave] = React.useState<{ busy: boolean; note: string | null; error: boolean; id?: string }>({ busy: false, note: null, error: false });
  const [profileSave, setProfileSave] = React.useState<{ busy: boolean; note: string | null; error: boolean }>({ busy: false, note: null, error: false });
  const [, startTransition] = React.useTransition();
  const [sessionAt] = React.useState(() => new Date().toISOString()); // stable per session; the server re-stamps every manual value
  const actor = viewerUserId ?? "viewer"; // the server re-stamps every manual value with the verified actor

  // ── vessel → economics profile (or the listing's figures) ─────────────────
  React.useEffect(() => {
    setProfile(null);
    setForm(blankProfile(vessel));
    if (!vessel?.vesselId) return;
    let alive = true;
    loadVesselEconomicsAction(vessel.vesselId).then((r) => {
      if (!alive || !r.ok || !r.data.found) return;
      setProfile(r.data);
      // The profile arrives asynchronously: fill only what the member has not typed meanwhile.
      setForm((cur) => mergeForm(cur, profileToForm(r.data, vessel)));
    });
    return () => { alive = false; };
  }, [vessel?.vesselId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── cargo → deal figures ──────────────────────────────────────────────────
  React.useEffect(() => {
    setVoy((v) => ({ ...v, freight: str(cargo?.freightIdea ?? null), commission: str(cargo?.commission ?? null), loadInEca: MED_ZONES.has(cargo?.route.polZone ?? ""), dischInEca: MED_ZONES.has(cargo?.route.podZone ?? "") }));
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
  const dir: "SB" | "NB" = cargo && detectSuezDirection(cargo.route.polZone, cargo.route.podZone) === "Northbound" ? "NB" : "SB";
  const suezCategory = profile?.suezCategory ?? suezCategoryFromVesselType(vessel?.type);
  const suezInput: SuezInput | null = React.useMemo(() => {
    if (!suezRequired || !cargo || !suezCategory) return null;
    return {
      vessel: { scnt: num(form.scnt), gt: num(form.gt), category: suezCategory, buildYear: vessel?.built ?? null, mooringCranesOk: profile?.mooringCranesOk ?? null, searchlightCompliant: profile?.searchlightCompliant ?? null, firstTransit: profile?.firstTransit ?? null },
      voyage: { direction: dir, cargoStatus: "laden", transitDate: suezContext.date },
    };
  }, [suezRequired, cargo, suezCategory, form.scnt, form.gt, vessel?.built, profile, dir, suezContext.date]);
  const suezEstimate: SuezEstimate | null = React.useMemo(() => (suezInput && suezContext.found ? estimateSuezTransit(suezInput, suezContext) : null), [suezInput, suezContext]);
  // Same mapping as the server save (lib/voyage/canal.ts): trusted only from a trusted Suez estimate.
  const canal: CanalInput | null = React.useMemo(
    () => (suezRequired ? canalFromSuez(suezEstimate, settings, dir === "SB" /* Port Said anchorage lies inside the Med ECA */) : null),
    [suezRequired, suezEstimate, settings, dir],
  );

  // ── engine input ────────────────────────────────────────────────────────
  const legInput = React.useCallback((key: "ballast" | "laden", from: string | null, to: string | null, l: LegState): SeaLegInput => {
    if (l.useManual) return { key, from, to, nm: num(l.manualNm), ecaNm: num(l.manualEcaNm) ?? 0, method: "manual", manual: { actorUserId: actor, reason: l.manualReason.trim(), at: sessionAt } };
    const a = l.auto;
    if (!a?.found) return { key, from, to, nm: null, ecaNm: null, method: "none" };
    return { key, from, to, nm: a.nm, ecaNm: a.method === "waypoints" ? a.ecaNm : null, method: a.method === "waypoints" ? "waypoints" : "distance_only", routeSource: a.source };
  }, [actor, sessionAt]);
  const pdaInput = React.useCallback((usdStr: string, reason: string): PortCallInput["pda"] => {
    const usd = num(usdStr);
    return usd == null ? { usd: null, source: "none" } : { usd, source: "manual", manual: { actorUserId: actor, reason: reason.trim(), at: sessionAt } };
  }, [actor, sessionAt]);
  const qty = cargo?.qty.max ?? cargo?.qty.min ?? 0;
  const input: VoyageInput | null = React.useMemo(() => {
    if (!vessel || !cargo) return null;
    const consumption: ConsumptionMap = {};
    for (const s of OPERATING_STATES) {
      const r = num(form.cons[s].residual), d = num(form.cons[s].distillate);
      if (r != null || d != null) consumption[s] = { residual: r, distillate: d };
    }
    const freight = num(voy.freight);
    return {
      vessel: { name: vessel.name, speedLadenKn: num(form.speedLaden), speedBallastKn: num(form.speedBallast), consumption, hasScrubber: triToBool(form.hasScrubber), vesselClass: form.vesselClass || null },
      legs: {
        ballast: openCode && openCode !== polCode ? legInput("ballast", openCode, polCode, ballast) : null,
        laden: legInput("laden", polCode, podCode, laden),
      },
      canal,
      ports: {
        load: { key: "load", port: polCode, qtyMt: qty, rateMtDay: cargo.loadRate, allowanceDays: num(voy.loadAllowance) ?? 0, inEca: voy.loadInEca, openLoopBan: voy.loadOpenLoopBan, euBerthOver2h: voy.loadEuBerth, pda: pdaInput(voy.pdaLoad, voy.pdaLoadReason) },
        disch: { key: "disch", port: podCode, qtyMt: qty, rateMtDay: cargo.dischRate, allowanceDays: num(voy.dischAllowance) ?? 0, inEca: voy.dischInEca, openLoopBan: voy.dischOpenLoopBan, euBerthOver2h: voy.dischEuBerth, pda: pdaInput(voy.pdaDisch, voy.pdaDischReason) },
      },
      anchorageDays: num(voy.anchorageDays) ?? 0,
      anchorageInEca: voy.anchorageInEca,
      seaMarginPct: num(voy.seaMargin),
      lane: laneKey(cargo.route.polZone, cargo.route.podZone),
      season: seasonOf(cargo.laycanFrom || null),
      fuel,
      settings,
      settingsSource,
      revenue: freight != null && freight > 0 && qty > 0 ? { qtyMt: qty, freightUsdMt: freight, commissionPct: num(voy.commission) ?? 0 } : null,
      extras: { insuranceUsd: num(voy.insurance) ?? 0, stevedoringUsd: num(voy.stevedoring) ?? 0, otherUsd: num(voy.other) ?? 0 },
    };
  }, [vessel, cargo, form, openCode, polCode, podCode, ballast, laden, legInput, pdaInput, canal, settings, settingsSource, fuel, qty, voy]);
  const estimate: VoyageEstimate | null = React.useMemo(() => (input ? estimateVoyage(input) : null), [input]);

  // ── actions ─────────────────────────────────────────────────────────────
  const saveProfile = () => {
    if (!vessel?.vesselId) return;
    setProfileSave({ busy: true, note: null, error: false });
    const consumption: Record<string, { residual?: number | null; distillate?: number | null }> = {};
    for (const s of OPERATING_STATES) consumption[s] = { residual: num(form.cons[s].residual), distillate: num(form.cons[s].distillate) };
    startTransition(async () => {
      const r = await saveVesselEconomicsAction(vessel.vesselId!, {
        scnt: num(form.scnt), gt: num(form.gt), scgt: profile?.scgt ?? null, suezCategory: suezCategory,
        mooringCranesOk: profile?.mooringCranesOk ?? null, searchlightCompliant: profile?.searchlightCompliant ?? null, firstTransit: profile?.firstTransit ?? null,
        speedLadenKn: num(form.speedLaden), speedBallastKn: num(form.speedBallast), consumption, hasScrubber: triToBool(form.hasScrubber), vesselClass: form.vesselClass || null,
      });
      if (r.ok) { setProfile(r.data); setProfileSave({ busy: false, note: "Operating profile saved for this vessel.", error: false }); }
      else setProfileSave({ busy: false, note: r.error, error: true });
    });
  };
  const saveEstimate = () => {
    if (!input || !estimate || !vessel || !cargo || estimate.status === "invalid") return;
    setSave({ busy: true, note: null, error: false });
    startTransition(async () => {
      const r = await saveVoyageEstimateAction({
        label: `${vessel.name} · ${cargo.refId} · ${cargo.route.polCode} → ${cargo.route.podCode}`,
        vesselId: vessel.vesselId ?? null, availabilityId: vessel.id,
        // cargo.id is an actor-bound market handle, never a database id; only an owned listing's real id may reference cargo_listings
        cargoListingId: cargo.ownedListingId ?? null,
        // legs, canal, settings and fuel are re-resolved on the server; only the facts travel
        input, suezInput,
      });
      if (r.ok) { logEvent("voyage_estimate", { target: vessel.id, meta: { action: "save", status: r.data.status } }); setSave({ busy: false, note: `Estimate saved (${r.data.id.slice(0, 8)}… · ${r.data.status}).`, error: false, id: r.data.id }); }
      else setSave({ busy: false, note: r.error, error: true });
    });
  };
  const exportEstimate = () => {
    if (!estimate || !vessel || !cargo) return;
    logEvent("voyage_export", { target: vessel.id });
    const c = estimate.costs;
    const L: string[] = [];
    L.push("ARAB SHIPBROKER · VOYAGE COST ESTIMATE", `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${estimate.algorithmVersion} · status ${estimate.status.toUpperCase()} · settings ${estimate.settingsSource}`, `${vessel.name} (IMO ${vessel.imo}) · ${cargo.refId} ${cargo.route.polCode} → ${cargo.route.podCode}`, "");
    L.push("LEGS"); estimate.legs.forEach((l) => L.push(`  ${l.label.padEnd(28)} ${fmtNM(l.nm).padStart(7)} NM ${fmtDays(l.days).padStart(7)} d  [${l.status}] ${l.burns.map((b) => `${b.productKey} ${fmtMT(b.mt)} MT`).join(", ")}`));
    L.push(`  ${"Total days".padEnd(28)} ${"".padStart(7)}    ${fmtDays(estimate.days.total).padStart(7)} d · sea margin ${estimate.seaMarginPct}% (${estimate.seaMarginBasis})`, "");
    L.push("FUEL"); estimate.fuel.lines.forEach((f) => L.push(`  ${f.productKey.padEnd(10)} ${fmtMT(f.mt).padStart(8)} MT × ${f.usdMt != null ? `$${f.usdMt}/MT` : "no price"} [${f.status}${f.pricePort ? ` @ ${f.pricePort}` : ""}${f.priceAsOf ? ` ${f.priceAsOf}` : ""}] = ${fmtUSD2(f.usd)}`));
    L.push(`  Total fuel ${fmtUSD2(estimate.fuel.totalUsd)} (${fmtMT(estimate.fuel.pricedMt)} of ${fmtMT(estimate.fuel.totalMt)} MT priced)`, "");
    L.push("COSTS", `  Fuel ${fmtUSD2(c.fuel.usd)} [${c.fuel.status}]`, `  Suez transit ${c.canal.required ? `${fmtUSD2(c.canal.usd)} [${c.canal.status}]` : "not required"}`, `  Load port DA ${fmtUSD2(c.pdaLoad.usd)} [${c.pdaLoad.status}]`, `  Discharge port DA ${fmtUSD2(c.pdaDisch.usd)} [${c.pdaDisch.status}]`, `  Extras ${fmtUSD2(c.extrasUsd)}`, `  Voyage costs ${fmtUSD2(c.voyageCostsUsd)}`, `  Running cost ${fmtUSD2(c.opexUsd)} (class ${estimate.opex.vesselClass}${estimate.opex.classAssumed ? " assumed" : ""} · ${fmtUSD2(estimate.opex.usdDay)}/day × ${fmtDays(estimate.days.total)} d)`, `  TOTAL ${fmtUSD2(c.totalUsd)}${c.complete ? "" : " — INCOMPLETE (unavailable parts excluded)"}`, "");
    if (estimate.revenue) L.push("REVENUE", `  Gross freight ${fmtUSD2(estimate.revenue.grossFreightUsd)}`, `  Commission ${fmtUSD2(estimate.revenue.commissionUsd)}`, `  Net freight ${fmtUSD2(estimate.revenue.netFreightUsd)}`, `  TCE ${fmtUSD2(estimate.revenue.tceUsdDay)} / day`, `  Result after running cost ${fmtUSD2(estimate.revenue.resultAfterOpexUsd)}`, "");
    if (estimate.unavailable.length) { L.push("UNAVAILABLE"); estimate.unavailable.forEach((u) => L.push(`  - ${u.code}: ${u.reason}`)); }
    if (estimate.assumptions.length) { L.push("ASSUMPTIONS"); estimate.assumptions.forEach((a) => L.push(`  - ${a}`)); }
    if (estimate.warnings.length) { L.push("WARNINGS"); estimate.warnings.forEach((w) => L.push(`  - ${w}`)); }
    const blob = new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ASB-voyage-${vessel.imo}-${cargo.refId}.txt`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="ve-page">
      <div className="ve-shell">
        <BunkerTicker />
        <div className="ve-head">
          <div className="ve-head__row">
            <div><div className="ve-head__title">Voyage Cost Estimator</div><div className="ve-head__sub">Days per state, fuel per product, running cost and TCE from the vessel&apos;s operating profile and the deal</div></div>
            <div className="ve-head-right">
              <span className="vy-muted" title={fuel.status === "trusted" ? `Fuel Bar index average · ${fuel.asOf ?? ""}` : "No live index: admin fallback prices, labelled on every line"}>
                {estimate ? estimate.fuel.lines.map((f) => <span key={f.productKey} className="vy-pill">{f.productKey} <b>{f.usdMt != null ? `$${f.usdMt}` : "—"}</b>/MT <span className={`vy-badge vy-badge--${BADGE[f.status]}`}>{f.status === "trusted" ? "index" : f.status}</span></span>)
                  : <span className="vy-pill">{fuel.status === "trusted" ? `Fuel Bar index · ${fuel.actualPort ?? fuel.region ?? fuel.scope}` : "no live fuel index · fallback prices"}</span>}
              </span>
              <button className="ve-btn" type="button" onClick={saveEstimate} disabled={!estimate || estimate.status === "invalid" || save.busy}>{save.busy ? "Saving…" : "Save estimate"}</button>
              <button className="ve-btn" type="button" onClick={exportEstimate} disabled={!estimate}>Export</button>
            </div>
          </div>
          {save.note && <div className={`ve-note-sub${save.error ? " vy-error" : ""}`}>{save.note}{save.id && !save.error ? <> · <Link href={`/dashboard/voyage-estimator?vessel=${vesselId}&cargo=${cargoId}`} className="sz-link">keep working</Link></> : null}</div>}
        </div>

        {settingsSource === "defaults" && <div className="vy-unavailable">Voyage constants are not governed{settingsError ? ` (${settingsError})` : ""}: compiled defaults are in use and every estimate is marked partial. Admins fix this under Admin → Voyage estimator data → Constants.</div>}

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
                      <label className="vy-field"><span>Speed laden (kn)</span><input type="number" step="0.1" value={form.speedLaden} onChange={(e) => setForm({ ...form, speedLaden: e.target.value })} placeholder={`${settings.speeds.ladenKn} (default)`} /></label>
                      <label className="vy-field"><span>Speed ballast (kn)</span><input type="number" step="0.1" value={form.speedBallast} onChange={(e) => setForm({ ...form, speedBallast: e.target.value })} placeholder={`${settings.speeds.ballastKn} (default)`} /></label>
                    </div>
                    <table className="vy-cons"><thead><tr><th>State</th><th>Residual MT/d</th><th>Distillate MT/d</th></tr></thead>
                      <tbody>{OPERATING_STATES.map((s) => <tr key={s}><td>{STATE_LABEL[s]}</td><td><input type="number" step="0.1" min="0" value={form.cons[s].residual} onChange={(e) => setForm({ ...form, cons: { ...form.cons, [s]: { ...form.cons[s], residual: e.target.value } } })} aria-label={`${STATE_LABEL[s]} residual`} /></td><td><input type="number" step="0.1" min="0" value={form.cons[s].distillate} onChange={(e) => setForm({ ...form, cons: { ...form.cons, [s]: { ...form.cons[s], distillate: e.target.value } } })} aria-label={`${STATE_LABEL[s]} distillate`} /></td></tr>)}</tbody></table>
                    <div className="vy-muted">A state without figures is not priced (it reads “unavailable”); nothing is borrowed from another state.</div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>Scrubber fitted (HSFO at sea)</span><select value={form.hasScrubber} onChange={(e) => setForm({ ...form, hasScrubber: e.target.value as Tri })} aria-label="Scrubber fitted"><option value="unknown">unknown (priced as none, stated)</option><option value="yes">yes</option><option value="no">no</option></select></label>
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
                      <label className="vy-field"><span>Sea margin (%)</span><input type="number" step="0.5" min="0" value={voy.seaMargin} onChange={(e) => setVoy({ ...voy, seaMargin: e.target.value })} placeholder={estimate ? `${estimate.seaMarginPct} (${estimate.seaMarginBasis})` : "settings"} /></label>
                      <label className="vy-field"><span>Suez transit</span><select value={voy.suezOverride} onChange={(e) => setVoy({ ...voy, suezOverride: e.target.value as "auto" | "yes" | "no" })}><option value="auto">Auto ({suezDetected ? "required" : "not required"})</option><option value="yes">Required</option><option value="no">Not required</option></select></label>
                    </div>
                    {suezRequired && (
                      <div className="vy-leg__meta">
                        {!suezContext.found ? <span className="vy-error">No published Suez tariff for {suezContext.date}: the canal cost is unavailable and the estimate partial.</span>
                          : !suezCategory ? <span className="vy-error">SCA vessel category unknown for this vessel type: set it on the Suez calculator; the canal cost is unavailable.</span>
                          : suezEstimate ? <>Suez: {canal?.complete ? <b>{fmtUSD(canal.costUsd)}</b> : <span className="vy-error">unavailable</span>} <span className={`vy-badge vy-badge--${canal ? BADGE[canal.status] : "missing"}`}>{canal?.status}</span> · {suezEstimate.direction} · tariff v{suezEstimate.tariffVersion.versionNo} · {suezEstimate.transitDays} + {suezEstimate.anchorageDays} days · <Link href={`/dashboard/suez-toll?vessel=${vesselId}`} className="sz-link">details →</Link>{!canal?.complete && suezEstimate.unavailable[0] ? <div className="vy-error">{suezEstimate.unavailable[0].reason}</div> : null}</> : null}
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
                    {form.hasScrubber === "yes" && (
                      <>
                        <div className="vy-row2">
                          <label className="vy-check"><input type="checkbox" checked={voy.loadOpenLoopBan} onChange={(e) => setVoy({ ...voy, loadOpenLoopBan: e.target.checked })} /> Load port bans open-loop washwater</label>
                          <label className="vy-check"><input type="checkbox" checked={voy.dischOpenLoopBan} onChange={(e) => setVoy({ ...voy, dischOpenLoopBan: e.target.checked })} /> Discharge port bans open-loop washwater</label>
                        </div>
                        <div className="vy-row2">
                          <label className="vy-check"><input type="checkbox" checked={voy.loadEuBerth} onChange={(e) => setVoy({ ...voy, loadEuBerth: e.target.checked })} /> EU berth &gt; 2 h at load</label>
                          <label className="vy-check"><input type="checkbox" checked={voy.dischEuBerth} onChange={(e) => setVoy({ ...voy, dischEuBerth: e.target.checked })} /> EU berth &gt; 2 h at discharge</label>
                        </div>
                      </>
                    )}
                    <div className="vy-row2">
                      <label className="vy-field"><span>Waiting at anchorage (days)</span><input type="number" step="0.5" min="0" value={voy.anchorageDays} onChange={(e) => setVoy({ ...voy, anchorageDays: e.target.value })} /></label>
                      <label className="vy-check"><input type="checkbox" checked={voy.anchorageInEca} onChange={(e) => setVoy({ ...voy, anchorageInEca: e.target.checked })} /> Anchorage inside ECA</label>
                    </div>
                    <div className="vy-row2">
                      <label className="vy-field"><span>Load port DA (USD, manual)</span><input type="number" min="0" value={voy.pdaLoad} onChange={(e) => setVoy({ ...voy, pdaLoad: e.target.value })} placeholder="not entered → unavailable" /></label>
                      <label className="vy-field"><span>Disch port DA (USD, manual)</span><input type="number" min="0" value={voy.pdaDisch} onChange={(e) => setVoy({ ...voy, pdaDisch: e.target.value })} placeholder="not entered → unavailable" /></label>
                    </div>
                    {(voy.pdaLoad.trim() !== "" || voy.pdaDisch.trim() !== "") && (
                      <div className="vy-row2">
                        {voy.pdaLoad.trim() !== "" && <label className="vy-field"><span>Reason · load DA</span><input value={voy.pdaLoadReason} onChange={(e) => setVoy({ ...voy, pdaLoadReason: e.target.value })} placeholder="e.g. agent proforma 3 Oct" aria-label="Load DA reason" /></label>}
                        {voy.pdaDisch.trim() !== "" && <label className="vy-field"><span>Reason · disch DA</span><input value={voy.pdaDischReason} onChange={(e) => setVoy({ ...voy, pdaDischReason: e.target.value })} placeholder="e.g. Ports DA calculator figure" aria-label="Discharge DA reason" /></label>}
                      </div>
                    )}
                    <div className="vy-muted">Port DAs: enter the Ports DA Calculator figure or an agent quote with its reason (labelled manual). <Link href={`/dashboard/ports-da?from=voyage&vesselId=${vesselId}&cargoId=${cargoId}`} className="sz-link">Ports DA →</Link></div>
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
  routeLegAction(from, to).then((r) => set((l) => ({ ...l, loading: false, auto: r.ok ? r.data : { found: false, nm: null, ecaNm: null, chokepoints: [], method: "none", source: null, reversed: false, asOf: null, geometryVersions: [], algorithmVersion: null } })));
}

function LegEditor({ title, from, to, leg, onChange, hidden }: { title: string; from: string | null; to: string | null; leg: LegState; onChange: (l: LegState) => void; hidden?: boolean }) {
  if (hidden) return null;
  const a = leg.auto;
  return (
    <div className="vy-leg">
      <div className="vy-leg__title"><span>{title} · {from ?? "?"} → {to ?? "?"}</span>
        {leg.loading ? <span className="vy-badge vy-badge--fallback">looking up</span> : leg.useManual ? <span className="vy-badge vy-badge--manual">manual</span> : a?.found ? <span className={`vy-badge ${a.method === "waypoints" ? "vy-badge--trusted" : "vy-badge--fallback"}`}>{a.method === "waypoints" ? "measured + ECA split" : "measured · ECA share unknown"}</span> : <span className="vy-badge vy-badge--missing">no route</span>}
      </div>
      {!leg.useManual && a?.found && <div className="vy-leg__meta">{fmtNM(a.nm)} NM{a.method === "waypoints" && a.ecaNm != null ? ` · ${fmtNM(a.ecaNm)} NM in ECA` : " · ECA share unknown (priced as non-ECA, flagged)"}{a.chokepoints.length ? ` · via ${a.chokepoints.join(", ")}` : ""}{a.reversed ? " · reversed track" : ""}{a.geometryVersions.length ? ` · zones ${a.geometryVersions.map((g) => `${g.code}@${g.geometryVersion}`).join(", ")}` : ""}</div>}
      {!leg.useManual && a && !a.found && <div className="vy-leg__meta vy-error">No measured route for this pair: the leg is unavailable until a manual distance (with its reason) is entered.</div>}
      <div className="vy-row3">
        <label className="vy-check"><input type="checkbox" checked={leg.useManual} onChange={(e) => onChange({ ...leg, useManual: e.target.checked })} /> Manual</label>
        <label className="vy-field"><span>NM</span><input type="number" min="0" value={leg.manualNm} onChange={(e) => onChange({ ...leg, manualNm: e.target.value })} disabled={!leg.useManual} aria-label="NM" /></label>
        <label className="vy-field"><span>of which ECA NM</span><input type="number" min="0" value={leg.manualEcaNm} onChange={(e) => onChange({ ...leg, manualEcaNm: e.target.value })} disabled={!leg.useManual} aria-label="of which ECA NM" /></label>
      </div>
      {leg.useManual && <label className="vy-field vy-reason"><span>Reason for the manual distance</span><input value={leg.manualReason} onChange={(e) => onChange({ ...leg, manualReason: e.target.value })} placeholder="e.g. owner's distance table, 3 Oct" aria-label="Reason" /></label>}
    </div>
  );
}

function statusSummary(e: VoyageEstimate): string {
  if (e.status === "invalid") return `Invalid input: ${(e.errors ?? []).slice(0, 3).join("; ")}${(e.errors?.length ?? 0) > 3 ? " …" : ""}`;
  if (e.status === "trusted") return "Every figure comes from governed data: measured route with ECA split, declared profile, index prices, tariff DAs.";
  const parts: string[] = [];
  if (e.unavailable.length) parts.push(`${e.unavailable.length} part${e.unavailable.length > 1 ? "s" : ""} unavailable (excluded from the total)`);
  if (e.fuel.status === "fallback") parts.push("fuel at admin fallback prices");
  if (e.legs.some((l) => l.status === "manual") || e.costs.pdaLoad.status === "manual" || e.costs.pdaDisch.status === "manual" || e.costs.canal.status === "manual") parts.push("manual figures (labelled)");
  if (e.legs.some((l) => l.status === "fallback")) parts.push("ECA share unknown on a leg");
  if (e.settingsSource === "defaults") parts.push("compiled default constants");
  if (e.assumptions.some((a) => a.includes("Scrubber"))) parts.push("scrubber status unknown");
  return (e.status === "unavailable" ? "The voyage cannot be priced: " : "Priced with gaps: ") + (parts.join(" · ") || "see the notes");
}

function Results({ estimate, settings }: { estimate: VoyageEstimate; settings: VoyageSettings }) {
  const c = estimate.costs;
  const money = (v: { usd: number | null; status: ComponentStatus }, missingText: string) => v.usd == null ? <span className="is-unavailable">{missingText}</span> : <span className={v.status === "trusted" ? "is-auto" : v.status === "manual" ? "is-manual" : "is-fallback"}>{fmtUSD2(v.usd)}{v.status !== "trusted" ? ` · ${v.status}` : ""}</span>;
  return (
    <>
      <div className={`vy-status vy-status--${estimate.status}`}><span className="vy-status__k">{estimate.status}</span><span>{statusSummary(estimate)}</span></div>
      {estimate.status === "invalid" && estimate.errors && <div className="vy-unavailable"><b>Fix the input:</b><ul className="vy-unavailable-list">{estimate.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {estimate.unavailable.length > 0 && <div className="vy-unavailable"><b>Not priced:</b><ul className="vy-unavailable-list">{estimate.unavailable.map((u) => <li key={u.code}>{u.reason}</li>)}</ul></div>}
      <div className="ve-results">
        <div className="ve-result"><div className="ve-result__k">Total voyage days</div><div className="ve-result__v ve-result__v--navy">{fmtDays(estimate.days.total)}</div><div className="ve-note-sub">sea {fmtDays(estimate.days.seaBallast + estimate.days.seaLaden)} · port {fmtDays(estimate.days.portLoad + estimate.days.portDisch)} · canal {fmtDays(estimate.days.canalTransit + estimate.days.canalAnchorage)} · wait {fmtDays(estimate.days.anchorage)} · margin {estimate.seaMarginPct}%</div></div>
        <div className="ve-result"><div className="ve-result__k">Fuel cost</div><div className="ve-result__v ve-result__v--amber">{fmtUSD(c.fuel.usd)}</div><div className="ve-note-sub">{fmtMT(estimate.fuel.pricedMt)} of {fmtMT(estimate.fuel.totalMt)} MT priced{estimate.fuel.ecaMt > 0 ? ` · ${fmtMT(estimate.fuel.ecaMt)} MT in ECA` : ""} · {c.fuel.status}</div></div>
        <div className="ve-result"><div className="ve-result__k">Total voyage cost</div><div className="ve-result__v ve-result__v--navy">{fmtUSD(c.totalUsd)}</div><div className="ve-note-sub">{c.complete ? <>voyage costs {fmtUSD(c.voyageCostsUsd)} + running {fmtUSD(c.opexUsd)}</> : <span className="is-unavailable">incomplete: {estimate.unavailable.length} part{estimate.unavailable.length > 1 ? "s" : ""} excluded</span>}</div></div>
        <div className="ve-result ve-result--tce"><div className="ve-result__k">{estimate.revenue ? "TCE estimate" : "Running cost / day"}</div><div className="ve-result__v">{estimate.revenue ? fmtUSD(estimate.revenue.tceUsdDay) : fmtUSD(estimate.opex.usdDay)}<span className="ve-result__unit">/day</span></div><div className="ve-note-sub">{estimate.revenue ? `net freight ${fmtUSD(estimate.revenue.netFreightUsd)}${c.complete ? "" : " · on an incomplete cost base"}` : `class ${estimate.opex.vesselClass}${estimate.opex.classAssumed ? " (assumed)" : ""} × ${estimate.opex.multiplier}`}</div></div>
      </div>

      <div className="ve-pl-card" style={{ marginTop: 16 }}>
        <div className="ve-pl-card__title">Legs <span className="sz-muted">· sea margin {estimate.seaMarginPct}% — {estimate.seaMarginBasis}</span></div>
        <table className="vy-table"><thead><tr><th>Leg</th><th>From → To</th><th className="num">NM</th><th className="num">ECA NM</th><th className="num">Days</th><th>Fuel</th><th>Status</th></tr></thead>
          <tbody>{estimate.legs.map((l) => <tr key={l.key}><td>{l.label}<small>{l.note}</small></td><td>{l.from ?? "—"}{l.to && l.to !== l.from ? ` → ${l.to}` : ""}</td><td className="num">{l.kind === "sea" || l.kind === "canal" ? fmtNM(l.nm) : "—"}</td><td className="num">{l.ecaShareKnown ? (l.ecaNm ? fmtNM(l.ecaNm) : "0") : "?"}</td><td className="num">{fmtDays(l.days)}</td><td>{l.burns.map((b) => `${b.productKey} ${fmtMT(b.mt)}`).join(" · ") || "—"}</td><td><span className={`vy-badge vy-badge--${BADGE[l.status]}`}>{l.status}</span></td></tr>)}
            <tr><td><b>Total</b></td><td /><td className="num"><b>{fmtNM(estimate.legs.reduce((a, l) => a + (l.kind === "sea" || l.kind === "canal" ? l.nm ?? 0 : 0), 0))}</b></td><td className="num"><b>{fmtNM(estimate.legs.reduce((a, l) => a + (l.ecaNm ?? 0), 0))}</b></td><td className="num"><b>{fmtDays(estimate.days.total)}</b></td><td><b>{fmtMT(estimate.fuel.totalMt)} MT</b></td><td /></tr></tbody></table>
      </div>

      <div className="ve-pl-grid">
        <div className="ve-pl-card">
          <div className="ve-pl-card__title">Fuel by product <span className="sz-muted">· {c.fuel.status}</span></div>
          {estimate.fuel.lines.map((f) => <div key={f.productKey} className="ve-pl-row ve-pl-row--linked"><span>{f.productKey} · {fmtMT(f.mt)} MT × {f.usdMt != null ? `$${f.usdMt}/MT` : "no price"}<small className="sz-muted">{f.status === "trusted" ? `Fuel Bar average${f.pricePort ? ` @ ${f.pricePort}` : ""}${f.priceScope ? ` (${f.priceScope})` : ""}${f.priceAsOf ? ` · ${f.priceAsOf}` : ""}` : f.status === "fallback" ? "admin fallback price — no live index for this product" : "unavailable — not in the total"}</small></span><span className={f.status === "trusted" ? "is-auto" : f.status === "fallback" ? "is-fallback" : "is-unavailable"}>{fmtUSD2(f.usd)}</span></div>)}
          <div className="ve-pl-row is-subtotal"><span>Total fuel</span><span>{fmtUSD2(c.fuel.usd)}</span></div>
          <div className="ve-pl-row"><span>Residual product</span><span>{estimate.fuel.residualProduct}</span></div>
          <div className="ve-pl-row"><span>Inside ECA / compliant ports</span><span>{estimate.fuel.ecaProduct}</span></div>
          <div className="ve-pl-row"><span>Auxiliary distillate</span><span>{estimate.fuel.distillateProduct}</span></div>
        </div>
        <div className="ve-pl-card">
          <div className="ve-pl-card__title">Voyage costs</div>
          <div className="ve-pl-row"><span>Fuel</span><span>{fmtUSD2(c.fuel.usd)}</span></div>
          <div className="ve-pl-row ve-pl-row--linked"><span>Suez Canal transit<small className="sz-muted">from the Suez calculator</small></span>{c.canal.required ? money(c.canal, "unavailable") : <span className="is-muted">not required</span>}</div>
          <div className="ve-pl-row"><span>Load port DA</span>{money(c.pdaLoad, "not entered — unavailable")}</div>
          <div className="ve-pl-row"><span>Discharge port DA</span>{money(c.pdaDisch, "not entered — unavailable")}</div>
          <div className="ve-pl-row"><span>Insurance, stevedoring, other</span><span>{fmtUSD2(c.extrasUsd)}</span></div>
          <div className="ve-pl-row is-subtotal"><span>Voyage costs{c.complete ? "" : " (computable parts)"}</span><span>{fmtUSD2(c.voyageCostsUsd)}</span></div>
          <div className="ve-pl-row ve-pl-row--linked"><span>Running cost<small className="sz-muted">crew ${settings.opex.crewUsdDay} + maintenance ${settings.opex.maintenanceUsdDay} = ${estimate.opex.baseUsdDay}/day × class {estimate.opex.vesselClass} ({estimate.opex.multiplier}) × {fmtDays(estimate.days.total)} days</small></span><span>{fmtUSD2(c.opexUsd)}</span></div>
          <div className="ve-pl-row is-grand"><span>Total voyage cost</span><span>{fmtUSD2(c.totalUsd)}{c.complete ? "" : <small className="is-unavailable"> incomplete</small>}</span></div>
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
      <div className="ve-note-line">Estimate only · {estimate.algorithmVersion} · settings {estimate.settingsSource}. Saved estimates are recomputed on the server from governed data and stored immutably with their snapshots.</div>
    </>
  );
}

function blankProfile(vessel?: VoyageVesselOption | null): ProfileForm {
  const cons = {} as ProfileForm["cons"];
  for (const s of OPERATING_STATES) {
    const lc = vessel?.listingConsumption[s];
    cons[s] = { residual: str(lc?.residual ?? null), distillate: str(lc?.distillate ?? null) };
  }
  return { speedLaden: str(vessel?.serviceSpeedKn ?? null), speedBallast: "", hasScrubber: boolToTri(vessel?.scrubberFitted), vesselClass: "", cons, scnt: str(vessel?.scnrt ?? null), gt: str(vessel?.gt ?? null) };
}

// Keeps every field the member already set; takes the profile's value only where the form is still blank/unknown.
function mergeForm(cur: ProfileForm, fromProfile: ProfileForm): ProfileForm {
  const cons = {} as ProfileForm["cons"];
  for (const s of OPERATING_STATES) cons[s] = { residual: cur.cons[s].residual || fromProfile.cons[s].residual, distillate: cur.cons[s].distillate || fromProfile.cons[s].distillate };
  return {
    speedLaden: cur.speedLaden || fromProfile.speedLaden, speedBallast: cur.speedBallast || fromProfile.speedBallast,
    hasScrubber: cur.hasScrubber === "unknown" ? fromProfile.hasScrubber : cur.hasScrubber,
    vesselClass: cur.vesselClass || fromProfile.vesselClass, cons, scnt: cur.scnt || fromProfile.scnt, gt: cur.gt || fromProfile.gt,
  };
}

function profileToForm(p: VesselEconomicsProfile, vessel: VoyageVesselOption): ProfileForm {
  const base = blankProfile(vessel);
  for (const s of OPERATING_STATES) {
    const c = p.consumption?.[s];
    if (c && (c.residual != null || c.distillate != null)) base.cons[s] = { residual: str(c.residual ?? null), distillate: str(c.distillate ?? null) };
  }
  return { ...base, speedLaden: str(p.speedLadenKn ?? vessel.serviceSpeedKn ?? null), speedBallast: str(p.speedBallastKn ?? null), hasScrubber: boolToTri(p.hasScrubber ?? vessel.scrubberFitted), vesselClass: p.vesselClass ?? "", scnt: str(p.scnt ?? vessel.scnrt ?? null), gt: str(p.gt ?? vessel.gt ?? null) };
}
