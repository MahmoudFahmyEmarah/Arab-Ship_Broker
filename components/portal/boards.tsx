"use client";

// Page bodies for the portal preview, ported from the Claude design
// (asb/pages.jsx). Server pages adapt rows → views and hand them here.
import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CargoView, VesselView } from "@/lib/portal/types";
import { CargoCard } from "./CargoCard";
import { VesselCard } from "./VesselCard";
import { BunkerTicker } from "./BunkerTicker";
import { DashboardPanel } from "./dashboard";
import { CargoDetailPanel, VesselDetailPanel } from "./DetailPanels";
import { DashboardTierBanner } from "./TierBanner";
import {
  FilterMenu,
  CheckList,
  RangeMenu,
  TimeMenu,
  GearSeg,
  rangeSummary,
  cargoClassTags,
  vesselClassTags,
  toMt,
  CLASS_OPTS,
  type SizeRange,
} from "./filters";
import { IconPlus, IconBell, IconMap } from "./icons";

// Top matches: ONE matching module (lib/portal/matching) — same gates as the map pairing.
import { buildTopMatches, type DashMatch } from "@/lib/portal/matching";

function fmtTce(tce: number): string {
  if (!tce) return "—";
  const k = tce / 1000;
  return Math.abs(k) >= 1 ? `$${k.toFixed(1)}k/d` : `$${Math.round(tce)}/d`;
}

function MatchModeSwitch({ mode, setMode }: { mode: "cargo" | "vessel"; setMode: (m: "cargo" | "vessel") => void }) {
  return (
    <div className="mm-switch" role="group" aria-label="Match mode">
      <span className="mm-switch__lbl">Matching</span>
      <div className="mm-switch__seg">
        <button className={mode === "cargo" ? "is-on" : ""} onClick={() => setMode("cargo")}>Cargo <span className="mm-arr">→</span> vessels</button>
        <button className={mode === "vessel" ? "is-on" : ""} onClick={() => setMode("vessel")}>Vessels <span className="mm-arr">→</span> cargo</button>
      </div>
    </div>
  );
}

function DashMatchCard({ m, mode }: { m: DashMatch; mode: "cargo" | "vessel" }) {
  const cargo = {
    main: <><span className="dm-name">{m.commodity}</span><span className="dm-sep">·</span><span className="dm-fig">{m.qtyMt} MT</span></>,
    sub: <><span className="dm-route">{m.pol} → {m.pod}</span><span className="dm-zone">{m.polZone}→{m.podZone}</span></>,
  };
  const vessel = {
    main: <><span className="dm-name">{m.vessel}</span><span className="dm-sep">·</span><span className="dm-fig">{m.dwt} DWT</span></>,
    sub: <><span className="dm-class">{m.vClass}</span><span className="dm-zone">{m.vOpen}</span></>,
  };
  const anchor = mode === "cargo" ? cargo : vessel;
  const matched = mode === "cargo" ? vessel : cargo;
  const badge = m.quality === "Strong" ? "in" : m.quality === "Good" ? "blue" : "review";
  return (
    <div className="dash-match">
      <div className="dash-match__top">
        <div className="dm-main">{anchor.main}</div>
        <span className={`asb-badge ${badge}`}>{m.quality}</span>
      </div>
      <div className="dm-sub">{anchor.sub}</div>
      <div className="dm-link"><span className="dm-link__lbl">matched with</span></div>
      <div className="dm-main dm-main--match">{matched.main}</div>
      <div className="dm-sub">{matched.sub}</div>
      <div className="dash-match__econ">
        <span>Laycan {m.laycan != null ? `${m.laycan}d` : "—"}</span>
        <span className="dm-sep">·</span>
        <span>TCE <span className="dm-tce">{fmtTce(m.tce)}</span></span>
      </div>
    </div>
  );
}

// Leaflet is browser-only → load the map client-side, never on the server.
const MarketMap = dynamic(() => import("./MarketMap"), {
  ssr: false,
  loading: () => <MapPlaceholder label="Loading map…" />,
});

function SourcePill({ source }: { source?: "live" | "sample" }) {
  if (!source) return null;
  const live = source === "live";
  return (
    <span
      className="asb-badge"
      title={live ? "Connected to Supabase" : "Supabase not configured — showing sample data"}
      style={{
        background: live ? "var(--asb-green-bg)" : "var(--asb-amber-bg)",
        color: live ? "var(--asb-green)" : "var(--asb-amber)",
        borderColor: "transparent",
      }}
    >
      {live ? "● Live data" : "Sample data"}
    </span>
  );
}

