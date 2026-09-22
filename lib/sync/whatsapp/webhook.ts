// The Meta WhatsApp webhook, as a pure decision (P0-5, 20 Sep 2026).
//
// The route is a thin adapter around handleMetaWebhook; everything that
// talks to the outside world comes in through WebhookDeps, so every branch
// below is exercised by scripts/sync-webhook-check.ts without a server.
//
// The one rule: Meta is told "delivered" (200) ONLY once verified inbound
// text is durably stored. Before that point any failure answers 503 with
// Retry-After so Meta redelivers (the upsert is idempotent on
// wa_message_id). After that point failures answer 200: the message is
// stored and the 5-minute sweep retries its processing. Job logging is
// best effort and can never prevent storage.
import { verifyMetaSignature, extractMetaTexts, type MetaText } from "./security";

export interface WebhookInput {
  rawBody: string;
  signature: string | null;
  /** Content-Length as sent, or null. The body's real byte length is checked too. */
  contentLength: number | null;
}

export interface StoredMessage {
  wa_message_id: string;
  provider: "meta";
  wa_from: string;
  contact_name: string | null;
  body: string;
  received_at: string;
  raw: { meta: true };
}

export interface WebhookDeps {
  /** The Meta app secret from the Vault; null when not configured. */
  getAppSecret(): Promise<string | null>;
  /** Idempotent upsert on wa_message_id. Resolves with an error message, or null. */
  upsertMessages(rows: StoredMessage[]): Promise<{ error: string | null }>;
  /** Best-effort job log: opens a job_runs row, or null. Never throws when well-behaved; guarded anyway. */
  startJob(): Promise<number | null>;
  finishJob(id: number | null, result: { ok: boolean; rows?: number | null; error?: string | null }): Promise<void>;
  /** Schedules processing of stored messages after the response (may throw; never awaited here). */
  kick(): void;
  now(): Date;
}

export interface WebhookResponse {
  status: number;
  body: string | Record<string, unknown>;
  headers?: Record<string, string>;
  /** What happened — for tests and the audit trail. */
  outcome: "too_large" | "not_configured" | "bad_signature" | "no_text" | "stored" | "storage_failed" | "failed_before_storage" | "failed_after_storage";
  verified: boolean;
  hadText: boolean;
  stored: boolean;
  messages: number;
}

export const WEBHOOK_MAX_BYTES = 1024 * 1024;
const RETRY = { "Retry-After": "60" };

/** Rows exactly as the route stores them; a malformed timestamp throws here, on purpose. */
export function toStoredMessages(texts: MetaText[], now: Date): StoredMessage[] {
  return texts.map((t) => {
    const ts = t.timestamp != null ? Number(t.timestamp) : NaN;
    const received = Number.isFinite(ts) ? new Date(ts * 1000) : now;
    return {
      wa_message_id: t.waMessageId,
      provider: "meta",
      wa_from: t.from,
      contact_name: t.name,
      body: t.text,
      received_at: received.toISOString(),   // RangeError on an out-of-range timestamp
      raw: { meta: true },
    };
  });
}

async function logSafely(deps: WebhookDeps, result: { ok: boolean; rows?: number | null; error?: string | null }): Promise<void> {
  try {
    const id = await deps.startJob();
    await deps.finishJob(id, result);
  } catch { /* the log is not the message */ }
}

export async function handleMetaWebhook(input: WebhookInput, deps: WebhookDeps): Promise<WebhookResponse> {
  const base = { verified: false, hadText: false, stored: false, messages: 0 };
  // size: the header first (cheap), then the bytes actually read — Content-Length can lie
  if ((input.contentLength ?? 0) > WEBHOOK_MAX_BYTES || Buffer.byteLength(input.rawBody, "utf8") > WEBHOOK_MAX_BYTES) {
    return { status: 413, body: "Payload too large", outcome: "too_large", ...base };
  }

  let verified = false;
  let hadText = false;
  let stored = false;
  let rows: StoredMessage[] = [];
  try {
    const appSecret = await deps.getAppSecret();
    if (!appSecret) return { status: 403, body: "Not configured", outcome: "not_configured", ...base };
    if (!verifyMetaSignature(input.rawBody, input.signature, appSecret)) {
      return { status: 403, body: "Invalid signature", outcome: "bad_signature", ...base };
    }
    verified = true;

    let payload: unknown = {};
    try { payload = JSON.parse(input.rawBody); } catch { /* non-JSON → no messages */ }
    const texts = extractMetaTexts(payload);
    hadText = texts.length > 0;
    if (!hadText) {
      // statuses, receipts, unsupported types: nothing to store, nothing to retry
      return { status: 200, body: { ok: true }, outcome: "no_text", verified, hadText, stored, messages: 0 };
    }

    rows = toStoredMessages(texts, deps.now());
    const { error } = await deps.upsertMessages(rows);
    if (error) {
      // NOT stored: a 200 would tell Meta it was delivered and lose it
      await logSafely(deps, { ok: false, rows: rows.length, error });
      return { status: 503, body: "Storage unavailable", headers: RETRY, outcome: "storage_failed", verified, hadText, stored, messages: rows.length };
    }
    stored = true;

    // everything from here on is best effort: the message is safe
    await logSafely(deps, { ok: true, rows: rows.length });
    try { deps.kick(); } catch { /* the sweep cron retries */ }
    return { status: 200, body: { ok: true }, outcome: "stored", verified, hadText, stored, messages: rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "webhook failed";
    if (stored) {
      await logSafely(deps, { ok: false, rows: rows.length, error: msg });
      return { status: 200, body: { ok: true }, outcome: "failed_after_storage", verified, hadText, stored, messages: rows.length };
    }
    await logSafely(deps, { ok: false, rows: null, error: msg });
    // verified text that never reached storage — or a failure before we could
    // even verify — must be redelivered, never acknowledged
    return { status: 503, body: "Temporary failure", headers: RETRY, outcome: "failed_before_storage", verified, hadText, stored, messages: rows.length };
  }
}
