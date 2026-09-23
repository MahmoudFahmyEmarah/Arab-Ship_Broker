/**
 * Inbox schedule — unit checks (no network). Run:  npx tsx scripts/schedule-check.ts
 * Pins the cadence maths the cron and the Connections editor share.
 */
import { nextRunAt, isDue, describeSchedule, localHourToUtc, utcHourToLocal, specFromRow, type ScheduleSpec } from "@/lib/sync/email/schedule";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };
const iso = (d: Date | null) => d?.toISOString() ?? "null";
const base: ScheduleSpec = { enabled: true, kind: "daily", hourUtc: 2, intervalDays: 2, weekday: 1, tz: null };
const at = (s: string) => new Date(s);

console.log("daily");
ok(iso(nextRunAt(base, at("2026-09-12T10:00:00Z"))) === "2026-09-13T02:00:00.000Z", "after today's slot → tomorrow 02:00");
ok(iso(nextRunAt(base, at("2026-09-12T01:30:00Z"))) === "2026-09-12T02:00:00.000Z", "before today's slot → today 02:00");
ok(iso(nextRunAt(base, at("2026-09-12T02:00:00Z"))) === "2026-09-13T02:00:00.000Z", "exactly at the slot → next day (strictly after)");
ok(nextRunAt({ ...base, enabled: false }) === null, "disabled → null");

console.log("weekly");
const wk = { ...base, kind: "weekly" as const, weekday: 1, hourUtc: 6 }; // Mondays 06:00
ok(iso(nextRunAt(wk, at("2026-09-12T10:00:00Z"))) === "2026-09-14T06:00:00.000Z", "Saturday → next Monday", iso(nextRunAt(wk, at("2026-09-12T10:00:00Z"))));
ok(iso(nextRunAt(wk, at("2026-09-14T05:00:00Z"))) === "2026-09-14T06:00:00.000Z", "Monday before the hour → today");
ok(iso(nextRunAt(wk, at("2026-09-14T07:00:00Z"))) === "2026-09-21T06:00:00.000Z", "Monday after the hour → next week");

console.log("every N days");
const n3 = { ...base, kind: "every_n_days" as const, intervalDays: 3, hourUtc: 14 };
ok(iso(nextRunAt(n3, at("2026-09-12T10:00:00Z"), null)) === "2026-09-12T14:00:00.000Z", "no anchor, before the hour → today");
ok(iso(nextRunAt(n3, at("2026-09-12T15:00:00Z"), null)) === "2026-09-15T14:00:00.000Z", "no anchor, after the hour → +3 days");
ok(iso(nextRunAt(n3, at("2026-09-13T09:00:00Z"), at("2026-09-12T14:00:00Z"))) === "2026-09-15T14:00:00.000Z", "anchored to the previous run → keeps the rhythm");
ok(iso(nextRunAt(n3, at("2026-09-20T09:00:00Z"), at("2026-09-12T14:00:00Z"))) === "2026-09-21T14:00:00.000Z", "cron was down a week → next slot on the original rhythm, never in the past");

console.log("isDue");
ok(isDue(at("2026-09-12T02:00:00Z"), at("2026-09-12T02:05:00Z")), "5 min late is due");
ok(!isDue(at("2026-09-12T02:00:00Z"), at("2026-09-12T01:59:00Z")), "1 min early is not");
ok(!isDue(null), "no next run → never due");

console.log("labels & zones");
ok(describeSchedule(base) === "Daily at 02:00 UTC", "daily label", describeSchedule(base));
ok(describeSchedule({ ...base, tz: "Africa/Cairo" }).startsWith("Daily at 02:00 UTC (0"), "label shows the local wall clock too", describeSchedule({ ...base, tz: "Africa/Cairo" }));
ok(describeSchedule({ ...base, kind: "weekly", weekday: 5 }) === "Every Friday at 02:00 UTC", "weekly label");
ok(describeSchedule({ ...base, kind: "every_n_days", intervalDays: 2 }) === "Every 2 days at 02:00 UTC", "every-N label");
const cairoUtc = localHourToUtc(9, "Africa/Cairo");
ok(cairoUtc === 6 || cairoUtc === 7, "09:00 Cairo → 06:00/07:00 UTC (DST-dependent)", String(cairoUtc));
ok(utcHourToLocal(cairoUtc, "Africa/Cairo") === 9, "round-trips back to 09:00 local");
ok(localHourToUtc(23, "UTC") === 23 && utcHourToLocal(0, "UTC") === 0, "UTC is identity");
ok(localHourToUtc(1, "Asia/Tokyo") === 16, "01:00 Tokyo → 16:00 UTC previous day (wraps)");
ok(specFromRow(null).enabled === false && specFromRow({ schedule_enabled: true, schedule_kind: "bogus", schedule_hour_utc: 30 }).kind === "daily", "specFromRow tolerates nulls and bad values");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
