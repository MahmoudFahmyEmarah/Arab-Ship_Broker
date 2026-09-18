/**
 * Data Sync hardening · phases 4 + 5 checks (no network). Run:  npx tsx scripts/sync-phase4-check.ts
 *  - unknown port codes on a cargo payload are named (field + code), the
 *    batch's own ports sheet counts as known, blanks are ignored
 *  - workbook limits refuse oversized input before it is parsed further
 */
import { referencedPortCodes, unknownPortCodes } from "@/lib/sync/ports-check";
import { WORKBOOK_LIMITS, checkGrid } from "@/lib/sync/xlsx-source";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

console.log("unknown ports");
const known = new Set(["UAIZM", "EGALY", "TRSSX"]);
{
  const u = unknownPortCodes({ load_port_locode: "UAIZM", disch_port_locode: "egaly", load_port_2_locode: "" }, known);
  ok(u.length === 0, "known codes (any case) and blanks pass");
}
{
  const u = unknownPortCodes({ load_port_locode: "UAIZM", disch_port_locode: "ZZBAD", disch_port_2_locode: "XXNOP" }, known);
  ok(u.length === 2 && u[0].field === "disch_port_locode" && u[0].code === "ZZBAD" && u[1].code === "XXNOP", "each unknown code is named with its field");
}
{
  const u = unknownPortCodes({ disch_port_locode: "ZZNEW" }, known, new Set(["ZZNEW"]));
  ok(u.length === 0, "a port staged in the same batch counts as known");
}
{
  const codes = referencedPortCodes([{ load_port_locode: "uaizm", disch_port_locode: "EGALY" }, { load_port_locode: "UAIZM", load_port_3_locode: null }]);
  ok(codes.length === 2 && codes.includes("UAIZM") && codes.includes("EGALY"), "referenced codes are unique and upper-cased");
}

console.log("workbook limits");
const grid = (rows: number, cols: number, cell = "x") => Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell));
ok(checkGrid("01_CARGO", grid(10, 20)) === null, "a small sheet passes");
ok(/rows/.test(checkGrid("01_CARGO", grid(WORKBOOK_LIMITS.rows + 3, 5)) ?? ""), "too many rows is refused and named");
ok(/columns/.test(checkGrid("01_CARGO", grid(3, WORKBOOK_LIMITS.cols + 1)) ?? ""), "too many columns is refused");
ok(/characters/.test(checkGrid("01_CARGO", grid(3, 3, "y".repeat(WORKBOOK_LIMITS.cellChars + 1))) ?? ""), "an oversized cell is refused");
ok(checkGrid("01_CARGO", grid(3, 3, "y".repeat(WORKBOOK_LIMITS.cellChars))) === null, "a cell at the limit passes");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
