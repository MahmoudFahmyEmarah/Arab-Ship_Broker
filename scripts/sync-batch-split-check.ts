// Behavioural check for classifyWithSplit (4 Nov 2026: a cut-off classification reply "{}" failed a whole backfill
// page). No network: a fake classifier "cuts off" any batch whose records would not fit. Run: npx tsx scripts/sync-batch-split-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyWithSplit, createLimiter, halveEmail, isUnreadableReply, MIN_HALVE_CHARS } from "../lib/sync/email/batch-split";
import type { EmailMsg } from "../lib/sync/email/types";

const email = (i: number, text = `order ${i}`): EmailMsg => ({ id: `m${i}`, from: "b@x", subject: `s${i}`, date: "2026-09-10", text }) as unknown as EmailMsg;
const mail = (n: number): EmailMsg[] => Array.from({ length: n }, (_, i) => email(i));
// exactly the error LangChain raised in production on 4 Nov 2026
const CUT_OFF = new Error('Failed to parse. Text: "{}". Error: [{"expected":"array","code":"invalid_type","path":["results"]}] Troubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/OUTPUT_PARSING_FAILURE/');

/** A fake classifier whose reply is cut off when the batch carries more than `maxChars` of text in total. */
function fakeRun(maxChars: number) {
  const calls: number[] = [];
  const run = async (b: EmailMsg[]) => {
    calls.push(b.length);
    if (b.reduce((a, e) => a + e.text.length, 0) > maxChars) throw CUT_OFF;
    return { cargo: b.map((e) => `cargo:${e.subject}`), vessels: [] as string[] };
  };
  return { run, calls };
}

let n = 0;
const t = async (name: string, fn: () => Promise<void>) => { await fn(); n++; console.log(`  ok   ${name}`); };

async function main() {
  await t("the production error text is recognised as an unreadable reply; ordinary errors are not", async () => {
    assert.equal(isUnreadableReply(CUT_OFF), true);
    for (const e of [new Error("fetch failed"), new Error("classify timed out after 90s"), new Error("429 Too Many Requests")]) assert.equal(isUnreadableReply(e), false);
  });
  await t("a batch that fits is classified in one call, unchanged", async () => {
    const f = fakeRun(10_000); const splits: string[] = [];
    const r = await classifyWithSplit(mail(10), f.run, (s) => splits.push(s));
    assert.deepEqual([f.calls, splits, r.cargo.length], [[10], [], 10]);
  });
  await t("a cut-off batch of 10 is halved until every part fits, and every email arrives exactly once", async () => {
    const f = fakeRun(3 * 7); const splits: string[] = [];   // "order N" is 7 chars: at most 3 emails fit
    const r = await classifyWithSplit(mail(10), f.run, (s) => splits.push(s));
    assert.deepEqual([...r.cargo].sort(), mail(10).map((e) => `cargo:${e.subject}`).sort());
    assert.equal(splits.length, 3, "10 → 5+5 → 3+2 each");
    assert.ok(splits.every((s) => /was cut off — splitting them/.test(s)));
  });
  await t("one large email that is still cut off is read in two overlapping halves (the backfill is never stuck on it)", async () => {
    const big = email(7, Array.from({ length: 400 }, (_, i) => `line ${i} 5000 mt wheat Constanta/Alexandria`).join("\n"));
    const f = fakeRun(big.text.length - 1);                   // the whole email never fits; each half does
    const splits: string[] = [];
    const r = await classifyWithSplit([big], f.run, (s) => splits.push(s));
    assert.deepEqual(r.cargo, ["cargo:s7 (half 1)", "cargo:s7 (half 2)"]);
    assert.match(splits[0], /one large email \("s7"\) was cut off — reading it in two overlapping halves/);
    const [h1, h2] = halveEmail(big);
    assert.ok(h1.text.length < big.text.length && h2.text.length < big.text.length, "each half is shorter, so recursion terminates");
    assert.ok(big.text.startsWith(h1.text) && big.text.endsWith(h2.text), "half 1 starts the text, half 2 ends it");
    assert.ok(h1.text.length > big.text.length - h2.text.length, "the halves overlap, so together they cover the whole text and no order is cut blind");
  });
  await t("a short email that is still unreadable fails with its subject, marked for the advice", async () => {
    const f = fakeRun(0);
    assert.equal(halveEmail(email(1)).length, 0, `under ${MIN_HALVE_CHARS} chars is never halved`);
    await assert.rejects(classifyWithSplit([email(1)], f.run, () => {}), /^Error: UNREADABLE_EMAIL: .*"s1" \(2026-09-10\) could not be read even on its own .*Failed to parse/);
  });
  await t("a transient error is not split: it surfaces for the normal retry", async () => {
    const splits: string[] = [];
    await assert.rejects(classifyWithSplit(mail(6), async () => { throw new Error("fetch failed"); }, (s) => splits.push(s)), /fetch failed/);
    assert.deepEqual(splits, []);
  });
  await t("both halves always finish (and are metered) even when one of them fails", async () => {
    const finished: string[] = [];
    const run = async (b: EmailMsg[]) => {
      if (b.length > 1) throw CUT_OFF;
      await new Promise((r) => setTimeout(r, b[0].subject === "s1" ? 30 : 0));
      finished.push(b[0].subject);
      if (b[0].subject === "s0") throw new Error("fetch failed");
      return { cargo: [b[0].subject], vessels: [] as string[] };
    };
    await assert.rejects(classifyWithSplit(mail(2), run, () => {}), /fetch failed/);
    assert.deepEqual(finished.sort(), ["s0", "s1"], "the slower half was not orphaned");
  });
  await t("the shared limiter caps calls in flight across nested splits", async () => {
    const gate = createLimiter(5);
    let inFlight = 0, peak = 0;
    const run = (b: EmailMsg[]) => gate(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (b.length > 1) throw CUT_OFF;
      return { cargo: [b[0].subject], vessels: [] as string[] };
    });
    // five batches of ten, every multi-email batch cut off: without the gate this fans out to ~50 calls at once
    const r = await Promise.all(Array.from({ length: 5 }, (_, k) => classifyWithSplit(mail(10).map((e) => ({ ...e, subject: `${k}-${e.subject}` })), run, () => {})));
    assert.equal(r.flatMap((x) => x.cargo).length, 50, "every email arrives");
    assert.ok(peak <= 5, `peak in flight ${peak} must not exceed 5`);
  });
  await t("run.ts: no retry of an unreadable reply, every call through one limiter, its own advice", async () => {
    const run = readFileSync("lib/sync/email/run.ts", "utf8").replace(/\r\n/g, "\n");
    assert.match(run, /if \(isUnreadableReply\(e\)\) throw e;/, "withRetry never repeats a cut-off batch");
    assert.match(run, /const gate = createLimiter\(CONCURRENCY\);/);
    assert.match(run, /\(b\) => gate\(\(\) => withRetry\(\(\) => withTimeout\(graph\.invoke\(\{ emails: b \}\), BATCH_TIMEOUT_MS, "classify"\), RETRIES\)\),/, "every model call goes through the shared gate");
    assert.match(run, /const unreadable = \/UNREADABLE_EMAIL\/\.test\(firstError \?\? ""\);/, "an unreadable email gets its own advice, not 'fix the key or budget'");
  });
  console.log(`SYNC BATCH SPLIT: ${n} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
