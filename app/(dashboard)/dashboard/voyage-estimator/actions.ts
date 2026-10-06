"use server";

// Voyage estimator — member-session reads and the save (Voyage Economics, Stream S).
//
// Every action passes the calculator entitlement first (one guard for pages and
// actions, audit C2O-039 P0-4). The save recomputes everything on the server
// from governed truth (C2O-039 P0-3, C2O-043, Opus B PR-03):
//   · each sea leg is re-resolved from its UN/LOCODEs through get_port_route +
//     fn_route_eca_split (verified flag kept; an unverified track is fallback);
//     a browser distance survives only as a stamped manual value;
//   · whether the leg transits Suez, the direction, the canal miles inside the
//     track and the ports' ECA status come from the resolved route; the browser's
//     word counts only for a manual leg, as a stamped assertion (partial);
//   · each transit (laden and ballast) is priced on its own transit date and
//     cargo status; Suez day overrides survive only as stamped manual values;
//   · the canal anchorage's ECA status is the settings anchorage point tested
//     against the governed zones;
//   · a linked listing/position whose ports disagree with the estimate is saved
//     unlinked (never an authorised id beside another object's economics);
//   · vessel facts that differ from the vessel's economics profile are manual;
//   · a port DA is a stamped manual figure until the PDA link exists.

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPortRoute } from "@/sdk/app/routes";
import { getPointEcaZones, getRouteEcaSplit, getSuezTariffContext, getVesselEconomicsProfile, listEcaZones, type VesselEconomicsProfile } from "@/sdk/app/suez";
import { getVoyageLinkFacts, getVoyageSettings, saveVoyageEstimate } from "@/sdk/app/voyage";
import { estimateVoyage } from "@/lib/voyage/engine";
import { parseVoyageInput } from "@/lib/voyage/schemas";
import { loadFuelIndex, voyageFuelProducts } from "@/lib/voyage/fuel-source";
import { canalDirection, canalFromSuez, downgradeCanalForFacts, suezTransitDate } from "@/lib/voyage/canal";
import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
import { reconcileLinks, suezFactReasons } from "@/lib/voyage/save-rules";
import { pdaFromEstimate } from "@/lib/voyage/pda-link";
import { calculatorDenialMessage } from "@/lib/voyage/calculator-policy";
import { estimateSuezTransit } from "@/lib/suez/engine";
import { SUEZ_ALGORITHM_VERSION, type SuezEstimate, type SuezInput } from "@/lib/suez/types";
import { ECA_SPLIT_ALGORITHM_VERSION, VOYAGE_ALGORITHM_VERSION, canonicalJson, hashSettings, sealSnapshot, type ManualProvenance, type PortCostSnapshot, type RouteEcaClassification, type SuezCostSnapshot } from "@/lib/voyage/snapshots";
import type { CanalInput, ConsumptionMap, SeaLegInput, VoyageInput, VoyageSettings } from "@/lib/voyage/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Manual values inside the immutable snapshots name the run's own actor column instead of a user id: deleting the
// user clears voyage_estimate_runs.actor_user_id, and no personal identifier survives inside the JSON (C2O-044 #11).
const ACTOR_REF = "run-actor";

export interface RouteLegResult {
  found: boolean;
  nm: number | null;
  ecaNm: number | null; // null = share unknown (distance-only route)
  chokepoints: string[];
  method: "waypoints" | "distance_only" | "none";
  source: string | null;
  reversed: boolean;
  verified: boolean;
  /** coarse when an ECA ring in force is a coarse digitisation */
  geometryConfidence: "official" | "coarse";
  /** ECA zones containing the start / end of the track (the ports), null = unknown */
  startZones: string[] | null;
  endZones: string[] | null;
  /** for a track through Suez: SB when it runs north → south */
  suezDirection: "SB" | "NB" | null;
  asOf: string | null;
  geometryVersions: { code: string; geometryVersion: string }[];
  algorithmVersion: string | null;
}

const NO_ROUTE: RouteLegResult = { found: false, nm: null, ecaNm: null, chokepoints: [], method: "none", source: null, reversed: false, verified: false, geometryConfidence: "coarse", startZones: null, endZones: null, suezDirection: null, asOf: null, geometryVersions: [], algorithmVersion: null };

