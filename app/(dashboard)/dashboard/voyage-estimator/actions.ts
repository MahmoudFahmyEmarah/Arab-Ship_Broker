"use server";

// Voyage estimator — member-session reads and the save (Voyage Economics, Stream S).
//
// The save recomputes everything on the server from governed truth: the
// member's facts (vessel profile, legs, port times, DAs, revenue, extras) are
// validated through the fail-closed input schema; the voyage settings, the fuel
// index snapshot, the Suez tariff context and the actor identity are loaded
// here, never taken from the browser. What is stored is the server's result.

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPortRoute } from "@/sdk/app/routes";
import { getRouteEcaSplit, getSuezTariffContext } from "@/sdk/app/suez";
import { getVoyageSettings, saveVoyageEstimate } from "@/sdk/app/voyage";
import { estimateVoyage } from "@/lib/voyage/engine";
import { parseVoyageInput } from "@/lib/voyage/schemas";
import { loadFuelIndex } from "@/lib/voyage/fuel-source";
import { estimateSuezTransit } from "@/lib/suez/engine";
import { SUEZ_ALGORITHM_VERSION, type SuezEstimate, type SuezInput } from "@/lib/suez/types";
import { ECA_SPLIT_ALGORITHM_VERSION, VOYAGE_ALGORITHM_VERSION, hashSettings, sealSnapshot, type ManualProvenance, type PortCostSnapshot, type RouteEcaClassification, type SnapshotStatus, type SuezCostSnapshot } from "@/lib/voyage/snapshots";
import type { CanalInput, VoyageInput } from "@/lib/voyage/types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RouteLegResult {
  found: boolean;
  nm: number | null;
  ecaNm: number | null; // null = share unknown (distance-only route)
  chokepoints: string[];
  method: "waypoints" | "distance_only" | "none";
  source: string | null;
  reversed: boolean;
  asOf: string | null;
  geometryVersions: { code: string; geometryVersion: string }[];
  algorithmVersion: string | null;
}

const NO_ROUTE: RouteLegResult = { found: false, nm: null, ecaNm: null, chokepoints: [], method: "none", source: null, reversed: false, asOf: null, geometryVersions: [], algorithmVersion: null };

