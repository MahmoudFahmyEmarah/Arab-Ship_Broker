// Fixture Room · "new since your last visit". The browser remembers, per viewer
// and room, the last ledger sequence this viewer has seen; the room marks
// everything after it. A per-viewer convenience only: nothing is stored on the
// server, storage may be unavailable (private window, blocked site data) and
// the room then simply shows no marker.
//
// C2O-012 item 4: the key names the signed-in member as well as the room, so a
// second account in the same browser never inherits (and so never suppresses)
// the first one's marker; and a write only ever moves the mark forward, so a
// stale tab closing late cannot pull it back and resurface old updates.
import type { FixtureEventView, FixtureTermView } from "./types";

export const lastSeenKey = (viewerId: string, roomId: string) => `asb.fx.seen.${viewerId}.${roomId}`;

const parse = (v: string | null) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function readLastSeen(viewerId: string, roomId: string): number | null {
  try {
    return typeof window === "undefined" ? null : parse(window.localStorage.getItem(lastSeenKey(viewerId, roomId)));
  } catch { return null; }
}

/** The mark to store: never below what is already stored (monotonic). */
export function nextLastSeen(stored: number | null, seq: number): number {
  return stored == null ? seq : Math.max(stored, seq);
}

export function writeLastSeen(viewerId: string, roomId: string, seq: number): void {
  try {
    if (typeof window === "undefined" || !Number.isFinite(seq)) return;
    const k = lastSeenKey(viewerId, roomId);
    window.localStorage.setItem(k, String(nextLastSeen(parse(window.localStorage.getItem(k)), seq)));
  } catch { /* convenience only */ }
}

/**
 * Other parties' events after the last visit (the viewer's own moves are never
 * "new"). The banner count, the term chips and the activity feed's marks all
 * come from this one list, so they cannot disagree (C2O-012 item 3).
 */
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
