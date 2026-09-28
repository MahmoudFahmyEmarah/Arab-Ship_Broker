import { redirect } from "next/navigation";

import { PdaRouteEstimator } from "@/components/pda/PdaRouteEstimator";
import { CalculatorLocked } from "@/components/portal/calculators";
import type { PdaEstimatorSearchParams } from "@/lib/pda/estimator-contract";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadPdaEstimatorPageData } from "./bootstrap.server";

export const metadata = { title: "Port DA Estimator · Arab ShipBroker" };

export default async function PortsDaPage({ searchParams }: { searchParams: Promise<PdaEstimatorSearchParams> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Port DA Estimator" />;

  const today = new Date().toISOString().slice(0, 10);
  const pageData = await loadPdaEstimatorPageData(supabase, await searchParams, today);
  return <PdaRouteEstimator {...pageData} />;
}
