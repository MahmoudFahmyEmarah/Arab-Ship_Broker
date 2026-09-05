"use client";

// Users & behaviour — sign-ups, active members (auth last sign-in), sessions
// and feature usage from platform_events, the company module, an engagement
// funnel, tier/trust mix, top members and devices. Rows are honest about
// their source: the events feed starts collecting from the day it shipped.
import * as React from "react";
import Link from "next/link";
import type { DashboardFeed, RangeKey } from "@/lib/admin/dashboard/types";
import { RANGE_LABEL, fmtDay, fmtInt, pct } from "@/lib/admin/dashboard/model";
import { Box, Fresh, Mix, Panel, SourcePill, Tile } from "./ui";

export function UsersPanel({ feed, range, stale, freshText }: { feed: DashboardFeed; range: RangeKey; stale: boolean; freshText: string }) {
  const u = feed.users;
  const ev = feed.events ?? null;
  const by = ev?.by_event ?? {};
  const n = (k: string) => by[k] ?? 0;
  const signupS = feed.series.map((p) => p.signups);
  const funnel = [
    { label: "Members", n: u.total },
    { label: "Signed in", n: u.active_range },
    { label: "Viewed", n: ev ? ev.range.viewers : null },
    { label: "Posted", n: u.posters_range },
    { label: "Estimated", n: ev ? n("voyage_estimate") : u.estimates_range },
  ];
  const fMax = Math.max(1, ...funnel.map((f) => f.n ?? 0));
  const tiers = Object.entries(u.tiers).sort(([a], [b]) => a.localeCompare(b));
  const features: { label: string; n: number | null }[] = [
    { label: "Routes drawn", n: ev ? n("route_drawn") : null },
    { label: "Estimates shown / declined", n: null },
    { label: "Match popups opened", n: ev ? n("match_popup") : null },
    { label: "Voyage estimator", n: ev ? n("voyage_estimate") : null },
    { label: "Suez calculator", n: ev ? n("suez_calc") : null },
    { label: "Page views", n: ev ? ev.range.page_views : null },
  ];
  const devices = ev?.devices ?? {};
  const devTotal = Object.values(devices).reduce((s, x) => s + x, 0);
  const eventsSince = ev?.first_event_at ? `collecting since ${fmtDay(ev.first_event_at)}` : "no events recorded yet";

  return (
    <Panel
      label="Users and behaviour"
      title="Users & behaviour"
      sub={`How are members behaving? Sign-ins, funnel and feature use, last ${RANGE_LABEL[range]}.`}
      stale={stale}
      right={<>
        <SourcePill text={ev ? "platform_events · live" : "platform_events · unavailable"} title={`Behaviour widgets read public.platform_events (member consent required) — ${eventsSince}. Sign-in figures come from auth.users.`} />
        <Fresh text={freshText} level={stale ? "warn" : "ok"} />
        <Link href="/admin/users" className="adb-link">All users →</Link>
      </>}
    >
      <div className="adb-cols5 adb-mb">
        <Tile label="Sign-ups" value={fmtInt(u.signups_range)} spark={signupS} href="/admin/users" sub={`${fmtInt(u.total)} members · ${fmtInt(u.auth_total)} auth accounts`} />
        <Tile label="Active daily" value={fmtInt(u.active_d1)} href="/admin/users" sub={`of ${fmtInt(u.total)} · signed in today`} />
        <Tile label="Active weekly" value={fmtInt(u.active_d7)} href="/admin/users" sub={`${pct(u.active_d7, u.total)}% of members`} />
        <Tile label="Companies" value={fmtInt(u.companies)} href="/admin/org-members" sub={`${fmtInt(u.seats)} seat${u.seats === 1 ? "" : "s"} assigned · module is young`} />
        <Tile label="Sessions" value={ev ? fmtInt(ev.range.sessions) : "—"} href="/admin/stats"
          sub={ev ? `${fmtInt(ev.range.page_views)} page views · ${fmtInt(ev.range.active_users)} members` : "events feed unavailable"} />
      </div>

      <div className="adb-cols3">
        <Box title={`Engagement funnel · ${RANGE_LABEL[range]}`}>
          <div className="adb-funnel">
            {funnel.map((f) => (
              <div key={f.label} className="adb-funnel__row">
                <span>{f.label}</span>
                <span className="adb-funnel__rail"><span className="adb-funnel__fill" style={{ width: `${((f.n ?? 0) / fMax) * 100}%` }} /></span>
                <b>{f.n == null ? "—" : fmtInt(f.n)}</b>
              </div>
            ))}
          </div>
          <div className="adb-note">
            Trust: NEW <b>{fmtInt(u.new_tier)}</b> · VERIFIED <b className="is-ok">{fmtInt(u.verified_tier)}</b> · FLAGGED <b className={u.flagged_tier ? "is-crit" : ""}>{fmtInt(u.flagged_tier)}</b>
          </div>
        </Box>

        <Box title="Feature usage" right={<SourcePill text="platform_events" title={eventsSince} />}>
          <div className="adb-kv-list">
            {features.map((f) => (
              <div key={f.label} className={`adb-kv${f.n == null ? " is-muted" : ""}`}>
                <span>{f.label}</span>
                <b>{f.label.startsWith("Estimates") && ev ? `${fmtInt(n("estimate_shown"))} / ${fmtInt(n("estimate_declined"))}` : f.n == null ? "—" : fmtInt(f.n)}</b>
              </div>
            ))}
          </div>
          <div className="adb-note">{ev ? `${fmtInt(ev.events_total)} events in total · ${eventsSince}` : "Events are recorded only for members who accepted functional storage."}</div>
        </Box>

        <Box className="adb-stack">
          <div>
            <div className="adb-box__title adb-mb-s">Subscription tiers</div>
            <Mix height={8} parts={tiers.map(([k, x], i) => ({ pct: pct(x, u.total), className: ["is-navy", "is-blue", "is-steel", "is-baby"][i % 4], title: `${k} ${x}` }))} />
            <div className="adb-split-labels">
              {tiers.map(([k, x]) => <span key={k}>{k} <b>{fmtInt(x)}</b></span>)}
            </div>
          </div>
          <div>
            <div className="adb-box__title adb-mb-s">Top members · events by device</div>
            <div className="adb-kv-list">
              {(ev?.top_members ?? []).map((m) => (
                <div key={m.name} className="adb-kv"><span className="adb-ellipsis">{m.company ? `${m.company} · ${m.name}` : m.name}</span><b>{fmtInt(m.n)}</b></div>
              ))}
              {(!ev || ev.top_members.length === 0) && <div className="adb-kv is-muted"><span>No member events in this range</span><b>—</b></div>}
            </div>
            <Mix height={6} parts={[
              { pct: pct(devices.desktop ?? 0, devTotal), className: "is-navy", title: `Desktop ${devices.desktop ?? 0}` },
              { pct: pct(devices.phone ?? 0, devTotal), className: "is-baby", title: `Phone ${devices.phone ?? 0}` },
              { pct: pct(devices.tablet ?? 0, devTotal), className: "is-steel", title: `Tablet ${devices.tablet ?? 0}` },
            ]} />
            <div className="adb-split-labels adb-split-labels--tiny">
              <span>Desktop {devTotal ? `${pct(devices.desktop ?? 0, devTotal)}%` : "—"}</span>
              <span>Phone {devTotal ? `${pct(devices.phone ?? 0, devTotal)}%` : "—"}</span>
              <span>Tablet {devTotal ? `${pct(devices.tablet ?? 0, devTotal)}%` : "—"}</span>
            </div>
          </div>
        </Box>
      </div>
    </Panel>
  );
}
