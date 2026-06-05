"use client";

// Bunker price ticker, ported from the Claude design (asb/bunker-ticker.jsx).
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

const SPONSORS: Sponsor[] = [
  { name: "O Bunkering", url: "#", port: "Sohar / Salalah", ageDays: 1, prices: [
    { fuel: "VLSFO", value: 582, dir: "up" }, { fuel: "LSMGO", value: 648, dir: "down" }, { fuel: "MGO", value: 820, dir: "flat" },
  ] },
  { name: "Gulf Marine Fuels", url: "#", port: "Fujairah", ageDays: 2, prices: [
    { fuel: "VLSFO", value: 595, dir: "up" }, { fuel: "LSMGO", value: 661, dir: "up" }, { fuel: "IFO 380", value: 445, dir: "down" },
  ] },
  { name: "Red Sea Bunkers", url: "#", port: "Jeddah / Yanbu", ageDays: 5, prices: [
    { fuel: "VLSFO", value: 588, dir: "up" }, { fuel: "LSMGO", value: 655, dir: "flat" }, { fuel: "MGO", value: 815, dir: "down" },
  ] },
  { name: "Gulf Petrochem", url: "#", port: "Khor Fakkan", ageDays: 10, prices: [
    { fuel: "VLSFO", value: 590 }, { fuel: "LSMGO", value: 658 }, { fuel: "MGO", value: 818 },
  ] },
  { name: "Levant Bunker Co.", url: "#", port: "Beirut / Lattakia", ageDays: 18, prices: [
    { fuel: "VLSFO", value: 612 }, { fuel: "LSMGO", value: 678 },
  ] },
];

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

function BTSegment({ s, last }: { s: Sponsor & { _state: Fresh }; last: boolean }) {
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
      {!last && <span className="bt-seg__sep" aria-hidden />}
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

  const list = (prefix: string) =>
    sponsors.map((s, i) => (
      <BTSegment key={`${prefix}-${i}`} s={s} last={i === sponsors.length - 1} />
    ));

  return (
    <div className="bunker-ticker" role="region" aria-label="Live bunker prices ticker">
      <div className="bt-track-wrap">
        <div className="bt-track" ref={trackRef}>
          {list("a")}
          {list("b")}
        </div>
      </div>
      <div className="bt-updated">
        <span className="bt-updated__pulse" aria-hidden />
        Updated 06:00 UTC
      </div>
    </div>
  );
}
