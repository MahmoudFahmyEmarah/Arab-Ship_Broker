"use client";

// Sliding detail panels for cargo + vessel, ported from the Claude design
// (asb/detail-panel.jsx). Real values from the view models; "—" where the
// source row has no value (no invented data). Rules-engine tooltips deferred.
import { routeLegs } from "@/lib/portal/route-legs";
import * as React from "react";
import Link from "next/link";
import { CargoView, VesselView, VesselOwnershipView } from "@/lib/portal/types";
import { MatchVesselView, MatchCargoView } from "@/lib/portal/match-views";
import { fetchCargoMatches, fetchAvailabilityMatches, fetchVesselOwnership } from "@/lib/portal/actions";
import { FieldRow } from "./ui";
import { IconBack, IconClose } from "./icons";

const dash = (v: React.ReactNode) =>
  v === null || v === undefined || v === "" || v === "—" ? "—" : v;

const num = (n: number | null | undefined) => (n != null ? n.toLocaleString() : "—");

// ── Live match lists (fetched on open via server actions) ──────────────────
function useMatches<T>(
  listingKey: string | null,
  load: (key: string) => Promise<T[]>,
) {
  const [result, setResult] = React.useState<{
    key: string | null;
    list: T[] | null;
  }>({ key: listingKey, list: null });
  React.useEffect(() => {
    let alive = true;
    if (!listingKey) {
      setResult({ key: null, list: [] });
      return () => {
        alive = false;
      };
    }
    setResult({ key: listingKey, list: null });
    load(listingKey)
      .then((list) => alive && setResult({ key: listingKey, list }))
      .catch(() => alive && setResult({ key: listingKey, list: [] }));
    return () => {
      alive = false;
    };
  }, [listingKey, load]);
  return result.key === listingKey ? result.list : null;
}

