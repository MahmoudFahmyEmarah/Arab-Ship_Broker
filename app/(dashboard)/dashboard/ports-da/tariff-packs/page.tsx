import { redirect } from "next/navigation";

import { PdaTariffPacks } from "@/components/pda/PdaTariffPacks";
import { CalculatorLocked } from "@/components/portal/calculators";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listPdaTariffPacks } from "@/sdk/app/pda";
import { isoDayOrToday, type PdaTariffPack } from "@/lib/pda/tariff-packs";
import { logPdaLoadFailure } from "@/lib/pda/load-failure";

export const metadata = { title: "Tariff Packs · Arab ShipBroker" };

export default async function TariffPacksPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Tariff Packs" />;

  const on = isoDayOrToday((await searchParams).on);
  let packs: PdaTariffPack[] = [];
  let error: string | undefined;
  try {
    packs = await listPdaTariffPacks(supabase, on);
  } catch (error) {
    logPdaLoadFailure("tariff packs", error);
    error = "The tariff library could not be loaded. Try again in a moment.";
  }
  return <PdaTariffPacks packs={packs} on={on} error={error} />;
}
