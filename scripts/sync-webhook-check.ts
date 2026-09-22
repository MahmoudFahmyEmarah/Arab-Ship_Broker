/**
 * Data Sync hardening · Meta webhook behaviour (no network). Run:
 *   npx tsx scripts/sync-webhook-check.ts
 * Every scenario P0-5 names, through the real handler with fake collaborators:
 *   invalid signature · unsupported event · upsert failure · exception while
 *   mapping a valid text event · logging failure before storage · failure
 *   after storage · duplicate delivery · oversized body (header lies)
 */
import { createHmac } from "node:crypto";
import { handleMetaWebhook, WEBHOOK_MAX_BYTES, type StoredMessage, type WebhookDeps } from "@/lib/sync/whatsapp/webhook";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

const SECRET = "app-secret-for-tests";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
const textEvent = (id = "wamid.1", body = "hello", timestamp: string | number = "1758300000") => JSON.stringify({
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "201000000001", profile: { name: "Cap" } }],
    messages: [{ type: "text", id, from: "201000000001", timestamp, text: { body } }],
  } }] }],
});
const statusEvent = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "delivered" }] } }] }] });

interface Calls { upserts: StoredMessage[][]; jobs: number; finishes: { ok: boolean; error?: string | null }[]; kicks: number }
function deps(over: Partial<WebhookDeps> = {}, calls: Calls = { upserts: [], jobs: 0, finishes: [], kicks: 0 }): { d: WebhookDeps; calls: Calls } {
  const d: WebhookDeps = {
    getAppSecret: async () => SECRET,
    upsertMessages: async (rows) => { calls.upserts.push(rows); return { error: null }; },
    startJob: async () => { calls.jobs += 1; return calls.jobs; },
    finishJob: async (_id, r) => { calls.finishes.push({ ok: r.ok, error: r.error ?? null }); },
    kick: () => { calls.kicks += 1; },
    now: () => new Date("2026-09-20T10:00:00Z"),
    ...over,
  };
  return { d, calls };
}

