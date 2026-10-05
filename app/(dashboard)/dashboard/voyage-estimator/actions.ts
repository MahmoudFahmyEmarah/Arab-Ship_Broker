"use server";

// Voyage estimator — member-session reads and the save (Voyage Economics, Stream S).
//
// Every action passes the calculator entitlement first (one guard for pages and
// actions, audit C2O-039 P0-4). The save recomputes everything on the server
// from governed truth (P0-3): each sea leg is re-resolved from its UN/LOCODEs
// through get_port_route + fn_route_eca_split (a browser-supplied distance is
// accepted only as a stamped manual value with its reason); the voyage
// settings, the fuel index snapshot, the Suez tariff context and the canal
// status are loaded or derived here; a port DA can only be a stamped manual
// figure until the PDA link exists. What is stored is the server's result.

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPortRoute } from "@/sdk/app/routes";
import { getRouteEcaSplit, getSuezTariffContext } from "@/sdk/app/suez";
import { getVoyageSettings, saveVoyageEstimate } from "@/sdk/app/voyage";
import { estimateVoyage } from "@/lib/voyage/engine";
import { parseVoyageInput } from "@/lib/voyage/schemas";
import { loadFuelIndex } from "@/lib/voyage/fuel-source";
import { canalFromSuez } from "@/lib/voyage/canal";
import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
import { calculatorDenialMessage } from "@/lib/voyage/calculator-policy";
import { estimateSuezTransit } from "@/lib/suez/engine";
import { SUEZ_ALGORITHM_VERSION, type SuezEstimate, type SuezInput } from "@/lib/suez/types";
import { ECA_SPLIT_ALGORITHM_VERSION, VOYAGE_ALGORITHM_VERSION, hashSettings, sealSnapshot, type ManualProvenance, type PortCostSnapshot, type RouteEcaClassification, type SnapshotStatus, type SuezCostSnapshot } from "@/lib/voyage/snapshots";
import type { CanalInput, SeaLegInput, VoyageInput } from "@/lib/voyage/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function lookupLeg(supabase: SupabaseClient, a: string, b: string, asOf?: string): Promise<RouteLegResult> {
  const [route, split] = await Promise.all([getPortRoute(supabase, a, b), getRouteEcaSplit(supabase, a, b, asOf)]);
  if (!route) return { ...NO_ROUTE, asOf: split.asOf ?? null };
  const waypoints = split.found && split.method === "waypoints";
  return {
    found: true,
    nm: route.totalNm,
    ecaNm: waypoints ? (split.ecaNm ?? null) : null,
    chokepoints: route.chokepoints ?? [],
    method: waypoints ? "waypoints" : "distance_only",
    source: route.source,
    reversed: route.reversed,
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
  /** optional: the organisation that owns the estimate when the member holds several seats */
  ownerOrgId?: string | null;
  /** the member's facts; legs, settings, fuel, canal, Suez and actor are re-sourced on the server */
  input: VoyageInput;
  /** the Suez calculator input when the canal is required; recomputed against the tariff in force */
  suezInput: SuezInput | null;
}

type RouteLegSnap = RouteEcaClassification["legs"][number];

