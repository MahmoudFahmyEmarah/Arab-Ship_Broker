/**
 * Data Sync hardening · what the console tells the operator about a commit
 * (P0-3 / P1-4, no network). Run:  npx tsx scripts/sync-batch-status-check.ts
 */
import { batchActions, describeCommit, sheetsFullyCommitted } from "@/lib/sync/batch-status";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

console.log("commit outcome wording");
{
  const full = describeCommit({ inserted: 9, updated: 1, skipped: 0, status: "committed", remaining: { unresolved: 0, pending: 0, invalid: 0, blocked: 0, error: 0 } }, true);
  ok(full.ok && /^Batch committed/.test(full.text), "a whole-batch commit that finished says committed", full.text);
  const part = describeCommit({ inserted: 9, updated: 0, skipped: 0, status: "partial", remaining: { unresolved: 1, pending: 0, invalid: 1, blocked: 1, error: 0 } }, true);
  ok(!part.ok && /^Partly committed/.test(part.text) && /1 blocked by the gate/.test(part.text) && /run the gate and commit again/.test(part.text), "…and says 'partly committed' with what remains when blocked rows are left", part.text);
  const err = describeCommit({ inserted: 2, updated: 0, skipped: 0, status: "partial", remaining: { unresolved: 3, pending: 1, invalid: 2, blocked: 0, error: 2 } }, false);
  ok(/2 the gate could not evaluate/.test(err.text) && /1 not yet committed/.test(err.text), "gate errors and pending rows are named");
  const legacy = describeCommit({ inserted: 1, updated: 2, skipped: 0 }, false);
  ok(legacy.ok && legacy.text === "1 inserted · 2 updated", "a result without a status (pre-migration database) still reads");
}

console.log("which sheets count as committed");
{
  const counts = { cargo: { new: 0, updated: 0, unchanged: 3, invalid: 0, errors: 0 }, ports: { new: 0, updated: 0, unchanged: 0, invalid: 1, errors: 1 } };
  ok(sheetsFullyCommitted("partial", counts, ["cargo", "ports"]).has("cargo"), "in a partial batch a sheet with nothing left counts as committed");
  ok(!sheetsFullyCommitted("partial", counts, ["cargo", "ports"]).has("ports"), "…a sheet with an invalid row does not");
  ok(sheetsFullyCommitted("committed", counts, ["cargo", "ports"]).size === 2, "a committed batch: every sheet");
  ok(sheetsFullyCommitted("gated", counts, ["cargo", "ports"]).size === 0, "a gated batch: none");
}

console.log("actions per status");
ok(batchActions("partial").regate && batchActions("partial").commit && batchActions("partial").undo, "a partial batch offers Run gate, commit and undo");
ok(!batchActions("committed").commit && !batchActions("committed").regate, "a committed batch is terminal");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
