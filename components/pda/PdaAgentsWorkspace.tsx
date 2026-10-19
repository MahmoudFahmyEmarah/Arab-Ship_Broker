"use client";

// PDA · the Agents tab, phase 1 (owner decisions O2ALL-009). The directory of port agencies ASB has invited, the
// verified ports they attend and the services they quote — read through the member's own session from the governed
// registry. Quote requests to these agencies (masked by default, answered by the agencies themselves) are phase 2; this
// tab says so instead of simulating them.
import * as React from "react";
import { ExternalLink, RefreshCw, Search, UserRound } from "lucide-react";

import { loadPdaAgents } from "@/app/(dashboard)/dashboard/ports-da/actions";
import { filterPdaAgencies, type PdaAgency } from "@/lib/pda/agents";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; agencies: PdaAgency[] };

export function PdaAgentsWorkspace({ initialPort = null }: { initialPort?: string | null }) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [query, setQuery] = React.useState("");
  // a port card's "Agents at this port" opens this tab filtered to that port
  const [port, setPort] = React.useState<string | null>(initialPort);
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    setState({ status: "loading" });
    const result = await loadPdaAgents();
    if (run !== sequence.current) return;
    setState(result.ok ? { status: "ready", agencies: result.data } : { status: "error", message: result.error });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const agencies = React.useMemo(() => (state.status === "ready" ? state.agencies : []), [state]);
  const shown = React.useMemo(() => filterPdaAgencies(agencies, query, port), [agencies, query, port]);
  const portCount = React.useMemo(() => new Set(agencies.flatMap((a) => a.ports.map((p) => p.portLocode))).size, [agencies]);

  return (
    <section className="pda-agents" aria-labelledby="pda-agents-title">
      <header className="pda-agents__head asb-card">
        <div>
          <h2 id="pda-agents-title" className="pda-ports__title">Port agents</h2>
          <p className="pda-ports__lede">
            Agencies invited by Arab ShipBroker, listed at the verified ports they attend, with the services they quote.
            To ask agencies for a real quote, save your estimate and open Quotes on it under Saved estimates: the request is masked by
            default, the agency answers itself, and an accepted quote becomes a new version of your estimate.
          </p>
        </div>
        {state.status === "ready" ? (
          <dl className="pda-ports__stats">
            <div><dt>Agencies</dt><dd>{agencies.length}</dd></div>
            <div><dt>Ports covered</dt><dd>{portCount}</dd></div>
          </dl>
        ) : null}
      </header>

      {state.status === "loading" ? <p className="pda-ports__status asb-card" role="status" aria-busy="true">Loading the port agents…</p> : null}
      {state.status === "error" ? (
        <div className="asb-card">
          <p className="pda-ports__status pda-ports__status--error" role="alert">{state.message}</p>
          <button type="button" className="asb-control pda-ports__retry" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="pda-agents__body asb-card">
          <div className="pda-ports__controls">
            <label className="pda-ports__search">
              <Search size={14} aria-hidden="true" />
              <span className="asb-sr-only">Search agencies</span>
              <input className="asb-control" type="search" placeholder="Search an agency, port or country" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            {port ? (
              <button type="button" className="pda-save__button" onClick={() => setPort(null)} aria-label={`Show agencies at every port, not only ${port}`}>
                Only {port} · show all
              </button>
            ) : null}
            <span className="pda-ports__count" aria-live="polite">{shown.length} of {agencies.length}</span>
          </div>

          {agencies.length === 0 ? (
            <p className="pda-ports__status">No agency is listed yet. Arab ShipBroker invites agencies port by port; they appear here as soon as they are listed.</p>
          ) : shown.length === 0 ? (
            <p className="pda-ports__status">{port ? `No listed agency attends ${port} yet.` : "No agency matches this search."}</p>
          ) : (
            <ul className="pda-agents__list">
              {shown.map((agency) => (
                <li key={agency.agencyId} className="pda-agents__item">
                  <div className="pda-agents__name">
                    <span className="pda-agents__icon" aria-hidden="true"><UserRound size={16} /></span>
                    <b>{agency.displayName}</b>
                    {agency.website ? (
                      <a href={agency.website} target="_blank" rel="noopener noreferrer" className="pda-agents__site">
                        Website <ExternalLink size={12} aria-hidden="true" /><span className="asb-sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : null}
                  </div>
                  <ul className="pda-agents__ports">
                    {agency.ports.filter((p) => !port || p.portLocode === port).map((p) => (
                      <li key={p.portLocode}>
                        <span className="pda-agents__port">{p.portName} <em>{p.portLocode}{p.country ? ` · ${p.country}` : ""}</em></span>
                        <span className="pda-agents__services">{p.services.length ? p.services.map((s) => PDA_SERVICE_LABELS[s]).join(" · ") : "Services not yet stated"}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
