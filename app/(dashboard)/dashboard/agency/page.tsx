import { redirect } from "next/navigation";

import { PdaAgencyInbox } from "@/components/pda/PdaAgencyInbox";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Agency inbox · Arab ShipBroker" };

// The agency inbox (Agents phase 2). Open to staff of an ASB-invited agency only; the database decides (get_my_pda_agency).
export default async function AgencyInboxPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: agency } = await supabase.rpc("get_my_pda_agency");
  const listed = agency && typeof agency === "object" && "agencyId" in agency
    ? (agency as { displayName: string; ports: { portLocode: string; portName: string }[] })
    : null;
  return <PdaAgencyInbox agency={listed} />;
}
