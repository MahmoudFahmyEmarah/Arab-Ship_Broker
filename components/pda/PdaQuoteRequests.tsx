"use client";

// PDA · quote requests for one saved estimate (Agents phase 2, O2ALL-009 A1 c / A5). The member asks ASB-invited
// agencies at one port for a real quote; the database sends a MASKED snapshot unless the member chooses to share their
// company. Answers (quotes, revisions, declines) are listed here. Accepting a quote into a new version is phase 3.
import * as React from "react";
import { Loader2, Send, XCircle } from "lucide-react";

import { listPdaQuoteRequests, loadPdaAgentsAtPort, requestPdaQuotes, withdrawPdaQuotes } from "@/app/(dashboard)/dashboard/ports-da/actions";
import type { PdaAgency } from "@/lib/pda/agents";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import type { PdaQuoteRequest } from "@/lib/pda/quote-requests";
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "@/lib/pda/route-types";

const money = (n: number, c: string) => `${c} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "—");

export function PdaQuoteRequests({ setId, loadPort, dischargePort, isLatest, mine }: { setId: string; loadPort: string; dischargePort: string; isLatest: boolean; mine: boolean }) {
  const [requests, setRequests] = React.useState<PdaQuoteRequest[] | null>(null);
  const [error, setError] = React.useState("");
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    const res = await listPdaQuoteRequests(setId);
    if (run !== sequence.current) return;
    if (res.ok) { setRequests(res.data); setError(""); } else setError(res.error);
  }, [setId]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="pda-quotes">
      {error ? <p className="pda-save__error" role="alert">{error}</p> : null}
      {requests === null && !error ? <p className="pda-history__status" role="status">Loading quote requests…</p> : null}
      {requests?.map((request) => <RequestRow key={request.requestId} request={request} onChange={() => void load()} />)}
      {!mine ? (
        <p className="pda-history__status">Only the member who saved this estimate can request quotes for it.</p>
      ) : isLatest ? <NewRequest setId={setId} loadPort={loadPort} dischargePort={dischargePort} onSent={() => void load()} /> : (
        <p className="pda-history__status">Quotes are requested from the latest version of an estimate.</p>
      )}
    </div>
  );
}

function RequestRow({ request, onChange }: { request: PdaQuoteRequest; onChange: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function withdraw() {
    setBusy(true);
    const res = await withdrawPdaQuotes(request.requestId);
    setBusy(false);
    if (res.ok) onChange(); else setError(res.error);
  }
  return (
    <section className="pda-quotes__request" aria-label={`Quote request for ${request.port}`}>
      <div className="pda-quotes__head">
        <b>{request.leg === "load" ? "Load" : "Discharge"} port {request.port}</b>
        <span>{day(request.createdAt)} · {request.status === "withdrawn" ? "withdrawn" : `open until ${day(request.expiresAt)}`} · {request.revealIdentity ? "company shared" : "identity hidden"}</span>
        {request.status === "open" && request.mine ? (
          <button type="button" className="pda-save__button" disabled={busy} onClick={() => void withdraw()}><XCircle size={13} aria-hidden="true" /> Withdraw</button>
        ) : null}
      </div>
      <ul className="pda-quotes__agencies">
        {request.agencies.map((agency) => {
          const quote = agency.quotes[0];
          return (
            <li key={agency.agencyId}>
              <span>{agency.displayName}</span>
              <span>
                {agency.status === "quoted" && quote
                  ? <><b>{money(quote.total, quote.currency)}</b> · valid until {day(quote.validUntil)}{quote.revision > 1 ? ` · revision ${quote.revision}` : ""}{quote.reference ? ` · ref ${quote.reference}` : ""}</>
                  : agency.status === "declined" ? `declined: ${agency.declineReason ?? ""}` : "awaiting answer"}
              </span>
            </li>
          );
        })}
      </ul>
      {error ? <p className="pda-save__error" role="alert">{error}</p> : null}
    </section>
  );
}

function NewRequest({ setId, loadPort, dischargePort, onSent }: { setId: string; loadPort: string; dischargePort: string; onSent: () => void }) {
  const [leg, setLeg] = React.useState<"load" | "discharge">("load");
  const [agencies, setAgencies] = React.useState<PdaAgency[] | null>(null);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [services, setServices] = React.useState<PdaRouteServiceCode[]>(["agency"]);
  const [note, setNote] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const port = leg === "load" ? loadPort : dischargePort;
  const sequence = React.useRef(0);

  React.useEffect(() => {
    const run = ++sequence.current;
    setAgencies(null);
    setChosen([]);
    void (async () => {
      const res = await loadPdaAgentsAtPort(port);
      if (run !== sequence.current) return;
      setAgencies(res.ok ? res.data : []);
      if (!res.ok) setMessage(res.error);
    })();
  }, [port]);

  async function send() {
    setBusy(true); setMessage("");
    const res = await requestPdaQuotes({ setId, leg, agencyIds: chosen, services, note, revealIdentity: reveal });
    setBusy(false);
    if (res.ok) { setMessage(`Sent to ${res.data.agencies} agenc${res.data.agencies === 1 ? "y" : "ies"}.`); setChosen([]); setNote(""); onSent(); }
    else setMessage(res.error);
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <section className="pda-quotes__new" aria-label="Request quotes from port agents">
      <b>Request quotes from port agents</b>
      <div className="pda-setup__seg" role="radiogroup" aria-label="Which port">
        {(["load", "discharge"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={leg === value} className={leg === value ? "is-on" : undefined} onClick={() => setLeg(value)}>
            {value === "load" ? `Load · ${loadPort}` : `Discharge · ${dischargePort}`}
          </button>
        ))}
      </div>
      {agencies === null ? <p className="pda-history__status" role="status">Loading agencies at {port}…</p> : agencies.length === 0 ? (
        <p className="pda-history__status">No agency is listed at {port} yet.</p>
      ) : (
        <fieldset className="pda-quotes__choose">
          <legend>Agencies at {port}</legend>
          {agencies.map((agency) => (
            <label key={agency.agencyId}><input type="checkbox" checked={chosen.includes(agency.agencyId)} onChange={() => setChosen((c) => toggle(c, agency.agencyId))} /> {agency.displayName}</label>
          ))}
        </fieldset>
      )}
      <fieldset className="pda-quotes__choose">
        <legend>Services to quote</legend>
        {PDA_ROUTE_SERVICE_CODES.map((code) => (
          <label key={code}><input type="checkbox" checked={services.includes(code)} onChange={() => setServices((s) => toggle(s, code))} /> {PDA_SERVICE_LABELS[code]}</label>
        ))}
      </fieldset>
      <label className="pda-quotes__note">Note to the agencies (optional)<textarea className="asb-control" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <label className="pda-quotes__reveal"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Share my company name and the vessel's flag with these agencies (otherwise they see the vessel type and size, cargo and call facts only)</label>
      <div className="pda-save__actions">
        <button type="button" className="pda-save__button pda-save__button--primary" disabled={busy || !chosen.length || !services.length} onClick={() => void send()}>
          {busy ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Send request
        </button>
      </div>
      {message ? <p className="pda-history__status" role="status">{message}</p> : null}
    </section>
  );
}
