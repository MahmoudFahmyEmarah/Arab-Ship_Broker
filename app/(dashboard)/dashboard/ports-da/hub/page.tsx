import { redirect } from "next/navigation";

import { PdaPortsHub, isPdaHubArm } from "@/components/pda/PdaPortsHub";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import { isoDayOrToday, type PdaTariffPack } from "@/lib/pda/tariff-packs";
import type { PdaPortCensus } from "@/lib/pda/port-census";
import type { PdaPortsWorkspace } from "@/lib/pda/ports-workspace";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPdaPortCensus, listPdaPortsWorkspace, listPdaTariffPacks } from "@/sdk/app/pda";
import { loadPdaEstimatorPageData, type PdaEstimatorPageData } from "../bootstrap.server";

export const metadata = { title: "Ports Module · Arab ShipBroker" };

const BACK = { href: "/dashboard/ports-da", label: "Back to the estimator" };

export default async function PortsHubPage({ searchParams }: { searchParams: Promise<{ arm?: string; on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Ports Module" />;

  const query = await searchParams;
  const on = isoDayOrToday(query.on);
  const arm = isPdaHubArm(query.arm) ? query.arm : "quick";
  let loaded: { census: PdaPortCensus; workspace: PdaPortsWorkspace; packs: PdaTariffPack[]; estimator: PdaEstimatorPageData } | null = null;
  try {
    const [census, workspace, packs, estimator] = await Promise.all([
      getPdaPortCensus(supabase),
      listPdaPortsWorkspace(supabase, on),
      listPdaTariffPacks(supabase, on),
      loadPdaEstimatorPageData(supabase, {}, on),
    ]);
    loaded = { census, workspace, packs, estimator };
  } catch {
    loaded = null;
  }
  if (!loaded) return <RecordMissing eyebrow="Ports Module" title="The Ports Module could not be loaded" text="Try again in a moment." back={BACK} />;
  const tariffHeld = loaded.workspace.ports.filter((p) => p.tariffs.length > 0).map((p) => p.locode);
  return (
    <PdaPortsHub arm={arm} census={loaded.census} packs={loaded.packs} cargos={loaded.estimator.bootstrap.catalog.cargos}
      vessels={loaded.estimator.bootstrap.catalog.vessels} catalogUnavailable={loaded.estimator.bootstrap.catalogState === "unavailable"} tariffHeld={tariffHeld} on={on} />
  );
}
