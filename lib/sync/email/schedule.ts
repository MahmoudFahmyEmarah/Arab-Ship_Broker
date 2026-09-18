// Inbox sync cadence — one pure computation shared by the Connections editor
// (preview), setEmailSchedule() (stores next_run_at) and /api/cron/email-sync
// (decides whether a wake-up is a due run, then advances next_run_at).
//
// Everything is computed in UTC. The owner picks the hour in their own zone;
// the editor converts it to UTC before saving and shows both.

export type ScheduleKind = "daily" | "every_n_days" | "weekly";

export interface ScheduleSpec {
  enabled: boolean;
  kind: ScheduleKind;
  /** 0–23, UTC */
  hourUtc: number;
  /** every_n_days: 2–30 */
  intervalDays: number;
  /** weekly: 0 = Sunday … 6 = Saturday, UTC */
  weekday: number;
  /** IANA zone the hour was chosen in — display only */
  tz: string | null;
}

export const DEFAULT_SCHEDULE: ScheduleSpec = { enabled: false, kind: "daily", hourUtc: 2, intervalDays: 2, weekday: 1, tz: null };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY = 86_400_000;
const atHourUtc = (d: Date, hour: number) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0);

/**
 * The first run strictly after `from` (default: now).
 * `anchor` — the previous scheduled run, so "every N days" keeps its rhythm
 * instead of restarting from today whenever the cron catches up late.
 */
export function nextRunAt(spec: ScheduleSpec, from: Date = new Date(), anchor: Date | null = null): Date | null {
  if (!spec.enabled) return null;
  const hour = Math.min(23, Math.max(0, Math.trunc(spec.hourUtc)));
  const fromMs = from.getTime();

  if (spec.kind === "daily") {
    let t = atHourUtc(from, hour);
    if (t <= fromMs) t += DAY;
    return new Date(t);
  }

  if (spec.kind === "weekly") {
    const wd = Math.min(6, Math.max(0, Math.trunc(spec.weekday)));
    let t = atHourUtc(from, hour) + ((wd - from.getUTCDay() + 7) % 7) * DAY;
    if (t <= fromMs) t += 7 * DAY;
    return new Date(t);
  }

  // every_n_days — step from the anchor when there is one, else from today
  const n = Math.min(30, Math.max(2, Math.trunc(spec.intervalDays)));
  let t = anchor ? atHourUtc(anchor, hour) : atHourUtc(from, hour);
  while (t <= fromMs) t += n * DAY;
  return new Date(t);
}

/** Has a scheduled run come due? (tolerates the cron firing a little late) */
export function isDue(nextRun: Date | null | undefined, now: Date = new Date()): boolean {
  return !!nextRun && nextRun.getTime() <= now.getTime();
}

const two = (n: number) => String(n).padStart(2, "0");

/** "Daily at 02:00 UTC (05:00 Africa/Cairo)" — the label every surface shows. */
export function describeSchedule(spec: ScheduleSpec): string {
  if (!spec.enabled) return "Off";
  const utc = `${two(spec.hourUtc)}:00 UTC`;
  let local = "";
  if (spec.tz) {
    try {
      const probe = new Date(Date.UTC(2026, 0, 15, spec.hourUtc, 0, 0)); // a fixed day; only the wall-clock offset matters
      const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: spec.tz, hour12: false });
      local = ` (${fmt.format(probe)} ${spec.tz})`;
    } catch { local = ""; }
  }
  if (spec.kind === "daily") return `Daily at ${utc}${local}`;
  if (spec.kind === "weekly") return `Every ${WEEKDAYS[spec.weekday] ?? "Monday"} at ${utc}${local}`;
  return `Every ${spec.intervalDays} days at ${utc}${local}`;
}

/** Convert a wall-clock hour in `tz` to the UTC hour (today's offset). */
export function localHourToUtc(hourLocal: number, tz: string): number {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false, timeZoneName: "shortOffset" }).formatToParts(now);
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(off);
    const sign = m?.[1] === "-" ? -1 : 1;
    const oh = m ? Number(m[2]) + Number(m[3] ?? 0) / 60 : 0;
    return ((Math.round(hourLocal - sign * oh) % 24) + 24) % 24;
  } catch {
    return hourLocal;
  }
}

/** Convert a UTC hour to the wall-clock hour in `tz` (today's offset). */
export function utcHourToLocal(hourUtc: number, tz: string): number {
  const back = localHourToUtc(0, tz);          // UTC hour that is local midnight
  return ((hourUtc - back) % 24 + 24) % 24;
}

/** Parse the stored row into a spec (tolerant of nulls from older rows). */
export function specFromRow(r: {
  schedule_enabled?: boolean | null; schedule_kind?: string | null; schedule_hour_utc?: number | null;
  schedule_interval_days?: number | null; schedule_weekday?: number | null; schedule_tz?: string | null;
} | null | undefined): ScheduleSpec {
  if (!r) return DEFAULT_SCHEDULE;
  const kind = (["daily", "every_n_days", "weekly"] as const).includes(r.schedule_kind as ScheduleKind) ? (r.schedule_kind as ScheduleKind) : "daily";
  return {
    enabled: !!r.schedule_enabled,
    kind,
    hourUtc: Number.isFinite(Number(r.schedule_hour_utc)) ? Number(r.schedule_hour_utc) : 2,
    intervalDays: Number.isFinite(Number(r.schedule_interval_days)) ? Number(r.schedule_interval_days) : 2,
    weekday: Number.isFinite(Number(r.schedule_weekday)) ? Number(r.schedule_weekday) : 1,
    tz: r.schedule_tz ?? null,
  };
}
