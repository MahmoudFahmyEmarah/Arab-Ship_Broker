"use client";

// Discovery boards (Cargo Market + Tonnage Market), ported from the new design
// (asb/pages.jsx PageCargoMarket / PageTonnageMarket): 2-row functional filter
// bar, account-tier gating (limited cargo / masked vessel for T1/T2),
// Show/Hide side map (selection focuses the map), list/card view.
import type { PortGeo } from "@/lib/portal/port-coords";
import * as React from "react";
import dynamic from "next/dynamic";
import { CargoView, VesselView } from "@/lib/portal/types";
import { CargoCard } from "./CargoCard";
import { VesselCard } from "./VesselCard";
import { BunkerTicker } from "./BunkerTicker";
import { DashCargoRow } from "./dashboard";
import { useViewerTier, isLimitedTier } from "@/lib/portal/tier";
import { IconMap } from "./icons";
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
  const [mapOpen, setMapOpen] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [fZones, setFZones] = React.useState<string[]>([]);
  const [fType, setFType] = React.useState<string[]>([]);
  const [fTerms, setFTerms] = React.useState<string[]>([]);
  const [fImsbc, setFImsbc] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [sort, setSort] = React.useState<string | null>("Newest first");

  const ZONE_OPTS = React.useMemo(() => uniq(views.flatMap((c) => [c.route?.polZone, c.route?.podZone])), [views]);
  const TYPE_OPTS = React.useMemo(() => uniq(views.map((c) => c.type)), [views]);
  const TERMS_OPTS = React.useMemo(() => uniq(views.map((c) => c.loadTerms)), [views]);
  const IMSBC_OPTS = React.useMemo(() => uniq(views.map((c) => c.imsbcGroup)).map((g) => `Group ${g}`), [views]);

  const filtered = React.useMemo(() => {
    let out = views.filter((c) => {
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
  }, [views, fZones, fType, fTerms, fImsbc, fSize, fTime, sort]);

  const selected = filtered.find((c) => c.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BunkerTicker />
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <h1 className="page-title">Cargo Market</h1>
          <div className="row" style={{ gap: 8 }}>
            <span className="asb-badge review">{archiveLabel ?? "Standard access · 1 month archive"}</span>
            <span style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{filtered.length} listings found</span>
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
            <button className="is-on">All cargo</button>
            <button>My matches only</button>
          </div>
          <span className="divider" />
          <span style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>Layer 1 · future · Layer 2 · 6d archive · Layer 3 · 1mo archive</span>
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

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: view === "list" ? 0 : "10px 12px" }} onClick={() => setSelectedId(null)}>
          {filtered.length === 0 ? (
            <MarketEmpty
              title={views.length === 0 ? "No cargo on the market yet" : "No cargo matches these filters"}
              sub={views.length === 0 ? "New listings appear here once Arab ShipBroker approves them." : "Try widening your zone, type or quantity filters."}
            />
          ) : view === "list" ? (
            <div>
              {filtered.map((c) => (
                <DashCargoRow key={c.id} c={c} focused={selectedId === c.id} onClick={() => setSelectedId((s) => (s === c.id ? null : c.id))} />
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 6 }}>
              {filtered.map((c) => (
                <CargoCard key={c.id} data={c} limited={limited} selected={selectedId === c.id} onSelect={(id) => setSelectedId((s) => (s === id ? null : id))} />
              ))}
            </div>
          )}
        </div>
        {mapOpen && (
          <div style={{ width: "50%", flexShrink: 0, borderLeft: "var(--bd)", position: "relative" }}>
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

  const ZONE_OPTS = React.useMemo(() => uniq(views.map((v) => v.openPortZone)), [views]);
  const TYPE_OPTS = React.useMemo(() => uniq(views.map((v) => v.type)), [views]);

  const filtered = React.useMemo(() => {
    let out = views.filter((v) => {
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
  }, [views, q, fZones, fType, fSize, fTime, fGear, fGrain, fDg, sort]);

  const selected = filtered.find((v) => v.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BunkerTicker />
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <h1 className="page-title">Tonnage Market</h1>
          <div className="row" style={{ gap: 10 }}>
            <input className="asb-search" placeholder="Search vessel name or IMO…" style={{ width: 230 }} value={q} onChange={(e) => setQ(e.target.value)} />
            <span style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{filtered.length} vessels</span>
            <button className={`asb-chip ${mapOpen ? "is-active" : ""}`} onClick={() => setMapOpen((o) => !o)}>
              <IconMap size={12} /> {mapOpen ? "Hide map" : "Show map"}
            </button>
          </div>
        </div>
      </div>

      <div className="mkt-filterbar" style={{ background: "var(--asb-white)", borderBottom: "var(--bd)", padding: "6px 16px" }}>
        <div className="row" style={{ marginBottom: 6, gap: 8 }}>
          <div className="match-toggle">
            <button className="is-on">All vessels</button>
            <button>My matches only</button>
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
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 16px" }} onClick={() => setSelectedId(null)}>
          {filtered.length === 0 ? (
            <MarketEmpty
              title={views.length === 0 ? "No open tonnage yet" : "No vessels match these filters"}
              sub={views.length === 0 ? "Open positions appear here once Arab ShipBroker approves them." : "Try widening your zone, type or DWT filters."}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
              {filtered.map((v) => (
                <VesselCard key={v.id} data={v} masked={masked} selected={selectedId === v.id} onSelect={(id) => setSelectedId((s) => (s === id ? null : id))} />
              ))}
            </div>
          )}
        </div>
        {mapOpen && (
          <div style={{ width: "55%", flexShrink: 0, borderLeft: "var(--bd)", position: "relative" }}>
            <MarketMap barLeft cargos={[]} vessels={filtered} portCoords={portCoords} focusedVesselId={selected?.id ?? null} onSelectVessel={(v) => setSelectedId((s) => (s === v.id ? null : v.id))} />
          </div>
        )}
      </div>
    </div>
  );
}
