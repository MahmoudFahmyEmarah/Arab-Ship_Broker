/**
 * Data Sync hardening · phases 4 + 5 checks (no network). Run:  npx tsx scripts/sync-phase4-check.ts
 *  - unknown port codes on a cargo payload are named (field + code), the
 *    batch's own ports sheet counts as known, blanks are ignored
 *  - workbook limits refuse oversized input before it is parsed further
 */
import { readFileSync } from "node:fs";
import { referencedPortCodes, unknownPortCodes } from "@/lib/sync/ports-check";
import { WORKBOOK_LIMITS, checkGrid } from "@/lib/sync/xlsx-source";
import { queueOpenDate } from "@/lib/sync/stage";
import { calendarDay } from "@/lib/sync/normalize";

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

console.log("vessel review queue refresh (3 Nov 2026)");
{
  // a re-sighted pending vessel is refreshed with a plain UPDATE: an upsert of the partial patch failed the NOT NULL
  // vessel_name ("null value in column vessel_name", reproduced on a clone) and nulled keys another patch lacked
  const stage = readFileSync("lib/sync/stage.ts", "utf8").replace(/\r\n/g, "\n");
  ok(/\.update\(patch\)\.eq\("id", id\)/.test(stage), "each refreshed row is a plain update by id");
  ok(stage.includes("merged.set(u.id, { ...(merged.get(u.id) ?? {}), ...u.patch });"), "sightings of one row merge in order before the update");
  ok(!/upsert\(updates\.map/.test(stage), "the refresh is never an upsert of partial patches");
}

console.log("vessel review queue open date (12 Nov 2026)");
{
  // one "SPOT" from the model failed the whole queue write ("invalid input syntax for type date") and the sync page
  const posted = "2026-09-09T11:57:00.000Z";
  const now = new Date("2026-11-12T08:00:00Z");
  const od = (open: unknown, src: unknown = posted) => queueOpenDate({ OPEN_DATE: open as string, _SRC_DATE: src as string }, now);
  ok(od("2026-09-15") === "2026-09-15", "a real extracted day is kept");
  ok(od(" 2026-09-15 ") === "2026-09-15", "surrounding spaces are tolerated");
  for (const w of ["SPOT", "spot", "PPT", "PROMPT", "prompt"]) ok(od(w) === "2026-09-09", `"${w}" means open on the circular's day`);
  for (const w of ["end Nov", "10-12 Aug", "2026-02-30", "2026-13-01", "2026-9-15", "15/09/2026", "TBA"])
    ok(od(w) === "2026-09-09", `"${w}" never reaches the date column; the posted day stands in`);
  ok(od(null) === "2026-09-09" && od("") === "2026-09-09", "no open date → the posted day");
  ok(od("SPOT", null) === "2026-11-12" && od("SPOT", "not a date") === "2026-11-12", "no usable posted date → today");
  ok(od(2026 as unknown) === "2026-09-09", "a number is not a day");
  ok(calendarDay("2024-02-29") === "2024-02-29" && calendarDay("2026-02-29") === null, "leap days are checked");
  ok(calendarDay("0050-01-01") === null, "a two-digit-era year is not taken for 1950");
  const stage = readFileSync("lib/sync/stage.ts", "utf8").replace(/\r\n/g, "\n");
  ok(/open_date: queueOpenDate\(raw\),/.test(stage) && !/open_date: asStr\(raw\["OPEN_DATE"\]\)/.test(stage),
    "the queue row takes its open date only through queueOpenDate");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
