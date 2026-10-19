"use server";

import { getAppUserRow } from "@/lib/app-user";
import { calculatePda } from "@/lib/pda/calculate";
import { derivePdaRouteTimeline } from "@/lib/pda/route-calculate";
import { pdaRoutePreviewSchema } from "@/lib/pda/route-schema";
import { composePdaRoutePreview, type PdaRouteFramePreview, type PdaRouteLegPreview, type PdaRouteSide } from "@/lib/pda/route-legs";
import type { PdaMeasuredPassage, PdaRouteFxRate, PdaRouteLegInput, PdaRoutePreviewInput, PdaRoutePreviewResult, PdaRouteTimelineResult, PdaRouteTransit, PdaRouteTransitsInput } from "@/lib/pda/route-types";
import { estimateSuezTransit } from "@/lib/suez/engine";
import type { SuezInput } from "@/lib/suez/types";
import { canalDirection } from "@/lib/voyage/canal";
import { getSuezTariffContext, getVesselEconomicsProfile } from "@/sdk/app/suez";
import { pdaRequestSchema } from "@/lib/pda/schemas";
import type { PdaCalculationResult, PdaRequest } from "@/lib/pda/types";
import { loadCargoViews, loadVesselViews } from "@/lib/portal/data";
import type { CargoView, VesselView } from "@/lib/portal/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveDeclaredFlag, resolveFlagName, type FlagStateRow } from "@/lib/pda/flag";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPdaCalculationContext, getPdaEstimateSet, listMyPdaEstimateSets, listPdaPortsWorkspace, savePdaEstimate, savePdaEstimateSet, setMyPdaPreferences } from "@/sdk/app/pda";
import { PDA_OWNER_MARKER, pdaRouteSnapshot, type PdaEstimateSetDetail, type PdaEstimateSetSummary, type PdaSaveSetResult } from "@/lib/pda/estimate-sets";
import type { PdaPreferences, PdaStartTab } from "@/lib/pda/preferences";
import type { PdaEstimatorDensity } from "@/lib/pda/estimator-contract";
import type { PdaPortsWorkspace } from "@/lib/pda/ports-workspace";
import { getPortRoute } from "@/sdk/app/routes";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

class UserFacingActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingActionError";
  }
}

function validationErrorMessage(
  issues: readonly { message: string }[],
  fallback: string,
): string {
  const messages = [...new Set(issues.map((issue) => issue.message.trim()).filter(Boolean))];
  return messages.length ? messages.join("; ") : fallback;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingActionError) return error.message;
  console.error(`[pda] ${fallback}`, error);
  return fallback;
}

async function viewer() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserFacingActionError("Sign in required");
  const appUser = await getAppUserRow<{
    id: string;
    full_name: string | null;
    role: string | null;
    subscription_tier: string | null;
    is_market_partner: boolean | null;
    is_active: boolean;
  }>(supabase, user.id, "id, full_name, role, subscription_tier, is_market_partner, is_active");
  if (!appUser?.is_active) throw new UserFacingActionError("Active account required");
  const entitled = appUser.role?.toLowerCase() === "admin"
    || appUser.is_market_partner === true
    || ["T3", "T4"].includes(appUser.subscription_tier ?? "T1");
  if (!entitled) throw new UserFacingActionError("PDA Estimator requires Subscriber tier (T3+)");
  const { data: membership } = await supabase.rpc("fn_my_membership");
  const member = (Array.isArray(membership) ? membership[0] : membership) as { org_id?: string; status?: string } | null;
  return {
    supabase,
    appUser,
    manualActorLabel: appUser.full_name?.trim() || "Authenticated member",
    ownerOrgId: member?.status === "active" ? member.org_id ?? null : null,
  };
}

