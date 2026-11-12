// The start point a "Sync now" click sends (pure, client-safe; executed by scripts/sync-run-check.ts).
//
// The card's "Fetch mail since" box is a datetime-local: browser wall time, to the minute. The checkpoint and a
// stopped backfill's point carry seconds. Comparing the box's ISO with the checkpoint's ISO (ee29b11..63eb18d) made
// an untouched box look changed whenever the checkpoint was not on an exact minute — nearly always — so a plain click
// went out as a backfill from the minute's floor, which moves no checkpoint: every click restarted from the same
// minute (B2O-131 P1-1). Equality is therefore judged in the box's own form, and the exact point is sent when the
// box still shows it.

/** datetime-local wants local wall time without the zone, to the minute. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Does the box show something other than the checkpoint? (the card's "changed" border and Reset button) */
export function startPointChanged(input: string, checkpointIso: string | null): boolean {
  return input !== toLocalInput(checkpointIso);
}

/**
 * The `since` to send, or undefined for a natural run from the checkpoint.
 *  - the box still shows a stopped backfill's point → that exact point (seconds kept: a minute's floor would re-read
 *    the same mail and, when one minute holds more than a run can finish, never get past it — B2O-131 P2-1)
 *  - the box shows the checkpoint, or nothing → undefined (natural: the checkpoint moves as pages are staged)
 *  - anything else is a start point the owner chose → its instant
 */
export function startPointToSend(input: string, checkpointIso: string | null, resumeIso: string | null): string | undefined {
  if (!input) return undefined;
  if (resumeIso && input === toLocalInput(resumeIso)) return new Date(resumeIso).toISOString();
  if (!startPointChanged(input, checkpointIso)) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
