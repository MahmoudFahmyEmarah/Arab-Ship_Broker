"use client";

// Growth & outreach — Group Mail campaigns, Market Insights editions and the
// subscriber gap, contact messages, and the public site (needs Vercel Web
// Analytics, shown as not connected until a token is configured).
import * as React from "react";
import type { DashboardFeed, RangeKey, VercelSnapshot } from "@/lib/admin/dashboard/types";
import { RANGE_LABEL, ageOf, fmtInt, pct } from "@/lib/admin/dashboard/model";
import { Fresh, Panel, Tile } from "./ui";

export function GrowthPanel({ feed, range, now, stale, vercel }: { feed: DashboardFeed; range: RangeKey; now: Date; stale: boolean; vercel: VercelSnapshot | null }) {
  const gm = feed.groupmail, ins = feed.insights, t = feed.tasks;
  return (
    <Panel
      label="Growth and outreach"
      title="Growth & outreach"
      sub="Campaigns, editions, inbound messages and public-site traffic."
      stale={stale}
      right={<Fresh text={vercel ? "Vercel connected · analytics not wired" : "Vercel Web Analytics · not connected"} level={vercel ? "ok" : "info"} />}
    >
      <div className="adb-cols4">
        <Tile label="Group Mail" href="/admin/group-mail"
          value={<>{fmtInt(gm.campaigns)} <small>campaigns</small></>}
          sub={`${fmtInt(gm.sent_ok)} of ${fmtInt(gm.recipients)} delivered · ${fmtInt(gm.sent_fail)} failed · ${fmtInt(gm.in_range)} in ${RANGE_LABEL[range]}`} />
        <Tile label="Market Insights" href="/insights" tone={ins.subscribers === 0 ? "amber" : undefined}
          value={<>{fmtInt(ins.editions)} <small>editions · {ins.last_week ?? "—"}</small></>}
          delta={ins.subscribers === 0 ? "0 subscribers — gap" : `${fmtInt(ins.subscribers)} subscribers`} deltaLevel={ins.subscribers === 0 ? "warn" : "ok"} />
        <Tile label="Contact messages" href="/admin/messages"
          value={<>{fmtInt(t.messages_unread)} <small className={t.messages_unread ? "is-warn" : ""}>unread</small></>}
          sub={t.messages_unread ? `Oldest ${ageOf(t.messages_oldest, now)}` : "Inbox is clear"} />
        <Tile label={`Public site · ${RANGE_LABEL[range]}`} href="https://vercel.com/dashboard" external
          value={<>— <small>views</small></>}
          sub={vercel ? "Web Analytics API not wired yet" : "Connect Vercel to see views, top pages and referrers"} />
      </div>
      <div className="adb-note adb-mt-s">
        Delivery rate {gm.recipients ? `${pct(gm.sent_ok, gm.recipients)}%` : "—"} · opens and bounces are not tracked by the SMTP dispatcher.
      </div>
    </Panel>
  );
}
