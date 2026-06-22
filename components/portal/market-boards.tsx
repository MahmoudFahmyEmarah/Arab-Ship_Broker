"use client";

// Discovery boards (Cargo Market + Tonnage Market), ported from the new design
// (asb/pages.jsx PageCargoMarket / PageTonnageMarket): 2-row functional filter
// bar, account-tier gating (limited cargo / masked vessel for T1/T2),
// Show/Hide side map (selection focuses the map), list/card view.
import type { PortGeo } from "@/lib/portal/port-coords";
import * as React from "react";
import dynamic from "next/dynamic";
import { CargoView, VesselView } from "@/lib/portal/types";
import {
  cargoTypeLabel,
  cargoTypeBadgeVariant,
  formatQtyVol,
  formatLaycanRange,
  ldRateRender,
} from "@/lib/portal/format";
import { CargoCard } from "./CargoCard";
import { VesselCard } from "./VesselCard";
import { urgencyDot } from "./ui";
import { BunkerTicker } from "./BunkerTicker";
import { useViewerTier, isLimitedTier } from "@/lib/portal/tier";
import { fetchMyMatchedCargoIds, fetchMyMatchedAvailabilityIds } from "@/lib/portal/actions";
import { IconMap } from "./icons";
import { SheetHandle, useSheetPeek } from "./SheetHandle";
import { useSplitPane, SplitDivider } from "./useSplitPane";
import {
  FilterMenu,
  CheckList,
  RangeMenu,
  TimeMenu,
  GearSeg,
  RadioList,
  rangeSummary,
  toMt,
  type SizeRange,
} from "./filters";

const MarketMap = dynamic(() => import("./MarketMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", background: "var(--map-ocean)" }} />,
});

const uniq = (xs: (string | null | undefined)[]) =>
  Array.from(new Set(xs.filter(Boolean) as string[]));

// Friendly empty state — shown when the market has no listings yet (launch) or
// when the active filters exclude everything. Never shows mock data to members.
function MarketEmpty({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 240, textAlign: "center", padding: 24, color: "var(--asb-gray-500)" }}>
      <div style={{ fontSize: 28, opacity: 0.5, marginBottom: 8 }}>⚓</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--asb-ink)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, maxWidth: 320, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

// Open-date urgency legend + live stats. Explains the open-date dot shown on
// each vessel card and counts how many open positions fall in each bucket.
// Independent of the status header strip (OPEN / REVIEW / FIXED / …).
function OpenDateLegend({ vessels }: { vessels: VesselView[] }) {
  const stats = React.useMemo(() => {
    let red = 0, amber = 0, green = 0;
    for (const v of vessels) {
      if (v.openDateUrgency === "red") red++;
      else if (v.openDateUrgency === "amber") amber++;
      else green++;
    }
    return { red, amber, green };
  }, [vessels]);

  const item = (cls: string, label: string, count: number) => (
    <span className="odl-item" title={`${count} vessel${count === 1 ? "" : "s"}`}>
      <span className={`asb-dot ${cls}`} />
      <span className="odl-label">{label}</span>
      <span className="odl-count">{count}</span>
    </span>
  );

  return (
    <div className="open-date-legend">
      <span className="odl-title">Open-date availability</span>
      {item("red", "Overdue / prompt", stats.red)}
      {item("amber", "Opening this week", stats.amber)}
      {item("green", "Ahead / no date", stats.green)}
      <span className="odl-note">Independent of vessel status</span>
    </div>
  );
}

