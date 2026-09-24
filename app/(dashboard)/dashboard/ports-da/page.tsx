import { redirect } from "next/navigation";

import { PdaEstimator, type PdaPortOption } from "@/components/pda/PdaEstimator";
import { CalculatorLocked } from "@/components/portal/calculators";
import { loadVesselViews, loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listPdaCoverage, listPdaTerminals } from "@/sdk/app/pda";

export const metadata = { title: "Port DA Estimator · Arab ShipBroker" };

export default async function PortsDaPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Port DA Estimator" />;

  const today = new Date().toISOString().slice(0, 10);
  const [vessels, coverage, terminals, portsResult] = await Promise.all([
    loadVesselViews(),
    listPdaCoverage(supabase, today),
    listPdaTerminals(supabase),
    supabase.from("ports").select("locode, trade_name, country").eq("is_active", true).eq("is_verified", true).order("trade_name").limit(1000),
  ]);
  if (portsResult.error) throw new Error(portsResult.error.message);
  const ports = (portsResult.data ?? []).map((port) => ({ locode: port.locode, name: port.trade_name, country: port.country })) satisfies PdaPortOption[];
  return <PdaEstimator ports={ports} coverage={coverage} terminals={terminals} vessels={vessels.views} />;
}