function attributeManualLines(request: PdaRequest, enteredBy: string): PdaRequest {
  return {
    ...request,
    manualLines: request.manualLines?.map((line) => ({ ...line, enteredBy })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function numberFromDisplay(value: string): number | null {
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The active flag-state registry (public.flag_states). A failed read is null, so every flag resolves unknown and a
 * rule that needs the treatment raises MISSING_INPUT (C2O-090 B2C-035 P1-1); nothing is ever guessed as foreign.
 */
async function flagRegistry(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
): Promise<FlagStateRow[] | null> {
  // The whole registry, inactive rows included: an exact inactive name must stay unknown (C2O-094), not fall
  // through to another register's alias.
  const { data, error } = await supabase.from("flag_states").select("iso2, name, aliases, is_active");
  return error || !data ? null : (data as FlagStateRow[]);
}

function authoritativeVesselFacts(vessel: VesselView, flagState: string | null): PdaRequest["vessel"] {
  const vesselId =
    vessel.isOwned === true &&
    vessel.canManage === true &&
    vessel.ownedListingId &&
    vessel.vesselId &&
    UUID.test(vessel.vesselId)
      ? vessel.vesselId
      : null;
  return {
    vesselId,
    vesselName: vessel.name,
    imo: vessel.imo,
    vesselType: vessel.type,
    gt: vessel.gt ?? null,
    scnrt: vessel.scnrt ?? null,
    dwt: numberFromDisplay(vessel.dwt),
    loaM: vessel.loaM ?? null,
    // The registered maximum (summer) draft is a vessel particular, never the call draft (C2O-090 B2C-035 P1-2):
    // a rule conditioned on draft sees the call draft only when the member declares it.
    registeredMaxDraftM: vessel.draftM ?? null,
    flagState,
  };
}

async function canonicalStandaloneRequest(request: PdaRequest): Promise<PdaRequest> {
  const requestedVesselId = request.vessel.vesselId;
  const supabase = await getSupabaseServerClient();
  const registry = await flagRegistry(supabase);
  if (!requestedVesselId) {
    // A declared flag counts only when an active register carries that ISO code; otherwise it is unknown.
    return { ...request, vessel: { ...request.vessel, flagState: resolveDeclaredFlag(registry, request.vessel.flagState) } };
  }

  const vessels = await loadVesselViews({ mine: true });
  if (vessels.source !== "live") {
    throw new UserFacingActionError("Live vessel records could not be loaded");
  }
  const vessel = vessels.views.find(
    (item) =>
      item.isOwned === true &&
      item.canManage === true &&
      item.vesselId === requestedVesselId,
  );
  if (!vessel) {
    throw new UserFacingActionError(
      "The selected vessel is not available to this account",
    );
  }
  return {
    ...request,
    vessel: {
      ...request.vessel,
      ...authoritativeVesselFacts(vessel, resolveFlagName(registry, vessel.flag)),
    },
  };
}

function canonicalRouteLeg(input: {
  leg: PdaRouteLegInput;
  vessel: VesselView;
  cargo: CargoView;
  quantityMt: number;
  days: number;
  manualActorLabel: string;
  flagState: string | null;
}): PdaRequest {
  return {
    portLocode: input.leg.portLocode,
    terminalId: input.leg.terminalId ?? null,
    // Tariff effectiveness is governed by the explicit calendar date at this
    // port. Voyage timeline instants are presentation/operations data only.
    callDate: input.leg.callDate,
    vessel: authoritativeVesselFacts(input.vessel, input.flagState),
    call: {
      days: input.days,
      hours: input.leg.call.hours ?? null,
      units: input.leg.call.units ?? null,
      cargoQuantityMt: input.quantityMt,
      cargoType: input.cargo.type,
      cargoStatus: input.leg.call.cargoStatus,
      voyageScope: input.leg.call.voyageScope,
      location: input.leg.call.location,
      settlementMode: input.leg.call.settlementMode ?? null,
      requestedServices: input.leg.call.requestedServices,
    },
    manualLines: input.leg.manualLines?.map((line) => ({
      ...line,
      enteredBy: input.manualActorLabel,
    })),
  };
}

/**
 * FX (Wave 3 groundwork): when the tariff currency differs from the display currency,
 * the server resolves one governed rate (public.fn_pda_fx_rate: latest on or before the
 * call date, within 31 days, the direct pair first, else the inverse). No governed rate = no conversion,
 * so the leg keeps FX_RATE_REQUIRED; a failed lookup is an error, not a missing rate; a member-typed rate is
 * never used on this path.
 */
async function forDisplayCurrency(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  request: PdaRequest,
  nativeCurrency: string | null,
  displayCurrency: string,
): Promise<{ request: PdaRequest; fx: PdaRouteFxRate | null }> {
  if (!nativeCurrency || nativeCurrency === displayCurrency) {
    return { request: { ...request, convertedCurrency: null, fxRate: null }, fx: null };
  }
  const { data, error } = await supabase.rpc("fn_pda_fx_rate", {
    p_base: nativeCurrency,
    p_quote: displayCurrency,
    p_on: request.callDate,
  });
  if (error) {
    // A failed lookup is not a missing rate (C2O-090 P2): report it, never show "needs an authorised FX rate".
    console.error("[pda] fn_pda_fx_rate failed", { base: nativeCurrency, quote: displayCurrency, on: request.callDate, error: error.message });
    throw new UserFacingActionError("Exchange rates could not be loaded. Please try again.");
  }
  const fx = data && typeof data === "object" ? (data as PdaRouteFxRate) : null;
  const rate = fx && Number.isFinite(Number(fx.rate)) && Number(fx.rate) > 0 ? Number(fx.rate) : null;
  return {
    request: { ...request, convertedCurrency: displayCurrency, fxRate: rate },
    fx: rate ? { ...fx!, rate } : null,
  };
}

async function requireRouteSelections(
  selection: PdaRoutePreviewInput["selection"],
): Promise<{ vessel: VesselView; cargo: CargoView }> {
  const [vessels, cargos] = await Promise.all([
    loadVesselViews({ mine: true }),
    loadCargoViews({ mine: true }),
  ]);
  if (vessels.source !== "live" || cargos.source !== "live") {
    throw new UserFacingActionError("Live vessel or cargo records could not be loaded");
  }
  const vessel = vessels.views.find(
    (item) =>
      item.isOwned === true &&
      item.canManage === true &&
      item.ownedListingId === selection.vesselAvailabilityId,
  );
  if (!vessel) throw new UserFacingActionError("The selected vessel is not available to this account");
  const cargo = cargos.views.find(
    (item) =>
      item.isOwned === true &&
      item.canManage === true &&
      item.ownedListingId === selection.cargoId,
  );
  if (!cargo) throw new UserFacingActionError("The selected cargo is not available to this account");
  return { vessel, cargo };
}

async function requireVerifiedPorts(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  locodes: string[],
): Promise<void> {
  const unique = [...new Set(locodes)];
  const { data, error } = await supabase
    .from("ports")
    .select("locode")
    .in("locode", unique)
    .eq("is_active", true)
    .eq("is_verified", true);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((row) => row.locode));
  const missing = unique.filter((code) => !found.has(code));
  if (missing.length) throw new UserFacingActionError(`Verified port not found: ${missing.join(", ")}`);
}

export async function previewPda(raw: PdaRequest): Promise<ActionResult<PdaCalculationResult>> {
  try {
    const parsed = pdaRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: validationErrorMessage(parsed.error.issues, "Invalid PDA request") };
    }
    const { supabase, manualActorLabel } = await viewer();
    const request = await canonicalStandaloneRequest(
      attributeManualLines(parsed.data as PdaRequest, manualActorLabel),
    );
    const context = await getPdaCalculationContext(supabase, request);
    return { ok: true, data: calculatePda(request, context.tariffVersion ?? null) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to calculate PDA") };
  }
}

export async function persistPda(raw: PdaRequest): Promise<ActionResult<{ estimateId: string; result: PdaCalculationResult }>> {
  try {
    const parsed = pdaRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: validationErrorMessage(parsed.error.issues, "Invalid PDA request") };
    }
    const { supabase, appUser, manualActorLabel, ownerOrgId } = await viewer();
    const request = await canonicalStandaloneRequest(
      attributeManualLines(parsed.data as PdaRequest, manualActorLabel),
    );
    const context = await getPdaCalculationContext(supabase, request);
    const result = calculatePda(request, context.tariffVersion ?? null);
    const estimateId = await savePdaEstimate(getSupabaseAdminClient(), {
      actorId: appUser.id,
      ownerOrgId,
      request,
      result,
    });
    return { ok: true, data: { estimateId, result } };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to save PDA") };
  }
}

