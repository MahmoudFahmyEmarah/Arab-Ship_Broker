// A classification reply the model cut off cannot be parsed (4 Nov 2026: batch 3 of a backfill page came back as
// "{}" — "expected array, received undefined" — because ten digest emails held more records than the output-token
// cap allows). Retrying the SAME batch fails the same way and only spends tokens, so an unreadable reply is never
// retried: the batch is split in half and each half is classified, down to single emails. Transient errors
// (network, 429/503, timeouts) keep their normal retry in run.ts.
import type { EmailMsg } from "./types";

/** The model answered, but its reply could not be read against the schema (usually cut off at the output cap). */
export function isUnreadableReply(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /Failed to parse|OUTPUT_PARSING_FAILURE/i.test(m);
}

export type BatchOutcome<C, V> = { cargo: C[]; vessels: V[] };

/** Classify `batch`; on an unreadable reply, split it in half and classify both halves in parallel, recursively.
 * A single email whose reply is still unreadable fails with a message that says so. `onSplit` is told the size of
 * every batch that was split, so the run log can show it. */
export async function classifyWithSplit<C, V>(
  batch: EmailMsg[],
  run: (b: EmailMsg[]) => Promise<BatchOutcome<C, V>>,
  onSplit: (size: number) => void,
): Promise<BatchOutcome<C, V>> {
  try {
    const r = await run(batch);
    return { cargo: r.cargo, vessels: r.vessels };
  } catch (e) {
    if (!isUnreadableReply(e)) throw e;
    if (batch.length < 2) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`the model's reply for one email could not be read even on its own (it was probably cut off at the output limit) — ${msg}`);
    }
    onSplit(batch.length);
    const mid = Math.ceil(batch.length / 2);
    const [a, b] = await Promise.all([
      classifyWithSplit(batch.slice(0, mid), run, onSplit),
      classifyWithSplit(batch.slice(mid), run, onSplit),
    ]);
    return { cargo: [...a.cargo, ...b.cargo], vessels: [...a.vessels, ...b.vessels] };
  }
}
