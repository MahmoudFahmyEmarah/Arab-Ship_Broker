import { redirect } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCargoViews } from "@/lib/portal/data";
import { ComingSoon } from "@/components/portal/ComingSoon";
import { resolveCalculatorAccess } from "@/lib/voyage/calculator-access";
import { CalculatorLocked } from "@/components/portal/calculators";
import { VoyageEstimatorV2 } from "@/components/voyage/VoyageEstimatorV2";
import { getSuezTariffContext } from "@/sdk/app/suez";
import { getVoyageSettings } from "@/sdk/app/voyage";
import { loadFuelIndex } from "@/lib/voyage/fuel-source";
import { voyageOptionFromAdminRow, type AdminVoyageVesselRow, type VoyageVesselOption } from "@/lib/voyage/vessel-options";
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
  // The admin vessel list reads the master tables through the service role; only an admin reaches it today (member rollout off).
  const [vessels, cargos, settingsLoad] = await Promise.all([access.kind === "admin" ? loadAdminVoyageVessels() : Promise.resolve([] as VoyageVesselOption[]), loadCargoViews(), getVoyageSettings(supabase)]);
  let suezContext: SuezTariffContextResult = { found: false, date: today };
  try { suezContext = await getSuezTariffContext(supabase, today); } catch { /* unavailable state */ }
  // The frozen B→S index snapshot (status unavailable until Stream B's index is wired → fallback prices, labelled).
  const fuel = await loadFuelIndex(null);

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
      initialVesselId={typeof params.vessel === "string" ? params.vessel : undefined}
      initialCargoId={typeof params.cargo === "string" ? params.cargo : undefined}
    />
  );
}
