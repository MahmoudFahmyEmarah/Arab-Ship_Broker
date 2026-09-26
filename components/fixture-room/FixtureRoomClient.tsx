"use client";

// The room. Server-authoritative: every command goes to a governed RPC with
// expected_version + idempotency_key; the reply is a typed envelope or a
// typed refusal. On FX_VERSION_CONFLICT the room refetches and tells the
// user; nothing is retried silently. Polling keeps the other side's moves
// visible without Realtime (decision: polling in v1).
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { FixtureRoomView } from "@/lib/fixture-room/types";
import type { FixtureError } from "@/lib/fixture-room/errors";
import { FIXTURE_ERROR_TITLE, isFixtureError } from "@/lib/fixture-room/errors";
import { ROOM_STATUS_LABEL, isTerminal, timelineSteps } from "@/lib/fixture-room/state-machine";
import { listingSyncNotice } from "@/lib/fixture-room/listing-sync";
import { GestureKeys, UNCERTAIN_MESSAGE, runGesture, useNow, useRoomVersionPoll } from "@/lib/fixture-room/client";
import { relativeTime } from "@/lib/fixture-room/format";
import {
  acceptFixtureProposalAction, acknowledgeFixtureRecapAction, addFixtureSubjectAction, agreeFixtureDisclosureAction, closeFixtureRoomAction,
  extendFixtureSubjectAction, failFixtureSubjectAction, fixFixtureOnSubjectsAction, inviteFixturePartyAction, liftFixtureSubjectAction, loadFixtureRoom,
  pollFixtureRoomVersion, postFixtureMessageAction, publishFixtureRecapAction, reopenFixtureTermAction, respondFixtureInvitationAction,
  setFixtureTermFlagAction, submitFixtureProposalAction, withdrawFixtureProposalAction,
  syncFixtureListingStatusAction,
} from "@/app/(dashboard)/dashboard/fixture-room/actions";
import { TermRow } from "./TermRow";
import { ActivityFeed, CounterpartyCard, MessagesPanel, RecapRail, SubjectsRail } from "./RoomRails";

const ACTIONS = {
  submit: submitFixtureProposalAction,
  accept: acceptFixtureProposalAction,
  withdraw: withdrawFixtureProposalAction,
  reopen: reopenFixtureTermAction,
  flag: setFixtureTermFlagAction,
  addSubject: addFixtureSubjectAction,
  liftSubject: liftFixtureSubjectAction,
  failSubject: failFixtureSubjectAction,
  extendSubject: extendFixtureSubjectAction,
  fix: fixFixtureOnSubjectsAction,
  publishRecap: publishFixtureRecapAction,
  ackRecap: acknowledgeFixtureRecapAction,
  message: postFixtureMessageAction,
  disclosure: agreeFixtureDisclosureAction,
  close: closeFixtureRoomAction,
  respond: respondFixtureInvitationAction,
  invite: inviteFixturePartyAction,
  syncListing: syncFixtureListingStatusAction,
} as const;
export type CommandName = keyof typeof ACTIONS;
export interface CommandBaseArgs { roomId: string; expectedVersion: number; idempotencyKey: string }
export type RunCommand = (name: CommandName, build: (base: CommandBaseArgs) => Record<string, unknown>) => Promise<boolean>;

