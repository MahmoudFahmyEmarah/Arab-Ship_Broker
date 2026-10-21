import { redirect } from "next/navigation";

import { PdaTariffLayouts } from "@/components/pda/PdaTariffLayouts";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import { isoDayOrToday, type PdaTariffPack } from "@/lib/pda/tariff-packs";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listPdaTariffPacks } from "@/sdk/app/pda";

export const metadata = { title: "Tariff Layouts · Arab ShipBroker" };

export default async function TariffLayoutsPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Tariff Layouts" />;

  const on = isoDayOrToday((await searchParams).on);
  let packs: PdaTariffPack[] | null = null;
  try {
    packs = await listPdaTariffPacks(supabase, on);
  } catch {
    packs = null;
  }
  if (!packs) return <RecordMissing eyebrow="Tariff Layouts" title="The tariff library could not be loaded" text="Try again in a moment." back={{ href: `/dashboard/ports-da/tariff-packs?on=${on}`, label: "Back to Tariff Packs" }} />;
  return <PdaTariffLayouts packs={packs} on={on} />;
}
