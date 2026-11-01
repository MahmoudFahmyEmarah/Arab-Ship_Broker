import { redirect } from "next/navigation";

import { PdaAgentPortal } from "@/components/pda/PdaAgentPortal";
import { parsePdaMyAgency } from "@/lib/pda/agents";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Agent Portal · Arab ShipBroker" };

// The agency's side of the Agent Portal (Agents phase 2; the design's frame, owner B2ALL-061). Open to staff of an
// ASB-invited agency only; the database decides (get_my_pda_agency). No PDA subscription is needed.
export default async function AgencyInboxPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: agency } = await supabase.rpc("get_my_pda_agency");
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <PdaAgentPortal mode="agency" agency={parsePdaMyAgency(agency)} />
    </div>
  );
}
