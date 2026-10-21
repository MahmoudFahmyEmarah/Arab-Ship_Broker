"use client";

// The design's Ports Map (owner B2ALL-061, build step 11): the Ports workspace map, pins sized by the live listings
// that touch each port today (the style and basemap stay exactly as the app renders them, by owner ruling). The side
// panel shows what the port's records already answer and links to the record, the settings and the estimator; the
// design's own fallbacks stand in for what is not recorded ("No pack yet", "ask the attending agent").
import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, List } from "lucide-react";

import { TOUCH_ROLE_LABEL, maxTouches, pinSize, targetedCount, touchRole, type PdaPortCensus, type PdaPortTouch } from "@/lib/pda/port-census";
import type { PdaWorkspacePort } from "@/lib/pda/ports-workspace";

import "./pda-route-estimator.css";
import "./ports-module.css";

const PdaPortsMap = dynamic(() => import("./PdaPortsMap"), { ssr: false, loading: () => <div className="pda-ports__map pda-ports__map--loading" aria-hidden="true" /> });

export function PdaPortsMapPage({ ports, census, on }: { ports: PdaWorkspacePort[]; census: PdaPortCensus; on: string }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const touches = React.useMemo(() => new Map(census.ports.map((p) => [p.locode, p])), [census]);
  const max = maxTouches(census);
  const sizes = React.useMemo(() => Object.fromEntries(ports.map((p) => [p.locode, pinSize(touches.get(p.locode) ?? EMPTY, max)])), [ports, touches, max]);
  const port = ports.find((p) => p.locode === selected) ?? null;
  const touch = port ? touches.get(port.locode) ?? null : null;
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href="/dashboard/ports-da/hub"><ArrowLeft size={15} aria-hidden="true" /> Ports Module</Link>
        <nav className="pd-crumbs" aria-label="Breadcrumb">Ports Module · <b>Ports Map</b></nav>
        <div className="pd-topbar__end"><Link className="asb-btn pd-topbar__link" href={`/dashboard/ports-da/directory?on=${on}`}><List size={13} aria-hidden="true" /> Directory</Link></div>
      </div>

      <div className="pmap-main">
        <div className="pmap-head">
          <div>
            <h1 className="page-title">Ports Map</h1>
            <div className="eyebrow">Ports Module · pins sized by live-listing touches today · tariffs in force on {on}</div>
          </div>
          <div className="pmap-head__actions"><div className="pmap-count">{targetedCount(census)} targeted · {ports.length} in network</div></div>
        </div>

        <div className="pmap-body">
          <div className="pmap-host-wrap">
            <PdaPortsMap ports={ports} selected={selected} onSelect={setSelected} sizes={sizes} />
          </div>
          <aside className="pmap-side" aria-live="polite">
            {port ? (
              <div className="pd-panel">
                <div className="pd-panel__hd"><h2 className="pd-panel__h">{port.name} <span className="pt-li__code">{port.locode}</span></h2></div>
                <div className="pd-panel__body">
                  <div className="pd-line">{[port.country, port.zone].filter(Boolean).join(" · ") || "Country and zone not recorded"}</div>
                  <dl className="pmap-facts">
                    <div><dt>Live listings</dt><dd>{touchLabel(touch, census.minimumCohort)}</dd></div>
                    <div><dt>Tariff</dt><dd>{port.tariffs.length ? `${port.tariffs.length} edition${port.tariffs.length === 1 ? "" : "s"} in force · ${port.tariffs.reduce((n, t) => n + t.ruleCount, 0)} charge lines` : "No pack yet · ask the attending agent"}</dd></div>
                    <div><dt>Terminals</dt><dd>{port.terminals.length ? port.terminals.join(" · ") : "None verified; port-wide tariffs apply"}</dd></div>
                    <div><dt>Berths, LOA and draft</dt><dd className="ap-none">Not held</dd></div>
                    <div><dt>Indicative DA</dt><dd className="ap-none">Not recorded yet · price the call in the estimator</dd></div>
                  </dl>
                  <div className="pmap-actions">
                    <Link className="asb-btn is-primary" href={`/dashboard/ports-da/ports/${port.locode}?on=${on}`}>Open the port record</Link>
                    <Link className="asb-btn" href={`/dashboard/ports-da/ports/${port.locode}/settings?on=${on}`}>Port settings</Link>
                    <Link className="asb-btn" href="/dashboard/ports-da?tab=agents">Attending agents</Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="pd-panel"><div className="pd-panel__body"><p className="pd-line">Choose a port on the map. Filled pins hold a published tariff; the larger the pin, the more live listings touch the port today.</p></div></div>
            )}
            <div className="pmap-legend">
              <div className="pmap-legend__title">Touches · {max} at the top</div>
              <div className="pmap-legend__note">● size = live listings touching the port today · filled = tariff held · hollow = none · a port touched by fewer than {census.minimumCohort} listings shows no count</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const EMPTY: PdaPortTouch = { locode: "", name: "", country: null, zone: null, latitude: null, longitude: null, touches: 0, loads: 0, discharges: 0, vessels: 0, suppressed: false };

function touchLabel(touch: PdaPortTouch | null, min: number): string {
  if (!touch) return "no live listing";
  if (touch.suppressed) return `fewer than ${min} (count withheld)`;
  if (!touch.touches) return "no live listing";
  return `${touch.touches} · ${TOUCH_ROLE_LABEL[touchRole(touch)]}`;
}
