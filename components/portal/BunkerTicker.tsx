"use client";

// Bunker price ticker (design: asb/bunker-ticker.jsx), fed by get_bunker_ticker()
// through sdk/app/bunker.ts. Each segment is one sponsoring supplier at one
// port with its own published prices: the name is the supplier's exposure.
// Freshness is decided by the database (≤ 7 d current, 8–14 d stale with a
// flat arrow and "·Nd", 15–21 d "Outdated", older rows never arrive). There is
// no demo data: with no live sponsor the strip says so and keeps the JOIN CTA.
import * as React from "react";
import type { BunkerTicker as TickerData, BunkerTickerSponsor, PriceDirection } from "@/lib/bunker/types";

const CONTACT_HREF = "/contact";

function BTDir({ dir, state }: { dir: PriceDirection; state: BunkerTickerSponsor["freshness"] }) {
  if (state === "stale") return <span className="bt-dir is-flat">—</span>;
  if (state === "expired") return null;
  const glyph = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  return <span className={`bt-dir is-${dir}`} aria-label={dir === "flat" ? "unchanged" : dir}>{glyph}</span>;
}

function BTSegment({ s }: { s: BunkerTickerSponsor }) {
  const state = s.freshness;
  return (
    <span className={`bt-seg is-${state}`}>
      {state === "expired" && <span className="bt-outdated">Outdated</span>}
      {s.url ? (
        <a className="bt-sponsor" href={s.url} target="_blank" rel="noopener noreferrer"
           onClick={(e) => e.stopPropagation()}>
          {s.name}
          <span className="bt-sponsor__ext" aria-hidden>↗</span>
        </a>
      ) : (
        <span className="bt-sponsor">{s.name}</span>
      )}
      {state === "stale" && (
        <>
          <span className="bt-mid-dot">·</span>
          <span className="bt-age">{s.ageDays}d</span>
        </>
      )}
      <span className="bt-mid-dot">·</span>
      <span className="bt-port">{s.port}</span>
      {s.prices.map((p) => (
        <React.Fragment key={p.productKey}>
          <span className="bt-fuel">{p.label}</span>
          <span className="bt-price">${Math.round(p.usdMt).toLocaleString("en-US")}/MT</span>
          <BTDir dir={p.direction} state={state} />
        </React.Fragment>
      ))}
      <span className="bt-seg__sep" aria-hidden />
    </span>
  );
}

function BTEmpty() {
  return (
    <span className="bt-seg is-stale">
      <span className="bt-port">No current bunker offer</span>
      <span className="bt-seg__sep" aria-hidden />
    </span>
  );
}

// "Join the ticker" CTA — appears once per marquee copy.
function BTCallout() {
  return (
    <span className="bt-seg bt-seg--cta">
      <span className="bt-cta__badge">JOIN</span>
      <span className="bt-cta__txt">Are you a bunker supplier? List your prices here</span>
      <a className="bt-cta__link" href={CONTACT_HREF} onClick={(e) => e.stopPropagation()}>
        Contact us to join <span className="bt-cta__arrow" aria-hidden>→</span>
      </a>
      <span className="bt-seg__sep" aria-hidden />
    </span>
  );
}

function updatedLabel(sponsors: BunkerTickerSponsor[]): string | null {
  const latest = sponsors.map((s) => s.latestQuoteAt).sort().pop();
  if (!latest) return null;
  const d = new Date(latest);
  const hhmm = d.toISOString().slice(11, 16);
  const sameDay = d.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  return sameDay
    ? `Updated ${hhmm} UTC`
    : `Updated ${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })} ${hhmm} UTC`;
}

export function BunkerTicker() {
  const [data, setData] = React.useState<TickerData | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ getSupabaseBrowserClient }, { getBunkerTicker }] = await Promise.all([
          import("@/lib/supabase/browser"),
          import("@/sdk/app/bunker"),
        ]);
        const t = await getBunkerTicker(getSupabaseBrowserClient());
        if (!cancelled) setData(t);
      } catch {
        if (!cancelled) setData({ asOf: new Date().toISOString(), sponsors: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sponsors = React.useMemo(
    () => (data?.sponsors ?? []).filter((s) => s.prices.length > 0),
    [data],
  );
  const trackRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const half = el.scrollWidth / 2;
    el.style.setProperty("--bt-duration", Math.max(20, half / 60).toFixed(1) + "s");
  }, [sponsors, data]);

  const updated = updatedLabel(sponsors);
  const copy = (prefix: string) => (
    <>
      {data && sponsors.length === 0 && <BTEmpty key={`${prefix}-empty`} />}
      {sponsors.map((s) => (
        <BTSegment key={`${prefix}-${s.name}-${s.portLocode}`} s={s} />
      ))}
      <BTCallout key={`${prefix}-cta`} />
    </>
  );

  return (
    <div className="bunker-ticker" role="region" aria-label="Bunker prices ticker" aria-busy={data === null}>
      <div className="bt-track-wrap">
        <div className="bt-track" ref={trackRef}>
          {copy("a")}
          {copy("b")}
        </div>
      </div>
      {updated && (
        <div className="bt-updated" title="Supplier-published prices, in good faith">
          <span className="bt-updated__pulse" aria-hidden />
          {updated}
        </div>
      )}
    </div>
  );
}
