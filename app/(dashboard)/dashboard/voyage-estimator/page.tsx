import { redirect } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCargoViews, loadVesselViews } from "@/lib/portal/data";
import { ComingSoon } from "@/components/portal/ComingSoon";
import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
import { CalculatorLocked } from "@/components/portal/calculators";
import { VoyageEstimatorV2 } from "@/components/voyage/VoyageEstimatorV2";
import { getPointEcaZones, getSuezTariffContext, listEcaZones } from "@/sdk/app/suez";
import { getVoyageSettings } from "@/sdk/app/voyage";
import { loadFuelIndex, voyageFuelProducts } from "@/lib/voyage/fuel-source";
import { voyageOptionFromAdminRow, voyageOptionFromView, type AdminVoyageVesselRow, type VoyageVesselOption } from "@/lib/voyage/vessel-options";
import type { SuezTariffContextResult } from "@/lib/suez/types";

export const metadata = { title: "Voyage Cost Estimator Arab ShipBroker" };
export const dynamic = "force-dynamic";

// Admins pick from every current position with its hull and listing facts;
// the vessel master is closed to the authenticated role by the market
// firewall, so this read uses the service role after the admin gate.
async function loadAdminVoyageVessels(): Promise<VoyageVesselOption[]> {
  const db = getSupabaseAdminClient();
  const { data } = await db
    .from("vessel_availability")
    .select("id, vessel_id, open_port_locode, open_port_name, open_zone, service_speed_kn, vlsfo_sea_mt_day, vlsfo_port_mt_day, lsmgo_sea_mt_day, lsmgo_port_mt_day, me_consumption_mt_day, me_consumption_port_mt_day, aux_consumption_mt_day, aux_consumption_port_mt_day, scrubber_fitted, vessel:vessels(id, vessel_name, imo_number, vessel_type, dwt_grain, gross_tonnage, scnrt, build_year)")
    .order("open_date", { ascending: false })
    .limit(300);
  const seen = new Set<string>();
  const out: VoyageVesselOption[] = [];
  for (const row of (data ?? []) as unknown as AdminVoyageVesselRow[]) {
    const opt = voyageOptionFromAdminRow(row);
    if (!opt || !opt.vesselId || seen.has(opt.vesselId)) continue;
    seen.add(opt.vesselId);
    out.push(opt);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The organisations the actor may file an estimate under: current, active seats.
async function loadOwnerOrgs(actorId: string): Promise<{ id: string; name: string }[]> {
  const db = getSupabaseAdminClient();
  const { data } = await db.from("organization_members").select("org_id, org:organizations(id, name)").eq("user_id", actorId).eq("is_current", true).eq("status", "active");
  type Row = { org_id: string; org: { id: string; name: string | null } | { id: string; name: string | null }[] | null };
  return ((data ?? []) as unknown as Row[]).map((r) => { const o = Array.isArray(r.org) ? r.org[0] : r.org; return { id: r.org_id, name: o?.name ?? "Organisation" }; });
}

export default async function VoyageEstimatorPage({ searchParams }: { searchParams: Promise<{ vessel?: string | string[]; cargo?: string | string[] }> }) {
  // One entitlement rule for this page and every calculator action (lib/voyage/calculator-policy.ts).
  const { access, supabase } = await resolveCalculatorAccess();
  if (!access.allowed) {
    if (access.reason === "signed_out" || access.reason === "no_profile" || access.reason === "inactive") redirect("/auth/login");
    if (access.reason === "tier_locked") return <CalculatorLocked title="Voyage Cost Estimator" />;
    return <ComingSoon variant="radar" />;
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  // Admins: every current position through the service role. Members: their own positions through the governed
  // member read, the same visibility-safe loader the Suez page uses (C2O-043 #13, Opus B PR-03 d).
  const [vessels, cargos, settingsLoad, ownerOrgs] = await Promise.all([
    access.kind === "admin" ? loadAdminVoyageVessels() : loadVesselViews({ mine: true }).then((r) => r.views.map(voyageOptionFromView)),
    loadCargoViews(), getVoyageSettings(supabase), loadOwnerOrgs(access.actorId),
  ]);
  // The convoy anchorage per direction, tested against the ECA zones in force today (the save re-tests on the transit date).
  const anchorages = settingsLoad.settings.suez.anchorages ?? {};
  const anchorageEca: { SB?: boolean | null; NB?: boolean | null } = {};
  for (const d of ["SB", "NB"] as const) {
    const pt = anchorages[d];
    const zones = pt ? await getPointEcaZones(supabase, pt[0], pt[1], today) : null;
    anchorageEca[d] = zones == null ? null : zones.length > 0;
  }
  const zonesInForce = await listEcaZones(supabase, today).catch(() => []);
  const anchorageEcaConfidence: "official" | "coarse" = zonesInForce.length > 0 && zonesInForce.every((z) => z.confidence === "official") ? "official" : "coarse";
  let suezContext: SuezTariffContextResult = { found: false, date: today };
  try { suezContext = await getSuezTariffContext(supabase, today); } catch { /* unavailable state */ }
  // The frozen B→S index snapshot (status unavailable until Stream B's index is wired → fallback prices, labelled).
  // The page preview has no voyage yet: the index without a port (the save asks again for the load port).
  const fuel = await loadFuelIndex(supabase, { portLocode: null, productKeys: voyageFuelProducts(settingsLoad.settings.eca.fuelProductKey, settingsLoad.settings.eca.distillateProductKey, null) });

  return (
    <VoyageEstimatorV2
      vessels={vessels}
      cargos={cargos.views}
      settings={settingsLoad.settings}
      settingsSource={settingsLoad.status}
      settingsError={settingsLoad.error}
      suezContext={suezContext}
      fuel={fuel}
      viewerUserId={access.actorId}
      ownerOrgs={ownerOrgs}
      anchorageEca={anchorageEca}
      anchorageEcaConfidence={anchorageEcaConfidence}
      initialVesselId={typeof params.vessel === "string" ? params.vessel : undefined}
      initialCargoId={typeof params.cargo === "string" ? params.cargo : undefined}
    />
  );
}
