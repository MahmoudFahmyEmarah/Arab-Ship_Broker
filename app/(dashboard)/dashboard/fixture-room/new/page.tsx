import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadFixtureViewer } from "@/lib/fixture-room/viewer.server";
import { MatchBuilder } from "@/components/fixture-room/MatchBuilder";
import { FixtureLocked } from "@/components/fixture-room/FixtureLocked";
import { loadMatchBuilder } from "../actions";
import "@/components/fixture-room/fixture-room.css";

export const metadata = { title: "Start a fixture Arab ShipBroker" };
export const dynamic = "force-dynamic";

// The match builder: pick one own side, then a ranked counterpart from the
// existing match RPCs, never like to like. ?cargo=<id> or ?vessel=<id>
// pre-seeds the first pick (the card links the integration owner adds).
export default async function NewFixturePage({ searchParams }: { searchParams: Promise<{ cargo?: string; vessel?: string }> }) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  // decision D3 through the one shared rule (canUseFixtureRoom, audit FR-M4)
  const viewer = await loadFixtureViewer(supabase, user.id);
  if (!viewer.canCreate) return <FixtureLocked />;
  const sp = await searchParams;
  const data = await loadMatchBuilder({ cargo: sp.cargo ?? null, vessel: sp.vessel ?? null });
  return <MatchBuilder data={data} />;
}
