import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadViewerContext, loadCargoViews } from "@/lib/portal/data";
import { ComingSoon } from "@/components/portal/ComingSoon";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { CalculatorLocked } from "@/components/portal/calculators";
import { VoyageEstimatorV2 } from "@/components/voyage/VoyageEstimatorV2";
import { getSuezTariffContext } from "@/sdk/app/suez";
import { getVoyageSettings } from "@/sdk/app/voyage";
import { loadFuelPrices } from "@/lib/voyage/fuel-source";
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
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { tier, role } = await loadViewerContext();
  // Admin-only until a published Suez tariff and a live fuel index exist in
  // production (PLAN-voyage-economics §5); then T3+ through the tier gate.
  if (role !== "admin") return <ComingSoon variant="radar" />;
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Voyage Cost Estimator" />;

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const [vessels, cargos, settings] = await Promise.all([loadAdminVoyageVessels(), loadCargoViews(), getVoyageSettings(supabase)]);
  let suezContext: SuezTariffContextResult = { found: false, date: today };
  try { suezContext = await getSuezTariffContext(supabase, today); } catch { /* unavailable state */ }
  const fuel = await loadFuelPrices(settings, null);

  return (
    <VoyageEstimatorV2
      vessels={vessels}
      cargos={cargos.views}
      settings={settings}
      suezContext={suezContext}
      fuel={fuel}
      initialVesselId={typeof params.vessel === "string" ? params.vessel : undefined}
      initialCargoId={typeof params.cargo === "string" ? params.cargo : undefined}
    />
  );
}
