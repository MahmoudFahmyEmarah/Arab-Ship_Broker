"use client";

// Market pulse — how the market is doing: cargo vs open tonnage tiles, posted
// per bucket (area chart with hover), origin mix, zone heat, laycan horizon,
// size bands, top commodities and route exposure. All figures come from
// get_admin_dashboard(); nothing is estimated.
import * as React from "react";
import Link from "next/link";
import type { DashboardFeed, RangeKey } from "@/lib/admin/dashboard/types";
import { RANGE_LABEL, ageOf, fmtBucket, fmtInt, pct, zoneColor } from "@/lib/admin/dashboard/model";
import { Box, Fresh, Mix, Panel, Tile } from "./ui";

const W = 600, H = 150;

export function MarketPulse({ feed, range, now, stale, freshText }: { feed: DashboardFeed; range: RangeKey; now: Date; stale: boolean; freshText: string }) {
  const m = feed.market;
  const series = feed.series;
  const cargoS = series.map((p) => p.cargo);
  const vesselS = series.map((p) => p.vessels);
  const n = series.length;
  const [hover, setHover] = React.useState(-1);

  // chart geometry — one scale for both series (vessels are far fewer, so the
  // legend states the raw counts rather than a hidden multiplier)
  const maxV = Math.max(1, ...cargoS, ...vesselS);
  const px = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const py = (v: number) => H - 4 - (v / maxV) * (H - 12);
  const line = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const lineCargo = n ? line(cargoS) : "";
  const lineVessel = n ? line(vesselS) : "";
  const areaCargo = n ? `${lineCargo} L${W} ${H} L0 ${H} Z` : "";
  const hoverOn = hover >= 0 && hover < n;
  const colW = n > 1 ? W / (n - 1) : W;

  const noMatch = Math.max(0, m.cargo_live - feed.matches.cargo_matched);
  const bars = series.slice(-14);
  const barMax = Math.max(1, ...bars.map((b) => b.cargo + b.vessels));
  const originTotal = m.cargo_batch_in_range + m.cargo_member_in_range;
  const zoneMax = Math.max(1, ...m.zones.map((z) => z.n));
  const bands = m.bands;
  const bandTotal = bands.handy + bands.supra + bands.ultra + bands.pmax + bands.cape;
  const r = m.routes;

  return (
    <Panel
      label="Market pulse"
      title="Market pulse"
      info="Live cargo against open tonnage, matches and exposure for the selected range."
      sub={`How is the market doing? Live listings vs. open tonnage, last ${RANGE_LABEL[range]}.`}
      stale={stale}
      right={<>
        <Fresh text={`get_admin_dashboard · ${freshText}`} level={stale ? "warn" : "ok"} />
        <Link href="/admin/stats" className="adb-link">Analytics →</Link>
      </>}
    >
      <div className="adb-cols4 adb-mb">
        <Tile label="Live cargo" value={fmtInt(m.cargo_live)} spark={cargoS} href="/admin/cargo"
          delta={`+${fmtInt(m.cargo_in_range)} posted`} deltaLevel="ok" sub={`of ${fmtInt(m.cargo_total)} total`} />
        <Tile label="Open vessels" value={fmtInt(m.vessel_open)} spark={vesselS} href="/admin/vessel-availability"
          delta={`+${fmtInt(m.vessel_in_range)} posted`} deltaLevel="ok" sub={`${fmtInt(feed.ingest.blank_positions)} blank positions`} />
        <Tile label="Matches" value={fmtInt(feed.matches.n)} href="/admin/stats"
          delta={`${fmtInt(feed.matches.cargo_matched)} cargoes matched`} sub={`cache ${ageOf(feed.matches.computed_at, now)} old`} />
        <Tile label="No match" value={fmtInt(noMatch)} href="/admin/cargo"
          delta={`${pct(noMatch, m.cargo_live)}% of live`} deltaLevel={pct(noMatch, m.cargo_live) > 50 ? "warn" : "ok"} sub="live cargo without a vessel" />
      </div>

      <div className="adb-cols3 adb-chart-row">
        <Box className="adb-chart-box">
          <div className="adb-legend">
            <span className="adb-box__title">Posted per {feed.hourly ? "hour" : "day"} · cargo vs vessels</span>
            <span className="adb-spacer" />
            <span className="adb-legend__item"><i className="adb-legend__swatch is-cargo" />Cargo</span>
            <span className="adb-legend__item"><i className="adb-legend__swatch is-vessel" />Vessels</span>
          </div>
          {n === 0 ? (
            <div className="adb-empty">No listings in this range.</div>
          ) : (
            <div className="adb-chart">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="adb-chart__svg" aria-label="Cargo and vessels posted per bucket">
                <g className="adb-chart__grid">
                  {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={0} y1={(H - 1) * f} x2={W} y2={(H - 1) * f} />)}
                </g>
                <path d={areaCargo} className="adb-chart__area" />
                <path d={lineCargo} className="adb-chart__line is-cargo" vectorEffect="non-scaling-stroke" />
                <path d={lineVessel} className="adb-chart__line is-vessel" vectorEffect="non-scaling-stroke" />
                {series.map((_, i) => (
                  <rect key={i} x={px(i) - colW / 2} y={0} width={colW} height={H} fill="transparent"
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} />
                ))}
                {hoverOn && <line x1={px(hover)} y1={0} x2={px(hover)} y2={H} className="adb-chart__cursor" vectorEffect="non-scaling-stroke" />}
              </svg>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="adb-chart__overlay" aria-hidden>
                <circle cx={px(n - 1)} cy={py(cargoS[n - 1])} r={4} className="adb-chart__end is-cargo" />
                <circle cx={px(n - 1)} cy={py(vesselS[n - 1])} r={4} className="adb-chart__end is-vessel" />
              </svg>
              {hoverOn && (
                <div className="adb-tip" style={{ left: `${(n > 1 ? hover / (n - 1) : 0.5) * 100}%` }}>
                  <b>{fmtBucket(series[hover].t, feed.hourly)}</b><br />
                  Cargo {fmtInt(series[hover].cargo)} · Vessels {fmtInt(series[hover].vessels)}
                </div>
              )}
            </div>
          )}
          {n > 0 && (
            <div className="adb-axis">
              <span>{fmtBucket(series[0].t, feed.hourly)}</span>
              <span>{fmtBucket(series[Math.floor((n - 1) / 2)].t, feed.hourly)}</span>
              <span>{feed.hourly ? "now" : "today"}</span>
            </div>
          )}
        </Box>

        <Box title="Posted · origin" className="adb-origin">
          <div className="adb-bars">
            {bars.map((b) => (
              <div key={b.t} className="adb-bars__col" title={`${fmtBucket(b.t, feed.hourly)} · ${b.cargo} cargo · ${b.vessels} vessels`}>
                <div className="adb-bars__seg is-vessel" style={{ height: `${(b.vessels / barMax) * 100}%` }} />
                <div className="adb-bars__seg is-cargo" style={{ height: `${(b.cargo / barMax) * 100}%`, borderRadius: b.vessels ? 0 : undefined }} />
              </div>
            ))}
          </div>
          <div className="adb-legend adb-legend--small">
            <span className="adb-legend__item"><i className="adb-legend__swatch is-cargo" />Cargo</span>
            <span className="adb-legend__item"><i className="adb-legend__swatch is-vessel" />Vessels</span>
          </div>
          <Mix parts={[
            { pct: pct(m.cargo_batch_in_range, originTotal), className: "is-navy", title: `Circulars (email / WhatsApp) ${pct(m.cargo_batch_in_range, originTotal)}%` },
            { pct: pct(m.cargo_member_in_range, originTotal), className: "is-baby", title: `Members ${pct(m.cargo_member_in_range, originTotal)}%` },
          ]} />
          <div className="adb-split-labels">
            <span>Circulars <b>{originTotal ? `${pct(m.cargo_batch_in_range, originTotal)}%` : "—"}</b></span>
            <span>Members <b>{originTotal ? `${pct(m.cargo_member_in_range, originTotal)}%` : "—"}</b></span>
            <span>WhatsApp <b>{fmtInt(m.whatsapp_in_range)}</b> msgs</span>
          </div>
        </Box>
      </div>

      <div className="adb-cols3 adb-mt">
        <Box title="Zone heat · live cargo (load)">
          <div className="adb-zones">
            {m.zones.length === 0 && <div className="adb-empty">No zoned cargo.</div>}
            {m.zones.map((z) => (
              <Link key={z.zone} href={`/admin/cargo?zone=${encodeURIComponent(z.zone)}`} className="adb-zone">
                <span className="adb-zone__name">{z.zone}</span>
                <span className="adb-zone__rail"><span className="adb-zone__fill" style={{ width: `${(z.n / zoneMax) * 100}%`, background: zoneColor(z.zone) }} /></span>
                <span className="adb-zone__n">{fmtInt(z.n)}</span>
              </Link>
            ))}
          </div>
        </Box>

        <Box className="adb-stack">
          <div>
            <div className="adb-box__title adb-mb-s">Laycan horizon · live cargo</div>
            <div className="adb-kpis">
              <div className="adb-kpi"><div className="adb-kpi__n">{fmtInt(m.laycan.week)}</div><div className="adb-kpi__l">this week</div></div>
              <div className="adb-kpi"><div className="adb-kpi__n">{fmtInt(m.laycan.next)}</div><div className="adb-kpi__l">next week</div></div>
              <div className="adb-kpi"><div className="adb-kpi__n">{fmtInt(m.laycan.later)}</div><div className="adb-kpi__l">later</div></div>
            </div>
            <div className="adb-note">{fmtInt(m.laycan.past)} with a laycan already passed · {fmtInt(m.laycan.none)} without a laycan</div>
          </div>
          <div>
            <div className="adb-box__title adb-mb-s">Size bands · open tonnage</div>
            <Mix height={10} parts={[
              { pct: pct(bands.handy, bandTotal), className: "is-navy", title: `Handysize ${bands.handy}` },
              { pct: pct(bands.supra, bandTotal), className: "is-blue", title: `Supramax ${bands.supra}` },
              { pct: pct(bands.ultra, bandTotal), className: "is-steel", title: `Ultramax ${bands.ultra}` },
              { pct: pct(bands.pmax + bands.cape, bandTotal), className: "is-baby", title: `Panamax+ ${bands.pmax + bands.cape}` },
            ]} />
            <div className="adb-split-labels adb-split-labels--tiny">
              <span>Handy {bands.handy}</span><span>Supra {bands.supra}</span><span>Ultra {bands.ultra}</span><span>Pmax+ {bands.pmax + bands.cape}</span>
            </div>
            {bands.unknown > 0 && <div className="adb-note">{fmtInt(bands.unknown)} open positions without a DWT on the register</div>}
          </div>
        </Box>

        <Box className="adb-stack">
          <div>
            <div className="adb-box__title adb-mb-s">Top commodities · live cargo</div>
            <div className="adb-kv-list">
              {m.commodities.map((c) => (
                <div key={c.name} className="adb-kv"><span>{c.name}</span><b>{fmtInt(c.n)}</b></div>
              ))}
              {m.commodities.length === 0 && <div className="adb-empty">—</div>}
            </div>
          </div>
          <div>
            <div className="adb-box__title adb-mb-s">Route exposure · live lanes</div>
            <div className="adb-expo">
              <div className="adb-expo__cell is-warn"><div className="adb-expo__n">{r.routes ? `${pct(r.suez, r.routes)}%` : "—"}</div><div className="adb-expo__l">lanes via Suez</div></div>
              <div className="adb-expo__cell is-crit"><div className="adb-expo__n">{r.routes ? `${pct(r.risk, r.routes)}%` : "—"}</div><div className="adb-expo__l">via Bab el-Mandeb / Hormuz</div></div>
            </div>
            <div className="adb-note">{fmtInt(r.routes)} port pairs with a measured route · {fmtInt(r.risk_areas)} active risk areas</div>
          </div>
        </Box>
      </div>
    </Panel>
  );
}
