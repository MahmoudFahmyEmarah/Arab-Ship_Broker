import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadFixtureViewer } from "@/lib/fixture-room/viewer.server";
import { RoomInbox } from "@/components/fixture-room/RoomInbox";
import { FixtureLocked } from "@/components/fixture-room/FixtureLocked";
import { loadFixtureRooms } from "./actions";
import "@/components/fixture-room/fixture-room.css";

export const metadata = { title: "Fixture Room Arab ShipBroker" };
export const dynamic = "force-dynamic";

// The inbox: every room the signed-in member is a party to (admins see all,
// audited). Creation follows decision D3 through canUseFixtureRoom (T3+,
// market partner or admin — the same rule as fn_fixture_tier_ok);
// participation is by invitation, so a limited-tier member with rooms still
// sees them.
export default async function FixtureRoomInboxPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const viewer = await loadFixtureViewer(supabase, user.id);
  const canCreate = viewer.canCreate;
  const rooms = await loadFixtureRooms({ limit: 100 });
  if (!Array.isArray(rooms)) {
    return (
      <div className="fxr">
        <div className="fxr-page">
          <h1 className="fxr-title">Fixture Room</h1>
          <div className="fxr-banner is-error" role="alert">{rooms.message}</div>
        </div>
      </div>
    );
  }
  if (!canCreate && rooms.length === 0) return <FixtureLocked />;
  return <RoomInbox rooms={rooms} canCreate={canCreate} isAdmin={viewer.isAdmin} />;
}
