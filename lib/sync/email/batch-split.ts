// A classification reply the model cut off cannot be parsed (4 Nov 2026: batch 3 of a backfill page came back as
// "{}" — "expected array, received undefined" — because ten digest emails held more records than the output-token
// cap allows). Retrying the SAME batch fails the same way and only spends tokens, so an unreadable reply is never
// retried: the batch is split in half and each half is classified, down to single emails; a single email that is
// still cut off has its own text halved (with overlap), so one large email can never block the backfill. Every
// split is bounded: each half is strictly shorter than what it came from, and a per-run budget caps the extra calls,
// so a model that never answers readably fails fast instead of being split again and again (paid calls).
// Transient errors (network, 429/503, timeouts) keep their normal retry in run.ts.
import type { EmailMsg } from "./types";

/** The model answered, but its reply could not be read against the schema (usually cut off at the output cap). */
export function isUnreadableReply(e: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = e;
  for (let depth = 0; depth < 8 && current != null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const x = current as { lc_error_code?: unknown; message?: unknown; cause?: unknown };
      if (x.lc_error_code === "OUTPUT_PARSING_FAILURE") return true;
      if (typeof x.message === "string" && /\/errors\/OUTPUT_PARSING_FAILURE\//i.test(x.message)) return true;
      current = x.cause;
    } else {
      return typeof current === "string" && /\/errors\/OUTPUT_PARSING_FAILURE\//i.test(current);
    }
  }
  return false;
}

export const MIN_MODEL_CALL_WINDOW_MS = 5_000;

export function isSyncDeadline(e: unknown): boolean {
  return e instanceof Error && (e.message.startsWith("SYNC_DEADLINE:") || e.message.startsWith("SYNC_PROVIDER_TIMEOUT:"));
}

export interface ModelCallCircuit {
  closed: boolean;
  reason: Error | null;
}

export function createModelCallCircuit(): ModelCallCircuit {
  return { closed: false, reason: null };
}

/** Run one provider call under both its own timeout and the route's absolute deadline. LangChain races its public
 * invocation against AbortSignal, so that promise can reject before the underlying HTTP request confirms settlement.
 * On timeout, close the run-wide circuit before aborting: no retry or queued batch can overlap the uncertain call. */
export async function runAbortableCall<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs: number; deadlineAt: number | null; label: string; circuit: ModelCallCircuit; minStartMs?: number },
): Promise<T> {
  if (opts.circuit.closed) {
    throw opts.circuit.reason ?? new Error("SYNC_PROVIDER_TIMEOUT: this run stopped after a provider timeout");
  }
  const now = Date.now();
  const remaining = opts.deadlineAt == null ? opts.timeoutMs : opts.deadlineAt - now;
  const minStart = opts.minStartMs ?? MIN_MODEL_CALL_WINDOW_MS;
  if (remaining < minStart) {
    throw new Error(`SYNC_DEADLINE: less than ${Math.ceil(Math.max(0, remaining) / 1000)}s remains; no new ${opts.label} call was started`);
  }

  const waitMs = Math.min(opts.timeoutMs, remaining);
  const controller = new AbortController();
  let timeoutError: Error | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const invocation = Promise.resolve().then(() => invoke(controller.signal));
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutError = opts.deadlineAt != null && Date.now() >= opts.deadlineAt
        ? new Error(`SYNC_DEADLINE: the ${opts.label} call reached the run deadline`)
        : new Error(`SYNC_PROVIDER_TIMEOUT: ${opts.label} timed out after ${Math.round(waitMs / 1000)}s; this run admitted no successor calls`);
      opts.circuit.closed = true;
      opts.circuit.reason = timeoutError;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, waitMs);
  });

  try {
    return await Promise.race([invocation, timeout]);
  } catch (e) {
    if (timeoutError) {
      // Await the public invocation for callback cleanup. It may settle before the underlying HTTP request, which is
      // why the circuit stays closed for the rest of this run instead of handing the limiter slot to a successor.
      try { await invocation; } catch { /* the expected abort rejection */ }
      throw timeoutError;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The text of a short email is never halved: its reply should fit, so a failure there is something else. */
export const MIN_HALVE_CHARS = 2000;
/** Total overlap between the two halves (half on each side of the cut), so an order on the cut is read whole. */
export const HALVE_OVERLAP = 600;
/** Extra model calls a run may spend on splits before it stops and says the replies keep failing. */
export const SPLIT_CALL_BUDGET = 40;

/** Split one email's text into two overlapping halves, cutting at a line boundary in the middle third. Each half is
 * guaranteed strictly shorter than the text (at most 2/3 of it plus half the overlap); [] when that cannot hold. */
export function halveEmail(e: EmailMsg): EmailMsg[] {
  const L = e.text.length;
  if (L < MIN_HALVE_CHARS) return [];
  let mid = Math.floor(L / 2);
  const nl = e.text.lastIndexOf("\n", mid);
  if (nl >= Math.ceil(L / 3)) mid = nl;
  const side = HALVE_OVERLAP / 2;
  const h1 = e.text.slice(0, Math.min(L, mid + side));
  const h2 = e.text.slice(Math.max(0, mid - side));
  if (h1.length >= L || h2.length >= L || !h1 || !h2) return [];
  return [
    { ...e, id: `${e.id}#h1`, subject: `${e.subject} (half 1)`, text: h1 },
    { ...e, id: `${e.id}#h2`, subject: `${e.subject} (half 2)`, text: h2 },
  ];
}

/** A shared cap on calls in flight, so splitting never fans out past the run's concurrency (B2O P2). A finishing
 * call hands its slot straight to the next waiter, so the count never exceeds `max`, even for an instant. */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));   // the slot is handed over
    else active += 1;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); else active -= 1;
    }
  };
}

