"use client";

// Voyage cost estimator — member page (Voyage Economics, Stream S).
// Layout follows the owner's design (Portal standalone 7 · TabEconomics: result strip, info cards, legs
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
import { needsSuez } from "@/lib/portal/econ";
import { logEvent } from "@/lib/portal/events";
import type { VesselEconomicsProfile } from "@/sdk/app/suez";
import { loadSuezContextAction, loadVesselEconomicsAction, saveVesselEconomicsAction } from "@/app/(dashboard)/dashboard/suez-toll/actions";
import { listVoyagePdaEstimatesAction, routeLegAction, saveVoyageEstimateAction, type RouteLegResult, type VoyagePdaEstimateOption } from "@/app/(dashboard)/dashboard/voyage-estimator/actions";
import { canalFromSuez, downgradeCanalForFacts, suezTransitDate } from "@/lib/voyage/canal";
import { suezFactReasons } from "@/lib/voyage/save-rules";
import { assumptionsFor, legArea, type AssumptionArea } from "@/lib/voyage/assumption-badges";
import { createRequestGate, type RequestGate } from "@/lib/voyage/request-gate";
import { acceptedLegResult, bindLegResult, legLookupKey, matchesLegEndpoints, matchesLegLookup, rebindManualLeg, voyagePdaHref, type BoundLegResult, type LegEndpoints, type LegLookupKey } from "@/lib/voyage/leg-state";
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

const NO_ROUTE: RouteLegResult = { found: false, nm: null, ecaNm: null, chokepoints: [], method: "none", source: null, reversed: false, verified: false, geometryConfidence: "coarse", startZones: null, endZones: null, suezDirection: null, asOf: null, geometryVersions: [], algorithmVersion: null };

interface LegState { auto: BoundLegResult<RouteLegResult> | null; loading: boolean; loadingFor: LegLookupKey | null; manualFor: LegEndpoints | null; manualNm: string; manualEcaNm: string; manualReason: string; useManual: boolean }
const emptyLeg = (): LegState => ({ auto: null, loading: false, loadingFor: null, manualFor: null, manualNm: "", manualEcaNm: "", manualReason: "", useManual: false });
const usesCurrentManual = (l: LegState, from: string | null, to: string | null) => l.useManual && matchesLegEndpoints(l.manualFor, from, to);

interface ProfileForm {
  speedLaden: string; speedBallast: string; hasScrubber: Tri; vesselClass: VesselClass | "";
  cons: Record<OperatingState, { residual: string; distillate: string }>;
  scnt: string; gt: string;
}

