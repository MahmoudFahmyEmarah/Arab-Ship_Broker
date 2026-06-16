"use client";

// Dashboard panels + dense rows, ported from the Claude design
// (asb/pages.jsx: DashboardPanel, DashCargoRow, DashVesselRow).
import * as React from "react";
import { CargoView, VesselView } from "@/lib/portal/types";
import {
  formatQtyVol,
  formatLaycanRange,
  cargoTypeLabel,
} from "@/lib/portal/format";
import { IconCaret } from "./icons";
import { CargoCard } from "./CargoCard";
import { VesselCard } from "./VesselCard";

// ── Dense list row · CARGO ────────────────────────────────────────────────
export function DashCargoRow({
  c,
  focused,
  onClick,
}: {
  c: CargoView;
  focused?: boolean;
  onClick?: () => void;
}) {
  const { weight, volume, sfMissing } = formatQtyVol(c);
  const laycanStr = formatLaycanRange(c.laycanFrom, c.laycanTo);
  const typeLabel = cargoTypeLabel(c);
  return (
    <div className={`dash-row strip-${c.scope}${focused ? " is-focused" : ""}`} onClick={onClick}>
      {c.matches > 0 && <span className="dash-row__badge">{c.matches}</span>}
      <div className="dash-row__r1">
        <span className="dash-row__name">{c.cargo}</span>
        <span className="dash-row__ref mono">{c.refId}</span>
      </div>
      <div className="dash-row__r2">
        {/* IN/OUT/PARTIAL status is internal guidance only — not shown to members. */}
        <span className="asb-badge tiny cargo-type">{typeLabel}</span>
      </div>
      <div className="dash-row__r3">
        <span className="dash-row__route mono">
          <strong>{c.route.polCode}</strong> → <strong>{c.route.podCode}</strong>
        </span>
        <span className="dash-row__zones">
          {c.route.polZone} → {c.route.podZone}
        </span>
        <span className="dash-row__sep">·</span>
        {c.spot ? <span className="cc-spot">SPOT</span> : <span className="dash-row__lay">{laycanStr}</span>}
        <span className="dash-row__sep">·</span>
        <span className="dash-row__qty">
          {weight}
          <span className="dash-row__vol" style={sfMissing ? { color: "#8B95A3" } : undefined}>
            {" / "}
            {volume.replace(/^max /, "")}
          </span>
        </span>
        {c.loadTerms && (
          <>
            <span className="dash-row__sep">·</span>
            <span>{c.loadTerms}</span>
          </>
        )}
        {c.freightIdea != null && (
          <>
            <span className="dash-row__sep">·</span>
            <span className="dash-row__rate">
              ${c.freightIdea}/MT{c.commission != null ? ` · ${c.commission}%` : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Dense list row · VESSEL ──────────────────────────────────────────────
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
  return (
    <div className={`dash-row dash-row--inline${focused ? " is-focused" : ""}`} onClick={onClick}>
      {/* Status + match count sit LEFT-aligned right after the name (09 §2). */}
      <div className="dash-row__r1 is-left">
        <span className="dash-row__name">{v.name}</span>
        <span className={`asb-badge ${v.status === "open" ? "open" : v.status === "review" ? "review" : "fixed"}`}>
          {v.status.toUpperCase()}
        </span>
        {v.matches > 0 && (
          <span className="dash-row__badge is-inline" title={`${v.matches} cargo ${v.matches === 1 ? "match" : "matches"} for this vessel`}>
            {v.matches}
          </span>
        )}
      </div>
      <div className="dash-row__r2">
        {v.type} · <strong>{v.dwt} DWT</strong> · {v.geared ? "Geared" : "Gearless"}
      </div>
      <div className="dash-row__r3">
        <span className={`asb-dot ${urg} ${urg === "red" ? "pulse" : ""}`} />
        <strong>{v.openPort}</strong>
        <span className="dash-row__sep">·</span>
        <span>{v.openDate}</span>
        <span className="dash-row__sep">·</span>
        <span>M/E {v.fuel.vlsfoSea} MT/d</span>
      </div>
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
  headerAccessory?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [view, setView] = React.useState<"list" | "card">("list");
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
        <span className="title">{title}</span>
        {headerAccessory && <div className="panel-head__acc">{headerAccessory}</div>}
        {isDataPanel && (
          <span className="asb-match" style={{ padding: "1px 7px", fontSize: 12 }}>
            {filtered.length}
          </span>
        )}
        <div className="actions">
          {isDataPanel && (
          <div className="dash-view-toggle">
            <button type="button" className={view === "list" ? "is-on" : ""} onClick={() => setView("list")} aria-label="List view">
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <line x1="3" y1="4" x2="11" y2="4" />
                <line x1="3" y1="7" x2="11" y2="7" />
                <line x1="3" y1="10" x2="11" y2="10" />
              </svg>
            </button>
            <button type="button" className={view === "card" ? "is-on" : ""} onClick={() => setView("card")} aria-label="Card view">
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="3" y="3" width="3.5" height="3.5" rx="0.5" />
                <rect x="7.5" y="3" width="3.5" height="3.5" rx="0.5" />
                <rect x="3" y="7.5" width="3.5" height="3.5" rx="0.5" />
                <rect x="7.5" y="7.5" width="3.5" height="3.5" rx="0.5" />
              </svg>
            </button>
          </div>
          )}
          <button className="icon-btn" onClick={() => setOpen((o) => !o)}>
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

          <div className={`dash-scroll dash-scroll--${view}`}>
            {filtered.length === 0 && <div className="dash-empty">No items match this filter.</div>}
            {view === "list" &&
              filtered.map((item) =>
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
            {view === "card" && (
              <div className="dash-card-grid">
                {filtered.map((item) =>
                  kind === "cargo" ? (
                    <CargoCard
                      key={item.id}
                      data={item as unknown as CargoView}
                      selected={focusedId === item.id}
                      onSelect={() => onSelect?.(item)}
                    />
                  ) : (
                    <VesselCard
                      key={item.id}
                      data={item as unknown as VesselView}
                      compact
                      selected={focusedId === item.id}
                      onSelect={() => onSelect?.(item)}
                    />
                  ),
                )}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
