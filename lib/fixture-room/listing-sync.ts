// Fixture Room · listing status synchronisation notice (decision D4).
//
// The room never mutates cargo_listings or vessel_availability. When a room
// enters or leaves on_subjects / fixed, the server records the statuses the
// marketplace should now show and the read model compares them with the live
// rows. This module turns that into the warning the room shows, with links to
// the EXISTING authorised listing edit flows — for the side that owns the
// listing only (audit FR-H3): the cargo side never gets a vessel link, and a
// masked vessel has no id to link to anyway. The one-click action itself is
// integration-owned (shared listing components).
import type { FixtureListingSync, FixtureRoomHeader, FixtureSide } from "./types";

export interface ListingSyncNotice {
  outstanding: boolean;
  headline: string;
  lines: string[];
  links: { label: string; href: string }[];
}

export function listingSyncNotice(
  room: Pick<FixtureRoomHeader, "listingSync" | "cargoListingId" | "vesselAvailabilityId" | "vesselId">,
  viewerSide: FixtureSide | null,
): ListingSyncNotice | null {
  const s: FixtureListingSync | null = room.listingSync;
  if (!s) return null;
  const lines: string[] = [];
  const links: { label: string; href: string }[] = [];
  if (s.cargo.outstanding) {
    lines.push(`Cargo listing should read ${s.cargo.target ?? "—"} (currently ${s.cargo.current ?? "—"}).`);
    if (viewerSide === "cargo") links.push({ label: "Open the cargo listing", href: `/dashboard/cargo/${room.cargoListingId}/edit` });
  }
  if (s.vessel.outstanding) {
    lines.push(`Vessel position should read ${s.vessel.target ?? "—"} (currently ${s.vessel.current ?? "—"}).`);
    if (viewerSide === "vessel" && room.vesselId && room.vesselAvailabilityId) {
      links.push({ label: "Open the vessel position", href: `/dashboard/vessels/${room.vesselId}/availability/${room.vesselAvailabilityId}/edit` });
    }
  }
  return {
    outstanding: s.outstanding,
    headline: s.outstanding ? "Marketplace listings do not match this fixture yet" : "Marketplace listings match this fixture",
    lines: s.outstanding ? lines : [`Cargo ${s.cargo.current ?? "—"} · vessel position ${s.vessel.current ?? "—"}.`],
    links,
  };
}
