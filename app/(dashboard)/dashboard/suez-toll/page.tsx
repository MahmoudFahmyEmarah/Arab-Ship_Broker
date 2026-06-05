import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadViewerContext, loadVesselViews } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier";
import { SuezToll, CalculatorLocked } from "@/components/portal/calculators";

export const metadata = { title: "Suez Canal Toll — Arab ShipBroker" };

export default async function SuezTollPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Suez Canal Toll" />;

  const vessels = await loadVesselViews();
  return <SuezToll vessels={vessels.views} />;
}
