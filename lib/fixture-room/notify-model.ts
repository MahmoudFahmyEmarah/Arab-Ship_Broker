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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * The offer's deadline, named in the copy — mirrors public.fn_fixture_notify_deadline_label. Only an ISO timestamp
 * with an explicit offset is named ("until 08 Oct 2026 12:00 UTC", minutes truncated); anything else, including an
 * impossible calendar date, reads "for a limited time".
 */
export function deadlineLabel(at: string): string {
  if (!ISO_WITH_OFFSET.test(at)) return "for a limited time";
  // V8 reads only ±HH:MM offsets; PostgreSQL also takes ±HH and ±HHMM
  const t = Date.parse(at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  const [y, mo, d] = at.slice(0, 10).split("-").map(Number);
  // V8 rolls 30 Feb over into March; PostgreSQL refuses it — both read it as "for a limited time"
  const local = new Date(Date.UTC(y!, mo! - 1, d!));
  if (Number.isNaN(t) || local.getUTCMonth() !== mo! - 1 || local.getUTCDate() !== d) return "for a limited time";
  const u = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  return `until ${two(u.getUTCDate())} ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()} ${two(u.getUTCHours())}:${two(u.getUTCMinutes())} UTC`;
}

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
const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
/**
 * The figure an outbound message may carry (C2O-092 #1). Values of a governed numeric/date kind are server-formatted
 * from validated input and pass; a free-text term never leaves the room (generic words instead); a port pair carries
 * only UN/LOCODEs found in the ports registry (portsVerified), never member-typed names. An unknown kind is free text.
 */
export function outboundValue(p: Record<string, unknown>): string {
  const kind = str(p.valueKind);
  if (kind === "number" || kind === "money_per_mt" || kind === "rate_pair" || kind === "date_range") return str(p.displayValue);
  if (kind === "port_pair") {
    const v = (p.value ?? {}) as Record<string, unknown>;
    const load = str(v.load).toUpperCase(), disch = str(v.disch).toUpperCase();
    // shape is not enough (a five-letter word looks like a code): the projector marks codes it found in the ports
    // registry; only those are shown
    return p.portsVerified === true && LOCODE.test(load) && LOCODE.test(disch) ? `${load} → ${disch}` : "new ports";
  }
  return "a new wording";
}

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
        body: `${who} ${p.kind === "bid" ? "bid" : "offered"} ${outboundValue(p)} on ${termOf(p)}${p.isFinal ? " (final)" : ""}${deadline ? `, valid ${deadlineLabel(deadline)}` : ""}. Your move.`,
        href: `${base}#term-${str(p.termCode)}`, deadlineAt: deadline,
      };
    }
    case "proposal.lapsed":
      return { audience: "both_sides", importance: "normal", title: `${room}: figure lapsed on ${termOf(p)}`, body: `The ${str(p.side)} side's ${outboundValue(p)} on ${termOf(p)} lapsed without an answer.`, href: `${base}#term-${str(p.termCode)}`, deadlineAt: null };
    case "term.agreed":
      return { audience: "both_sides", importance: "normal", title: `${room}: ${termOf(p)} agreed`, body: `${termOf(p)} agreed at ${outboundValue(p)}.`, href: base, deadlineAt: null };
    case "term.reopened":
      // the reason is free text a member typed: it stays in the room, never in a notification
      return { audience: "both_sides", importance: "normal", title: `${room}: ${termOf(p)} reopened`, body: `${who} reopened ${termOf(p)}.`, href: base, deadlineAt: null };
    case "term.referred":
      return { audience: "mediator", importance: "urgent", title: `${room}: ${termOf(p)} referred to principal`, body: `${who} referred ${termOf(p)}. The item waits for a decision.`, href: base, deadlineAt: null };
    case "term.bridge_suggested":
      // the mediator's comment is free text: it stays in the room; the governed figure is what both sides weigh
      return { audience: "both_sides", importance: "normal", title: `${room}: suggested figure on ${termOf(p)}`, body: `${who} suggested ${outboundValue(p)} on ${termOf(p)} to bridge the gap. Either side may adopt it.`, href: `${base}#term-${str(p.termCode)}`, deadlineAt: null };
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
    case "room.window_extended":
      // C2O-092 #3: both sides learn the negotiation has more time (the date stays in the room)
      return { audience: "both_sides", importance: "normal", title: `${room}: negotiation window extended`, body: `${who} extended the negotiation window.`, href: base, deadlineAt: null };
    case "room.closed":
      return { audience: "all", importance: "urgent", title: `${room}: negotiation ${closeReason(p.reason)}`, body: `${who} closed the room (${closeReason(p.reason)}).`, href: base, deadlineAt: null };
    default:
      return null;
  }
}

/**
 * The dedupe key of one logical notification. The core's unique key is
 * (recipient, dedupe key), and the core creates the email delivery itself, so
 * the key names the event only: never a channel. (C2O-092 P2: there is no
 * separate lapse warning — an offer with validity is urgent and names its deadline.)
 */
export function notificationKey(eventId: number): string {
  return `fixture:${eventId}`;
}

/** The only fields sent to the shared core with a notification (never the source event payload). */
export interface NotifyPayload {
  roomId: string; roomRef: string; eventSeq: number; eventType: string; termCode: string | null; deadlineAt: string | null;
}
export function notificationPayload(ctx: NotifyContext, eventSeq: number, eventType: string, rule: NotifyRule): NotifyPayload {
  const termCode = ctx.payload.termCode == null ? null : String(ctx.payload.termCode);
  return { roomId: ctx.roomId, roomRef: ctx.roomRef, eventSeq, eventType, termCode, deadlineAt: rule.deadlineAt };
}

/** p_expires_at for the core (C2O-092 #2): the offer's deadline is the email cut-off; the bell keeps the row, marked expired. */
export function notificationExpiresAt(rule: NotifyRule): string | null {
  return rule.deadlineAt;
}