/**
 * Shared preparation for every part of a route preview: the request is validated, the member's own vessel and cargo
 * and both verified ports are confirmed, and the timeline is derived. Every part re-runs this, so a part can never be
 * computed for a selection the member does not own.
 */
async function prepareRoutePreview(raw: PdaRoutePreviewInput) {
  const parsed = pdaRoutePreviewSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UserFacingActionError(validationErrorMessage(parsed.error.issues, "Invalid route PDA request"));
  }
  const input = parsed.data as PdaRoutePreviewInput;
  const { supabase, manualActorLabel, appUser, ownerOrgId } = await viewer();
  const [{ vessel, cargo }] = await Promise.all([
    requireRouteSelections(input.selection),
    requireVerifiedPorts(supabase, [input.load.portLocode, input.discharge.portLocode]),
  ]);
  const timeline = derivePdaRouteTimeline(input.selection.quantityMt, input.timeline);
  const flagState = resolveFlagName(await flagRegistry(supabase), vessel.flag);
  return { input, supabase, manualActorLabel, appUserId: appUser.id, ownerOrgId, vessel, cargo, timeline, flagState };
}

type PreparedRoute = Awaited<ReturnType<typeof prepareRoutePreview>>;

/** One leg: canonical request → governed tariff context → FX → calculation. */
async function computeRouteLeg(route: PreparedRoute, side: PdaRouteSide): Promise<PdaRouteLegPreview> {
  const leg = side === "load" ? route.input.load : route.input.discharge;
  const canonical = canonicalRouteLeg({
    leg,
    vessel: route.vessel,
    cargo: route.cargo,
    quantityMt: route.input.selection.quantityMt,
    days: side === "load" ? route.timeline.loadPortDays : route.timeline.dischargePortDays,
    manualActorLabel: route.manualActorLabel,
    flagState: route.flagState,
  });
  const context = await getPdaCalculationContext(route.supabase, canonical);
  const fx = await forDisplayCurrency(route.supabase, canonical, context.tariffVersion?.currency ?? null, route.input.displayCurrency);
  return { side, request: fx.request, result: calculatePda(fx.request, context.tariffVersion ?? null), fx: fx.fx };
}

