// Nightly schedule, digest slots and run-comparison helpers (workstream G,
// 19 Sep 2026; rewritten 20 Sep). Pure, client-safe.
//
// A nightly run belongs to a SLOT: the instant "today at HH:MM UTC". The
// scheduler (an hourly cron) asks for the most recent slot at or before now
// and creates the run for it unless one exists — dq_runs.schedule_key
// ("nightly/<UTC date>") is unique, so two invocations cannot both create it.
// A slot the cron missed (an outage, a deploy) is still created by the next
// invocation as long as it is the most recent slot: one catch-up, never a
// backfill of older nights.

const HHMM = /^(\d{2}):(\d{2})$/;

export function parseHHMM(s: string | null | undefined): { h: number; m: number } | null {
  const m = HHMM.exec(s ?? "");
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The due instant of the slot on the UTC day of `day`. */
export function slotDue(nightlyTime: string, day: Date): Date | null {
  const t = parseHHMM(nightlyTime);
  if (!t) return null;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t.h, t.m, 0, 0));
}

export function scheduleKey(due: Date): string { return `nightly/${dayKey(due)}`; }

/** The most recent slot at or before now — today's when it has passed, otherwise yesterday's. */
export function nightlySlot(nightlyTime: string, now: Date): { key: string; due: Date } | null {
  const today = slotDue(nightlyTime, now);
  if (!today) return null;
  const due = today.getTime() <= now.getTime() ? today : new Date(today.getTime() - 86_400_000);
  return { key: scheduleKey(due), due };
}

/** The first slot strictly after now. */
export function nextNightlyAt(nightlyTime: string, now: Date): Date | null {
  const today = slotDue(nightlyTime, now);
  if (!today) return null;
  return today.getTime() > now.getTime() ? today : new Date(today.getTime() + 86_400_000);
}

/** An hourly cron should have created the slot's run within this long of its due time. */
export const SLOT_GRACE_MS = 65 * 60_000;

export interface ScheduleVerdict {
  /** the slot the cron is responsible for right now */
  slot_key: string | null;
  slot_due: string | null;
  next_at: string | null;
  /** the slot passed more than the grace ago and no run carries its key */
  missed: boolean;
  /** the slot's run was created more than the grace after its due time (a catch-up) */
  catch_up: boolean;
}

export function scheduleVerdict(input: { enabled: boolean; nightlyTime: string; now: Date; slotRunCreatedAt: string | null }): ScheduleVerdict {
  const slot = nightlySlot(input.nightlyTime, input.now);
  const next = nextNightlyAt(input.nightlyTime, input.now);
  if (!slot || !next) return { slot_key: null, slot_due: null, next_at: null, missed: false, catch_up: false };
  const late = input.now.getTime() - slot.due.getTime() > SLOT_GRACE_MS;
  const created = input.slotRunCreatedAt ? new Date(input.slotRunCreatedAt).getTime() : null;
  return {
    slot_key: slot.key, slot_due: slot.due.toISOString(), next_at: input.enabled ? next.toISOString() : null,
    missed: input.enabled && created == null && late,
    catch_up: created != null && created - slot.due.getTime() > SLOT_GRACE_MS,
  };
}

/** Monday 07:00 UTC, once a week; a slot older than a day is not sent late. */
export function digestSlot(now: Date): { key: string; due: Date } | null {
  const day = now.getUTCDay(); // 0 Sunday … 1 Monday
  const back = (day + 6) % 7;  // days since Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back, 7, 0, 0, 0));
  const due = monday.getTime() <= now.getTime() ? monday : new Date(monday.getTime() - 7 * 86_400_000);
  if (now.getTime() - due.getTime() > 86_400_000) return null;
  return { key: `digest/${dayKey(due)}`, due };
}

/** Two runs compare only when they covered the same tables and filter. */
export function sameScope(a: { kind?: string; tables?: string[] | null; filter?: string | null } | null | undefined, b: { kind?: string; tables?: string[] | null; filter?: string | null } | null | undefined): boolean {
  if (!a || !b) return false;
  const key = (s: NonNullable<typeof a>) => `${s.kind ?? "db"}|${[...(s.tables ?? [])].sort().join(",")}|${s.filter ?? ""}`;
  return key(a) === key(b);
}