// Measured distance and its ECA share for one leg, both through the member session.
export async function routeLegAction(pol: string, pod: string, asOf?: string): Promise<ActionResult<RouteLegResult>> {
  const a = (pol ?? "").trim().toUpperCase();
  const b = (pod ?? "").trim().toUpperCase();
  if (!LOCODE.test(a) || !LOCODE.test(b)) return { ok: false, error: "Both ports need a UN/LOCODE." };
  if (asOf != null && !ISO_DATE.test(asOf)) return { ok: false, error: "The as-of date must be YYYY-MM-DD." };
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Please sign in." };
    const [route, split] = await Promise.all([getPortRoute(supabase, a, b), getRouteEcaSplit(supabase, a, b, asOf)]);
    if (!route) return { ok: true, data: NO_ROUTE };
    return {
      ok: true,
      data: {
        found: true,
        nm: route.totalNm,
        ecaNm: split.found && split.method === "waypoints" ? (split.ecaNm ?? null) : null,
        chokepoints: route.chokepoints ?? [],
        method: split.found && split.method === "waypoints" ? "waypoints" : "distance_only",
        source: route.source,
        reversed: route.reversed,
        asOf: split.asOf ?? null,
        geometryVersions: split.geometryVersions ?? [],
        algorithmVersion: split.algorithmVersion ?? null,
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
  /** the member's facts; settings, fuel, Suez and actor are re-sourced on the server */
  input: VoyageInput;
  /** the Suez calculator input when the canal is required; recomputed against the tariff in force */
  suezInput: SuezInput | null;
  routeLegs: RouteEcaClassification["legs"];
  routeMeta: { asOf: string | null; geometryVersions: { code: string; geometryVersion: string }[]; algorithmVersion: string | null };
}

export async function saveVoyageEstimateAction(payload: SaveVoyagePayload): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Please sign in." };
    const admin = getSupabaseAdminClient();
    const { data: row } = await admin.from("users").select("id").eq("supabase_user_id", user.id).maybeSingle();
    const actorId = row?.id as string | undefined;
    if (!actorId) return { ok: false, error: "Your account has no portal profile; the estimate cannot be attributed." };
    const now = new Date().toISOString();
    const stamp = (m: ManualProvenance | undefined): ManualProvenance | undefined => (m ? { actorUserId: actorId, reason: String(m.reason ?? "").trim(), at: now } : undefined);

    // ── server truth: settings, fuel index, Suez ──────────────────────────
    const settingsLoad = await getVoyageSettings(supabase);
    const requestedPort = typeof payload.input?.fuel?.requestedPort === "string" ? payload.input.fuel.requestedPort : null;
    const fuel = await loadFuelIndex(requestedPort);

    let suez: SuezEstimate | null = null;
    let suezContextFound = false;
    const clientCanal = payload.input?.canal ?? null;
    let canal: CanalInput | null = null;
    if (clientCanal?.required) {
      const si = payload.suezInput;
      if (si) {
        if (si.overrides?.sdrRate) si.overrides.sdrRate = { ...si.overrides.sdrRate, actorUserId: actorId, at: now };
        const ctx = await getSuezTariffContext(supabase, si.voyage.transitDate);
        if (ctx.found) { suezContextFound = true; suez = estimateSuezTransit(si, ctx); }
      }
      const complete = !!suez && suez.status !== "invalid" && suez.totals.complete;
      canal = {
        required: true, name: "Suez",
        status: !complete ? "unavailable" : suez!.sdrRate.status === "manual" ? "manual" : "trusted",
        costUsd: complete ? suez!.totals.appliedUsd : null,
        transitDays: suez?.transitDays ?? settingsLoad.settings.suez.transitDays,
        anchorageDays: suez?.anchorageDays ?? settingsLoad.settings.suez.anchorageDays,
        anchorageInEca: !!clientCanal.anchorageInEca,
        nm: settingsLoad.settings.suez.nm,
        tariffVersionNo: suez?.tariffVersion.versionNo ?? null,
        complete,
      };
    } else if (clientCanal) {
      canal = { ...clientCanal, required: false };
    }

    const input: VoyageInput = {
      ...payload.input,
      legs: {
        ballast: payload.input.legs.ballast ? { ...payload.input.legs.ballast, manual: stamp(payload.input.legs.ballast.manual) } : null,
        laden: { ...payload.input.legs.laden, manual: stamp(payload.input.legs.laden.manual) },
      },
      ports: {
        load: { ...payload.input.ports.load, pda: { ...payload.input.ports.load.pda, manual: stamp(payload.input.ports.load.pda.manual) } },
        disch: { ...payload.input.ports.disch, pda: { ...payload.input.ports.disch.pda, manual: stamp(payload.input.ports.disch.pda.manual) } },
      },
      canal,
      fuel,
      settings: settingsLoad.settings,
      settingsSource: settingsLoad.status,
    };
    const parsed = parseVoyageInput(input);
    if (!parsed.ok) return { ok: false, error: `The estimate input is not valid: ${parsed.errors.slice(0, 4).join("; ")}` };
    const result = estimateVoyage(parsed.value);
    if (result.status === "invalid") return { ok: false, error: `The estimate could not be computed: ${(result.errors ?? []).slice(0, 4).join("; ")}` };

    // ── snapshots (sealed with their canonical SHA-256) ───────────────────
    const fuelSnapshot = sealSnapshot({ ...fuel, canonicalSha256: undefined });
    const routeLegs = payload.routeLegs.map((l) => ({ ...l, manual: stamp(l.manual) }));
    const routeStatus: SnapshotStatus = routeLegs.some((l) => l.method === "none") ? "unavailable" : routeLegs.some((l) => l.method === "manual") ? "manual" : "trusted";
    const routeSnapshot = sealSnapshot<RouteEcaClassification>({
      kind: "route_eca", status: routeStatus, asOf: payload.routeMeta?.asOf ?? null, legs: routeLegs,
      geometryVersions: payload.routeMeta?.geometryVersions ?? [], algorithmVersion: payload.routeMeta?.algorithmVersion ?? ECA_SPLIT_ALGORITHM_VERSION,
      warnings: result.warnings.filter((w) => /ECA|distance/i.test(w)),
    });
    const suezSnapshot = sealSnapshot<SuezCostSnapshot>({
      kind: "suez_cost",
      status: !canal?.required ? "trusted" : canal.status === "manual" ? "manual" : canal.status === "trusted" ? "trusted" : "unavailable",
      required: !!canal?.required,
      algorithmVersion: suez?.algorithmVersion ?? (canal?.required ? SUEZ_ALGORITHM_VERSION : null),
      tariffVersionNo: suez?.tariffVersion.versionNo ?? null,
      tariffSourceRef: suez?.tariffVersion.sourceRef ?? null,
      sdrRateUsd: suez?.sdrRate.rateUsd ?? null,
      sdrAsOf: suez?.sdrRate.asOf ?? null,
      sdrStatus: suez?.sdrRate.status ?? null,
      appliedUsd: canal?.complete ? suez!.totals.appliedUsd : null,
      potentialUsd: canal?.complete ? suez!.totals.potentialUsd : null,
      complete: !!canal?.complete,
      transitDays: canal?.transitDays ?? 0,
      anchorageDays: canal?.anchorageDays ?? 0,
      warnings: [...(canal?.required && !suezContextFound ? ["No published Suez tariff covers the transit date."] : []), ...(suez?.warnings ?? [])],
      manual: suez?.sdrRate.manual ? { actorUserId: actorId, reason: suez.sdrRate.manual.reason, at: now } : undefined,
    });
    const portSnapshot = sealSnapshot<PortCostSnapshot>({
      kind: "port_cost",
      status: [parsed.value.ports.load.pda.source, parsed.value.ports.disch.pda.source].some((s) => s === "none") ? "unavailable" : [parsed.value.ports.load.pda.source, parsed.value.ports.disch.pda.source].some((s) => s === "manual") ? "manual" : "trusted",
      load: { port: parsed.value.ports.load.port, usd: parsed.value.ports.load.pda.usd, source: parsed.value.ports.load.pda.source, manual: parsed.value.ports.load.pda.manual },
      disch: { port: parsed.value.ports.disch.port, usd: parsed.value.ports.disch.pda.usd, source: parsed.value.ports.disch.pda.source, manual: parsed.value.ports.disch.pda.manual },
      warnings: result.unavailable.filter((u) => u.code.startsWith("pda_")).map((u) => u.reason),
    });

    const c = result.costs;
    const lines = [
      ...result.legs.map((l) => ({ kind: "leg", code: l.key, label: l.label, status: l.status, quantity: l.days, unit: "days", rate: l.nm, amountUsd: null, explanation: l.note })),
      ...result.fuel.lines.map((f) => ({ kind: "fuel", code: f.productKey.toLowerCase(), label: f.productKey, status: f.status, quantity: f.mt, unit: "mt", rate: f.usdMt, amountUsd: f.usd, explanation: f.status === "trusted" ? `index average${f.pricePort ? ` @ ${f.pricePort}` : ""}${f.priceAsOf ? ` · ${f.priceAsOf}` : ""}` : f.status === "fallback" ? "admin fallback price (no live index)" : "price unavailable" })),
      { kind: "cost", code: "canal", label: "Canal transit", status: c.canal.status, quantity: null, unit: null, rate: null, amountUsd: c.canal.usd, explanation: suezSnapshot.tariffVersionNo ? `Suez tariff v${suezSnapshot.tariffVersionNo}` : c.canal.required ? "Suez estimate unavailable" : "not required" },
      { kind: "cost", code: "pda_load", label: "Load port DA", status: c.pdaLoad.status, quantity: null, unit: null, rate: null, amountUsd: c.pdaLoad.usd, explanation: portSnapshot.load.source },
      { kind: "cost", code: "pda_disch", label: "Discharge port DA", status: c.pdaDisch.status, quantity: null, unit: null, rate: null, amountUsd: c.pdaDisch.usd, explanation: portSnapshot.disch.source },
      { kind: "cost", code: "extras", label: "Insurance, stevedoring, other", status: "trusted", quantity: null, unit: null, rate: null, amountUsd: c.extrasUsd, explanation: "" },
      { kind: "cost", code: "opex", label: "Running cost", status: "trusted", quantity: result.days.total, unit: "days", rate: result.opex.usdDay, amountUsd: c.opexUsd, explanation: `class ${result.opex.vesselClass}${result.opex.classAssumed ? " (assumed)" : ""} × ${result.opex.multiplier}` },
      ...(result.revenue ? [{ kind: "revenue", code: "net_freight", label: "Net freight", status: "trusted", quantity: null, unit: null, rate: null, amountUsd: result.revenue.netFreightUsd, explanation: `TCE ${result.revenue.tceUsdDay} USD/day` }] : []),
    ];

    // Reference ids are kept only when the rows exist (the browser may hold market handles, which are never persisted).
    const UUID = /^[0-9a-f-]{36}$/i;
    const existing = async (table: string, id: string | null): Promise<string | null> => {
      if (!id || !UUID.test(id)) return null;
      const { data } = await admin.from(table).select("id").eq("id", id).maybeSingle();
      return data?.id ? String(data.id) : null;
    };
    const [vesselId, availabilityId, cargoListingId] = await Promise.all([
      existing("vessels", payload.vesselId), existing("vessel_availability", payload.availabilityId), existing("cargo_listings", payload.cargoListingId),
    ]);
    const id = await saveVoyageEstimate(admin, actorId, {
      label: payload.label,
      vesselId,
      availabilityId,
      cargoListingId,
      algorithmVersion: VOYAGE_ALGORITHM_VERSION,
      settingsHash: hashSettings(parsed.value.settings),
      input: { ...parsed.value, suezAlgorithmVersion: suez?.algorithmVersion ?? SUEZ_ALGORITHM_VERSION },
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
      warnings: [...result.warnings, ...result.unavailable.map((u) => u.reason)],
      lines,
    });
    return { ok: true, data: { id, status: result.status } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the estimate." };
  }
}
