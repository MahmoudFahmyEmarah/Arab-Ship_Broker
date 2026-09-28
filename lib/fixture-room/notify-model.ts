// Fixture Room · notification rules (Phase 1.1, plan "Notifications for the
// negotiation"). Pure: given one ledger event and the room's masked context,
// decide who hears about it, how urgently, and in what words. The shared
// notification core (integration-owned, O2C-009) stores and delivers; the
// Fixture projector calls this and writes what it returns.
//
// Masking is enforced here, by construction: the only identities a message
// may carry are the masked party labels the room itself shows ("Owner side",
// "Charterer side", "Arab ShipBroker"), the room reference, term labels and
// display values. No person, email, phone, organisation name, vessel name
// or identifier enters a title, body or link.
import type { FixtureEventType, FixtureSide } from "./types";

export type NotifyImportance = "urgent" | "normal" | "digest";
export type NotifyAudience = "other_side" | "both_sides" | "mediator" | "all";

export interface NotifyContext {
  roomId: string;
  roomRef: string;
  /** The masked label of the acting party as the room renders it. */
  actorLabel: string;
  /** The side that acted, or null for the platform / system. */
  actorSide: FixtureSide | null;
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

/** One rule per event type that deserves a notification; null for the rest. */
export function notificationFor(type: FixtureEventType, ctx: NotifyContext): NotifyRule | null {
  const p = ctx.payload;
  const room = ctx.roomRef;
  const base = `/dashboard/fixture-room/${ctx.roomId}`;
  const who = ctx.actorLabel || "The other side";
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
      return { audience: "both_sides", importance: "normal", title: `${room}: ${termOf(p)} reopened`, body: `${who} reopened ${termOf(p)}${p.reason ? ` · ${str(p.reason)}` : ""}.`, href: base, deadlineAt: null };
    case "term.referred":
      return { audience: "mediator", importance: "urgent", title: `${room}: ${termOf(p)} referred to principal`, body: `${who} referred ${termOf(p)}. The item waits for a decision.`, href: base, deadlineAt: null };
    case "room.fixed_on_subjects":
      return { audience: "all", importance: "urgent", title: `${room}: fixed on subjects`, body: `Every required term is agreed. The fixture is recorded on subjects.`, href: base, deadlineAt: null };
    case "subject.lifted":
      return { audience: "both_sides", importance: "normal", title: `${room}: subject lifted`, body: `${who} lifted “${str(p.title)}”.`, href: base, deadlineAt: null };
    case "subject.failed":
      return { audience: "all", importance: "urgent", title: `${room}: subject failed`, body: `“${str(p.title)}” failed. The fixture fails with it.`, href: base, deadlineAt: null };
    case "room.fixed":
      return { audience: "all", importance: "urgent", title: `${room}: clean fixed`, body: `All subjects lifted. The fixture is clean.`, href: `${base}/recap`, deadlineAt: null };
    case "recap.published":
      return { audience: "other_side", importance: "urgent", title: `${room}: recap v${str(p.versionNo)} to acknowledge`, body: `${who} published recap v${str(p.versionNo)}. Please review and acknowledge it.`, href: `${base}/recap`, deadlineAt: null };
    case "room.counterparty_disclosed":
      return { audience: "both_sides", importance: "normal", title: `${room}: identities released`, body: `Both principals agreed to disclose. Organisation names are now shown in the room.`, href: base, deadlineAt: null };
    case "message.posted":
      // nudges are what a principal must act on; ordinary notes go to the daily digest
      return p.kind === "nudge"
        ? { audience: "other_side", importance: "urgent", title: `${room}: your answer is awaited`, body: `${who} is waiting for your answer${p.termLabel ? ` on ${termOf(p)}` : ""}.`, href: base, deadlineAt: null }
        : { audience: "other_side", importance: "digest", title: `${room}: new message`, body: `${who} posted a message in the room.`, href: base, deadlineAt: null };
    case "room.closed":
      return { audience: "all", importance: "urgent", title: `${room}: negotiation ${str(p.reason)}`, body: `${who} closed the room (${str(p.reason)}).`, href: base, deadlineAt: null };
    default:
      return null;
  }
}

/** A lapse warning, emitted by the dispatcher two minutes before a validity window ends. */
export function lapseWarning(ctx: NotifyContext & { expiresAt: string }): NotifyRule {
  const p = ctx.payload;
  return {
    audience: "other_side", importance: "urgent",
    title: `${ctx.roomRef}: ${termOf(p)} lapses in 2 minutes`,
    body: `${ctx.actorLabel || "The other side"}'s ${str(p.displayValue)} on ${termOf(p)} lapses soon. Accept or counter before it does.`,
    href: `/dashboard/fixture-room/${ctx.roomId}#term-${str(p.termCode)}`, deadlineAt: ctx.expiresAt,
  };
}

/** Idempotency key for a delivery: one notification per event and recipient, whatever retries happen. */
export function notificationKey(eventId: number, recipientUserId: string, channel: "in_app" | "email"): string {
  return `fixture:${eventId}:${recipientUserId}:${channel}`;
}