/** The frame: canonical selection, timeline and the transits on the measured passage. */
async function computeRouteFrame(route: PreparedRoute): Promise<PdaRouteFramePreview> {
  return {
    canonical: {
      vesselAvailabilityId: route.vessel.ownedListingId!,
      vesselId: route.vessel.vesselId && UUID.test(route.vessel.vesselId) ? route.vessel.vesselId : null,
      cargoId: route.cargo.ownedListingId!,
      quantityMt: route.input.selection.quantityMt,
    },
    timeline: route.timeline,
    transitFacts: await routeTransits(route.supabase, route.input.load.portLocode, route.input.discharge.portLocode, route.timeline, route.vessel),
  };
}

/** The whole route in one call (kept for callers that want it): the same parts, composed the same way as the page. */
export async function previewPdaRoute(raw: PdaRoutePreviewInput): Promise<ActionResult<PdaRoutePreviewResult>> {
  try {
    const route = await prepareRoutePreview(raw);
    const [load, discharge, frame] = await Promise.all([
      computeRouteLeg(route, "load"),
      computeRouteLeg(route, "discharge"),
      computeRouteFrame(route),
    ]);
    return {
      ok: true,
      data: composePdaRoutePreview({ displayCurrency: route.input.displayCurrency, allocation: route.input.allocation, frame, load, discharge }),
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to calculate route PDA") };
  }
}

/** One leg on its own (increment B): it loads, fails and is retried independently of the other leg. */
export async function previewPdaRouteLeg(raw: PdaRoutePreviewInput, side: PdaRouteSide): Promise<ActionResult<PdaRouteLegPreview>> {
  try {
    if (side !== "load" && side !== "discharge") throw new UserFacingActionError("Unknown route leg");
    const route = await prepareRoutePreview(raw);
    return { ok: true, data: await computeRouteLeg(route, side) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, side === "load" ? "The load port could not be calculated" : "The discharge port could not be calculated") };
  }
}

