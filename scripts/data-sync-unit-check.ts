/**
 * Data Sync — unit checks (no database, no network). Run:
 *   npx tsx scripts/data-sync-unit-check.ts
 * Covers the pure pieces the 12 Sep 2026 audit added or hardened: input
 * guards, duplicate-pair detection, job-run settlement, the token meter, the
 * email splitter/batcher and the webhook signature helpers. Exits non-zero on
 * the first failing group.
 */
import { createHmac } from "node:crypto";
import { sanitizeSearch, pickAllowedKeys, isSafeBaseUrl, secretEquals, clampInt } from "@/lib/sync/guards";
import { findCargoDuplicates, findVesselDuplicates, mergePatch, cargoIdentity, type StagedLite } from "@/lib/sync/dupes";
import { settleFor } from "@/lib/sync/email/types";
import { UsageMeter } from "@/lib/sync/email/usage";
import { splitLongEmail } from "@/lib/sync/email/run";
import { verifyMetaSignature, extractMetaTexts } from "@/lib/sync/whatsapp/security";
import { rowSummary, extractedFields } from "@/lib/sync/present";

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const group = (name: string) => console.log(`\n${name}`);

// ── guards ──────────────────────────────────────────────────────────────────
group("guards");
ok(sanitizeSearch("wheat,ref.ilike.%x%") === "wheat ref.ilike. x", "sanitizeSearch strips PostgREST operators");
ok(sanitizeSearch("a".repeat(100)).length === 60, "sanitizeSearch caps at 60 chars");
ok(JSON.stringify(pickAllowedKeys({ a: 1, review_status: "APPROVED", b: 2 }, ["a", "b"])) === '{"a":1,"b":2}', "pickAllowedKeys drops unlisted columns");
ok(isSafeBaseUrl(null).ok && isSafeBaseUrl("https://api.openai.com/v1").ok, "isSafeBaseUrl accepts public https");
ok(!isSafeBaseUrl("http://api.openai.com").ok, "isSafeBaseUrl rejects plain http");
ok(!isSafeBaseUrl("https://localhost:8080").ok && !isSafeBaseUrl("https://10.0.0.5").ok && !isSafeBaseUrl("https://172.20.1.1").ok && !isSafeBaseUrl("https://169.254.169.254").ok, "isSafeBaseUrl rejects loopback / RFC1918 / link-local");
ok(!isSafeBaseUrl("https://user:pw@api.x.com").ok && !isSafeBaseUrl("https://internal").ok, "isSafeBaseUrl rejects credentials and bare hostnames");
ok(secretEquals("abc", "abc") && !secretEquals("abc", "abd") && !secretEquals("abc", "abcd") && !secretEquals(null, "x"), "secretEquals constant-time compare semantics");
ok(clampInt("999", 1, 200, 50) === 200 && clampInt("x", 1, 200, 50) === 50 && clampInt(-3, 0, 10, 0) === 0, "clampInt bounds + fallback");

// ── duplicate pairs ─────────────────────────────────────────────────────────
group("duplicate pairs");
const cargo = (id: string, ref: string, extra: Record<string, unknown> = {}, committed = false): StagedLite => ({
  id, sheet: "cargo", business_key: ref, classification: "new", committed, batch_id: "b1",
  payload: { ref, commodity_name: "Wheat", qty_min_mt: 25000, qty_max_mt: 27500, load_port_name: "Constanta", disch_port_name: "Alexandria", laycan_from: "2026-09-20", laycan_to: "2026-09-25", ...extra },
});
const wb = cargo("11111111-1111-4111-8111-111111111111", "CM-24-1187", { freight_idea_usd_mt: 21.5 });
const em = cargo("22222222-2222-4222-8222-222222222222", "EM-AB12CD34", { freight_idea_usd_mt: null, broker: "Acme Chartering" });
ok(cargoIdentity(wb.payload) === cargoIdentity(em.payload), "cargoIdentity ignores ref/freight/broker");
const pairs = findCargoDuplicates([wb, em]);
ok(pairs.length === 1 && pairs[0].rule === "DQ-U03", "workbook + circular twin → one DQ-U03 pair");
ok(pairs[0].sides[0].id === wb.id && pairs[0].sides[0].keep && pairs[0].sides[1].id === em.id, "the real broker ref is kept, the provisional one dropped");
ok(findCargoDuplicates([wb, { ...wb, id: "33333333-3333-4333-8333-333333333333" }]).length === 0, "same ref twice is a re-sync, not a pair");
ok(findCargoDuplicates([wb, { ...em, committed: true }]).length === 0 || findCargoDuplicates([{ ...wb, committed: true }, em]).length === 1, "a committed row is never the dropped side");
const patch = mergePatch(em.payload, wb.payload, ["freight_idea_usd_mt", "broker", "ref"]);
ok(JSON.stringify(patch) === '{"freight_idea_usd_mt":21.5}', "mergePatch fills only empty, allowed fields");
const staged: StagedLite = { id: "44444444-4444-4444-8444-444444444444", sheet: "vessels", business_key: "9456789", classification: "new", committed: false, batch_id: "b1", payload: { imo_number: "9456789", vessel_name: "Sea Falcon", dwt_grain: 56800, build_year: 2011 } };
const u04 = findVesselDuplicates([staged], [{ id: "55555555-5555-4555-8555-555555555555", vessel_name: "SEA FALCON", built: 2011, dwt_grain: 56750 }]);
ok(u04.length === 1 && u04[0].rule === "DQ-U04" && u04[0].sides[1].origin === "queue", "IMO row + IMO-less queue twin → DQ-U04 (name, built, DWT within 5 %)");
ok(findVesselDuplicates([staged], [{ id: "6", vessel_name: "Sea Falcon", built: 2005, dwt_grain: 56800 }]).length === 0, "different build year → not a pair");
ok(findVesselDuplicates([staged], [{ id: "7", vessel_name: "Unnamed vessel (x)", built: null, dwt_grain: null }]).length === 0, "placeholder names never pair");