function useEscClear(set: (v: null) => void) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && set(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [set]);
}

function MapPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        borderRadius: 4,
        border: "var(--bd)",
        overflow: "hidden",
        background: "var(--map-ocean)",
        position: "relative",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontSize: 10, marginTop: 4, color: "rgba(255,255,255,0.35)" }}>
          Leaflet zones · vessels · routes — next phase
        </div>
      </div>
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
export function DashboardBoard({
  cargos,
  vessels,
  source,
  portCoords,
}: {
  cargos: CargoView[];
  vessels: VesselView[];
  source?: "live" | "sample";
  portCoords?: Record<string, [number, number]>;
}) {
  const [mode, setMode] = React.useState<"cargo" | "vessel">("cargo");
  const [focusedCargo, setFocusedCargo] = React.useState<string | null>(null);
  const [focusedVessel, setFocusedVessel] = React.useState<string | null>(null);

  // Filter state (zones pre-selected as a live example, matching the design).
  const [fZones, setFZones] = React.useState<string[]>(["E.MED", "R.SEA"]);
  const [fCargoType, setFCargoType] = React.useState<string[]>([]);
  const [fVesselType, setFVesselType] = React.useState<string[]>([]);
  const [fClass, setFClass] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [fGear, setFGear] = React.useState("any");

  const ZONE_OPTS = React.useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...cargos.flatMap((c) => [c.route?.polZone, c.route?.podZone]),
            ...vessels.map((v) => v.openPortZone),
          ].filter(Boolean) as string[],
        ),
      ),
    [cargos, vessels],
  );
  const CARGO_TYPE_OPTS = React.useMemo(() => Array.from(new Set(cargos.map((c) => c.type).filter(Boolean))), [cargos]);
  const VESSEL_TYPE_OPTS = React.useMemo(() => Array.from(new Set(vessels.map((v) => v.type).filter(Boolean))), [vessels]);

  const filteredCargos = React.useMemo(
    () =>
      cargos.filter((c) => {
        if (fCargoType.length && !fCargoType.includes(c.type)) return false;
        if (fZones.length) {
          const z = [c.route?.polZone, c.route?.podZone];
          if (!z.some((x) => x && fZones.includes(x))) return false;
        }
        if (fClass.length) {
          const tags = cargoClassTags(c);
          if (!tags.some((t) => fClass.includes(t))) return false;
        }
        if (fSize) {
          const q = toMt(c.qtyMt);
          if (fSize.min != null && q < fSize.min) return false;
          if (fSize.max != null && q > fSize.max) return false;
        }
        if (fTime != null && !(c.laycanDays != null && c.laycanDays <= fTime)) return false;
        return true;
      }),
    [cargos, fCargoType, fZones, fClass, fSize, fTime],
  );
  const filteredVessels = React.useMemo(
    () =>
      vessels.filter((v) => {
        if (fVesselType.length && !fVesselType.includes(v.type)) return false;
        if (fZones.length && !fZones.includes(v.openPortZone)) return false;
        if (fClass.length) {
          const tags = vesselClassTags(v);
          if (!tags.some((t) => fClass.includes(t))) return false;
        }
        if (fSize) {
          const d = toMt(v.dwt);
          if (fSize.min != null && d < fSize.min) return false;
          if (fSize.max != null && d > fSize.max) return false;
        }
        if (fTime != null && !(v.openDateDays != null && v.openDateDays <= fTime)) return false;
        if (fGear === "geared" && !v.geared) return false;
        if (fGear === "gearless" && v.geared) return false;
        return true;
      }),
    [vessels, fVesselType, fZones, fClass, fSize, fTime, fGear],
  );

  const topMatches = React.useMemo(
    () => buildTopMatches(filteredCargos, filteredVessels, (v) => vesselClassTags(v)[0] || v.type),
    [filteredCargos, filteredVessels],
  );

  const focus = {
    cargo: (c: CargoView) => {
      setFocusedCargo((id) => (id === c.id ? null : c.id));
      setFocusedVessel(null);
    },
    vessel: (v: VesselView) => {
      setFocusedVessel((id) => (id === v.id ? null : v.id));
      setFocusedCargo(null);
    },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BunkerTicker />
      <DashboardTierBanner />
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <div className="eyebrow" style={{ marginTop: 2 }}>
              Arabian Gulf · Red Sea · East Med · Black Sea, Today
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <SourcePill source={source} />
            <button className="asb-btn ghost" title="Alerts" aria-label="Alerts" style={{ padding: "5px 8px", position: "relative" }}>
              <IconBell size={15} />
              <span style={{ position: "absolute", top: 3, right: 5, width: 6, height: 6, borderRadius: 99, background: "var(--asb-red)" }} />
            </button>
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <FilterMenu label="Zones" badge={fZones.length || null} active={fZones.length > 0} width={150}>
          <CheckList options={ZONE_OPTS} value={fZones} onChange={setFZones} onClear={() => setFZones([])} />
        </FilterMenu>
        <FilterMenu label="Cargo Type" badge={fCargoType.length || null} active={fCargoType.length > 0} width={170}>
          <CheckList options={CARGO_TYPE_OPTS} value={fCargoType} onChange={setFCargoType} onClear={() => setFCargoType([])} />
        </FilterMenu>
        <FilterMenu label="Vessel Type" badge={fVesselType.length || null} active={fVesselType.length > 0} width={180}>
          <CheckList options={VESSEL_TYPE_OPTS} value={fVesselType} onChange={setFVesselType} onClear={() => setFVesselType([])} />
        </FilterMenu>
        <FilterMenu label="DWT / Quantity" summary={rangeSummary(fSize)} active={!!fSize} width={220}>
          <RangeMenu value={fSize} onChange={setFSize} />
        </FilterMenu>
        <FilterMenu label="Time window" summary={fTime ? `${fTime}d` : null} active={fTime != null} width={210}>
          <TimeMenu value={fTime} onChange={setFTime} />
        </FilterMenu>
        <FilterMenu label="Classification" badge={fClass.length || null} active={fClass.length > 0} width={170}>
          <CheckList options={CLASS_OPTS} value={fClass} onChange={setFClass} onClear={() => setFClass([])} />
        </FilterMenu>
        <FilterMenu label="Gear" summary={fGear !== "any" ? (fGear === "geared" ? "Geared" : "Gearless") : null} active={fGear !== "any"} width={150}>
          <div className="fm-list">
            {(([["any", "Any gear"], ["geared", "Geared"], ["gearless", "Gearless"]]) as [string, string][]).map(([v, l]) => (
              <button key={v} className={`fm-opt ${fGear === v ? "is-on" : ""}`} onClick={() => setFGear(v)}>
                <span className="fm-check">{fGear === v ? "✓" : ""}</span><span className="fm-opt__lbl">{l}</span>
              </button>
            ))}
          </div>
        </FilterMenu>
        <span className="count">↗ {filteredCargos.length} cargo · {filteredVessels.length} tonnage</span>
      </div>

      {/* Body: panels left + map right (new design order) */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12, padding: 12, minHeight: 0, overflow: "hidden" }}>
        <div className="dash-right" style={{ overflow: "auto", paddingRight: 4 }}>
          <DashboardPanel<CargoView>
            kind="cargo"
            title="Cargo positions"
            data={filteredCargos}
            statDefs={[
              { id: "active", label: "Active", variant: "active", filter: () => true },
              { id: "urgent", label: "Urgent", variant: "urgent", filter: (c) => c.laycanDays != null && c.laycanDays < 3 },
            ]}
            focusedId={focusedCargo}
            onSelect={focus.cargo}
          />
          <DashboardPanel<VesselView>
            kind="vessel"
            title="Open tonnage"
            data={filteredVessels}
            statDefs={[
              { id: "open", label: "Open", variant: "active", filter: (v) => v.status === "open" },
              { id: "overdue", label: "Overdue", variant: "urgent", filter: (v) => v.openDateUrgency === "red" || (v.openDateDays != null && v.openDateDays < 0) },
            ]}
            focusedId={focusedVessel}
            onSelect={focus.vessel}
          />
          <DashboardPanel
            kind="matches"
            title="Top matches"
            headerAccessory={<MatchModeSwitch mode={mode} setMode={setMode} />}
          >
            {topMatches.length === 0 ? (
              <div className="dash-empty">No matches in the current filter.</div>
            ) : (
              topMatches.map((m, i) => <DashMatchCard key={i} m={m} mode={mode} />)
            )}
          </DashboardPanel>
        </div>
        <div style={{ minHeight: 0, borderRadius: 4, overflow: "hidden", border: "var(--bd)" }}>
          <MarketMap
            cargos={filteredCargos}
            vessels={filteredVessels}
            portCoords={portCoords}
            focusedCargoId={focusedCargo}
            focusedVesselId={focusedVessel}
            onSelectCargo={focus.cargo}
            onSelectVessel={focus.vessel}
          />
        </div>
      </div>
    </div>
  );
}

