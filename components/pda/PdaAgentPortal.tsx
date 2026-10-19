"use client";

// PDA · the Agent Portal (the design's "Ports Module · Third-party access", owner B2ALL-061). One frame, three views:
//   Request PDAs     — every member: the agencies ASB has invited, and the member's quote requests with each answer
//   Agency workspace — staff of a listed agency only (the database decides, get_my_pda_agency): the agency's page,
//                      as Arab ShipBroker holds it, and the PDA requests addressed to it
//   ASB review       — admins only: claims and change sets (none exist yet: agencies are invited, not self-claimed),
//                      and the way to the desk that records emailed quotes
// Where the platform holds no data the panel says so; nothing is simulated.
import * as React from "react";
import { ExternalLink, FileText, ShieldCheck, UserRound } from "lucide-react";

import "@/components/design-system/asb-ds.css";
import "./pda-route-estimator.css";
import "./ports-module.css";

import { listAllPdaQuoteRequests, loadAgentPortalViewer } from "@/app/(dashboard)/dashboard/ports-da/actions";
import type { PdaMyAgency } from "@/lib/pda/agents";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import type { PdaQuoteRequest } from "@/lib/pda/quote-requests";

import { PdaAgencyRequests } from "./PdaAgencyInbox";
import { PdaAgentsWorkspace } from "./PdaAgentsWorkspace";