export function VoyageEstimatorV2({ vessels, cargos, settings, settingsSource, settingsError, suezContext, fuel, viewerUserId, initialVesselId, initialCargoId, ownerOrgs = [], anchorageEca = {}, anchorageEcaConfidence = "coarse" }: {
  vessels: VoyageVesselOption[]; cargos: CargoView[]; settings: VoyageSettings; settingsSource: SettingsSource; settingsError: string | null;
  suezContext: SuezTariffContextResult; fuel: FuelIndexSnapshot; viewerUserId: string | null; initialVesselId?: string; initialCargoId?: string;
  /** organisations the viewer may file the estimate under (a choice is required when there are several) */
  ownerOrgs?: { id: string; name: string }[];
  /** governed ECA status of the convoy anchorage per direction (settings point × zones), null = unknown */
  anchorageEca?: { SB?: boolean | null; NB?: boolean | null };
  anchorageEcaConfidence?: "official" | "coarse";
}) {
  const [ownerOrgId, setOwnerOrgId] = React.useState<string>(ownerOrgs.length === 1 ? ownerOrgs[0].id : "");
  // A link that names a vessel or cargo this member cannot see opens with nothing selected and says so; it never
  // falls back to the first option, which would present an arbitrary pair as the matched one (O2C-036 #1).
  const linkMissing = { vessel: !!initialVesselId && !vessels.some((v) => v.id === initialVesselId), cargo: !!initialCargoId && !cargos.some((c) => c.id === initialCargoId) };
  const [vesselId, setVesselId] = React.useState(initialVesselId ? (linkMissing.vessel ? "" : initialVesselId) : vessels[0]?.id ?? "");
  const [cargoId, setCargoId] = React.useState(initialCargoId ? (linkMissing.cargo ? "" : initialCargoId) : cargos[0]?.id ?? "");
  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const cargo = cargos.find((c) => c.id === cargoId) ?? null;
  const [profile, setProfile] = React.useState<VesselEconomicsProfile | null>(null);
  const [form, setForm] = React.useState<ProfileForm>(() => blankProfile());
  const [ballast, setBallast] = React.useState<LegState>(emptyLeg());
  const [laden, setLaden] = React.useState<LegState>(emptyLeg());
  const [voy, setVoy] = React.useState({
    seaMargin: "", anchorageDays: str(settings.anchorageDaysDefault), anchorageInEca: false, suezOverride: "auto" as "auto" | "yes" | "no",
    canalManualUsd: "", canalManualReason: "", ballastCanalManualUsd: "", ballastCanalManualReason: "",
    suezConditionsDeclared: false, arrivalDraftFt: "", manualSuezDir: "" as "" | "SB" | "NB",
    loadAllowance: "0.5", dischAllowance: "0.5", loadInEca: false, dischInEca: false, loadOpenLoopBan: false, dischOpenLoopBan: false, loadEuBerth: false, dischEuBerth: false,
    pdaLoad: "", pdaLoadReason: "", pdaDisch: "", pdaDischReason: "", pdaLoadEstimate: "", pdaDischEstimate: "", freight: "", commission: "", insurance: "", stevedoring: "", other: "",
  });
  // the member's saved PDA estimates per port (the DA picker); a chosen one replaces the manual figure
  const [pdaOptions, setPdaOptions] = React.useState<{ load: VoyagePdaEstimateOption[]; disch: VoyagePdaEstimateOption[] }>({ load: [], disch: [] });
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
  // the voyage date: the cargo's laycan, else today — routes and ECA splits are read as of it, as on the save (C2O-058 #8)
  const voyageDate = cargo?.laycanFrom && /^\d{4}-\d{2}-\d{2}/.test(cargo.laycanFrom) ? cargo.laycanFrom.slice(0, 10) : suezContext.date;
  // last request wins per leg; the previous route is cleared while the new one loads, so it can never price it (C2O-061 #2)
  const ballastGate = React.useRef(createRequestGate());
  const ladenGate = React.useRef(createRequestGate());
  React.useEffect(() => { fetchLeg(openCode, polCode, setBallast, voyageDate, ballastGate.current); }, [openCode, polCode, voyageDate]);
  React.useEffect(() => { fetchLeg(polCode, podCode, setLaden, voyageDate, ladenGate.current); }, [polCode, podCode, voyageDate]);

  // saved PDA estimates for each port; a choice that no longer belongs to the port is cleared
  React.useEffect(() => {
    let live = true;
    const load = (code: string | null) => (code ? listVoyagePdaEstimatesAction(code).then((r) => (r.ok ? r.data : [])).catch(() => []) : Promise.resolve([] as VoyagePdaEstimateOption[]));
    Promise.all([load(polCode), load(podCode)]).then(([l, d]) => {
      if (!live) return;
      setPdaOptions({ load: l, disch: d });
      setVoy((v) => ({ ...v, pdaLoadEstimate: l.some((o) => o.id === v.pdaLoadEstimate) ? v.pdaLoadEstimate : "", pdaDischEstimate: d.some((o) => o.id === v.pdaDischEstimate) ? v.pdaDischEstimate : "" }));
    });
    return () => { live = false; };
  }, [polCode, podCode]);
  React.useEffect(() => { if (vesselId && cargoId) logEvent("voyage_estimate", { target: vesselId, meta: { cargo: cargoId } }); }, [vesselId, cargoId]);

  // ── engine input (the same rules as the server save, so the preview matches what is saved) ──
  const ballastLoading = ballast.loading && matchesLegLookup(ballast.loadingFor, openCode, polCode, voyageDate);
  const ladenLoading = laden.loading && matchesLegLookup(laden.loadingFor, polCode, podCode, voyageDate);
  const ballastAuto = acceptedLegResult(ballast.auto, ballast.loading, ballast.loadingFor, openCode, polCode, voyageDate);
  const ladenAuto = acceptedLegResult(laden.auto, laden.loading, laden.loadingFor, polCode, podCode, voyageDate);
  const measured = (l: LegState, a: RouteLegResult | null, from: string | null, to: string | null) => !usesCurrentManual(l, from, to) && !(l.loading && matchesLegLookup(l.loadingFor, from, to, voyageDate)) && !!a?.found;
  const legInput = React.useCallback((key: "ballast" | "laden", from: string | null, to: string | null, l: LegState, a: RouteLegResult | null): SeaLegInput => {
    if (usesCurrentManual(l, from, to)) return { key, from, to, nm: num(l.manualNm), ecaNm: num(l.manualEcaNm) ?? 0, method: "manual", manual: { actorUserId: actor, reason: l.manualReason.trim(), at: sessionAt } };
    if (!a?.found || !from || !to) return { key, from, to, nm: null, ecaNm: null, method: "none" };
    return { key, from, to, nm: a.nm, ecaNm: a.method === "waypoints" ? a.ecaNm : null, method: a.method === "waypoints" ? "waypoints" : "distance_only", routeSource: a.source, routeVerified: a.verified, ecaConfidence: a.geometryConfidence, canalNm: a.chokepoints.includes("SUEZ") ? settings.suez.nm : null };
  }, [actor, sessionAt, settings.suez.nm]);
  const pdaInput = React.useCallback((usdStr: string, reason: string, estimateId: string, options: VoyagePdaEstimateOption[]): PortCallInput["pda"] => {
    // a saved PDA estimate: the preview uses its USD total and coverage; the save re-reads it on the server
    const est = estimateId ? options.find((o) => o.id === estimateId) : undefined;
    if (est && est.usdTotal != null && (est.coverage === "published" || est.coverage === "partial" || est.coverage === "manual_required")) {
      return { usd: Number(est.usdTotal), source: "tariff", estimateId: est.id, coverage: est.coverage };
    }
    const usd = num(usdStr);
    return usd == null ? { usd: null, source: "none" } : { usd, source: "manual", manual: { actorUserId: actor, reason: reason.trim(), at: sessionAt } };
  }, [actor, sessionAt]);
  const qty = cargo?.qty.max ?? cargo?.qty.min ?? 0;
  const portsDaHref = voyagePdaHref({
    availabilityId: vessel?.id ?? null,
    cargoOwnedListingId: cargo?.ownedListingId ?? null,
    cargoRef: cargo?.refId ?? null,
    loadLocode: cargo?.portScope?.polScope === "port" ? polCode : null,
    dischargeLocode: cargo?.portScope?.podScope === "port" ? podCode : null,
    quantityMt: qty,
  });
  // No open port on the position: the ballast leg is kept and reported unavailable, never silently dropped.
  const hasBallast = !!vessel && (openCode == null || openCode !== polCode);
  const ladenStartZones = measured(laden, ladenAuto, polCode, podCode) ? ladenAuto?.startZones ?? null : null;
  const ladenEndZones = measured(laden, ladenAuto, polCode, podCode) ? ladenAuto?.endZones ?? null : null;
  const loadInEca = ladenStartZones != null ? ladenStartZones.length > 0 : voy.loadInEca;
  const dischInEca = ladenEndZones != null ? ladenEndZones.length > 0 : voy.dischInEca;
  const consumption: ConsumptionMap = React.useMemo(() => {
    const out: ConsumptionMap = {};
    for (const st of OPERATING_STATES) {
      const r = num(form.cons[st].residual), d = num(form.cons[st].distillate);
      if (r != null || d != null) out[st] = { residual: r, distillate: d };
    }
    return out;
  }, [form.cons]);
  // Facts equal to the vessel's economics profile are governed; anything typed differently is manual for this estimate.
  const vesselSource: "profile" | "manual" = React.useMemo(() => {
    if (!profile?.found) return "manual";
    const pc: ConsumptionMap = {};
    for (const [k, v] of Object.entries(profile.consumption ?? {})) if (v && (v.residual != null || v.distillate != null)) pc[k as OperatingState] = { residual: v.residual ?? null, distillate: v.distillate ?? null };
    const same = (profile.speedLadenKn ?? null) === num(form.speedLaden) && (profile.speedBallastKn ?? null) === num(form.speedBallast)
      && (profile.hasScrubber ?? null) === triToBool(form.hasScrubber) && (profile.vesselClass ?? null) === (form.vesselClass || null)
      && JSON.stringify(Object.keys(pc).sort().map((k) => [k, pc[k as OperatingState]?.residual ?? null, pc[k as OperatingState]?.distillate ?? null]))
         === JSON.stringify(Object.keys(consumption).sort().map((k) => [k, consumption[k as OperatingState]?.residual ?? null, consumption[k as OperatingState]?.distillate ?? null]));
    return same ? "profile" : "manual";
  }, [profile, form, consumption]);
  const baseInput: VoyageInput | null = React.useMemo(() => {
    if (!vessel || !cargo) return null;
    const freight = num(voy.freight);
    return {
      vessel: { name: vessel.name, speedLadenKn: num(form.speedLaden), speedBallastKn: num(form.speedBallast), consumption, hasScrubber: triToBool(form.hasScrubber), vesselClass: form.vesselClass || null },
      legs: {
        ballast: hasBallast ? legInput("ballast", openCode, polCode, ballast, ballastAuto) : null,
        laden: legInput("laden", polCode, podCode, laden, ladenAuto),
      },
      canal: null,
      ballastCanal: null,
      vesselSource,
      // the server takes the laycan from the linked listing; a market cargo's date is a broker input
      scheduleSource: cargo.ownedListingId && cargo.laycanFrom ? "listing" : "manual",
      ports: {
        load: { key: "load", port: polCode, qtyMt: qty, rateMtDay: cargo.loadRate, rateSource: cargo.ownedListingId ? "listing" : "manual", allowanceDays: num(voy.loadAllowance) ?? 0, inEca: loadInEca, inEcaSource: ladenStartZones != null ? (ladenAuto?.geometryConfidence === "official" ? "governed" : "coarse") : "manual", openLoopBan: voy.loadOpenLoopBan, euBerthOver2h: voy.loadEuBerth, pda: pdaInput(voy.pdaLoad, voy.pdaLoadReason, voy.pdaLoadEstimate, pdaOptions.load) },
        disch: { key: "disch", port: podCode, qtyMt: qty, rateMtDay: cargo.dischRate, rateSource: cargo.ownedListingId ? "listing" : "manual", allowanceDays: num(voy.dischAllowance) ?? 0, inEca: dischInEca, inEcaSource: ladenEndZones != null ? (ladenAuto?.geometryConfidence === "official" ? "governed" : "coarse") : "manual", openLoopBan: voy.dischOpenLoopBan, euBerthOver2h: voy.dischEuBerth, pda: pdaInput(voy.pdaDisch, voy.pdaDischReason, voy.pdaDischEstimate, pdaOptions.disch) },
      },
      anchorageDays: num(voy.anchorageDays) ?? 0,
      anchorageInEca: ladenEndZones != null ? dischInEca : voy.anchorageInEca,
      waitingAnchorageEcaSource: ladenEndZones != null && ladenAuto?.geometryConfidence === "official" ? "governed" : "manual",
      seaMarginPct: num(voy.seaMargin),
      lane: laneKey(cargo.route.polZone, cargo.route.podZone),
      season: seasonOf(cargo.laycanFrom || null),
      fuel,
      settings,
      settingsSource,
      revenue: freight != null && freight > 0 && qty > 0 ? { qtyMt: qty, freightUsdMt: freight, commissionPct: num(voy.commission) ?? 0 } : null,
      extras: { insuranceUsd: num(voy.insurance) ?? 0, stevedoringUsd: num(voy.stevedoring) ?? 0, otherUsd: num(voy.other) ?? 0 },
    };
  }, [vessel, cargo, form, consumption, vesselSource, hasBallast, openCode, polCode, podCode, ballast, laden, ballastAuto, ladenAuto, legInput, pdaInput, loadInEca, dischInEca, ladenStartZones, ladenEndZones, settings, settingsSource, fuel, qty, voy, pdaOptions]);
  const pre: VoyageEstimate | null = React.useMemo(() => (baseInput ? estimateVoyage(baseInput) : null), [baseInput]);

  // ── Suez: one transit per leg that crosses the canal, priced on its own transit date ──
  const startDate = voyageDate;
  // A measured track decides; the override speaks only for a manual or missing laden leg (an assertion the server stamps).
  const ladenSuez = measured(laden, ladenAuto, polCode, podCode) ? !!ladenAuto?.chokepoints.includes("SUEZ") : voy.suezOverride === "auto" ? (cargo ? needsSuez(cargo.route.polZone, cargo.route.podZone) : false) : voy.suezOverride === "yes";
  const ballastSuez = hasBallast && measured(ballast, ballastAuto, openCode, polCode) && !!ballastAuto?.chokepoints.includes("SUEZ");
  const suezRequired = ladenSuez || ballastSuez;
  // C2O-058 #2: no direction from zones; a measured track without in-canal waypoints, or a manual leg without the
  // broker's explicit direction, leaves the canal unpriced (as the save does)
  const ladenDir: "SB" | "NB" | null = measured(laden, ladenAuto, polCode, podCode) ? (ladenAuto?.suezDirection ?? null) : (voy.manualSuezDir === "SB" || voy.manualSuezDir === "NB" ? voy.manualSuezDir : null);
  const ballastDir: "SB" | "NB" | null = measured(ballast, ballastAuto, openCode, polCode) ? (ballastAuto?.suezDirection ?? null) : null;
  const ladenDate = pre ? suezTransitDate(startDate, pre.days.portLoad + pre.days.seaLaden / 2) : startDate;
  const ballastDate = pre ? suezTransitDate(startDate, -pre.days.seaBallast / 2) : startDate;
  const [ctxByDate, setCtxByDate] = React.useState<Record<string, SuezTariffContextResult>>(() => ({ [suezContext.date]: suezContext }));
  React.useEffect(() => {
    for (const d of [ladenSuez ? ladenDate : null, ballastSuez ? ballastDate : null]) {
      if (d && !ctxByDate[d]) loadSuezContextAction(d).then((r) => { if (r.ok) setCtxByDate((m) => ({ ...m, [d]: r.data })); });
    }
  }, [ladenSuez, ballastSuez, ladenDate, ballastDate, ctxByDate]);
  const suezCategory = profile?.suezCategory ?? suezCategoryFromVesselType(vessel?.type);
  const suezFor = React.useCallback((which: "laden" | "ballast", date: string, direction: "SB" | "NB" | null): { input: SuezInput | null; estimate: SuezEstimate | null } => {
    if (!suezCategory || !direction) return { input: null, estimate: null };
    const input: SuezInput = {
      vessel: {
        scnt: num(form.scnt), gt: num(form.gt), scgt: profile?.scgt ?? null, category: suezCategory, buildYear: profile?.buildYear ?? vessel?.built ?? null,
        craneCount: profile?.craneCount ?? null, craneSwlMt: profile?.craneSwlMt ?? null,
        mooringCranesOk: profile?.mooringCranesOk ?? null, searchlightCompliant: profile?.searchlightCompliant ?? null, firstTransit: profile?.firstTransit ?? null,
        beamFt: profile?.beamFt ?? null, doubleBottom: profile?.doubleBottom ?? null, draftFt: num(voy.arrivalDraftFt),
      },
      voyage: voy.suezConditionsDeclared
        ? { direction, cargoStatus: which, transitDate: date, heavyLiftOver250t: false, floatingUnitScgt300: false, militaryCargo: false, lateArrivalBand: "none", notReady: false, deckProtrusionFt: 0, ladderNoncompliant: false, relievingPilots: 0, wasteNormalM3: 0, wasteHazardousM3: 0, bagsM3: 0, bargeHours: 0 }
        : { direction, cargoStatus: which, transitDate: date },
    };
    const ctx = ctxByDate[date];
    return { input, estimate: ctx?.found ? estimateSuezTransit(input, ctx) : null };
  }, [suezCategory, form.scnt, form.gt, vessel?.built, profile, ctxByDate, voy.arrivalDraftFt, voy.suezConditionsDeclared]);
  const suezLaden = React.useMemo(() => (ladenSuez ? suezFor("laden", ladenDate, ladenDir) : { input: null, estimate: null }), [ladenSuez, suezFor, ladenDate, ladenDir]);
  const suezBallast = React.useMemo(() => (ballastSuez ? suezFor("ballast", ballastDate, ballastDir) : { input: null, estimate: null }), [ballastSuez, suezFor, ballastDate, ballastDir]);
  const suezInput = suezLaden.input ?? suezBallast.input;
  const suezEstimate = suezLaden.estimate ?? suezBallast.estimate;
  const manualCost = React.useCallback((usd: string, reason: string) => {
    const v = num(usd);
    return v != null && reason.trim().length >= 3 ? { usd: v, manual: { actorUserId: actor, reason: reason.trim(), at: sessionAt } } : null;
  }, [actor, sessionAt]);
  const anch = React.useCallback((d: "SB" | "NB" | null) => (d == null ? { anchorageInEca: false, anchorageInEcaSource: "manual" as const } : anchorageEca[d] == null ? { anchorageInEca: d === "SB", anchorageInEcaSource: "manual" as const } : { anchorageInEca: !!anchorageEca[d], anchorageInEcaSource: anchorageEcaConfidence === "official" ? ("governed" as const) : ("coarse" as const) }), [anchorageEca, anchorageEcaConfidence]);
  // the server also compares every typed Suez fact with the governed profile; the preview shows the reasons it can see
  // the same comparison the save runs (C2O-058 #3): every typed Suez fact against the governed profile
  const suezFactsPreview = React.useMemo(() => {
    const gp = profile?.found && profile.allowed ? profile : null;
    const n = (v: unknown) => (v == null ? null : Number(v));
    return suezFactReasons(suezInput?.vessel, {
      scnt: n(gp?.scnt), scgt: n(gp?.scgt), gt: n(gp?.gt), category: gp?.suezCategory ?? null, buildYear: n(gp?.buildYear) ?? vessel?.built ?? null,
      craneCount: n(gp?.craneCount), craneSwlMt: n(gp?.craneSwlMt), mooringCranesOk: gp?.mooringCranesOk ?? null, searchlightCompliant: gp?.searchlightCompliant ?? null,
      firstTransit: gp?.firstTransit ?? null, beamFt: n(gp?.beamFt), doubleBottom: gp?.doubleBottom ?? null,
    }, voy.suezConditionsDeclared);
  }, [profile, suezInput, vessel?.built, voy.suezConditionsDeclared]);
  const canal: CanalInput | null = React.useMemo(
    () => (ladenSuez ? downgradeCanalForFacts(canalFromSuez(suezLaden.estimate, settings, { leg: "laden", ...anch(ladenDir), manualCost: manualCost(voy.canalManualUsd, voy.canalManualReason) }), suezFactsPreview, { actorUserId: actor, at: sessionAt }) : null),
    [ladenSuez, suezLaden.estimate, settings, ladenDir, anch, manualCost, voy.canalManualUsd, voy.canalManualReason, suezFactsPreview, actor, sessionAt],
  );
  const ballastCanal: CanalInput | null = React.useMemo(
    () => (ballastSuez ? downgradeCanalForFacts(canalFromSuez(suezBallast.estimate, settings, { leg: "ballast", ...anch(ballastDir), manualCost: manualCost(voy.ballastCanalManualUsd, voy.ballastCanalManualReason) }), suezFactsPreview, { actorUserId: actor, at: sessionAt }) : null),
    [ballastSuez, suezBallast.estimate, settings, ballastDir, anch, manualCost, voy.ballastCanalManualUsd, voy.ballastCanalManualReason, suezFactsPreview, actor, sessionAt],
  );
  const input: VoyageInput | null = React.useMemo(() => (baseInput ? { ...baseInput, canal, ballastCanal } : null), [baseInput, canal, ballastCanal]);
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
        buildYear: profile?.buildYear ?? null, craneCount: profile?.craneCount ?? null, craneSwlMt: profile?.craneSwlMt ?? null, beamFt: profile?.beamFt ?? null, doubleBottom: profile?.doubleBottom ?? null,
        speedLadenKn: num(form.speedLaden), speedBallastKn: num(form.speedBallast), consumption, hasScrubber: triToBool(form.hasScrubber), vesselClass: form.vesselClass || null,
      });
      if (r.ok) { setProfile(r.data); setProfileSave({ busy: false, note: "Operating profile saved for this vessel.", error: false }); }
      else setProfileSave({ busy: false, note: r.error, error: true });
    });
  };
  const saveEstimate = () => {
    if (!input || !estimate || !vessel || !cargo || estimate.status === "invalid") return;
    if (ownerOrgs.length > 1 && !ownerOrgId) { setSave({ busy: false, note: "Choose the organisation that owns this estimate.", error: true }); return; }
    setSave({ busy: true, note: null, error: false });
    startTransition(async () => {
      const r = await saveVoyageEstimateAction({
        label: `${vessel.name} · ${cargo.refId} · ${cargo.route.polCode} → ${cargo.route.podCode}`,
        vesselId: vessel.vesselId ?? null, availabilityId: vessel.id,
        // cargo.id is an actor-bound market handle, never a database id; only an owned listing's real id may reference cargo_listings
        cargoListingId: cargo.ownedListingId ?? null,
        // legs, canal, settings and fuel are re-resolved on the server; only the facts travel
        input, suezInput, startDate, ownerOrgId: ownerOrgId || null, suezConditionsDeclared: voy.suezConditionsDeclared,
        canalManual: {
          laden: num(voy.canalManualUsd) != null ? { usd: num(voy.canalManualUsd)!, reason: voy.canalManualReason } : null,
          ballast: num(voy.ballastCanalManualUsd) != null ? { usd: num(voy.ballastCanalManualUsd)!, reason: voy.ballastCanalManualReason } : null,
        },
      });
      if (r.ok) { logEvent("voyage_estimate", { target: vessel.id, meta: { action: "save", status: r.data.status } }); setSave({ busy: false, note: `Estimate saved (${r.data.id.slice(0, 8)}… · ${r.data.status}).${r.data.warnings.length ? ` ${r.data.warnings.join(" ")}` : ""}`, error: false, id: r.data.id }); }
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

  const setVo = (p: Partial<typeof voy>) => setVoy((v) => ({ ...v, ...p }));
  const consCell = (st: OperatingState, kind: "residual" | "distillate") => form.cons[st][kind] || "—";
  const c = estimate?.costs ?? null;
  // nothing priced is unknown, not zero (owner rule): no fuel priced at all reads "—"
  const fuelUsd = c && estimate && estimate.fuel.pricedMt > 0 ? c.fuel.usd : null;
  // an incomplete total with nothing computable is unknown too
  const knownUsd = (v: number | null | undefined) => (c && !c.complete && (v ?? 0) === 0 ? null : v ?? null);
  const assumed = (...areas: AssumptionArea[]) => (estimate ? assumedBadge(estimate, areas) : null);
  const legsNeedAttention = !!estimate && estimate.legs.some((l) => l.status === "unavailable" || l.status === "manual" || l.status === "fallback");
  // opens itself when a leg needs attention and then stays open, so fixing the leg inside it never snaps it shut (O2B-052 P2-5)
  const [legsOpen, setLegsOpen] = React.useState(false);
  if (legsNeedAttention && !legsOpen) setLegsOpen(true);
  const pct = (part: number | null | undefined, whole: number | null | undefined) => (part == null || whole == null || whole <= 0 ? "—" : `${Math.round((part / whole) * 100)}%`);

  return (
    <div className="ve-page">
      <div className="ve-shell">
        <BunkerTicker />
        {/* design (Portal standalone 7, EconShell): title + "Complete voyage P&L"; fuel pills, Save, Export on the right */}
        <div className="ve-head">
          <div className="ve-head__row">
            <div><h1 className="ve-head__title">Voyage Cost Estimator</h1><div className="ve-head__sub">Complete voyage P&amp;L</div></div>
            <div className="ve-head-right">
              <span className="vy-muted" title={fuel.status === "trusted" ? `Fuel Bar index average · ${fuel.asOf ?? ""}` : "No live index: admin fallback prices, labelled on every line"}>
                {estimate ? estimate.fuel.lines.map((f) => <span key={f.productKey} className="vy-pill">{f.productKey} <b>{f.usdMt != null ? `$${f.usdMt}` : "—"}</b>/MT <span className={`vy-badge vy-badge--${BADGE[f.status]}`}>{f.status === "trusted" ? "index" : f.status}</span></span>)
                  : <span className="vy-pill">{fuel.status === "trusted" ? `Fuel Bar index · ${fuel.actualPort ?? fuel.region ?? fuel.scope}` : "no live fuel index · fallback prices"}</span>}
              </span>
              <button className="ve-btn" type="button" onClick={saveEstimate} disabled={!estimate || estimate.status === "invalid" || save.busy}>{save.busy ? "Saving…" : "Save estimate"}</button>
              <button className="ve-btn" type="button" onClick={exportEstimate} disabled={!estimate}>Export estimate</button>
            </div>
          </div>
          {save.note && <div className={`ve-note-sub${save.error ? " vy-error" : ""}`}>{save.note}{save.id && !save.error ? <> · <Link href={`/dashboard/voyage-estimator?vessel=${vesselId}&cargo=${cargoId}`} className="sz-link">keep working</Link></> : null}</div>}
        </div>

        {settingsSource === "defaults" && <div className="vy-unavailable">Voyage constants are not governed{settingsError ? ` (${settingsError})` : ""}: compiled defaults are in use and every estimate is marked partial. Admins fix this under Admin → Voyage estimator data → Constants.</div>}

        {(linkMissing.vessel || linkMissing.cargo) && <div className="vy-unavailable" role="status" data-testid="link-not-found">The linked {linkMissing.vessel && linkMissing.cargo ? "vessel and cargo are" : linkMissing.vessel ? "vessel is" : "cargo is"} not in your list (not yours, or no longer open). Choose them below; nothing was selected for you.</div>}
        <div className="ve-selector ve-selector--two">
          <label className="ve-selector__field"><span className="ve-selector__label">Vessel</span><span className="ve-selector__control"><select value={vesselId} onChange={(e) => setVesselId(e.target.value)} aria-label="Vessel"><option value="">Select vessel…</option>{vessels.map((v) => <option key={v.id} value={v.id}>{v.name}, IMO {v.imo}{v.openPortLocode ? ` · open ${v.openPortLocode}` : ""}</option>)}</select><span className="ve-selector__caret" aria-hidden="true">▾</span></span></label>
          <label className="ve-selector__field"><span className="ve-selector__label">Cargo</span><span className="ve-selector__control"><select value={cargoId} onChange={(e) => setCargoId(e.target.value)} aria-label="Cargo"><option value="">Select cargo…</option>{cargos.map((c) => <option key={c.id} value={c.id}>{c.refId} · {c.commodity} · {c.route.polCode} → {c.route.podCode}</option>)}</select><span className="ve-selector__caret" aria-hidden="true">▾</span></span></label>
        </div>

        <div className="ve-content">
          {!vessel || !cargo ? <div className="ve-empty">Select a vessel and a cargo to estimate.</div> : (
            <div className="ve-econ">
              {estimate && estimate.status !== "trusted" && (
                <div className={`vy-status vy-status--${estimate.status}`}>
                  <span className="vy-status__k">{estimate.status}</span>
                  <span>{statusSummary(estimate)}
                    {estimate.status === "invalid" && estimate.errors ? <ul className="vy-unavailable-list">{estimate.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
                    {estimate.unavailable.length > 0 ? <ul className="vy-unavailable-list">{estimate.unavailable.map((u) => <li key={u.code}>{u.reason}</li>)}</ul> : null}
                  </span>
                </div>
              )}

              {/* Result strip — design: total voyage days · total bunker cost · gross freight · TCE */}
              <div className="ve-results">
                <div className="ve-result"><div className="ve-result__k">Total voyage days{assumed("sea", "port", "canal")}</div><div className="ve-result__v ve-result__v--navy">{estimate ? fmtDays(estimate.days.total) : "—"}</div></div>
                <div className="ve-result"><div className="ve-result__k">Total bunker cost</div><div className={`ve-result__v ${fuelUsd != null ? "ve-result__v--amber" : "is-unavailable"}`}>{fmtUSD(fuelUsd)}</div></div>
                <div className="ve-result"><div className="ve-result__k">Gross freight</div><div className={`ve-result__v ${estimate?.revenue ? "ve-result__v--green" : "is-unavailable"}`}>{estimate?.revenue ? fmtUSD(estimate.revenue.grossFreightUsd) : "—"}</div></div>
                <div className="ve-result ve-result--tce"><div className="ve-result__k">{estimate?.revenue ? "TCE estimate" : "Running cost / day"}</div><div className="ve-result__v">{estimate ? (estimate.revenue ? fmtUSD(estimate.revenue.tceUsdDay) : fmtUSD(estimate.opex.usdDay)) : "—"}<span className="ve-result__unit">/day</span></div></div>
              </div>

              <div className="ve-upper">
                <div className="ve-info-card">
                  <div className="ve-info-card__head">Vessel, from {profile?.found ? "economics profile" : "registration"} · {vessel.imo}</div>
                  <div className="ve-info-card__body">
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Vessel name</span><span className="ve-info-card__v is-auto">{vessel.name}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Type</span><span className="ve-info-card__v is-auto">{vessel.type || "—"}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">DWT (MT)</span><span className="ve-info-card__v is-auto">{vessel.dwt || "—"}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Speed laden / ballast (kn)</span><span className="ve-info-card__v">
                      <input className="ve-inline" type="number" step="0.1" value={form.speedLaden} onChange={(e) => setForm({ ...form, speedLaden: e.target.value })} placeholder={`${settings.speeds.ladenKn}`} aria-label="Speed laden (kn)" /> / <input className="ve-inline" type="number" step="0.1" value={form.speedBallast} onChange={(e) => setForm({ ...form, speedBallast: e.target.value })} placeholder={`${settings.speeds.ballastKn}`} aria-label="Speed ballast (kn)" /></span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Residual sea laden / ballast (MT/day)</span><span className="ve-info-card__v is-auto">{consCell("sea_laden", "residual")} / {consCell("sea_ballast", "residual")}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Distillate port working / idle (MT/day)</span><span className="ve-info-card__v is-auto">{consCell("port_working", "distillate")} / {consCell("port_idle", "distillate")}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Scrubber fitted</span><span className="ve-info-card__v"><select className="ve-inline ve-inline--select" value={form.hasScrubber} onChange={(e) => setForm({ ...form, hasScrubber: e.target.value as Tri })} aria-label="Scrubber fitted"><option value="unknown">unknown (none, stated)</option><option value="yes">yes</option><option value="no">no</option></select></span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Cost class</span><span className="ve-info-card__v"><select className="ve-inline ve-inline--select" value={form.vesselClass} onChange={(e) => setForm({ ...form, vesselClass: e.target.value as VesselClass | "" })} aria-label="Cost class"><option value="">— (C assumed)</option><option value="A">A × {settings.classMultipliers.A}</option><option value="B">B × {settings.classMultipliers.B}</option><option value="C">C × {settings.classMultipliers.C}</option></select></span></div>
                    <details className="ve-more">
                      <summary>Operating profile per state</summary>
                      <table className="vy-cons"><thead><tr><th>State</th><th>Residual MT/d</th><th>Distillate MT/d</th></tr></thead>
                        <tbody>{OPERATING_STATES.map((s) => <tr key={s}><td>{STATE_LABEL[s]}</td><td><input type="number" step="0.1" min="0" value={form.cons[s].residual} onChange={(e) => setForm({ ...form, cons: { ...form.cons, [s]: { ...form.cons[s], residual: e.target.value } } })} aria-label={`${STATE_LABEL[s]} residual`} /></td><td><input type="number" step="0.1" min="0" value={form.cons[s].distillate} onChange={(e) => setForm({ ...form, cons: { ...form.cons, [s]: { ...form.cons[s], distillate: e.target.value } } })} aria-label={`${STATE_LABEL[s]} distillate`} /></td></tr>)}</tbody></table>
                      <div className="vy-muted">A state without figures is not priced (it reads “unavailable”); nothing is borrowed from another state.</div>
                      <div className="vy-row2">
                        <label className="vy-field"><span>SCNT (Suez)</span><input type="number" min="0" value={form.scnt} onChange={(e) => setForm({ ...form, scnt: e.target.value })} placeholder="from certificate" /></label>
                        <label className="vy-field"><span>GT</span><input type="number" min="0" value={form.gt} onChange={(e) => setForm({ ...form, gt: e.target.value })} /></label>
                      </div>
                      {vessel.vesselId && <div className="vy-save"><button type="button" className="ve-btn" onClick={saveProfile} disabled={profileSave.busy}>{profileSave.busy ? "Saving…" : "Save profile to vessel"}</button>{profileSave.note && <div className={`ve-note-sub${profileSave.error ? " vy-error" : ""}`}>{profileSave.note}</div>}</div>}
                    </details>
                  </div>
                </div>

                <div className="ve-info-card">
                  <div className="ve-info-card__head">Cargo, from listing · {cargo.refId}</div>
                  <div className="ve-info-card__body">
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Cargo</span><span className="ve-info-card__v is-auto">{cargo.commodity}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Quantity (MT)</span><span className="ve-info-card__v is-auto">{qty.toLocaleString("en-US")}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Freight rate ($/MT)</span><span className="ve-info-card__v"><input className="ve-inline" type="number" step="0.01" min="0" value={voy.freight} onChange={(e) => setVo({ freight: e.target.value })} placeholder="—" aria-label="Freight (USD/MT)" /></span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Commission (%)</span><span className="ve-info-card__v"><input className="ve-inline" type="number" step="0.25" min="0" value={voy.commission} onChange={(e) => setVo({ commission: e.target.value })} placeholder="—" aria-label="Commission (%)" /></span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Load rate (MT/day)</span><span className={`ve-info-card__v ${cargo.loadRate != null ? "is-auto" : "is-amber"}`}>{cargo.loadRate != null ? Number(cargo.loadRate).toLocaleString("en-US") : "—"}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Discharge rate (MT/day)</span><span className={`ve-info-card__v ${cargo.dischRate != null ? "is-auto" : "is-amber"}`}>{cargo.dischRate != null ? Number(cargo.dischRate).toLocaleString("en-US") : "—"}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Loading days (auto)</span><span className="ve-info-card__v is-auto">{estimate ? fmtDays(estimate.days.portLoad) : "—"}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Discharging days (auto)</span><span className="ve-info-card__v is-auto">{estimate ? fmtDays(estimate.days.portDisch) : "—"}</span></div>
                    <div className="ve-info-card__row"><span className="ve-info-card__k">Allowance load / disch (days)</span><span className="ve-info-card__v"><input className="ve-inline" type="number" step="0.1" min="0" value={voy.loadAllowance} onChange={(e) => setVo({ loadAllowance: e.target.value })} aria-label="Load allowance (days)" /> / <input className="ve-inline" type="number" step="0.1" min="0" value={voy.dischAllowance} onChange={(e) => setVo({ dischAllowance: e.target.value })} aria-label="Disch allowance (days)" /></span></div>
                    <details className="ve-more">
                      <summary>Port time, waiting and ECA</summary>
                      <div className="vy-row2">
                        {ladenStartZones != null ? <span className="vy-leg__meta">Load port {loadInEca ? `inside ${ladenStartZones.join(", ")} ECA` : "outside every ECA"} · from the route geometry</span> : <label className="vy-check"><input type="checkbox" checked={voy.loadInEca} onChange={(e) => setVo({ loadInEca: e.target.checked })} /> Load port inside ECA (your assertion)</label>}
                        {ladenEndZones != null ? <span className="vy-leg__meta">Discharge port {dischInEca ? `inside ${ladenEndZones.join(", ")} ECA` : "outside every ECA"} · from the route geometry</span> : <label className="vy-check"><input type="checkbox" checked={voy.dischInEca} onChange={(e) => setVo({ dischInEca: e.target.checked })} /> Discharge port inside ECA (your assertion)</label>}
                      </div>
                      {form.hasScrubber === "yes" && (
                        <>
                          <div className="vy-row2">
                            <label className="vy-check"><input type="checkbox" checked={voy.loadOpenLoopBan} onChange={(e) => setVo({ loadOpenLoopBan: e.target.checked })} /> Load port bans open-loop washwater</label>
                            <label className="vy-check"><input type="checkbox" checked={voy.dischOpenLoopBan} onChange={(e) => setVo({ dischOpenLoopBan: e.target.checked })} /> Discharge port bans open-loop washwater</label>
                          </div>
                          <div className="vy-row2">
                            <label className="vy-check"><input type="checkbox" checked={voy.loadEuBerth} onChange={(e) => setVo({ loadEuBerth: e.target.checked })} /> EU berth &gt; 2 h at load</label>
                            <label className="vy-check"><input type="checkbox" checked={voy.dischEuBerth} onChange={(e) => setVo({ dischEuBerth: e.target.checked })} /> EU berth &gt; 2 h at discharge</label>
                          </div>
                        </>
                      )}
                      <div className="vy-row2">
                        <label className="vy-field"><span>Waiting at anchorage (days)</span><input type="number" step="0.5" min="0" value={voy.anchorageDays} onChange={(e) => setVo({ anchorageDays: e.target.value })} /></label>
                        <label className="vy-check"><input type="checkbox" checked={voy.anchorageInEca} onChange={(e) => setVo({ anchorageInEca: e.target.checked })} /> Anchorage inside ECA</label>
                      </div>
                      {ownerOrgs.length > 1 && (
                        <label className="vy-field"><span>Estimate owned by</span><select value={ownerOrgId} onChange={(e) => setOwnerOrgId(e.target.value)}><option value="">— choose the organisation —</option>{ownerOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                      )}
                    </details>
                  </div>
                </div>

                <div className="ve-legs">
                  <table className="ve-table">
                    <thead><tr><th>Leg</th><th>From → To</th><th className="num">NM</th><th className="num">ECA NM</th><th className="num">Days</th><th className="num">Fuel (MT)</th></tr></thead>
                    <tbody>
                      {(estimate?.legs ?? []).map((l, i) => (
                        <tr key={l.key} className={l.status === "unavailable" ? "is-disabled" : ""}>
                          <td><strong>{i + 1}</strong>, {l.label}{l.status !== "trusted" && <span className={`vy-badge vy-badge--${BADGE[l.status]}`}>{l.status}</span>}</td>
                          <td>{l.from ?? "—"}{l.to && l.to !== l.from ? <span className="ve-table__to"> → {l.to}</span> : ""}</td>
                          <td className={`num ${l.nm != null ? "is-auto" : ""}`}>{l.kind === "sea" || l.kind === "canal" ? fmtNM(l.nm) : "—"}</td>
                          <td className={`num ${l.kind === "sea" && l.ecaNm == null ? "is-amber" : "is-auto"}`}>{l.kind === "sea" ? (l.ecaNm != null ? fmtNM(l.ecaNm) : "unknown") : "—"}</td>
                          <td className="num is-auto">{fmtDays(l.days)}{legArea(l.kind) ? assumed(legArea(l.kind)!) : null}</td>
                          <td className="num is-auto" title={l.burns.map((b) => `${b.productKey} ${fmtMT(b.mt)}`).join(" · ")}>{l.burns.length ? fmtMT(l.burns.reduce((a, b) => a + b.mt, 0)) : "—"}</td>
                        </tr>
                      ))}
                      {estimate && (
                        <tr className="ve-table__total"><td colSpan={2}><strong>Totals</strong></td><td className="num"><strong>{fmtNM(estimate.legs.reduce((a, l) => a + (l.kind === "sea" || l.kind === "canal" ? l.nm ?? 0 : 0), 0))}</strong></td><td className="num"><strong>{estimate.legs.some((l) => l.kind === "sea" && l.ecaNm == null) ? "—" : fmtNM(estimate.legs.reduce((a, l) => a + (l.kind === "sea" ? l.ecaNm ?? 0 : 0), 0))}</strong></td><td className="num"><strong>{fmtDays(estimate.days.total)}</strong></td><td className="num"><strong>{fmtMT(estimate.fuel.totalMt)}</strong></td></tr>
                      )}
                    </tbody>
                  </table>
                  <details className="ve-more ve-more--card" open={legsOpen || undefined}>
                    <summary>Route, sea margin and canal{legsNeedAttention ? <span className="vy-badge vy-badge--fallback">check</span> : null}</summary>
                    <LegEditor title="Ballast" from={openCode} to={polCode} leg={ballast} auto={ballastAuto} loading={ballastLoading} onChange={setBallast} hidden={!openCode || openCode === polCode} />
                    <LegEditor title="Laden" from={polCode} to={podCode} leg={laden} auto={ladenAuto} loading={ladenLoading} onChange={setLaden} />
                    <div className="vy-row2">
                      <label className="vy-field"><span>Sea margin (%){assumed("seaMargin")}</span><input type="number" step="0.5" min="0" value={voy.seaMargin} onChange={(e) => setVo({ seaMargin: e.target.value })} placeholder={estimate ? `${estimate.seaMarginPct} (${estimate.seaMarginBasis})` : "settings"} /></label>
                      {measured(laden, ladenAuto, polCode, podCode)
                        ? <div className="vy-field"><span>Suez transit</span><div className="vy-leg__meta">{ladenSuez ? "required" : "not required"} · from the measured route{ballastSuez ? " · ballast leg transits too" : ""}</div></div>
                        : <label className="vy-field"><span>Suez transit (manual leg: your assertion)</span><select value={voy.suezOverride} onChange={(e) => setVo({ suezOverride: e.target.value as "auto" | "yes" | "no" })}><option value="auto">By zones ({cargo && needsSuez(cargo.route.polZone, cargo.route.podZone) ? "required" : "not required"})</option><option value="yes">Required</option><option value="no">Not required</option></select></label>}
                    </div>
                    {suezRequired && (
                      <div className="vy-leg__meta">
                        {(ladenSuez ? ctxByDate[ladenDate] : ctxByDate[ballastDate])?.found === false ? <span className="vy-error">No published Suez tariff for {ladenSuez ? ladenDate : ballastDate}: the canal cost is unavailable unless you enter it below.</span>
                          : !suezCategory ? <span className="vy-error">SCA vessel category unknown for this vessel type: set it on the Suez calculator; the canal cost is unavailable.</span>
                          : suezEstimate ? <>Suez: {canal?.complete ? <b>{fmtUSD(canal.costUsd)}</b> : <span className="vy-error">unavailable</span>} <span className={`vy-badge vy-badge--${canal ? BADGE[canal.status] : "missing"}`}>{canal?.status}</span> · {suezEstimate.direction} · {suezEstimate.cargoStatus} · transit {suezEstimate.transitDate} · tariff v{suezEstimate.tariffVersion.versionNo} · {suezEstimate.transitDays} + {suezEstimate.anchorageDays} days{canal?.anchorageInEcaSource === "governed" ? ` · anchorage ${canal.anchorageInEca ? "inside" : "outside"} ECA` : ""} · <Link href={`/dashboard/suez-toll?vessel=${vesselId}`} className="sz-link">details →</Link>{!canal?.complete && suezEstimate.unavailable[0] ? <div className="vy-error">{suezEstimate.unavailable[0].reason}</div> : null}</> : null}
                        {ladenSuez && !measured(laden, ladenAuto, polCode, podCode) && (
                          <label className="vy-field"><span>Suez direction (your assertion for a manual leg)</span>
                            <select value={voy.manualSuezDir} onChange={(e) => setVo({ manualSuezDir: e.target.value as "" | "SB" | "NB" })} data-testid="manual-suez-dir">
                              <option value="">Not stated: canal not priced</option><option value="SB">Southbound</option><option value="NB">Northbound</option>
                            </select>
                          </label>
                        )}
                        {suezRequired && (ladenSuez ? !ladenDir : !ballastDir) && <div className="vy-error">The Suez transit direction is not known for this track: the canal is not priced.</div>}
                        <div className="vy-row2">
                          <label className="vy-check" title="Without this declaration the canal figure is the broker's (manual): omitted conditions are never assumed absent">
                            <input type="checkbox" checked={voy.suezConditionsDeclared} onChange={(e) => setVo({ suezConditionsDeclared: e.target.checked })} data-testid="suez-conditions-declared" />
                            I declare no special Suez conditions (no heavy lift over 250 t, military cargo, floating unit, late arrival, deck protrusion, non-compliant ladder, relieving pilots, waste or barge services)
                          </label>
                          <label className="vy-field"><span>Arrival draft (ft, this voyage)</span><input type="number" min="0" step="0.1" value={voy.arrivalDraftFt} onChange={(e) => setVo({ arrivalDraftFt: e.target.value })} placeholder="decides escort tugs" /></label>
                        </div>
                        {canal && !canal.complete && (
                          <div className="vy-row2">
                            <label className="vy-field"><span>Canal cost (manual, USD)</span><input type="number" min="0" value={voy.canalManualUsd} onChange={(e) => setVo({ canalManualUsd: e.target.value })} placeholder="agent proforma" /></label>
                            <label className="vy-field"><span>Reason · canal cost</span><input value={voy.canalManualReason} onChange={(e) => setVo({ canalManualReason: e.target.value })} placeholder="e.g. agent proforma 5 Oct" /></label>
                          </div>
                        )}
                        {ballastCanal && !ballastCanal.complete && (
                          <div className="vy-row2">
                            <label className="vy-field"><span>Ballast canal cost (manual, USD)</span><input type="number" min="0" value={voy.ballastCanalManualUsd} onChange={(e) => setVo({ ballastCanalManualUsd: e.target.value })} /></label>
                            <label className="vy-field"><span>Reason · ballast canal cost</span><input value={voy.ballastCanalManualReason} onChange={(e) => setVo({ ballastCanalManualReason: e.target.value })} /></label>
                          </div>
                        )}
                      </div>
                    )}
                  </details>
                </div>
              </div>

              {/* Expenses + revenue */}
              <div className="ve-pl-grid">
                <div className="ve-pl-card">
                  <div className="ve-pl-card__title">Voyage Expenses</div>
                  <div className="ve-pl-split">
                    <div>
                      <div className="ve-pl-section">Bunker costs <span className="sz-muted">· {fuelUsd != null && c ? c.fuel.status : "not priced"}</span></div>
                      {(estimate?.fuel.lines ?? []).map((f) => <div key={f.productKey} className="ve-pl-row"><span>{f.productKey}<small className="sz-muted">{f.status === "trusted" ? `Fuel Bar average${f.pricePort ? ` @ ${f.pricePort}` : ""}${f.priceAsOf ? ` · ${f.priceAsOf}` : ""}` : f.status === "fallback" ? "admin fallback price — no live index for this product" : "unavailable — not in the total"}</small></span><span className={f.status === "trusted" ? "is-auto" : f.status === "fallback" ? "is-fallback" : "is-unavailable"}>{fmtMT(f.mt)} MT × {f.usdMt != null ? `$${f.usdMt}` : "—"} = {fmtUSD(f.usd)}</span></div>)}
                      <div className="ve-pl-row is-subtotal"><span>Total bunker cost</span><span className={fuelUsd == null ? "is-unavailable" : ""}>{fuelUsd == null ? "not priced" : fmtUSD(fuelUsd)}</span></div>
                      {estimate && <div className="ve-pl-row"><span className="sz-muted">Residual · ECA · auxiliary</span><span className="sz-muted">{estimate.fuel.residualProduct} · {estimate.fuel.ecaProduct} · {estimate.fuel.distillateProduct}</span></div>}
                    </div>
                    <div>
                      <div className="ve-pl-section">Port disbursements</div>
                      <div className="ve-pl-row ve-pl-row--linked"><span>POL PDA, {cargo.route.polName || polCode}<small className="ve-linked-src">{voy.pdaLoadEstimate ? "from a saved Ports Cost estimate" : "manual agent figure"}</small></span>{c ? pdaMoney(c.pdaLoad, "not entered — unavailable") : <span>—</span>}</div>
                      <div className="ve-pl-inputs">
                        <PdaPicker label="Saved PDA · load" options={pdaOptions.load} value={voy.pdaLoadEstimate} onChange={(id) => setVo({ pdaLoadEstimate: id })} />
                        <label className="vy-field"><span>or manual (USD)</span><input type="number" min="0" value={voy.pdaLoadEstimate ? "" : voy.pdaLoad} disabled={!!voy.pdaLoadEstimate} onChange={(e) => setVo({ pdaLoad: e.target.value })} placeholder={voy.pdaLoadEstimate ? "from the PDA estimate" : "not entered → unavailable"} aria-label="Load port DA (USD, manual)" /></label>
                        {voy.pdaLoad.trim() !== "" && !voy.pdaLoadEstimate && <label className="vy-field vy-field--wide"><span>Reason · load DA</span><input value={voy.pdaLoadReason} onChange={(e) => setVo({ pdaLoadReason: e.target.value })} placeholder="e.g. agent proforma 3 Oct" aria-label="Load DA reason" /></label>}
                      </div>
                      <div className="ve-pl-row"><span>POD PDA, {cargo.route.podName || podCode}<small className="ve-linked-src">{voy.pdaDischEstimate ? "from a saved Ports Cost estimate" : "manual agent figure"}</small></span>{c ? pdaMoney(c.pdaDisch, "not entered — unavailable") : <span>—</span>}</div>
                      <div className="ve-pl-inputs">
                        <PdaPicker label="Saved PDA · discharge" options={pdaOptions.disch} value={voy.pdaDischEstimate} onChange={(id) => setVo({ pdaDischEstimate: id })} />
                        <label className="vy-field"><span>or manual (USD)</span><input type="number" min="0" value={voy.pdaDischEstimate ? "" : voy.pdaDisch} disabled={!!voy.pdaDischEstimate} onChange={(e) => setVo({ pdaDisch: e.target.value })} placeholder={voy.pdaDischEstimate ? "from the PDA estimate" : "not entered → unavailable"} aria-label="Disch port DA (USD, manual)" /></label>
                        {voy.pdaDisch.trim() !== "" && !voy.pdaDischEstimate && <label className="vy-field vy-field--wide"><span>Reason · disch DA</span><input value={voy.pdaDischReason} onChange={(e) => setVo({ pdaDischReason: e.target.value })} placeholder="e.g. Ports DA calculator figure" aria-label="Discharge DA reason" /></label>}
                      </div>
                      <div className="ve-pl-row ve-pl-row--linked"><span>Suez Canal transit{suezRequired && <small className="ve-linked-src">from Suez Canal Toll</small>}</span>{c ? (c.canal.required ? pdaMoney(c.canal, "unavailable") : <span className="is-muted">Not applicable</span>) : <span>—</span>}</div>
                      <div className="vy-muted">Choose a saved Ports Cost estimate per port (a published tariff reads trusted, a partial one fallback), or enter an agent quote with its reason (labelled manual). <Link href={portsDaHref} className="sz-link">Ports Cost Estimator →</Link></div>

                      <div className="ve-pl-section">Other</div>
                      <div className="ve-pl-row"><span>Insurance / war risk</span><input className="ve-inline" type="number" min="0" value={voy.insurance} onChange={(e) => setVo({ insurance: e.target.value })} placeholder="0" aria-label="Insurance (USD)" /></div>
                      <div className="ve-pl-row"><span>Stevedoring</span><input className="ve-inline" type="number" min="0" value={voy.stevedoring} onChange={(e) => setVo({ stevedoring: e.target.value })} placeholder="0" aria-label="Stevedoring (USD)" /></div>
                      <div className="ve-pl-row"><span>Other</span><input className="ve-inline" type="number" min="0" value={voy.other} onChange={(e) => setVo({ other: e.target.value })} placeholder="0" aria-label="Other (USD)" /></div>
                    </div>
                  </div>
                  <div className="ve-pl-row is-grand"><span>GROSS VOYAGE EXPENSES{c && !c.complete ? <small className="is-unavailable"> computable parts</small> : null}</span><span className={knownUsd(c?.voyageCostsUsd) == null ? "is-unavailable" : ""}>{knownUsd(c?.voyageCostsUsd) == null ? "not computable" : fmtUSD(c?.voyageCostsUsd)}</span></div>
                  {estimate && c && <div className="ve-pl-row ve-pl-row--linked"><span>Running cost{assumed("running")}<small className="sz-muted">crew ${settings.opex.crewUsdDay} + maintenance ${settings.opex.maintenanceUsdDay} = ${estimate.opex.baseUsdDay}/day × class {estimate.opex.vesselClass} ({estimate.opex.multiplier}) × {fmtDays(estimate.days.total)} days</small></span><span>{fmtUSD(c.opexUsd)}</span></div>}
                  <div className="ve-pl-row is-subtotal"><span>Total voyage cost incl. running cost</span><span>{fmtUSD(c?.totalUsd)}{c && !c.complete ? <small className="is-unavailable"> incomplete</small> : null}</span></div>
                </div>

                <div className="ve-pl-card">
                  <div className="ve-pl-card__title">Revenue</div>
                  {estimate?.revenue ? (
                    <>
                      <div className="ve-pl-row"><span>Cargo qty × Freight rate</span><span className="is-auto">{qty.toLocaleString("en-US")} MT × ${voy.freight} = {fmtUSD(estimate.revenue.grossFreightUsd)}</span></div>
                      <div className="ve-pl-row"><span>Less: commission ({voy.commission || 0}%)</span><span className="is-auto">−{fmtUSD(estimate.revenue.commissionUsd)}</span></div>
                      <div className="ve-pl-row is-grand"><span>NET FREIGHT</span><span>{fmtUSD(estimate.revenue.netFreightUsd)}</span></div>
                      <div className="ve-spacer" />
                      <div className="ve-pl-section">Quick analysis</div>
                      <div className="ve-pl-row"><span>TCE (net − voyage costs) ÷ days</span><span className="is-auto">{fmtUSD(estimate.revenue.tceUsdDay)} / day</span></div>
                      <div className="ve-pl-row"><span>Net per voyage day</span><span className="is-auto">{estimate.days.total > 0 ? fmtUSD(estimate.revenue.netFreightUsd / estimate.days.total) : "—"}</span></div>
                      <div className="ve-pl-row"><span>Bunker share of expenses</span><span className="is-auto">{pct(fuelUsd, c?.voyageCostsUsd)}</span></div>
                      <div className="ve-pl-row"><span>PDA share of expenses</span><span className="is-auto">{c && c.pdaLoad.usd != null && c.pdaDisch.usd != null ? pct(c.pdaLoad.usd + c.pdaDisch.usd, c.voyageCostsUsd) : "—"}</span></div>
                      <div className="ve-pl-row is-subtotal"><span>Result after running cost</span><span className={estimate.revenue.resultAfterOpexUsd >= 0 ? "is-auto" : "is-amber"}>{fmtUSD(estimate.revenue.resultAfterOpexUsd)}</span></div>
                    </>
                  ) : <div className="ve-pl-row"><span className="is-unavailable">Enter a freight rate on the cargo card to see the revenue and TCE.</span><span>—</span></div>}
                </div>
              </div>

              {estimate && (estimate.assumptions.length > 0 || estimate.warnings.length > 0) && (
                <div className="vy-notes">
                  {estimate.warnings.length > 0 && <><h4>Warnings</h4><ul className="is-warn">{estimate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
                  {estimate.assumptions.length > 0 && <><h4>Assumptions</h4><ul>{estimate.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
                </div>
              )}
              <div className="ve-econ__foot">
                <span>Green is retrieved from governed data. Blue underline is editable for this estimate. Amber is a fallback, manual or missing figure, never added silently.</span>
                <span>Estimate only · {estimate?.algorithmVersion ?? "voyage engine"} · settings {estimate?.settingsSource ?? settingsSource}. Saved estimates are recomputed on the server from governed data and stored immutably with their snapshots.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fetchLeg(from: string | null, to: string | null, set: React.Dispatch<React.SetStateAction<LegState>>, asOf: string, gate: RequestGate) {
  const ticket = gate.next();   // any older response in flight is now stale
  const key = legLookupKey(from, to, asOf);
  if (!key) { set((l) => ({ ...l, auto: null, loading: false, loadingFor: null })); return; }
  set((l) => ({ ...l, auto: null, loading: true, loadingFor: key }));   // the previous route never prices the new request
  const settle = (result: RouteLegResult) => {
    if (!gate.isCurrent(ticket)) return;
    set((l) => ({ ...l, loading: false, loadingFor: null, auto: bindLegResult(key, result) }));
  };
  void routeLegAction(key.from, key.to, key.asOf).then(
    (r) => settle(r.ok ? r.data : NO_ROUTE),
    () => settle(NO_ROUTE),
  );
}

function LegEditor({ title, from, to, leg, auto, loading, onChange, hidden }: { title: string; from: string | null; to: string | null; leg: LegState; auto: RouteLegResult | null; loading: boolean; onChange: React.Dispatch<React.SetStateAction<LegState>>; hidden?: boolean }) {
  if (hidden) return null;
  const rebound = rebindManualLeg(leg, from, to);
  const endpoints = rebound?.manualFor ?? null;
  const manualFactsCurrent = matchesLegEndpoints(leg.manualFor, from, to);
  const manualSelected = leg.useManual && manualFactsCurrent;
  const updateManual = (patch: Partial<Pick<LegState, "manualNm" | "manualEcaNm" | "manualReason">>) => {
    onChange((current) => {
      const currentForEndpoints = rebindManualLeg(current, from, to);
      return currentForEndpoints ? { ...currentForEndpoints, ...patch, useManual: true } : current;
    });
  };
  return (
    <div className="vy-leg">
      <div className="vy-leg__title"><span>{title} · {from ?? "?"} → {to ?? "?"}</span>
        {loading ? <span className="vy-badge vy-badge--fallback">looking up</span> : manualSelected ? <span className="vy-badge vy-badge--manual">manual</span> : auto?.found ? <span className={`vy-badge ${auto.method === "waypoints" ? "vy-badge--trusted" : "vy-badge--fallback"}`}>{auto.method === "waypoints" ? "measured + ECA split" : "measured · ECA share unknown"}</span> : <span className="vy-badge vy-badge--missing">no route</span>}
      </div>
      {!manualSelected && auto?.found && <div className="vy-leg__meta">{fmtNM(auto.nm)} NM{auto.method === "waypoints" && auto.ecaNm != null ? ` · ${fmtNM(auto.ecaNm)} NM in ECA` : " · ECA share unknown (priced as non-ECA, flagged)"}{auto.chokepoints.length ? ` · via ${auto.chokepoints.join(", ")}` : ""}{auto.reversed ? " · reversed track" : ""}{auto.geometryVersions.length ? ` · zones ${auto.geometryVersions.map((g) => `${g.code}@${g.geometryVersion}`).join(", ")}` : ""}</div>}
      {!manualSelected && auto && !auto.found && <div className="vy-leg__meta vy-error">No measured route for this pair: the leg is unavailable until a manual distance (with its reason) is entered.</div>}
      <div className="vy-row3">
        <label className="vy-check"><input type="checkbox" checked={manualSelected} disabled={!endpoints} onChange={(e) => { const checked = e.target.checked; onChange((current) => { if (!checked) return { ...current, useManual: false }; const currentForEndpoints = rebindManualLeg(current, from, to); return currentForEndpoints ? { ...currentForEndpoints, useManual: true } : current; }); }} /> Manual</label>
        <label className="vy-field"><span>NM</span><input type="number" min="0" value={manualFactsCurrent ? leg.manualNm : ""} onChange={(e) => updateManual({ manualNm: e.target.value })} disabled={!manualSelected} aria-label="NM" /></label>
        <label className="vy-field"><span>of which ECA NM</span><input type="number" min="0" value={manualFactsCurrent ? leg.manualEcaNm : ""} onChange={(e) => updateManual({ manualEcaNm: e.target.value })} disabled={!manualSelected} aria-label="of which ECA NM" /></label>
      </div>
      {manualSelected && <label className="vy-field vy-reason"><span>Reason for the manual distance</span><input value={leg.manualReason} onChange={(e) => updateManual({ manualReason: e.target.value })} placeholder="e.g. owner's distance table, 3 Oct" aria-label="Reason" /></label>}
    </div>
  );
}

function statusSummary(e: VoyageEstimate): string {
  if (e.status === "invalid") return `Invalid input: ${(e.errors ?? []).slice(0, 3).join("; ")}${(e.errors?.length ?? 0) > 3 ? " …" : ""}`;
  if (e.status === "trusted") return "Trusted: every input is governed — measured, verified route with an official ECA split, the vessel's economics profile, index prices and a trusted canal estimate; no broker figure or assumption.";
  const parts: string[] = [];
  if (e.unavailable.length) parts.push(`${e.unavailable.length} part${e.unavailable.length > 1 ? "s" : ""} unavailable (excluded from the total)`);
  if (e.fuel.status === "fallback") parts.push("fuel at admin fallback prices");
  if (e.legs.some((l) => l.status === "manual") || e.costs.pdaLoad.status === "manual" || e.costs.pdaDisch.status === "manual" || e.costs.canal.status === "manual") parts.push("manual figures (labelled)");
  if (e.legs.some((l) => l.status === "fallback")) parts.push("ECA share unknown on a leg");
  if (e.settingsSource === "defaults") parts.push("compiled default constants");
  if (e.assumptions.some((a) => a.includes("Scrubber"))) parts.push("scrubber status unknown");
  return (e.status === "unavailable" ? "The voyage cannot be priced: " : "Priced with gaps: ") + (parts.join(" · ") || "see the notes");
}

// The "platform assumption" badge on every figure that rests on an unconfirmed constant (B2O-020 P2): one or several
// areas — a total that rests on sea, port and canal time names every constant behind it (B2O-028).
function assumedBadge(estimate: VoyageEstimate, areas: AssumptionArea[]) {
  const used = areas.flatMap((a) => assumptionsFor(a, estimate.platformAssumptions)).filter((u, i, all) => all.findIndex((x) => x.key === u.key) === i);
  return used.length ? <span className="vy-badge vy-badge--fallback" title={`Platform assumption, not yet confirmed by the owner: ${used.map((u) => u.label).join("; ")}`}>platform assumption</span> : null;
}

/** A cost that may be governed, fallback, manual or missing — never shown as zero when unknown. */
function pdaMoney(v: { usd: number | null; status: ComponentStatus }, missingText: string) {
  return v.usd == null
    ? <span className="is-unavailable">{missingText}</span>
    : <span className={v.status === "trusted" ? "is-auto" : v.status === "manual" ? "is-manual" : "is-fallback"}>{fmtUSD2(v.usd)}{v.status !== "trusted" ? ` · ${v.status}` : ""}</span>;
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

/** A saved PDA estimate for one port; estimates without a USD total cannot be used and are shown disabled. */
function PdaPicker({ label, options, value, onChange }: { label: string; options: VoyagePdaEstimateOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="vy-field"><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0} aria-label={label}>
        <option value="">{options.length ? "— none, enter manually —" : "no saved estimate for this port"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.usdTotal == null}>
            {`${o.callDate ?? "no call date"} · ${o.terminalName ?? "port"} · ${o.usdTotal == null ? `${o.currency} only` : fmtUSD(Number(o.usdTotal))} · ${o.coverage === "published" ? "published tariff" : o.coverage === "partial" ? "partial tariff" : "manual"}`}
          </option>
        ))}
      </select>
    </label>
  );
}
