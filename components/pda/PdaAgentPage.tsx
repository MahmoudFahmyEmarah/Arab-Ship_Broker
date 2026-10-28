// The design's Attending Agent company page (owner B2ALL-061, build step 10; B2O-056 P2s): an entity page like a vessel
// owner's, reached from a port's record. Read-only, published view of the agency registry; contacts, fees and history
// are not recorded yet and say so. Arab ShipBroker curates the listing (/admin/port-agents); the agency's own staff see a
// link to their Agent Portal, other members do not.
import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserRound } from "lucide-react";

import type { PdaAgency } from "@/lib/pda/agents";
import { agencyCountries, agencyPortRows, agencyServices, initials, safeWebsite } from "@/lib/pda/agent-page";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import { PDA_ROUTE_SERVICE_CODES } from "@/lib/pda/route-types";

import "./pda-route-estimator.css";
import "./ports-module.css";

const NR = "Not recorded yet";
const Empty = ({ what = NR }: { what?: string }) => <span className="pp-val is-empty">–<span className="asb-sr-only"> {what}</span></span>;

export function PdaAgentPage({ agency, on, isStaff }: { agency: PdaAgency; on: string; isStaff: boolean }) {
  const rows = agencyPortRows(agency);
  const services = agencyServices(agency);
  const countries = agencyCountries(agency);
  const website = safeWebsite(agency.website);
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href="/dashboard/ports-da?tab=agents"><ArrowLeft size={15} aria-hidden="true" /> Agents</Link>
        <nav className="pd-crumbs" aria-label="Breadcrumb">Ports Module · Attending agents · <b>{agency.displayName}</b></nav>
        <div className="pd-topbar__end"><span className="pdr-role">Published record</span></div>
      </div>

      <div className="pd-band ag-band pd-band--navy">
        <div className="pd-band__actions">
          <Link className="asb-btn is-primary" href="/dashboard/ports-da?tab=agents"><ShieldCheck size={14} aria-hidden="true" /> Ask for a quote</Link>
        </div>
        <div className="pd-band__ey">Attending agent · listed by Arab ShipBroker</div>
        <h1 className="pd-band__title">{agency.displayName}</h1>
        <div className="pd-band__sub">{countries.length ? `Countries served: ${countries.join(" · ")}` : "Countries served: none listed yet"} · head office not recorded</div>
        <div className="pd-band__badges">
          <span className="pd-badge"><ShieldCheck size={13} aria-hidden="true" /> Invited and listed by Arab ShipBroker</span>
          <span className="pd-badge"><span className="dot" aria-hidden="true"></span>{rows.length} port{rows.length === 1 ? "" : "s"} served</span>
          {services.length ? <span className="pd-badge">{services.length} of {PDA_ROUTE_SERVICE_CODES.length} services quoted</span> : null}
        </div>
      </div>

      <div className="ag-owner">
        <div className="ag-owner__ava" aria-hidden="true">{initials(agency.displayName)}</div>
        <div className="ag-owner__body">
          <b>Listed and maintained by Arab ShipBroker</b>
          <p>Arab ShipBroker invites the agency and keeps its ports and services on this page; the agency&apos;s own staff answer quote requests from their Agent Portal. Nothing here is typed in by members.</p>
        </div>
        {isStaff ? <Link className="asb-btn" href="/dashboard/agency"><UserRound size={14} aria-hidden="true" /> Your Agent Portal</Link> : null}
      </div>

      <div className="pd-grid">
        <div className="pd-col">
          <section className="pd-panel" aria-labelledby="ag-about">
            <div className="pd-panel__hd"><h2 id="ag-about" className="pd-panel__h">About</h2></div>
            <div className="pd-panel__body">
              <div className="pd-line"><span className="ap-none">{NR}.</span> The agency&apos;s own description will appear here once it is recorded.</div>
              <div className="pd-chips">
                {services.length ? services.map((s) => <span key={s} className="pd-chip">{PDA_SERVICE_LABELS[s]}</span>) : <span className="ap-none">No service listed yet</span>}
              </div>
            </div>
          </section>

          <section className="pd-panel" aria-labelledby="ag-fees">
            <div className="pd-panel__hd"><h2 id="ag-fees" className="pd-panel__h">Published agency fees</h2></div>
            <div className="pd-panel__body pd-panel__body--flush">
              <table className="pd-charges">
                <caption className="asb-sr-only">Ports this agency attends and what it quotes there</caption>
                <thead>
                  <tr><th scope="col">Port served</th><th scope="col">Country</th><th scope="col">Services quoted</th><th scope="col" className="num">Agency fee</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="pd-charges__empty">No port linked to this agency yet.</td></tr>
                  ) : rows.map((p) => (
                    <tr key={p.locode}>
                      <td><Link className="pd-charges__port" href={`/dashboard/ports-da/ports/${p.locode}?on=${on}`}>{p.name} <span>{p.locode}</span></Link></td>
                      <td>{p.country ?? <Empty />}</td>
                      <td>{p.services || <Empty what="Services not yet stated" />}</td>
                      <td className="num">quoted per call</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ag-amended">Agency fees are quoted per call through the Agents tab of the estimator; no standing fee is published yet.</div>
          </section>
        </div>

        <div className="pd-col">
          <section className="pd-panel" aria-labelledby="ag-contact">
            <div className="pd-panel__hd"><h2 id="ag-contact" className="pd-panel__h">Contacts</h2></div>
            <div className="pd-panel__body">
              <div className="ag-contact-row"><span className="k">Desk</span><span className="ap-none">{NR}</span></div>
              <div className="ag-contact-row"><span className="k">Email</span><span className="ap-none">{NR}</span></div>
              <div className="ag-contact-row"><span className="k">Phone</span><span className="ap-none">{NR}</span></div>
              <div className="ag-contact-row"><span className="k">Website</span>{website ? <a href={website.href} rel="noopener noreferrer" target="_blank">{website.host}<span className="asb-sr-only"> (opens in a new tab)</span></a> : <span className="ap-none">{NR}</span>}</div>
            </div>
          </section>

          <section className="pd-panel" aria-labelledby="ag-record">
            <div className="pd-panel__hd"><h2 id="ag-record" className="pd-panel__h">Record</h2></div>
            <div className="pd-panel__body">
              <div className="ag-contact-row"><span className="k">Founded</span><span className="ap-none">{NR}</span></div>
              <div className="ag-contact-row"><span className="k">Member since</span><span className="ap-none">{NR}</span></div>
              <div className="ag-contact-row"><span className="k">Quotes answered</span><span className="ap-none">{NR}</span></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