type View = "request" | "agency" | "review";
const money = (n: number, c: string) => `${c} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** The Agents tab of the estimator (member mode) or the agency's own page (agency mode, from /dashboard/agency). */
export function PdaAgentPortal({ mode, initialPort = null, agency: agencyFromPage = null }: {
  mode: "member" | "agency";
  initialPort?: string | null;
  agency?: PdaMyAgency | null;
}) {
  const [who, setWho] = React.useState<{ isAdmin: boolean; agency: PdaMyAgency | null } | null>(mode === "agency" ? { isAdmin: false, agency: agencyFromPage } : null);
  const [view, setView] = React.useState<View>(mode === "agency" ? "agency" : "request");
  const [awaiting, setAwaiting] = React.useState(0);

  React.useEffect(() => {
    if (mode !== "member") return;
    let live = true;
    void loadAgentPortalViewer().then((res) => { if (live) setWho(res.ok ? res.data : { isAdmin: false, agency: null }); });
    return () => { live = false; };
  }, [mode]);

  const views: { id: View; label: string; icon: React.ReactNode }[] = [
    ...(mode === "member" ? [{ id: "request" as const, label: "Request PDAs", icon: <FileText size={14} aria-hidden="true" /> }] : []),
    ...(who?.agency ? [{ id: "agency" as const, label: "Agency workspace", icon: <UserRound size={14} aria-hidden="true" /> }] : []),
    ...(who?.isAdmin ? [{ id: "review" as const, label: "ASB review", icon: <ShieldCheck size={14} aria-hidden="true" /> }] : []),
  ];

  return (
    <section className={`ap-shell${mode === "member" ? " is-embed" : ""}`} aria-label="Agent Portal">
      <div className="ap-main">
        <div className="ap-band">
          {mode === "agency" ? (
            <div className="ap-band__tt">
              <div className="ap-band__ey">Ports Module · Third-party access</div>
              <h1 className="ap-band__t">Agent Portal</h1>
            </div>
          ) : null}
          {views.length > 1 ? (
            <div className="ap-viewtog" role="tablist" aria-label="Agent Portal views">
              {views.map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? "is-on" : undefined} onClick={() => setView(v.id)}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ap-scroll">
          {view === "request" ? <RequestView initialPort={initialPort} />
            : view === "agency" ? (who?.agency ? <AgencyView agency={who.agency} awaiting={awaiting} onAwaiting={setAwaiting} /> : <NotStaff />)
            : <ReviewView />}
        </div>
      </div>
    </section>
  );
}

function NotStaff() {
  return (
    <div className="ap-wrap">
      <div className="ap-panel">
        <div className="ap-panel__hd">Agency workspace</div>
        <div className="ap-panel__bd ap-hint">
          This workspace is for staff of port agencies invited by Arab ShipBroker. Your account is not a member of a listed agency.
          If your agency works with us, ask Arab ShipBroker to add you to it.
        </div>
      </div>
    </div>
  );
}

// ── Request PDAs ─────────────────────────────────────────────────────────────────────────────────────────────────────
function RequestView({ initialPort }: { initialPort: string | null }) {
  const [requests, setRequests] = React.useState<PdaQuoteRequest[] | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let live = true;
    void listAllPdaQuoteRequests().then((res) => {
      if (!live) return;
      if (res.ok) setRequests(res.data); else setError(res.error);
    });
    return () => { live = false; };
  }, []);

  return (
    <div className="ap-wrap">
      <div className="ap-cols">
        <div className="ap-panel">
          <div className="ap-panel__hd">Your PDA requests <span className="ap-scope">Masked by default</span></div>
          <div className="ap-panel__bd">
            {error ? <p className="ap-hint ap-hint--error" role="alert">{error}</p> : null}
            {requests === null && !error ? <p className="ap-hint" role="status">Loading your requests…</p> : null}
            {requests && requests.length === 0 ? <p className="ap-hint">No request yet. Save an estimate, then open Quotes on it under Saved estimates.</p> : null}
            {requests && requests.length ? (
              <div className="ap-cmp__scroll">
                <table className="ap-cmp">
                  <caption className="asb-sr-only">Your quote requests and each agency&apos;s answer</caption>
                  <thead><tr><th scope="col">Port</th><th scope="col">Agent</th><th scope="col" className="num">Quoted PDA</th><th scope="col">Valid</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {requests.flatMap((request) => request.agencies.map((agency) => {
                      const quote = agency.quotes[0];
                      return (
                        <tr key={`${request.requestId}-${agency.agencyId}`} className={agency.status === "sent" ? "ap-cmp__wait" : undefined}>
                          <td><b>{request.port}</b><span className="ap-cmp__sub">{request.leg === "load" ? "load" : "discharge"} · {day(request.createdAt)}</span></td>
                          <td>{agency.displayName}{quote?.enteredVia === "desk" ? <span className="ap-cmp__sub">recorded by Arab ShipBroker</span> : null}</td>
                          <td className="num">{quote ? money(quote.total, quote.currency) : "-"}</td>
                          <td>{quote ? day(quote.validUntil) : "-"}</td>
                          <td>{quote?.accepted ? "accepted" : agency.status === "quoted" ? `quoted${quote && quote.revision > 1 ? ` · rev ${quote.revision}` : ""}` : agency.status === "declined" ? "declined" : request.status === "withdrawn" ? "withdrawn" : "awaiting response"}</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
        <div className="ap-panel ap-panel--info">
          <div className="ap-panel__hd">How requesting works</div>
          <div className="ap-panel__bd ap-how">
            <div><b>1 · Save your estimate.</b> A request is made from a saved estimate, so the agency prices exactly what you priced.</div>
            <div><b>2 · Choose agencies.</b> Open Quotes on it under Saved estimates and pick agencies listed at that port.</div>
            <div><b>3 · Compare and accept.</b> Each answer sits next to your estimate; accepting one saves a new version of it.</div>
          </div>
        </div>
      </div>
      <PdaAgentsWorkspace initialPort={initialPort} embedded />
    </div>
  );
}

// ── Agency workspace ─────────────────────────────────────────────────────────────────────────────────────────────────
type AgencyTab = "page" | "berthing" | "pda" | "team" | "subs";

function AgencyView({ agency, awaiting, onAwaiting }: { agency: PdaMyAgency; awaiting: number; onAwaiting: (n: number) => void }) {
  const [tab, setTab] = React.useState<AgencyTab>("pda");
  const tabs: { id: AgencyTab; label: string; n?: number }[] = [
    { id: "page", label: "Page & fees" }, { id: "berthing", label: "Berthing notes" }, { id: "pda", label: "PDA requests", n: awaiting },
    { id: "team", label: "Team" }, { id: "subs", label: "Submissions" },
  ];
  return (
    <div className="ap-wrap">
      <div className="ap-idbar">
        <div className="ap-idbar__ava" aria-hidden="true">{initials(agency.displayName)}</div>
        <div className="ap-idbar__who"><b>{agency.displayName}</b><span>{agency.memberRole ? `${agency.memberRole} · ` : ""}agency staff</span></div>
        <span className="ap-badge is-ok">Listed by Arab ShipBroker</span>
        <span className="ap-idbar__note">Arab ShipBroker invites and lists agencies. Vessels, cargoes and ports shown here resolve to platform records; the member&apos;s identity stays hidden unless they share it.</span>
      </div>
      <div className="ap-tabs" role="tablist" aria-label="Agency workspace">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`ap-tab${tab === t.id ? " is-on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}{t.n ? <span className="ap-tab__n">{t.n}</span> : null}
          </button>
        ))}
      </div>
      {tab === "page" ? (
        <div className="ap-cols">
          <div className="ap-panel">
            <div className="ap-panel__hd">Contacts &amp; coverage <span className="ap-scope">Agency page</span></div>
            <div className="ap-panel__bd">
              <div className="ap-field"><label>Agency</label><div className="ap-ro">{agency.displayName}</div></div>
              <div className="ap-field"><label>Website</label><div className="ap-ro">{agency.website ? <a href={agency.website} target="_blank" rel="noreferrer noopener">{agency.website} <ExternalLink size={12} aria-hidden="true" /></a> : <span className="ap-none">Not recorded yet</span>}</div></div>
              <div className="ap-field"><label>Ops desk phone</label><div className="ap-ro"><span className="ap-none">Not recorded yet</span></div></div>
              <div className="ap-field"><label>Ops email</label><div className="ap-ro"><span className="ap-none">Not recorded yet</span></div></div>
              <div className="ap-field">
                <label>Coverage - ports served <span className="ap-db">from the port registry</span></label>
                <div className="ap-coverage">
                  {agency.ports.length ? agency.ports.map((p) => (
                    <span key={p.portLocode} className="ap-portchip" title={p.services.map((s) => PDA_SERVICE_LABELS[s]).join(", ")}>{p.portLocode} · {p.portName}</span>
                  )) : <span className="ap-none">No port listed yet</span>}
                </div>
              </div>
              <div className="ap-field"><label>Published agency fee</label><div className="ap-ro"><span className="ap-none">Not recorded yet</span></div></div>
            </div>
            <div className="ap-panel__ft"><span className="ap-dirty">Held by Arab ShipBroker</span><span></span></div>
          </div>
          <div className="ap-panel ap-panel--info">
            <div className="ap-panel__hd">How your page is kept</div>
            <div className="ap-panel__bd ap-how">
              <div><b>Arab ShipBroker keeps it.</b> The listing, the ports you attend and the services you quote are set by the desk.</div>
              <div><b>Ask for a change.</b> Write to the desk; self-service edits with review come later.</div>
              <div><b>Members see it.</b> The page appears in the Agents tab and on each port you attend.</div>
            </div>
          </div>
        </div>
      ) : tab === "pda" ? (
        <PdaAgencyRequests onCount={onAwaiting} />
      ) : (
        <div className="ap-panel">
          <div className="ap-panel__hd">{tab === "berthing" ? "Berthing notes" : tab === "team" ? "Team" : "Submissions"}</div>
          <div className="ap-panel__bd ap-hint">
            {tab === "berthing" ? "Not recorded yet. Berthing notes from agencies will appear on the port record once agencies can submit them for review."
              : tab === "team" ? "Not recorded yet. Your colleagues are added to the agency by Arab ShipBroker."
              : "No submissions yet. Changes you send for review will be listed here."}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ASB review (admins) ──────────────────────────────────────────────────────────────────────────────────────────────
function ReviewView() {
  return (
    <div className="ap-wrap">
      <div className="ap-cols">
        <div className="ap-panel">
          <div className="ap-panel__hd">Claim requests</div>
          <div className="ap-panel__bd ap-hint">No claim requests. Agencies are invited by Arab ShipBroker, so none claims a listing itself.</div>
        </div>
        <div className="ap-panel">
          <div className="ap-panel__hd">Change sets awaiting review</div>
          <div className="ap-panel__bd ap-hint">No change sets yet. Agencies cannot edit their page themselves today.</div>
        </div>
      </div>
      <div className="ap-panel">
        <div className="ap-panel__hd">Quotes received by email <span className="ap-scope">ASB desk</span></div>
        <div className="ap-panel__bd ap-hint">
          An agency without a portal account answers by email; the desk records its quote in the admin console.{" "}
          <a href="/admin/port-agents">Open Port Agents</a>
        </div>
      </div>
      <div className="ap-panel">
        <div className="ap-panel__hd">Decision log</div>
        <div className="ap-panel__bd ap-hint">Nothing decided yet. Registry changes are logged in the Port Agents console.</div>
      </div>
    </div>
  );
}