export async function saveVoyageEstimateAction(payload: SaveVoyagePayload): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    const { access, supabase } = await resolveCalculatorAccess();
    if (!access.allowed) return { ok: false, error: calculatorDenialMessage(access.reason) };
    const actorId = access.actorId;
    const admin = getSupabaseAdminClient();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const stamp = (m: ManualProvenance | undefined): ManualProvenance | undefined => (m ? { actorUserId: actorId, reason: String(m.reason ?? "").trim(), at: now } : undefined);
    const client = payload?.input;
    if (!client || typeof client !== "object" || !client.legs || !client.ports) return { ok: false, error: "The estimate input is missing." };

    // ── server truth: settings, fuel index ────────────────────────────────
    const settingsLoad = await getVoyageSettings(supabase);
    const requestedPort = typeof client.fuel?.requestedPort === "string" ? client.fuel.requestedPort : null;
    const fuel = await loadFuelIndex(requestedPort);

    // ── legs: re-resolved here; manual only with its reason ───────────────
    const geometry = new Map<string, string>();
    let splitAlgorithm: string | null = null;
    const noLeg = (key: "ballast" | "laden", from: string | null, to: string | null): { leg: SeaLegInput; snap: RouteLegSnap } => ({
      leg: { key, from, to, nm: null, ecaNm: null, method: "none" },
      snap: { key, pol: from, pod: to, totalNm: null, ecaNm: null, method: "none", source: null },
    });
    const resolveLeg = async (leg: SeaLegInput | null, key: "ballast" | "laden"): Promise<{ leg: SeaLegInput; snap: RouteLegSnap } | null> => {
      if (!leg) return null;
      const from = typeof leg.from === "string" && LOCODE.test(leg.from) ? leg.from : null;
      const to = typeof leg.to === "string" && LOCODE.test(leg.to) ? leg.to : null;
      if (leg.method === "manual") {
        const manual = stamp(leg.manual);
        const nm = typeof leg.nm === "number" ? leg.nm : null;
        const ecaNm = typeof leg.ecaNm === "number" ? leg.ecaNm : 0;
        return {
          leg: { key, from, to, nm, ecaNm, method: "manual", manual },
          snap: { key, pol: from, pod: to, totalNm: nm, ecaNm, method: "manual", source: null, manual },
        };
      }
      if (!from || !to) return noLeg(key, from, to);
      const r = await lookupLeg(supabase, from, to, today);
      r.geometryVersions.forEach((g) => geometry.set(g.code, g.geometryVersion));
      splitAlgorithm = splitAlgorithm ?? r.algorithmVersion;
      if (!r.found) return noLeg(key, from, to);
      const method = r.method === "waypoints" ? "waypoints" : "distance_only";
      return {
        leg: { key, from, to, nm: r.nm, ecaNm: r.ecaNm, method, routeSource: r.source },
        snap: { key, pol: from, pod: to, totalNm: r.nm, ecaNm: r.ecaNm, method, chokepoints: r.chokepoints, reversed: r.reversed, source: r.source },
      };
    };
    const [ballastLeg, ladenLeg] = await Promise.all([resolveLeg(client.legs.ballast ?? null, "ballast"), resolveLeg(client.legs.laden, "laden")]);
    if (!ladenLeg) return { ok: false, error: "The laden leg is missing." };

    // ── port DAs: manual with provenance, or none ─────────────────────────
    for (const p of [client.ports.load, client.ports.disch]) {
      if (p?.pda?.source === "tariff") return { ok: false, error: "A tariff-based port DA is not linked to the estimator yet; enter the DA as a manual figure with its reason." };
    }

    // ── canal: the Suez estimate recomputed against the tariff in force ───
    let suez: SuezEstimate | null = null;
    let suezContextFound = false;
    const clientCanal = client.canal ?? null;
    let canal: CanalInput | null = null;
    if (clientCanal?.required) {
      const si = payload.suezInput;
      if (si) {
        if (si.overrides?.sdrRate) si.overrides.sdrRate = { ...si.overrides.sdrRate, actorUserId: actorId, at: now };
        const ctx = await getSuezTariffContext(supabase, si.voyage?.transitDate);
        if (ctx.found) { suezContextFound = true; suez = estimateSuezTransit(si, ctx); }
      }
      canal = canalFromSuez(suez, settingsLoad.settings, !!clientCanal.anchorageInEca);
    }

    const input: VoyageInput = {
      ...client,
      legs: { ballast: ballastLeg?.leg ?? null, laden: ladenLeg.leg },
      ports: {
        load: { ...client.ports.load, pda: { ...client.ports.load.pda, manual: stamp(client.ports.load.pda?.manual) } },
        disch: { ...client.ports.disch, pda: { ...client.ports.disch.pda, manual: stamp(client.ports.disch.pda?.manual) } },
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
    const routeLegs = [...(ballastLeg ? [ballastLeg.snap] : []), ladenLeg.snap];
    const routeStatus: SnapshotStatus = routeLegs.some((l) => l.method === "none") ? "unavailable" : routeLegs.some((l) => l.method === "manual") ? "manual" : "trusted";
    const routeSnapshot = sealSnapshot<RouteEcaClassification>({
      kind: "route_eca", status: routeStatus, asOf: today, legs: routeLegs,
      geometryVersions: [...geometry].map(([code, geometryVersion]) => ({ code, geometryVersion })),
      algorithmVersion: splitAlgorithm ?? ECA_SPLIT_ALGORITHM_VERSION,
      warnings: result.warnings.filter((w) => /ECA|distance/i.test(w)),
    });
    const suezSnapshot = sealSnapshot<SuezCostSnapshot>({
      kind: "suez_cost",
      status: !canal?.required ? "trusted" : canal.status === "manual" ? "manual" : canal.status === "trusted" ? "trusted" : canal.status === "fallback" ? "fallback" : "unavailable",
      suezStatus: suez?.status ?? null,
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
      { kind: "cost", code: "canal", label: "Canal transit", status: c.canal.status, quantity: null, unit: null, rate: null, amountUsd: c.canal.usd, explanation: suezSnapshot.tariffVersionNo ? `Suez tariff v${suezSnapshot.tariffVersionNo} · ${suezSnapshot.suezStatus ?? "n/a"}` : c.canal.required ? "no tariff" : "not required" },
      { kind: "cost", code: "pda_load", label: "Load port DA", status: c.pdaLoad.status, quantity: null, unit: null, rate: null, amountUsd: c.pdaLoad.usd, explanation: portSnapshot.load.source },
      { kind: "cost", code: "pda_disch", label: "Discharge port DA", status: c.pdaDisch.status, quantity: null, unit: null, rate: null, amountUsd: c.pdaDisch.usd, explanation: portSnapshot.disch.source },
      { kind: "cost", code: "extras", label: "Insurance, stevedoring, other", status: "manual", quantity: null, unit: null, rate: null, amountUsd: c.extrasUsd, explanation: "broker-entered" },
      { kind: "cost", code: "opex", label: "Running cost", status: opexStatus, quantity: result.days.total, unit: "days", rate: result.opex.usdDay, amountUsd: c.opexUsd, explanation: `class ${result.opex.vesselClass}${result.opex.classAssumed ? " (assumed)" : ""} · settings ${result.settingsSource}` },
      ...(result.revenue ? [{ kind: "revenue", code: "net_freight", label: "Net freight", status: "manual", quantity: null, unit: null, rate: null, amountUsd: result.revenue.netFreightUsd, explanation: `TCE ${result.revenue.tceUsdDay} USD/day · broker-entered freight` }] : []),
    ];

    // Market handles are never persisted: only real UUIDs go to the RPC, which checks the actor may reference them.
    const asUuid = (v: string | null | undefined) => (typeof v === "string" && UUID.test(v) ? v : null);
    const id = await saveVoyageEstimate(admin, actorId, {
      label: payload.label,
      vesselId: asUuid(payload.vesselId),
      availabilityId: asUuid(payload.availabilityId),
      cargoListingId: asUuid(payload.cargoListingId),
      ownerOrgId: asUuid(payload.ownerOrgId ?? null),
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
    const msg = e instanceof Error ? e.message : "Could not save the estimate.";
    return { ok: false, error: msg.replace(/^VOYAGE_(FORBIDDEN|INVALID):\s*/, "") };
  }
}