export function FixtureRoomClient({ initial }: { initial: FixtureRoomView }) {
  const [view, setView] = React.useState<FixtureRoomView>(initial);
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [announce, setAnnounce] = React.useState("");
  const [activeTermId, setActiveTermId] = React.useState<string | null>(() => initial.terms.find((t) => t.status !== "agreed")?.id ?? initial.terms[0]?.id ?? null);
  const [actFor, setActFor] = React.useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = React.useState(false);
  const [inviteParty, setInviteParty] = React.useState<string | null>(null);
  const now = useNow();
  const roomId = view.room.id;
  // one idempotency key per gesture, kept until the server has answered (audit FR-M5)
  const keys = React.useMemo(() => new GestureKeys(), []);

  const refetch = React.useCallback(async (): Promise<FixtureRoomView | null> => {
    const v = await loadFixtureRoom(roomId);
    if (isFixtureError(v)) {
      toast.error(v.message);
      return null;
    }
    setView(v);
    return v;
  }, [roomId]);

  const onVersionChange = React.useCallback((version: number) => {
    void refetch().then((v) => { if (v) setAnnounce(`Room updated to version ${version}.`); });
  }, [refetch]);
  useRoomVersionPoll(roomId, view.room.version, pollFixtureRoomVersion, onVersionChange);

  const run: RunCommand = React.useCallback(async (name, build) => {
    if (busy) return false;
    setBusy(true);
    setConflict(null);
    try {
      // the gesture is the command plus its own arguments (never the version or the key):
      // a retry of the same gesture reuses the key and replays; a different gesture gets its own
      const probe = build({ roomId, expectedVersion: 0, idempotencyKey: "" });
      const gesture = `${name}:${JSON.stringify({ ...probe, expectedVersion: undefined, idempotencyKey: undefined })}`;
      const outcome = await runGesture(keys, gesture, (idempotencyKey) =>
        (ACTIONS[name] as (input: unknown) => Promise<{ ok: true; replayed: boolean; version: number } | FixtureError>)(
          build({ roomId, expectedVersion: view.room.version, idempotencyKey }),
        ));
      if (outcome.kind === "ok") {
        const v = await refetch().catch(() => null);
        setAnnounce(`Done. Room is at version ${outcome.result.version}.`);
        if (name === "fix" && v?.room.status === "fixed") toast.success("Clean fixed");
        return true;
      }
      if (outcome.kind === "refused") {
        if (outcome.error.code === "VERSION_CONFLICT") {
          await refetch().catch(() => null);
          setConflict(`${outcome.error.message} The room was refreshed; review the latest positions and try again.`);
          setAnnounce("The room moved on; it was refreshed.");
          return false;
        }
        toast.error(`${FIXTURE_ERROR_TITLE[outcome.error.code]}: ${outcome.error.message}`);
        return false;
      }
      // uncertain: no answer arrived, the server may have committed; the key is kept so a retry replays
      await refetch().catch(() => null);
      toast.error(UNCERTAIN_MESSAGE);
      setAnnounce("No answer from the server; the room was refreshed.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, keys, roomId, view.room.version, refetch]);

  const { room, viewer, snapshot } = view;
  const caps = viewer.capabilities;
  const cargo = snapshot.cargo;
  const vessel = snapshot.vessel.vessel;
  const counterparty = view.parties.find((p) => p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel") && !p.isViewer && p.side !== viewer.side)
    ?? view.parties.find((p) => p.capacity === "principal" && p.side !== viewer.side && (p.side === "cargo" || p.side === "vessel")) ?? null;
  const agreedCount = view.terms.filter((t) => t.status === "agreed").length;
  const requiredOpen = view.terms.filter((t) => t.required && t.status !== "agreed").map((t) => t.label);
  const openSubjects = view.subjects.filter((s) => s.status === "open").length;
  const sync = listingSyncNotice(room, viewer.side);
  const myInvites = view.parties.filter((p) => p.isViewer && p.status === "invited");
  const invitePartyId = myInvites.length > 1 ? (myInvites.some((p) => p.id === inviteParty) ? inviteParty : myInvites[0].id) : null;
  const terminal = isTerminal(room.status);
  const steps = timelineSteps(room.status);
  const mySideLabel = viewer.side === "cargo" ? "You are on the cargo side" : viewer.side === "vessel" ? "You are on the vessel side" : viewer.isMediator ? "You mediate this room" : "You are observing";
  const relayedParties = view.parties.filter((p) => caps.actForPartyIds.includes(p.id));

  return (
    <div className="fxr">
      <div className="fxr-page">
        <div className="sr-only" aria-live="polite" role="status">{announce}</div>

        {/* header */}
        <div className="fxr-head" data-testid="room-header">
          <div className="fxr-head__top">
            <div>
              <div className="fxr-head__title">
                <h1 className="fxr-title">Fixture Room</h1>
                <span className="fxr-ref">{room.ref}</span>
                <span className={`fxr-phase is-${room.status}`} data-testid="room-status"><span className="fxr-phase__dot" aria-hidden="true" />{ROOM_STATUS_LABEL[room.status]}</span>
                <span className="fxr-version" data-testid="room-version">v{room.version}</span>
              </div>
              <div className="fxr-head__deal">
                <b>{String(cargo.commodity_name ?? "Cargo")}</b>
                <span className="fxr-arr">·</span><span>{String(cargo.load_port_name ?? cargo.load_port_locode ?? "—")}</span>
                <span className="fxr-arr">→</span><span>{String(cargo.disch_port_name ?? cargo.disch_port_locode ?? "—")}</span>
                <span className="fxr-arr">·</span><b>{String(vessel.vessel_name ?? "Vessel")}</b>
                {snapshot.vesselIdentityMasked && <span className="fxr-tag" title="The owner has not disclosed the vessel yet">identity withheld</span>}
                {counterparty && (
                  <span className={`fxr-mask${room.counterpartyDisclosed ? " is-revealed" : ""}`} data-testid="counterparty-chip"
                    title={room.counterpartyDisclosed ? "Counterparty disclosed" : "Counterparty identity withheld until both principals agree to disclosure"}>
                    {room.counterpartyDisclosed && counterparty.name ? counterparty.name : `${counterparty.label} via ASB`}
                    {counterparty.participationMode === "relayed" && <span className="fxr-tag is-relayed" style={{ marginLeft: 4 }}>relayed</span>}
                  </span>
                )}
                <span className="fxr-muted">· {mySideLabel}</span>
              </div>
            </div>
            <div className="fxr-head__meta">
              {relayedParties.length > 0 && (
                <label className="fxr-field" style={{ flex: "0 0 auto" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--asb-gray-500)" }}>Acting for</span>
                  <select value={actFor ?? ""} onChange={(e) => setActFor(e.target.value || null)} data-testid="act-for">
                    <option value="">myself (mediator)</option>
                    {relayedParties.map((p) => <option key={p.id} value={p.id}>{p.label} (relayed)</option>)}
                  </select>
                </label>
              )}
              <Link href={`/dashboard/fixture-room/${room.id}/recap`} className="fxr-icon-btn" data-testid="open-recap">Recap ↗</Link>
              <Link href="/dashboard/fixture-room/new" className="fxr-icon-btn" title="Start a different match">New fixture</Link>
            </div>
          </div>
        </div>

        {conflict && (
          <div className="fxr-banner is-warn" role="alert" data-testid="conflict-banner">
            <div className="fxr-banner__body"><div className="fxr-banner__title">The room moved on</div>{conflict}</div>
            <button type="button" className="asb-btn" onClick={() => setConflict(null)}>Got it</button>
          </div>
        )}
        {sync && sync.outstanding && (
          <div className="fxr-banner is-warn" role="status" data-testid="listing-sync-banner">
            <div className="fxr-banner__body">
              <div className="fxr-banner__title">{sync.headline}</div>
              <ul>{sync.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              <div style={{ marginTop: 4, fontSize: 11 }}>Sync applies only the listing you own; it cannot change the counterparty’s listing.</div>
            </div>
            <div className="fxr-foot__cta">
              {(viewer.side === "cargo" || viewer.side === "vessel") && (
                <button type="button" className="asb-btn primary" disabled={busy} data-testid="sync-listing-status"
                  onClick={() => void run("syncListing", (b) => ({ ...b }))}>
                  Sync my listing
                </button>
              )}
              {sync.links.map((l) => <Link key={l.href} href={l.href} className="asb-btn">{l.label} →</Link>)}
            </div>
          </div>
        )}
        {caps.canRespondInvitation && (
          <div className="fxr-banner is-info" role="status" data-testid="invitation-banner">
            <div className="fxr-banner__body">
              <div className="fxr-banner__title">You are invited into this room</div>Accept to negotiate; decline to step back.
              {myInvites.length > 1 && (
                <label className="fxr-field" style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--asb-gray-500)" }}>You hold {myInvites.length} invitations · answering as</span>
                  <select value={invitePartyId ?? ""} onChange={(e) => setInviteParty(e.target.value || null)} data-testid="invitation-party">
                    {myInvites.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.capacity}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="fxr-foot__cta">
              <button type="button" className="asb-btn primary" disabled={busy} data-testid="invitation-accept" onClick={() => run("respond", (b) => ({ roomId: b.roomId, accept: true, expectedVersion: b.expectedVersion, idempotencyKey: b.idempotencyKey, partyId: invitePartyId }))}>Accept invitation</button>
              <button type="button" className="asb-btn" disabled={busy} onClick={() => run("respond", (b) => ({ roomId: b.roomId, accept: false, expectedVersion: b.expectedVersion, idempotencyKey: b.idempotencyKey, partyId: invitePartyId }))}>Decline</button>
            </div>
          </div>
        )}

        {/* timeline */}
        <div className="fxr-tl" aria-label="Fixture progress">
          {steps.map((s, i) => (
            <div className={`fxr-tl__step is-${s.state}`} key={s.key}>
              <div className="fxr-tl__dot" aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</div>
              <div>
                <div className="fxr-tl__label">{s.label}</div>
                <div className="fxr-tl__sub">
                  {s.key === "enquiry" ? String(cargo.commodity_name ?? "") : s.key === "negotiating" ? `${agreedCount}/${view.terms.length} agreed` : s.key === "subjects" ? `${view.subjects.filter((x) => x.status === "lifted").length}/${view.subjects.length} lifted` : "charter party"}
                </div>
              </div>
              {i < steps.length - 1 && <div className="fxr-tl__bar" aria-hidden="true" />}
            </div>
          ))}
        </div>

        <div className="fxr-body">
          <div className="fxr-main">
            {room.status === "fixed" && (
              <div className="fxr-banner is-info" data-testid="fixed-banner">
                <div className="fxr-banner__body"><div className="fxr-banner__title">Clean fixture · {String(cargo.commodity_name ?? "")} / {String(vessel.vessel_name ?? "")}</div>All terms agreed and every subject lifted{room.fixedAt ? ` · ${relativeTime(room.fixedAt, now)}` : ""}. The recap below is the record.</div>
              </div>
            )}
            {terminal && (
              <div className="fxr-banner is-error" data-testid="closed-banner">
                <div className="fxr-banner__body"><div className="fxr-banner__title">Room {ROOM_STATUS_LABEL[room.status].toLowerCase()}</div>{room.closedNote ?? "Positions below are frozen as last exchanged. Start a new room to try again."}</div>
              </div>
            )}
            <div className="fxr-list__hd"><span>The main terms</span><span>{agreedCount}/{view.terms.length} agreed</span></div>
            {view.terms.map((t) => (
              <TermRow key={t.id} view={view} term={t} active={activeTermId === t.id} onActivate={() => setActiveTermId((id) => (id === t.id ? null : t.id))} run={run} busy={busy} now={now} actForPartyId={actFor} />
            ))}
          </div>

          <div className="fxr-rail">
            <CounterpartyCard view={view} run={run} busy={busy} actForPartyId={actFor} />
            <RecapRail view={view} run={run} busy={busy} actForPartyId={actFor} />
            <SubjectsRail view={view} run={run} busy={busy} actForPartyId={actFor} now={now} />
            <MessagesPanel view={view} run={run} busy={busy} now={now} />
            <ActivityFeed view={view} now={now} />
          </div>
        </div>

        {/* footer */}
        <div className={`fxr-foot${room.status === "fixed" ? " is-fixed" : terminal ? " is-void" : requiredOpen.length === 0 && room.status === "negotiating" ? " is-ready" : ""}`} data-testid="room-footer">
          <div className="fxr-foot__status">
            <div className="fxr-foot__icon" aria-hidden="true">{room.status === "fixed" ? "✓" : terminal ? "✕" : requiredOpen.length === 0 ? "!" : "◷"}</div>
            <div className="fxr-foot__headline">
              {room.status === "fixed" ? "Clean fixed"
                : terminal ? `Negotiation ${ROOM_STATUS_LABEL[room.status].toLowerCase()}`
                : room.status === "on_subjects" ? `Fixed on subs · ${view.subjects.filter((s) => s.status === "lifted").length}/${view.subjects.length} subjects lifted`
                : requiredOpen.length === 0 ? "All terms agreed · ready to fix on subs"
                : `${requiredOpen.length} term${requiredOpen.length === 1 ? "" : "s"} still open`}
            </div>
          </div>
          <div className="fxr-foot__cta">
            {confirmWithdraw && !terminal ? (
              <>
                <span>Walk away from this deal?</span>
                <button type="button" className="asb-btn danger" disabled={busy} data-testid="withdraw-confirm" onClick={() => { setConfirmWithdraw(false); void run("close", (b) => ({ ...b, reason: "withdrawn", note: null, onBehalfOfPartyId: actFor })); }}>Confirm withdraw</button>
                <button type="button" className="asb-btn" onClick={() => setConfirmWithdraw(false)}>Keep negotiating</button>
              </>
            ) : (
              <>
                {caps.canWithdraw && <button type="button" className="fxr-foot__walk" data-testid="withdraw" onClick={() => setConfirmWithdraw(true)}>Withdraw</button>}
                {(caps.canFail || caps.canExpire) && (
                  <button type="button" className="fxr-foot__walk" disabled={busy} data-testid="mark-failed"
                    onClick={() => { const note = window.prompt("Reason (failed / expired)?") ?? ""; if (note) void run("close", (b) => ({ ...b, reason: "failed", note })); }}>Mark failed</button>
                )}
                {caps.canFixOnSubjects && (
                  <button type="button" className="asb-btn primary" disabled={busy || requiredOpen.length > 0} data-testid="fix-on-subs" title={requiredOpen.length ? `Still open: ${requiredOpen.join(", ")}` : "Record the fixture on subjects"}
                    onClick={() => run("fix", (b) => ({ ...b }))}>
                    {openSubjects > 0 ? "Fix on subs →" : "Fix clean (no subjects) →"}
                  </button>
                )}
                {room.status === "on_subjects" && <span className="fxr-muted">{openSubjects} subject{openSubjects === 1 ? "" : "s"} left · lift them in the rail</span>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
