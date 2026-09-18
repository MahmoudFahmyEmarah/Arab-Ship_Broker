// Small, pure input guards shared by the Data Sync server actions and routes.
// Kept dependency-free so scripts/data-sync-unit-check.ts can exercise them
// without a database.

import { timingSafeEqual } from "node:crypto";

/** PostgREST .or() parses commas/parens/dots — strip anything that could break
 *  a search term out of the ilike filter it is interpolated into. */
export function sanitizeSearch(s: string): string {
  return s.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);
}

/** Keep only the keys a registry marks editable. The RPC's own column filter is
 *  the backstop; this is the front gate so a client can never smuggle a column
 *  the editor does not expose (review_status, commodity_id, …). */
export function pickAllowedKeys<T extends Record<string, unknown>>(patch: T, allowed: Iterable<string>): Partial<T> {
  const ok = new Set(allowed);
  return Object.fromEntries(Object.entries(patch).filter(([k]) => ok.has(k))) as Partial<T>;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|fc|fd|fe80)/i;
const RFC1918_172 = /^172\.(1[6-9]|2\d|3[01])\./;

/** An LLM base_url override is only honoured when it is an https URL to a
 *  public host. Anything else would let a stored override exfiltrate the
 *  decrypted key to an internal service or a plain-http listener. */
export function isSafeBaseUrl(raw: string | null | undefined): { ok: boolean; reason?: string } {
  if (!raw) return { ok: true };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "not a valid URL" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "must use https" };
  if (u.username || u.password) return { ok: false, reason: "credentials in the URL are not allowed" };
  const host = u.hostname;
  if (PRIVATE_HOST.test(host) || RFC1918_172.test(host) || host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    return { ok: false, reason: "must point at a public host" };
  return { ok: true };
}

/** Constant-time string compare for shared secrets (webhook verify token,
 *  cron bearer). Length mismatch short-circuits — that leaks only the length. */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Clamp a numeric page size / offset from an untrusted caller. */
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
