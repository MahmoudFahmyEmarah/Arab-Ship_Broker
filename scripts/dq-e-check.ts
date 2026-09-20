/**
 * Data Quality · workstream E checks (no network). Run:  npx tsx scripts/dq-e-check.ts
 *  - the run permission sits between view and edit
 *  - settings are validated on the server, in words the console can show
 *  - the member forms map their payloads to the columns the gate reads, and
 *    a refusal happens only under enforcement
 * Write-path coverage is scripts/dq-write-paths-check.ts; the config events
 * and CHECK constraints are supabase/tests/data_quality/dq_e_policy_smoke.sql.
 */
import { canAccess } from "@/lib/admin/sections";
import { settingsProblems } from "@/lib/dq/settings-validate";
import { cargoFormDraftRow, draftIssuesMessage, draftRefused, ledgerCargoDraftRow, ledgerPositionDraftRow } from "@/lib/dq/member-draft";
import type { MemberDraftVerdict } from "@/lib/dq/member-gate";
import type { DqSettings } from "@/lib/dq/types";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

console.log("permissions");
ok(canAccess("dataquality", "sub", { dataquality: "run" }) === "run", "a sub-admin with the run permission gets run");
ok(canAccess("dataquality", "sub", { dataquality: "view" }) === "view", "view stays view");
ok(canAccess("dataquality", "super", null) === "edit", "the owner edits");
ok(canAccess("datasync", "sub", { datasync: "run" }) === "none", "owner-only sections ignore perms");

console.log("settings validation");
ok(settingsProblems({}).length === 0, "an empty patch is fine");
ok(settingsProblems({ batch_size: 50 }).some((p) => /Batch size/.test(p)), "batch size below 100 is refused");
ok(settingsProblems({ ai_daily_tokens: -5 }).some((p) => /token budget/.test(p)), "a negative budget is refused");
ok(settingsProblems({ nightly_time: "25:00" }).some((p) => /HH:MM/.test(p)), "an impossible time is refused");
ok(settingsProblems({ nightly_time: "22:15" }).length === 0, "a valid time passes");
ok(settingsProblems({ auto_apply_threshold: 1.2 }).length === 1, "a threshold above 1 is refused");
ok(settingsProblems({ weights: { error: 3, warn: 1, info: 0.2 } }).length === 0, "complete weights pass");
ok(settingsProblems({ weights: { error: 0, warn: 1 } as unknown as DqSettings["weights"] }).length >= 2, "incomplete or zero weights are refused");
ok(settingsProblems({ notify: { recipients: ["ops@arabshipbroker.com", "nope"] } as unknown as DqSettings["notify"] }).some((p) => /not an email/.test(p)), "a bad recipient is named");

console.log("draft rows");
const cargo = ledgerCargoDraftRow({ commodity_name: "Wheat", cargo_type: "Dry Bulk", qty_mt: 6000, volume_cbm: 8000, load_port_locode: "UAIZM", disch_port_locode: "EGALY", laycan_from: "2026-10-01", is_spot: false });
ok(cargo.qty_min_mt === 6000 && cargo.qty_max_mt === 6000 && cargo.load_port_locode === "UAIZM", "ledger cargo maps quantity and ports to columns");
const parcel = ledgerCargoDraftRow({ parcels: [{ commodity_name: "Barley", cargo_type: "Dry Bulk", qty_mt: 3000 }], load_port_locode: "UAIZM", disch_port_locode: "EGALY", laycan_from: "2026-10-01" });
ok(parcel.commodity_name === "Barley" && parcel.qty_max_mt === 3000, "a multi-parcel payload maps its first parcel");
const pos = ledgerPositionDraftRow({ availability: { status: "Open", open_port_locode: "TRSSX", open_from: "2026-10-03", wog: true } });
ok(pos.open_port_locode === "TRSSX" && pos.open_date === "2026-10-03" && pos.wog === true, "ledger position maps to vessel_availability columns");
const classic = cargoFormDraftRow({ load_port_locode: "UAIZM", qty_min_mt: 1, safety_answers: { q1: "y" } });
ok(!("safety_answers" in classic) && classic.load_port_locode === "UAIZM", "the classic form drops the answers block and keeps columns");

console.log("verdict wording");
const issues: MemberDraftVerdict["issues"] = [
  { rule_code: "DQ-C07", name: "qty", severity: "error", field: "qty_max_mt", mode: "block", message: "quantity range ordered" },
  { rule_code: "DQ-M01", name: "dwt", severity: "warn", field: null, mode: "warn", message: "DWT within range" },
];
const shadow: MemberDraftVerdict = { enforcing: false, blocked: true, errors: 0, issues, correlation_id: "6f1d2c3a-0000-4000-8000-000000000001" };
const enforced: MemberDraftVerdict = { enforcing: true, blocked: true, errors: 0, issues, correlation_id: "6f1d2c3a-0000-4000-8000-000000000002" };
ok(!draftRefused(shadow) && draftRefused(enforced), "a block refuses only under enforcement");
ok(draftRefused({ enforcing: true, blocked: false, errors: 1, issues: [], correlation_id: "6f1d2c3a-0000-4000-8000-000000000003" }), "a rule that could not evaluate refuses under enforcement");
ok(/would be refused once enforcement is on/.test(draftIssuesMessage(shadow)) && /Please check/.test(draftIssuesMessage(shadow)), "shadow wording warns about both");
ok(/^Not posted — fix these first: qty_max_mt: quantity range ordered \(DQ-C07\)/.test(draftIssuesMessage(enforced)), "enforced wording names the field and the rule");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
