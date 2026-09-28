"use server";

import { getAppUserRow } from "@/lib/app-user";
import { calculatePda } from "@/lib/pda/calculate";
import { aggregatePdaRoutePreview, derivePdaRouteTimeline } from "@/lib/pda/route-calculate";
import { pdaRoutePreviewSchema } from "@/lib/pda/route-schema";
import type { PdaRouteLegInput, PdaRoutePreviewInput, PdaRoutePreviewResult } from "@/lib/pda/route-types";
import { pdaRequestSchema } from "@/lib/pda/schemas";
import type { PdaCalculationResult, PdaRequest } from "@/lib/pda/types";
import { loadCargoViews, loadVesselViews } from "@/lib/portal/data";
import type { CargoView, VesselView } from "@/lib/portal/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPdaCalculationContext, savePdaEstimate } from "@/sdk/app/pda";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      const messages = issues.flatMap((issue) => {
        if (!issue || typeof issue !== "object" || !("message" in issue)) return [];
        const message = (issue as { message?: unknown }).message;
        return typeof message === "string" && message.trim() ? [message.trim()] : [];
      });
      if (messages.length) return messages.join("; ");
    }
  }
  return error instanceof Error ? error.message : fallback;
}

async function viewer() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const appUser = await getAppUserRow<{
    id: string;
    full_name: string | null;
    role: string | null;
    subscription_tier: string | null;
    is_market_partner: boolean | null;
    is_active: boolean;
  }>(supabase, user.id, "id, full_name, role, subscription_tier, is_market_partner, is_active");
  if (!appUser?.is_active) throw new Error("Active account required");
  const entitled = appUser.role?.toLowerCase() === "admin"
    || appUser.is_market_partner === true
    || ["T3", "T4"].includes(appUser.subscription_tier ?? "T1");
  if (!entitled) throw new Error("PDA Estimator requires Subscriber tier (T3+)");
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

function authoritativeVesselFacts(vessel: VesselView): PdaRequest["vessel"] {
  return {
    vesselId: vessel.vesselId && UUID.test(vessel.vesselId) ? vessel.vesselId : null,
    vesselName: vessel.name,
    imo: vessel.imo,
    vesselType: vessel.type,
    gt: vessel.gt ?? null,
    scnrt: vessel.scnrt ?? null,
    dwt: numberFromDisplay(vessel.dwt),
    loaM: vessel.loaM ?? null,
  };
}

function canonicalRouteLeg(input: {
  leg: PdaRouteLegInput;
  vessel: VesselView;
  cargo: CargoView;
  quantityMt: number;
  days: number;
  manualActorLabel: string;
}): PdaRequest {
  return {
    portLocode: input.leg.portLocode,
    terminalId: input.leg.terminalId ?? null,
    // Tariff effectiveness is governed by the explicit calendar date at this
    // port. Voyage timeline instants are presentation/operations data only.
    callDate: input.leg.callDate,
    vessel: authoritativeVesselFacts(input.vessel),
    call: {
      days: input.days,
      hours: input.leg.call.hours ?? null,
      units: input.leg.call.units ?? null,
      cargoQuantityMt: input.quantityMt,
      cargoType: input.cargo.type,
      cargoStatus: input.leg.call.cargoStatus,
      voyageScope: input.leg.call.voyageScope,
      location: input.leg.call.location,
      requestedServices: input.leg.call.requestedServices,
    },
    manualLines: input.leg.manualLines?.map((line) => ({
      ...line,
      enteredBy: input.manualActorLabel,
    })),
  };
}

function forDisplayCurrency(
  request: PdaRequest,
  nativeCurrency: string | null,
  displayCurrency: string,
): PdaRequest {
  if (nativeCurrency === displayCurrency) {
    return { ...request, convertedCurrency: null, fxRate: null };
  }
  return { ...request, convertedCurrency: displayCurrency };
}

