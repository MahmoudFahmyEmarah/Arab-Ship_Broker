"use client";

// PDA · quote requests for one saved estimate (Agents phase 2, O2ALL-009 A1 c / A5; phase 3 A4). The member asks
// ASB-invited agencies at one port for a real quote; the database sends a MASKED snapshot unless the member chooses to
// share their company. Answers (quotes, revisions, declines) are listed here, each quote next to the member's own
// estimate for that port; accepting one saves a new version of the estimate with that port priced from the quote.
import * as React from "react";
import { Check, Loader2, Send, XCircle } from "lucide-react";

import {
  acceptPdaQuote, listPdaQuoteRequests, loadPdaAgentsAtPort, loadPdaEstimateSet, previewPdaQuoteAcceptance, requestPdaQuotes,
  withdrawPdaQuotes, type PdaQuoteAcceptancePreview,
} from "@/app/(dashboard)/dashboard/ports-da/actions";
import type { PdaAgency } from "@/lib/pda/agents";
import type { PdaSavedLeg } from "@/lib/pda/estimate-sets";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import { compareQuoteWithEstimate } from "@/lib/pda/quote-acceptance";
import type { PdaAgencyQuote, PdaQuoteRequest } from "@/lib/pda/quote-requests";
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "@/lib/pda/route-types";