// ── CARGO BOARD (Cargo Market + My Cargo) ─────────────────────────────────

// ── My Cargo (workspace) ─────────────────────────────────────────────────────
// Cards + Show/Hide map; the right slot holds the MAP when open, otherwise the
// cargo detail panel when a card is selected (never both) — per PageMyCargo.
export function CargoBoard({
  views,
  source,
  postHref,
  portCoords,
}: {
  views: CargoView[];
  variant?: "market" | "my";
  source?: "live" | "sample";
  postHref?: string;
  portCoords?: Record<string, [number, number]>;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [mapOpen, setMapOpen] = React.useState(false);
  useEscClear(setSelectedId);

  const [fZones, setFZones] = React.useState<string[]>([]);
  const [fType, setFType] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [fStatus, setFStatus] = React.useState<string[]>([]);

  const ZONE_OPTS = React.useMemo(() => Array.from(new Set(views.flatMap((c) => [c.route?.polZone, c.route?.podZone]).filter(Boolean) as string[])), [views]);
  const TYPE_OPTS = React.useMemo(() => Array.from(new Set(views.map((c) => c.type).filter(Boolean))), [views]);
  const STATUS_OPTS = ["IN", "PARTIAL", "OUT"];

  const filtered = React.useMemo(() => views.filter((c) => {
    if (fZones.length) { const z = [c.route?.polZone, c.route?.podZone]; if (!z.some((x) => x && fZones.includes(x))) return false; }
    if (fType.length && !fType.includes(c.type)) return false;
    if (fSize) { const q = toMt(c.qtyMt); if (fSize.min != null && q < fSize.min) return false; if (fSize.max != null && q > fSize.max) return false; }
    if (fTime != null && !(c.laycanDays != null && c.laycanDays <= fTime)) return false;
    if (fStatus.length && !fStatus.includes(c.scope.toUpperCase())) return false;
    return true;
  }), [views, fZones, fType, fSize, fTime, fStatus]);

  const selected = filtered.find((c) => c.id === selectedId);
  const cols = mapOpen
    ? "repeat(auto-fill, minmax(230px, 1fr))"
    : selectedId
      ? "repeat(auto-fill, minmax(280px, 1fr))"
      : "repeat(auto-fill, minmax(330px, 1fr))";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} onClick={() => setSelectedId(null)}>
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <h1 className="page-title">My Cargo</h1>
          <div className="row" style={{ gap: 8 }}>
            <SourcePill source={source} />
            <span style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{filtered.length} cargo positions</span>
            {postHref && (
              <Link className="asb-btn primary" href={postHref}><IconPlus size={12} color="#fff" /> Post Cargo</Link>
            )}
          </div>
        </div>
      </div>

      <div className="filter-bar" onClick={(e) => e.stopPropagation()}>
        <button className={`asb-chip ${mapOpen ? "is-active" : ""}`} onClick={() => setMapOpen((o) => !o)}>
          <IconMap size={12} /> {mapOpen ? "Hide map" : "Show map"}
        </button>
        <span className="divider" />
        <FilterMenu label="Zone" badge={fZones.length || null} active={fZones.length > 0} width={150}>
          <CheckList options={ZONE_OPTS} value={fZones} onChange={setFZones} onClear={() => setFZones([])} />
        </FilterMenu>
        <FilterMenu label="Cargo type" badge={fType.length || null} active={fType.length > 0} width={170}>
          <CheckList options={TYPE_OPTS} value={fType} onChange={setFType} onClear={() => setFType([])} />
        </FilterMenu>
        <FilterMenu label="Quantity" summary={rangeSummary(fSize)} active={!!fSize} width={220}>
          <RangeMenu value={fSize} onChange={setFSize} />
        </FilterMenu>
        <FilterMenu label="Laycan" summary={fTime ? `${fTime}d` : null} active={fTime != null} width={210}>
          <TimeMenu value={fTime} onChange={setFTime} />
        </FilterMenu>
        <FilterMenu label="Status" badge={fStatus.length || null} active={fStatus.length > 0} width={140}>
          <CheckList options={STATUS_OPTS} value={fStatus} onChange={setFStatus} onClear={() => setFStatus([])} />
        </FilterMenu>
        <span className="count">↗ {filtered.length} listed</span>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 16, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, transition: "grid-template-columns var(--t-base)" }}>
            {filtered.map((c) => (
              <CargoCard key={c.id} data={c} selected={selectedId === c.id} onSelect={(id) => setSelectedId((s) => (s === id ? null : id))} />
            ))}
          </div>
        </div>
        {mapOpen ? (
          <div style={{ width: "58%", flexShrink: 0, borderLeft: "var(--bd)", position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <MarketMap cargos={filtered} vessels={[]} portCoords={portCoords} focusedCargoId={selected?.id ?? null} onSelectCargo={(c) => setSelectedId((s) => (s === c.id ? null : c.id))} />
          </div>
        ) : selectedId ? (
          <div style={{ flex: "0 0 40%", overflow: "hidden", borderLeft: "var(--bd)" }} onClick={(e) => e.stopPropagation()}>
            {selected && <CargoDetailPanel cargo={selected} onClose={() => setSelectedId(null)} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── My Vessels (workspace) ───────────────────────────────────────────────────
export function VesselBoard({
  views,
  source,
  postHref,
  portCoords,
}: {
  views: VesselView[];
  variant?: "market" | "my";
  source?: "live" | "sample";
  postHref?: string;
  portCoords?: Record<string, [number, number]>;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [mapOpen, setMapOpen] = React.useState(false);
  useEscClear(setSelectedId);

  const [fZones, setFZones] = React.useState<string[]>([]);
  const [fType, setFType] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [fGear, setFGear] = React.useState("any");

  const ZONE_OPTS = React.useMemo(() => Array.from(new Set(views.map((v) => v.openPortZone).filter(Boolean))), [views]);
  const TYPE_OPTS = React.useMemo(() => Array.from(new Set(views.map((v) => v.type).filter(Boolean))), [views]);

  const filtered = React.useMemo(() => views.filter((v) => {
    if (fZones.length && !fZones.includes(v.openPortZone)) return false;
    if (fType.length && !fType.includes(v.type)) return false;
    if (fSize) { const d = toMt(v.dwt); if (fSize.min != null && d < fSize.min) return false; if (fSize.max != null && d > fSize.max) return false; }
    if (fTime != null && !(v.openDateDays != null && v.openDateDays <= fTime)) return false;
    if (fGear === "geared" && !v.geared) return false;
    if (fGear === "gearless" && v.geared) return false;
    return true;
  }), [views, fZones, fType, fSize, fTime, fGear]);

  const selected = filtered.find((v) => v.id === selectedId);
  const cols = mapOpen
    ? "repeat(auto-fill, minmax(300px, 1fr))"
    : selectedId
      ? "1fr"
      : "repeat(auto-fill, minmax(420px, 1fr))";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} onClick={() => setSelectedId(null)}>
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <h1 className="page-title">My Vessels</h1>
          <div className="row" style={{ gap: 8 }}>
            <SourcePill source={source} />
            <span style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{filtered.length} vessel{filtered.length === 1 ? "" : "s"}</span>
            {postHref && (
              <Link className="asb-btn primary" href={postHref}><IconPlus size={12} color="#fff" /> Post Position</Link>
            )}
          </div>
        </div>
      </div>

      <div className="filter-bar" onClick={(e) => e.stopPropagation()}>
        <button className={`asb-chip ${mapOpen ? "is-active" : ""}`} onClick={() => setMapOpen((o) => !o)}>
          <IconMap size={12} /> {mapOpen ? "Hide map" : "Show map"}
        </button>
        <span className="divider" />
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
        <span className="count">↗ {filtered.length} listed</span>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 16, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14, transition: "grid-template-columns var(--t-base)" }}>
            {filtered.map((v) => (
              <VesselCard key={v.id} data={v} selected={selectedId === v.id} onSelect={(id) => setSelectedId((s) => (s === id ? null : id))} />
            ))}
          </div>
        </div>
        {mapOpen ? (
          <div style={{ width: "55%", flexShrink: 0, borderLeft: "var(--bd)", position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <MarketMap cargos={[]} vessels={filtered} portCoords={portCoords} focusedVesselId={selected?.id ?? null} onSelectVessel={(v) => setSelectedId((s) => (s === v.id ? null : v.id))} />
          </div>
        ) : selectedId ? (
          <div style={{ flex: "0 0 42%", overflow: "hidden", borderLeft: "var(--bd)" }} onClick={(e) => e.stopPropagation()}>
            {selected && <VesselDetailPanel vessel={selected} onClose={() => setSelectedId(null)} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}
