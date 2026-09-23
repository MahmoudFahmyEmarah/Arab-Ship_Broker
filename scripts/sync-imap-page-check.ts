/**
 * Data Sync hardening · UID-mode paging (P2, no network). Run:
 *   npx tsx scripts/sync-imap-page-check.ts
 * The IMAP fetch used to read envelope metadata for the WHOLE backlog on
 * every page; now it reads the first page plus one UID.
 */
import { uidCandidates, pickUidPage } from "@/lib/sync/email/imap";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

const backlog = Array.from({ length: 5000 }, (_, i) => 10_000 - i); // 5,000 UIDs, unsorted (descending)
const c = uidCandidates(backlog, 5001, 50);
ok(c.waiting === 5000, "the backlog size is counted", String(c.waiting));
ok(c.fetch.length === 51, "metadata is fetched for the page plus one row only", String(c.fetch.length));
ok(c.fetch[0] === 5001 && c.fetch[50] === 5051, "…the lowest UIDs first");
const p = pickUidPage(c.fetch.map((uid) => ({ uid, when: new Date() })), 50);
ok(p.page.length === 50 && p.hasMore && p.lastUid === 5050, "the page is 50 rows, more waits, lastUid = 5050");
const tail = uidCandidates([7, 3, 9], 1, 50);
ok(tail.fetch.length === 3 && tail.waiting === 3, "a backlog smaller than a page is read whole");
ok(!pickUidPage(tail.fetch.map((uid) => ({ uid, when: new Date() })), 50).hasMore, "…and reports nothing more");
const past = uidCandidates([120, 121], 200, 50); // IMAP returns the highest UID for n:* past the end
ok(past.fetch.length === 0 && past.waiting === 0, "UIDs below the checkpoint are dropped");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
