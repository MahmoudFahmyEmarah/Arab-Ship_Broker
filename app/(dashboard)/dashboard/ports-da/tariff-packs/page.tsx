import { redirect } from "next/navigation";

import { PdaTariffPacks } from "@/components/pda/PdaTariffPacks";
import { CalculatorLocked } from "@/components/portal/calculators";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listPdaTariffPacks } from "@/sdk/app/pda";
import type { PdaTariffPack } from "@/lib/pda/tariff-packs";

export const metadata = { title: "Tariff Packs · Arab ShipBroker" };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function TariffPacksPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Tariff Packs" />;

  const requested = (await searchParams).on;
  const on = requested && ISO_DAY.test(requested) && !Number.isNaN(Date.parse(requested)) ? requested : new Date().toISOString().slice(0, 10);
  let packs: PdaTariffPack[] = [];
  let error: string | undefined;
  try {
    packs = await listPdaTariffPacks(supabase, on);
  } catch {
    error = "The tariff library could not be loaded. Try again in a moment.";
  }
  return <PdaTariffPacks packs={packs} on={on} error={error} />;
}
