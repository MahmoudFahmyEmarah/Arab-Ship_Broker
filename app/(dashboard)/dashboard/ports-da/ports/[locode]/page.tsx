import { redirect } from "next/navigation";

import { PdaPortRecord } from "@/components/pda/PdaPortRecord";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import { isPdaPortLocode, isPdaPortRecordTab } from "@/lib/pda/port-record";
import { isoDayOrToday } from "@/lib/pda/tariff-packs";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadPortRecordInput } from "./load";

export const metadata = { title: "Port record · Arab ShipBroker" };

const BACK = { href: "/dashboard/ports-da?tab=ports", label: "Back to Ports" };

export default async function PortRecordPage({ params, searchParams }: { params: Promise<{ locode: string }>; searchParams: Promise<{ on?: string; tab?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Port record" />;

  const locode = (await params).locode.toUpperCase();
  const query = await searchParams;
  const on = isoDayOrToday(query.on);
  const tab = isPdaPortRecordTab(query.tab) ? query.tab : "particulars";

  // an unknown code is said out loud, never answered with another port's record
  if (!isPdaPortLocode(locode)) return <RecordMissing eyebrow="Port record" title="That is not a port code" text="A UN/LOCODE is two letters and three letters or digits." back={BACK} />;
  const loaded = await loadPortRecordInput(supabase, locode, on);
  if (loaded.kind === "failed") return <RecordMissing eyebrow="Port record" title="The port record could not be loaded" text="Try again in a moment." back={BACK} />;
  if (loaded.kind === "missing") return <RecordMissing eyebrow="Port record" title={`No port record holds ${locode}`} text="No active, verified port carries that code, so there is no record to show. Rather than fall back to another port, this page stops here." back={BACK} />;
  return <PdaPortRecord input={loaded.input} tab={tab} />;
}
