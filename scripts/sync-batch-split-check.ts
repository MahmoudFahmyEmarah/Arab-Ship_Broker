// Behavioural check for classifyWithSplit (4 Nov 2026: a cut-off classification reply "{}" failed a whole backfill
// page). No network: a fake classifier "cuts off" any batch larger than a set size. Run: npx tsx scripts/sync-batch-split-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyWithSplit, isUnreadableReply } from "../lib/sync/email/batch-split";
import type { EmailMsg } from "../lib/sync/email/types";

const mail = (n: number): EmailMsg[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, from: "b@x", subject: `s${i}`, date: null, text: `order ${i}` }) as unknown as EmailMsg);
// exactly the error LangChain raised in production on 4 Nov 2026
const CUT_OFF = new Error('Failed to parse. Text: "{}". Error: [{"expected":"array","code":"invalid_type","path":["results"]}] Troubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/OUTPUT_PARSING_FAILURE/');

function fakeRun(maxFit: number) {
  const calls: number[] = [];
  const run = async (b: EmailMsg[]) => {
    calls.push(b.length);
    if (b.length > maxFit) throw CUT_OFF;
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
    const f = fakeRun(10); const splits: number[] = [];
    const r = await classifyWithSplit(mail(10), f.run, (s) => splits.push(s));
    assert.deepEqual([f.calls, splits, r.cargo.length], [[10], [], 10]);
  });
  await t("a cut-off batch of 10 is halved until every part fits, and no email is lost", async () => {
    const f = fakeRun(3); const splits: number[] = [];
    const r = await classifyWithSplit(mail(10), f.run, (s) => splits.push(s));
    assert.equal(r.cargo.length, 10, "every email's records arrive");
    assert.deepEqual([...r.cargo].sort(), mail(10).map((e) => `cargo:${e.subject}`).sort(), "each email exactly once");
    assert.deepEqual(splits.sort((a, b) => b - a), [10, 5, 5], "10 → 5+5 → 3+2 each");
  });
  await t("a single email whose reply is still cut off fails with a message that says so", async () => {
    const f = fakeRun(0);
    await assert.rejects(classifyWithSplit(mail(1), f.run, () => {}), /could not be read even on its own .* Failed to parse/);
  });
  await t("a transient error is not split: it surfaces for the normal retry", async () => {
    const splits: number[] = [];
    await assert.rejects(classifyWithSplit(mail(6), async () => { throw new Error("fetch failed"); }, (s) => splits.push(s)), /fetch failed/);
    assert.deepEqual(splits, []);
  });
  await t("run.ts splits instead of retrying an unreadable reply", async () => {
    const run = readFileSync("lib/sync/email/run.ts", "utf8").replace(/\r\n/g, "\n");
    assert.match(run, /if \(isUnreadableReply\(e\)\) throw e;/, "withRetry never repeats a cut-off batch");
    assert.match(run, /const res = await classifyWithSplit\(\n        batch,\n        \(b\) => withRetry\(\(\) => withTimeout\(graph\.invoke\(\{ emails: b \}\), BATCH_TIMEOUT_MS, "classify"\), RETRIES\),/, "every batch goes through the split");
  });
  console.log(`SYNC BATCH SPLIT: ${n} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