async function main() {
  console.log("signature");
  {
    const body = textEvent();
    const { d, calls } = deps();
    const r = await handleMetaWebhook({ rawBody: body, signature: "sha256=deadbeef", contentLength: body.length }, d);
    ok(r.status === 403 && r.outcome === "bad_signature", "invalid signature → 403, nothing stored", `${r.status} ${r.outcome}`);
    ok(calls.upserts.length === 0 && calls.jobs === 0, "…no upsert, no job row");
    const r2 = await handleMetaWebhook({ rawBody: body, signature: null, contentLength: body.length }, d);
    ok(r2.status === 403, "missing signature → 403");
    const { d: d3 } = deps({ getAppSecret: async () => null });
    const r3 = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d3);
    ok(r3.status === 403 && r3.outcome === "not_configured", "no app secret configured → 403 (not a retry)");
  }

  console.log("happy path and idempotency");
  {
    const body = textEvent();
    const { d, calls } = deps();
    const r = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r.status === 200 && r.outcome === "stored" && r.stored && r.messages === 1, "verified text → stored → 200", `${r.status} ${r.outcome}`);
    ok(calls.upserts.length === 1 && calls.upserts[0][0].wa_message_id === "wamid.1" && calls.upserts[0][0].received_at === new Date(1758300000 * 1000).toISOString(), "the row carries the id and Meta's timestamp");
    ok(calls.kicks === 1 && calls.finishes.length === 1 && calls.finishes[0].ok, "processing kicked, job logged ok");
    // duplicate delivery: the upsert ignores the duplicate; Meta still gets 200
    const r2 = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r2.status === 200 && r2.outcome === "stored" && calls.upserts.length === 2, "duplicate delivery → 200 again (idempotent upsert)");
  }

  console.log("unsupported event");
  {
    const { d, calls } = deps();
    const r = await handleMetaWebhook({ rawBody: statusEvent, signature: sign(statusEvent), contentLength: statusEvent.length }, d);
    ok(r.status === 200 && r.outcome === "no_text" && !r.hadText, "status receipt → 200, nothing to store", `${r.status} ${r.outcome}`);
    ok(calls.upserts.length === 0 && calls.kicks === 0, "…no upsert, no kick");
    const junk = "not json";
    const r2 = await handleMetaWebhook({ rawBody: junk, signature: sign(junk), contentLength: junk.length }, d);
    ok(r2.status === 200 && r2.outcome === "no_text", "verified non-JSON body → 200, nothing to store");
  }

  console.log("storage failure");
  {
    const body = textEvent("wamid.2");
    const { d, calls } = deps({ upsertMessages: async () => ({ error: "connection refused" }) });
    const r = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r.status === 503 && r.headers?.["Retry-After"] === "60" && r.outcome === "storage_failed", "upsert error → 503 + Retry-After", `${r.status} ${r.outcome}`);
    ok(calls.kicks === 0 && calls.finishes.length === 1 && !calls.finishes[0].ok, "…no kick, the failed job row is the alert");
    const { d: d2 } = deps({ upsertMessages: async () => { throw new Error("socket hang up"); } });
    const r2 = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d2);
    ok(r2.status === 503 && r2.outcome === "failed_before_storage" && r2.verified && r2.hadText && !r2.stored, "upsert throws → 503 (verified text, not stored)");
  }

  console.log("exception while mapping a valid text event");
  {
    const body = textEvent("wamid.3", "hi", "8640000000000001"); // out-of-range date → RangeError in toISOString
    const { d, calls } = deps();
    const r = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r.status === 503 && r.outcome === "failed_before_storage" && r.hadText, "mapping throws after verification → 503, not 200", `${r.status} ${r.outcome}`);
    ok(calls.upserts.length === 0, "…nothing stored");
  }

  console.log("logging must never prevent storage");
  {
    const body = textEvent("wamid.4");
    const { d, calls } = deps({ startJob: async () => { throw new Error("job_runs down"); } });
    const r = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r.status === 200 && r.stored && calls.upserts.length === 1, "startJob throws → message still stored → 200", `${r.status} ${r.outcome}`);
    const { d: d2, calls: c2 } = deps({ finishJob: async () => { throw new Error("job_runs down"); } });
    const r2 = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d2);
    ok(r2.status === 200 && r2.stored && c2.upserts.length === 1, "finishJob throws → still 200 and stored");
  }

  console.log("failure after storage");
  {
    const body = textEvent("wamid.5");
    const { d, calls } = deps({ kick: () => { throw new Error("after() unavailable"); } });
    const r = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r.status === 200 && r.stored && (r.outcome === "stored" || r.outcome === "failed_after_storage"), "kick throws after storage → 200 (the sweep retries)", `${r.status} ${r.outcome}`);
    ok(calls.upserts.length === 1, "…the message is stored once");
  }

  console.log("size");
  {
    const big = "x".repeat(WEBHOOK_MAX_BYTES + 1);
    const { d, calls } = deps();
    const r = await handleMetaWebhook({ rawBody: big, signature: sign(big), contentLength: 10 }, d);
    ok(r.status === 413 && r.outcome === "too_large", "a body larger than the cap is refused even when Content-Length says 10", `${r.status}`);
    ok(calls.upserts.length === 0, "…without touching storage");
    const multi = "é".repeat(WEBHOOK_MAX_BYTES / 2 + 10); // fewer characters than bytes
    const r2 = await handleMetaWebhook({ rawBody: multi, signature: sign(multi), contentLength: null }, d);
    ok(r2.status === 413, "the check counts bytes, not characters");
  }

  console.log("failure before verification");
  {
    const body = textEvent("wamid.6");
    const { d } = deps({ getAppSecret: async () => { throw new Error("vault unavailable"); } });
    const r = await handleMetaWebhook({ rawBody: body, signature: sign(body), contentLength: body.length }, d);
    ok(r.status === 503 && !r.verified, "secret lookup throws → 503 (never acknowledge what could not be verified)", `${r.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
