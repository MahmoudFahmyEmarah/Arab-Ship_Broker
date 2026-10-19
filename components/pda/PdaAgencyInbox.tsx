"use client";

// The agency inbox (Agents phase 2, O2ALL-009 A1 c / A5). Staff of an ASB-invited agency see the quote requests
// addressed to their agency — masked: vessel size, cargo quantity and call facts, never the vessel name, IMO or the
// member unless the member revealed their company — and answer with a quote (append-only; a revision is a new quote)
// or decline with a reason. Nothing is kept in the browser.
import * as React from "react";
import { Inbox, Loader2, Plus, RefreshCw, Send, Trash2, XCircle } from "lucide-react";

import "@/components/design-system/asb-ds.css";
import "./pda-route-estimator.css";

import { declineAgencyRequest, loadAgencyInbox, submitAgencyQuote } from "@/app/(dashboard)/dashboard/agency/actions";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import { validateQuoteLines, type PdaAgencyInboxItem, type PdaQuoteLineDraft } from "@/lib/pda/quote-requests";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: PdaAgencyInboxItem[] };

const fmt = (n: number | undefined, unit = "") => (n == null ? "—" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n)}${unit}`);
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

export function PdaAgencyInbox({ agency }: { agency: { displayName: string; ports: { portLocode: string; portName: string }[] } | null }) {
  const [state, setState] = React.useState<Load>({ status: "loading" });
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    setState({ status: "loading" });
    const res = await loadAgencyInbox();
    if (run !== sequence.current) return;
    setState(res.ok ? { status: "ready", items: res.data } : { status: "error", message: res.error });
  }, []);

  React.useEffect(() => {
    if (agency) void load();
  }, [agency, load]);

  if (!agency) {
    return (
      <div className="asb-ds pda-route pda-route--comfortable">
        <section className="pda-agency asb-card">
          <h1 className="pda-ports__title">Agency inbox</h1>
          <p className="pda-ports__lede">This inbox is for staff of port agencies invited by Arab ShipBroker. Your account is not a member of a listed agency. If your agency works with us, ask Arab ShipBroker to add you to it.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="asb-ds pda-route pda-route--comfortable">
      <section className="pda-agency" aria-labelledby="pda-agency-title">
        <header className="pda-agents__head asb-card">
          <div>
            <h1 id="pda-agency-title" className="pda-ports__title"><Inbox size={16} aria-hidden="true" /> {agency.displayName} · quote requests</h1>
            <p className="pda-ports__lede">
              Requests from members for the ports you are listed at: {agency.ports.map((p) => p.portName).join(", ") || "none yet"}.
              The member&apos;s identity is hidden unless they chose to share their company. Every quote you send is kept; sending again creates a revision.
            </p>
          </div>
          <button type="button" className="pda-save__button" onClick={() => void load()}><RefreshCw size={13} aria-hidden="true" /> Refresh</button>
        </header>
        {state.status === "loading" ? <p className="pda-ports__status asb-card" role="status" aria-busy="true">Loading requests…</p> : null}
        {state.status === "error" ? <p className="pda-save__error asb-card" role="alert">{state.message}</p> : null}
        {state.status === "ready" && state.items.length === 0 ? <p className="pda-ports__status asb-card">No request yet. You will be notified when a member asks your agency for a quote.</p> : null}
        {state.status === "ready" ? state.items.map((item) => <RequestCard key={`${item.requestId}-${item.agencyId}`} item={item} onDone={() => void load()} />) : null}
      </section>
    </div>
  );
}

function RequestCard({ item, onDone }: { item: PdaAgencyInboxItem; onDone: () => void }) {
  const s = item.snapshot;
  const open = item.requestStatus === "open" && item.myStatus !== "declined";
  const latest = item.quotes[0] ?? null;
  return (
    <article className="pda-agency__card asb-card" aria-labelledby={`req-${item.requestId}`}>
      <div className="pda-agency__head">
        <h2 id={`req-${item.requestId}`}>{s.port?.name ?? item.port} <em>{item.port}{s.port?.terminal ? ` · ${s.port.terminal}` : ""}</em></h2>
        <span className={`pda-agency__status is-${item.requestStatus === "open" ? item.myStatus : item.requestStatus}`}>
          {item.requestStatus === "accepted" ? (item.quotes.some((q) => q.accepted) ? "your quote was accepted" : "another agency's quote was accepted")
            : item.requestStatus !== "open" ? item.requestStatus : item.myStatus === "sent" ? "awaiting your answer" : item.myStatus}
        </span>
      </div>
      <dl className="pda-agency__facts">
        <div><dt>Call date</dt><dd>{s.callDate ? day(s.callDate) : "—"}</dd></div>
        <div><dt>Days</dt><dd>{fmt(s.call?.days, " d")}</dd></div>
        <div><dt>Vessel</dt><dd>{s.vessel?.type ?? "—"} · DWT {fmt(s.vessel?.dwt)} · GT {fmt(s.vessel?.gt)}</dd></div>
        <div><dt>LOA / draft</dt><dd>{fmt(s.vessel?.loaM, " m")} / {fmt(s.vessel?.registeredMaxDraftM, " m")}</dd></div>
        <div><dt>Flag</dt><dd>{s.vessel?.flagState ?? "shared with the member's identity"}</dd></div>
        <div><dt>Cargo</dt><dd>{s.call?.cargoType ? `${s.call.cargoType} · ` : ""}{fmt(s.call?.cargoQuantityMt, " MT")} {s.call?.cargoStatus ?? ""}</dd></div>
        <div><dt>Location</dt><dd>{s.call?.location ?? "—"}{s.call?.voyageScope ? ` · ${s.call.voyageScope}` : ""}</dd></div>
        <div><dt>Requested by</dt><dd>{s.requester?.company ?? "Member (identity not shared)"}</dd></div>
      </dl>
      <p className="pda-agency__services"><b>Services:</b> {item.services.map((c) => PDA_SERVICE_LABELS[c]).join(" · ")}</p>
      {item.note ? <p className="pda-agency__note"><b>Note:</b> {item.note}</p> : null}
      <p className="pda-agency__meta">Received {day(item.createdAt)} · answer by {day(item.expiresAt)}</p>
      {item.myStatus === "declined" ? <p className="pda-agency__meta">You declined: {item.declineReason}</p> : null}
      {latest ? (
        <p className="pda-agency__meta">Your latest quote (revision {latest.revision}): <b>{latest.currency} {fmt(latest.total)}</b>, valid until {day(latest.validUntil)}{latest.reference ? ` · ref ${latest.reference}` : ""}{latest.accepted ? " · accepted by the member" : ""}</p>
      ) : null}
      {open ? <QuoteForm item={item} onDone={onDone} /> : null}
    </article>
  );
}

function QuoteForm({ item, onDone }: { item: PdaAgencyInboxItem; onDone: () => void }) {
  const [lines, setLines] = React.useState<PdaQuoteLineDraft[]>(() => item.services.map((code) => ({ label: PDA_SERVICE_LABELS[code], serviceCode: code, amount: "" })));
  const [currency, setCurrency] = React.useState(item.quotes[0]?.currency ?? "USD");
  const [validUntil, setValidUntil] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState<"" | "quote" | "decline">("");
  const [error, setError] = React.useState("");
  const checked = validateQuoteLines(lines, item.services);

  async function send() {
    if (!checked.ok) { setError(checked.error); return; }
    setBusy("quote"); setError("");
    const res = await submitAgencyQuote({ requestId: item.requestId, agencyId: item.agencyId, currency, lines: checked.lines, validUntil, reference, note });
    setBusy("");
    if (res.ok) onDone(); else setError(res.error);
  }
  async function decline() {
    setBusy("decline"); setError("");
    const res = await declineAgencyRequest(item.requestId, item.agencyId, reason);
    setBusy("");
    if (res.ok) onDone(); else setError(res.error);
  }

  return (
    <div className="pda-agency__form">
      <h3>{item.quotes.length ? "Send a revised quote" : "Send a quote"}</h3>
      <div className="pda-agency__lines">
        {lines.map((line, index) => (
          <div key={index} className="pda-agency__line">
            <label><span className="asb-sr-only">Charge</span><input className="asb-control" value={line.label} placeholder="Charge" onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)))} /></label>
            <label><span className="asb-sr-only">Service</span>
              <select className="asb-control" value={line.serviceCode} onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, serviceCode: e.target.value } : l)))}>
                <option value="">Other</option>
                {item.services.map((code) => <option key={code} value={code}>{PDA_SERVICE_LABELS[code]}</option>)}
              </select>
            </label>
            <label><span className="asb-sr-only">Amount</span><input className="asb-control" inputMode="decimal" value={line.amount} placeholder="0.00" onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))} /></label>
            <button type="button" className="pda-save__button" aria-label={`Remove ${line.label || "line"}`} onClick={() => setLines((all) => all.filter((_, i) => i !== index))}><Trash2 size={13} aria-hidden="true" /></button>
          </div>
        ))}
        <button type="button" className="pda-save__button" onClick={() => setLines((all) => [...all, { label: "", serviceCode: "", amount: "" }])}><Plus size={13} aria-hidden="true" /> Add line</button>
      </div>
      <div className="pda-agency__terms">
        <label>Currency<input className="asb-control" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        <label>Valid until<input className="asb-control" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
        <label>Your reference<input className="asb-control" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        <label className="pda-agency__wide">Note to the member<textarea className="asb-control" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <p className="pda-agency__meta" aria-live="polite">Total: <b>{checked.ok ? `${currency} ${fmt(checked.total)}` : "—"}</b></p>
      <div className="pda-save__actions">
        <button type="button" className="pda-save__button pda-save__button--primary" disabled={busy !== "" || !validUntil} onClick={() => void send()}>
          {busy === "quote" ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Send quote
        </button>
        {item.myStatus === "sent" ? (
          <>
            <label className="pda-agency__decline"><span className="asb-sr-only">Reason for declining</span><input className="asb-control" placeholder="Reason, if you decline" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="pda-save__button" disabled={busy !== "" || reason.trim().length < 3} onClick={() => void decline()}>
              {busy === "decline" ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />} Decline
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="pda-save__error" role="alert">{error}</p> : null}
    </div>
  );
}