/** The parser's message without the raw model output it quotes ("Text: …" can carry extracted email content). */
export function unreadableSummary(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // the quote runs to the LAST '". Error:' (the model output may itself contain '".'); with no such marker, drop
  // everything from "Text:" on — the quote may be cut anywhere (B2O P3)
  const at = m.indexOf("Text:");
  let s = m;
  if (at >= 0) {
    const end = m.lastIndexOf('". Error:');
    s = end > at ? m.slice(0, at) + m.slice(end + 3) : m.slice(0, at);
  }
  // cap by code points, so an emoji is never cut in half
  return Array.from(s.replace(/\s+/gu, " ").trim()).slice(0, 200).join("");
}

export type BatchOutcome<C, V> = { cargo: C[]; vessels: V[] };
export type SplitBudget = { left: number };

async function both<C, V>(a: Promise<BatchOutcome<C, V>>, b: Promise<BatchOutcome<C, V>>): Promise<BatchOutcome<C, V>> {
  // allSettled: both halves always finish (and are metered) even when one fails; the first failure is then raised
  const [x, y] = await Promise.allSettled([a, b]);
  if (x.status === "rejected") throw x.reason;
  if (y.status === "rejected") throw y.reason;
  return { cargo: [...x.value.cargo, ...y.value.cargo], vessels: [...x.value.vessels, ...y.value.vessels] };
}

/** Classify `batch`; on an unreadable reply, split it in half and classify both halves, recursively; one email that
 * is still unreadable has its text halved. A short email that is still unreadable fails as UNREADABLE_EMAIL naming
 * it; a run whose split budget runs out fails as UNREADABLE_REPLIES. `onSplit` is told what was split. Callers pass
 * `run` through a shared limiter and one `budget` per run. */
export async function classifyWithSplit<C, V>(
  batch: EmailMsg[],
  run: (b: EmailMsg[]) => Promise<BatchOutcome<C, V>>,
  onSplit: (what: string) => void,
  budget: SplitBudget = { left: SPLIT_CALL_BUDGET },
): Promise<BatchOutcome<C, V>> {
  try {
    const r = await run(batch);
    return { cargo: r.cargo, vessels: r.vessels };
  } catch (e) {
    if (!isUnreadableReply(e)) throw e;
    let parts: [EmailMsg[], EmailMsg[]] | null = null;
    let what = "";
    if (batch.length >= 2) {
      const mid = Math.ceil(batch.length / 2);
      parts = [batch.slice(0, mid), batch.slice(mid)];
      what = `a reply for ${batch.length} email(s) was cut off — splitting them into two smaller batches`;
    } else {
      const halves = halveEmail(batch[0]);
      if (halves.length === 2) {
        parts = [[halves[0]], [halves[1]]];
        what = `the reply for one large email ("${batch[0].subject}") was cut off — reading it in two overlapping halves`;
      }
    }
    if (!parts) {
      throw new Error(`UNREADABLE_EMAIL: the model's reply for the email "${batch[0].subject}" (${batch[0].date ?? "no date"}) could not be read even on its own — ${unreadableSummary(e)}`);
    }
    if (budget.left < 2) {
      throw new Error(`UNREADABLE_REPLIES: the model's replies kept failing to parse after ${SPLIT_CALL_BUDGET} extra calls this run — ${unreadableSummary(e)}`);
    }
    budget.left -= 2;
    onSplit(what);
    return both(classifyWithSplit(parts[0], run, onSplit, budget), classifyWithSplit(parts[1], run, onSplit, budget));
  }
}
