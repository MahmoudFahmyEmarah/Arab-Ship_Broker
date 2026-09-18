/**
 * Data Sync hardening · phase 0 checks (no network). Run:  npx tsx scripts/sync-phase0-check.ts
 *  - cron endpoints accept ONLY `Authorization: Bearer <CRON_SECRET>`; the
 *    x-vercel-cron header proves nothing
 *  - the email fetch takes the OLDEST page and never leaves a message behind
 *    in the cutoff second, so a backlog larger than one page is drained over
 *    successive runs (the review's 125-mail / limit-50 case)
 */
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";
import { pickPage } from "@/lib/sync/email/imap";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const hdr = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

console.log("cron authorization");
process.env.CRON_SECRET = "s3cret";
ok(cronAuthorized("Bearer s3cret"), "correct bearer is accepted");
ok(!cronAuthorized("Bearer wrong"), "wrong bearer is refused");
ok(!cronAuthorized(null), "no header is refused");
ok(!cronAuthorized(""), "empty header is refused");
ok(cronTrigger(hdr({ "x-vercel-cron": "1" })) === "cron", "x-vercel-cron only labels the trigger");
ok(!cronAuthorized(null) && cronTrigger(hdr({ "x-vercel-cron": "1" })) === "cron", "x-vercel-cron alone does not authorize");
{
  const env = process.env.NODE_ENV;
  delete process.env.CRON_SECRET;
  (process.env as Record<string, string>).NODE_ENV = "production";
  ok(!cronAuthorized("Bearer anything"), "no secret configured → closed in production");
  (process.env as Record<string, string>).NODE_ENV = env ?? "test";
}

console.log("email page selection");
const at = (s: string) => new Date(`2026-09-18T${s}Z`);
const mk = (n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ uid: start + i + 1, when: new Date(at("08:00:00").getTime() + (start + i) * 61_000) }));
{
  // 125 messages, limit 50, three runs: every message exactly once
  const all = mk(125);
  const seen = new Set<number>();
  let since = new Date(0);
  let runs = 0;
  for (;;) {
    runs += 1;
    const newer = all.filter((m) => m.when.getTime() > since.getTime());
    const r = pickPage(newer, 50);
    for (const m of r.page) { ok(!seen.has(m.uid), `uid ${m.uid} processed once`) ; seen.add(m.uid); }
    if (!r.hasMore) break;
    since = r.newestAt!; // the checkpoint after a full page
    if (runs > 5) break;
  }
  ok(seen.size === 125, `all 125 messages processed across ${runs} runs (expected 3)`);
  ok(runs === 3, "took exactly three runs");
}
{
  // oldest first
  const r = pickPage(mk(10), 3);
  ok(r.page.map((m) => m.uid).join(",") === "1,2,3", "the oldest three are taken, not the newest");
  ok(r.hasMore && r.newestAt?.getTime() === r.page[2].when.getTime(), "newestAt is the newest of the page and hasMore is set");
}
{
  // cutoff second: two messages share the second at the page boundary
  const t = at("09:00:00");
  const metas = [
    { uid: 1, when: new Date(t.getTime() - 5000) },
    { uid: 2, when: new Date(t.getTime()) },
    { uid: 3, when: new Date(t.getTime() + 400) },   // same second as uid 2
    { uid: 4, when: new Date(t.getTime() + 60_000) },
  ];
  const r = pickPage(metas, 2);
  ok(r.page.length === 3 && r.page.map((m) => m.uid).join(",") === "1,2,3", "page stretches to include the message sharing the cutoff second");
  ok(r.hasMore && r.newestAt?.getTime() === metas[2].when.getTime(), "checkpoint lands on the stretched page's newest message");
  // and the next run, with since = newestAt, sees only uid 4
  const next = metas.filter((m) => m.when.getTime() > r.newestAt!.getTime());
  ok(next.length === 1 && next[0].uid === 4, "next run picks up exactly the remaining message");
}
{
  const r = pickPage([], 50);
  ok(r.page.length === 0 && !r.hasMore && r.newestAt === null, "empty inbox → empty page, no checkpoint");
  const r2 = pickPage(mk(7), 50);
  ok(r2.page.length === 7 && !r2.hasMore, "fewer than the limit → whole set, inbox drained");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
