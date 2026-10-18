"use client";

// PDA · the Ports tab (owner ruling O2ALL-008, increment C). The way into the port data behind every estimate: a map,
// then the ports one by one, each row showing which of the nine route services a PUBLISHED tariff in force actually
// prices. Everything comes from one governed RPC (list_pda_ports_workspace) read through the member's own session;
// nothing is typed, simulated or kept in the browser, so a port cannot look covered when it is not.
import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Minus, RefreshCw, Search } from "lucide-react";

import { loadPdaPortsWorkspace } from "@/app/(dashboard)/dashboard/ports-da/actions";
import { PDA_ROUTE_SERVICE_CODES } from "@/lib/pda/route-types";
import {
  filterPdaPorts,
  PDA_PORTS_SCOPES,
  PDA_SERVICE_LABELS,
  pricedServices,
  summarisePdaPorts,
  type PdaPortsScope,
  type PdaPortsWorkspace,
  type PdaWorkspacePort,
} from "@/lib/pda/ports-workspace";

const PdaPortsMap = dynamic(() => import("./PdaPortsMap"), {
  ssr: false,
  loading: () => <div className="pda-ports__map pda-ports__map--loading" aria-hidden="true" />,
});

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PdaPortsWorkspace };

const AUTHORITY_LABEL: Record<string, string> = {
  official: "Official",
  agent: "Agent",
  statutory: "Statutory",
  reference: "Reference",
  unverified: "Unverified",
};

