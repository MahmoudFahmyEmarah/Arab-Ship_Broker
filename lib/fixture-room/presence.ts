// Fixture Room · presence without Realtime (decision D-3, Phase 1.1): a side's
// "last active" moment is the latest ledger event one of its parties wrote.
// Honest and derived from the record; nothing is invented and nothing polls
// beyond the room's own version poll.
import type { FixtureEventView, FixturePartyView, FixtureSide } from "./types";

export type PresenceState = "online" | "away" | "off";
export interface SidePresence { state: PresenceState; lastActiveAt: string | null; label: string }

const ONLINE_MS = 5 * 60_000;   // an event in the last five minutes reads as online
const AWAY_MS = 60 * 60_000;    // within the hour: away; beyond: off-platform

export function sidePresence(events: FixtureEventView[], parties: FixturePartyView[], side: FixtureSide, now: number): SidePresence {
  const ids = new Set(parties.filter((p) => p.side === side && p.status === "active").map((p) => p.id));
  let last: string | null = null;
  for (const e of events) {
    const actor = e.actorPartyId && ids.has(e.actorPartyId) ? e.at : e.onBehalfOfPartyId && ids.has(e.onBehalfOfPartyId) ? e.at : null;
    if (actor && (!last || actor > last)) last = actor;
  }
  if (!last || now <= 0) return { state: "off", lastActiveAt: last, label: last ? "last seen" : "not yet active" };
  const age = now - Date.parse(last);
  if (age < ONLINE_MS) return { state: "online", lastActiveAt: last, label: "active now" };
  if (age < AWAY_MS) return { state: "away", lastActiveAt: last, label: `active ${Math.max(1, Math.round(age / 60_000))}m ago` };
  const h = Math.round(age / 3_600_000);
  return { state: "off", lastActiveAt: last, label: h < 48 ? `active ${h}h ago` : `active ${Math.round(h / 24)}d ago` };
}
