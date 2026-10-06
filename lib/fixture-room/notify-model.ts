// Fixture Room · notification rules (Phase 1.1, plan "Notifications for the
// negotiation"). Pure: given one ledger event and the room's masked context,
// decide who hears about it, how urgently, and in what words. The shared
// notification core (integration-owned, O2C-009) stores and delivers; the
// Fixture projector calls this and writes what it returns.
//
// Masking is enforced here, by construction: the only identities a message
// may carry are the three masked labels derived below from the acting
// party's governed side ("Owner side", "Charterer side", "Arab ShipBroker"),
// the room reference, term labels and display values. No caller-supplied
// label is accepted (C2O-010): no person, email, phone, organisation name,
// vessel name or identifier can enter a title, body or link.
//
// The shared core's contract (C2O-009/C2O-010): importance is urgent, normal
// or info (the recipient's instant / digest / off preference schedules the
// email, never the importance); one enqueue per event and recipient, whose
// dedupe key carries no channel; a whitelisted payload; and no expiry, because
// the core hides an expired notification from the bell and rejects a past one.
import type { FixtureEventType, FixtureSide } from "./types";

export type NotifyImportance = "urgent" | "normal" | "info";
export type NotifyAudience = "other_side" | "both_sides" | "mediator" | "all";

/** The acting party as the ledger records it: its governed side and whether it is the platform. */
export interface NotifyActor {
  side: FixtureSide | "mediator" | null;
  isPlatform: boolean;
}

/** The only three labels an outbound message may name an actor by. */
export type MaskedActorLabel = "Charterer side" | "Owner side" | "Arab ShipBroker";

export function maskedActorLabel(actor: NotifyActor | null): MaskedActorLabel {
  if (!actor || actor.isPlatform) return "Arab ShipBroker";
  if (actor.side === "cargo") return "Charterer side";
  if (actor.side === "vessel") return "Owner side";
  return "Arab ShipBroker";   // the mediator desk, or an actorless (system) event
}

export interface NotifyContext {
  roomId: string;
  roomRef: string;
  /** The acting party (null for an actorless system event); its label is derived, never passed in. */
  actor: NotifyActor | null;
  payload: Record<string, unknown>;
}

export interface NotifyRule {
  audience: NotifyAudience;
  importance: NotifyImportance;
  title: string;
  body: string;
  /** In-app deep link; the recipient's own session decides what they may see there. */
  href: string;
  /** For lapse warnings and validity windows: when the move expires. */
  deadlineAt: string | null;
}

const str = (v: unknown) => (v == null ? "" : String(v));
const termOf = (p: Record<string, unknown>) => str(p.termLabel || p.termCode).toLowerCase() || "a term";
// a close reason is one of the governed values; anything else is shown as "closed"
const subjectRef = (p: Record<string, unknown>) => (Number.isInteger(Number(p.seq)) && Number(p.seq) > 0 ? `subject ${Number(p.seq)}` : "a subject");
const closeReason = (v: unknown) => (v === "withdrawn" || v === "failed" || v === "expired" ? v : "closed");

