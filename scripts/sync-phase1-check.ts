/**
 * Data Sync hardening · phase 1 checks (no network). Run:  npx tsx scripts/sync-phase1-check.ts
 *  - UID pages are the lowest UIDs first, exactly `limit` of them
 *  - the checkpoint rule: date pages with more waiting move only the clock;
 *    a drained date page or a UID page moves the UID; an explicit start point
 *    never touches the UID checkpoint
 *  - the WhatsApp per-call timeout always fits the remaining budget
 * The claim / lease SQL is exercised by supabase/tests/data_sync/phase7_intake_smoke.sql.
 */
import { pickUidPage } from "@/lib/sync/email/imap";
import { checkpointAfterPage } from "@/lib/sync/state";
import { batchTimeout } from "@/lib/sync/whatsapp/process";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const T = (s: string) => new Date(`2026-09-18T${s}Z`);

console.log("UID page");
{
  const metas = [7, 3, 9, 1, 12, 5].map((uid) => ({ uid, when: T("08:00:00") }));
  const r = pickUidPage(metas, 4);
  ok(r.page.map((m) => m.uid).join(",") === "1,3,5,7", "lowest four UIDs, in order");
  ok(r.hasMore && r.lastUid === 7, "hasMore with lastUid = highest of the page");
  const r2 = pickUidPage(metas, 10);
  ok(!r2.hasMore && r2.lastUid === 12, "whole set → drained, lastUid = 12");
  ok(pickUidPage([], 5).lastUid === null, "empty → no UID");
}

console.log("checkpoint after a page");
const started = T("10:00:00");
{
  const c = checkpointAfterPage({ mode: "date", hasMore: true, newestAt: T("09:30:00"), uidValidity: 1234, lastUid: 500 }, started, false);
  ok(c.lastSyncAt.getTime() === T("09:30:00").getTime(), "date page with more waiting: clock = newest of the page");
  ok(c.uidValidity === null && c.lastUid === null, "…and the UID checkpoint is not touched");
}
{
  const c = checkpointAfterPage({ mode: "date", hasMore: false, newestAt: T("09:30:00"), uidValidity: 1234, lastUid: 500 }, started, false);
  ok(c.lastSyncAt.getTime() === started.getTime(), "date page that drained the inbox: clock = run start");
  ok(c.uidValidity === 1234 && c.lastUid === 500, "…and the UID checkpoint starts");
}
{
  const c = checkpointAfterPage({ mode: "uid", hasMore: true, newestAt: T("09:45:00"), uidValidity: 1234, lastUid: 560 }, started, false);
  ok(c.lastUid === 560 && c.uidValidity === 1234, "UID page with more waiting: UID moves to the page's highest");
  ok(c.lastSyncAt.getTime() === T("09:45:00").getTime(), "…clock = newest of the page");
}
{
  const c = checkpointAfterPage({ mode: "date", hasMore: false, newestAt: T("09:30:00"), uidValidity: 1234, lastUid: 500 }, started, true);
  ok(c.uidValidity === null && c.lastUid === null, "explicit start point: UID checkpoint untouched even when drained");
}
{
  const c = checkpointAfterPage({ mode: "uid", hasMore: false, newestAt: null, uidValidity: null, lastUid: null }, started, false);
  ok(c.uidValidity === null && c.lastUid === null && c.lastSyncAt.getTime() === started.getTime(), "no UIDVALIDITY known: clock only");
}

console.log("WhatsApp batch timeout");
ok(batchTimeout(240_000) === 90_000, "plenty of budget → the 90 s ceiling");
ok(batchTimeout(40_000) === 35_000, "40 s left → 35 s, inside the webhook's after() budget");
ok(batchTimeout(8_000) === 5_000, "almost nothing left → the 5 s floor, never negative");
ok(batchTimeout(100_000, 30_000) === 30_000, "a lower ceiling wins");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
