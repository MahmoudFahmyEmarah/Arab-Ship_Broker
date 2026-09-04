"use client";

// Dashboard panels + dense rows, ported from the Claude design
// (asb/pages.jsx: DashboardPanel, DashCargoRow, DashVesselRow).
import * as React from "react";
import { CargoView, VesselView } from "@/lib/portal/types";
import { postedAgeLabel } from "@/lib/portal/useMarketVisibility";
import { flagCode } from "@/lib/portal/flags";
import "flag-icons/css/flag-icons.min.css";

// Human tooltip for the posted-age tag ("Posted 3 days ago")
function postedTooltip(postedAt: string | null | undefined, futureDate?: string | null): string {
  const l = postedAgeLabel(postedAt);
  if (!l) return "";
  const base = l === "<1d" ? "Posted today" : "Posted " + l.replace("d", " day(s)") + " ago";
  const f = futureDate ? Date.parse(futureDate) : NaN;
  const ahead = Number.isFinite(f) && f >= new Date().setHours(0, 0, 0, 0);
  return ahead ? base + " — stays listed while its laycan/open date is still ahead" : base;
}
import {
  formatQtyVol,
  formatLaycanRange,
  cargoTypeLabel,
  formatShortDate,
} from "@/lib/portal/format";
import { IconCaret } from "./icons";
import { PosterLine } from "./PosterLine";

// Route label cascade (owner's rule): LOCODE → port name → zone. A listing
// from a circular may carry only "Egypt Med" or "Reni or Izmail" — that text
// is more useful than a bare zone, and a zone is more useful than a dash.
function routeLeg(code: string | null | undefined, name: string | null | undefined, zone: string | null | undefined): { label: string; level: "code" | "name" | "zone" | "none" } {
  if (code) return { label: code, level: "code" };
  if (name && name.trim()) return { label: name.trim(), level: "name" };
  if (zone && zone.trim()) return { label: zone.trim(), level: "zone" };
  return { label: "—", level: "none" };
}

// ── Dense list row · CARGO ────────────────────────────────────────────────
// Line 1  commodity · type · (age)
// Line 2  POL → POD · zones · laycan · qty / vol · terms · freight idea
// Line 3  who posted it (member + company, or the circular's sender)
export function DashCargoRow({
  c,
  focused,
  onClick,
}: {
  c: CargoView;
  focused?: boolean;
  onClick?: () => void;
}) {
  const { weight } = formatQtyVol(c);
  const laycanStr = formatLaycanRange(c.laycanFrom, c.laycanTo);
  const typeLabel = cargoTypeLabel(c);
  const pol = routeLeg(c.route.polCode, c.route.polName, c.route.polZone);
  const pod = routeLeg(c.route.podCode, c.route.podName, c.route.podZone);
  // Zones ride along unless both legs already fell back to the zone itself.
  const showZones = !(pol.level === "zone" && pod.level === "zone") && (c.route.polZone || c.route.podZone);
  const hasVol = c.vol && c.vol !== "—";
  const routeTitle = [
    c.route.polName && c.route.polCode ? `${c.route.polName} (${c.route.polCode})` : c.route.polName || c.route.polCode,
    c.route.podName && c.route.podCode ? `${c.route.podName} (${c.route.podCode})` : c.route.podName || c.route.podCode,
  ].filter(Boolean).join(" → ");
  return (
    <div className={`dash-row strip-${c.scope}${focused ? " is-focused" : ""}`} onClick={onClick}>
      {c.matches > 0 && <span className="dash-row__badge" title={`${c.matches} vessel ${c.matches === 1 ? "match" : "matches"} for this cargo`}>{c.matches}</span>}
      {postedAgeLabel(c.postedAt) && (
        <span className="dash-row__age mono" title={postedTooltip(c.postedAt, c.laycanTo || null)}>{postedAgeLabel(c.postedAt)}</span>
      )}
      <div className="dash-row__r1 is-left">
        <span className="dash-row__name">{c.cargo}</span>
        <span className="asb-badge tiny cargo-type" title="Cargo category">{typeLabel}</span>
      </div>
      <div className="dash-row__r3">
        <span className={`dash-row__route ${pol.level === "code" && pod.level === "code" ? "mono" : ""}`} title={routeTitle || "Load → discharge"}>
          <strong>{pol.label}</strong> → <strong>{pod.label}</strong>
        </span>
        {showZones && (
          <span className="dash-row__zones" title="Trading zones: load → discharge">
            {c.route.polZone || "—"} → {c.route.podZone || "—"}
          </span>
        )}
        <span className="dash-row__sep">·</span>
        {c.spot ? <span className="cc-spot" title="Spot: no fixed laycan — loads as soon as fixed">SPOT</span> : <span className="dash-row__lay" title="Laycan">{laycanStr}</span>}
        <span className="dash-row__sep">·</span>
        <span className="dash-row__qty" title={hasVol ? "Quantity / volume" : "Quantity"}>
          {weight}
          {hasVol && <span className="dash-row__vol">{" / "}{c.vol} {c.volUnit ?? "m³"}</span>}
        </span>
        {c.loadTerms && (
          <>
            <span className="dash-row__sep">·</span>
            <span title="Load / discharge terms">{c.loadTerms}</span>
          </>
        )}
        {c.freightIdea != null && (
          <>
            <span className="dash-row__sep">·</span>
            <span className="dash-row__rate" title="Freight idea per MT (commission %)">
              ${c.freightIdea}/MT{c.commission != null ? ` · ${c.commission}%` : ""}
            </span>
          </>
        )}
      </div>
      <PosterLine poster={c.poster} className="dash-row__poster" />
    </div>
  );
}

