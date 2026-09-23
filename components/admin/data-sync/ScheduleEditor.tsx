"use client";

// Connections → Circulation inbox → Schedule. Daily / every N days / weekly,
// at an hour the owner picks in their own time zone; stored as a UTC hour
// with the zone kept for display. The preview line is the same computation
// the cron uses (lib/sync/email/schedule.ts), so what you see is what runs.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check } from "lucide-react";
import { setEmailSchedule } from "@/app/(admin)/admin/data-sync/settings-actions";
import {
  describeSchedule, localHourToUtc, nextRunAt, utcHourToLocal, WEEKDAYS,
  type ScheduleKind, type ScheduleSpec,
} from "@/lib/sync/email/schedule";
import { Btn, Seg, Switch, relTime, C } from "./ui";

const two = (n: number) => String(n).padStart(2, "0");

export function ScheduleEditor({ initial, connectionEnabled, onSaved }: {
  initial: ScheduleSpec;
  connectionEnabled: boolean;
  onSaved: (spec: ScheduleSpec, nextRunAt: string | null) => void;
}) {
  const [tz, setTz] = useState<string>(initial.tz ?? "UTC");
  const [spec, setSpec] = useState<ScheduleSpec>(initial);
  const [hourLocal, setHourLocal] = useState<number>(initial.tz ? utcHourToLocal(initial.hourUtc, initial.tz) : initial.hourUtc);
  const [busy, setBusy] = useState(false);

  // The browser's zone is the owner's zone unless the stored spec already
  // carries one; read it after mount so server and first client render agree.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled || initial.tz) return;
      try {
        const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (z) { setTz(z); setHourLocal(utcHourToLocal(initial.hourUtc, z)); }
      } catch { /* keep UTC */ }
    })();
    return () => { cancelled = true; };
  }, [initial.tz, initial.hourUtc]);

  const live = useMemo<ScheduleSpec>(() => ({ ...spec, hourUtc: localHourToUtc(hourLocal, tz), tz }), [spec, hourLocal, tz]);
  const preview = useMemo(() => nextRunAt(live), [live]);
  const dirty = JSON.stringify(live) !== JSON.stringify(initial);

  const save = async () => {
    setBusy(true);
    const r = await setEmailSchedule(live);
    setBusy(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(live.enabled ? `Schedule saved — next run ${r.data.nextRunAt ? relTime(r.data.nextRunAt) : "pending"}.` : "Schedule switched off.");
    onSaved(live, r.data.nextRunAt);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="ds-row">
        <Switch
          checked={spec.enabled} disabled={!connectionEnabled || busy}
          onChange={(v) => setSpec((s) => ({ ...s, enabled: v }))}
          label="Run automatically"
        />
        <span className="ds-note">
          {!connectionEnabled ? "Enable the connection first." : spec.enabled ? "The cron wakes hourly and runs when the next slot has passed; every run is logged to job_runs and the audit trail." : "Off — the inbox only syncs when you press Sync now."}
        </span>
      </div>

      {spec.enabled && (
        <>
          <div className="ds-row">
            <Seg<ScheduleKind>
              value={spec.kind} onChange={(k) => setSpec((s) => ({ ...s, kind: k }))}
              options={[{ value: "daily", label: "Every day" }, { value: "every_n_days", label: "Every N days" }, { value: "weekly", label: "Every week" }] as const}
            />
            {spec.kind === "every_n_days" && (
              <label className="ds-row" style={{ gap: 6, fontSize: 13, color: C.ink2 }}>
                every
                <input className="ds-input" type="number" min={2} max={30} style={{ width: 64 }} value={spec.intervalDays}
                  onChange={(e) => setSpec((s) => ({ ...s, intervalDays: Math.min(30, Math.max(2, Number(e.target.value) || 2)) }))} />
                days
              </label>
            )}
            {spec.kind === "weekly" && (
              <select className="ds-input" style={{ width: "auto" }} value={spec.weekday}
                onChange={(e) => setSpec((s) => ({ ...s, weekday: Number(e.target.value) }))} aria-label="Weekday">
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            )}
            <label className="ds-row" style={{ gap: 6, fontSize: 13, color: C.ink2 }}>
              at
              <select className="ds-input" style={{ width: "auto" }} value={hourLocal} onChange={(e) => setHourLocal(Number(e.target.value))} aria-label="Hour">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{two(h)}:00</option>)}
              </select>
              <span className="ds-note">{tz} · {two(live.hourUtc)}:00 UTC</span>
            </label>
          </div>
          <div className="ds-row" style={{ fontSize: 13, color: C.ink }}>
            <CalendarClock size={15} color={C.brass} />
            <span><strong>{describeSchedule(live)}</strong>{preview ? ` — next run ${relTime(preview.toISOString())} (${preview.toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}</span>
          </div>
        </>
      )}

      <div>
        <Btn size="sm" kind="primary" icon={<Check size={14} />} busy={busy} disabled={!dirty && initial.enabled === spec.enabled} onClick={save}>
          Save schedule
        </Btn>
      </div>
    </div>
  );
}