const money = (n: number, c: string) => `${c} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const known = (n: number | null, c: string) => (n == null ? "not sourced" : money(n, c));
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

type Legs = { load: PdaSavedLeg; discharge: PdaSavedLeg } | null;

export function PdaQuoteRequests({ setId, loadPort, dischargePort, isLatest, mine, onAccepted }: {
  setId: string; loadPort: string; dischargePort: string; isLatest: boolean; mine: boolean; onAccepted?: () => void;
}) {
  const [requests, setRequests] = React.useState<PdaQuoteRequest[] | null>(null);
  const [legs, setLegs] = React.useState<Legs>(null);
  const [error, setError] = React.useState("");
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    const [res, detail] = await Promise.all([listPdaQuoteRequests(setId), loadPdaEstimateSet(setId)]);
    if (run !== sequence.current) return;
    if (res.ok) { setRequests(res.data); setError(""); } else setError(res.error);
    setLegs(detail.ok ? { load: detail.data.load, discharge: detail.data.discharge } : null);
  }, [setId]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="pda-quotes">
      {error ? <p className="pda-save__error" role="alert">{error}</p> : null}
      {requests === null && !error ? <p className="pda-history__status" role="status">Loading quote requests…</p> : null}
      {requests?.map((request) => (
        <RequestRow key={request.requestId} request={request} estimate={legs ? legs[request.leg] : null} canAccept={isLatest && mine}
          onChange={() => void load()} onAccepted={onAccepted} />
      ))}
      {!mine ? (
        <p className="pda-history__status">Only the member who saved this estimate can request and accept quotes for it.</p>
      ) : isLatest ? <NewRequest setId={setId} loadPort={loadPort} dischargePort={dischargePort} onSent={() => void load()} /> : (
        <p className="pda-history__status">Quotes are requested and accepted from the latest version of an estimate.</p>
      )}
    </div>
  );
}

/** The quote beside the member's own estimate for that port (same currency only; otherwise no difference is claimed). */
function Comparison({ estimate, quote }: { estimate: PdaSavedLeg | null; quote: PdaAgencyQuote }) {
  if (!estimate) return null;
  const sameCurrency = estimate.convertedCurrency === quote.currency && estimate.nativeCurrency !== quote.currency
    ? { currency: estimate.convertedCurrency, total: estimate.convertedTotal }
    : { currency: estimate.nativeCurrency, total: estimate.nativeTotal };
  const c = compareQuoteWithEstimate(sameCurrency, quote);
  return (
    <span className="pda-quotes__compare">
      {c.comparable
        ? <>your estimate {money(sameCurrency.total!, sameCurrency.currency)} · quote {c.difference === 0 ? "equal" : `${c.difference > 0 ? "+" : "−"}${money(Math.abs(c.difference), quote.currency)}`}{c.percent != null && c.difference !== 0 ? ` (${c.percent > 0 ? "+" : ""}${c.percent} %)` : ""}</>
        : <>no comparison: {c.reason}</>}
    </span>
  );
}

function RequestRow({ request, estimate, canAccept, onChange, onAccepted }: {
  request: PdaQuoteRequest; estimate: PdaSavedLeg | null; canAccept: boolean; onChange: () => void; onAccepted?: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [confirm, setConfirm] = React.useState<{ quoteId: string; preview: PdaQuoteAcceptancePreview } | null>(null);
  const generation = React.useRef(0);
  const acceptedAny = request.agencies.some((a) => a.quotes.some((q) => q.accepted));

  async function withdraw() {
    setBusy(true);
    const res = await withdrawPdaQuotes(request.requestId);
    setBusy(false);
    if (res.ok) onChange(); else setError(res.error);
  }
  async function prepare(quoteId: string) {
    const run = ++generation.current;
    setBusy(true); setError(""); setConfirm(null);
    const res = await previewPdaQuoteAcceptance(quoteId);
    if (run !== generation.current) return;
    setBusy(false);
    if (res.ok) setConfirm({ quoteId, preview: res.data }); else setError(res.error);
  }
  async function accept() {
    if (!confirm) return;
    const run = ++generation.current;
    setBusy(true); setError("");
    const res = await acceptPdaQuote(confirm.quoteId, confirm.preview.totals);
    if (run !== generation.current) return;
    setBusy(false);
    if (res.ok) { setConfirm(null); onChange(); onAccepted?.(); } else setError(res.error);
  }

  return (
    <section className="pda-quotes__request" aria-label={`Quote request for ${request.port}`}>
      <div className="pda-quotes__head">
        <b>{request.leg === "load" ? "Load" : "Discharge"} port {request.port}</b>
        <span>{day(request.createdAt)} · {request.status === "withdrawn" ? "withdrawn" : `open until ${day(request.expiresAt)}`} · {request.revealIdentity ? "company shared" : "identity hidden"}</span>
        {request.status === "open" && request.mine && !acceptedAny ? (
          <button type="button" className="pda-save__button" disabled={busy} onClick={() => void withdraw()}><XCircle size={13} aria-hidden="true" /> Withdraw</button>
        ) : null}
      </div>
      <ul className="pda-quotes__agencies">
        {request.agencies.map((agency) => {
          const quote = agency.quotes[0];
          const acceptable = canAccept && request.mine && request.status === "open" && !acceptedAny && agency.status === "quoted" && quote && quote.validUntil >= today();
          return (
            <li key={agency.agencyId}>
              <span>{agency.displayName}</span>
              <span>
                {agency.status === "quoted" && quote
                  ? <><b>{money(quote.total, quote.currency)}</b> · valid until {day(quote.validUntil)}{quote.revision > 1 ? ` · revision ${quote.revision}` : ""}{quote.reference ? ` · ref ${quote.reference}` : ""}{quote.accepted ? " · accepted" : ""}</>
                  : agency.status === "declined" ? `declined: ${agency.declineReason ?? ""}` : "awaiting answer"}
              </span>
              {agency.status === "quoted" && quote ? <Comparison estimate={estimate} quote={quote} /> : null}
              {acceptable ? (
                <button type="button" className="pda-save__button" disabled={busy} onClick={() => void prepare(quote.quoteId)}>
                  <Check size={13} aria-hidden="true" /> Accept as new version
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {confirm ? (
        <div className="pda-quotes__confirm" role="group" aria-label="Confirm the new version">
          <p>
            Accepting saves a <b>new version</b> of this estimate: {confirm.preview.leg === "load" ? "the load port" : "the discharge port"} {confirm.preview.port} is
            priced from {confirm.preview.agencyName}&apos;s quote; the other port and the transits are recomputed at today&apos;s published tariffs.
            The current version stays in your history.
          </p>
          <p>
            Load port {known(confirm.preview.totals.loadPortKnown, confirm.preview.displayCurrency)} · discharge port {known(confirm.preview.totals.dischargePortKnown, confirm.preview.displayCurrency)} ·
            all in, known <b>{known(confirm.preview.totals.allInKnown, confirm.preview.displayCurrency)}</b>{confirm.preview.notSourced ? ` · ${confirm.preview.notSourced} not sourced` : " · complete"}
          </p>
          <div className="pda-save__actions">
            <button type="button" className="pda-save__button pda-save__button--primary" disabled={busy} onClick={() => void accept()}>
              {busy ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />} Save the new version
            </button>
            <button type="button" className="pda-save__button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
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
