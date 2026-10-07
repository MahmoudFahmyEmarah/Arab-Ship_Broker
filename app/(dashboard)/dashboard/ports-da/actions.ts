"use server";

import { getAppUserRow } from "@/lib/app-user";
import { calculatePda } from "@/lib/pda/calculate";
import { aggregatePdaRoutePreview, derivePdaRouteTimeline } from "@/lib/pda/route-calculate";
import { pdaRoutePreviewSchema } from "@/lib/pda/route-schema";
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
import { getPdaCalculationContext, savePdaEstimate } from "@/sdk/app/pda";
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
async function activeFlagRegistry(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
): Promise<FlagStateRow[] | null> {
  const { data, error } = await supabase.from("flag_states").select("iso2, name, aliases, is_active").eq("is_active", true);
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
  const registry = await activeFlagRegistry(supabase);
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

export async function previewPdaRoute(raw: PdaRoutePreviewInput): Promise<ActionResult<PdaRoutePreviewResult>> {
  try {
    const parsed = pdaRoutePreviewSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: validationErrorMessage(parsed.error.issues, "Invalid route PDA request") };
    }
    const input = parsed.data as PdaRoutePreviewInput;
    const { supabase, manualActorLabel } = await viewer();
    const [{ vessel, cargo }] = await Promise.all([
      requireRouteSelections(input.selection),
      requireVerifiedPorts(supabase, [input.load.portLocode, input.discharge.portLocode]),
    ]);
    const timeline = derivePdaRouteTimeline(input.selection.quantityMt, input.timeline);
    const flagState = resolveFlagName(await activeFlagRegistry(supabase), vessel.flag);
    let loadRequest = canonicalRouteLeg({
      leg: input.load,
      vessel,
      cargo,
      quantityMt: input.selection.quantityMt,
      days: timeline.loadPortDays,
      manualActorLabel,
      flagState,
    });
    let dischargeRequest = canonicalRouteLeg({
      leg: input.discharge,
      vessel,
      cargo,
      quantityMt: input.selection.quantityMt,
      days: timeline.dischargePortDays,
      manualActorLabel,
      flagState,
    });
    const [loadContext, dischargeContext] = await Promise.all([
      getPdaCalculationContext(supabase, loadRequest),
      getPdaCalculationContext(supabase, dischargeRequest),
    ]);
    const [loadFx, dischargeFx] = await Promise.all([
      forDisplayCurrency(supabase, loadRequest, loadContext.tariffVersion?.currency ?? null, input.displayCurrency),
      forDisplayCurrency(supabase, dischargeRequest, dischargeContext.tariffVersion?.currency ?? null, input.displayCurrency),
    ]);
    loadRequest = loadFx.request;
    dischargeRequest = dischargeFx.request;
    const load = calculatePda(loadRequest, loadContext.tariffVersion ?? null);
    const discharge = calculatePda(dischargeRequest, dischargeContext.tariffVersion ?? null);

    return {
      ok: true,
      data: aggregatePdaRoutePreview({
        displayCurrency: input.displayCurrency,
        allocation: input.allocation,
        canonical: {
          vesselAvailabilityId: vessel.ownedListingId!,
          vesselId: vessel.vesselId && UUID.test(vessel.vesselId) ? vessel.vesselId : null,
          cargoId: cargo.ownedListingId!,
          quantityMt: input.selection.quantityMt,
          loadRequest,
          dischargeRequest,
        },
        load,
        discharge,
        timeline,
        transitFacts: await routeTransits(supabase, input.load.portLocode, input.discharge.portLocode, timeline, vessel),
        fxRates: [
          ...(loadFx.fx ? [{ ...loadFx.fx, leg: "load" as const }] : []),
          ...(dischargeFx.fx ? [{ ...dischargeFx.fx, leg: "discharge" as const }] : []),
        ],
      }),
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to calculate route PDA") };
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
