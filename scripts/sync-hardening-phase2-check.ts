/**
 * Data Sync hardening · phase 2 checks (no network). Run:  npx tsx scripts/sync-phase2-check.ts
 * The batch lifecycle as the console reads it: which buttons each status
 * shows, which statuses count as open / terminal / committed. The database
 * side (lock, precondition, discard guard, conflict-aware undo) is exercised
 * by supabase/tests/data_sync/phase8_batch_state_smoke.sql.
 */
import { batchActions, batchStatusLabel, friendlyBatchError, hasCommittedRows, isOpenBatch, isTerminalBatch } from "@/lib/sync/batch-status";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const A = (s: string) => batchActions(s);

console.log("buttons per status");
ok(A("gated").commit && A("gated").discard && !A("gated").undo, "ready: commit or discard");
ok(A("partial").commit && A("partial").undo && !A("partial").discard, "partly committed: commit more or undo, never discard");
ok(A("committed").undo && !A("committed").commit && !A("committed").discard, "committed: undo only");
ok(!A("undone").commit && !A("undone").undo && !A("undone").discard, "undone: nothing");
ok(A("gate_failed").regate && !A("gate_failed").commit && A("gate_failed").discard, "gate failed: re-run the gate or discard, never commit");
ok(A("failed").commit && A("failed").discard && !A("failed").undo, "failed: retry or discard");
ok(A("draft").commit && A("draft").regate, "legacy draft: commit, and may be re-gated");
ok(!A("committing").commit && !A("committing").discard, "committing: hands off");
ok(!A("bogus").commit && !A("bogus").discard, "unknown status: nothing");

console.log("groupings");
ok(isOpenBatch("partial") && isOpenBatch("gated") && !isOpenBatch("committed") && !isOpenBatch("undone"), "open batches");
ok(isTerminalBatch("committed") && isTerminalBatch("undone") && !isTerminalBatch("partial"), "terminal for the review grid");
ok(hasCommittedRows("partial") && hasCommittedRows("committed") && !hasCommittedRows("gated"), "history counts partial as a commit");

console.log("labels and messages");
ok(batchStatusLabel("partial") === "partly committed" && batchStatusLabel("gated") === "ready", "plain-language labels");
ok(batchStatusLabel("whatever") === "whatever", "unknown status shown as is");
ok(friendlyBatchError("DISCARD_GUARD: batch x has committed rows") === "batch x has committed rows", "database prefix stripped");
ok(friendlyBatchError("plain") === "plain", "plain message untouched");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