/** The frame on its own (increment B): timeline, canonical selection and transits. */
export async function previewPdaRouteFrame(raw: PdaRoutePreviewInput): Promise<ActionResult<PdaRouteFramePreview>> {
  try {
    const route = await prepareRoutePreview(raw);
    return { ok: true, data: await computeRouteFrame(route) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "The voyage timeline and transits could not be calculated") };
  }
}

/**
 * Transits on the measured passage (Wave 3, PR-11): Suez is priced by the governed Suez engine
 * on the tariff in force at mid-passage, from the vessel's governed economics profile (SCNT and
 * Suez category). No measured route, no direction inside the canal, no SCNT/category or no
 * published Suez tariff = the transit stays NOT SOURCED with that reason; nothing is guessed.
 * Voyage conditions (late arrival, heavy lift, escort triggers, waste) are not declared on this
 * page, so the Suez flags stay undecided and the estimate is partial unless the engine decides them.
 */
async function routeTransits(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  pol: string,
  pod: string,
  timeline: PdaRouteTimelineResult,
  vessel: VesselView,
): Promise<PdaRouteTransitsInput> {
  const route = await getPortRoute(supabase, pol, pod);
  if (!route) return { measured: false, chokepoints: [], priced: [] };
  const chokepoints = [...new Set(route.chokepoints.map((item) => item.toUpperCase()))];
  const priced: PdaRouteTransit[] = [];
  if (chokepoints.includes("SUEZ")) {
    const direction = canalDirection(route.waypoints);
    const etd = Date.parse(timeline.etdLoad);
    const transitDate = Number.isFinite(etd) && Number.isFinite(timeline.passageDays)
      ? new Date(etd + (timeline.passageDays / 2) * 86_400_000).toISOString().slice(0, 10)
      : null;
    const base = { chokepoint: "SUEZ", label: "Suez Canal transit", direction, transitDate, undecided: 0, tariffVersionId: null };
    const unpriced = (note: string): PdaRouteTransit => ({ ...base, status: "unavailable", amountUsd: null, note });
    if (!direction) {
      priced.push(unpriced("The measured track has no waypoints inside the canal, so its transit direction is unknown; the canal is not priced."));
    } else if (!transitDate) {
      priced.push(unpriced("The transit date cannot be derived from the timeline; the canal is not priced."));
    } else {
      const ownedVesselId = vessel.vesselId && UUID.test(vessel.vesselId) ? vessel.vesselId : null;
      const profile = ownedVesselId ? await getVesselEconomicsProfile(supabase, ownedVesselId).catch(() => null) : null;
      const scnt = profile?.found ? profile.scnt ?? null : null;
      const category = profile?.found ? profile.suezCategory ?? null : null;
      if (scnt == null || !category) {
        priced.push(unpriced("Suez needs the vessel's SCNT and Suez category from its economics profile (Voyage data); the canal is not priced."));
      } else {
        const context = await getSuezTariffContext(supabase, transitDate).catch(() => null);
        if (!context?.found) {
          priced.push(unpriced(`No published Suez tariff covers ${transitDate}; the canal is not priced.`));
        } else {
          const input: SuezInput = {
            vessel: {
              scnt, scgt: profile?.scgt ?? null, gt: profile?.gt ?? vessel.gt ?? null, category,
              buildYear: profile?.buildYear ?? null, firstTransit: profile?.firstTransit ?? null,
              searchlightCompliant: profile?.searchlightCompliant ?? null, mooringCranesOk: profile?.mooringCranesOk ?? null,
            },
            voyage: { direction, cargoStatus: "laden", transitDate },
          };
          const estimate = estimateSuezTransit(input, context);
          const undecided = estimate.layers.conditional.filter((flag) => flag.triggered === null && !flag.contingent).length;
          const complete = estimate.status !== "invalid" && estimate.totals.complete;
          priced.push({
            ...base,
            label: `Suez Canal transit (laden, ${direction})`,
            status: estimate.status,
            amountUsd: complete ? estimate.totals.appliedUsd : null,
            undecided,
            tariffVersionId: estimate.tariffVersion.id,
            note: complete
              ? `Suez tariff v${estimate.tariffVersion.versionNo} on ${transitDate}${undecided ? ` · ${undecided} condition(s) not declared on this page (late arrival, escort, waste…); see the Suez calculator` : ""}`
              : `The Suez estimate is incomplete on ${transitDate}: ${estimate.unavailable.slice(0, 3).map((item) => item.reason).join("; ") || "missing governed inputs"}.`,
          });
        }
      }
    }
  }
  return { measured: true, chokepoints, priced };
}

