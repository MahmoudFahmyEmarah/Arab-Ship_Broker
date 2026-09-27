"use client";

// The right rail as designed (nr-rail): counterparty reveal, the recap slots
// that mirror the term strips, the subjects checklist, the messages and the
// activity log. Every panel renders the masked read model as the server sent
// it and issues commands through the room's runner.
import * as React from "react";
import Link from "next/link";
import type { FixtureEventView, FixtureRoomView } from "@/lib/fixture-room/types";
import { relativeTime, shortDateTime } from "@/lib/fixture-room/format";
import { roleLabel } from "@/lib/fixture-room/permissions";
import type { RunCommand } from "./FixtureRoomClient";
import { Gloss } from "./Gloss";
import { IcLock } from "./icons";

const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();

export function CounterpartyCard({ view, run, busy, actForPartyId }: { view: FixtureRoomView; run: RunCommand; busy: boolean; actForPartyId: string | null }) {
  const caps = view.viewer.capabilities;
  const disclosed = view.room.counterpartyDisclosed;
  const principals = view.parties.filter((p) => p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel"));
  const others = view.parties.filter((p) => !(p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel")));
  const mySide = view.viewer.side;
  const myPrincipal = principals.find((p) => p.isViewer);
  const counterparty = principals.find((p) => !p.isViewer && p.side !== mySide) ?? principals.find((p) => !p.isViewer) ?? null;
  const cargoP = principals.find((p) => p.side === "cargo");
  const vesselP = principals.find((p) => p.side === "vessel");
  const actingRelayed = actForPartyId ? view.parties.find((p) => p.id === actForPartyId) : null;
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteId, setInviteId] = React.useState("");
  const [inviteKind, setInviteKind] = React.useState<"org" | "user">("org");
  const canAgree = caps.canAgreeDisclosure && ((myPrincipal && !myPrincipal.disclosureAgreed) || (actingRelayed && actingRelayed.capacity === "principal" && !actingRelayed.disclosureAgreed));
  return (
    <div className="nr-rail__sec" data-testid="counterparty-card">
      <div className="nr-rail__hd">Counterparty <span className="cnt">{disclosed ? "released" : "protected"}</span></div>
      <div className={`nr-cp ${disclosed ? "is-revealed" : "is-locked"}`}>
        <div className="nr-cp__idrow">
          <div className="nr-cp__avatar" aria-hidden="true">{disclosed && counterparty?.name ? initials(counterparty.name) : <IcLock />}</div>
          <div className="nr-cp__id">
            <div className={`nr-cp__name${disclosed && counterparty?.name ? "" : " is-blur"}`}>{counterparty ? (disclosed && counterparty.name ? counterparty.name : counterparty.label) : "Counterparty"}</div>
            <div className={`nr-cp__meta${disclosed ? "" : " is-blur"}`}>{counterparty ? roleLabel(counterparty.side, counterparty.capacity, counterparty.isPlatform) : "—"}{counterparty?.participationMode === "relayed" ? " · relayed by ASB" : ""}</div>
          </div>
        </div>
        {disclosed ? (
          <div className="nr-cp__rows">
            {counterparty?.deskLabel && <div className="nr-cp__row"><span>Desk</span><b>{counterparty.deskLabel}</b></div>}
            <div className="nr-cp__row"><span>Contact</span><b>via the ASB desk</b></div>
            <div className="nr-cp__row"><span>Status</span><b>{counterparty?.status ?? "—"}</b></div>
          </div>
        ) : (
          <>
            <p className="nr-cp__note">Released once both principals agree to disclose. Personal email and phone are never shown in the room.</p>
            <div className="nr-cp__pays">
              <span className={`nr-cp__pay ${cargoP?.disclosureAgreed ? "is-paid" : ""}`}>{cargoP?.disclosureAgreed ? "✓" : "○"} Cargo{cargoP?.isViewer ? " (you)" : ""}</span>
              <span className={`nr-cp__pay ${vesselP?.disclosureAgreed ? "is-paid" : ""}`}>{vesselP?.disclosureAgreed ? "✓" : "○"} Vessel{vesselP?.isViewer ? " (you)" : ""}</span>
            </div>
            {canAgree ? (
              <button type="button" className="asb-btn primary nr-cp__cta" disabled={busy} data-testid="disclosure-agree"
                onClick={() => run("disclosure", (b) => ({ ...b, onBehalfOfPartyId: actForPartyId }))}>
                {actingRelayed ? `Record disclosure consent for ${actingRelayed.label}` : "Agree to disclose our identity"}
              </button>
            ) : myPrincipal?.disclosureAgreed ? (
              <div className="nr-cp__waiting">◷ You&apos;ve agreed · awaiting the other side…</div>
            ) : null}
          </>
        )}
      </div>
      {others.length > 0 && (
        <div className="nr-cp__rows" style={{ marginTop: 8 }}>
          {others.map((p) => (
            <div className="nr-cp__row" key={p.id}><span>{roleLabel(p.side, p.capacity, p.isPlatform)}</span><b>{p.isPlatform ? "Arab ShipBroker" : p.name ?? p.label}{p.status !== "active" ? ` · ${p.status}` : ""}</b></div>
          ))}
        </div>
      )}
      {caps.canInvite && (mySide === "cargo" || mySide === "vessel" || view.viewer.isMediator) && (
        <details open={inviteOpen} onToggle={(e) => setInviteOpen((e.target as HTMLDetailsElement).open)} style={{ marginTop: 8 }}>
          <summary className="fx-link" style={{ cursor: "pointer" }}>Invite a viewer or broker onto your side</summary>
          <div className="fx-fields" style={{ marginTop: 6 }}>
            <div className="fx-field" style={{ flex: "0 0 120px" }}>
              <label htmlFor="fx-invite-kind">Invite by</label>
              <select id="fx-invite-kind" value={inviteKind} onChange={(e) => setInviteKind(e.target.value as "org" | "user")}><option value="org">Organisation id</option><option value="user">Member id</option></select>
            </div>
            <div className="fx-field"><label htmlFor="fx-invite-id">Id</label><input id="fx-invite-id" value={inviteId} onChange={(e) => setInviteId(e.target.value)} placeholder="uuid" /></div>
          </div>
          <div className="fx-acts2" style={{ marginTop: 6 }}>
            <button type="button" className="asb-btn" disabled={busy || !/^[0-9a-f-]{36}$/i.test(inviteId)} onClick={() => run("invite", (b) => ({
              ...b, side: mySide === "vessel" ? "vessel" : "cargo", capacity: "viewer", orgId: inviteKind === "org" ? inviteId : null, userId: inviteKind === "user" ? inviteId : null,
            })).then((ok) => { if (ok) setInviteId(""); })}>Invite as viewer</button>
            <span className="nr-muted">Colleagues of your organisation already have access; use this for another firm.</span>
          </div>
        </details>
      )}
    </div>
  );
}

export function RecapRail({ view, run, busy, actForPartyId, hoverSlot, onHover }: {
  view: FixtureRoomView; run: RunCommand; busy: boolean; actForPartyId: string | null; hoverSlot: string | null; onHover: (id: string | null) => void;
}) {
  const caps = view.viewer.capabilities;
  const latest = view.recaps[0] ?? null;
  const agreed = view.terms.filter((t) => t.status === "agreed").length;
  const vessel = view.snapshot.vessel.vessel;
  return (
    <div className="nr-rail__sec" data-testid="recap-rail">
      <div className="nr-rail__hd">Fixture Recap <span className="cnt">{agreed}/{view.terms.length} agreed</span></div>
      <div className="nr-rail__cap">Each side&apos;s latest per item · a term is agreed when one side accepts the other&apos;s figure.</div>
      <div className="nr-recap">
        <div className="nr-recap__line nr-recap__vessel">
          <span className="nr-recap__k">Vessel</span><span className="nr-recap__v">{String(vessel.vessel_name ?? "TBN")}</span>
        </div>
        {view.terms.map((t) => {
          const locked = t.status === "agreed";
          const cv = locked ? t.agreed?.displayValue ?? "" : t.cargoPosition?.displayValue ?? "—";
          const vv = locked ? t.agreed?.displayValue ?? "" : t.vesselPosition?.displayValue ?? "—";
          return (
            <div key={t.id} className={`rc-item${locked ? " is-locked" : ""}${hoverSlot === t.id ? " is-linked" : ""}`} data-testid={`recap-slot-${t.code}`}
              onMouseEnter={() => onHover(t.id)} onMouseLeave={() => onHover(null)} title={cv === vv ? cv : `Cargo ${cv} · Vessel ${vv}`}>
              <div className="rc-item__top"><span className="rc-item__k">{t.sortOrder} · {t.label}</span>{locked && <span className="rc-item__lock">✓ agreed</span>}{t.status === "withdrawn" && <span className="rc-item__lock">withdrawn</span>}</div>
              <div className="rc-item__vals">
                <span className={`rc-val c${t.cargoPosition?.isFinal || locked ? " is-set" : ""}`}><em>Cargo</em><Gloss text={cv} /></span>
                <span className={`rc-val v${t.vesselPosition?.isFinal || locked ? " is-set" : ""}`}><em>Vessel</em><Gloss text={vv} /></span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fx-acts2" style={{ marginTop: 8 }}>
        {caps.canPublishRecap && (
          <button type="button" className="asb-btn" disabled={busy} data-testid="recap-publish" onClick={() => run("publishRecap", (b) => ({ ...b }))}>
            Publish recap v{(latest?.versionNo ?? 0) + 1}
          </button>
        )}
        {latest && <Link href={`/dashboard/fixture-room/${view.room.id}/recap?v=${latest.versionNo}`} className="fx-link">View v{latest.versionNo} ↗</Link>}
      </div>
      {latest && (
        <div className="nr-rail__cap" style={{ marginTop: 6 }} data-testid="recap-latest">
          v{latest.versionNo} published {shortDateTime(latest.publishedAt)} by {latest.publishedByLabel ?? "—"}
          {latest.invalidatedAt ? " · superseded by a later change" : latest.acknowledgedByAllPrincipals ? " · acknowledged by both principals" : ` · ${latest.acknowledgements.length} acknowledgement${latest.acknowledgements.length === 1 ? "" : "s"}`}
          {" "}
          {!latest.invalidatedAt && caps.canAcknowledgeRecap && !latest.viewerAcknowledged && (
            <button type="button" className="fx-link" disabled={busy} data-testid="recap-ack" onClick={() => run("ackRecap", (b) => ({ ...b, recapVersionId: latest.id, onBehalfOfPartyId: actForPartyId }))}>Acknowledge</button>
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
  const onSubs = view.room.status === "on_subjects";
  return (
    <div className="nr-rail__sec" data-testid="subjects-rail">
      <div className="nr-rail__hd">Subjects <span className="cnt">{lifted}/{view.subjects.length} lifted</span></div>
      {view.room.status === "negotiating" && (
        <div className="nr-subj__hint">{view.subjects.length === 0 ? "Add the subjects the fixture will be on (stem, management approval, C/P details). With none recorded, fixing lands clean." : "Subjects open once every required term is agreed and the deal is fixed on subs."}</div>
      )}
      {view.subjects.map((s) => {
        const canLiftThis = onSubs && s.status === "open" && caps.canLiftSubject;
        return (
          <div key={s.id} data-testid={`subject-row-${s.id}`}>
            <button type="button" className={`nr-subj ${s.status === "lifted" ? "is-lifted" : ""}`} disabled={busy || !canLiftThis} data-testid={`subject-lift-${s.id}`}
              title={canLiftThis ? "Lift this subject" : s.status === "open" ? "Lifting opens once the deal is fixed on subs" : s.status}
              onClick={() => run("liftSubject", (b) => ({ ...b, subjectId: s.id, onBehalfOfPartyId: actForPartyId }))}>
              <span className="nr-subj__box" aria-hidden="true">{s.status === "lifted" ? "✓" : s.status === "failed" ? "✕" : ""}</span>
              <span className="nr-subj__body">
                <span className="nr-subj__name">{s.title}</span>
                <span className="nr-subj__desc">
                  {s.responsibleSide ? `${s.responsibleSide} side` : "either side"}{s.deadlineAt ? ` · by ${shortDateTime(s.deadlineAt)}` : ""}{s.status !== "open" ? ` · ${s.status} ${relativeTime(s.resolvedAt, now)}` : ""}
                </span>
              </span>
            </button>
            {s.status === "open" && onSubs && (caps.canExtendSubject || caps.canFailSubject) && (
              <div className="fx-acts2" style={{ margin: "2px 0 6px 28px" }}>
                {caps.canExtendSubject && <button type="button" className="fx-link" disabled={busy} onClick={() => { const d = window.prompt("New deadline (YYYY-MM-DD)"); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) void run("extendSubject", (b) => ({ ...b, subjectId: s.id, deadlineAt: `${d}T17:00:00Z` })); }}>Extend</button>}
                {caps.canFailSubject && <button type="button" className="fx-link" disabled={busy} onClick={() => { const r = window.prompt("Why did this subject fail? (this fails the fixture)"); if (r) void run("failSubject", (b) => ({ ...b, subjectId: s.id, reason: r, onBehalfOfPartyId: actForPartyId })); }}>Mark failed</button>}
              </div>
            )}
          </div>
        );
      })}
      {caps.canAddSubject && (
        <div style={{ marginTop: 8 }}>
          <div className="fx-fields">
            <div className="fx-field"><label htmlFor="fx-subject-title">New subject</label><input id="fx-subject-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Sub shippers' / stem approval" /></div>
            <div className="fx-field" style={{ flex: "0 0 120px" }}>
              <label htmlFor="fx-subject-side">Responsible</label>
              <select id="fx-subject-side" value={side} onChange={(e) => setSide(e.target.value as typeof side)}><option value="">either side</option><option value="cargo">cargo side</option><option value="vessel">vessel side</option><option value="mediator">mediator</option></select>
            </div>
          </div>
          <div className="fx-acts2" style={{ marginTop: 6 }}>
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
    <div className="nr-rail__sec" data-testid="messages-panel">
      <div className="nr-rail__hd">Messages <span className="cnt">{view.messages.length}</span></div>
      <div className="nr-msgs">
        {view.messages.length === 0 && <div className="nr-rail__cap">No messages yet.</div>}
        {view.messages.map((m) => (
          <div className={`fx-msg lane-${m.side === "mediator" ? "broker" : m.side}`} key={m.id}>
            <div className="fx-bubble">
              <div className="fx-bubble__top"><span className="fx-bubble__who">{m.isMine ? "You" : m.label}</span><span className={`fx-bubble__tag k-${m.kind === "nudge" ? "offer" : "note"}`}>{m.kind === "nudge" ? "NUDGE" : m.visibility === "room" ? "NOTE" : m.visibility === "side" ? "SIDE" : "MEDIATOR"}</span><span className="fx-bubble__t">{relativeTime(m.createdAt, now)}</span></div>
              <div className="fx-bubble__val" style={{ fontWeight: 400 }}>{m.redacted ? <i className="nr-muted">Redacted by an administrator.</i> : m.body}</div>
            </div>
          </div>
        ))}
      </div>
      {caps.canMessage && (
        <div style={{ marginTop: 8 }}>
          <div className="fx-field"><label htmlFor="fx-msg-body">Message</label><textarea id="fx-msg-body" rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="fx-acts2" style={{ marginTop: 6 }}>
            <select aria-label="Visibility" className="asb-input" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
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

export const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
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

export function eventText(e: FixtureEventView): string {
  return (EVENT_TEXT[e.type] ?? (() => e.type))(e.payload);
}

export function ActivityFeed({ view, now }: { view: FixtureRoomView; now: number }) {
  const items = [...view.events].reverse().slice(0, 60);
  const me = new Set(view.viewer.partyIds);
  const lane = (e: FixtureEventView) => (e.actorPartyId && me.has(e.actorPartyId) ? "you" : !e.actorPartyId || e.actorLabel === "System" || e.actorLabel === "Arab ShipBroker" ? "system" : "owner");
  return (
    <div className="nr-rail__sec" data-testid="activity-feed">
      <div className="nr-rail__hd">Activity <span className="cnt">v{view.room.version}</span></div>
      <div className="nr-log">
        {items.map((e) => {
          const l = lane(e);
          return (
            <div className={`nr-log__item by-${l}`} key={e.id} data-testid={`event-${e.seq}`}>
              <div className={`nr-log__who ${l === "you" ? "you" : ""}`}>{l === "you" ? "You" : e.actorLabel}{e.onBehalfOfLabel ? ` (for ${e.onBehalfOfLabel})` : ""}</div>
              <div className="nr-log__txt">{eventText(e)}</div>
              <div className="nr-log__time">#{e.seq} · {relativeTime(e.at, now)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
