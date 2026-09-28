"use client";

// The room as designed (asb/negotiation-room · nr-*): header with the deal
// line, the counterparty mask chip, the phase pill, the reply-window clock and
// the icon actions; the phase timeline; the main column of term strips with
// the two sides' presence; the right rail; the footer state machine; toasts
// for the other side's moves. Server-authoritative: every command goes to a
// governed RPC with expected_version + idempotency_key; the reply is a typed
// envelope or a typed refusal. On FX_VERSION_CONFLICT the room refetches and
// tells the user; nothing is retried silently. Polling keeps the other side's
// moves visible without Realtime (decision: polling in v1); presence is what
// the ledger shows (decision D-3).
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { FixtureRoomView } from "@/lib/fixture-room/types";
import type { FixtureError } from "@/lib/fixture-room/errors";
import { FIXTURE_ERROR_TITLE, isFixtureError } from "@/lib/fixture-room/errors";
import { ROOM_STATUS_LABEL, isTerminal, timelineSteps } from "@/lib/fixture-room/state-machine";
import { listingSyncNotice } from "@/lib/fixture-room/listing-sync";
import { GestureKeys, UNCERTAIN_MESSAGE, runGesture, useNow, useRoomVersionPoll } from "@/lib/fixture-room/client";
import { countdown, relativeTime } from "@/lib/fixture-room/format";
import { sidePresence } from "@/lib/fixture-room/presence";
import { newSince, readLastSeen, termsTouched, writeLastSeen } from "@/lib/fixture-room/last-seen";
import { BunkerTicker } from "@/components/portal/BunkerTicker";
import {
  acceptFixtureProposalAction, acknowledgeFixtureRecapAction, addFixtureSubjectAction, agreeFixtureDisclosureAction, closeFixtureRoomAction,
  extendFixtureSubjectAction, failFixtureSubjectAction, fixFixtureOnSubjectsAction, inviteFixturePartyAction, liftFixtureSubjectAction, loadFixtureRoom,
  pollFixtureRoomVersion, postFixtureMessageAction, publishFixtureRecapAction, reopenFixtureTermAction, respondFixtureInvitationAction,
  setFixtureTermFlagAction, submitFixtureProposalAction, withdrawFixtureProposalAction,
} from "@/app/(dashboard)/dashboard/fixture-room/actions";
import { TermRow } from "./TermRow";
import { ActivityFeed, CounterpartyCard, MessagesPanel, RecapRail, SubjectsRail, eventText } from "./RoomRails";
import { phaseClass } from "./RoomInbox";
import { RecapComposer } from "./RecapComposer";
import { IcAnchor, IcBarrel, IcDownload, IcMail, IcRefresh, IcVolume, IcVolumeOff } from "./icons";

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
} as const;
export type CommandName = keyof typeof ACTIONS;
export interface CommandBaseArgs { roomId: string; expectedVersion: number; idempotencyKey: string }
export type RunCommand = (name: CommandName, build: (base: CommandBaseArgs) => Record<string, unknown>) => Promise<boolean>;

type Toast = { id: number; side: "cargo" | "vessel" | "broker"; text: string };
const SOUND_KEY = "asb.fx.sound";
const CHIME_TYPES = new Set(["proposal.submitted", "proposal.lapsed", "term.agreed", "party.accepted", "recap.published"]);

/** Two-tone chime on an incoming move (WebAudio, no asset). Silent until the browser allows audio. */
function playPing(ctxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let ctx = ctxRef.current;
    if (!ctx) { ctx = new AC(); ctxRef.current = ctx; }
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = "sine"; o.frequency.value = f;
      o.connect(g); g.connect(ctx!.destination);
      const t0 = now + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.start(t0); o.stop(t0 + 0.18);
    });
  } catch { /* audio is a nicety */ }
}

