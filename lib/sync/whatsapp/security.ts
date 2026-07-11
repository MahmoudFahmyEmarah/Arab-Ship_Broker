// Webhook security — pure, unit-testable helpers.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta's X-Hub-Signature-256 header: "sha256=" + HMAC-SHA256(appSecret, rawBody).
 * Constant-time comparison; any malformed input → false (never throws).
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  try {
    if (!header || !header.startsWith("sha256=") || !appSecret) return false;
    const theirs = Buffer.from(header.slice(7), "hex");
    const ours = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
    return theirs.length === ours.length && timingSafeEqual(theirs, ours);
  } catch {
    return false;
  }
}

/** Extract plain-text messages from a Meta webhook payload (defensive parse). */
export interface MetaText {
  waMessageId: string;
  from: string;           // E.164 phone
  name: string | null;
  text: string;
  timestamp: string | null;
}

export function extractMetaTexts(payload: unknown): MetaText[] {
  const out: MetaText[] = [];
  try {
    const entries = (payload as { entry?: unknown[] })?.entry ?? [];
    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] })?.changes ?? [];
      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> })?.value ?? {};
        const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[]) ?? [];
        const names = new Map(contacts.map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
        const messages = (value.messages as Record<string, unknown>[]) ?? [];
        for (const m of messages) {
          if (m.type !== "text") continue;
          const id = typeof m.id === "string" ? m.id : null;
          const from = typeof m.from === "string" ? m.from : null;
          const body = (m.text as { body?: string })?.body;
          if (!id || !from || typeof body !== "string" || !body.trim()) continue;
          out.push({
            waMessageId: id,
            from,
            name: names.get(from) ?? null,
            text: body,
            timestamp: typeof m.timestamp === "string" ? m.timestamp : null,
          });
        }
      }
    }
  } catch {
    /* malformed payload → no messages, never a crash */
  }
  return out;
}