/**
 * The measured passage between two ports (public.get_port_route: ECDIS voyage plans,
 * symmetric and alias-aware). It only offers a distance to prefill; the member can
 * overwrite it, and no route means the field stays theirs to fill.
 */
export async function measuredPdaPassage(pol: string, pod: string): Promise<ActionResult<PdaMeasuredPassage | null>> {
  try {
    const from = String(pol ?? "").trim().toUpperCase();
    const to = String(pod ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(from) || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(to) || from === to) return { ok: true, data: null };
    const { supabase } = await viewer();
    const route = await getPortRoute(supabase, from, to);
    return {
      ok: true,
      data: route ? { nm: route.totalNm, source: route.source, verified: route.verified, chokepoints: route.chokepoints, reversed: route.reversed } : null,
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to look up the measured passage") };
  }
}

/** The Ports tab (increment C): read-only, through the member's own session and the governed RPC. */
export async function loadPdaPortsWorkspace(callDate?: string): Promise<ActionResult<PdaPortsWorkspace>> {
  try {
    const { supabase } = await viewer();
    const day = callDate && /^\d{4}-\d{2}-\d{2}$/.test(callDate) ? callDate : new Date().toISOString().slice(0, 10);
    return { ok: true, data: await listPdaPortsWorkspace(supabase, day) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "The ports could not be loaded") };
  }
}

/** The Setup tab (increment D): saves the caller's own preferences through the governed RPC. */
export async function savePdaPreferences(density: PdaEstimatorDensity, startTab: PdaStartTab): Promise<ActionResult<PdaPreferences>> {
  try {
    if (density !== "compact" && density !== "comfortable") throw new UserFacingActionError("Choose a row height");
    if (startTab !== "estimate" && startTab !== "ports") throw new UserFacingActionError("Choose a start tab");
    const { supabase } = await viewer();
    return { ok: true, data: await setMyPdaPreferences(supabase, density, startTab) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Your preferences could not be saved") };
  }
}

const SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Save the route (increment A). Everything is RECOMPUTED here from the member's own selection — the page sends the
 * inputs only, never figures — and the immutable set (both legs + route snapshot) is written in one database
 * transaction by the service-only pda_save_estimate_set, which re-checks tier, seat, tariff version, sums and evidence
 * and computes the content hash itself.
 */
/** The figures the member saw; the save refuses if the server's recomputation differs (B2O-044 P2-2). */
export interface PdaSaveExpectation {
  loadPortKnown: number | null;
  dischargePortKnown: number | null;
  allInKnown: number | null;
  allInComplete: number | null;
}

const sameFigure = (a: number | null | undefined, b: number | null | undefined) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005);

