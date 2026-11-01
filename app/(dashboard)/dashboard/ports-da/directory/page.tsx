import { redirect } from "next/navigation";

import { PdaPortDirectory } from "@/components/pda/PdaPortDirectory";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import { isoDayOrToday } from "@/lib/pda/tariff-packs";
import type { PdaPortCensus, PortSortKey } from "@/lib/pda/port-census";
import type { PdaPortsWorkspace } from "@/lib/pda/ports-workspace";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPdaPortCensus, listPdaPortsWorkspace } from "@/sdk/app/pda";
import { logPdaLoadFailure } from "@/lib/pda/load-failure";

export const metadata = { title: "Port Directory · Arab ShipBroker" };

const SORTS: readonly PortSortKey[] = ["rank", "name", "country", "zone"];
const ZONE = /^[A-Z][A-Z.]{1,11}$/;
const BACK = { href: "/dashboard/ports-da", label: "Back to the estimator" };

export default async function PortDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; zone?: string; sort?: string; desc?: string; on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Port Directory" />;

  const query = await searchParams;
  const on = isoDayOrToday(query.on);
  const q = (query.q ?? "").slice(0, 80);
  const zone = query.zone && ZONE.test(query.zone) ? query.zone : null;
  const sort = SORTS.includes(query.sort as PortSortKey) ? (query.sort as PortSortKey) : "rank";
  const desc = query.desc === "1";
  let loaded: { census: PdaPortCensus; workspace: PdaPortsWorkspace } | null = null;
  try {
    const [census, workspace] = await Promise.all([getPdaPortCensus(supabase), listPdaPortsWorkspace(supabase, on)]);
    loaded = { census, workspace };
  } catch (error) {
    logPdaLoadFailure("directory", error);
    loaded = null;
  }
  if (!loaded) return <RecordMissing eyebrow="Port Directory" title="The directory could not be loaded" text="Try again in a moment." back={BACK} />;
  const tariffHeld = new Set(loaded.workspace.ports.filter((p) => p.tariffs.length > 0).map((p) => p.locode));
  return <PdaPortDirectory census={loaded.census} tariffHeld={tariffHeld} query={q} zone={zone} sort={sort} desc={desc} on={on} />;
}
