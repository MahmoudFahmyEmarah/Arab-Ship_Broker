import { redirect } from "next/navigation";

import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { PdaTariffPackRecord } from "@/components/pda/PdaTariffPackRecord";
import { CalculatorLocked } from "@/components/portal/calculators";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isPdaTariffPackRef, isoDayOrToday } from "@/lib/pda/tariff-packs";
import { isPdaTariffPackTab } from "@/lib/pda/tariff-pack-record";
import { getPdaTariffPack } from "@/sdk/app/pda";

export const metadata = { title: "Tariff pack · Arab ShipBroker" };

export default async function TariffPackPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ on?: string; tab?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Tariff pack" />;

  const { ref } = await params;
  const query = await searchParams;
  const on = isoDayOrToday(query.on);
  const tab = isPdaTariffPackTab(query.tab) ? query.tab : "pack";

  let record = null;
  let failed = false;
  if (isPdaTariffPackRef(ref)) {
    try {
      record = await getPdaTariffPack(supabase, ref, on);
    } catch {
      failed = true;
    }
  }
  if (!record) {
    // an unknown pack is said out loud, never answered with another authority's tariff
    return <RecordMissing eyebrow="Tariff pack" title={failed ? "The pack could not be loaded" : "No pack in force under this reference"}
      text={failed ? "Try again in a moment." : "Nothing published and in force on this date cites that document, so there is no record to show. Rather than fall back to another authority's tariff, this page stops here."}
      back={{ href: `/dashboard/ports-da/tariff-packs?on=${on}`, label: "Back to Tariff Packs" }} />;
  }
  return <PdaTariffPackRecord record={record} tab={tab} on={on} />;
}
