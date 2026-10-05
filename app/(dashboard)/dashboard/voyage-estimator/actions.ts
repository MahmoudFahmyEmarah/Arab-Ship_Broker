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
import { getPointEcaZones, getRouteEcaSplit, getSuezTariffContext, getVesselEconomicsProfile, listEcaZones } from "@/sdk/app/suez";
import { getVoyageSettings, saveVoyageEstimate } from "@/sdk/app/voyage";
import { estimateVoyage } from "@/lib/voyage/engine";
import { parseVoyageInput } from "@/lib/voyage/schemas";
import { loadFuelIndex } from "@/lib/voyage/fuel-source";
import { canalFromSuez, suezTransitDate } from "@/lib/voyage/canal";
import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
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
    suezDirection: suez && wp.length >= 2 ? (wp[0][0] > wp[wp.length - 1][0] ? "SB" : "NB") : null,
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
    const requestedPort = typeof client.fuel?.requestedPort === "string" ? client.fuel.requestedPort : null;
    const fuel = await loadFuelIndex(requestedPort);

    // ── legs: re-resolved here; manual only with its reason ───────────────
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
      const r = await lookupLeg(supabase, from, to, today);
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

    // ── port DAs: manual with provenance, or none ─────────────────────────
    for (const p of [client.ports.load, client.ports.disch]) {
      if (p?.pda?.source === "tariff") return { ok: false, error: "A tariff-based port DA is not linked to the estimator yet; enter the DA as a manual figure with its reason." };
    }

    // ── links: an id is kept only beside its own economics ────────────────
    let vesselId = typeof payload.vesselId === "string" && UUID.test(payload.vesselId) ? payload.vesselId : null;
    let availabilityId = typeof payload.availabilityId === "string" && UUID.test(payload.availabilityId) ? payload.availabilityId : null;
    let cargoListingId = typeof payload.cargoListingId === "string" && UUID.test(payload.cargoListingId) ? payload.cargoListingId : null;
    if (cargoListingId) {
      const { data: c } = await admin.from("cargo_listings").select("load_port_locode, disch_port_locode").eq("id", cargoListingId).maybeSingle();
      if (!c || c.load_port_locode !== ladenLeg.leg.from || c.disch_port_locode !== ladenLeg.leg.to) {
        notes.push("The laden route differs from the cargo listing's ports; the estimate is saved without the cargo link.");
        cargoListingId = null;
      }
    }
    if (availabilityId) {
      const { data: a } = await admin.from("vessel_availability").select("vessel_id, open_port_locode").eq("id", availabilityId).maybeSingle();
      const openPort = ballastLeg?.leg.from ?? ladenLeg.leg.from;
      if (!a || (vesselId && a.vessel_id !== vesselId) || (a.open_port_locode && a.open_port_locode !== openPort)) {
        notes.push("The open port differs from the position's; the estimate is saved without the position link.");
        availabilityId = null;
      } else if (!vesselId) {
        vesselId = String(a.vessel_id);
      }
    }

    // ── vessel facts: the governed profile, or manual for this estimate ───
    let vesselSource: "profile" | "manual" = "manual";
    if (vesselId) {
      const prof = await getVesselEconomicsProfile(supabase, vesselId).catch(() => null);
      if (prof?.found && prof.allowed) {
        const fromProfile = { l: prof.speedLadenKn ?? null, b: prof.speedBallastKn ?? null, s: prof.hasScrubber ?? null, k: prof.vesselClass ?? null, c: consumptionOf(prof.consumption) };
        const typed = { l: client.vessel?.speedLadenKn ?? null, b: client.vessel?.speedBallastKn ?? null, s: client.vessel?.hasScrubber ?? null, k: client.vessel?.vesselClass ?? null, c: consumptionOf(client.vessel?.consumption) };
        vesselSource = sameFacts(fromProfile, typed) ? "profile" : "manual";
      }
    }

    // ── ports: ECA status from the route's own geometry when the laden track is measured ──
    const ladenRoute = ladenLeg.route;
    const portEca = (zones: string[] | null | undefined, clientValue: boolean) =>
      zones == null ? { inEca: !!clientValue, inEcaSource: "manual" as const }
        : { inEca: zones.length > 0, inEcaSource: ladenRoute?.geometryConfidence === "official" ? ("governed" as const) : ("coarse" as const) };
    const ports: VoyageInput["ports"] = {
      load: { ...client.ports.load, ...portEca(ladenRoute?.startZones, client.ports.load.inEca), pda: { ...client.ports.load.pda, manual: stamp(client.ports.load.pda?.manual) } },
      disch: { ...client.ports.disch, ...portEca(ladenRoute?.endZones, client.ports.disch.inEca), pda: { ...client.ports.disch.pda, manual: stamp(client.ports.disch.pda?.manual) } },
    };

    const base: VoyageInput = {
      ...client,
      legs: { ballast: ballastLeg?.leg ?? null, laden: ladenLeg.leg },
      ports, canal: null, ballastCanal: null, vesselSource, fuel,
      settings, settingsSource: settingsLoad.status,
    };

    // ── canal transits: requirement, direction, date and price on the server ──
    const startDate = typeof payload.startDate === "string" && ISO_DATE.test(payload.startDate) ? payload.startDate : today;
    if (startDate === today && payload.startDate !== today) notes.push("No laycan date: transit dates are counted from today.");
    const pre = estimateVoyage(base); // days per leg, before any canal
    const transitFor = async (rl: ResolvedLeg | null, which: "laden" | "ballast", clientCanal: CanalInput | null | undefined): Promise<{ canal: CanalInput | null; suez: SuezEstimate | null; date: string | null; basis: string | null }> => {
      if (!rl) return { canal: null, suez: null, date: null, basis: null };
      const measured = !!rl.route;
      const required = measured ? rl.route!.chokepoints.includes("SUEZ") : !!clientCanal?.required;
      if (!required) return { canal: null, suez: null, date: null, basis: null };
      if (!measured) notes.push(`The ${which} leg is manual: its Suez transit is the broker's assertion.`);
      const direction = rl.route?.suezDirection ?? (payload.suezInput?.voyage?.direction === "NB" ? "NB" : "SB");
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
        const input: SuezInput = {
          vessel: si.vessel,
          voyage: { ...(si.voyage ?? {}), direction, cargoStatus: which, transitDate: date } as SuezInput["voyage"],
          overrides: { ...(ov.sdrRate ? { sdrRate: restamp(ov.sdrRate) } : {}), ...(ov.transitDays ? { transitDays: restamp(ov.transitDays) } : {}), ...(ov.anchorageDays ? { anchorageDays: restamp(ov.anchorageDays) } : {}) },
        };
        const ctx = await getSuezTariffContext(supabase, date);
        suez = ctx.found ? estimateSuezTransit(input, ctx) : null;
        if (!ctx.found) notes.push(`No published Suez tariff covers ${date}.`);
      }
      const m = which === "laden" ? payload.canalManual?.laden : payload.canalManual?.ballast;
      const manualCost = m && Number.isFinite(Number(m.usd)) ? { usd: Number(m.usd), manual: { actorUserId: ACTOR_REF, reason: String(m.reason ?? "").trim(), at: now } } : null;
      return { canal: canalFromSuez(suez, settings, { leg: which, ...anch, manualCost }), suez, date, basis };
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
      : routeLegs.some((l) => l.method === "manual") ? "manual" : routeLegs.some((l) => l.verified === false || (l.method === "waypoints" && l.ecaConfidence === "coarse")) ? "fallback" : "trusted";
    const routeSnapshot = sealSnapshot<RouteEcaClassification>({
      kind: "route_eca", status: routeStatus, asOf: today, legs: routeLegs,
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
      };
    };
    const suezSnapshot = sealSnapshot<SuezCostSnapshot>({ kind: "suez_cost", ...transitSnap(laden), ballastTransit: ballast.canal ? transitSnap(ballast) : null });
    const pdaSources = [parsed.value.ports.load.pda.source, parsed.value.ports.disch.pda.source];
    const portSnapshot = sealSnapshot<PortCostSnapshot>({
      kind: "port_cost",
      status: pdaSources.some((s) => s === "none") ? "unavailable" : pdaSources.some((s) => s === "manual") ? "manual" : "trusted",
      load: { port: parsed.value.ports.load.port, usd: parsed.value.ports.load.pda.usd, source: parsed.value.ports.load.pda.source, manual: parsed.value.ports.load.pda.manual },
      disch: { port: parsed.value.ports.disch.port, usd: parsed.value.ports.disch.pda.usd, source: parsed.value.ports.disch.pda.source, manual: parsed.value.ports.disch.pda.manual },
      warnings: result.unavailable.filter((u) => u.code.startsWith("pda_")).map((u) => u.reason),
    });

    // ── normalised lines, each with its governed status ──────────────────
    const c = result.costs;
    const opexStatus = result.settingsSource === "governed" && !result.opex.classAssumed ? "trusted" : "fallback";
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
