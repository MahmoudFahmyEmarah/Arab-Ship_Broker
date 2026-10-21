import { redirect } from "next/navigation";

import { PdaAgentPage } from "@/components/pda/PdaAgentPage";
import { RecordMissing } from "@/components/pda/PdaRecordShell";
import { CalculatorLocked } from "@/components/portal/calculators";
import { findAgency, isPdaAgencyHandle } from "@/lib/pda/agent-page";
import { parsePdaMyAgency } from "@/lib/pda/agents";
import { isoDayOrToday } from "@/lib/pda/tariff-packs";
import { loadViewerContext } from "@/lib/portal/data";
import { isCalculatorLocked } from "@/lib/portal/tier-gate";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listPdaPortAgents } from "@/sdk/app/pda";
import { logPdaLoadFailure } from "@/lib/pda/load-failure";

export const metadata = { title: "Attending agent · Arab ShipBroker" };

const BACK = { href: "/dashboard/ports-da?tab=agents", label: "Back to Agents" };

export default async function AttendingAgentPage({ params, searchParams }: { params: Promise<{ agencyId: string }>; searchParams: Promise<{ on?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier } = await loadViewerContext();
  if (isCalculatorLocked(tier)) return <CalculatorLocked title="Attending agent" />;

  const { agencyId } = await params;
  const on = isoDayOrToday((await searchParams).on);
  // an unknown handle is said out loud, never answered with another agency's page
  if (!isPdaAgencyHandle(agencyId)) return <RecordMissing eyebrow="Attending agent" title="That is not an agency handle" text="Agency pages open from a port record's Attending agents table." back={BACK} />;
  let agency = null;
  let isStaff = false;
  try {
    agency = findAgency(await listPdaPortAgents(supabase), agencyId);
    // the agency's own staff (get_my_pda_agency decides) see a link to their Agent Portal; other members do not
    const { data: mine } = await supabase.rpc("get_my_pda_agency");
    isStaff = parsePdaMyAgency(mine)?.agencyId.toLowerCase() === agencyId.toLowerCase();
  } catch (error) {
    logPdaLoadFailure("attending agent", error);
    return <RecordMissing eyebrow="Attending agent" title="The agency page could not be loaded" text="Try again in a moment." back={BACK} />;
  }
  if (!agency) return <RecordMissing eyebrow="Attending agent" title="No listed agency carries that handle" text="Only agencies Arab ShipBroker has invited and listed at an active, verified port have a page. Rather than fall back to another agency, this page stops here; open one from a port record." back={BACK} />;
  return <PdaAgentPage agency={agency} on={on} isStaff={isStaff} />;
}
