"use client";

// FleetVesselCard — the dense "mvb-vcard" from the Claude design
// (asb/my-vessels-board.jsx): DWT/GRT split, spec grid, fuel grid, a position
// bar pinned to the card bottom, hover tooltips, and an optional firewall-masked
// identity line. Rendered by the My Vessels fleet board.
import * as React from "react";

export interface FleetVM {
  id: string;
  name: string;
  imo: string;
  flag: string;
  type: string;
  built: number | null;
  age: number | null;
  dwt: string | null;
  grt: string | null;
  loa: string | null;
  draft: string | null;
  gear: string | null;
  status: "OPEN" | "REVIEW" | "FIXED";
  port: string | null;
  zone: string | null;
  date: string | null;
  lyc: "red" | "amber" | "green" | null;
  dir: string | null;
  lat: number | null;
  lon: number | null;
  dlat: number | null;
  dlon: number | null;
  fuel: { vs: number | string; vp: number | string; ls: number | string; lp: number | string } | null;
  matches: number | null;
  via: string | null;
  viaRole: string | null;
}

const TIP = {
  dwt: "Deadweight tonnage: the total weight (cargo, fuel, stores and crew) a vessel can carry. The reference figure used for matching.",
  grt: "Gross Registered Tonnage: the vessel's total enclosed volume (basis for port dues and canal tolls). A volume measure, not a weight.",
  vs: "VLSFO at sea: Very Low Sulphur Fuel Oil burned while steaming, in metric tonnes per day.",
  vp: "VLSFO in port: main-engine or boiler fuel burned alongside, MT per day.",
  ls: "LSMGO at sea: Low Sulphur Marine Gas Oil for auxiliaries while steaming, MT per day.",
  lp: "LSMGO in port: gas oil for manoeuvring and port stay, MT per day.",
  dot: "Open-date urgency. Green: more than 7 days out · amber: within 7 days · red: open date already passed.",
};

function Tip({ children, text, plain }: { children: React.ReactNode; text: string; plain?: boolean }) {
  return (
    <span className={"mvb-tip" + (plain ? " mvb-tip--plain" : "")} tabIndex={0}>
      {children}
      <span className="mvb-tip__bub">{text}</span>
    </span>
  );
}

function Spec({ k, v }: { k: string; v: string | null }) {
  const dim = v == null || v === "—";
  return (
    <div className="mvb-spec">
      <div className="sk">{k}</div>
      <div className={"sv" + (dim ? " dim" : "")}>{dim ? "—" : v}</div>
    </div>
  );
}

const YEAR = new Date().getFullYear();

export function FleetVesselCard({
  v,
  masked,
  selected,
  onSelect,
  onEstimate,
}: {
  v: FleetVM;
  masked?: boolean;
  selected?: boolean;
  onSelect: (id: string) => void;
  onEstimate?: (id: string) => void;
}) {
  const age = v.built ? `${v.built} · ${YEAR - v.built} yrs` : "—";
  const posted = v.status === "OPEN" && !!v.port;

  return (
    <article
      className={"mvb-vcard" + (selected ? " is-selected" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(v.id);
      }}
    >
      <div className="mvb-vc__hd">
        <span className="mvb-vc__name">{v.name}</span>
        <span className={"mvb-chip-st " + v.status.toLowerCase()}>{v.status}</span>
      </div>

      <div className="mvb-vc__id">
        <span className="mono">IMO {v.imo}</span>
        <span className="sep">·</span>
        <span>{v.flag}</span>
        <span className="sep">·</span>
        <span>{v.type}</span>
      </div>

      <div className="mvb-vc__figs">
        <div className="mvb-fig mvb-fig--dwt">
          <div className="fglbl"><Tip text={TIP.dwt}>DWT (mt)</Tip></div>
          {v.dwt ? <div className="fgval">{v.dwt}</div> : <div className="fgval tbc">not yet set / updated</div>}
        </div>
        <div className="mvb-fig mvb-fig--grt">
          <div className="fglbl"><Tip text={TIP.grt}>GRT</Tip></div>
          {v.grt ? <div className="fgval">{v.grt}</div> : <div className="fgval tbc-sm">—</div>}
        </div>
      </div>

      <div className="mvb-vc__specs">
        <Spec k="Built" v={age} />
        <Spec k="LOA (m)" v={v.loa} />
        <Spec k="Draft (m)" v={v.draft} />
        <Spec k="Gear" v={v.gear} />
      </div>

      {v.fuel && (
        <div className="mvb-vc__fuel">
          <div className="fh">Fuel consumption · MT/day</div>
          <div className="mvb-fuelgrid">
            <div className="mvb-fcell"><div className="fk"><Tip text={TIP.vs}>VLSFO sea</Tip></div><div className="fv">{v.fuel.vs}</div></div>
            <div className="mvb-fcell"><div className="fk"><Tip text={TIP.vp}>VLSFO port</Tip></div><div className="fv">{v.fuel.vp}</div></div>
            <div className="mvb-fcell"><div className="fk"><Tip text={TIP.ls}>LSMGO sea</Tip></div><div className="fv">{v.fuel.ls}</div></div>
            <div className="mvb-fcell"><div className="fk"><Tip text={TIP.lp}>LSMGO port</Tip></div><div className="fv">{v.fuel.lp}</div></div>
          </div>
        </div>
      )}

      <div className="mvb-vc__ft">
        <span className="imo">IMO {v.imo}</span>
        {v.matches != null ? (
          <span className="mvb-matches">{v.matches} matches</span>
        ) : (
          <span className="mvb-matches none">No position yet</span>
        )}
        <span className="sp" />
        <button className="mvb-vlink" onClick={(e) => { e.stopPropagation(); onEstimate?.(v.id); }}>Estimate voyage</button>
      </div>

      <div className="mvb-vc__pos">
        <div className="posbar-eyebrow">Position</div>
        {posted ? (
          <>
            <div className="row1">
              <span className="port">{v.port}</span>
              {v.zone && <span className="zone">{v.zone}</span>}
              <span className="date">
                {v.lyc && <Tip plain text={TIP.dot}><span className={"mvb-lyc " + v.lyc} /></Tip>}
                {v.date}
              </span>
            </div>
            {v.dir && <div className="dir">Preferred direction: <b>{v.dir}</b></div>}
          </>
        ) : (
          <div className="row1 undeclared">
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
        <div className="mvb-vc__via">via <b>{v.via}</b> {v.viaRole && <span style={{ opacity: 0.7 }}>({v.viaRole})</span>}</div>
      ) : null}
    </article>
  );
}
