"use client";

// MatchesPopover — the match count on a dashboard row opens this: the matching
// vessels for a cargo (or cargoes for a vessel), one at a time, swipeable /
// arrow-keyed when there are several. Clicking a match focuses it on the map,
// exactly like clicking its own row.
//
// Source of truth = the same RPCs the map pairing uses (get_matches_for_cargo
// / get_matches_for_availability); details come from the board's own lists so
// what you read here is what the row shows. If the RPC is unavailable the
// client-side eligibility gate (pairEligible) fills in, so the list never
// silently stays empty.
import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { CargoView, VesselView } from "@/lib/portal/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { logEvent } from "@/lib/portal/events";
import { getMatchesForCargo } from "@/sdk/app/cargos";
import { getMatchesForAvailability } from "@/sdk/app/vessels";
import { pairEligible, fitLabel, type FitBand } from "@/lib/portal/matching";
import { formatLaycanRange, formatShortDate, formatQtyVol } from "@/lib/portal/format";
import { flagCode } from "@/lib/portal/flags";
import { PosterLine } from "./PosterLine";

type Item =
  | { kind: "vessel"; id: string; view: VesselView | null; fallback: { name: string; dwt: number | null; open: string } | null; fit: FitBand | null }
  | { kind: "cargo"; id: string; view: CargoView | null; fallback: { name: string; qty: string; route: string } | null; fit: FitBand | null };

const RANK: Record<FitBand, number> = { Strong: 3, Good: 2, Possible: 1, Weak: 0 };
const FIT_COLOR: Record<FitBand, string> = { Strong: "#2A9962", Good: "#185FA5", Possible: "#854F0B", Weak: "#8B95A3" };

export function MatchesPopover({
  source,
  pool,
  count,
  onClose,
  onFocus,
}: {
  source: { kind: "cargo"; view: CargoView } | { kind: "vessel"; view: VesselView };
  pool: CargoView[] | VesselView[];
  count: number;
  onClose: () => void;
  onFocus: (id: string) => void;
}) {
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [i, setI] = React.useState(0);
  const touchX = React.useRef<number | null>(null);

  React.useEffect(() => {
    let x = false;
    logEvent("match_popup", { target: source.view.id, meta: { kind: source.kind, count } });
    (async () => {
      const sb = getSupabaseBrowserClient();
      let out: Item[] = [];
      try {
        if (source.kind === "cargo") {
          const rows = await getMatchesForCargo(sb, source.view.id);
          const vessels = pool as VesselView[];
          out = rows.map((r) => {
            const v = vessels.find((x) => x.id === r.availability_id) ?? null;
            return {
              kind: "vessel", id: r.availability_id, view: v,
              fallback: v ? null : { name: r.vessel_name, dwt: r.dwt_grain, open: [r.open_port_name, r.open_zone].filter(Boolean).join(" · ") },
              fit: v ? fitLabel(source.view, v) : null,
            };
          });
        } else {
          const rows = (await getMatchesForAvailability(sb, source.view.id)) as unknown as Record<string, unknown>[];
          const cargos = pool as CargoView[];
          out = rows.map((r) => {
            const id = String(r.cargo_id ?? r.listing_id ?? "");
            const c = cargos.find((x) => x.id === id) ?? null;
            const name = String(r.commodity_name ?? r.commodity ?? "Cargo");
            const qty = r.qty_max_mt != null ? `${Number(r.qty_max_mt).toLocaleString()} MT` : "";
            const route = [r.load_port_name ?? r.load_zone, r.disch_port_name ?? r.disch_zone].filter(Boolean).join(" → ");
            return { kind: "cargo", id, view: c, fallback: c ? null : { name, qty, route }, fit: c ? fitLabel(c, source.view) : null };
          });
        }
      } catch {
        // RPC unavailable → same client-side gate the map uses
        if (source.kind === "cargo") {
          out = (pool as VesselView[]).filter((v) => pairEligible(source.view, v)).map((v) => ({ kind: "vessel", id: v.id, view: v, fallback: null, fit: fitLabel(source.view, v) }));
        } else {
          out = (pool as CargoView[]).filter((c) => pairEligible(c, source.view)).map((c) => ({ kind: "cargo", id: c.id, view: c, fallback: null, fit: fitLabel(c, source.view) }));
        }
      }
      out.sort((a, b) => RANK[b.fit ?? "Weak"] - RANK[a.fit ?? "Weak"]);
      if (!x) { setItems(out); setI(0); }
    })();
    return () => { x = true; };
    // keyed on the listing id — the source object is rebuilt on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, source.view.id, pool]);

  const n = items?.length ?? 0;
  const prev = React.useCallback(() => setI((k) => (n ? (k - 1 + n) % n : 0)), [n]);
  const next = React.useCallback(() => setI((k) => (n ? (k + 1) % n : 0)), [n]);
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, prev, next]);

  const focus = (item: Item) => {
    if (!item.view) { toast.info("This listing is not loaded on your board — it is older than your archive window — so it cannot be shown on the chart."); return; }
    onFocus(item.id);
    onClose();
  };

  const cur = items?.[i] ?? null;
  const title = source.kind === "cargo"
    ? `${count} matching ${count === 1 ? "vessel" : "vessels"} for ${source.view.cargo}`
    : `${count} matching ${count === 1 ? "cargo" : "cargoes"} for ${source.view.name}`;

  // Rendered through a portal: the rows animate with `transform` on hover,
  // and a fixed-position overlay inside a transformed ancestor is positioned
  // against the ROW, not the viewport — it then toggles the row's hover state
  // and the screen flickers. document.body has no such ancestor.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="mpop-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="mpop" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const x0 = touchX.current; touchX.current = null;
          const x1 = e.changedTouches[0]?.clientX;
          if (x0 == null || x1 == null) return;
          if (x1 - x0 > 40) prev(); else if (x0 - x1 > 40) next();
        }}>
        <div className="mpop__head">
          <div className="mpop__title">{title}</div>
          <button type="button" className="mpop__x" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>

        {items === null && <div className="mpop__empty">Loading matches…</div>}
        {items !== null && n === 0 && <div className="mpop__empty">No matches in the market right now.</div>}

        {cur && (
          <div className="mpop__card" onClick={() => focus(cur)} title={cur.view ? "Show on the chart" : undefined}>
            {cur.fit && <span className="mpop__fit" style={{ color: FIT_COLOR[cur.fit], borderColor: FIT_COLOR[cur.fit] }}>{cur.fit} fit</span>}
            {cur.kind === "vessel" && (cur.view ? <VesselDetails v={cur.view} /> : (
              <div className="mpop__fallback"><b>{cur.fallback?.name}</b> · {cur.fallback?.dwt ? `${cur.fallback.dwt.toLocaleString()} DWT` : "DWT —"} · {cur.fallback?.open || "open —"}<div className="mpop__note">Not on your board — older than your archive window</div></div>
            ))}
            {cur.kind === "cargo" && (cur.view ? <CargoDetails c={cur.view} /> : (
              <div className="mpop__fallback"><b>{cur.fallback?.name}</b> · {cur.fallback?.qty} · {cur.fallback?.route}<div className="mpop__note">Not on your board — older than your archive window</div></div>
            ))}
            {cur.view && <div className="mpop__cta">Show on the chart →</div>}
          </div>
        )}

        {n > 1 && (
          <div className="mpop__nav">
            <button type="button" className="mpop__arrow" onClick={prev} title="Previous (←)" aria-label="Previous">‹</button>
            <div className="mpop__dots" aria-hidden>
              {items!.map((_, k) => <span key={k} className={`mpop__dot${k === i ? " is-on" : ""}`} onClick={() => setI(k)} />)}
            </div>
            <span className="mpop__count">{i + 1} / {n}</span>
            <button type="button" className="mpop__arrow" onClick={next} title="Next (→)" aria-label="Next">›</button>
          </div>
        )}
        {n > 1 && <div className="mpop__hint">Swipe or use ← → to move between matches</div>}
      </div>
    </div>,
    document.body,
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="mpop__row"><span className="mpop__k">{k}</span><span className="mpop__v">{v}</span></div>;
}