// Cargo Market list (table) view — a polished, scannable table that keeps every
// field the cargo card shows (qty/vol, laycan, terms, SF, L/D rate, IMSBC group,
// circulation + match status, ref). Replaces the old dense single-line row.
function CargoListTable({
  cargos,
  limited,
  selectedId,
  onSelect,
}: {
  cargos: CargoView[];
  limited?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cargo-table">
      <div className="cargo-table__inner">
        <div className="cargo-table__head">
          <div className="ct-h">Cargo · route</div>
          <div className="ct-h">Qty / Vol</div>
          <div className="ct-h">Laycan</div>
          <div className="ct-h">Terms</div>
          <div className="ct-h">SF</div>
          <div className="ct-h">L/D rate</div>
          <div className="ct-h">IMSBC</div>
          <div className="ct-h">Status</div>
          <div className="ct-h right">Ref</div>
        </div>
        {cargos.map((c) => {
          const typeLabel = cargoTypeLabel(c);
          const typeVariant = cargoTypeBadgeVariant(typeLabel);
          const { weight, volume } = formatQtyVol(c);
          const laycanStr = formatLaycanRange(c.laycanFrom, c.laycanTo);
          const isSpot = !!c.spot;
          const isOverdue = c.laycanDays != null && c.laycanDays < 0;
          const ld = ldRateRender(c);
          const isGroupA = c.imsbcGroup === "A";
          const isDG = c.imsbcGroup === "DG";
          const sfDense = c.sf != null && c.sf < 0.5;
          const sfText = c.sf != null ? `${c.sf} ${c.volUnit ? `${c.volUnit}/t` : "m³/t"}` : null;
          const matches = c.matches || 0;
          return (
            <div
              key={c.id}
              className={`cargo-table__row${selectedId === c.id ? " is-selected" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(c.id);
              }}
            >
              <div className="ct-cell">
                <div className="ct-name-row">
                  <span className="ct-name">{c.cargo}</span>
                  <span className={`cc-cat cc-cat--${typeVariant}`}>{typeLabel}</span>
                  {c.wog && <span className="ct-wog">WOG</span>}
                </div>
                <div className="ct-route">
                  <span className="ports">{c.route.polCode} → {c.route.podCode}</span>
                  <span className="zone">{c.route.polZone} → {c.route.podZone}</span>
                </div>
              </div>

              <div className="ct-cell">
                <div className="ct-val">{weight}</div>
                <div className="ct-sub">{volume}</div>
              </div>

              <div className="ct-cell">
                {isSpot ? (
                  <span className="ct-laycan">SPOT</span>
                ) : (
                  <span className={`ct-laycan${isOverdue ? " is-overdue" : ""}`}>{laycanStr}</span>
                )}
              </div>

              <div className="ct-text">{c.loadTerms || "—"}</div>

              <div className="ct-cell">
                {sfText ? (
                  <span className="ct-warnv" style={sfDense ? { color: "#854F0B" } : undefined}>
                    {sfDense && <span className="warn">⚠</span>}
                    {sfText}
                  </span>
                ) : (
                  <span className="ct-warnv" style={{ color: "var(--asb-gray-500)" }}>
                    <span className="warn">⚠</span> Not declared
                  </span>
                )}
              </div>

              <div className="ct-cell">
                {ld.kind === "value" && <span className="ct-mono">{ld.text}</span>}
                {ld.kind === "badge" && <span className="cc-cat cc-cat--dryish" style={{ fontSize: 9 }}>{ld.label}</span>}
                {ld.kind === "tbd" && <span className="ct-sub">Rate TBD</span>}
              </div>

              <div className="ct-cell">
                {isGroupA ? (
                  <span className="ct-warnv" style={{ color: "#854F0B" }}><span className="warn">⚠</span> Group A</span>
                ) : isDG ? (
                  <span className="ct-warnv" style={{ color: "#A32D2D" }}><span className="warn">⚠</span> DG</span>
                ) : (
                  <span className="ct-text">Group {c.imsbcGroup || "—"}</span>
                )}
              </div>

              <div className="ct-status">
                <span
                  className={`ct-chip ${c.forCirculation ? "circ-on" : "circ-off"}`}
                  title={c.forCirculation ? "In circulation" : "Not in circulation"}
                >
                  <span className="dot" /> CIRC
                </span>
                <span className={`ct-chip match${limited ? " locked" : ""}`} title="Vessel matches">
                  {limited ? "🔒" : `${matches} match${matches === 1 ? "" : "es"}`}
                </span>
              </div>

              <div className="ct-ref">{c.refId}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// How many listings to render before the "Load more" button — keeps the DOM
// light when a market has hundreds/thousands of listings. Each click reveals
// another batch of this size.
const PAGE_SIZE = 24;

// "Load N more · X remaining" button (centered under the list/grid). Renders
// nothing once everything is visible.
function LoadMore({ total, visible, onMore }: { total: number; visible: number; onMore: () => void }) {
  const remaining = total - visible;
  if (remaining <= 0) return null;
  const next = Math.min(PAGE_SIZE, remaining);
  return (
    <div className="mkt-loadmore">
      <button type="button" className="mkt-loadmore__btn" onClick={onMore}>
        Load {next} more <span className="mkt-loadmore__rem">· {remaining} remaining</span>
      </button>
    </div>
  );
}

// Tonnage Market list (table) view — keeps every field the vessel card shows
// (status, identity, DWT, built/age, grain cap, open port, open-date urgency,
// gear, fuel ME·Aux, matches). Identity masks to "Tier 3+" for limited tiers.
const VESSEL_STATUS_LABEL: Record<string, string> = {
  open: "OPEN", review: "REVIEW", fixed: "FIXED", in: "ACTIVE", partial: "PARTIAL",
};
function VesselListTable({
  vessels,
  masked,
  selectedId,
  onSelect,
}: {
  vessels: VesselView[];
  masked?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const fuelStr = (n: number | string) => (n === "—" || n == null || n === "" ? "—" : `${n} t`);
  return (
    <div className="vessel-table">
      <div className="vessel-table__inner">
        <div className="vessel-table__head">
          <div className="ct-h">Status</div>
          <div className="ct-h">Vessel · flag · type</div>
          <div className="ct-h">DWT</div>
          <div className="ct-h">Built / age</div>
          <div className="ct-h">Grain cap</div>
          <div className="ct-h">Open port</div>
          <div className="ct-h">Open date</div>
          <div className="ct-h">Gear</div>
          <div className="ct-h">Fuel ME · Aux (sea/port)</div>
          <div className="ct-h right">Match</div>
        </div>
        {vessels.map((v) => {
          const statusLabel = VESSEL_STATUS_LABEL[v.status] || (v.status || "").toUpperCase();
          const hasDate = !!v.openDate && v.openDate !== "—";
          const odLabel = !hasDate
            ? "No date"
            : v.openDateUrgency === "red"
            ? "Overdue"
            : v.openDateUrgency === "amber"
            ? "This week"
            : "Ahead";
          const f = v.fuel;
          const hasFuel = [f.vlsfoSea, f.vlsfoPort, f.lsmgoSea, f.lsmgoPort].some(
            (x) => x !== "—" && x != null && x !== "",
          );
          return (
            <div
              key={v.id}
              className={`vessel-table__row${selectedId === v.id ? " is-selected" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(v.id);
              }}
            >
              <div className={`vt-status sb-${v.status}`}>{statusLabel}</div>

              <div className="ct-cell">
                <div className="ct-name-row">
                  {masked && <span className="vt-lock" aria-hidden>🔒</span>}
                  <span className="ct-name">{masked ? "Tier 3+ identity" : v.name}</span>
                </div>
                <div className="ct-sub">{v.flag} · {v.type}</div>
              </div>

              <div className="ct-val">{v.dwt} MT</div>
              <div className="ct-text">{v.built ? `${v.built} (${v.age} yrs)` : "—"}</div>
              <div className="ct-text">{v.grainCap} m³</div>
              <div className="ct-text" style={{ whiteSpace: "nowrap" }}>
                {v.openPort} <span style={{ color: "var(--asb-gray-500)" }}>· {v.openPortZone}</span>
              </div>

              <div className="ct-cell">
                <div className="vt-od">
                  {urgencyDot(v.openDateUrgency)}
                  <span className="ct-val" style={{ fontFamily: "var(--asb-font-mono, monospace)", fontSize: 12 }}>{hasDate ? v.openDate : "—"}</span>
                </div>
                <div className="ct-sub">{odLabel}</div>
              </div>

              <div className="ct-text">{v.geared == null ? "—" : v.geared ? "Geared" : "Gearless"}</div>

              <div className="ct-mono" style={{ whiteSpace: "nowrap" }}>
                {hasFuel
                  ? `${fuelStr(f.vlsfoSea)} · ${fuelStr(f.vlsfoPort)} / ${fuelStr(f.lsmgoSea)} · ${fuelStr(f.lsmgoPort)}`
                  : "—"}
              </div>

              <div style={{ textAlign: "right" }}>
                <span className="vt-match">{v.matches}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Numbered page list with ellipses, e.g. 1 … 4 5 6 … 27.
function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push("…");
  out.push(total);
  return out;
}

const ROWS_PER_PAGE_OPTS = [25, 50, 100];

// Classic table pagination (list view): "Showing X–Y of Z", numbered pages with
// prev/next, and a rows-per-page selector. (Card view keeps the Load-more button.)
function TablePagination({
  total,
  page,
  rowsPerPage,
  onPage,
  onRowsPerPage,
}: {
  total: number;
  page: number;
  rowsPerPage: number;
  onPage: (p: number) => void;
  onRowsPerPage: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const start = total === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const end = Math.min(page * rowsPerPage, total);
  return (
    <div className="tbl-pager">
      <div className="tbl-pager__count">
        Showing <b>{start}–{end}</b> of <b>{total}</b>
      </div>
      <div className="tbl-pager__pages">
        <button type="button" className="tbl-pg arrow" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {pageItems(page, totalPages).map((it, i) =>
          it === "…" ? (
            <span key={`e${i}`} className="tbl-pg-ellipsis">…</span>
          ) : (
            <button type="button" key={it} className={`tbl-pg${it === page ? " is-active" : ""}`} onClick={() => onPage(it)}>{it}</button>
          ),
        )}
        <button type="button" className="tbl-pg arrow" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
      </div>
      <label className="tbl-pager__rpp">
        Rows per page
        <select value={rowsPerPage} onChange={(e) => onRowsPerPage(Number(e.target.value))}>
          {ROWS_PER_PAGE_OPTS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

type Density = "comfortable" | "compact";

// Card density toggle — Comfortable shows full detail; Compact drops the heavy
// secondary data (fuel block / terms / SF / IMSBC) and tightens spacing so more
// listings fit per screen when the map is hidden. Reuses the .match-toggle pill.
function DensityToggle({ value, onChange }: { value: Density; onChange: (v: Density) => void }) {
  return (
    <div className="match-toggle" role="group" aria-label="Card density" title="Card density">
      <button type="button" className={value === "comfortable" ? "is-on" : ""} onClick={() => onChange("comfortable")}>Comfortable</button>
      <button type="button" className={value === "compact" ? "is-on" : ""} onClick={() => onChange("compact")}>Compact</button>
    </div>
  );
}

// ── Cargo Market ───────────────────────────────────────────────────────────
export function CargoMarketBoard({
  views,
  portCoords,
  archiveLabel,
}: {
  views: CargoView[];
  source?: "live" | "sample";
  portCoords?: Record<string, PortGeo>;
  archiveLabel?: string;
}) {
  const limited = isLimitedTier(useViewerTier());

  const [view, setView] = React.useState<"card" | "list">("card");
  const [density, setDensity] = React.useState<Density>("comfortable");
  const [mapOpen, setMapOpen] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [fZones, setFZones] = React.useState<string[]>([]);
  const [fType, setFType] = React.useState<string[]>([]);
  const [fTerms, setFTerms] = React.useState<string[]>([]);
  const [fImsbc, setFImsbc] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [sort, setSort] = React.useState<string | null>("Newest first");

  // "My matches only" — ids of cargo matching MY open positions, from the same
  // match RPCs the detail panels use. Loaded lazily on first toggle.
  const [mineOnly, setMineOnly] = React.useState(false);
  const [myMatchIds, setMyMatchIds] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (!mineOnly || myMatchIds !== null) return;
    fetchMyMatchedCargoIds().then((ids) => setMyMatchIds(new Set(ids))).catch(() => setMyMatchIds(new Set()));
  }, [mineOnly, myMatchIds]);
  const [sheetPeek, toggleSheetPeek] = useSheetPeek();
  const split = useSplitPane(50);

  const ZONE_OPTS = React.useMemo(() => uniq(views.flatMap((c) => [c.route?.polZone, c.route?.podZone])), [views]);
  const TYPE_OPTS = React.useMemo(() => uniq(views.map((c) => c.type)), [views]);
  const TERMS_OPTS = React.useMemo(() => uniq(views.map((c) => c.loadTerms)), [views]);
  const IMSBC_OPTS = React.useMemo(() => uniq(views.map((c) => c.imsbcGroup)).map((g) => `Group ${g}`), [views]);

  const filtered = React.useMemo(() => {
    let out = views.filter((c) => {
      if (mineOnly && !(myMatchIds?.has(c.id))) return false;
      if (fZones.length) { const z = [c.route?.polZone, c.route?.podZone]; if (!z.some((x) => x && fZones.includes(x))) return false; }
      if (fType.length && !fType.includes(c.type)) return false;
      if (fTerms.length && !(c.loadTerms && fTerms.includes(c.loadTerms))) return false;
      if (fImsbc.length && !fImsbc.includes(`Group ${c.imsbcGroup}`)) return false;
      if (fSize) { const q = toMt(c.qtyMt); if (fSize.min != null && q < fSize.min) return false; if (fSize.max != null && q > fSize.max) return false; }
      if (fTime != null && !(c.laycanDays != null && c.laycanDays <= fTime)) return false;
      return true;
    });
    if (sort === "Quantity ↑") out = [...out].sort((a, b) => toMt(a.qtyMt) - toMt(b.qtyMt));
    if (sort === "Quantity ↓") out = [...out].sort((a, b) => toMt(b.qtyMt) - toMt(a.qtyMt));
    if (sort === "Laycan soonest") out = [...out].sort((a, b) => (a.laycanDays ?? 999) - (b.laycanDays ?? 999));
    return out;
  }, [views, fZones, fType, fTerms, fImsbc, fSize, fTime, sort, mineOnly, myMatchIds]);

  const selected = filtered.find((c) => c.id === selectedId);

  // Card view: incremental "Load more". List view: classic numbered pages.
  // Both reset to the start whenever the filter/sort inputs change.
  const [visible, setVisible] = React.useState(PAGE_SIZE);
  const [page, setPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(25);
  React.useEffect(() => { setVisible(PAGE_SIZE); setPage(1); }, [fZones, fType, fTerms, fImsbc, fSize, fTime, sort, mineOnly]);
  const shown = filtered.slice(0, visible);
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BunkerTicker />
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <h1 className="page-title">Cargo Market</h1>
          <div className="row" style={{ gap: 8 }}>
            <span className="asb-badge review mkt-head-meta">{archiveLabel ?? "Standard access · 1 month archive"}</span>
            <span className="mkt-head-meta" style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{filtered.length} listings found</span>
            {view === "card" && <DensityToggle value={density} onChange={setDensity} />}
            <div className="dash-view-toggle" style={{ marginLeft: 4 }}>
              <button type="button" className={view === "list" ? "is-on" : ""} onClick={() => setView("list")} aria-label="List view">
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="3" y1="4" x2="11" y2="4" /><line x1="3" y1="7" x2="11" y2="7" /><line x1="3" y1="10" x2="11" y2="10" /></svg>
              </button>
              <button type="button" className={view === "card" ? "is-on" : ""} onClick={() => setView("card")} aria-label="Card view">
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="3.5" height="3.5" rx="0.5" /><rect x="7.5" y="3" width="3.5" height="3.5" rx="0.5" /><rect x="3" y="7.5" width="3.5" height="3.5" rx="0.5" /><rect x="7.5" y="7.5" width="3.5" height="3.5" rx="0.5" /></svg>
              </button>
            </div>
            <button className={`asb-chip ${mapOpen ? "is-active" : ""}`} onClick={() => setMapOpen((o) => !o)} style={{ marginLeft: 4 }}>
              <IconMap size={12} /> {mapOpen ? "Hide map" : "Show map"}
            </button>
          </div>
        </div>
      </div>

      <div className="mkt-filterbar" style={{ background: "var(--asb-white)", borderBottom: "var(--bd)", padding: "6px 16px" }}>
        <div className="row" style={{ marginBottom: 6, gap: 8 }}>
          <div className="match-toggle">
            <button className={mineOnly ? "" : "is-on"} onClick={() => setMineOnly(false)}>All cargo</button>
            <button className={mineOnly ? "is-on" : ""} onClick={() => setMineOnly(true)}
              title="Only cargo that matches one of your open positions">
              My matches only{mineOnly && myMatchIds === null ? " …" : ""}
            </button>
          </div>
          <span className="divider" />
          <span className="mkt-layer-note" style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>Layer 1 · future · Layer 2 · 6d archive · Layer 3 · 1mo archive</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <FilterMenu label="Zone" badge={fZones.length || null} active={fZones.length > 0} width={150}>
            <CheckList options={ZONE_OPTS} value={fZones} onChange={setFZones} onClear={() => setFZones([])} />
          </FilterMenu>
          <FilterMenu label="Cargo type" badge={fType.length || null} active={fType.length > 0} width={170}>
            <CheckList options={TYPE_OPTS} value={fType} onChange={setFType} onClear={() => setFType([])} />
          </FilterMenu>
          <FilterMenu label="Quantity" summary={rangeSummary(fSize)} active={!!fSize} width={220}>
            <RangeMenu value={fSize} onChange={setFSize} />
          </FilterMenu>
          <FilterMenu label="Load terms" badge={fTerms.length || null} active={fTerms.length > 0} width={170}>
            <CheckList options={TERMS_OPTS} value={fTerms} onChange={setFTerms} onClear={() => setFTerms([])} />
          </FilterMenu>
          <FilterMenu label="IMSBC group" badge={fImsbc.length || null} active={fImsbc.length > 0} width={150}>
            <CheckList options={IMSBC_OPTS} value={fImsbc} onChange={setFImsbc} onClear={() => setFImsbc([])} />
          </FilterMenu>
          <FilterMenu label="Laycan" summary={fTime ? `${fTime}d` : null} active={fTime != null} width={210}>
            <TimeMenu value={fTime} onChange={setFTime} />
          </FilterMenu>
          <FilterMenu label={`Sort: ${sort ?? "—"}`} active={false} width={180}>
            <RadioList options={["Newest first", "Quantity ↑", "Quantity ↓", "Laycan soonest"]} value={sort} onChange={setSort} />
          </FilterMenu>
        </div>
      </div>

      <div ref={split.containerRef} className={`mkt-body${mapOpen ? " has-map" : ""}`} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div className={`mkt-listpane${sheetPeek ? " is-peek" : ""}`} style={{ ...(mapOpen ? { width: `${split.pct}%`, flexShrink: 0 } : { flex: 1 }), minWidth: 0, overflow: "auto", padding: view === "list" ? "12px 14px" : "10px 12px" }} onClick={() => setSelectedId(null)}>
          {mapOpen && <SheetHandle peek={sheetPeek} onToggle={toggleSheetPeek} label={`${filtered.length} listings`} />}
          {filtered.length === 0 ? (
            <MarketEmpty
              title={views.length === 0 ? "No cargo on the market yet" : "No cargo matches these filters"}
              sub={views.length === 0 ? "New listings appear here once Arab ShipBroker approves them." : "Try widening your zone, type or quantity filters."}
            />
          ) : view === "list" ? (
            <>
              <CargoListTable
                cargos={pageRows}
                limited={limited}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((s) => (s === id ? null : id))}
              />
              <TablePagination
                total={filtered.length}
                page={safePage}
                rowsPerPage={rowsPerPage}
                onPage={setPage}
                onRowsPerPage={(n) => { setRowsPerPage(n); setPage(1); }}
              />
            </>
          ) : (
            <>
              <div className={`mkt-cards-grid${density === "compact" ? " is-compact" : ""}`}>
                {shown.map((c) => (
                  <CargoCard key={c.id} data={c} limited={limited} compact={density === "compact"} selected={selectedId === c.id} onSelect={(id) => setSelectedId((s) => (s === id ? null : id))} />
                ))}
              </div>
              <LoadMore total={filtered.length} visible={visible} onMore={() => setVisible((v) => v + PAGE_SIZE)} />
            </>
          )}
        </div>
        {mapOpen && <SplitDivider onMouseDown={split.onDividerMouseDown} />}
        {mapOpen && (
          <div className="mkt-mappane" style={{ flex: 1, minWidth: 0, borderLeft: "var(--bd)", position: "relative" }}>
            <MarketMap barLeft cargos={filtered} vessels={[]} portCoords={portCoords} focusedCargoId={selected?.id ?? null} onSelectCargo={(c) => setSelectedId((s) => (s === c.id ? null : c.id))} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tonnage Market ───────────────────────────────────────────────────────────
export function TonnageMarketBoard({
  views,
  portCoords,
}: {
  views: VesselView[];
  source?: "live" | "sample";
  portCoords?: Record<string, PortGeo>;
}) {
  const masked = isLimitedTier(useViewerTier());

  const [view, setView] = React.useState<"card" | "list">("card");
  const [density, setDensity] = React.useState<Density>("comfortable");
  const [mapOpen, setMapOpen] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  const [fZones, setFZones] = React.useState<string[]>([]);
  const [fType, setFType] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [fGear, setFGear] = React.useState("any");
  const [fGrain, setFGrain] = React.useState(false);
  const [fDg, setFDg] = React.useState(false);
  const [sort, setSort] = React.useState<string | null>("Newest");

  // "My matches only" — ids of open positions matching MY live cargo.
  const [mineOnly, setMineOnly] = React.useState(false);
  const [myMatchIds, setMyMatchIds] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (!mineOnly || myMatchIds !== null) return;
    fetchMyMatchedAvailabilityIds().then((ids) => setMyMatchIds(new Set(ids))).catch(() => setMyMatchIds(new Set()));
  }, [mineOnly, myMatchIds]);
  const [sheetPeek, toggleSheetPeek] = useSheetPeek();
  const split = useSplitPane(50);

  const ZONE_OPTS = React.useMemo(() => uniq(views.map((v) => v.openPortZone)), [views]);
  const TYPE_OPTS = React.useMemo(() => uniq(views.map((v) => v.type)), [views]);

  const filtered = React.useMemo(() => {
    let out = views.filter((v) => {
      if (mineOnly && !(myMatchIds?.has(v.id))) return false;
      if (q.trim()) {
        const s = q.trim().toLowerCase();
        if (!(v.name.toLowerCase().includes(s) || v.imo.toLowerCase().includes(s))) return false;
      }
      if (fZones.length && !fZones.includes(v.openPortZone)) return false;
      if (fType.length && !fType.includes(v.type)) return false;
      if (fSize) { const d = toMt(v.dwt); if (fSize.min != null && d < fSize.min) return false; if (fSize.max != null && d > fSize.max) return false; }
      if (fTime != null && !(v.openDateDays != null && v.openDateDays <= fTime)) return false;
      if (fGear === "geared" && !v.geared) return false;
      if (fGear === "gearless" && v.geared) return false;
      if (fGrain && !v.grainCertified) return false;
      if (fDg && !v.dgCertified) return false;
      return true;
    });
    if (sort === "DWT ↑") out = [...out].sort((a, b) => toMt(a.dwt) - toMt(b.dwt));
    if (sort === "DWT ↓") out = [...out].sort((a, b) => toMt(b.dwt) - toMt(a.dwt));
    if (sort === "Open soonest") out = [...out].sort((a, b) => (a.openDateDays ?? 999) - (b.openDateDays ?? 999));
    return out;
  }, [views, q, fZones, fType, fSize, fTime, fGear, fGrain, fDg, sort, mineOnly, myMatchIds]);

  const selected = filtered.find((v) => v.id === selectedId);

  // Card view: incremental "Load more". List view: classic numbered pages.
  const [visible, setVisible] = React.useState(PAGE_SIZE);
  const [page, setPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState(25);
  React.useEffect(() => { setVisible(PAGE_SIZE); setPage(1); }, [q, fZones, fType, fSize, fTime, fGear, fGrain, fDg, sort, mineOnly]);
  const shown = filtered.slice(0, visible);
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BunkerTicker />
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <h1 className="page-title">Tonnage Market</h1>
          <div className="row" style={{ gap: 10 }}>
            <input className="asb-search" placeholder="Search vessel name or IMO…" style={{ width: 230 }} value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="mkt-head-meta" style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{filtered.length} vessels</span>
            {view === "card" && <DensityToggle value={density} onChange={setDensity} />}
            <div className="dash-view-toggle" style={{ marginLeft: 4 }}>
              <button type="button" className={view === "list" ? "is-on" : ""} onClick={() => setView("list")} aria-label="List view">
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="3" y1="4" x2="11" y2="4" /><line x1="3" y1="7" x2="11" y2="7" /><line x1="3" y1="10" x2="11" y2="10" /></svg>
              </button>
              <button type="button" className={view === "card" ? "is-on" : ""} onClick={() => setView("card")} aria-label="Card view">
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="3.5" height="3.5" rx="0.5" /><rect x="7.5" y="3" width="3.5" height="3.5" rx="0.5" /><rect x="3" y="7.5" width="3.5" height="3.5" rx="0.5" /><rect x="7.5" y="7.5" width="3.5" height="3.5" rx="0.5" /></svg>
              </button>
            </div>
            <button className={`asb-chip ${mapOpen ? "is-active" : ""}`} onClick={() => setMapOpen((o) => !o)} style={{ marginLeft: 4 }}>
              <IconMap size={12} /> {mapOpen ? "Hide map" : "Show map"}
            </button>
          </div>
        </div>
      </div>

      <div className="mkt-filterbar" style={{ background: "var(--asb-white)", borderBottom: "var(--bd)", padding: "6px 16px" }}>
        <div className="row" style={{ marginBottom: 6, gap: 8 }}>
          <div className="match-toggle">
            <button className={mineOnly ? "" : "is-on"} onClick={() => setMineOnly(false)}>All vessels</button>
            <button className={mineOnly ? "is-on" : ""} onClick={() => setMineOnly(true)}
              title="Only open positions that match one of your live cargoes">
              My matches only{mineOnly && myMatchIds === null ? " …" : ""}
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <FilterMenu label="Zone" badge={fZones.length || null} active={fZones.length > 0} width={150}>
            <CheckList options={ZONE_OPTS} value={fZones} onChange={setFZones} onClear={() => setFZones([])} />
          </FilterMenu>
          <FilterMenu label="Vessel type" badge={fType.length || null} active={fType.length > 0} width={180}>
            <CheckList options={TYPE_OPTS} value={fType} onChange={setFType} onClear={() => setFType([])} />
          </FilterMenu>
          <FilterMenu label="DWT range" summary={rangeSummary(fSize)} active={!!fSize} width={220}>
            <RangeMenu value={fSize} onChange={setFSize} />
          </FilterMenu>
          <FilterMenu label="Open date" summary={fTime ? `${fTime}d` : null} active={fTime != null} width={210}>
            <TimeMenu value={fTime} onChange={setFTime} />
          </FilterMenu>
          <span className="eyebrow" style={{ marginLeft: 2 }}>Gear</span>
          <GearSeg value={fGear} onChange={setFGear} />
          <button className={`asb-chip ${fGrain ? "is-active" : ""}`} onClick={() => setFGrain((v) => !v)}>Grain cert</button>
          <button className={`asb-chip ${fDg ? "is-active" : ""}`} onClick={() => setFDg((v) => !v)}>DG cert</button>
          <FilterMenu label={`Sort: ${sort ?? "—"}`} active={false} width={170}>
            <RadioList options={["Newest", "DWT ↑", "DWT ↓", "Open soonest"]} value={sort} onChange={setSort} />
          </FilterMenu>
        </div>
        <OpenDateLegend vessels={filtered} />
      </div>

      <div ref={split.containerRef} className={`mkt-body${mapOpen ? " has-map" : ""}`} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div className={`mkt-listpane${sheetPeek ? " is-peek" : ""}`} style={{ ...(mapOpen ? { width: `${split.pct}%`, flexShrink: 0 } : { flex: 1 }), minWidth: 0, overflow: "auto", padding: view === "list" ? "12px 14px" : "14px 16px" }} onClick={() => setSelectedId(null)}>
          {mapOpen && <SheetHandle peek={sheetPeek} onToggle={toggleSheetPeek} label={`${filtered.length} vessels`} />}
          {filtered.length === 0 ? (
            <MarketEmpty
              title={views.length === 0 ? "No open tonnage yet" : "No vessels match these filters"}
              sub={views.length === 0 ? "Open positions appear here once Arab ShipBroker approves them." : "Try widening your zone, type or DWT filters."}
            />
          ) : view === "list" ? (
            <>
              <VesselListTable
                vessels={pageRows}
                masked={masked}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((s) => (s === id ? null : id))}
              />
              <TablePagination
                total={filtered.length}
                page={safePage}
                rowsPerPage={rowsPerPage}
                onPage={setPage}
                onRowsPerPage={(n) => { setRowsPerPage(n); setPage(1); }}
              />
            </>
          ) : (
            <>
              <div className={`tonnage-grid${density === "compact" ? " is-compact" : ""}`}>
                {shown.map((v) => (
                  <VesselCard key={v.id} data={v} masked={masked} compact={density === "compact"} selected={selectedId === v.id} onSelect={(id) => setSelectedId((s) => (s === id ? null : id))} />
                ))}
              </div>
              <LoadMore total={filtered.length} visible={visible} onMore={() => setVisible((v) => v + PAGE_SIZE)} />
            </>
          )}
        </div>
        {mapOpen && <SplitDivider onMouseDown={split.onDividerMouseDown} />}
        {mapOpen && (
          <div className="mkt-mappane" style={{ flex: 1, minWidth: 0, borderLeft: "var(--bd)", position: "relative" }}>
            <MarketMap barLeft cargos={[]} vessels={filtered} portCoords={portCoords} focusedVesselId={selected?.id ?? null} onSelectVessel={(v) => setSelectedId((s) => (s === v.id ? null : v.id))} />
          </div>
        )}
      </div>
    </div>
  );
}
