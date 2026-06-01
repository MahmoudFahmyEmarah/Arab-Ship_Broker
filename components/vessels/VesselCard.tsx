"use client";

import Link from "next/link";

/**
 * Canonical vessel card — the My Vessels board card, extracted as the single
 * shared component used everywhere a vessel is shown (My Vessels, Tonnage
 * Market, detail panels). Markup + classes ported verbatim from the Claude
 * Design package (asb/my-vessels-board.css `.mvb-vcard`).
 *
 * FIREWALL: this component renders NO contact fields. Counterparty identity
 * is a single optional `via` company alias (manager/owner company name only —
 * never email/phone/person). When `masked` is true the alias is hidden behind
 * the "Identity available to Tier 3 & Partner" line, matching the DB firewall.
 */
export interface VesselCardData {
  imo: string;
  name: string;
  flag: string | null;
  type: string;
  built: number | null;
  /** Pre-formatted (e.g. "10,074") or null when not yet declared. */
  dwt: string | null;
  grt: string | null;
  loa: string | null;
  draft: string | null;
  gear: string | null;
  status: "OPEN" | "REVIEW";
  fuel?: { vs: string | null; vp: string | null; ls: string | null; lp: string | null } | null;
  matches?: number | null;
  /** Open position; null = not yet declared. */
  position?: {
    port: string;
    zone: string | null;
    date: string;
    lyc: "green" | "amber" | "red";
  } | null;
  /** Preferred trading direction, e.g. "Med / Cont". */
  dir?: string | null;
  /** Company alias only (manager/owner company) — never personal contact. */
  via?: { name: string; role?: string } | null;
  /** Detail-page href for "View details". */
  href?: string;
}

const dash = (v: string | null | undefined) => (v == null || v === "" ? "—" : v);

export function VesselCard({
  vessel,
  masked = false,
  selected = false,
  onSelect,
}: {
  vessel: VesselCardData;
  masked?: boolean;
  selected?: boolean;
  onSelect?: (imo: string) => void;
}) {
  const v = vessel;
  const age = v.built != null ? `${v.built} · ${new Date().getFullYear() - v.built} yrs` : "—";
  const posted = v.status === "OPEN" && v.position != null;

  return (
    <article
      className={`mvb-vcard${selected ? " is-selected" : ""}`}
      onClick={onSelect ? () => onSelect(v.imo) : undefined}
    >
      <div className="mvb-vc__hd">
        <span className="mvb-vc__name">{v.name}</span>
        <span className={`mvb-chip-st ${v.status.toLowerCase()}`}>{v.status}</span>
      </div>

      <div className="mvb-vc__id">
        <span className="mono">IMO {v.imo}</span>
        <span className="sep">·</span>
        <span>{dash(v.flag)}</span>
        <span className="sep">·</span>
        <span>{v.type}</span>
      </div>

      {/* DWT + GRT split — DWT dominant */}
      <div className="mvb-vc__figs">
        <div className="mvb-fig mvb-fig--dwt">
          <div className="fglbl">DWT (mt)</div>
          {v.dwt ? (
            <div className="fgval">{v.dwt}</div>
          ) : (
            <div className="fgval tbc">not yet set / updated</div>
          )}
        </div>
        <div className="mvb-fig mvb-fig--grt">
          <div className="fglbl">GRT</div>
          {v.grt ? <div className="fgval">{v.grt}</div> : <div className="fgval tbc-sm">—</div>}
        </div>
      </div>

      <div className="mvb-vc__specs">
        <div className="mvb-spec"><div className="sk">Built</div><div className={`sv${age === "—" ? " dim" : ""}`}>{age}</div></div>
        <div className="mvb-spec"><div className="sk">LOA (m)</div><div className={`sv${v.loa ? "" : " dim"}`}>{dash(v.loa)}</div></div>
        <div className="mvb-spec"><div className="sk">Draft (m)</div><div className={`sv${v.draft ? "" : " dim"}`}>{dash(v.draft)}</div></div>
        <div className="mvb-spec"><div className="sk">Gear</div><div className={`sv${v.gear ? "" : " dim"}`}>{dash(v.gear)}</div></div>
      </div>

      {v.fuel && (
        <div className="mvb-vc__fuel">
          <div className="fh" title="Daily fuel burn — VLSFO (main engine) and LSMGO (aux), at sea and in port">Fuel consumption · MT/day</div>
          <div className="mvb-fuelgrid">
            <div className="mvb-fcell"><div className="fk">VLSFO sea</div><div className="fv">{dash(v.fuel.vs)}</div></div>
            <div className="mvb-fcell"><div className="fk">VLSFO port</div><div className="fv">{dash(v.fuel.vp)}</div></div>
            <div className="mvb-fcell"><div className="fk">LSMGO sea</div><div className="fv">{dash(v.fuel.ls)}</div></div>
            <div className="mvb-fcell"><div className="fk">LSMGO port</div><div className="fv">{dash(v.fuel.lp)}</div></div>
          </div>
        </div>
      )}

      <div className="mvb-vc__ft">
        <span className="imo">IMO {v.imo}</span>
        {v.matches != null ? (
          <span className="mvb-matches" title="Cargoes proposed by the matching engine">{v.matches} matches</span>
        ) : (
          <span className="mvb-matches none">No position yet</span>
        )}
        <span className="sp" />
        <span className="mvb-vlink">Estimate voyage</span>
        {v.href ? (
          <Link className="mvb-vlink strong" href={v.href} onClick={(e) => e.stopPropagation()}>
            View details
          </Link>
        ) : (
          <span className="mvb-vlink strong">View details</span>
        )}
      </div>

      {/* Position bar — pinned to bottom, above the via line */}
      <div className="mvb-vc__pos">
        <div className="posbar-eyebrow">Position</div>
        {posted && v.position ? (
          <>
            <div className="row1">
              <span className="port">{v.position.port}</span>
              {v.position.zone && <span className="zone">{v.position.zone}</span>}
              <span className="date">
                <span className={`mvb-lyc ${v.position.lyc}`} />
                {v.position.date}
              </span>
            </div>
            {v.dir && (
              <div className="dir">
                Preferred direction: <b>{v.dir}</b>
              </div>
            )}
          </>
        ) : (
          <div className="row1">
            <span className="undecl">Open position, not yet declared</span>
            <span className="optflag" style={{ marginLeft: "auto" }}>owner&apos;s option</span>
          </div>
        )}
      </div>

      {masked ? (
        <div className="mvb-vc__via masked">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="3" y="7" width="10" height="6.5" rx="1" />
            <path d="M5 7V5a3 3 0 016 0v2" />
          </svg>
          Identity available to Tier 3 &amp; Partner
        </div>
      ) : v.via ? (
        <div className="mvb-vc__via">
          via <b>{v.via.name}</b>
          {v.via.role && <span style={{ opacity: 0.7 }}> ({v.via.role})</span>}
        </div>
      ) : null}
    </article>
  );
}
