import { redirect } from "next/navigation";

import { PdaPortsMapPage } from "@/components/pda/PdaPortsMapPage";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import { isoDayOrToday } from "@/lib/pda/tariff-packs";
import type { PdaPortCensus } from "@/lib/pda/port-census";
import type { PdaPortsWorkspace } from "@/lib/pda/ports-workspace";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPdaPortCensus, listPdaPortsWorkspace } from "@/sdk/app/pda";

export const metadata = { title: "Ports Map · Arab ShipBroker" };

const BACK = { href: "/dashboard/ports-da", label: "Back to the estimator" };

export default async function PortsMapPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Ports Map" />;

  const on = isoDayOrToday((await searchParams).on);
  let loaded: { workspace: PdaPortsWorkspace; census: PdaPortCensus } | null = null;
  try {
    const [workspace, census] = await Promise.all([listPdaPortsWorkspace(supabase, on), getPdaPortCensus(supabase)]);
    loaded = { workspace, census };
  } catch {
    loaded = null;
  }
  if (!loaded) return <RecordMissing eyebrow="Ports Map" title="The map could not be loaded" text="Try again in a moment." back={BACK} />;
  return <PdaPortsMapPage ports={loaded.workspace.ports} census={loaded.census} on={on} />;
}
