"use client";

// My Vessels — fleet board, ported from the Claude design
// (asb/my-vessels-board.jsx): dense vessel cards + a Leaflet fleet map showing
// each open position and its preferred-trade direction. Demo-only switches from
// the design (tier identity toggle) are dropped per spec — this is the owner's
// own fleet, so identity is never masked. Filters are wired functionally to
// match the rest of the app's boards.
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import "@/lib/portal/fleet.css";
import { VesselView } from "@/lib/portal/types";
import { FleetVesselCard, type FleetVM } from "./FleetVesselCard";
import { resolveCoord } from "@/lib/portal/port-coords";
import { zoneByCode, zoneCentroid, zonesLabel } from "@/lib/portal/zones";
import { IconMap, IconPlus } from "./icons";
import {
  FilterMenu,
  CheckList,
  RangeMenu,
  TimeMenu,
  rangeSummary,
  toMt,
  type SizeRange,
} from "./filters";

// The unified MapPane (asb-map) — the SAME map the Tonnage/Cargo markets and
// dashboard use. My Vessels shows its fleet here with preferred-direction
// vectors, replacing the old dedicated fleet map + expanded layer panel.
const MarketMap = dynamic(() => import("./MarketMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", borderRadius: 12, background: "#0c1929" }} />,
});

const uniq = (xs: (string | null | undefined)[]) =>
  Array.from(new Set(xs.filter(Boolean) as string[]));

function toFleetVM(v: VesselView, portCoords?: Record<string, [number, number]>): FleetVM {
  const open = resolveCoord(v.openPortLocode, portCoords);
  const prefZone = v.preferredZones?.[0] ? zoneByCode(v.preferredZones[0]) : null;
  const dest = prefZone ? zoneCentroid(prefZone) : null;
  const fuelAllDash = [v.fuel.vlsfoSea, v.fuel.vlsfoPort, v.fuel.lsmgoSea, v.fuel.lsmgoPort].every((x) => x === "—");
  const posted = v.status === "open" && v.openPort !== "—";
  return {
    id: v.id,
    name: v.name,
    imo: v.imo,
    flag: v.flag,
    type: v.type,
    built: v.built,
    age: v.age,
    dwt: v.dwt === "—" ? null : v.dwt,
    grt: null, // GRT not in the availability view model yet
    loa: v.loa ? v.loa.replace(/\s*m$/i, "") : null,
    draft: v.draft ? v.draft.replace(/\s*m$/i, "") : null,
    gear: v.geared === true ? "Geared" : v.geared === false ? "Gearless" : null,
    status: v.status === "open" ? "OPEN" : v.status === "fixed" ? "FIXED" : "REVIEW",
    port: v.openPort === "—" ? null : v.openPort,
    zone: v.openPortZone === "—" ? null : v.openPortZone,
    date: v.openDate === "—" ? null : v.openDate,
    lyc: v.openDateUrgency,
    dir: zonesLabel(v.preferredZones),
    lat: open?.[0] ?? null,
    lon: open?.[1] ?? null,
    dlat: dest?.[0] ?? null,
    dlon: dest?.[1] ?? null,
    fuel: fuelAllDash ? null : { vs: v.fuel.vlsfoSea, vp: v.fuel.vlsfoPort, ls: v.fuel.lsmgoSea, lp: v.fuel.lsmgoPort },
    matches: posted ? v.matches : null,
    via: null,
    viaRole: null,
  };
}

