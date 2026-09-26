import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FixtureRoomClient } from "@/components/fixture-room/FixtureRoomClient";
import { isFixtureError } from "@/lib/fixture-room/errors";
import { loadFixtureRoom } from "../actions";
import "@/components/fixture-room/fixture-room.css";

export const metadata = { title: "Fixture Room Arab ShipBroker" };
export const dynamic = "force-dynamic";

// The room. The server renders the masked read model for the signed-in
// party; the client keeps it fresh by polling the version and refetching.
// A member who is not a party gets the same 404 as a room that does not
// exist (the server does not reveal which).
export default async function FixtureRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const view = await loadFixtureRoom(id);
  if (isFixtureError(view)) {
    if (view.code === "AUTH" || view.code === "NOT_FOUND") notFound();
    return (
      <div className="fxr">
        <div className="fxr-page">
          <div className="fxr-banner is-error" role="alert">{view.message}</div>
        </div>
      </div>
    );
  }
  return <FixtureRoomClient initial={view} />;
}
