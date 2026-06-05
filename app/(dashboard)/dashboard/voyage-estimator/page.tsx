import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadViewerContext, loadVesselViews, loadCargoViews, loadFuelPrices } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier";
import { VoyageEstimator, CalculatorLocked } from "@/components/portal/calculators";

export const metadata = { title: "Voyage Cost Estimator — Arab ShipBroker" };

export default async function VoyageEstimatorPage({
  searchParams,
}: {
  searchParams: Promise<{ vessel?: string; cargo?: string }>;
}) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { tier } = await loadViewerContext();
  // Server-side tier gate (T3+) — do not rely on the client hiding it.
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Voyage Cost Estimator" />;

  const params = await searchParams;
  const [vessels, cargos, fuel] = await Promise.all([
    loadVesselViews(),
    loadCargoViews(),
    loadFuelPrices(),
  ]);

  return (
    <VoyageEstimator
      vessels={vessels.views}
      cargos={cargos.views}
      fuel={fuel}
      initialVesselId={params.vessel}
      initialCargoId={params.cargo}
    />
  );
}
