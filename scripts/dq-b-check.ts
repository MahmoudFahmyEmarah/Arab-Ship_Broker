/**
 * Data Quality · workstream B checks (no network). Run:  npx tsx scripts/dq-b-check.ts
 * The status vocabulary the console and the database share. The lifecycle
 * itself is exercised end to end by supabase/tests/data_quality/dq_b_lifecycle_smoke.sql.
 */
import { ISSUE_BADGE, ISSUE_LABEL, ISSUE_STATUS_MANUAL, isSuppression, type DqIssueStatus } from "@/lib/dq/types";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

const all: DqIssueStatus[] = ["open", "fixed", "ignored", "false_positive", "escalated", "rule_disabled", "record_gone"];
ok(all.every((s) => typeof ISSUE_LABEL[s] === "string" && ISSUE_LABEL[s].length > 0), "every status has a label");
ok(all.every((s) => typeof ISSUE_BADGE[s] === "string"), "every status has a badge tone");
ok(ISSUE_LABEL.rule_disabled === "rule disabled" && ISSUE_LABEL.record_gone === "record gone", "the two run-set statuses read plainly");
ok(!ISSUE_STATUS_MANUAL.includes("rule_disabled") && !ISSUE_STATUS_MANUAL.includes("record_gone"), "run-set statuses cannot be chosen by hand");
ok(ISSUE_STATUS_MANUAL.includes("ignored") && ISSUE_STATUS_MANUAL.includes("open"), "ignore and reopen are manual");
ok(isSuppression("ignored") && isSuppression("false_positive") && !isSuppression("escalated") && !isSuppression("fixed"), "only ignore and false positive are suppressions");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
