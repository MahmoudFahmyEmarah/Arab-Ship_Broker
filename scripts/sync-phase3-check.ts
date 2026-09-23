/**
 * Data Sync hardening · phase 3 checks (no network). Run:  npx tsx scripts/sync-phase3-check.ts
 * The gate-related helpers the console and staging share. The database side
 * (verdict persisted per row, commit refusing stale rows, regate, live edits
 * on the admin channel) is exercised by supabase/tests/data_sync/phase9_gate_smoke.sql.
 */
import { friendlyBatchError, gateChannelFor, isGateStale } from "@/lib/sync/batch-status";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

console.log("gate channel per source");
ok(gateChannelFor("upload") === "sync", "workbook upload → sync");
ok(gateChannelFor("email") === "pipeline", "circular → pipeline");
ok(gateChannelFor("whatsapp") === "pipeline", "WhatsApp → pipeline");

console.log("commit refusals the gate can fix");
const msg = "GATE_STALE: 3 row(s) must pass the data-quality gate before they can be committed (edited since the gate checked it) — run the gate on this batch and try again";
ok(isGateStale(msg), "GATE_STALE is recognised");
ok(friendlyBatchError(msg).startsWith("3 row(s) must pass"), "prefix stripped for the toast");
ok(isGateStale(friendlyBatchError(msg)), "…and still recognised after stripping");
ok(!isGateStale("BATCH_STATE: this batch is already committed"), "other refusals are not gate refusals");
ok(friendlyBatchError("GATE_FAILED: the data-quality gate could not run — boom") === "the data-quality gate could not run — boom", "GATE_FAILED prefix stripped");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
