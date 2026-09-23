/**
 * Data Quality · workstream C checks (no network). Run:  npx tsx scripts/dq-c-check.ts
 * The run coverage wording the console shows (unit-based: rule × table ×
 * check) and the finding statuses. Snapshot keys, key-preparation errors,
 * completed_with_errors, retry and partial snapshots are exercised by
 * supabase/tests/data_quality/dq_c_run_integrity_smoke.sql.
 */
import { ISSUE_BADGE, ISSUE_LABEL, ISSUE_STATUS_MANUAL, RUN_BADGE, RUN_LABEL, runCoverageLabel, type DqIssueStatus, type DqRunStatus } from "@/lib/dq/types";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

const all: DqRunStatus[] = ["queued", "running", "paused", "completed", "completed_with_errors", "failed", "cancelled"];
ok(all.every((s) => RUN_LABEL[s] && RUN_BADGE[s]), "every run status has a label and a badge");
ok(RUN_LABEL.completed_with_errors === "completed with errors", "the new status reads plainly");
ok(runCoverageLabel({ status: "completed", coverage_pct: 100, rules_failed: 0, rules_expected: 12, checks_failed: 0, checks_expected: 30 }) === "every check saw every row", "clean run");
ok(runCoverageLabel({ status: "completed_with_errors", coverage_pct: 85.7, rules_failed: 4, rules_expected: 5, checks_failed: 6, checks_expected: 7 }) === "86 % — 6 of 7 checks failed (4 rules)", "partial run counts failed check units and the rules behind them");
ok(runCoverageLabel({ status: "completed_with_errors", coverage_pct: 0, rules_failed: 1, rules_expected: 1, checks_failed: 1, checks_expected: 1 }) === "0 % — 1 of 1 check failed (1 rule)", "singular");
ok(runCoverageLabel({ status: "running", coverage_pct: null, rules_failed: 0, rules_expected: 0 }) === "—", "no coverage while running");
ok(runCoverageLabel({ status: "completed", coverage_pct: null, rules_failed: 0, rules_expected: 3 }) === "every check saw every row", "a pre-C completed run (no coverage recorded) reads as full");
ok(runCoverageLabel({ status: "completed_with_errors", coverage_pct: 93.4, rules_failed: 2, rules_expected: 12 }) === "93 % — 2 of 12 checks failed (2 rules)", "a run settled before check units existed falls back to rule counts");

const statuses: DqIssueStatus[] = ["open", "fixed", "ignored", "false_positive", "escalated", "rule_disabled", "check_removed", "record_gone"];
ok(statuses.every((s) => ISSUE_LABEL[s] && ISSUE_BADGE[s]), "every finding status (check_removed included) has a label and a badge");
ok(ISSUE_LABEL.check_removed === "check removed" && ISSUE_LABEL.rule_disabled === "rule disabled", "parked findings say why they are parked");
ok(!ISSUE_STATUS_MANUAL.includes("check_removed") && !ISSUE_STATUS_MANUAL.includes("rule_disabled") && !ISSUE_STATUS_MANUAL.includes("record_gone"), "parked statuses are set by runs and rule changes, never by hand");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
