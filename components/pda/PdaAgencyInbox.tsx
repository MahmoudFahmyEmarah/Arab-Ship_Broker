"use client";

// The agency's PDA requests (Agents phase 2; shown in the design's Agent Portal, owner B2ALL-061). Staff of an
// ASB-invited agency see the quote requests addressed to their agency — masked: vessel type and size, cargo and call
// facts, never the vessel name, IMO or the member unless the member revealed their company — and answer with a quote
// (append-only; a revision is a new quote) or decline with a reason. Nothing is kept in the browser.
import * as React from "react";
import { Loader2, Plus, RefreshCw, Send, Trash2, XCircle } from "lucide-react";

import { declineAgencyRequest, loadAgencyInbox, submitAgencyQuote } from "@/app/(dashboard)/dashboard/agency/actions";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import { validateQuoteLines, type PdaAgencyInboxItem, type PdaQuoteLineDraft } from "@/lib/pda/quote-requests";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: PdaAgencyInboxItem[] };

const fmt = (n: number | undefined, unit = "") => (n == null ? "—" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n)}${unit}`);
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

/** The PDA requests addressed to the signed-in staff member's agency; `onCount` reports how many await an answer. */
export function PdaAgencyRequests({ onCount }: { onCount?: (awaiting: number) => void }) {
  const [state, setState] = React.useState<Load>({ status: "loading" });
  const sequence = React.useRef(0);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    setState({ status: "loading" });
    const res = await loadAgencyInbox();
    if (run !== sequence.current) return;
    setState(res.ok ? { status: "ready", items: res.data } : { status: "error", message: res.error });
    if (res.ok) onCount?.(res.data.filter((i) => i.requestStatus === "open" && i.myStatus === "sent").length);
  }, [onCount]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <section className="pda-agency ap-list" aria-label="PDA requests">
      <div className="ap-list__bar">
        <button type="button" className="asb-btn" onClick={() => void load()}><RefreshCw size={13} aria-hidden="true" /> Refresh</button>
      </div>
      {state.status === "loading" ? <p className="ap-hint" role="status" aria-busy="true">Loading requests…</p> : null}
      {state.status === "error" ? <p className="ap-hint ap-hint--error" role="alert">{state.message}</p> : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <div className="ap-panel"><div className="ap-panel__bd ap-hint">No request yet. You will be notified when a member asks your agency for a quote.</div></div>
      ) : null}
      {state.status === "ready" ? state.items.map((item) => <RequestCard key={`${item.requestId}-${item.agencyId}`} item={item} onDone={() => void load()} />) : null}
    </section>
  );
}

const TONE: Record<string, string> = { sent: "wait", quoted: "ok", declined: "muted", withdrawn: "muted", expired: "muted", accepted: "ok" };

function RequestCard({ item, onDone }: { item: PdaAgencyInboxItem; onDone: () => void }) {
  const s = item.snapshot;
  const open = item.requestStatus === "open" && item.myStatus !== "declined";
  const latest = item.quotes[0] ?? null;
  const status = item.requestStatus === "open" ? item.myStatus : item.requestStatus;
  const label = item.requestStatus === "accepted" ? (item.quotes.some((q) => q.accepted) ? "your quote was accepted" : "another agency's quote was accepted")
    : item.requestStatus !== "open" ? item.requestStatus : item.myStatus === "sent" ? "awaiting your answer" : item.myStatus;
  return (
    <article className="pda-agency__card ap-panel" aria-labelledby={`req-${item.requestId}`}>
      <div className="ap-panel__hd">
        <h2 id={`req-${item.requestId}`} className="ap-req__port">{s.port?.name ?? item.port} <em>{item.port}{s.port?.terminal ? ` · ${s.port.terminal}` : ""}</em></h2>
        <span className={`ap-badge is-${TONE[status] ?? "muted"}`}>{label}</span>
      </div>
      <div className="ap-panel__bd ap-req">
        <div className="ap-req__kv"><span>From</span><b>{s.requester?.company ?? "Member (identity not shared)"}</b></div>
        <div className="ap-req__kv"><span>Vessel</span><b>{s.vessel?.type ?? "—"} · DWT {fmt(s.vessel?.dwt)} · GT {fmt(s.vessel?.gt)} · LOA {fmt(s.vessel?.loaM, " m")} · draft {fmt(s.vessel?.registeredMaxDraftM, " m")} · flag {s.vessel?.flagState ?? "shared with the member's identity"}</b></div>
        <div className="ap-req__kv"><span>Cargo</span><b>{s.call?.cargoType ? `${s.call.cargoType} · ` : ""}{fmt(s.call?.cargoQuantityMt, " MT")} {s.call?.cargoStatus ?? ""}</b></div>
        <div className="ap-req__kv"><span>Call</span><b>{s.callDate ? day(s.callDate) : "—"} · {fmt(s.call?.days, " d")} · {s.call?.location ?? "—"}{s.call?.voyageScope ? ` · ${s.call.voyageScope}` : ""}</b></div>
        <div className="ap-req__kv"><span>Services</span><b>{item.services.map((c) => PDA_SERVICE_LABELS[c]).join(" · ")}</b></div>
        {item.note ? <div className="ap-req__kv"><span>Note</span><b>{item.note}</b></div> : null}
        <div className="ap-req__kv"><span>Answer by</span><b>{day(item.expiresAt)} <em className="ap-ref">received {day(item.createdAt)}</em></b></div>
        {item.myStatus === "declined" ? <div className="ap-req__kv"><span>You declined</span><b>{item.declineReason}</b></div> : null}
        {latest ? (
          <div className="ap-req__kv"><span>Your quote</span><b>{latest.currency} {fmt(latest.total)} · valid until {day(latest.validUntil)} · revision {latest.revision}{latest.reference ? ` · ref ${latest.reference}` : ""}{latest.enteredVia === "desk" ? " · recorded by Arab ShipBroker from your email" : ""}{latest.accepted ? " · accepted by the member" : ""}</b></div>
        ) : null}
        {open ? <QuoteForm item={item} onDone={onDone} /> : null}
      </div>
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
    <div className="ap-quote">
      <h3 className="ap-quote__t">{item.quotes.length ? "Send a revised quote" : "Send a quote"}</h3>
      <div className="ap-quote__lines">
        {lines.map((line, index) => (
          <div key={index} className="ap-quote__line">
            <label><span className="asb-sr-only">Charge</span><input className="ap-inp" value={line.label} placeholder="Charge" onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)))} /></label>
            <label><span className="asb-sr-only">Service</span>
              <select className="ap-inp" value={line.serviceCode} onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, serviceCode: e.target.value } : l)))}>
                <option value="">Other</option>
                {item.services.map((code) => <option key={code} value={code}>{PDA_SERVICE_LABELS[code]}</option>)}
              </select>
            </label>
            <label><span className="asb-sr-only">Amount</span><input className="ap-inp" inputMode="decimal" value={line.amount} placeholder="0.00" onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))} /></label>
            <button type="button" className="asb-btn" aria-label={`Remove ${line.label || "line"}`} onClick={() => setLines((all) => all.filter((_, i) => i !== index))}><Trash2 size={13} aria-hidden="true" /></button>
          </div>
        ))}
        <button type="button" className="asb-btn" onClick={() => setLines((all) => [...all, { label: "", serviceCode: "", amount: "" }])}><Plus size={13} aria-hidden="true" /> Add line</button>
      </div>
      <div className="ap-quote__terms">
        <div className="ap-field"><label htmlFor={`cur-${item.requestId}`}>Currency</label><input id={`cur-${item.requestId}`} className="ap-inp" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
        <div className="ap-field"><label htmlFor={`valid-${item.requestId}`}>Valid until</label><input id={`valid-${item.requestId}`} className="ap-inp" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
        <div className="ap-field"><label htmlFor={`ref-${item.requestId}`}>Your reference</label><input id={`ref-${item.requestId}`} className="ap-inp" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div className="ap-field ap-field--wide"><label htmlFor={`note-${item.requestId}`}>Note to the member</label><textarea id={`note-${item.requestId}`} className="ap-inp ap-ta" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <p className="ap-hint" aria-live="polite">Total: <b>{checked.ok ? `${currency} ${fmt(checked.total)}` : "—"}</b></p>
      <div className="ap-quote__ft">
        {item.myStatus === "sent" ? (
          <>
            <label className="ap-quote__decline"><span className="asb-sr-only">Reason for declining</span><input className="ap-inp" placeholder="Reason, if you decline" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="asb-btn" disabled={busy !== "" || reason.trim().length < 3} onClick={() => void decline()}>
              {busy === "decline" ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />} Decline
            </button>
          </>
        ) : null}
        <button type="button" className="asb-btn is-primary" disabled={busy !== "" || !validUntil} onClick={() => void send()}>
          {busy === "quote" ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Send quote
        </button>
      </div>
      {error ? <p className="ap-hint ap-hint--error" role="alert">{error}</p> : null}
    </div>
  );
}
