import { redirect } from "next/navigation";

import { PdaPortRecord } from "@/components/pda/PdaPortRecord";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import type { PdaAgency } from "@/lib/pda/agents";
import { isPdaPortLocode, isPdaPortRecordTab } from "@/lib/pda/port-record";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listPdaPortAgents, listPdaPortsWorkspace, listPdaTariffPacks } from "@/sdk/app/pda";

export const metadata = { title: "Port record · Arab ShipBroker" };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const BACK = { href: "/dashboard/ports-da?tab=ports", label: "Back to Ports" };

export default async function PortRecordPage({ params, searchParams }: { params: Promise<{ locode: string }>; searchParams: Promise<{ on?: string; tab?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Port record" />;

  const locode = (await params).locode.toUpperCase();
  const query = await searchParams;
  const on = query.on && ISO_DAY.test(query.on) && !Number.isNaN(Date.parse(query.on)) ? query.on : new Date().toISOString().slice(0, 10);
  const tab = isPdaPortRecordTab(query.tab) ? query.tab : "particulars";

  // an unknown code is said out loud, never answered with another port's record
  if (!isPdaPortLocode(locode)) return <RecordMissing eyebrow="Port record" title="That is not a port code" text="A UN/LOCODE is two letters and three letters or digits." back={BACK} />;
  let port = null;
  let packs = null;
  try {
    const workspace = await listPdaPortsWorkspace(supabase, on);
    port = workspace.ports.find((p) => p.locode === locode) ?? null;
    packs = port ? await listPdaTariffPacks(supabase, on) : [];
  } catch {
    return <RecordMissing eyebrow="Port record" title="The port record could not be loaded" text="Try again in a moment." back={BACK} />;
  }
  if (!port || !packs) return <RecordMissing eyebrow="Port record" title={`No port record holds ${locode}`} text="No active, verified port carries that code, so there is no record to show. Rather than fall back to another port, this page stops here." back={BACK} />;

  // the agency registry ships with the Agents wave; before it, the section says so instead of failing the page
  let agents: PdaAgency[] | null;
  try {
    agents = await listPdaPortAgents(supabase, locode);
  } catch {
    agents = null;
  }
  return <PdaPortRecord input={{ port, packs, agents, on }} tab={tab} />;
}