function VesselDetails({ v }: { v: VesselView }) {
  const fc = flagCode(v.flag);
  return (
    <>
      <div className="mpop__name">
        {v.name}
        <span className={`asb-badge ${v.status === "open" ? "open" : v.status === "review" ? "review" : "fixed"}`} style={{ marginLeft: 8 }}>{v.status.toUpperCase()}</span>
      </div>
      <div className="mpop__grid">
        <Row k="Type" v={v.type} />
        <Row k="DWT" v={`${v.dwt} MT`} />
        <Row k="Gear" v={v.geared == null ? "—" : v.geared ? "Geared" : "Gearless"} />
        <Row k="Flag" v={<>{fc && <span className={`fi fi-${fc}`} style={{ marginRight: 4 }} aria-hidden />}{v.flag}</>} />
        <Row k="Open port" v={<>{v.openPort}{v.openPortZone && v.openPortZone !== "—" ? <span style={{ color: "#8B95A3" }}> · {v.openPortZone}</span> : null}</>} />
        <Row k="Open date" v={formatShortDate(v.openDate)} />
        <Row k="Built" v={v.built ? `${v.built} (${v.age} yrs)` : "—"} />
        <Row k="Grain cap" v={`${v.grainCap} m³`} />
      </div>
      <PosterLine poster={v.poster} />
    </>
  );
}

function CargoDetails({ c }: { c: CargoView }) {
  const { weight } = formatQtyVol(c);
  const pol = c.route.polName || c.route.polCode || c.route.polZone || "—";
  const pod = c.route.podName || c.route.podCode || c.route.podZone || "—";
  return (
    <>
      <div className="mpop__name">
        {c.cargo}
        <span className="asb-badge tiny cargo-type" style={{ marginLeft: 8 }}>{c.type}</span>
      </div>
      <div className="mpop__grid">
        <Row k="Route" v={<>{pol} → {pod}<span style={{ color: "#8B95A3" }}> · {c.route.polZone} → {c.route.podZone}</span></>} />
        <Row k="Laycan" v={c.spot ? "SPOT" : formatLaycanRange(c.laycanFrom, c.laycanTo)} />
        <Row k="Quantity" v={<>{weight}{c.vol && c.vol !== "—" ? ` / ${c.vol} ${c.volUnit ?? "m³"}` : ""}</>} />
        <Row k="Terms" v={c.loadTerms || "—"} />
        <Row k="Freight idea" v={c.freightIdea != null ? `$${c.freightIdea}/MT${c.commission != null ? ` · ${c.commission}%` : ""}` : "—"} />
        <Row k="IMSBC" v={c.imsbcGroup ? `Group ${c.imsbcGroup}` : "—"} />
      </div>
      <PosterLine poster={c.poster} />
    </>
  );
}
