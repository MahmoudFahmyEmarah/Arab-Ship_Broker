import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadViewerContext, loadVesselViews, loadCargoViews } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier";
import { PortsDA, CalculatorLocked } from "@/components/portal/calculators";

export const metadata = { title: "Ports DA Calculator — Arab ShipBroker" };

export default async function PortsDaPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Ports DA Calculator" />;

  const [vessels, cargos] = await Promise.all([loadVesselViews(), loadCargoViews()]);
  return <PortsDA vessels={vessels.views} cargos={cargos.views} />;
}
