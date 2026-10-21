// The design's Ports Module hub (owner B2ALL-061, build step 11): two arms — Quick DA (your cargo and vessel, two
// calls, open in the estimator) and Setup & directory (the hero band, the tools, the most visited ports and the
// tariff coverage). Everything comes from governed reads; the hub prices nothing.
import Link from "next/link";
import { ChevronRight, FileText, List, Map as MapIcon, Receipt, Settings2, ShieldCheck, UserRound } from "lucide-react";

import type { PdaEstimatorCargoOption, PdaEstimatorVesselOption } from "@/lib/pda/estimator-contract";
import { rankedPorts, targetedCount, totalTouches, touchRole, type PdaPortCensus } from "@/lib/pda/port-census";
import type { PdaTariffPack } from "@/lib/pda/tariff-packs";

import { PdaQuickDa } from "./PdaQuickDa";
import "./pda-route-estimator.css";
import "./ports-module.css";

export type PdaHubArm = "quick" | "setup";
export const isPdaHubArm = (v: unknown): v is PdaHubArm => v === "quick" || v === "setup";

const TOOLS = [
  { href: "/dashboard/ports-da", title: "PDA Estimator", desc: "Two calls priced from the tariff that governs each port, then from quotes.", icon: Receipt },
  { href: "/dashboard/ports-da/directory", title: "Port Directory", desc: "Every port in the network, ranked by the live listings that touch it.", icon: List },
  { href: "/dashboard/ports-da/map", title: "Ports Map", desc: "Pins sized by touches; filled where a tariff is held.", icon: MapIcon },
  { href: "/dashboard/ports-da/tariff-packs", title: "Tariff Packs", desc: "One pack per published tariff, held under the authority that issued it.", icon: FileText },
  { href: "/dashboard/ports-da?tab=agents", title: "Agents", desc: "The agencies Arab ShipBroker has invited, and your quote requests.", icon: UserRound },
  { href: "/dashboard/ports-da?tab=setup", title: "Setup", desc: "How the estimator is shown to you, and the records behind it.", icon: Settings2 },
] as const;