export function FixtureRoomClient({ initial }: { initial: FixtureRoomView }) {
  const [view, setView] = React.useState<FixtureRoomView>(initial);
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [announce, setAnnounce] = React.useState("");
  const [activeTermId, setActiveTermId] = React.useState<string | null>(() => initial.terms.find((t) => t.status !== "agreed")?.id ?? initial.terms[0]?.id ?? null);
  const [hoverSlot, setHoverSlot] = React.useState<string | null>(null);
  const [actFor, setActFor] = React.useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = React.useState(false);
  const [inviteParty, setInviteParty] = React.useState<string | null>(null);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [bunker, setBunker] = React.useState(false);
  const [recapOpen, setRecapOpen] = React.useState(false);
  const [justAgreed, setJustAgreed] = React.useState<Set<string>>(() => new Set());
  const prevStatus = React.useRef<Record<string, string>>(Object.fromEntries(initial.terms.map((t) => [t.id, t.status])));
  const [soundOn, setSoundOn] = React.useState(true);
  const audioRef = React.useRef<AudioContext | null>(null);
  const lastSeqRef = React.useRef<number>(Math.max(0, ...initial.events.map((e) => e.seq)));
  // "new since your last visit": the sequence remembered from the previous visit (read once, after mount)
  const [lastVisitSeq, setLastVisitSeq] = React.useState<number | null>(null);
  const latestSeq = Math.max(0, ...view.events.map((e) => e.seq));
  React.useEffect(() => { setLastVisitSeq(readLastSeen(initial.room.id)); }, [initial.room.id]);
  React.useEffect(() => {
    const remember = () => writeLastSeen(initial.room.id, latestSeqRef.current);
    const onHide = () => { if (document.visibilityState === "hidden") remember(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", remember);
    return () => { remember(); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", remember); };
  }, [initial.room.id]);
  const latestSeqRef = React.useRef(latestSeq);
  React.useEffect(() => { latestSeqRef.current = latestSeq; }, [latestSeq]);
  const now = useNow();
  const roomId = view.room.id;
  // one idempotency key per gesture, kept until the server has answered (audit FR-M5)
  const keys = React.useMemo(() => new GestureKeys(), []);

  React.useEffect(() => {
    try { const v = localStorage.getItem(SOUND_KEY); if (v != null) setSoundOn(v === "1"); } catch { /* preference only */ }
  }, []);
  const toggleSound = () => {
    setSoundOn((s) => { const n = !s; try { localStorage.setItem(SOUND_KEY, n ? "1" : "0"); } catch { /* preference only */ } return n; });
    const c = audioRef.current; if (c && c.state === "suspended") void c.resume();
  };

  const pushToast = React.useCallback((side: Toast["side"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { id, side, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  }, []);

  // the other side's moves since the last look become toasts (and a chime when allowed)
  const noticeNewEvents = React.useCallback((v: FixtureRoomView) => {
    const mine = new Set(v.viewer.partyIds);
    const fresh = v.events.filter((e) => e.seq > lastSeqRef.current && !(e.actorPartyId && mine.has(e.actorPartyId)));
    lastSeqRef.current = Math.max(lastSeqRef.current, ...v.events.map((e) => e.seq));
    if (fresh.length === 0) return;
    for (const e of fresh.slice(-3)) {
      const party = v.parties.find((p) => p.id === e.actorPartyId);
      const side: Toast["side"] = party?.side === "cargo" || party?.side === "vessel" ? party.side : "broker";
      pushToast(side, `${e.actorLabel} ${eventText(e)}`);
    }
    if (soundOn && fresh.some((e) => CHIME_TYPES.has(e.type))) playPing(audioRef);
  }, [pushToast, soundOn]);

  const refetch = React.useCallback(async (): Promise<FixtureRoomView | null> => {
    const v = await loadFixtureRoom(roomId);
    if (isFixtureError(v)) {
      toast.error(v.message);
      return null;
    }
    setView(v);
    noticeNewEvents(v);
    return v;
  }, [roomId, noticeNewEvents]);

  React.useEffect(() => {
    const prev = prevStatus.current;
    const fresh = view.terms.filter((t) => t.status === "agreed" && prev[t.id] && prev[t.id] !== "agreed").map((t) => t.id);
    prevStatus.current = Object.fromEntries(view.terms.map((t) => [t.id, t.status]));
    if (fresh.length === 0) return;
    setJustAgreed(new Set(fresh));
    const timer = setTimeout(() => setJustAgreed(new Set()), 900);
    return () => clearTimeout(timer);
  }, [view.terms]);

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
  const liftedCount = view.subjects.filter((s) => s.status === "lifted").length;
  const openSubjects = view.subjects.filter((s) => s.status === "open").length;
  const sync = listingSyncNotice(room, viewer.side);
  const myInvites = view.parties.filter((p) => p.isViewer && p.status === "invited");
  const invitePartyId = myInvites.length > 1 ? (myInvites.some((p) => p.id === inviteParty) ? inviteParty : myInvites[0].id) : null;
  const terminal = isTerminal(room.status);
  const steps = timelineSteps(room.status);
  const mySideLabel = viewer.side === "cargo" ? "You are on the cargo side" : viewer.side === "vessel" ? "You are on the vessel side" : viewer.isMediator ? "You mediate this room" : "You are observing";
  const relayedParties = view.parties.filter((p) => caps.actForPartyIds.includes(p.id));
  const presence = React.useMemo(() => ({
    cargo: sidePresence(view.events, view.parties, "cargo", now),
    vessel: sidePresence(view.events, view.parties, "vessel", now),
  }), [view.events, view.parties, now]);
  const freshEvents = newSince(view.events, lastVisitSeq, viewer.partyIds);
  const freshTerms = termsTouched(freshEvents, view.terms);
  const windowLeft = room.negotiationWindowEndsAt && now > 0 ? Date.parse(room.negotiationWindowEndsAt) - now : null;
  // the estimator's frozen hand-off contract (C2O-007): ids, ports and quantity; the vessel
  // name only once the owner has disclosed it; the estimator re-resolves every value
  const pdaParams = new URLSearchParams({ from: "fixture", ref: room.ref, cargoId: room.cargoListingId });
  if (room.vesselId) pdaParams.set("vesselId", room.vesselId);
  if (!snapshot.vesselIdentityMasked && vessel.vessel_name) pdaParams.set("vessel", String(vessel.vessel_name));
  if (cargo.load_port_locode) pdaParams.set("load", String(cargo.load_port_locode));
  if (cargo.disch_port_locode) pdaParams.set("disch", String(cargo.disch_port_locode));
  if (cargo.qty_max_mt != null) pdaParams.set("mt", String(cargo.qty_max_mt));
  const pdaHref = `/dashboard/ports-da?${pdaParams.toString()}`;


  return (
    <div className="nr">
      <div className="sr-only" aria-live="polite" role="status">{announce}</div>
      {bunker && <BunkerTicker />}

      {/* ── header ─────────────────────────────────────────────────── */}
      <div className="nr-head" data-testid="room-header">
        <div className="nr-head__top">
          <div className="nr-headline">
            <h1 className="nr-title">Fixture Room</h1>
            <span className="nr-ref">{room.ref}</span>
            <span className="nr-sub">
              <span className="strong">{String(cargo.commodity_name ?? "Cargo")}</span>
              <span className="arr">·</span>
              <span>{String(cargo.load_port_name ?? cargo.load_port_locode ?? "—")}</span><span className="arr">→</span><span>{String(cargo.disch_port_name ?? cargo.disch_port_locode ?? "—")}</span>
              <span className="arr">·</span>
              <span className="strong">{String(vessel.vessel_name ?? "TBN")}</span>
              {snapshot.vesselIdentityMasked && <span className="nr-tag" title="The owner has not disclosed the vessel yet">identity withheld</span>}
              {counterparty && (
                <span className={`nr-mask${room.counterpartyDisclosed ? " is-revealed" : ""}`} data-testid="counterparty-chip"
                  title={room.counterpartyDisclosed ? `Counterparty released · ${counterparty.name ?? counterparty.label}` : "Counterparty identity withheld until both principals agree to disclosure"}>
                  <span className="nr-mask__dot" aria-hidden="true" /> {room.counterpartyDisclosed && counterparty.name ? counterparty.name : `${counterparty.label} via ASB`}
                  {counterparty.participationMode === "relayed" && <span className="nr-tag is-relayed" style={{ marginLeft: 4 }}>relayed</span>}
                </span>
              )}
              <span className="nr-muted">· {mySideLabel}</span>
              <span className="arr">·</span><span className="nr-muted" data-testid="room-version">v{room.version}</span>
            </span>
          </div>
          <div className="nr-head__meta">
            {relayedParties.length > 0 && (
              <label className="fx-field" style={{ flex: "0 0 auto" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--asb-gray-500)" }}>Acting for</span>
                <select value={actFor ?? ""} onChange={(e) => setActFor(e.target.value || null)} data-testid="act-for">
                  <option value="">myself (mediator)</option>
                  {relayedParties.map((p) => <option key={p.id} value={p.id}>{p.label} (relayed)</option>)}
                </select>
              </label>
            )}
            <button type="button" className={`nr-newfix is-icon${bunker ? " is-on" : ""}`} onClick={() => setBunker((b) => !b)} title="Bunker prices" aria-label="Bunker prices" aria-pressed={bunker}><IcBarrel /></button>
            <button type="button" className={`nr-newfix is-icon${soundOn ? " is-on" : ""}`} onClick={toggleSound} title={soundOn ? "Sound on for incoming moves" : "Sound muted"} aria-label="Toggle sound" aria-pressed={soundOn}>{soundOn ? <IcVolume /> : <IcVolumeOff />}</button>
            <Link href={`/dashboard/fixture-room/${room.id}/summary`} className="nr-newfix is-icon" title="Negotiation summary (print or save as PDF)" aria-label="Negotiation summary" data-testid="export-summary"><IcDownload /></Link>
            <Link href={pdaHref} className="nr-newfix is-icon" title="Open both port calls in the Ports Cost Estimator" aria-label="Ports Cost Estimator"><IcAnchor /></Link>
            <button type="button" className="nr-newfix is-icon" onClick={() => setRecapOpen(true)} title="Send recap to both principals" aria-label="Send recap" data-testid="open-recap-composer"><IcMail /></button>
            <Link href={`/dashboard/fixture-room/${room.id}/recap`} className="nr-newfix is-icon" title="Printable recap" aria-label="Printable recap" data-testid="open-recap">▤</Link>
            <Link href="/dashboard/fixture-room/new" className="nr-newfix is-icon" title="Start a different match" aria-label="New fixture"><IcRefresh /></Link>
            <span className={`nr-phase ${phaseClass(room.status)}`} data-testid="room-status">
              <span className="nr-phase__dot" aria-hidden="true" />
              {ROOM_STATUS_LABEL[room.status]}
            </span>
            <div className="nr-clock">
              <div className="nr-clock__lbl">Reply window</div>
              <div className={`nr-clock__val${windowLeft != null && windowLeft < 300_000 ? " is-urgent" : ""}`}>{windowLeft == null ? "no limit" : windowLeft <= 0 ? "0:00" : countdown(room.negotiationWindowEndsAt, now)}</div>
            </div>
          </div>
        </div>
      </div>

      {toasts.length > 0 && (
        <div className="fx-toasts" role="status" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`fx-toast side-${t.side}`}>{t.text}</div>)}
        </div>
      )}

      {/* ── timeline ───────────────────────────────────────────────── */}
      <div className="fx-tl" aria-label="Fixture progress">
        {steps.map((s, i) => (
          <div className={`fx-tl__step is-${s.state}`} key={s.key}>
            <div className="fx-tl__dot" aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</div>
            <div className="fx-tl__body">
              <div className="fx-tl__label">{s.label}</div>
              <div className="fx-tl__sub">
                {s.key === "enquiry" ? String(cargo.commodity_name ?? "") : s.key === "negotiating" ? `${agreedCount}/${view.terms.length} agreed` : s.key === "subjects" ? `${liftedCount}/${view.subjects.length} lifted` : "charter party"}
              </div>
            </div>
            {i < steps.length - 1 && <div className="fx-tl__bar" aria-hidden="true" />}
          </div>
        ))}
      </div>

      {/* ── body ───────────────────────────────────────────────────── */}
      <div className="nr-body">
        <div className="nr-main">
          {conflict && (
            <div className="nr-banner is-warn" role="alert" data-testid="conflict-banner">
              <div className="nr-banner__body"><div className="nr-banner__title">The room moved on</div>{conflict}</div>
              <div className="nr-banner__cta"><button type="button" className="asb-btn" onClick={() => setConflict(null)}>Got it</button></div>
            </div>
          )}
          {sync && sync.outstanding && (
            <div className="nr-banner is-warn" role="status" data-testid="listing-sync-banner">
              <div className="nr-banner__body">
                <div className="nr-banner__title">{sync.headline}</div>
                <ul>{sync.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                <div style={{ marginTop: 4, fontSize: 11 }}>The room never changes a listing itself: update it through the listing page so the market and the fixture agree.</div>
              </div>
              <div className="nr-banner__cta">{sync.links.map((l) => <Link key={l.href} href={l.href} className="asb-btn">{l.label} →</Link>)}</div>
            </div>
          )}
          {caps.canRespondInvitation && (
            <div className="nr-banner is-info" role="status" data-testid="invitation-banner">
              <div className="nr-banner__body">
                <div className="nr-banner__title">You are invited into this room</div>Accept to negotiate; decline to step back.
                {myInvites.length > 1 && (
                  <label className="fx-field" style={{ marginTop: 6 }}>
                    <span>You hold {myInvites.length} invitations · answering as</span>
                    <select value={invitePartyId ?? ""} onChange={(e) => setInviteParty(e.target.value || null)} data-testid="invitation-party">
                      {myInvites.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.capacity}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="nr-banner__cta">
                <button type="button" className="asb-btn primary" disabled={busy} data-testid="invitation-accept" onClick={() => run("respond", (b) => ({ roomId: b.roomId, accept: true, expectedVersion: b.expectedVersion, idempotencyKey: b.idempotencyKey, partyId: invitePartyId }))}>Accept invitation</button>
                <button type="button" className="asb-btn" disabled={busy} onClick={() => run("respond", (b) => ({ roomId: b.roomId, accept: false, expectedVersion: b.expectedVersion, idempotencyKey: b.idempotencyKey, partyId: invitePartyId }))}>Decline</button>
              </div>
            </div>
          )}
          {room.status === "fixed" && (
            <div className="nr-fixed-banner" data-testid="fixed-banner">
              <div className="nr-foot__icon" style={{ background: "var(--asb-green)", color: "var(--asb-white)" }} aria-hidden="true">✓</div>
              <div>
                <div className="nr-fixed-banner__title">Clean Fixture · {String(cargo.commodity_name ?? "")} / {String(vessel.vessel_name ?? "TBN")}</div>
                <div className="nr-fixed-banner__sub">All terms agreed and every subject lifted{room.fixedAt ? ` · ${relativeTime(room.fixedAt, now)}` : ""}. The recap is the record.</div>
              </div>
            </div>
          )}
          {terminal && (
            <div className="nr-fixed-banner is-void" data-testid="closed-banner">
              <div className="nr-foot__icon" style={{ background: "var(--asb-red)", color: "var(--asb-white)" }} aria-hidden="true">✕</div>
              <div>
                <div className="nr-fixed-banner__title">Negotiation {ROOM_STATUS_LABEL[room.status].toLowerCase()} · {String(cargo.commodity_name ?? "")} / {String(vessel.vessel_name ?? "TBN")}</div>
                <div className="nr-fixed-banner__sub">{room.closedNote ?? "Positions below are frozen as last exchanged. Start a new room to try again."}</div>
              </div>
            </div>
          )}

          {freshEvents.length > 0 && (
            <div className="nr-banner is-info" role="status" data-testid="new-since-banner">
              <div className="nr-banner__body"><div className="nr-banner__title">{freshEvents.length} update{freshEvents.length === 1 ? "" : "s"} since your last visit</div>Marked <span className="fx-new">new</span> on the terms and in the activity log.</div>
              <div className="nr-banner__cta"><button type="button" className="asb-btn" onClick={() => { writeLastSeen(room.id, latestSeq); setLastVisitSeq(latestSeq); }}>Mark as seen</button></div>
            </div>
          )}
          <div className="nr-list__hd">
            <span>The main terms · {agreedCount}/{view.terms.length} agreed</span>
            <span className="fx-glance">
              <span className={`fx-pchip cargo st-${presence.cargo.state}`} title={`Cargo side · ${presence.cargo.label}`}><span className="fx-pdot" aria-hidden="true" />Cargo <em>{presence.cargo.state === "online" ? "online" : presence.cargo.state === "away" ? "away" : "off"}</em></span>
              <span className={`fx-pchip vessel st-${presence.vessel.state}`} title={`Vessel side · ${presence.vessel.label}`}><span className="fx-pdot" aria-hidden="true" />Vessel <em>{presence.vessel.state === "online" ? "online" : presence.vessel.state === "away" ? "away" : "off"}</em></span>
            </span>
          </div>
          <div className="nr-items">
            {view.terms.map((t) => (
              <TermRow key={t.id} view={view} term={t} isNew={freshTerms.has(t.id)} active={activeTermId === t.id} onActivate={() => setActiveTermId((id) => (id === t.id ? null : t.id))}
                run={run} busy={busy} now={now} actForPartyId={actFor} presence={presence} hovered={hoverSlot === t.id} onHover={setHoverSlot} />
            ))}
          </div>
        </div>

        {/* ── right rail ─────────────────────────────────────────── */}
        <div className="nr-rail">
          <CounterpartyCard view={view} run={run} busy={busy} actForPartyId={actFor} />
          <RecapRail view={view} run={run} busy={busy} actForPartyId={actFor} hoverSlot={hoverSlot} onHover={setHoverSlot} justAgreed={justAgreed} />
          <SubjectsRail view={view} run={run} busy={busy} actForPartyId={actFor} now={now} />
          <MessagesPanel view={view} run={run} busy={busy} now={now} />
          <ActivityFeed view={view} now={now} lastVisitSeq={freshEvents.length ? lastVisitSeq : null} />
        </div>
      </div>

      {recapOpen && <RecapComposer view={view} onClose={() => setRecapOpen(false)} />}

      {/* ── footer state machine ───────────────────────────────────── */}
      <div className={`nr-foot${room.status === "fixed" ? " is-fixed" : terminal ? " is-void" : requiredOpen.length === 0 && room.status === "negotiating" ? " is-ready" : ""}`} data-testid="room-footer">
        <div className="nr-foot__status">
          <div className="nr-foot__icon" aria-hidden="true">{room.status === "fixed" ? "✓" : terminal ? "✕" : requiredOpen.length === 0 ? "!" : "◷"}</div>
          <div className="nr-foot__headline">
            {room.status === "fixed" ? "Clean fixed · congratulations"
              : terminal ? `Negotiation ${ROOM_STATUS_LABEL[room.status].toLowerCase()}`
              : room.status === "on_subjects" ? `Fixed on subs · ${liftedCount}/${view.subjects.length} subjects lifted`
              : requiredOpen.length === 0 ? "All terms agreed · ready to fix on subs"
              : `${requiredOpen.length} term${requiredOpen.length === 1 ? "" : "s"} still open`}
          </div>
        </div>
        <div className="nr-foot__cta">
          {confirmWithdraw && !terminal ? (
            <>
              <span className="nr-foot__confirm">Walk away from this deal?</span>
              <button type="button" className="asb-btn danger" disabled={busy} data-testid="withdraw-confirm" onClick={() => { setConfirmWithdraw(false); void run("close", (b) => ({ ...b, reason: "withdrawn", note: null, onBehalfOfPartyId: actFor })); }}>Confirm withdraw</button>
              <button type="button" className="asb-btn" onClick={() => setConfirmWithdraw(false)}>Keep negotiating</button>
            </>
          ) : (
            <>
              {caps.canWithdraw && <button type="button" className="nr-foot__walk" data-testid="withdraw" onClick={() => setConfirmWithdraw(true)}>Withdraw</button>}
              {(caps.canFail || caps.canExpire) && (
                <button type="button" className="nr-foot__walk" disabled={busy} data-testid="mark-failed"
                  onClick={() => { const note = window.prompt("Reason (failed / expired)?") ?? ""; if (note) void run("close", (b) => ({ ...b, reason: "failed", note })); }}>Mark failed</button>
              )}
              {caps.canFixOnSubjects && (
                <button type="button" className="asb-btn primary" disabled={busy || requiredOpen.length > 0} data-testid="fix-on-subs" title={requiredOpen.length ? `Still open: ${requiredOpen.join(", ")}` : "Record the fixture on subjects"}
                  onClick={() => run("fix", (b) => ({ ...b }))}>
                  {openSubjects > 0 ? "Fix on subs →" : "Fix clean (no subjects) →"}
                </button>
              )}
              {room.status === "on_subjects" && <span className="nr-muted">{openSubjects} subject{openSubjects === 1 ? "" : "s"} left · lift them in the rail</span>}
              {room.status === "fixed" && <Link href={`/dashboard/fixture-room/${room.id}/recap`} className="asb-btn green">View recap →</Link>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
