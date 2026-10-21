"use client";

// PDA · the Ports tab (owner ruling O2ALL-008, increment C). The way into the port data behind every estimate: a map,
// then the ports one by one, each row showing which of the nine route services a PUBLISHED tariff in force actually
// prices. Everything comes from one governed RPC (list_pda_ports_workspace) read through the member's own session;
// nothing is typed, simulated or kept in the browser, so a port cannot look covered when it is not.
import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FileText, RefreshCw, ShieldCheck, X } from "lucide-react";

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

// The design's record arms across each row (owner B2ALL-061). Coverage is read, never typed: the Costs arm is
// "read from a document" wherever a published tariff is in force; the other arms have no port record yet, so they
// are honestly empty until someone fills them (no port-record store exists).
const ARMS = ["Particulars", "Operations", "Costs", "Commercial", "Sources"] as const;
type ArmStatus = "empty" | "extracted" | "review" | "verified";
const armStatus = (port: PdaWorkspacePort, arm: (typeof ARMS)[number]): ArmStatus => (arm === "Costs" && port.tariffs.length ? "extracted" : "empty");
const ARM_LABEL: Record<ArmStatus, string> = { empty: "empty", extracted: "read from a document", review: "worked on", verified: "verified" };

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

export function PdaPortsWorkspace({ initialSelected = null }: { initialSelected?: string | null }) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<PdaPortsScope>("all");
  // a port card's "Port record" opens this tab with that port already selected
  const [selected, setSelected] = React.useState<string | null>(initialSelected);
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

  const band = (
    <div className="pd-band">
      <div className="pd-band__ey">Ports Module · one record per port</div>
      <h2 id="pda-ports-title" className="pd-band__title">Ports</h2>
      <p className="pd-band__sub">The map, then the ports one by one. Each row says how much of that port is known and which tariff prices it. Open a port to see its record.</p>
      {state.status === "ready" ? (
        <div className="pd-band__badges">
          <span className="pd-badge"><span className="dot" aria-hidden="true"></span>{summary.ports} ports</span>
          <span className="pd-badge"><ShieldCheck size={13} aria-hidden="true" /> {summary.withTariff} with a tariff held</span>
          <span className="pd-badge"><FileText size={13} aria-hidden="true" /> 0 records started</span>
        </div>
      ) : null}
    </div>
  );

  if (state.status === "loading") {
    return (
      <section className="pda-ports" aria-busy="true" aria-labelledby="pda-ports-title">
        {band}
        <div className="px-wrap"><p className="px-lede" role="status">Loading the ports and the tariffs in force…</p></div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="pda-ports" aria-labelledby="pda-ports-title">
        {band}
        <div className="px-wrap">
          <p className="px-lede pda-ports__status--error" role="alert">{state.message}</p>
          <button type="button" className="asb-btn" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="pda-ports" aria-labelledby="pda-ports-title">
      {band}
      <div className="px-wrap">
        <p className="px-lede">
          One page per port, and this is the way in. A port is handled <b>case by case</b>: its own record, its own tariff, its own
          findings. Nothing is averaged across a country, because ports in the same country do not charge the same way or hold the
          same quality of data. Tariffs shown are those published and in force on {formatDate(state.data.callDate)}.
        </p>

        <div className="px-map">
          <PdaPortsMap ports={shown} selected={selected} onSelect={setSelected} />
        </div>
        <p className="px-note">Filled pins hold a published tariff, hollow pins do not. The map follows the search and the filter below, so narrowing the list zooms the map with it.</p>

        <div className="px-h">Port by port <span>ports down, the record&apos;s arms across, coloured by what is actually known</span></div>
        <div className="px-ctl">
          <label>
            <span className="asb-sr-only">Search ports</span>
            <input
              className="px-in"
              type="search"
              placeholder="Search a port, country, publisher or edition"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="px-seg" role="radiogroup" aria-label="Which ports to show">
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
          <span className="px-count" aria-live="polite">{shown.length} of {ports.length}</span>
        </div>

        {shown.length === 0 ? (
          <p className="px-note">No port matches this search.</p>
        ) : (
          <div className="px-scrollx">
            <table className="px-tbl">
              <caption className="asb-sr-only">Ports, what of each port record is known, and the tariff in force</caption>
              <thead>
                <tr>
                  <th scope="col">Port</th>
                  <th scope="col">Country</th>
                  {ARMS.map((arm) => <th key={arm} scope="col" className="c" title={`Record arm: ${arm}`}>{arm}</th>)}
                  <th scope="col">Tariff pack</th>
                  <th scope="col">Shape</th>
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

        <div className="px-legend">
          <div><span className="px-cell" aria-hidden="true"></span> Empty, nobody has claimed it</div>
          <div><span className="px-cell is-extracted" aria-hidden="true"></span> Read from a document, awaiting a check</div>
          <div><span className="px-cell is-review" aria-hidden="true"></span> Someone has worked on it</div>
          <div><span className="px-cell is-verified" aria-hidden="true"></span> Verified by a named person</div>
        </div>
        <p className="px-note">
          Coverage is read from the published tariffs, never typed, so a port cannot look filled when it is not. The Costs arm shows
          blue wherever a tariff is in force, because those charge lines are already read from the published document. The layout
          shape (bundled or itemised) is not derived yet, and every other arm is honestly empty until someone fills it.
        </p>
      </div>

      {selectedPort ? <PortDetail port={selectedPort} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function PortRow({ port, selected, onSelect }: { port: PdaWorkspacePort; selected: boolean; onSelect: (locode: string) => void }) {
  const first = port.tariffs[0] ?? null;
  return (
    <tr className={selected ? "is-selected" : undefined} onClick={() => onSelect(port.locode)}>
      <th scope="row">
        <button type="button" className="px-port" onClick={(event) => { event.stopPropagation(); onSelect(port.locode); }} aria-pressed={selected}>
          <span className="n">{port.name}</span>
          <span className="code">{port.locode}</span>
        </button>
      </th>
      <td>{port.country ?? "—"}</td>
      {ARMS.map((arm) => {
        const status = armStatus(port, arm);
        return (
          <td key={arm} className="c">
            <span className={`px-cell is-${status}`} title={`${arm}: ${ARM_LABEL[status]}`}><span className="asb-sr-only">{ARM_LABEL[status]}</span></span>
          </td>
        );
      })}
      <td>
        {first ? (
          <span className="px-pack">
            {first.publisherName ?? first.editionLabel}
            <em> · {first.ruleCount} line{first.ruleCount === 1 ? "" : "s"}{port.tariffs.length > 1 ? ` · + ${port.tariffs.length - 1} more` : ""}</em>
          </span>
        ) : (
          <span className="px-none">none held</span>
        )}
      </td>
      <td><span className="px-none" title="The layout shape is not derived yet">-</span></td>
    </tr>
  );
}

function PortDetail({ port, onClose }: { port: PdaWorkspacePort; onClose: () => void }) {
  const priced = pricedServices(port);
  const missing = PDA_ROUTE_SERVICE_CODES.filter((service) => !priced.includes(service));
  return (
    <>
    <div className="pe-recscrim" onClick={onClose} aria-hidden="true"></div>
    <aside className="pe-rec" role="dialog" aria-modal="false" aria-labelledby="pda-port-detail-title">
      <div className="pe-rec__hd">
        <div>
          <h3 id="pda-port-detail-title" className="pe-rec__t">{port.name}</h3>
          <p className="pe-rec__s">{port.locode}{port.country ? ` · ${port.country}` : ""}{port.zone ? ` · ${port.zone}` : ""} · the port record, as published</p>
        </div>
        <div className="pe-rec__a">
          <Link className="asb-btn is-primary pe-rec__go" href={`/dashboard/ports-da/ports/${port.locode}`}><FileText size={13} aria-hidden="true" /> Open the port record</Link>
          <button type="button" className="pe-rec__x" onClick={onClose} aria-label="Close the record"><X size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="pe-rec__body">

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
      </div>
    </aside>
    </>
  );
}