export function PdaPortsHub({ arm, census, packs, cargos, vessels, catalogUnavailable, tariffHeld, on }: {
  arm: PdaHubArm;
  census: PdaPortCensus;
  packs: PdaTariffPack[];
  cargos: PdaEstimatorCargoOption[];
  vessels: PdaEstimatorVesselOption[];
  /** the estimator's catalog could not be read: Quick DA must say so, not "none" */
  catalogUnavailable: boolean;
  tariffHeld: string[];
  on: string;
}) {
  const ranked = rankedPorts(census).filter((p) => p.rank != null).slice(0, 8);
  const coverage = [...packs].sort((a, b) => b.lines - a.lines).slice(0, 6);
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <nav className="pd-crumbs" aria-label="Breadcrumb">Arab ShipBroker · <b>Ports Module</b></nav>
        <nav className="pmx-arms pd-topbar__end" aria-label="Hub views">
          <Link className={`pmx-arms__b${arm === "quick" ? " is-on" : ""}`} href="/dashboard/ports-da/hub?arm=quick" aria-current={arm === "quick" ? "page" : undefined}>Quick DA</Link>
          <Link className={`pmx-arms__b${arm === "setup" ? " is-on" : ""}`} href="/dashboard/ports-da/hub?arm=setup" aria-current={arm === "setup" ? "page" : undefined}>Setup &amp; directory</Link>
        </nav>
      </div>

      {arm === "quick" ? (
        <>
          <div className="pd-band pd-band--navy">
            <div className="pd-band__ey">Ports Module · Quick DA</div>
            <h1 className="pd-band__title">Two calls, one estimate</h1>
            <p className="pd-band__sub">Pick a cargo and a vessel of yours; the estimator opens with both and prices the load and discharge calls from the tariff that governs each port.</p>
          </div>
          <PdaQuickDa cargos={cargos} vessels={vessels} catalogUnavailable={catalogUnavailable} tariffHeld={tariffHeld} />
        </>
      ) : (
        <>
          <div className="pd-band pd-band--navy">
            <div className="pd-band__ey">Arab ShipBroker</div>
            <h1 className="pd-band__title">Ports Module</h1>
            <p className="pd-band__sub">Everything about a port — its record, its tariffs, the agents who attend it and the vessels and cargoes moving through it — in one place, read from published records.</p>
            <div className="pd-band__badges">
              <span className="pd-badge"><span className="dot" aria-hidden="true"></span>{targetedCount(census)} port{targetedCount(census) === 1 ? "" : "s"} touched {totalTouches(census)} time{totalTouches(census) === 1 ? "" : "s"} by live listings · reported counts only</span>
              <span className="pd-badge">{census.ports.length} in network</span>
              <span className="pd-badge"><ShieldCheck size={13} aria-hidden="true" /> {packs.length} tariff pack{packs.length === 1 ? "" : "s"}, held by authority</span>
            </div>
          </div>

          <div className="pd-scroll-body">
            <h2 className="pm-sec-h">Tools</h2>
            <div className="pm-cards">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                return (
                  <Link key={t.title} className="pm-card" href={t.href}>
                    <span className="pm-card__ic"><Icon size={22} aria-hidden="true" /></span>
                    <span className="pm-card__body">
                      <span className="pm-card__title">{t.title} <ChevronRight size={14} aria-hidden="true" /></span>
                      <span className="pm-card__desc">{t.desc}</span>
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="pd-grid">
              <div className="pd-col">
                <section className="pd-panel" aria-labelledby="hub-visited">
                  <div className="pd-panel__hd">
                    <h2 id="hub-visited" className="pd-panel__h">Most touched ports · live listings today</h2>
                    <Link className="pm-more" href={`/dashboard/ports-da/directory?on=${on}`}>Open directory →</Link>
                  </div>
                  <div className="pd-panel__body pd-panel__body--rows">
                    {ranked.length === 0 ? <p className="pd-line ap-none">No port is touched by three or more live listings or open vessels today.</p> : ranked.map((p) => (
                      <Link key={p.locode} className="pm-row" href={`/dashboard/ports-da/ports/${p.locode}?on=${on}`}>
                        <span className="pm-rank">{p.rank}</span>
                        <span className="pm-row__name">{p.name}</span>
                        <span className="pm-row__meta">{[`${p.touches}×`, p.loads ? `${p.loads} load` : null, p.discharges ? `${p.discharges} disch` : null, p.vessels ? `${p.vessels} open` : null, touchRole(p) === "touched" ? "breakdown withheld" : null].filter(Boolean).join(" · ")}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              </div>
              <div className="pd-col">
                <section className="pd-panel" aria-labelledby="hub-coverage">
                  <div className="pd-panel__hd">
                    <h2 id="hub-coverage" className="pd-panel__h">Tariff coverage, pack by pack</h2>
                    <Link className="pm-more" href={`/dashboard/ports-da/tariff-packs?on=${on}`}>All tariffs →</Link>
                  </div>
                  <div className="pd-panel__body pd-panel__body--rows">
                    {coverage.length === 0 ? <p className="pd-line ap-none">No published tariff is in force on {on}.</p> : coverage.map((k) => (
                      <Link key={k.packRef} className="pm-row" href={`/dashboard/ports-da/tariff-packs/${k.packRef}?on=${on}`}>
                        <span className="pm-flag" aria-hidden="true">{k.country ? k.country.slice(0, 2).toUpperCase() : "··"}</span>
                        <span className="pm-row__name">{k.authority}</span>
                        <span className="pm-row__meta">{k.currency === "mixed" ? "mixed currencies" : k.currency} · {k.lines} line{k.lines === 1 ? "" : "s"} · {k.ports.length} port{k.ports.length === 1 ? "" : "s"}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