export async function savePdaRouteEstimate(raw: PdaRoutePreviewInput, supersedesId?: string | null, expected?: PdaSaveExpectation | null): Promise<ActionResult<PdaSaveSetResult>> {
  try {
    if (supersedesId != null && !SET_ID.test(supersedesId)) throw new UserFacingActionError("Unknown saved estimate");
    // a saved manual line records the owner MARKER, never the member's name (B2O-044 P1-4): the read resolves it, and
    // erasure then shows "Deleted account" instead of a name frozen in an immutable record
    const route = { ...(await prepareRoutePreview(raw)), manualActorLabel: PDA_OWNER_MARKER };
    const [load, discharge, frame] = await Promise.all([
      computeRouteLeg(route, "load"),
      computeRouteLeg(route, "discharge"),
      computeRouteFrame(route),
    ]);
    const result = composePdaRoutePreview({ displayCurrency: route.input.displayCurrency, allocation: route.input.allocation, frame, load, discharge });
    if (expected && !(sameFigure(expected.loadPortKnown, result.totals.loadPortKnown) && sameFigure(expected.dischargePortKnown, result.totals.dischargePortKnown)
        && sameFigure(expected.allInKnown, result.totals.allInKnown) && sameFigure(expected.allInComplete, result.totals.allInComplete))) {
      throw new UserFacingActionError("The figures changed since your preview (a tariff or exchange rate may just have been updated). Nothing was saved; review the estimate and save again.");
    }
    const saved = await savePdaEstimateSet(getSupabaseAdminClient(), {
      actorId: route.appUserId,
      ownerOrgId: route.ownerOrgId,
      loadRequest: load.request,
      loadResult: load.result,
      dischargeRequest: discharge.request,
      dischargeResult: discharge.result,
      route: pdaRouteSnapshot(route.input, result, route.vessel.name ?? null),
      supersedesId: supersedesId ?? null,
    });
    return { ok: true, data: saved };
  } catch (error) {
    if (error instanceof Error && /^PDA_CONFLICT: /.test(error.message)) {
      // the database's conflict messages are written for members (already superseded / not the same vessel and cargo)
      const text = error.message.replace(/^PDA_CONFLICT: /, "");
      return { ok: false, error: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
    }
    if (error instanceof Error && /^PDA_AUTH: only the owner/.test(error.message)) {
      return { ok: false, error: "Only the member who saved an estimate can save a new version of it." };
    }
    return { ok: false, error: actionErrorMessage(error, "The estimate could not be saved") };
  }
}

/** The member's saved estimates (and their organisation's), newest first; `before` pages back. */
export async function listPdaEstimateSets(before?: string | null): Promise<ActionResult<PdaEstimateSetSummary[]>> {
  try {
    const { supabase } = await viewer();
    const cursor = before && !Number.isNaN(Date.parse(before)) ? before : null;
    return { ok: true, data: await listMyPdaEstimateSets(supabase, cursor) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Saved estimates could not be loaded") };
  }
}

/** One saved estimate, read through the member's own session (the database decides who may read it). */
export async function loadPdaEstimateSet(setId: string): Promise<ActionResult<PdaEstimateSetDetail>> {
  try {
    if (!SET_ID.test(setId)) throw new UserFacingActionError("Unknown saved estimate");
    const { supabase } = await viewer();
    return { ok: true, data: await getPdaEstimateSet(supabase, setId) };
  } catch (error) {
    if (error instanceof Error && /^PDA_AUTH/.test(error.message)) return { ok: false, error: "This saved estimate is not available to you." };
    return { ok: false, error: actionErrorMessage(error, "The saved estimate could not be loaded") };
  }
}

/**
 * Export a SAVED set as a PDF (increment A): read through the member's own session (the database decides who may read
 * it), rendered on the server by the deterministic Unicode engine. Returned as base64 for a browser download.
 */
export async function exportPdaEstimateSetPdf(setId: string): Promise<ActionResult<{ fileName: string; sha256: string; base64: string }>> {
  try {
    if (!SET_ID.test(setId)) throw new UserFacingActionError("Unknown saved estimate");
    const { supabase } = await viewer();
    const set = await getPdaEstimateSet(supabase, setId);
    const { renderPdaEstimateSetPdf } = await import("@/lib/pda/estimate-set-pdf");
    const pdf = await renderPdaEstimateSetPdf(set);
    return { ok: true, data: { fileName: pdf.fileName, sha256: pdf.sha256, base64: Buffer.from(pdf.bytes).toString("base64") } };
  } catch (error) {
    if (error instanceof Error && /^PDA_AUTH/.test(error.message)) return { ok: false, error: "This saved estimate is not available to you." };
    return { ok: false, error: actionErrorMessage(error, "The PDF could not be produced") };
  }
}