async function lookupLeg(supabase: SupabaseClient, a: string, b: string, asOf?: string): Promise<RouteLegResult> {
  const [route, split] = await Promise.all([getPortRoute(supabase, a, b), getRouteEcaSplit(supabase, a, b, asOf)]);
  if (!route) return { ...NO_ROUTE, asOf: split.asOf ?? null };
  const waypoints = split.found && split.method === "waypoints";
  const wp = route.waypoints;
  const suez = route.chokepoints.includes("SUEZ");
  return {
    found: true,
    nm: route.totalNm,
    ecaNm: waypoints ? (split.ecaNm ?? null) : null,
    chokepoints: route.chokepoints ?? [],
    method: waypoints ? "waypoints" : "distance_only",
    source: route.source,
    reversed: route.reversed,
    verified: route.verified,
    geometryConfidence: split.geometryConfidence === "official" ? "official" : "coarse",
    startZones: waypoints ? (split.startZones ?? null) : null,
    endZones: waypoints ? (split.endZones ?? null) : null,
    suezDirection: suez ? canalDirection(wp) : null,
    asOf: split.asOf ?? null,
    geometryVersions: split.geometryVersions ?? [],
    algorithmVersion: split.algorithmVersion ?? null,
  };
}

// Measured distance and its ECA share for one leg, both through the member session.
export async function routeLegAction(pol: string, pod: string, asOf?: string): Promise<ActionResult<RouteLegResult>> {
  const a = (pol ?? "").trim().toUpperCase();
  const b = (pod ?? "").trim().toUpperCase();
  if (!LOCODE.test(a) || !LOCODE.test(b)) return { ok: false, error: "Both ports need a UN/LOCODE." };
  if (asOf != null && !ISO_DATE.test(asOf)) return { ok: false, error: "The as-of date must be YYYY-MM-DD." };
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    return { ok: true, data: await lookupLeg(supabase, a, b, asOf) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Route lookup failed." };
  }
}

export interface VoyagePdaEstimateOption { id: string; callDate: string | null; coverage: string; terminalName: string | null; usdTotal: number | null; currency: string; generatedAt: string }
/** The member's own current PDA estimates for one port (the port DA picker), through the governed member RPC. */
export async function listVoyagePdaEstimatesAction(port: string): Promise<ActionResult<VoyagePdaEstimateOption[]>> {
  const p = (port ?? "").trim().toUpperCase();
  if (!LOCODE.test(p)) return { ok: false, error: "The port needs a UN/LOCODE." };
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    const { data, error } = await supabase.rpc("list_voyage_pda_estimates", { p_port_locode: p });
    if (error) return { ok: false, error: "Saved PDA estimates are not available right now." };
    return { ok: true, data: (Array.isArray(data) ? data : []) as VoyagePdaEstimateOption[] };
  } catch {
    return { ok: false, error: "Saved PDA estimates are not available right now." };
  }
}

export interface SaveVoyagePayload {
  label: string | null;
  vesselId: string | null;
  availabilityId: string | null;
  cargoListingId: string | null;
  /** the organisation that owns the estimate; required when the member holds several seats */
  ownerOrgId?: string | null;
  /** the plan's start (the cargo's laycan, ISO date); transit dates are derived from it */
  startDate?: string | null;
  /** the member's facts; legs, settings, fuel, canal, Suez and actor are re-sourced on the server */
  input: VoyageInput;
  /** the Suez vessel facts (SCNT, GT, category, flags); voyage facts and dates are set here */
  suezInput: SuezInput | null;
  /** the broker declares that no special Suez condition applies (no heavy lift, military cargo, late arrival, protrusion,
   *  non-compliant ladder, relieving pilots, waste or barge services); without it the canal cost is the broker's figure */
  suezConditionsDeclared?: boolean;
  /** broker canal cost per transit, used only when that Suez estimate is incomplete */
  canalManual?: { laden?: { usd: number; reason: string } | null; ballast?: { usd: number; reason: string } | null } | null;
}

type RouteLegSnap = RouteEcaClassification["legs"][number];
type ResolvedLeg = { leg: SeaLegInput; snap: RouteLegSnap; route: RouteLegResult | null };

const sameFacts = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const consumptionOf = (c: ConsumptionMap | Record<string, { residual?: number | null; distillate?: number | null }> | undefined) => {
  const out: Record<string, { residual: number | null; distillate: number | null }> = {};
  for (const [k, v] of Object.entries(c ?? {})) {
    const r = v?.residual ?? null, d = v?.distillate ?? null;
    if (r != null || d != null) out[k] = { residual: r == null ? null : Number(r), distillate: d == null ? null : Number(d) };
  }
  return out;
};

