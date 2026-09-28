// Fixture Room · "new since your last visit". The browser remembers, per room,
// the last ledger sequence this viewer has seen; the room marks everything
// after it. A per-viewer convenience only: nothing is stored on the server,
// storage may be unavailable (private window, blocked site data) and the room
// then simply shows no marker.
import type { FixtureEventView, FixtureTermView } from "./types";

const key = (roomId: string) => `asb.fx.seen.${roomId}`;

export function readLastSeen(roomId: string): number | null {
  try {
    const v = typeof window === "undefined" ? null : window.localStorage.getItem(key(roomId));
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch { return null; }
}

export function writeLastSeen(roomId: string, seq: number): void {
  try { if (typeof window !== "undefined" && Number.isFinite(seq)) window.localStorage.setItem(key(roomId), String(seq)); } catch { /* convenience only */ }
}

/** Other parties' events after the last visit (the viewer's own moves are never "new"). */
export function newSince(events: FixtureEventView[], lastSeen: number | null, myPartyIds: string[]): FixtureEventView[] {
  if (lastSeen == null) return [];
  const mine = new Set(myPartyIds);
  return events.filter((e) => e.seq > lastSeen && !(e.actorPartyId && mine.has(e.actorPartyId)));
}

/** The terms a set of new events touched (by termId in the payload). */
export function termsTouched(fresh: FixtureEventView[], terms: FixtureTermView[]): Set<string> {
  const ids = new Set(terms.map((t) => t.id));
  const out = new Set<string>();
  for (const e of fresh) {
    const t = e.payload?.termId;
    if (typeof t === "string" && ids.has(t)) out.add(t);
  }
  return out;
}
