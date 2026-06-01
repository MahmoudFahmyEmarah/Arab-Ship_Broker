"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

// Sponsored bunker price ticker — reads public.fuel_prices (RLS: anon/auth read
// active). Pure-CSS marquee (two copies of the track loop seamlessly). No
// contact data — sponsor + port area + grade prices only.
type FuelRow = {
  id: string;
  sponsor_name: string;
  port_area: string;
  vlsfo_usd_mt: number | null;
  lsmgo_usd_mt: number | null;
  mgo_usd_mt: number | null;
  vlsfo_direction: string | null;
  lsmgo_direction: string | null;
  mgo_direction: string | null;
};

const arrow = (d: string | null) => (d === "up" ? "▲" : d === "down" ? "▼" : "—");
const dirCls = (d: string | null) => (d === "up" ? "up" : d === "down" ? "down" : "flat");

export function BunkerTicker() {
  const [rows, setRows] = useState<FuelRow[]>([]);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    sb.from("fuel_prices")
      .select(
        "id, sponsor_name, port_area, vlsfo_usd_mt, lsmgo_usd_mt, mgo_usd_mt, vlsfo_direction, lsmgo_direction, mgo_direction",
      )
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(24)
      .then(({ data }) => setRows((data ?? []) as FuelRow[]));
  }, []);

  const segs = rows.map((r) => ({
    r,
    prices: [
      { fuel: "VLSFO", v: r.vlsfo_usd_mt, d: r.vlsfo_direction },
      { fuel: "LSMGO", v: r.lsmgo_usd_mt, d: r.lsmgo_direction },
      { fuel: "MGO", v: r.mgo_usd_mt, d: r.mgo_direction },
    ].filter((p) => p.v != null),
  }));

  const Track = ({ k }: { k: string }) => (
    <>
      {segs.map(({ r, prices }, i) => (
        <span className="bt-seg" key={`${k}-${i}`}>
          <span className="bt-sponsor">{r.sponsor_name}</span>
          <span className="bt-mid-dot">·</span>
          <span className="bt-port">{r.port_area}</span>
          {prices.map((p, j) => (
            <span className="bt-price-grp" key={j}>
              <span className="bt-fuel">{p.fuel}</span>
              <span className="bt-price">${p.v}/MT</span>
              <span className={`bt-dir ${dirCls(p.d)}`}>{arrow(p.d)}</span>
            </span>
          ))}
          <span className="bt-seg__sep" aria-hidden />
        </span>
      ))}
    </>
  );

  return (
    <div className="bunker-ticker" role="region" aria-label="Live bunker prices">
      <div className="bt-label">⛽ BUNKERS</div>
      <div className="bt-track-wrap">
        {segs.length > 0 ? (
          <div className="bt-track">
            <Track k="a" />
            <Track k="b" />
          </div>
        ) : (
          <div className="bt-empty">Bunker price feed — awaiting active sponsors</div>
        )}
      </div>
    </div>
  );
}
