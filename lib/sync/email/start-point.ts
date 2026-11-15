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

/** The card stops waiting for a run a little after the route's 300 s maxDuration (B2O-133 P3). */
export const CLIENT_CEILING_MS = 330_000;
export const CEILING_MESSAGE = "The sync did not answer within 5½ minutes — run it again; nothing was skipped.";

/** The text the card shows for a run that threw. A stream cut by the card's own ceiling says so: mid-stream, Chromium
 *  rejects the read with its own DOMException ("BodyStreamBuffer was aborted"), not the abort reason (B2O-134 P2). */
export function runErrorText(e: unknown, cutByCeiling: boolean): string {
  if (cutByCeiling) return CEILING_MESSAGE;
  return e instanceof Error && e.message ? e.message : "Email sync failed.";
}

/** What the box shows when it is (re)filled: the held point when there is one, else the checkpoint. Used on mount,
 *  after every reload, and whenever the page's point changes, cleared included (B2O-133 P2). */
export function boxFor(resumeIso: string | null, checkpointIso: string | null): string {
  return toLocalInput(resumeIso ?? checkpointIso);
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

/**
 * What the card does with its held point when an inbox run ends and the run handed none back.
 *  - the run settled (done / empty / skipped / error) → "clear": nothing is left to continue; the box returns to the
 *    checkpoint (every backfill exit that leaves mail unread hands a point back, so a settled run without one is
 *    either natural or read through)
 *  - the run ended without a terminal event (the platform cut the function, the connection dropped, the request
 *    failed or hit the card's ceiling) → the point it was sent is held again, so a retry re-reads from there (safe:
 *    re-reading only meets duplicates); a natural run that was cut leaves things as they are ("keep")
 */
export function pointAfterRun(r: { settled: boolean; sentSince: string | undefined }): "clear" | "keep" | { hold: string } {
  if (r.settled) return "clear";
  return r.sentSince ? { hold: r.sentSince } : "keep";
}