/** One rule per event type that deserves a notification; null for the rest. */
export function notificationFor(type: FixtureEventType, ctx: NotifyContext): NotifyRule | null {
  const p = ctx.payload;
  const room = ctx.roomRef;
  const base = `/dashboard/fixture-room/${ctx.roomId}`;
  const who = maskedActorLabel(ctx.actor);
  switch (type) {
    case "party.invited":
      return { audience: "other_side", importance: "urgent", title: `Invitation to fixture ${room}`, body: `${who} opened a fixture room on your listing. Accept to negotiate.`, href: base, deadlineAt: null };
    case "party.accepted":
      return { audience: "other_side", importance: "normal", title: `${room}: counterparty joined`, body: `${who} accepted the invitation. The negotiation is open.`, href: base, deadlineAt: null };
    case "proposal.submitted": {
      const deadline = str(p.expiresAt) || null;
      return {
        audience: "other_side", importance: deadline ? "urgent" : "normal",
        title: `${room}: ${p.kind === "bid" ? "bid" : "offer"} on ${termOf(p)}`,
        body: `${who} ${p.kind === "bid" ? "bid" : "offered"} ${str(p.displayValue)} on ${termOf(p)}${p.isFinal ? " (final)" : ""}${deadline ? ", valid until the time shown" : ""}. Your move.`,
        href: `${base}#term-${str(p.termCode)}`, deadlineAt: deadline,
      };
    }
    case "proposal.lapsed":
      return { audience: "both_sides", importance: "normal", title: `${room}: figure lapsed on ${termOf(p)}`, body: `The ${str(p.side)} side's ${str(p.displayValue)} on ${termOf(p)} lapsed without an answer.`, href: `${base}#term-${str(p.termCode)}`, deadlineAt: null };
    case "term.agreed":
      return { audience: "both_sides", importance: "normal", title: `${room}: ${termOf(p)} agreed`, body: `${termOf(p)} agreed at ${str(p.displayValue)}.`, href: base, deadlineAt: null };
    case "term.reopened":
      // the reason is free text a member typed: it stays in the room, never in a notification
      return { audience: "both_sides", importance: "normal", title: `${room}: ${termOf(p)} reopened`, body: `${who} reopened ${termOf(p)}.`, href: base, deadlineAt: null };
    case "term.referred":
      return { audience: "mediator", importance: "urgent", title: `${room}: ${termOf(p)} referred to principal`, body: `${who} referred ${termOf(p)}. The item waits for a decision.`, href: base, deadlineAt: null };
    case "room.fix_confirmed":
      // PR-07: the first side's confirmation is what the other side must act on; the second fixes the room
      if (!p.awaitingSide) return null;
      return { audience: "other_side", importance: "urgent", title: `${room}: fixture confirmed by the other side`, body: `${who} confirmed the fixture on the agreed terms. Your confirmation fixes it.`, href: base, deadlineAt: null };
    case "room.fixed_on_subjects":
      return { audience: "all", importance: "urgent", title: `${room}: fixed on subjects`, body: `Both sides confirmed every required term. The fixture is recorded on subjects.`, href: base, deadlineAt: null };
    case "subject.reinstated":
      return { audience: "both_sides", importance: "normal", title: `${room}: subject open again`, body: `A term was reopened, so ${subjectRef(p)} is open again.`, href: base, deadlineAt: null };
    case "subject.lifted":
      // a subject's title is free text a member typed: it stays in the room, never in a
      // notification (C2O-012 item 2); the governed subject number identifies it
      return { audience: "both_sides", importance: "normal", title: `${room}: subject lifted`, body: `${who} lifted ${subjectRef(p)}.`, href: base, deadlineAt: null };
    case "subject.failed":
      return { audience: "all", importance: "urgent", title: `${room}: subject failed`, body: `${subjectRef(p)[0].toUpperCase()}${subjectRef(p).slice(1)} failed. The fixture fails with it.`, href: base, deadlineAt: null };
    case "room.fixed":
      return { audience: "all", importance: "urgent", title: `${room}: clean fixed`, body: `All subjects lifted. The fixture is clean.`, href: `${base}/recap`, deadlineAt: null };
    case "recap.published":
      return { audience: "other_side", importance: "urgent", title: `${room}: recap v${str(p.versionNo)} to acknowledge`, body: `${who} published recap v${str(p.versionNo)}. Please review and acknowledge it.`, href: `${base}/recap`, deadlineAt: null };
    case "room.counterparty_disclosed":
      return { audience: "both_sides", importance: "normal", title: `${room}: identities released`, body: `Both principals agreed to disclose. Organisation names are now shown in the room.`, href: base, deadlineAt: null };
    case "message.posted":
      // nudges are what a principal must act on; an ordinary note is information (the
      // recipient's email preference decides instant, digest or none); private notes notify no one
      if (str(p.visibility || "room") !== "room") return null;
      return p.kind === "nudge"
        ? { audience: "other_side", importance: "urgent", title: `${room}: your answer is awaited`, body: `${who} is waiting for your answer.`, href: base, deadlineAt: null }
        : { audience: "other_side", importance: "info", title: `${room}: new message`, body: `${who} posted a message in the room.`, href: base, deadlineAt: null };
    case "room.closed":
      return { audience: "all", importance: "urgent", title: `${room}: negotiation ${closeReason(p.reason)}`, body: `${who} closed the room (${closeReason(p.reason)}).`, href: base, deadlineAt: null };
    default:
      return null;
  }
}

/**
 * A lapse warning, emitted two minutes before a validity window ends. A delayed
 * run never warns about a window that has already closed: null once expiresAt is past.
 */
export function lapseWarning(ctx: NotifyContext & { expiresAt: string }, now: Date = new Date()): NotifyRule | null {
  const ends = Date.parse(ctx.expiresAt);
  if (Number.isNaN(ends) || ends <= now.getTime()) return null;
  const p = ctx.payload;
  return {
    audience: "other_side", importance: "urgent",
    title: `${ctx.roomRef}: ${termOf(p)} lapses in 2 minutes`,
    body: `${maskedActorLabel(ctx.actor)}'s ${str(p.displayValue)} on ${termOf(p)} lapses soon. Accept or counter before it does.`,
    href: `/dashboard/fixture-room/${ctx.roomId}#term-${str(p.termCode)}`, deadlineAt: ctx.expiresAt,
  };
}

/**
 * The dedupe key of one logical notification. The core's unique key is
 * (recipient, dedupe key), and the core creates the email delivery itself, so
 * the key names the event (and a variant such as the lapse warning) only:
 * never a channel.
 */
export function notificationKey(eventId: number, variant?: "lapse-warning"): string {
  return variant ? `fixture:${eventId}:${variant}` : `fixture:${eventId}`;
}

/** The only fields sent to the shared core with a notification (never the source event payload). */
export interface NotifyPayload {
  roomId: string; roomRef: string; eventSeq: number; eventType: string; termCode: string | null; deadlineAt: string | null;
}
export function notificationPayload(ctx: NotifyContext, eventSeq: number, eventType: string, rule: NotifyRule): NotifyPayload {
  const termCode = ctx.payload.termCode == null ? null : String(ctx.payload.termCode);
  return { roomId: ctx.roomId, roomRef: ctx.roomRef, eventSeq, eventType, termCode, deadlineAt: rule.deadlineAt };
}

/** p_expires_at for the core: always none. The deadline travels in the payload; an expired row would vanish from the bell. */
export const NOTIFICATION_EXPIRES_AT: null = null;