// ── Dense list row · VESSEL ──────────────────────────────────────────────
// Line 1  name · status · matches · flag · (age)
// Line 2  type · DWT · gear · open port (→ zone) · open date
// Line 3  who posted it
export function DashVesselRow({
  v,
  focused,
  onClick,
}: {
  v: VesselView;
  focused?: boolean;
  onClick?: () => void;
}) {
  const urg = v.openDateUrgency || "green";
  const fc = flagCode(v.flag);
  const flagName = v.flag && v.flag !== "—" ? v.flag : null;
  const open = routeLeg(null, v.openPort !== "—" ? v.openPort : null, v.openPortZone !== "—" ? v.openPortZone : null);
  const showZone = open.level !== "zone" && v.openPortZone && v.openPortZone !== "—";
  return (
    <div className={`dash-row dash-row--inline${focused ? " is-focused" : ""}`} onClick={onClick}>
      <div className="dash-row__r1 is-left">
        <span className="dash-row__name">{v.name}</span>
        <span className={`asb-badge ${v.status === "open" ? "open" : v.status === "review" ? "review" : "fixed"}`} title="Position status">
          {v.status.toUpperCase()}
        </span>
        {v.matches > 0 && (
          <span className="dash-row__badge is-inline" title={`${v.matches} cargo ${v.matches === 1 ? "match" : "matches"} for this vessel`}>
            {v.matches}
          </span>
        )}
        {flagName && (
          <span className="dash-row__flag" title={`Flag state: ${flagName}`}>
            {fc && <span className={`fi fi-${fc}`} aria-hidden />}
            <span className="dash-row__flag-name">{flagName}</span>
          </span>
        )}
      </div>
      {postedAgeLabel(v.postedAt) && (
        <span
          className="dash-row__age mono"
          title={postedTooltip(v.postedAt, v.openDate !== "—" ? v.openDate : null)}
        >
          {postedAgeLabel(v.postedAt)}
        </span>
      )}
      <div className="dash-row__r3">
        <span title="Vessel type">{v.type}</span>
        <span className="dash-row__sep">·</span>
        <strong title="Deadweight">{v.dwt} DWT</strong>
        <span className="dash-row__sep">·</span>
        <span title="Cargo gear on board">{v.geared ? "Geared" : "Gearless"}</span>
        <span className="dash-row__sep">·</span>
        <span className={`asb-dot ${urg} ${urg === "red" ? "pulse" : ""}`} title={urg === "red" ? "Open date overdue / imminent" : urg === "amber" ? "Opens within days" : "Opens later"} />
        <strong title="Open position">{open.label}</strong>
        {showZone && <span className="dash-row__zones" title="Trading zone of the open position">{v.openPortZone}</span>}
        <span className="dash-row__sep">·</span>
        <span title="Open date">{formatShortDate(v.openDate)}</span>
      </div>
      <PosterLine poster={v.poster} className="dash-row__poster" />
    </div>
  );
}