async function requireRouteSelections(
  selection: PdaRoutePreviewInput["selection"],
): Promise<{ vessel: VesselView; cargo: CargoView }> {
  const [vessels, cargos] = await Promise.all([
    loadVesselViews({ mine: true }),
    loadCargoViews({ mine: true }),
  ]);
  if (vessels.source !== "live" || cargos.source !== "live") {
    throw new Error("Live vessel or cargo records could not be loaded");
  }
  const vessel = vessels.views.find((item) => item.id === selection.vesselAvailabilityId);
  if (!vessel) throw new Error("The selected vessel is not available to this account");
  const cargo = cargos.views.find((item) => item.id === selection.cargoId);
  if (!cargo) throw new Error("The selected cargo is not available to this account");
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
  if (missing.length) throw new Error(`Verified port not found: ${missing.join(", ")}`);
}

export async function previewPda(raw: PdaRequest): Promise<ActionResult<PdaCalculationResult>> {
  try {
    const parsed = pdaRequestSchema.parse(raw) as PdaRequest;
    const { supabase, manualActorLabel } = await viewer();
    const request = attributeManualLines(parsed, manualActorLabel);
    const context = await getPdaCalculationContext(supabase, request);
    return { ok: true, data: calculatePda(request, context.tariffVersion ?? null) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to calculate PDA") };
  }
}

export async function persistPda(raw: PdaRequest): Promise<ActionResult<{ estimateId: string; result: PdaCalculationResult }>> {
  try {
    const parsed = pdaRequestSchema.parse(raw) as PdaRequest;
    const { supabase, appUser, manualActorLabel, ownerOrgId } = await viewer();
    const request = attributeManualLines(parsed, manualActorLabel);
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
    const input = pdaRoutePreviewSchema.parse(raw) as PdaRoutePreviewInput;
    const { supabase, manualActorLabel } = await viewer();
    const [{ vessel, cargo }] = await Promise.all([
      requireRouteSelections(input.selection),
      requireVerifiedPorts(supabase, [input.load.portLocode, input.discharge.portLocode]),
    ]);
    const timeline = derivePdaRouteTimeline(input.selection.quantityMt, input.timeline);
    let loadRequest = canonicalRouteLeg({
      leg: input.load,
      vessel,
      cargo,
      quantityMt: input.selection.quantityMt,
      days: timeline.loadPortDays,
      manualActorLabel,
    });
    let dischargeRequest = canonicalRouteLeg({
      leg: input.discharge,
      vessel,
      cargo,
      quantityMt: input.selection.quantityMt,
      days: timeline.dischargePortDays,
      manualActorLabel,
    });
    const [loadContext, dischargeContext] = await Promise.all([
      getPdaCalculationContext(supabase, loadRequest),
      getPdaCalculationContext(supabase, dischargeRequest),
    ]);
    loadRequest = forDisplayCurrency(
      loadRequest,
      loadContext.tariffVersion?.currency ?? null,
      input.displayCurrency,
    );
    dischargeRequest = forDisplayCurrency(
      dischargeRequest,
      dischargeContext.tariffVersion?.currency ?? null,
      input.displayCurrency,
    );
    const load = calculatePda(loadRequest, loadContext.tariffVersion ?? null);
    const discharge = calculatePda(dischargeRequest, dischargeContext.tariffVersion ?? null);

    return {
      ok: true,
      data: aggregatePdaRoutePreview({
        displayCurrency: input.displayCurrency,
        allocation: input.allocation,
        canonical: {
          vesselAvailabilityId: vessel.id,
          vesselId: vessel.vesselId && UUID.test(vessel.vesselId) ? vessel.vesselId : null,
          cargoId: cargo.id,
          quantityMt: input.selection.quantityMt,
          loadRequest,
          dischargeRequest,
        },
        load,
        discharge,
        timeline,
      }),
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Unable to calculate route PDA") };
  }
}