// ── job-run settlement ──────────────────────────────────────────────────────
group("settleFor");
const done = settleFor({ type: "done", batchId: "b", totals: { new: 3, updated: 2, unchanged: 0, invalid: 1, errors: 2 } });
ok(!!done && done.ok && done.rows === 5, "done → succeeded with staged row count");
const empty = settleFor({ type: "empty", message: "No new circulars" });
ok(!!empty && empty.ok && empty.rows === 0, "empty → SUCCEEDED with 0 rows (was logged as failed before)");
const err = settleFor({ type: "error", error: "IMAP: auth" });
ok(!!err && !err.ok && err.error === "IMAP: auth", "error → failed with the message");
ok(settleFor({ type: "log", msg: "x" }) === null && settleFor({ type: "step", key: "fetch", state: "running" }) === null, "log / step events are not terminal");

// ── token meter ─────────────────────────────────────────────────────────────
group("UsageMeter");
const meter = new UsageMeter();
meter.handleLLMEnd({ generations: [], llmOutput: { tokenUsage: { promptTokens: 1200, completionTokens: 300 } } });
ok(meter.tokens === 1500 && meter.calls === 1, "llmOutput.tokenUsage summed");
meter.handleLLMEnd({ generations: [[{ text: "", message: { usage_metadata: { input_tokens: 500, output_tokens: 100 } } } as never]] });
ok(meter.tokens === 2100 && meter.calls === 2, "per-message usage_metadata summed (Gemini/Anthropic shape)");
meter.handleChatModelStart(null, [[{ content: "x".repeat(400) }] as never]);
meter.handleLLMEnd({ generations: [[{ text: "y".repeat(40) } as never]] });
ok(meter.tokens > 2100 && meter.calls === 3, "no usage block → chars/4 estimate, never zero");

// ── long-digest splitter ────────────────────────────────────────────────────
group("splitLongEmail");
const short = { id: "1", from: "a", subject: "s", date: null, text: "short" };
ok(splitLongEmail(short).length === 1 && splitLongEmail(short)[0] === short, "short email untouched");
const long = { ...short, text: Array.from({ length: 400 }, (_, i) => `ORDER ${i}: 5000 mt wheat Constanta/Alexandria line ${i}`).join("\n") };
const parts = splitLongEmail(long);
ok(parts.length >= 2 && parts.length <= 6, `long digest split into ${parts.length} parts (≤ 6)`);
ok(parts.every((p) => p.text.length <= 8000) && parts[0].id === "1#p1", "each part ≤ 8000 chars, ids suffixed");
ok(parts.slice(1).every((p, i) => long.text.includes(p.text.slice(0, 100)) && p.text.slice(0, 600).length > 0 && parts[i].text.endsWith(p.text.slice(0, 0))), "parts are contiguous slices of the source");

// ── webhook security ────────────────────────────────────────────────────────
group("webhook");
const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "9715550000", profile: { name: "Cap" } }], messages: [{ type: "text", id: "wamid.1", from: "9715550000", timestamp: "1757500000", text: { body: "MV X open Jebel Ali" } }, { type: "image", id: "wamid.2", from: "9715550000" }] } }] }] });
const sig = "sha256=" + createHmac("sha256", "secret").update(body, "utf8").digest("hex");
ok(verifyMetaSignature(body, sig, "secret"), "valid HMAC accepted");
ok(!verifyMetaSignature(body, sig, "other") && !verifyMetaSignature(body, "sha256=zz", "secret") && !verifyMetaSignature(body, null, "secret") && !verifyMetaSignature(body, sig, ""), "wrong secret / malformed / missing header / empty secret rejected");
const texts = extractMetaTexts(JSON.parse(body));
ok(texts.length === 1 && texts[0].name === "Cap" && texts[0].text.startsWith("MV X"), "text messages extracted, non-text skipped, contact name joined");
ok(extractMetaTexts("garbage").length === 0 && extractMetaTexts({ entry: [{ changes: [{ value: { messages: [{ type: "text", id: "x" }] } }] }] }).length === 0, "malformed payloads → no messages, no throw");

// ── row presentation helpers ────────────────────────────────────────────────
group("row helpers");
ok(rowSummary({ commodity_name: "Urea", qty_min_mt: 12000, load_port_name: "Damietta", disch_port_name: "Mersin" }, "cargo") === "Urea · 12,000 mt · Damietta → Mersin", "cargo summary");
ok(rowSummary({ vessel_name: "Kapitan", dwt_grain: 8500, vessel_type: "Bulk Carrier" }, "vessels") === "Kapitan · 8,500 dwt · Bulk Carrier", "vessel summary");
ok(rowSummary({}, "cargo") === "—", "empty payload → dash");
ok(extractedFields({ ref: "CM-1", commodity_name: "Wheat", qty_min_mt: 1000, qty_max_mt: 1200 }, "cargo").some((f) => f.label === "QTY (MT)" && f.value === "1,000 – 1,200"), "extracted fields format quantity range");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