function formatDate(value: string | null): string {
  if (!value) return "open-ended";
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PdaPortsWorkspace() {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<PdaPortsScope>("all");
  const [selected, setSelected] = React.useState<string | null>(null);
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    setState({ status: "loading" });
    const result = await loadPdaPortsWorkspace();
    if (run !== sequence.current) return;
    setState(result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.error });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const ports = React.useMemo(() => (state.status === "ready" ? state.data.ports : []), [state]);
  const shown = React.useMemo(() => filterPdaPorts(ports, query, scope), [ports, query, scope]);
  const summary = React.useMemo(() => summarisePdaPorts(ports), [ports]);
  const selectedPort = ports.find((port) => port.locode === selected) ?? null;

  if (state.status === "loading") {
    return (
      <section className="pda-ports asb-card" aria-busy="true" aria-labelledby="pda-ports-title">
        <h2 id="pda-ports-title" className="pda-ports__title">Ports</h2>
        <p className="pda-ports__status" role="status">Loading the ports and the tariffs in force…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="pda-ports asb-card" aria-labelledby="pda-ports-title">
        <h2 id="pda-ports-title" className="pda-ports__title">Ports</h2>
        <p className="pda-ports__status pda-ports__status--error" role="alert">{state.message}</p>
        <button type="button" className="asb-control pda-ports__retry" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </section>
    );
  }

  return (
    <section className="pda-ports" aria-labelledby="pda-ports-title">
      <header className="pda-ports__head asb-card">
        <div>
          <h2 id="pda-ports-title" className="pda-ports__title">Ports</h2>
          <p className="pda-ports__lede">
            One row per verified port, with the tariffs published and in force on {formatDate(state.data.callDate)}.
            A service shows as priced only when a published edition carries a charge line for it.
          </p>
        </div>
        <dl className="pda-ports__stats">
          <div><dt>Ports</dt><dd>{summary.ports}</dd></div>
          <div><dt>Tariff held</dt><dd>{summary.withTariff}</dd></div>
          <div><dt>All nine services priced</dt><dd>{summary.fullyPriced}</dd></div>
          <div><dt>With verified terminals</dt><dd>{summary.withTerminals}</dd></div>
        </dl>
      </header>

      <div className="pda-ports__body">
        <div className="pda-ports__main asb-card">
          <PdaPortsMap ports={shown} selected={selected} onSelect={setSelected} />
          <p className="pda-ports__note">Filled pins hold a published tariff, hollow pins do not. The map follows the search and the filter.</p>

          <div className="pda-ports__controls">
            <label className="pda-ports__search">
              <Search size={14} aria-hidden="true" />
              <span className="asb-sr-only">Search ports</span>
              <input
                className="asb-control"
                type="search"
                placeholder="Search a port, country, publisher or edition"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="pda-ports__scope" role="radiogroup" aria-label="Which ports to show">
              {PDA_PORTS_SCOPES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={scope === option.id}
                  className={scope === option.id ? "is-on" : undefined}
                  onClick={() => setScope(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="pda-ports__count" aria-live="polite">{shown.length} of {ports.length}</span>
          </div>

          {shown.length === 0 ? (
            <p className="pda-ports__status">No port matches this search.</p>
          ) : (
            <div className="pda-ports__scroll">
              <table className="pda-ports__table">
                <caption className="asb-sr-only">Ports and the route services priced by the tariffs in force</caption>
                <thead>
                  <tr>
                    <th scope="col">Port</th>
                    <th scope="col">Country</th>
                    {PDA_ROUTE_SERVICE_CODES.map((service) => (
                      <th key={service} scope="col" className="pda-ports__svc-head" title={PDA_SERVICE_LABELS[service]}>
                        <span>{PDA_SERVICE_LABELS[service]}</span>
                      </th>
                    ))}
                    <th scope="col">Tariff in force</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((port) => (
                    <PortRow key={port.locode} port={port} selected={port.locode === selected} onSelect={setSelected} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pda-ports__note">
            Coverage is read from the published tariffs, never typed. Where a service is not priced, the estimate shows it as
            not sourced and asks for a manual quote.
          </p>
        </div>

        <PortDetail port={selectedPort} onClose={() => setSelected(null)} />
      </div>
    </section>
  );
}

function PortRow({ port, selected, onSelect }: { port: PdaWorkspacePort; selected: boolean; onSelect: (locode: string) => void }) {
  const priced = new Set(pricedServices(port));
  const first = port.tariffs[0] ?? null;
  return (
    <tr className={selected ? "is-selected" : undefined}>
      <th scope="row">
        <button type="button" className="pda-ports__port" onClick={() => onSelect(port.locode)} aria-pressed={selected}>
          <span className="pda-ports__port-name">{port.name}</span>
          <span className="pda-ports__port-code">{port.locode}</span>
        </button>
      </th>
      <td>{port.country ?? "—"}</td>
      {PDA_ROUTE_SERVICE_CODES.map((service) => (
        <td key={service} className="pda-ports__svc">
          {priced.has(service) ? (
            <span className="pda-ports__dot is-priced" title={`${PDA_SERVICE_LABELS[service]}: priced`}>
              <Check size={11} aria-hidden="true" /><span className="asb-sr-only">priced</span>
            </span>
          ) : (
            <span className="pda-ports__dot" title={`${PDA_SERVICE_LABELS[service]}: not priced`}>
              <Minus size={11} aria-hidden="true" /><span className="asb-sr-only">not priced</span>
            </span>
          )}
        </td>
      ))}
      <td>
        {first ? (
          <span className="pda-ports__edition">
            {first.editionLabel}
            {port.tariffs.length > 1 ? <em> + {port.tariffs.length - 1} more</em> : null}
          </span>
        ) : (
          <span className="pda-ports__none">None in force</span>
        )}
      </td>
    </tr>
  );
}

function PortDetail({ port, onClose }: { port: PdaWorkspacePort | null; onClose: () => void }) {
  if (!port) {
    return (
      <aside className="pda-ports__detail asb-card" aria-label="Port details">
        <p className="pda-ports__status">Choose a port in the table or on the map to see its terminals and the editions that price it.</p>
      </aside>
    );
  }
  const priced = pricedServices(port);
  const missing = PDA_ROUTE_SERVICE_CODES.filter((service) => !priced.includes(service));
  return (
    <aside className="pda-ports__detail asb-card" aria-labelledby="pda-port-detail-title">
      <div className="pda-ports__detail-head">
        <div>
          <h3 id="pda-port-detail-title">{port.name}</h3>
          <p>{port.locode}{port.country ? ` · ${port.country}` : ""}{port.zone ? ` · ${port.zone}` : ""}</p>
        </div>
        <button type="button" className="asb-control pda-ports__close" onClick={onClose}>Close</button>
      </div>

      <h4>Terminals</h4>
      {port.terminals.length ? (
        <ul className="pda-ports__list">{port.terminals.map((name) => <li key={name}>{name}</li>)}</ul>
      ) : (
        <p className="pda-ports__muted">No verified terminal. Port-wide tariffs still apply.</p>
      )}

      <h4>Tariffs in force</h4>
      {port.tariffs.length ? (
        <ul className="pda-ports__editions">
          {port.tariffs.map((tariff) => (
            <li key={`${tariff.editionLabel}-${tariff.terminalName ?? "port"}`}>
              <b>{tariff.editionLabel}</b>
              <span>
                {tariff.terminalName ? `${tariff.terminalName} · ` : "Port-wide · "}
                {tariff.currency} · from {formatDate(tariff.effectiveFrom)} to {formatDate(tariff.effectiveTo)}
              </span>
              <span>
                {tariff.publisherName ?? "Publisher not recorded"}
                {tariff.sourceAuthority ? ` · ${AUTHORITY_LABEL[tariff.sourceAuthority] ?? tariff.sourceAuthority} source` : ""}
                {` · ${tariff.ruleCount} charge line${tariff.ruleCount === 1 ? "" : "s"}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pda-ports__muted">No published tariff is in force. Every service at this port needs a manual quote in the estimate.</p>
      )}

      <h4>Services</h4>
      <p className="pda-ports__muted">
        {priced.length ? `Priced: ${priced.map((s) => PDA_SERVICE_LABELS[s]).join(", ")}.` : "No service is priced."}
        {missing.length && priced.length ? ` Not priced: ${missing.map((s) => PDA_SERVICE_LABELS[s]).join(", ")}.` : ""}
      </p>
    </aside>
  );
}