export async function saveVoyageEstimateAction(payload: SaveVoyagePayload): Promise<ActionResult<{ id: string; status: string; warnings: string[] }>> {
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    const actorId = access.actorId;
    const admin = getSupabaseAdminClient();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const stamp = (m: ManualProvenance | undefined): ManualProvenance | undefined => (m ? { actorUserId: ACTOR_REF, reason: String(m.reason ?? "").trim(), at: now } : undefined);
    const client = payload?.input;
    if (!client || typeof client !== "object" || !client.legs || !client.ports) return { ok: false, error: "The estimate input is missing." };
    const notes: string[] = [];

    // ── server truth: settings, fuel index ────────────────────────────────
    const settingsLoad = await getVoyageSettings(supabase);
    const settings: VoyageSettings = settingsLoad.settings;

    // ── links first: an id is accepted only beside its own facts; an inconsistency is refused, never dropped (C2O-050 #2) ──
    const clientFrom = typeof client.legs.laden?.from === "string" && LOCODE.test(client.legs.laden.from) ? client.legs.laden.from : null;
    const clientTo = typeof client.legs.laden?.to === "string" && LOCODE.test(client.legs.laden.to) ? client.legs.laden.to : null;
    const clientOpen = typeof client.legs.ballast?.from === "string" && LOCODE.test(client.legs.ballast.from) ? client.legs.ballast.from : clientFrom;
    // a link id that is present but not a UUID is refused, never dropped (C2O-058 #9)
    const linkId = (v: unknown, what: string): { id: string | null; bad: boolean } =>
      v == null || v === "" ? { id: null, bad: false } : typeof v === "string" && UUID.test(v) ? { id: v, bad: false } : { id: null, bad: (notes.push(what), true) };
    const vIn = linkId(payload.vesselId, "vessel"), aIn = linkId(payload.availabilityId, "position"), cIn = linkId(payload.cargoListingId, "cargo");
    if (vIn.bad || aIn.bad || cIn.bad) return { ok: false, error: "A linked id is malformed; reload the page and link again." };
    const vesselIdIn = vIn.id, availabilityId = aIn.id, cargoListingId = cIn.id;
    // authorised through the member's own session before anything is read (C2O-058 #7): one generic refusal
    let linkFacts;
    try { linkFacts = await getVoyageLinkFacts(supabase, cargoListingId, availabilityId); }
    catch { return { ok: false, error: "A linked listing is not available to you; remove the link to save." }; }
    if (vesselIdIn && !(await supabase.rpc("get_vessel_economics_profile", { p_vessel_id: vesselIdIn })).data?.allowed) {
      return { ok: false, error: "The linked vessel is not available to you; remove the link to save." };
    }
    const fc = linkFacts.cargo, fp = linkFacts.position;
    const cargoRow = fc ? { load_port_locode: fc.loadPort, disch_port_locode: fc.dischPort, laycan_from: fc.laycanFrom, load_rate: fc.loadRate, disch_rate: fc.dischRate, qty_min_mt: fc.qtyMin, qty_max_mt: fc.qtyMax } : null;
    const positionRow = fp ? { vessel_id: fp.vesselId, open_port_locode: fp.openPort } : null;
    const linkCheck = reconcileLinks({
      ladenFrom: clientFrom, ladenTo: clientTo, openPort: clientOpen,
      qtyMt: client.ports?.load?.qtyMt == null ? null : Number(client.ports.load.qtyMt),
      freightQtyMt: client.revenue ? Number(client.revenue.qtyMt) : null,
      portCalls: { loadPort: client.ports?.load?.port ?? null, dischPort: client.ports?.disch?.port ?? null,
                   loadQtyMt: client.ports?.load?.qtyMt == null ? null : Number(client.ports.load.qtyMt), dischQtyMt: client.ports?.disch?.qtyMt == null ? null : Number(client.ports.disch.qtyMt) },
      vesselId: vesselIdIn,
      cargo: cargoListingId ? { id: cargoListingId, row: cargoRow } : null,
      position: availabilityId ? { id: availabilityId, row: positionRow ? { vessel_id: String(positionRow.vessel_id), open_port_locode: positionRow.open_port_locode ?? null } : null } : null,
    });
    if (!linkCheck.ok) return { ok: false, error: linkCheck.error };
    const vesselId = linkCheck.vesselId;
    const listing = cargoRow ? { laycan_from: cargoRow.laycan_from ?? null, load_rate: cargoRow.load_rate ?? null, disch_rate: cargoRow.disch_rate ?? null } : null;

    // ── the voyage date: the listing's laycan, else the broker's date (a broker input); geometry and tariffs use it ──
    const listedStart = listing?.laycan_from && ISO_DATE.test(String(listing.laycan_from).slice(0, 10)) ? String(listing.laycan_from).slice(0, 10) : null;
    const typedStart = typeof payload.startDate === "string" && ISO_DATE.test(payload.startDate) ? payload.startDate : null;
    const startDate = listedStart ?? typedStart ?? today;
    const scheduleSource: "listing" | "manual" = listedStart ? "listing" : "manual";
    if (!listedStart && !typedStart) notes.push("No laycan date: the voyage is dated today.");

    // ── legs: re-resolved here at the voyage date; manual only with its reason ──
    const geometry = new Map<string, string>();
    let splitAlgorithm: string | null = null;
    const noLeg = (key: "ballast" | "laden", from: string | null, to: string | null): ResolvedLeg => ({
      leg: { key, from, to, nm: null, ecaNm: null, method: "none" },
      snap: { key, pol: from, pod: to, totalNm: null, ecaNm: null, method: "none", source: null },
      route: null,
    });
    const resolveLeg = async (leg: SeaLegInput | null, key: "ballast" | "laden"): Promise<ResolvedLeg | null> => {
      if (!leg) return null;
      const from = typeof leg.from === "string" && LOCODE.test(leg.from) ? leg.from : null;
      const to = typeof leg.to === "string" && LOCODE.test(leg.to) ? leg.to : null;
      if (leg.method === "manual") {
        const manual = stamp(leg.manual);
        const nm = typeof leg.nm === "number" ? leg.nm : null;
        const ecaNm = typeof leg.ecaNm === "number" ? leg.ecaNm : 0;
        return { leg: { key, from, to, nm, ecaNm, method: "manual", manual }, snap: { key, pol: from, pod: to, totalNm: nm, ecaNm, method: "manual", source: null, manual }, route: null };
      }
      if (!from || !to) return noLeg(key, from, to);
      const r = await lookupLeg(supabase, from, to, startDate); // ECA geometry in force on the voyage date (C2O-050 #3)
      r.geometryVersions.forEach((g) => geometry.set(g.code, g.geometryVersion));
      splitAlgorithm = splitAlgorithm ?? r.algorithmVersion;
      if (!r.found) return noLeg(key, from, to);
      const method = r.method === "waypoints" ? "waypoints" : "distance_only";
      return {
        leg: { key, from, to, nm: r.nm, ecaNm: r.ecaNm, method, routeSource: r.source, routeVerified: r.verified, ecaConfidence: r.geometryConfidence, canalNm: r.chokepoints.includes("SUEZ") ? settings.suez.nm : null },
        snap: { key, pol: from, pod: to, totalNm: r.nm, ecaNm: r.ecaNm, method, chokepoints: r.chokepoints, reversed: r.reversed, source: r.source, verified: r.verified, ecaConfidence: r.geometryConfidence },
        route: r,
      };
    };
    const [ballastLeg, ladenLeg] = await Promise.all([resolveLeg(client.legs.ballast ?? null, "ballast"), resolveLeg(client.legs.laden, "laden")]);
    if (!ladenLeg) return { ok: false, error: "The laden leg is missing." };

    // ── fuel: the index at the bunkering (load) port for the products this voyage burns (PR-02) ──
    const fuel = await loadFuelIndex(supabase, {
      portLocode: ladenLeg.leg.from,
      productKeys: voyageFuelProducts(settings.eca.fuelProductKey, settings.eca.distillateProductKey, client.vessel?.hasScrubber ?? null),
      asOf: now,
      stemMt: null,
    });

    // ── port DAs: a saved PDA estimate (read through the PDA module's authorised get_pda_estimate, as the member),
    //    manual with provenance, or none. The browser's figure for a tariff DA is never used (B2O-020 P2).
    const pdaResolved: Record<"load" | "disch", VoyageInput["ports"]["load"]["pda"] | null> = { load: null, disch: null };
    for (const key of ["load", "disch"] as const) {
      const p = client.ports?.[key];
      if (p?.pda?.source !== "tariff") continue;
      const id = typeof p.pda.estimateId === "string" && UUID.test(p.pda.estimateId) ? p.pda.estimateId.toLowerCase() : null;
      if (!id) return { ok: false, error: "A PDA-based port DA needs the estimate it comes from; choose it again." };
      const { data: est, error: estErr } = await supabase.rpc("get_pda_estimate", { p_estimate_id: id });
      const r = pdaFromEstimate(estErr ? null : (est as Record<string, unknown> | null), typeof p.port === "string" ? p.port : null, id);
      if (!r.ok) return { ok: false, error: r.error };
      pdaResolved[key] = { usd: r.usd, source: "tariff", estimateId: r.estimateId, coverage: r.coverage };
    }

    // ── vessel facts: the governed profile, or manual for this estimate ───
    let vesselSource: "profile" | "manual" = "manual";
    let prof: VesselEconomicsProfile | null = null;
    let vesselBuildYear: number | null = null;
    if (vesselId) {
      prof = await getVesselEconomicsProfile(supabase, vesselId).catch(() => null);
      const { data: vrow } = await admin.from("vessels").select("build_year").eq("id", vesselId).maybeSingle();
      vesselBuildYear = vrow?.build_year == null ? null : Number(vrow.build_year);
      if (prof?.found && prof.allowed) {
        // Operating facts AND the Suez facts (SCNT, GT, category, transit history, searchlight, cranes) must equal the
        // governed profile; anything typed differently is manual for this estimate (Opus B pre-audit P1-1).
        const sv = payload.suezInput?.vessel;
        const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
        const fromProfile = { l: prof.speedLadenKn ?? null, b: prof.speedBallastKn ?? null, s: prof.hasScrubber ?? null, k: prof.vesselClass ?? null, c: consumptionOf(prof.consumption),
          ...(sv ? { scnt: num(prof.scnt), gt: num(prof.gt), cat: prof.suezCategory ?? null, ft: prof.firstTransit ?? null, sl: prof.searchlightCompliant ?? null, mc: prof.mooringCranesOk ?? null } : {}) };
        const typed = { l: client.vessel?.speedLadenKn ?? null, b: client.vessel?.speedBallastKn ?? null, s: client.vessel?.hasScrubber ?? null, k: client.vessel?.vesselClass ?? null, c: consumptionOf(client.vessel?.consumption),
          ...(sv ? { scnt: num(sv.scnt), gt: num(sv.gt), cat: sv.category ?? null, ft: sv.firstTransit ?? null, sl: sv.searchlightCompliant ?? null, mc: sv.mooringCranesOk ?? null } : {}) };
        vesselSource = sameFacts(fromProfile, typed) ? "profile" : "manual";
      }
    }

    // ── Suez facts: every fact the canal price reads is compared with its governed source (C2O-050 #1, #5) ──
    // A typed fact that is not the governed one, an arrival draft (a voyage fact) and undeclared voyage conditions
    // make the canal the broker's figure; omitted conditions never count as governed "none".
    const gp = prof?.found && prof.allowed ? prof : null;
    const gn = (v: unknown) => (v == null ? null : Number(v));
    const suezManual = suezFactReasons(payload.suezInput?.vessel, {
      scnt: gn(gp?.scnt), scgt: gn(gp?.scgt), gt: gn(gp?.gt), category: gp?.suezCategory ?? null, buildYear: gn(gp?.buildYear) ?? vesselBuildYear,
      craneCount: gn(gp?.craneCount), craneSwlMt: gn(gp?.craneSwlMt), mooringCranesOk: gp?.mooringCranesOk ?? null,
      searchlightCompliant: gp?.searchlightCompliant ?? null, firstTransit: gp?.firstTransit ?? null, beamFt: gn(gp?.beamFt), doubleBottom: gp?.doubleBottom ?? null,
    }, payload.suezConditionsDeclared === true);

    // ── ports: ECA status from the route's own geometry when the laden track is measured ──
    const ladenRoute = ladenLeg.route;
    const portEca = (zones: string[] | null | undefined, clientValue: boolean) =>
      zones == null ? { inEca: !!clientValue, inEcaSource: "manual" as const }
        : { inEca: zones.length > 0, inEcaSource: ladenRoute?.geometryConfidence === "official" ? ("governed" as const) : ("coarse" as const) };
    // Handling rates equal to the linked listing's are listing facts; any other figure is a broker input.
    const listingRate = (v: string | null | undefined) => { const n = v == null ? NaN : Number(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
    const rateSource = (typed: number | null | undefined, listed: number | null) => (listed != null && typed === listed ? ("listing" as const) : ("manual" as const));
    const ports: VoyageInput["ports"] = {
      load: { ...client.ports.load, ...portEca(ladenRoute?.startZones, client.ports.load.inEca), rateSource: rateSource(client.ports.load.rateMtDay, listingRate(listing?.load_rate)), pda: pdaResolved.load ?? { ...client.ports.load.pda, estimateId: undefined, coverage: undefined, manual: stamp(client.ports.load.pda?.manual) } },
      disch: { ...client.ports.disch, ...portEca(ladenRoute?.endZones, client.ports.disch.inEca), rateSource: rateSource(client.ports.disch.rateMtDay, listingRate(listing?.disch_rate)), pda: pdaResolved.disch ?? { ...client.ports.disch.pda, estimateId: undefined, coverage: undefined, manual: stamp(client.ports.disch.pda?.manual) } },
    };

    const base: VoyageInput = {
      ...client,
      // waiting at anchorage is off the discharge port: its ECA status is that port's, with the port's source (C2O-050 #4)
      anchorageInEca: ports.disch.inEca, waitingAnchorageEcaSource: ports.disch.inEcaSource === "governed" ? "governed" : "manual",
      legs: { ballast: ballastLeg?.leg ?? null, laden: ladenLeg.leg },
      ports, canal: null, ballastCanal: null, vesselSource, fuel,
      settings, settingsSource: settingsLoad.status,
    };

    // ── canal transits: requirement, direction, date and price on the server ──
    base.scheduleSource = scheduleSource;
    const pre = estimateVoyage(base); // days per leg, before any canal
    const transitFor = async (rl: ResolvedLeg | null, which: "laden" | "ballast", clientCanal: CanalInput | null | undefined): Promise<{ canal: CanalInput | null; suez: SuezEstimate | null; date: string | null; basis: string | null }> => {
      if (!rl) return { canal: null, suez: null, date: null, basis: null };
      const measured = !!rl.route;
      const required = measured ? rl.route!.chokepoints.includes("SUEZ") : !!clientCanal?.required;
      if (!required) return { canal: null, suez: null, date: null, basis: null };
      if (!measured) notes.push(`The ${which} leg is manual: its Suez transit is the broker's assertion.`);
      const clientDir = payload.suezInput?.voyage?.direction === "NB" || payload.suezInput?.voyage?.direction === "SB" ? payload.suezInput.voyage.direction : null;
      const direction = measured ? rl.route!.suezDirection : clientDir;
      if (!direction) {
        notes.push(measured ? `The ${which} track has no waypoints inside the canal: its transit direction is unknown, so the canal is not priced.` : `The ${which} leg is manual and names no Suez direction: the canal is not priced.`);
        return { canal: canalFromSuez(null, settings, { leg: which, anchorageInEca: false, anchorageInEcaSource: "manual", manualCost: null }), suez: null, date: null, basis: null };
      }
      const legDays = which === "laden" ? pre.days.seaLaden : pre.days.seaBallast;
      const offset = which === "laden" ? pre.days.portLoad + legDays / 2 : -legDays / 2;
      const date = suezTransitDate(startDate, offset);
      const basis = `${which === "laden" ? "laycan + load-port days + half the laden passage" : "laycan − half the ballast passage"} (start ${startDate})`;
      // anchorage ECA: the settings anchorage point for the direction, tested against the zones in force on the date
      const point = settings.suez.anchorages?.[direction];
      const zones = point ? await getPointEcaZones(supabase, point[0], point[1], date) : null;
      const zoneConfidence = zones ? await listEcaZones(supabase, date).then((all) => all).catch(() => []) : [];
      const coarse = zoneConfidence.length === 0 || zoneConfidence.some((z) => z.confidence !== "official");
      const anch = zones == null ? { anchorageInEca: !!clientCanal?.anchorageInEca, anchorageInEcaSource: "manual" as const }
        : { anchorageInEca: zones.length > 0, anchorageInEcaSource: coarse ? ("coarse" as const) : ("governed" as const) };
      let suez: SuezEstimate | null = null;
      const si = payload.suezInput;
      if (si?.vessel) {
        const ov = si.overrides ?? {};
        const restamp = <T,>(m: { value: T; reason: string } | undefined) => (m ? { value: m.value, reason: String(m.reason ?? "").trim(), actorUserId: ACTOR_REF, at: now } : undefined);
        const declaredNone = payload.suezConditionsDeclared === true
          ? { heavyLiftOver250t: false, floatingUnitScgt300: false, militaryCargo: false, lateArrivalBand: "none", notReady: false, deckProtrusionFt: 0, ladderNoncompliant: false, relievingPilots: 0, wasteNormalM3: 0, wasteHazardousM3: 0, bagsM3: 0, bargeHours: 0 }
          : {};
        const input: SuezInput = {
          vessel: si.vessel,
          voyage: { ...declaredNone, ...(si.voyage ?? {}), direction, cargoStatus: which, transitDate: date } as SuezInput["voyage"],
          overrides: { ...(ov.sdrRate ? { sdrRate: restamp(ov.sdrRate) } : {}), ...(ov.transitDays ? { transitDays: restamp(ov.transitDays) } : {}), ...(ov.anchorageDays ? { anchorageDays: restamp(ov.anchorageDays) } : {}) },
        };
        const ctx = await getSuezTariffContext(supabase, date);
        suez = ctx.found ? estimateSuezTransit(input, ctx) : null;
        if (!ctx.found) notes.push(`No published Suez tariff covers ${date}.`);
      }
      const m = which === "laden" ? payload.canalManual?.laden : payload.canalManual?.ballast;
      const manualCost = m && Number.isFinite(Number(m.usd)) ? { usd: Number(m.usd), manual: { actorUserId: ACTOR_REF, reason: String(m.reason ?? "").trim(), at: now } } : null;
      const priced = canalFromSuez(suez, settings, { leg: which, ...anch, manualCost });
      return { canal: downgradeCanalForFacts(priced, suezManual, { actorUserId: ACTOR_REF, at: now }), suez, date, basis };
    };
    const [laden, ballast] = await Promise.all([transitFor(ladenLeg, "laden", client.canal), transitFor(ballastLeg, "ballast", client.ballastCanal)]);

    const input: VoyageInput = { ...base, canal: laden.canal, ballastCanal: ballast.canal };
    const parsed = parseVoyageInput(input);
    if (!parsed.ok) return { ok: false, error: `The estimate input is not valid: ${parsed.errors.slice(0, 4).join("; ")}` };
    const result = estimateVoyage(parsed.value);
    if (result.status === "invalid") return { ok: false, error: `The estimate could not be computed: ${(result.errors ?? []).slice(0, 4).join("; ")}` };

    // ── snapshots (sealed with their canonical SHA-256) ───────────────────
    const fuelSnapshot = sealSnapshot({ ...fuel, canonicalSha256: undefined });
    const routeLegs = [...(ballastLeg ? [ballastLeg.snap] : []), ladenLeg.snap];
    const routeStatus: RouteEcaClassification["status"] = routeLegs.some((l) => l.method === "none") ? "unavailable"
      : routeLegs.some((l) => l.method === "manual") ? "manual" : routeLegs.some((l) => l.verified === false || l.method === "distance_only" || (l.method === "waypoints" && l.ecaConfidence === "coarse")) ? "fallback" : "trusted";
    const routeSnapshot = sealSnapshot<RouteEcaClassification>({
      kind: "route_eca", status: routeStatus, asOf: startDate, legs: routeLegs,
      geometryVersions: [...geometry].map(([code, geometryVersion]) => ({ code, geometryVersion })),
      algorithmVersion: splitAlgorithm ?? ECA_SPLIT_ALGORITHM_VERSION,
      warnings: result.warnings.filter((w) => /ECA|distance|track/i.test(w)),
    });
    const transitSnap = (t: typeof laden) => {
      const c = t.canal;
      return {
        status: !c ? ("trusted" as const) : c.status === "manual" ? ("manual" as const) : c.status === "trusted" ? ("trusted" as const) : c.status === "fallback" ? ("fallback" as const) : ("unavailable" as const),
        suezStatus: t.suez?.status ?? null,
        required: !!c,
        algorithmVersion: t.suez?.algorithmVersion ?? (c ? SUEZ_ALGORITHM_VERSION : null),
        tariffVersionNo: t.suez?.tariffVersion.versionNo ?? null,
        tariffSourceRef: t.suez?.tariffVersion.sourceRef ?? null,
        sdrRateUsd: t.suez?.sdrRate.rateUsd ?? null,
        sdrAsOf: t.suez?.sdrRate.asOf ?? null,
        sdrStatus: t.suez?.sdrRate.status ?? null,
        appliedUsd: c?.costUsd ?? null,
        potentialUsd: c?.complete ? t.suez!.totals.potentialUsd : null,
        complete: !!c?.complete,
        transitDays: c?.transitDays ?? 0,
        anchorageDays: c?.anchorageDays ?? 0,
        warnings: t.suez?.warnings ?? [],
        manual: c?.manual ?? (t.suez?.sdrRate.manual ? { actorUserId: ACTOR_REF, reason: t.suez.sdrRate.manual.reason, at: now } : undefined),
        transitDate: t.date,
        transitDateBasis: t.basis,
        factsSource: suezManual.length ? ("manual" as const) : ("governed" as const),
        manualFacts: suezManual,
        conditionsDeclared: payload.suezConditionsDeclared === true,
      };
    };
    const suezSnapshot = sealSnapshot<SuezCostSnapshot>({ kind: "suez_cost", ...transitSnap(laden), ballastTransit: ballast.canal ? transitSnap(ballast) : null });
    const pdaSources = [parsed.value.ports.load.pda.source, parsed.value.ports.disch.pda.source];
    const portSnapshot = sealSnapshot<PortCostSnapshot>({
      kind: "port_cost",
      status: pdaSources.some((s) => s === "none") ? "unavailable" : pdaSources.some((s) => s === "manual") || result.costs.pdaLoad.status === "manual" || result.costs.pdaDisch.status === "manual" ? "manual"
        : result.costs.pdaLoad.status !== "trusted" || result.costs.pdaDisch.status !== "trusted" ? "fallback" : "trusted",
      load: { port: parsed.value.ports.load.port, usd: parsed.value.ports.load.pda.usd, source: parsed.value.ports.load.pda.source, estimateId: parsed.value.ports.load.pda.estimateId ?? null, coverage: parsed.value.ports.load.pda.coverage ?? null, manual: parsed.value.ports.load.pda.manual },
      disch: { port: parsed.value.ports.disch.port, usd: parsed.value.ports.disch.pda.usd, source: parsed.value.ports.disch.pda.source, estimateId: parsed.value.ports.disch.pda.estimateId ?? null, coverage: parsed.value.ports.disch.pda.coverage ?? null, manual: parsed.value.ports.disch.pda.manual },
      warnings: result.unavailable.filter((u) => u.code.startsWith("pda_")).map((u) => u.reason),
    });

    // ── normalised lines, each with its governed status ──────────────────
    const c = result.costs;
    const opexAssumed = result.platformAssumptions.some((p) => p.key.startsWith("opex") || p.key === "classMultipliers");
    const opexStatus = result.settingsSource === "governed" && !result.opex.classAssumed && !opexAssumed ? "trusted" : "fallback";
    const lines = [
      ...result.legs.map((l) => ({ kind: "leg", code: l.key, label: l.label, status: l.status, quantity: l.days, unit: "days", rate: l.nm, amountUsd: null, explanation: l.note })),
      ...result.fuel.lines.map((f) => ({ kind: "fuel", code: f.productKey.toLowerCase(), label: f.productKey, status: f.status, quantity: f.mt, unit: "mt", rate: f.usdMt, amountUsd: f.usd, explanation: f.status === "trusted" ? `index average${f.priceAsOf ? ` as of ${f.priceAsOf}` : ""}` : f.status === "fallback" ? "admin fallback price" : "no price" })),
      { kind: "cost", code: "canal", label: "Canal transit", status: c.canal.status, quantity: null, unit: null, rate: null, amountUsd: c.canal.usd, explanation: suezSnapshot.tariffVersionNo ? `Suez tariff v${suezSnapshot.tariffVersionNo} on ${suezSnapshot.transitDate} · ${suezSnapshot.suezStatus ?? "n/a"}${suezSnapshot.ballastTransit ? " + ballast transit" : ""}` : c.canal.required ? "no tariff" : "not required" },
      { kind: "cost", code: "pda_load", label: "Load port DA", status: c.pdaLoad.status, quantity: null, unit: null, rate: null, amountUsd: c.pdaLoad.usd, explanation: portSnapshot.load.source },
      { kind: "cost", code: "pda_disch", label: "Discharge port DA", status: c.pdaDisch.status, quantity: null, unit: null, rate: null, amountUsd: c.pdaDisch.usd, explanation: portSnapshot.disch.source },
      { kind: "cost", code: "extras", label: "Insurance, stevedoring, other", status: "manual", quantity: null, unit: null, rate: null, amountUsd: c.extrasUsd, explanation: "broker-entered" },
      { kind: "cost", code: "opex", label: "Running cost", status: opexStatus, quantity: result.days.total, unit: "days", rate: result.opex.usdDay, amountUsd: c.opexUsd, explanation: `class ${result.opex.vesselClass}${result.opex.classAssumed ? " (assumed)" : ""} · settings ${result.settingsSource}${result.platformAssumptions.length ? " · platform assumption" : ""}` },
      ...(result.revenue ? [{ kind: "revenue", code: "net_freight", label: "Net freight", status: "manual", quantity: null, unit: null, rate: null, amountUsd: result.revenue.netFreightUsd, explanation: `TCE ${result.revenue.tceUsdDay} USD/day · broker-entered freight` }] : []),
    ];

    const warnings = [...notes, ...result.warnings, ...result.unavailable.map((u) => u.reason)];
    const id = await saveVoyageEstimate(admin, actorId, {
      label: payload.label,
      vesselId, availabilityId, cargoListingId,
      ownerOrgId: typeof payload.ownerOrgId === "string" && UUID.test(payload.ownerOrgId) ? payload.ownerOrgId : null,
      algorithmVersion: VOYAGE_ALGORITHM_VERSION,
      settingsHash: hashSettings(parsed.value.settings),
      input: { ...parsed.value, suezAlgorithmVersion: laden.suez?.algorithmVersion ?? SUEZ_ALGORITHM_VERSION, startDate },
      result,
      fuelIndexSnapshot: fuelSnapshot,
      routeEcaSnapshot: routeSnapshot,
      suezCostSnapshot: suezSnapshot,
      portCostSnapshot: portSnapshot,
      totals: {
        status: result.status, complete: c.complete, days: result.days,
        fuelUsd: c.fuel.usd, opexUsd: c.opexUsd, canalUsd: c.canal.usd,
        pdaUsd: c.pdaLoad.usd == null || c.pdaDisch.usd == null ? null : c.pdaLoad.usd + c.pdaDisch.usd,
        voyageCostsUsd: c.voyageCostsUsd, totalUsd: c.totalUsd, tceUsdDay: result.revenue?.tceUsdDay ?? null,
        settingsSource: result.settingsSource,
      },
      warnings,
      lines,
    });
    return { ok: true, data: { id, status: result.status, warnings: notes } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save the estimate.";
    return { ok: false, error: msg.replace(/^VOYAGE_(FORBIDDEN|INVALID):\s*/, "") };
  }
}
