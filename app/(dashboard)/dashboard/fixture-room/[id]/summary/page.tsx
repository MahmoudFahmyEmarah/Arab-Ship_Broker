import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SummaryPrint } from "@/components/fixture-room/SummaryPrint";
import { isFixtureError } from "@/lib/fixture-room/errors";
import { loadFixtureRoom } from "../../actions";
import "@/components/fixture-room/fixture-room.css";

export const metadata = { title: "Negotiation summary Arab ShipBroker" };
export const dynamic = "force-dynamic";

// The Negotiation Summary: every round so far, from the requester's own masked
// read model (the same governed read as the room; a non-party gets a 404).
export default async function FixtureSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const view = await loadFixtureRoom(id);
  if (isFixtureError(view)) {
    if (view.code === "AUTH" || view.code === "NOT_FOUND") notFound();
    return <div className="nr fxm-wrap"><div className="fxm"><div className="nr-banner is-error" role="alert"><div className="nr-banner__body">{view.message}</div></div></div></div>;
  }
  return <SummaryPrint view={view} />;
}
