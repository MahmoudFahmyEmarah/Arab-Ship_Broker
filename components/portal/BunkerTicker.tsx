"use client";

// Bunker price ticker, ported from the Claude design (asb/bunker-ticker.jsx).
// Still DEMO data (anonymized Company X/Y/Z…) with a pinned "DEMO · Sample data"
// disclaimer + a "join the ticker" CTA — per the handoff. When the bunker_prices
// / bunker_suppliers tables are seeded (see migration …000820 + the ingestion
// API), swap SPONSORS for the live feed and drop the DEMO label in one place.
import * as React from "react";

type Dir = "up" | "down" | "flat";
interface Price {
  fuel: string;
  value: number;
  dir?: Dir;
}
interface Sponsor {
  name: string;
  url: string;
  port: string;
  ageDays: number;
  prices: Price[];
}

// Anonymized demo rows. Values track a Platts-style VLSFO ~$1183–1205/MT close,
// MGO ~$1550, IFO 380 ~$700, with mixed up/down directions. The first CURRENT
// sponsor's VLSFO/LSMGO feed the Voyage Estimator defaults (~$1183 / $1118).
const SPONSORS: Sponsor[] = [
  { name: "Company X", url: "https://example.com/company-x", port: "Sohar / Salalah", ageDays: 1, prices: [
    { fuel: "VLSFO", value: 1183, dir: "down" }, { fuel: "LSMGO", value: 1118, dir: "down" }, { fuel: "MGO", value: 1548, dir: "up" },
  ] },
  { name: "Company Y", url: "https://example.com/company-y", port: "Fujairah", ageDays: 2, prices: [
    { fuel: "VLSFO", value: 1201, dir: "up" }, { fuel: "LSMGO", value: 1126, dir: "up" }, { fuel: "IFO 380", value: 702, dir: "down" },
  ] },
  { name: "Company Z", url: "https://example.com/company-z", port: "Jeddah / Yanbu", ageDays: 5, prices: [
    { fuel: "VLSFO", value: 1192, dir: "up" }, { fuel: "LSMGO", value: 1121, dir: "flat" }, { fuel: "MGO", value: 1552, dir: "down" },
  ] },
  { name: "Company W", url: "https://example.com/company-w", port: "Khor Fakkan", ageDays: 10, prices: [
    { fuel: "VLSFO", value: 1188 }, { fuel: "LSMGO", value: 1120 }, { fuel: "MGO", value: 1545 },
  ] },
  { name: "Company V", url: "https://example.com/company-v", port: "Beirut / Lattakia", ageDays: 18, prices: [
    { fuel: "VLSFO", value: 1205 }, { fuel: "LSMGO", value: 1130 },
  ] },
];

const CONTACT_HREF = "/contact";

type Fresh = "current" | "stale" | "expired" | "hidden";
function freshness(days: number): Fresh {
  if (days <= 7) return "current";
  if (days <= 14) return "stale";
  if (days <= 21) return "expired";
  return "hidden";
}
const ORDER: Record<Exclude<Fresh, "hidden">, number> = { current: 0, stale: 1, expired: 2 };

function BTDir({ dir, state }: { dir?: Dir; state: Fresh }) {
  if (state === "stale") return <span className="bt-dir is-flat">—</span>;
  if (state === "expired") return null;
  const glyph = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  return <span className={`bt-dir is-${dir}`}>{glyph}</span>;
}

function BTSegment({ s }: { s: Sponsor & { _state: Fresh } }) {
  const state = s._state;
  return (
    <span className={`bt-seg is-${state}`}>
      {state === "expired" && <span className="bt-outdated">Outdated</span>}
      <a className="bt-sponsor" href={s.url} onClick={(e) => e.stopPropagation()}>
        {s.name}
        <span className="bt-sponsor__ext" aria-hidden>↗</span>
      </a>
      {state === "stale" && (
        <>
          <span className="bt-mid-dot">·</span>
          <span className="bt-age">{s.ageDays}d</span>
        </>
      )}
      <span className="bt-mid-dot">·</span>
      <span className="bt-port">{s.port}</span>
      {s.prices.map((p, i) => (
        <React.Fragment key={i}>
          <span className="bt-fuel">{p.fuel}</span>
          <span className="bt-price">${p.value}/MT</span>
          <BTDir dir={p.dir} state={state} />
        </React.Fragment>
      ))}
      <span className="bt-seg__sep" aria-hidden />
    </span>
  );
}

// "Join the ticker" CTA — rotates through the marquee once per track copy.
function BTCallout() {
  return (
    <span className="bt-seg bt-seg--cta">
      <span className="bt-cta__badge">JOIN</span>
      <span className="bt-cta__txt">Are you a bunker supplier? List your daily prices here</span>
      <a className="bt-cta__link" href={CONTACT_HREF} onClick={(e) => e.stopPropagation()}>
        Contact us to join <span className="bt-cta__arrow" aria-hidden>→</span>
      </a>
      <span className="bt-seg__sep" aria-hidden />
    </span>
  );
}

export function BunkerTicker() {
  const sponsors = React.useMemo(
    () =>
      SPONSORS.map((s) => ({ ...s, _state: freshness(s.ageDays) }))
        .filter((s) => s._state !== "hidden")
        .sort(
          (a, b) =>
            ORDER[a._state as Exclude<Fresh, "hidden">] -
              ORDER[b._state as Exclude<Fresh, "hidden">] || a.ageDays - b.ageDays,
        ),
    [],
  );
  const trackRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const half = el.scrollWidth / 2;
    const duration = Math.max(20, half / 60);
    el.style.setProperty("--bt-duration", duration.toFixed(1) + "s");
  }, [sponsors]);

  // One marquee copy = all sponsor segments + the CTA (so the CTA appears once
  // per loop). The track duplicates the copy for a seamless scroll.
  const copy = (prefix: string) => (
    <>
      {sponsors.map((s, i) => (
        <BTSegment key={`${prefix}-${i}`} s={s} />
      ))}
      <BTCallout key={`${prefix}-cta`} />
    </>
  );

  return (
    <div className="bunker-ticker" role="region" aria-label="Bunker prices ticker (demo)">
      <div
        className="bt-demo"
        title="Demonstration only — these are placeholder prices, not live market data."
      >
        <span className="bt-demo__tag">DEMO</span>
        <span className="bt-demo__txt">Sample data</span>
      </div>
      <div className="bt-track-wrap">
        <div className="bt-track" ref={trackRef}>
          {copy("a")}
          {copy("b")}
        </div>
      </div>
      <div className="bt-updated" title="Demo feed · placeholder timestamp">
        <span className="bt-updated__pulse" aria-hidden />
        Updated 06:00 UTC
      </div>
    </div>
  );
}
