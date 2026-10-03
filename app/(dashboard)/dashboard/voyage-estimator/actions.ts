"use server";

// Voyage estimator — member-session reads and the save (Voyage Economics, Stream S).

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPortRoute } from "@/sdk/app/routes";
import { getRouteEcaSplit } from "@/sdk/app/suez";
import { saveVoyageEstimate } from "@/sdk/app/voyage";
import { ECA_SPLIT_ALGORITHM_VERSION, SUEZ_ALGORITHM_VERSION, VOYAGE_ALGORITHM_VERSION, hashSettings, sealSnapshot, type FuelIndexSnapshot, type PortCostSnapshot, type RouteEcaClassification, type SuezCostSnapshot } from "@/lib/voyage/snapshots";
import type { VoyageEstimate, VoyageInput } from "@/lib/voyage/types";
import type { SuezEstimate } from "@/lib/suez/types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface RouteLegResult {
  found: boolean;
  nm: number | null;
  ecaNm: number | null;
  chokepoints: string[];
  method: "waypoints" | "distance_only" | "none";
  source: string | null;
  reversed: boolean;
}

// Measured distance and its ECA share for one leg, both through the member session.
export async function routeLegAction(pol: string, pod: string): Promise<ActionResult<RouteLegResult>> {
  const a = (pol ?? "").trim().toUpperCase();
  const b = (pod ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(a) || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(b)) return { ok: false, error: "Both ports need a UN/LOCODE." };
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Please sign in." };
    const [route, split] = await Promise.all([getPortRoute(supabase, a, b), getRouteEcaSplit(supabase, a, b)]);
    if (!route) return { ok: true, data: { found: false, nm: null, ecaNm: null, chokepoints: [], method: "none", source: null, reversed: false } };
    return {
      ok: true,
      data: {
        found: true,
        nm: route.totalNm,
        ecaNm: split.found ? (split.ecaNm ?? null) : null,
        chokepoints: route.chokepoints ?? [],
        method: split.found && split.method === "waypoints" ? "waypoints" : "distance_only",
        source: route.source,
        reversed: route.reversed,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Route lookup failed." };
  }
}

export interface SaveVoyagePayload {
  label: string | null;
  vesselId: string | null;
  availabilityId: string | null;
  cargoListingId: string | null;
  input: VoyageInput;
  result: VoyageEstimate;
  suez: SuezEstimate | null;
  fuel: Omit<FuelIndexSnapshot, "hash">;
  routeLegs: RouteEcaClassification["legs"];
  portCosts: Omit<PortCostSnapshot, "hash" | "kind" | "status" | "warnings">;
}

export async function saveVoyageEstimateAction(payload: SaveVoyagePayload): Promise<ActionResult<{ id: string }>> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Please sign in." };
    const admin = getSupabaseAdminClient();
    const { data: row } = await admin.from("users").select("id").eq("supabase_user_id", user.id).maybeSingle();
    const actorId = (row?.id as string | undefined) ?? user.id;

    const { input, result } = payload;
    const fuelSnapshot = sealSnapshot<FuelIndexSnapshot>({ ...payload.fuel, kind: "fuel_index" });
    const routeSnapshot = sealSnapshot<RouteEcaClassification>({
      kind: "route_eca",
      status: payload.routeLegs.every((l) => l.method === "waypoints" || l.method === "distance_only") ? "trusted" : payload.routeLegs.some((l) => l.method === "manual") ? "manual" : "unavailable",
      legs: payload.routeLegs,
      geometryVersion: "MED@2025-05-01",
      algorithmVersion: ECA_SPLIT_ALGORITHM_VERSION,
      warnings: result.warnings.filter((w) => /ECA|distance/i.test(w)),
    });
    const suezSnapshot = sealSnapshot<SuezCostSnapshot>({
      kind: "suez_cost",
      status: !input.canal?.required ? "unavailable" : payload.suez?.ok ? "trusted" : "unavailable",
      required: !!input.canal?.required,
      tariffVersionNo: payload.suez?.tariffVersion.versionNo ?? null,
      tariffSourceRef: payload.suez?.tariffVersion.sourceRef ?? null,
      sdrRateUsd: payload.suez?.sdrRate?.rateUsd ?? null,
      sdrAsOf: payload.suez?.sdrRate?.asOf ?? null,
      appliedUsd: payload.suez?.totals.appliedUsd ?? 0,
      potentialUsd: payload.suez?.totals.potentialUsd ?? 0,
      transitDays: input.canal?.transitDays ?? 0,
      anchorageDays: input.canal?.anchorageDays ?? 0,
      warnings: payload.suez?.warnings ?? [],
    });
    const portSnapshot = sealSnapshot<PortCostSnapshot>({
      kind: "port_cost",
      status: payload.portCosts.load.source === "tariff" && payload.portCosts.disch.source === "tariff" ? "trusted" : payload.portCosts.load.source === "none" && payload.portCosts.disch.source === "none" ? "unavailable" : "manual",
      load: payload.portCosts.load,
      disch: payload.portCosts.disch,
      warnings: result.warnings.filter((w) => /port DA/i.test(w)),
    });

    const lines = [
      ...result.legs.map((l) => ({ kind: "leg", code: l.key, label: l.label, quantity: l.days, unit: "days", rate: l.nm, amountUsd: null, explanation: l.note })),
      ...result.fuel.lines.map((f) => ({ kind: "fuel", code: f.productKey.toLowerCase(), label: f.productKey, quantity: f.mt, unit: "mt", rate: f.usdMt, amountUsd: f.usd, explanation: `${f.priceSource}${f.pricePort ? ` @ ${f.pricePort}` : ""}` })),
      { kind: "cost", code: "canal", label: "Canal transit", quantity: null, unit: null, rate: null, amountUsd: result.costs.canalUsd, explanation: suezSnapshot.tariffVersionNo ? `Suez tariff v${suezSnapshot.tariffVersionNo}` : "" },
      { kind: "cost", code: "pda_load", label: "Load port DA", quantity: null, unit: null, rate: null, amountUsd: result.costs.pdaLoadUsd, explanation: payload.portCosts.load.source },
      { kind: "cost", code: "pda_disch", label: "Discharge port DA", quantity: null, unit: null, rate: null, amountUsd: result.costs.pdaDischUsd, explanation: payload.portCosts.disch.source },
      { kind: "cost", code: "extras", label: "Insurance, stevedoring, other", quantity: null, unit: null, rate: null, amountUsd: result.costs.extrasUsd, explanation: "" },
      { kind: "cost", code: "opex", label: "Running cost", quantity: result.days.total, unit: "days", rate: result.opex.usdDay, amountUsd: result.costs.opexUsd, explanation: `class ${result.opex.vesselClass} × ${result.opex.multiplier}` },
      ...(result.revenue ? [{ kind: "revenue", code: "net_freight", label: "Net freight", quantity: null, unit: null, rate: null, amountUsd: result.revenue.netFreightUsd, explanation: `TCE ${result.revenue.tceUsdDay} USD/day` }] : []),
    ];

    const id = await saveVoyageEstimate(admin, actorId, {
      label: payload.label,
      vesselId: payload.vesselId,
      availabilityId: payload.availabilityId,
      cargoListingId: payload.cargoListingId,
      algorithmVersion: VOYAGE_ALGORITHM_VERSION,
      settingsHash: hashSettings(input.settings),
      input: { ...input, suezAlgorithmVersion: SUEZ_ALGORITHM_VERSION },
      result,
      fuelIndexSnapshot: fuelSnapshot,
      routeEcaSnapshot: routeSnapshot,
      suezCostSnapshot: suezSnapshot,
      portCostSnapshot: portSnapshot,
      totals: { days: result.days, fuelUsd: result.costs.fuelUsd, opexUsd: result.costs.opexUsd, canalUsd: result.costs.canalUsd, pdaUsd: result.costs.pdaLoadUsd + result.costs.pdaDischUsd, voyageCostsUsd: result.costs.voyageCostsUsd, totalUsd: result.costs.totalUsd, tceUsdDay: result.revenue?.tceUsdDay ?? null },
      warnings: result.warnings,
      lines,
    });
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the estimate." };
  }
}
