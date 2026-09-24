import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadViewerContext } from "@/lib/portal/data";
import { isLimitedTier } from "@/lib/portal/tier-gate";
import { RoomInbox } from "@/components/fixture-room/RoomInbox";
import { FixtureLocked } from "@/components/fixture-room/FixtureLocked";
import { loadFixtureRooms } from "./actions";
import "@/components/fixture-room/fixture-room.css";

export const metadata = { title: "Fixture Room Arab ShipBroker" };
export const dynamic = "force-dynamic";

// The inbox: every room the signed-in member is a party to (admins see all,
// audited). Creation is T3+ (decision D3); participation is by invitation,
// so a limited-tier member with rooms still sees them.
export default async function FixtureRoomInboxPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { tier, role } = await loadViewerContext();
  const canCreate = role === "admin" || !isLimitedTier(tier);
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
  return <RoomInbox rooms={rooms} canCreate={canCreate} isAdmin={role === "admin"} />;
}
