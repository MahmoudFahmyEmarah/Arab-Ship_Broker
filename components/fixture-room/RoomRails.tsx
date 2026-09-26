"use client";

// The right rail: counterparty and parties, recap, subjects, messages,
// activity. Every panel renders the masked read model as the server sent it
// and issues commands through the room's runner.
import * as React from "react";
import Link from "next/link";
import type { FixtureRoomView } from "@/lib/fixture-room/types";
import { relativeTime, shortDateTime } from "@/lib/fixture-room/format";
import { roleLabel } from "@/lib/fixture-room/permissions";
import type { RunCommand } from "./FixtureRoomClient";

const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();

export function CounterpartyCard({ view, run, busy, actForPartyId }: { view: FixtureRoomView; run: RunCommand; busy: boolean; actForPartyId: string | null }) {
  const caps = view.viewer.capabilities;
  const disclosed = view.room.counterpartyDisclosed;
  const principals = view.parties.filter((p) => p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel"));
  const others = view.parties.filter((p) => !(p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel")));
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteId, setInviteId] = React.useState("");
  const [inviteKind, setInviteKind] = React.useState<"org" | "user">("org");
  const mySide = view.viewer.side;
  const myPrincipal = principals.find((p) => p.isViewer);
  const actingRelayed = actForPartyId ? view.parties.find((p) => p.id === actForPartyId) : null;
  return (
    <div className="fxr-sec" data-testid="counterparty-card">
      <div className="fxr-sec__hd">Parties <span className="cnt">{disclosed ? "disclosed" : "protected"}</span></div>
      {principals.map((p) => (
        <div className="fxr-party" key={p.id}>
          <div className="fxr-party__avatar" aria-hidden="true">{p.name ? initials(p.name) : "🔒"}</div>
          <div style={{ minWidth: 0 }}>
            <div className={`fxr-party__name${p.name ? "" : " is-blur"}`}>{p.name ?? p.label}</div>
            <div className="fxr-party__meta">
              <span>{roleLabel(p.side, p.capacity, p.isPlatform)}</span>
              {p.deskLabel && <span>· {p.deskLabel}</span>}
              <span>· {p.status}</span>
              {p.participationMode === "relayed" && <span className="fxr-tag is-relayed">relayed by ASB</span>}
              {p.disclosureAgreed && <span className="fxr-tag is-ok">agreed to disclose</span>}
            </div>
          </div>
        </div>
      ))}
      {others.map((p) => (
        <div className="fxr-party" key={p.id}>
          <div className="fxr-party__avatar" aria-hidden="true">{p.isPlatform ? "ASB" : initials(p.name ?? p.label)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="fxr-party__name">{p.name ?? p.label}</div>
            <div className="fxr-party__meta"><span>{roleLabel(p.side, p.capacity, p.isPlatform)}</span><span>· {p.status}</span></div>
          </div>
        </div>
      ))}
      {!disclosed ? (
        <>
          <p className="fxr-cp__note">Counterparty names are withheld until both principals agree to disclosure. Personal email and phone are never shown in the room.</p>
          {caps.canAgreeDisclosure && (
            (myPrincipal && !myPrincipal.disclosureAgreed) || (actingRelayed && actingRelayed.capacity === "principal" && !actingRelayed.disclosureAgreed)
          ) && (
            <button type="button" className="asb-btn primary" disabled={busy} data-testid="disclosure-agree"
              onClick={() => run("disclosure", (b) => ({ ...b, onBehalfOfPartyId: actForPartyId }))}>
              {actingRelayed ? `Record disclosure consent for ${actingRelayed.label}` : "Agree to disclose our identity"}
            </button>
          )}
          {myPrincipal?.disclosureAgreed && <div className="fxr-hint">You agreed · waiting for the other side.</div>}
        </>
      ) : (
        <p className="fxr-cp__note">Both principals agreed · organisation names and desk labels are shown.</p>
      )}
      {caps.canInvite && (mySide === "cargo" || mySide === "vessel" || view.viewer.isMediator) && (
        <details open={inviteOpen} onToggle={(e) => setInviteOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="fxr-link" style={{ cursor: "pointer" }}>Invite a viewer or broker onto your side</summary>
          <div className="fxr-composer" style={{ marginTop: 6 }}>
            <div className="fxr-composer__row">
              <div className="fxr-field" style={{ flex: "0 0 120px" }}>
                <label htmlFor="fx-invite-kind">Invite by</label>
                <select id="fx-invite-kind" value={inviteKind} onChange={(e) => setInviteKind(e.target.value as "org" | "user")}><option value="org">Organisation id</option><option value="user">Member id</option></select>
              </div>
              <div className="fxr-field"><label htmlFor="fx-invite-id">Id</label><input id="fx-invite-id" value={inviteId} onChange={(e) => setInviteId(e.target.value)} placeholder="uuid" /></div>
            </div>
            <div className="fxr-composer__acts">
              <button type="button" className="asb-btn" disabled={busy || !/^[0-9a-f-]{36}$/i.test(inviteId)} onClick={() => run("invite", (b) => ({
                ...b, side: mySide === "vessel" ? "vessel" : "cargo", capacity: "viewer", orgId: inviteKind === "org" ? inviteId : null, userId: inviteKind === "user" ? inviteId : null,
              })).then((ok) => { if (ok) setInviteId(""); })}>Invite as viewer</button>
              <span className="fxr-hint">Colleagues of your organisation already have access; use this for another firm.</span>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

export function RecapRail({ view, run, busy, actForPartyId }: { view: FixtureRoomView; run: RunCommand; busy: boolean; actForPartyId: string | null }) {
  const caps = view.viewer.capabilities;
  const latest = view.recaps[0] ?? null;
  const agreed = view.terms.filter((t) => t.status === "agreed").length;
  return (
    <div className="fxr-sec" data-testid="recap-rail">
      <div className="fxr-sec__hd">Fixture recap <span className="cnt">{agreed}/{view.terms.length} agreed</span></div>
      {view.terms.map((t) => (
        <div className="fxr-recap__line" key={t.id}>
          <span className="fxr-recap__k">{t.sortOrder} · {t.label}</span>
          <span className={`fxr-recap__v${t.status === "agreed" ? "" : " is-open"}`}>{t.status === "agreed" ? t.agreed?.displayValue : t.status === "withdrawn" ? "withdrawn" : "open"}</span>
        </div>
      ))}
      <div className="fxr-recap__acts">
        {caps.canPublishRecap && (
          <button type="button" className="asb-btn" disabled={busy} data-testid="recap-publish" onClick={() => run("publishRecap", (b) => ({ ...b }))}>
            Publish recap v{(latest?.versionNo ?? 0) + 1}
          </button>
        )}
        {latest && (
          <Link href={`/dashboard/fixture-room/${view.room.id}/recap?v=${latest.versionNo}`} className="fxr-link">View v{latest.versionNo} ↗</Link>
        )}
      </div>
      {latest && (
        <div className="fxr-hint" style={{ marginTop: 6 }} data-testid="recap-latest">
          v{latest.versionNo} published {shortDateTime(latest.publishedAt)} by {latest.publishedByLabel ?? "—"}
          {latest.invalidatedAt ? " · superseded by a later change" : latest.acknowledgedByAllPrincipals ? " · acknowledged by both principals" : ` · ${latest.acknowledgements.length} acknowledgement${latest.acknowledgements.length === 1 ? "" : "s"}`}
          {" "}
          {!latest.invalidatedAt && caps.canAcknowledgeRecap && !latest.viewerAcknowledged && (
            <button type="button" className="fxr-link" disabled={busy} data-testid="recap-ack" onClick={() => run("ackRecap", (b) => ({ ...b, recapVersionId: latest.id, onBehalfOfPartyId: actForPartyId }))}>Acknowledge</button>
          )}
        </div>
      )}
    </div>
  );
}

export function SubjectsRail({ view, run, busy, actForPartyId, now }: { view: FixtureRoomView; run: RunCommand; busy: boolean; actForPartyId: string | null; now: number }) {
  const caps = view.viewer.capabilities;
  const [title, setTitle] = React.useState("");
  const [side, setSide] = React.useState<"" | "cargo" | "vessel" | "mediator">("");
  const lifted = view.subjects.filter((s) => s.status === "lifted").length;
  return (
    <div className="fxr-sec" data-testid="subjects-rail">
      <div className="fxr-sec__hd">Subjects <span className="cnt">{lifted}/{view.subjects.length} lifted</span></div>
      {view.room.status === "negotiating" && view.subjects.length === 0 && <div className="fxr-hint">Add the subjects the fixture will be on (stem, management approval, C/P details). With none recorded, fixing lands clean.</div>}
      {view.subjects.map((s) => (
        <div className={`fxr-subj is-${s.status}`} key={s.id} data-testid={`subject-row-${s.id}`}>
          <span className="fxr-subj__box" aria-hidden="true">{s.status === "lifted" ? "✓" : s.status === "failed" ? "✕" : ""}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="fxr-subj__name">{s.title}</div>
            <div className="fxr-subj__desc">
              {s.responsibleSide ? `${s.responsibleSide} side` : "either side"}{s.deadlineAt ? ` · by ${shortDateTime(s.deadlineAt)}` : ""}{s.status !== "open" ? ` · ${s.status} ${relativeTime(s.resolvedAt, now)}` : ""}
            </div>
            {s.status === "open" && view.room.status === "on_subjects" && (
              <div className="fxr-subj__acts">
                {caps.canLiftSubject && <button type="button" className="asb-btn green" disabled={busy} data-testid={`subject-lift-${s.id}`} onClick={() => run("liftSubject", (b) => ({ ...b, subjectId: s.id, onBehalfOfPartyId: actForPartyId }))}>Lift</button>}
                {caps.canExtendSubject && <button type="button" className="fxr-link" disabled={busy} onClick={() => { const d = window.prompt("New deadline (YYYY-MM-DD)"); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) void run("extendSubject", (b) => ({ ...b, subjectId: s.id, deadlineAt: `${d}T17:00:00Z` })); }}>Extend</button>}
                {caps.canFailSubject && <button type="button" className="fxr-link" disabled={busy} onClick={() => { const r = window.prompt("Why did this subject fail? (this fails the fixture)"); if (r) void run("failSubject", (b) => ({ ...b, subjectId: s.id, reason: r, onBehalfOfPartyId: actForPartyId })); }}>Mark failed</button>}
              </div>
            )}
          </div>
        </div>
      ))}
      {caps.canAddSubject && (
        <div className="fxr-composer" style={{ marginTop: 8 }}>
          <div className="fxr-composer__row">
            <div className="fxr-field"><label htmlFor="fx-subject-title">New subject</label><input id="fx-subject-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Sub shippers' / stem approval" /></div>
            <div className="fxr-field" style={{ flex: "0 0 120px" }}>
              <label htmlFor="fx-subject-side">Responsible</label>
              <select id="fx-subject-side" value={side} onChange={(e) => setSide(e.target.value as typeof side)}><option value="">either side</option><option value="cargo">cargo side</option><option value="vessel">vessel side</option><option value="mediator">mediator</option></select>
            </div>
          </div>
          <div className="fxr-composer__acts">
            <button type="button" className="asb-btn" disabled={busy || title.trim().length === 0} data-testid="subject-add"
              onClick={() => run("addSubject", (b) => ({ ...b, title: title.trim(), description: null, responsibleSide: side || null, deadlineAt: null })).then((ok) => { if (ok) { setTitle(""); setSide(""); } })}>Add subject</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MessagesPanel({ view, run, busy, now }: { view: FixtureRoomView; run: RunCommand; busy: boolean; now: number }) {
  const caps = view.viewer.capabilities;
  const [body, setBody] = React.useState("");
  const [visibility, setVisibility] = React.useState<"room" | "side" | "mediator">("room");
  const canSide = view.viewer.side === "cargo" || view.viewer.side === "vessel";
  return (
    <div className="fxr-sec" data-testid="messages-panel">
      <div className="fxr-sec__hd">Messages <span className="cnt">{view.messages.length}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
        {view.messages.length === 0 && <div className="fxr-hint">No messages yet.</div>}
        {view.messages.map((m) => (
          <div className={`fxr-msg${m.isMine ? " is-mine" : ""}`} key={m.id}>
            <div className="fxr-msg__meta"><b>{m.label}</b><span>{m.visibility === "room" ? "" : m.visibility === "side" ? "· side-private" : "· mediator-private"}</span><span>· {relativeTime(m.createdAt, now)}</span></div>
            <div>{m.redacted ? <i className="fxr-muted">Redacted by an administrator.</i> : m.body}</div>
          </div>
        ))}
      </div>
      {caps.canMessage && (
        <div className="fxr-composer" style={{ marginTop: 8 }}>
          <div className="fxr-field"><label htmlFor="fx-msg-body">Message</label><textarea id="fx-msg-body" rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="fxr-composer__acts">
            <select aria-label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
              <option value="room">Whole room</option>
              {canSide && <option value="side">My side only</option>}
              {view.viewer.isMediator && <option value="mediator">Mediator only</option>}
            </select>
            <button type="button" className="asb-btn" disabled={busy || body.trim().length === 0} data-testid="message-send"
              onClick={() => run("message", (b) => ({ ...b, body: body.trim(), kind: "note", visibility, termId: null })).then((ok) => { if (ok) setBody(""); })}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  "room.created": () => "opened the room",
  "party.invited": (p) => `invited ${p.label ?? "a party"}`,
  "party.accepted": () => "joined the room",
  "party.declined": () => "declined the invitation",
  "party.disclosure_agreed": () => "agreed to disclose identity",
  "room.counterparty_disclosed": () => "both principals agreed · identities disclosed",
  "proposal.submitted": (p) => `${p.kind === "bid" ? "bid" : "offered"} ${p.displayValue ?? ""} on ${String(p.termLabel ?? "").toLowerCase()}${p.comment ? ` · “${p.comment}”` : ""}`,
  "proposal.withdrawn": (p) => `withdrew ${p.displayValue ?? ""} on ${String(p.termLabel ?? "").toLowerCase()}`,
  "proposal.lapsed": (p) => `the ${p.side} side's ${p.displayValue ?? ""} lapsed`,
  "term.agreed": (p) => `accepted ${p.displayValue ?? ""} · ${String(p.termLabel ?? "").toLowerCase()} agreed`,
  "term.reopened": (p) => `reopened ${String(p.termLabel ?? "").toLowerCase()}${p.reason ? ` · ${p.reason}` : ""}`,
  "term.held": (p) => `put ${String(p.termLabel ?? "").toLowerCase()} on hold`,
  "term.resumed": (p) => `resumed ${String(p.termLabel ?? "").toLowerCase()}`,
  "term.referred": (p) => `referred ${String(p.termLabel ?? "").toLowerCase()} to principal`,
  "term.referral_cleared": (p) => `cleared the referral on ${String(p.termLabel ?? "").toLowerCase()}`,
  "subject.added": (p) => `added subject “${p.title}”`,
  "subject.lifted": (p) => `lifted “${p.title}”`,
  "subject.failed": (p) => `failed “${p.title}”${p.reason ? ` · ${p.reason}` : ""}`,
  "subject.extended": (p) => `extended “${p.title}”`,
  "room.fixed_on_subjects": () => "recorded FIXED ON SUBS",
  "room.fixed": () => "all subjects lifted · CLEAN FIXED",
  "room.returned_to_negotiation": () => "returned the room to negotiation",
  "recap.published": (p) => `published recap v${p.versionNo}`,
  "recap.acknowledged": (p) => `acknowledged recap v${p.versionNo}`,
  "recap.invalidated": (p) => `recap v${p.versionNo} superseded · ${p.reason ?? ""}`,
  "message.posted": (p) => `posted a ${p.visibility === "room" ? "" : `${p.visibility}-private `}message`,
  "message.redacted": () => "redacted a message",
  "listing_sync.required": (p) => `listing status now required: cargo ${(p.target as Record<string, string> | undefined)?.cargo_status ?? "—"} · vessel ${(p.target as Record<string, string> | undefined)?.vessel_status ?? "—"}`,
  "room.closed": (p) => `closed the room · ${p.reason}${p.note ? ` · ${p.note}` : ""}`,
};

export function ActivityFeed({ view, now }: { view: FixtureRoomView; now: number }) {
  const items = [...view.events].reverse().slice(0, 60);
  const me = new Set(view.viewer.partyIds);
  return (
    <div className="fxr-sec" data-testid="activity-feed">
      <div className="fxr-sec__hd">Activity <span className="cnt">v{view.room.version}</span></div>
      <div className="fxr-log">
        {items.map((e) => (
          <div className="fxr-log__item" key={e.id} data-testid={`event-${e.seq}`}>
            <span className={`fxr-log__who${e.actorPartyId && me.has(e.actorPartyId) ? " is-you" : ""}`}>
              {e.actorPartyId && me.has(e.actorPartyId) ? "You" : e.actorLabel}{e.onBehalfOfLabel ? ` (for ${e.onBehalfOfLabel})` : ""}
            </span>{" "}
            <span>{(EVENT_TEXT[e.type] ?? (() => e.type))(e.payload)}</span>
            <span className="fxr-log__time">#{e.seq} · {relativeTime(e.at, now)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
