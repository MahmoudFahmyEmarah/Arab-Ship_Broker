// A classification reply the model cut off cannot be parsed (4 Nov 2026: batch 3 of a backfill page came back as
// "{}" — "expected array, received undefined" — because ten digest emails held more records than the output-token
// cap allows). Retrying the SAME batch fails the same way and only spends tokens, so an unreadable reply is never
// retried: the batch is split in half and each half is classified, down to single emails; a single email that is
// still cut off has its own text halved (with overlap, like the digest splitter), so one large email can never
// block the backfill. Transient errors (network, 429/503, timeouts) keep their normal retry in run.ts.
import type { EmailMsg } from "./types";

/** The model answered, but its reply could not be read against the schema (usually cut off at the output cap). */
export function isUnreadableReply(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /Failed to parse|OUTPUT_PARSING_FAILURE/i.test(m);
}

/** The text of a short email is never halved: its reply should fit, so a failure there is something else. */
export const MIN_HALVE_CHARS = 2000;
const HALVE_OVERLAP = 600;   // the same overlap the digest splitter re-shows, so no order is cut blind

/** Split one email's text into two overlapping halves at a line boundary near the middle; [] when too short. */
export function halveEmail(e: EmailMsg): EmailMsg[] {
  if (e.text.length < MIN_HALVE_CHARS) return [];
  let mid = Math.floor(e.text.length / 2);
  const nl = e.text.lastIndexOf("\n", mid);
  if (nl > e.text.length / 4) mid = nl;
  return [
    { ...e, id: `${e.id}#h1`, subject: `${e.subject} (half 1)`, text: e.text.slice(0, mid + HALVE_OVERLAP) },
    { ...e, id: `${e.id}#h2`, subject: `${e.subject} (half 2)`, text: e.text.slice(Math.max(0, mid - HALVE_OVERLAP)) },
  ];
}

/** A shared cap on calls in flight, so splitting never fans out past the run's concurrency (B2O P2). */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

export type BatchOutcome<C, V> = { cargo: C[]; vessels: V[] };

async function both<C, V>(a: Promise<BatchOutcome<C, V>>, b: Promise<BatchOutcome<C, V>>): Promise<BatchOutcome<C, V>> {
  // allSettled: both halves always finish (and are metered) even when one fails; the first failure is then raised
  const [x, y] = await Promise.allSettled([a, b]);
  if (x.status === "rejected") throw x.reason;
  if (y.status === "rejected") throw y.reason;
  return { cargo: [...x.value.cargo, ...y.value.cargo], vessels: [...x.value.vessels, ...y.value.vessels] };
}

/** Classify `batch`; on an unreadable reply, split it in half and classify both halves, recursively; one email that
 * is still unreadable has its text halved. A short email that is still unreadable fails with a message naming it.
 * `onSplit` is told what was split, so the run log can show it. Callers pass `run` through a shared limiter. */
export async function classifyWithSplit<C, V>(
  batch: EmailMsg[],
  run: (b: EmailMsg[]) => Promise<BatchOutcome<C, V>>,
  onSplit: (what: string) => void,
): Promise<BatchOutcome<C, V>> {
  try {
    const r = await run(batch);
    return { cargo: r.cargo, vessels: r.vessels };
  } catch (e) {
    if (!isUnreadableReply(e)) throw e;
    if (batch.length >= 2) {
      onSplit(`a reply for ${batch.length} email(s) was cut off — splitting them into two smaller batches`);
      const mid = Math.ceil(batch.length / 2);
      return both(classifyWithSplit(batch.slice(0, mid), run, onSplit), classifyWithSplit(batch.slice(mid), run, onSplit));
    }
    const halves = halveEmail(batch[0]);
    if (halves.length === 2) {
      onSplit(`the reply for one large email ("${batch[0].subject}") was cut off — reading it in two overlapping halves`);
      return both(classifyWithSplit([halves[0]], run, onSplit), classifyWithSplit([halves[1]], run, onSplit));
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`UNREADABLE_EMAIL: the model's reply for the email "${batch[0].subject}" (${batch[0].date ?? "no date"}) could not be read even on its own — ${msg}`);
  }
}