function CargoMatchList({ listingKey }: { listingKey: string | null }) {
  const list = useMatches<MatchVesselView>(listingKey, fetchCargoMatches);
  if (list === null) return <div className="pm-loading">Loading matches…</div>;
  if (!list.length) return <div className="pm-empty">No vessel matches yet.</div>;
  return (
    <div className="pm-list">
      {list.map((v) => (
        <div key={v.id} className="pm-row" style={{ ["--strip" as string]: v.rateAligned ? "#97C459" : "#B6BFCC" }}>
          <div className="pm-row__top">
            <span className="pm-row__name">{v.name}</span>
            {v.freight != null && <span className="pm-row__freight">${v.freight}/MT</span>}
          </div>
          <div className="pm-row__meta">
            {v.type} · {num(v.dwt)} DWT · {v.geared ? "Geared" : "Gearless"}
          </div>
          <div className="pm-row__sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>{v.openPort} · {v.openZone}{v.openDate ? ` · ${v.openDate}` : ""}</span>
            {v.rateAligned && <span className="pm-aligned">Rate aligned</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function VesselMatchList({ listingKey }: { listingKey: string | null }) {
  const list = useMatches<MatchCargoView>(listingKey, fetchAvailabilityMatches);
  if (list === null) return <div className="pm-loading">Loading matches…</div>;
  if (!list.length) return <div className="pm-empty">No cargo matches yet.</div>;
  return (
    <div className="pm-list">
      {list.map((c) => (
        <div key={c.id} className="pm-row" style={{ ["--strip" as string]: c.rateAligned ? "#97C459" : "#B6BFCC" }}>
          <div className="pm-row__top">
            <span className="pm-row__name">{c.commodity}</span>
            {c.freight != null && <span className="pm-row__freight">${c.freight}/MT</span>}
          </div>
          <div className="pm-row__meta">
            <span className="pm-row__route">{c.loadPort} → {c.dischPort}</span> · {num(c.qtyMin)}
            {c.qtyMax !== c.qtyMin ? `–${num(c.qtyMax)}` : ""} MT
          </div>
          <div className="pm-row__sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>{c.isSpot ? "SPOT" : c.laycanFrom && c.laycanTo ? `${c.laycanFrom} – ${c.laycanTo}` : "—"} · {c.loadZone} → {c.dischZone}</span>
            {c.rateAligned && <span className="pm-aligned">Rate aligned</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PortRange({ label, ports }: { label: string; ports: { locode: string; name: string; zone: string; status: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--asb-gray-400)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {ports.map((p, i) => (
          <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{i + 1}. {p.name} <span style={{ color: "var(--asb-gray-400)" }}>({p.locode}{p.zone ? ` · ${p.zone}` : ""})</span></span>
            <span style={{ fontSize: 10, color: "var(--asb-gray-500)" }}>{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CargoDetailPanel({ cargo, onClose }: { cargo: CargoView; onClose: () => void }) {
  const legs = routeLegs(cargo);
  const typeLabel = cargo.type === "Dry Bulk" ? "DRY BULK" : cargo.type === "Break Bulk" ? "BREAK BULK" : cargo.type.toUpperCase();
  return (
    <div className="detail-panel">
      <header>
        <div className="row-sb" style={{ marginBottom: 4 }}>
          <button className="back" onClick={onClose}>
            <IconBack size={14} /> {cargo.cargo} ·{" "}
            <span className="mono" style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>{cargo.refId}</span>
          </button>
          <div className="row" style={{ gap: 4 }}>
            {cargo.canManage && cargo.ownedListingId ? (
              <Link className="asb-btn primary" href={`/dashboard/cargo/${cargo.ownedListingId}/edit`} style={{ textDecoration: "none" }}>Full edit →</Link>
            ) : null}
            <button className="asb-btn ghost" onClick={onClose} style={{ padding: "5px 8px" }}>
              <IconClose size={14} />
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {/* IN/OUT/PARTIAL status is internal guidance only — not shown to members. */}
          <span className="asb-badge neutral">{typeLabel}</span>
          {cargo.spot ? (
            <span className="asb-badge neutral">SPOT</span>
          ) : (
            <span className="asb-badge neutral">IMSBC {cargo.imsbcGroup}</span>
          )}
        </div>
      </header>

      <div className="body">
        <div className="section">
          <h4>Route</h4>
          <div className="grid-2">
            <FieldRow label={legs.pol.kind === "alt" ? "Load port (alternatives)" : legs.pol.kind === "area" ? "Load area" : "Load port"} value={`${legs.pol.label}${legs.pol.code ? ` · ${legs.pol.code}` : legs.pol.refCode ? ` · est. ${legs.pol.refName} (${legs.pol.refCode})` : ""}`} />
            <FieldRow label={legs.pod.kind === "alt" ? "Discharge port (alternatives)" : legs.pod.kind === "area" ? "Discharge area" : "Discharge port"} value={`${legs.pod.label}${legs.pod.code ? ` · ${legs.pod.code}` : legs.pod.refCode ? ` · est. ${legs.pod.refName} (${legs.pod.refCode})` : ""}`} />
            <FieldRow label="Zone direction" value={`${cargo.route.polZone} → ${cargo.route.podZone}`} />
          </div>
          {((cargo.loadPorts?.length ?? 0) > 1 || (cargo.dischPorts?.length ?? 0) > 1) && (
            <div className="grid-2" style={{ marginTop: 8 }}>
              {(cargo.loadPorts?.length ?? 0) > 1 && (
                <PortRange label="Load range (POL)" ports={cargo.loadPorts!} />
              )}
              {(cargo.dischPorts?.length ?? 0) > 1 && (
                <PortRange label="Disch range (POD)" ports={cargo.dischPorts!} />
              )}
            </div>
          )}
        </div>

        <div className="section">
          <h4>Specifications</h4>
          <div className="grid-2">
            <FieldRow label="Commodity" value={cargo.commodity} />
            <FieldRow label="IMSBC group" value={`Group ${cargo.imsbcGroup}`} />
            <FieldRow label="Quantity" value={`${cargo.qtyMt} MT`} />
            <FieldRow label="Volume (auto)" value={cargo.vol !== "—" ? `${cargo.vol} CBM` : "—"} />
            <FieldRow label="Stowage SF" value={cargo.sf != null ? `${cargo.sf} m³/t` : "—"} />
          </div>
        </div>

        <div className="section">
          <h4>Commercial terms</h4>
          <div className="grid-2">
            <FieldRow label="Laycan from" value={dash(cargo.laycanFrom)} />
            <FieldRow label="Laycan to" value={dash(cargo.laycanTo)} />
            <FieldRow label="Load terms" value={dash(cargo.loadTerms)} />
            <FieldRow label="Load rate" value={cargo.loadRate != null ? `${cargo.loadRate.toLocaleString()} MT/d` : "—"} />
            <FieldRow label="Discharge rate" value={cargo.dischRate != null ? `${cargo.dischRate.toLocaleString()} MT/d` : "—"} />
            <FieldRow label="Freight idea" value={cargo.freightIdea != null ? `$${cargo.freightIdea}/MT` : "—"} valueClass="blue" />
            <FieldRow label="Commission" value={cargo.commission != null ? `${cargo.commission}%` : "—"} />
            <FieldRow label="Demurrage" value={cargo.demurrage != null ? `$${cargo.demurrage.toLocaleString()}/d` : "—"} />
          </div>
        </div>

        <div className="section">
          <h4>Vessel requirements</h4>
          <div className="grid-2">
            <FieldRow label="Geared" value={cargo.requiresGeared == null ? "—" : cargo.requiresGeared ? "Required" : "Shore gear OK"} />
            <FieldRow label="Max age" value={cargo.maxAge != null ? `${cargo.maxAge} yrs` : "—"} />
            <FieldRow label="Max LOA" value={cargo.maxLoa != null ? `${cargo.maxLoa} m` : "—"} />
            <FieldRow label="Max draft" value={cargo.maxDraft != null ? `${cargo.maxDraft} m` : "—"} />
            <FieldRow label="Grain certified" value={cargo.isGrain ? "Required" : "Not required"} />
            <FieldRow label="DG certified" value={cargo.isDg ? "Required" : "Not required"} />
          </div>
        </div>

        <div className="section">
          <h4>Matches</h4>
          <MatchBox count={cargo.matches} label="vessel matches found" sub="via Arab ShipBroker review" />
          <CargoMatchList listingKey={cargo.listingKey ?? null} />
        </div>

        <div className="section">
          <h4>Posted by</h4>
          <div className="grid-2">
            <FieldRow label="Company" value={cargo.poster?.company ?? "Arab ShipBroker"} />
            <FieldRow label="Contact" value={cargo.poster?.name ?? "Platform brokered"} />
          </div>
        </div>

        <FixtureRoomLink
          href={cargo.canManage && cargo.ownedListingId
            ? `/dashboard/fixture-room/new?cargo=${encodeURIComponent(cargo.ownedListingId)}`
            : "/dashboard/fixture-room/new"}
        />
        <EstimateVoyageLink
          href={cargo.listingKey
            ? `/dashboard/voyage-estimator?cargo=${encodeURIComponent(cargo.listingKey)}`
            : "/dashboard/voyage-estimator"}
        />

        <PrivacyNote text="Your data is encrypted end-to-end. Visible only to Arab ShipBroker until your listing is approved." />
      </div>
    </div>
  );
}

export function VesselDetailPanel({ vessel, onClose }: { vessel: VesselView; onClose: () => void }) {
  const v = vessel;
  return (
    <div className="detail-panel">
      <header>
        <div className="row-sb" style={{ marginBottom: 4 }}>
          <button className="back" onClick={onClose}>
            <IconBack size={14} /> {v.name} ·{" "}
            <span className="mono" style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>IMO {v.imo}</span>
          </button>
          <div className="row" style={{ gap: 4 }}>
            {v.canManage && v.vesselId ? (
              <Link className="asb-btn primary" href={`/dashboard/vessels/${v.vesselId}`} style={{ textDecoration: "none" }}>Edit vessel →</Link>
            ) : null}
            <button className="asb-btn ghost" onClick={onClose} style={{ padding: "5px 8px" }}>
              <IconClose size={14} />
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className={`asb-badge ${v.status === "open" ? "open" : v.status === "review" ? "review" : "fixed"}`}>{v.status.toUpperCase()}</span>
          <span className="asb-badge neutral">{v.type}</span>
          <span className="asb-badge neutral">{v.flag}</span>
          {v.built && <span className="asb-badge neutral">Built {v.built} ({v.age} yrs)</span>}
        </div>
      </header>

      <div className="body">
        <div className="section">
          <h4>Vessel particulars</h4>
          <div className="grid-2">
            <FieldRow label="DWT Grain" value={`${v.dwt} MT`} valueClass="blue" />
            <FieldRow label="DWT Bale" value={v.dwtBale ? `${v.dwtBale} MT` : "—"} />
            <FieldRow label="Grain cap." value={v.grainCap !== "—" ? `${v.grainCap} m³` : "—"} />
            <FieldRow label="LOA" value={dash(v.loa)} />
            <FieldRow label="Beam" value={dash(v.beam)} />
            <FieldRow label="Draft (Summer)" value={dash(v.draft)} />
            <FieldRow label="Flag" value={v.flag} />
          </div>
        </div>

        <div className="section">
          <h4>Certifications &amp; equipment</h4>
          <div className="grid-2">
            <FieldRow label="Geared" value={v.geared == null ? "—" : v.geared ? "Geared" : "Gearless"} />
            <FieldRow label="Grain certified" value={v.grainCertified == null ? "—" : v.grainCertified ? "Yes" : "No"} />
            <FieldRow label="DG certified" value={v.dgCertified == null ? "—" : v.dgCertified ? "Yes" : "No"} />
            <FieldRow label="Preferred zones" value={v.preferredZones?.length ? v.preferredZones.join(" · ") : "—"} />
          </div>
        </div>

        <div className="section">
          <h4>Open position</h4>
          <div style={{ background: "var(--asb-white)", border: "0.5px solid var(--asb-gray-200)", borderRadius: "var(--r-chip)", padding: 10 }}>
            <div className="row-sb" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>
                {v.openPort} <span style={{ color: "var(--asb-gray-500)" }}>· {v.openPortZone}</span>
              </span>
              <span className={`asb-badge ${v.status === "open" ? "open" : "review"}`}>{v.status.toUpperCase()}</span>
            </div>
            <div className="grid-2">
              <FieldRow label="Open date" value={dash(v.openDate)} />
              <FieldRow label="Date flex" value={v.openDateRangeDays != null ? `± ${v.openDateRangeDays} days` : "—"} />
              <FieldRow label="Last cargo" value={dash(v.lastCargo)} />
              <FieldRow label="Part cargo" value={v.acceptsPartCargo == null ? "—" : v.acceptsPartCargo ? "Accepts" : "No"} />
            </div>
          </div>
        </div>

        <div className="section">
          <h4>Speed &amp; fuel consumption</h4>
          <div className="grid-2">
            <FieldRow label="Service speed" value={v.serviceSpeed != null ? `${v.serviceSpeed} kts` : "—"} />
            <FieldRow label="Fuel type (main)" value={dash(v.fuelType)} />
            <FieldRow label="M/E · Sea" value={v.fuel.vlsfoSea !== "—" ? `${v.fuel.vlsfoSea} MT/d` : "—"} />
            <FieldRow label="M/E · Port" value={v.fuel.vlsfoPort !== "—" ? `${v.fuel.vlsfoPort} MT/d` : "—"} />
            <FieldRow label="Aux · Sea" value={v.fuel.lsmgoSea !== "—" ? `${v.fuel.lsmgoSea} MT/d` : "—"} />
            <FieldRow label="Aux · Port" value={v.fuel.lsmgoPort !== "—" ? `${v.fuel.lsmgoPort} MT/d` : "—"} />
          </div>
        </div>

        <div className="section">
          <h4>Matches</h4>
          <MatchBox count={v.matches} label="cargo matches available" sub={`in ${v.openPortZone} and adjacent zones`} />
          <VesselMatchList listingKey={v.listingKey ?? null} />
        </div>

        <VesselOwnership listingKey={v.listingKey ?? null} />

        <FixtureRoomLink
          href={v.canManage && v.ownedListingId
            ? `/dashboard/fixture-room/new?vessel=${encodeURIComponent(v.ownedListingId)}`
            : "/dashboard/fixture-room/new"}
        />
        <EstimateVoyageLink
          href={v.listingKey
            ? `/dashboard/voyage-estimator?vessel=${encodeURIComponent(v.listingKey)}`
            : "/dashboard/voyage-estimator"}
        />

        <PrivacyNote text="Your vessel data is encrypted. Visible only to Arab ShipBroker until you publish a position." />
      </div>
    </div>
  );
}

// Ownership / commercial management — real company link from the firewalled
// The governed detail RPC returns ownership only to admin or the exact owner;
// a market viewer receives the masked brokered state.
function VesselOwnership({ listingKey }: { listingKey: string | null }) {
  const [data, setData] = React.useState<VesselOwnershipView | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    if (!listingKey) {
      setData(null);
      return;
    }
    fetchVesselOwnership(listingKey)
      .then((r) => alive && setData(r))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [listingKey]);

  if (data === undefined) {
    return (
      <div className="section">
        <h4>Ownership &amp; commercial management</h4>
        <div className="pm-loading">Loading…</div>
      </div>
    );
  }

  // Not entitled (market viewer) or no link yet → masked / brokered state.
  if (!data || !data.entitled) {
    return (
      <div className="section">
        <h4>Ownership &amp; commercial management</h4>
        <div style={{ padding: "10px 12px", background: "var(--asb-gray-50)", borderRadius: 3, fontSize: 11, color: "var(--asb-gray-500)", lineHeight: 1.5 }}>
          🔒 Owner identity protected — brokered by Arab ShipBroker. Contact details are released only through the desk.
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <h4>Ownership &amp; commercial management</h4>
      <div className="grid-2">
        <FieldRow label="Registered owner" value={dash(data.ownerName)} />
        <FieldRow label="Owner IMO" value={dash(data.ownerImo)} />
        <FieldRow label="Owner country" value={dash(data.ownerCountry)} />
        <FieldRow label="Fleet (owner)" value={data.ownerFleet != null ? String(data.ownerFleet) : "—"} />
        <FieldRow label="Commercial manager" value={dash(data.managerName)} />
        <FieldRow label="Fleet (manager)" value={data.managerFleet != null ? String(data.managerFleet) : "—"} />
        <FieldRow label="Desk" value={dash(data.ownerDesk ?? data.managerDesk)} />
      </div>
    </div>
  );
}

function MatchBox({ count, label, sub }: { count: number; label: string; sub: string }) {
  return (
    <div style={{ background: "var(--asb-blue-light)", border: "0.5px solid var(--asb-blue)", borderRadius: "var(--r-chip)", padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 20, fontWeight: 500, color: "var(--asb-blue)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--asb-navy)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--asb-gray-500)" }}>{sub}</div>
      </div>
      <a style={{ fontSize: 11, color: "var(--asb-blue)", cursor: "pointer" }}>View matches →</a>
    </div>
  );
}

function EstimateVoyageLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, padding: "10px 12px", background: "var(--asb-blue-light)", border: "0.5px solid var(--asb-blue)", borderRadius: "var(--r-chip, 4px)", color: "var(--asb-blue)", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
    >
      Estimate voyage →
    </a>
  );
}

function FixtureRoomLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, padding: "10px 12px", background: "var(--asb-white)", border: "0.5px solid var(--asb-blue)", borderRadius: "var(--r-chip, 4px)", color: "var(--asb-blue)", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
    >
      Start Fixture Room →
    </a>
  );
}

function PrivacyNote({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 16, padding: "10px 12px", background: "var(--asb-gray-50)", borderRadius: 3, fontSize: 10, color: "var(--asb-gray-500)", lineHeight: 1.5 }}>
      🔒 {text}
    </div>
  );
}
