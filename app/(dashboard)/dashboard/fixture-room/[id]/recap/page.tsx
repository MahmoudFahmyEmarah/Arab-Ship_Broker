import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { RecapPrint } from "@/components/fixture-room/RecapPrint";
import { isFixtureError } from "@/lib/fixture-room/errors";
import { loadFixtureRoom } from "../../actions";
import "@/components/fixture-room/fixture-room.css";

export const metadata = { title: "Fixture recap Arab ShipBroker" };
export const dynamic = "force-dynamic";

// The printable recap: the latest published version (immutable text from the
// server) with the acknowledgement state. Decision D7: in-app and print only.
export default async function FixtureRecapPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const view = await loadFixtureRoom(id);
  if (isFixtureError(view)) {
    if (view.code === "AUTH" || view.code === "NOT_FOUND") notFound();
    return <div className="nr fxm-wrap"><div className="fxm"><div className="nr-banner is-error" role="alert"><div className="nr-banner__body">{view.message}</div></div></div></div>;
  }
  const wanted = v ? Number(v) : null;
  const recap = (wanted ? view.recaps.find((r) => r.versionNo === wanted) : null) ?? view.recaps[0] ?? null;
  return <RecapPrint view={view} recap={recap} />;
}