// ── Generic dashboard panel ──────────────────────────────────────────────
interface StatDef<T> {
  id: string;
  label: string;
  variant: string;
  filter: (x: T) => boolean;
}

export function DashboardPanel<T extends { id: string }>({
  kind,
  title,
  data,
  statDefs,
  focusedId,
  onSelect,
  defaultOpen = true,
  hint,
  headerAccessory,
  children,
}: {
  kind: "cargo" | "vessel" | "matches";
  title: string;
  data?: T[];
  statDefs?: StatDef<T>[];
  focusedId?: string | null;
  onSelect?: (item: T) => void;
  defaultOpen?: boolean;
  /** kept for callers; the panels are list-only now (grid view retired) */
  defaultView?: "list" | "card";
  /** plain-language explanation shown when hovering the panel title */
  hint?: string;
  headerAccessory?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [filterId, setFilterId] = React.useState<string | null>(null);

  const isDataPanel = Array.isArray(data) && Array.isArray(statDefs);
  const counts = isDataPanel
    ? Object.fromEntries(statDefs!.map((s) => [s.id, data!.filter(s.filter).length]))
    : {};
  const activeStat = isDataPanel ? statDefs!.find((s) => s.id === filterId) || null : null;
  const filtered = isDataPanel ? (activeStat ? data!.filter(activeStat.filter) : data!) : [];

  const setFilter = (id: string) => {
    if (!statDefs) return;
    if (id === statDefs[0].id) {
      setFilterId(null);
      return;
    }
    setFilterId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="asb-panel dash-panel">
      <div className={`panel-head${headerAccessory ? " has-acc" : ""}`}>
        <span className="grip">⠿</span>
        <span className="title" title={hint}>{title}</span>
        {headerAccessory && <div className="panel-head__acc">{headerAccessory}</div>}
        {isDataPanel && (
          <span className="asb-match" style={{ padding: "1px 7px", fontSize: 12 }}>
            {filtered.length}
          </span>
        )}
        <div className="actions">
          <button className="icon-btn" onClick={() => setOpen((o) => !o)} title={open ? "Collapse this panel" : "Expand this panel"} aria-label={open ? "Collapse" : "Expand"}>
            <IconCaret size={11} direction={open ? "down" : "right"} />
          </button>
        </div>
      </div>

      {open && (
        <div className="panel-body">
          {!isDataPanel && children}
          {isDataPanel && (
          <>
          {/* Stat-tile band suppressed for cargo/vessel panels (09 §2) — counts
              live in the header badge and on the rows instead. */}
          {kind !== "cargo" && kind !== "vessel" && (
          <div className="mini-stats dash-stats">
            {(statDefs ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                className={`tile ${s.variant}${filterId === s.id || (s.id === statDefs[0].id && !filterId) ? " is-active" : ""}`}
                onClick={() => setFilter(s.id)}
              >
                <div className="n">{counts[s.id]}</div>
                <div className="l">{s.label}</div>
              </button>
            ))}
          </div>
          )}

          {activeStat && (
            <div className="dash-filter-banner">
              <span>
                Showing: <strong>{activeStat.label}</strong>
              </span>
              <button type="button" onClick={() => setFilterId(null)}>
                ✕ Clear filter
              </button>
            </div>
          )}

          <div className="dash-scroll dash-scroll--list">
            {filtered.length === 0 && <div className="dash-empty">No items match this filter.</div>}
            {filtered.map((item) =>
                kind === "cargo" ? (
                  <DashCargoRow
                    key={item.id}
                    c={item as unknown as CargoView}
                    focused={focusedId === item.id}
                    onClick={() => onSelect?.(item)}
                  />
                ) : (
                  <DashVesselRow
                    key={item.id}
                    v={item as unknown as VesselView}
                    focused={focusedId === item.id}
                    onClick={() => onSelect?.(item)}
                  />
                ),
              )}
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
