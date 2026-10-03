import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadViewerContext, loadVesselViews } from "@/lib/portal/data";
import { ComingSoon } from "@/components/portal/ComingSoon";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { CalculatorLocked } from "@/components/portal/calculators";
import { SuezCalculator } from "@/components/suez/SuezCalculator";
import { getSuezTariffContext } from "@/sdk/app/suez";
import type { SuezTariffContextResult } from "@/lib/suez/types";

export const metadata = { title: "Suez Canal Transit Cost Arab ShipBroker" };
export const dynamic = "force-dynamic";

export default async function SuezTollPage({ searchParams }: { searchParams: Promise<{ vessel?: string | string[] }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { tier, role } = await loadViewerContext();
  // Admin-only until a published SCA toll table and SDR rate exist in
  // production (PLAN-voyage-economics §5); then T3+ through the tier gate.
  if (role !== "admin") return <ComingSoon variant="compass" />;
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Suez Canal Transit Cost" />;

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let context: SuezTariffContextResult = { found: false, date: today };
  try { context = await getSuezTariffContext(supabase, today); } catch { /* the calculator shows the unavailable state */ }
  const vessels = await loadVesselViews();

  return (
    <SuezCalculator
      vessels={vessels.views}
      initialContext={context}
      initialVesselId={typeof params.vessel === "string" ? params.vessel : undefined}
    />
  );
}