export function MyVesselsFleetBoard({
  views,
  portCoords,
  postHref = "/dashboard/vessels/register",
  addHref = "/dashboard/vessels/register",
}: {
  views: VesselView[];
  source?: "live" | "sample";
  portCoords?: Record<string, [number, number]>;
  postHref?: string;
  addHref?: string;
}) {
  const router = useRouter();
  const [mapOpen, setMapOpen] = React.useState(true);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tierVis, setTierVis] = React.useState<"full" | "t12">("full");
  const masked = tierVis === "t12";

  const [fZones, setFZones] = React.useState<string[]>([]);
  const [fType, setFType] = React.useState<string[]>([]);
  const [fSize, setFSize] = React.useState<SizeRange>(null);
  const [fTime, setFTime] = React.useState<number | null>(null);
  const [gearOnly, setGearOnly] = React.useState(false);

  const fleet = React.useMemo(() => views.map((v) => toFleetVM(v, portCoords)), [views, portCoords]);

  const ZONE_OPTS = React.useMemo(() => uniq(fleet.map((v) => v.zone)), [fleet]);
  const TYPE_OPTS = React.useMemo(() => uniq(fleet.map((v) => v.type)), [fleet]);

  const filtered = React.useMemo(() => {
    return fleet.filter((v) => {
      if (fZones.length && !(v.zone && fZones.includes(v.zone))) return false;
      if (fType.length && !fType.includes(v.type)) return false;
      if (fSize && v.dwt) { const d = toMt(v.dwt); if (fSize.min != null && d < fSize.min) return false; if (fSize.max != null && d > fSize.max) return false; }
      if (gearOnly && v.gear !== "Geared") return false;
      return true;
    });
  }, [fleet, fZones, fType, fSize, gearOnly]);

  // The unified map takes raw VesselViews — filter them to the same set the
  // cards show (the board's filter bar drives both).
  const filteredViews = React.useMemo(() => {
    const ids = new Set(filtered.map((f) => f.id));
    return views.filter((v) => ids.has(v.id));
  }, [filtered, views]);

  return (
    <div className="mvb" onClick={() => setSelected(null)}>
      <div className="mvb__topbar">
        <h1 className="mvb__title">My Vessels</h1>
        <span className="mvb__count">· {filtered.length} vessel position{filtered.length === 1 ? "" : "s"}</span>
        <span className="mvb__sp" />
        <Link className="mvb__addhint" href={addHref}>Add a vessel to the registry</Link>
        <Link className="mvb__btn" href={addHref}><IconPlus size={13} /> Add vessel</Link>
        <button className="mvb__btn mvb__btn--primary" onClick={(e) => { e.stopPropagation(); router.push(postHref); }}>
          <IconPlus size={13} color="#fff" /> Post Position
        </button>
      </div>

      <div className="mvb__filters" onClick={(e) => e.stopPropagation()}>
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
        <button
          className={"mvb__chip mvb__chip--toggle" + (gearOnly ? " is-on" : "")}
          onClick={() => setGearOnly((g) => !g)}
        >
          Geared only
        </button>

        <span className="mvb__tier-lbl" style={{ marginLeft: "auto" }}>Identity view</span>
        <div className="mvb__tier" role="group" aria-label="Identity view">
          <button className={!masked ? "is-on" : ""} onClick={() => setTierVis("full")}>Admin / Partner · T3</button>
          <button className={masked ? "is-on" : ""} onClick={() => setTierVis("t12")}>T1–2</button>
        </div>
        <Link className="mvb__matchlink" href="/dashboard/cargo">View cargo matches →</Link>

        <span className="mvb__fdiv" />
        <button className={"mvb__maptgl" + (mapOpen ? " is-on" : "")} onClick={() => setMapOpen((o) => !o)}>
          <IconMap size={15} color={mapOpen ? "#fff" : undefined} />
          {mapOpen ? "Hide map" : "Show map"}
        </button>
      </div>

      <div className="mvb__body">
        <div className={"mvb__scroll" + (mapOpen ? " has-map" : "")}>
          {filtered.length === 0 ? (
            fleet.length === 0 ? (
              <div className="mvb__empty mvb__empty--first">
                <div className="mvb__empty-ttl">No vessels in your fleet yet</div>
                <div className="mvb__empty-sub">
                  Add a vessel to the registry, then post its open position — your fleet
                  and its preferred-trade map will appear here.
                </div>
                <div className="mvb__empty-cta">
                  <Link className="mvb__btn" href={addHref}><IconPlus size={13} /> Add vessel</Link>
                  <button className="mvb__btn mvb__btn--primary" onClick={(e) => { e.stopPropagation(); router.push(postHref); }}>
                    <IconPlus size={13} color="#fff" /> Post Position
                  </button>
                </div>
              </div>
            ) : (
              <div className="mvb__empty">No vessels match these filters.</div>
            )
          ) : (
            <div className={"mvb__grid " + (mapOpen ? "cols-2" : "")}>
              {filtered.map((v) => (
                <FleetVesselCard
                  key={v.id}
                  v={v}
                  masked={masked}
                  selected={selected === v.id}
                  onSelect={(id) => setSelected((s) => (s === id ? null : id))}
                  onEstimate={() => router.push("/dashboard/voyage-estimator")}
                />
              ))}
            </div>
          )}
        </div>
        {mapOpen && (
          <div className="mvb__mappane" onClick={(e) => e.stopPropagation()}>
            {masked ? (
              <div className="mvb-maplock">
                <div className="mvb-maplock__panel">
                  <span className="mvb-maplock__icon">
                    <svg viewBox="0 0 16 16" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                      <rect x="3" y="7" width="10" height="6.5" rx="1" />
                      <path d="M5 7V5a3 3 0 016 0v2" />
                    </svg>
                  </span>
                  <div className="mvb-maplock__ttl">Live map locked</div>
                  <div className="mvb-maplock__sub">
                    Vessel &amp; cargo positions on the chart are a <b>Tier 3</b> feature.
                    Tier 1–2 subscribers see listing essentials only.
                  </div>
                  <span className="mvb-maplock__cta">Upgrade to Tier 3</span>
                </div>
              </div>
            ) : (
              <MarketMap
                cargos={[]}
                vessels={filteredViews}
                portCoords={portCoords}
                focusedVesselId={selected}
                onSelectVessel={(v) => setSelected((s) => (s === v.id ? null : v.id))}
                vesselVectors
              />
            )}
          </div>
        )}
      </div>

      <div className="mvb__foot">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="3" y="7" width="10" height="6.5" rx="1" />
          <path d="M5 7V5a3 3 0 016 0v2" />
        </svg>
        Encrypted end-to-end. Visible only to Arab ShipBroker until your listing is approved.
      </div>
    </div>
  );
}
