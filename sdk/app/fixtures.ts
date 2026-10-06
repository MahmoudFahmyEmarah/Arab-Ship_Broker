// SDK for the Fixture Room (architecture 1.0, 23 Sep 2026).
//
// Thin typed wrappers around the governed RPCs. Reads throw a
// FixtureRequestError; commands return the envelope or a typed FixtureError.
// Every command carries expected_version and idempotency_key; the caller
// (the server actions) generates the key per user gesture and keeps it for
// retries, so a retried request replays instead of repeating.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { parseFixtureError, type FixtureError } from "@/lib/fixture-room/errors";
import { FIXTURE_TERM_CATALOGUE_VERSION } from "@/lib/fixture-room/terms";
import type {
  FixtureCloseReason, FixtureCommandOk, FixturePdaLinkDisplay, FixtureRoomListItem, FixtureRoomStatus, FixtureRoomView, FixtureTermFlag, FixtureTermInput, FixtureValue,
} from "@/lib/fixture-room/types";

export class FixtureRequestError extends Error {
  constructor(public readonly fx: FixtureError) {
    super(fx.message);
    this.name = "FixtureRequestError";
  }
}

const toError = (e: PostgrestError | { message?: string; code?: string } | null): FixtureError =>
  parseFixtureError(e?.message ?? null, (e as { code?: string } | null)?.code ?? null);

export type CommandResult<T = Record<string, unknown>> = FixtureCommandOk<T> | FixtureError;

async function command<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<CommandResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return toError(error);
  return data as FixtureCommandOk<T>;
}

export interface CommandBase {
  roomId: string;
  expectedVersion: number;
  idempotencyKey: string;
  asPartyId?: string | null;
  onBehalfOfPartyId?: string | null;
}
const base = (b: CommandBase) => ({
  p_room_id: b.roomId,
  p_expected_version: b.expectedVersion,
  p_idempotency_key: b.idempotencyKey,
  p_as_party_id: b.asPartyId ?? null,
});
const behalf = (b: CommandBase) => ({ ...base(b), p_on_behalf_of_party_id: b.onBehalfOfPartyId ?? null });

// ── reads ───────────────────────────────────────────────────────────────────
export async function getFixtureRoom(supabase: SupabaseClient, roomId: string, eventsAfter = 0): Promise<FixtureRoomView> {
  const { data, error } = await supabase.rpc("get_fixture_room", { p_room_id: roomId, p_events_after: eventsAfter });
  if (error) throw new FixtureRequestError(toError(error));
  return data as FixtureRoomView;
}

export async function getFixtureRoomVersion(supabase: SupabaseClient, roomId: string): Promise<number> {
  const { data, error } = await supabase.rpc("get_fixture_room_version", { p_room_id: roomId });
  if (error) throw new FixtureRequestError(toError(error));
  return Number(data);
}

export async function listFixtureRooms(supabase: SupabaseClient, statuses?: FixtureRoomStatus[] | null, limit = 50): Promise<FixtureRoomListItem[]> {
  const { data, error } = await supabase.rpc("list_fixture_rooms", { p_status: statuses ?? null, p_limit: limit });
  if (error) throw new FixtureRequestError(toError(error));
  return (data ?? []) as FixtureRoomListItem[];
}

/** Safe, shared PDA headers already attached to a room. The PDA estimate itself remains separately permissioned. */
export async function listFixturePdaLinks(supabase: SupabaseClient, roomId: string): Promise<FixturePdaLinkDisplay[]> {
  const { data, error } = await supabase.rpc("list_fixture_pda_links", { p_room_id: roomId });
  if (error) throw new FixtureRequestError(toError(error));
  return (data ?? []) as FixturePdaLinkDisplay[];
}

/**
 * Ranked counterparts for one of the actor's own listings (C2O-011). The RPC
 * refuses a listing the actor does not own or represent, never returns a
 * vessel id or IMO, and names a TBN hull 'TBN'. Rows are camelCase JSON.
 */
export async function listFixtureMatchCandidates(supabase: SupabaseClient, kind: "cargo" | "vessel", listingId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc("list_fixture_match_candidates", { p_kind: kind, p_listing_id: listingId });
  if (error) throw new FixtureRequestError(toError(error));
  return (data ?? []) as Record<string, unknown>[];
}

/** The live listings the actor owns or represents, by the create_fixture_room rule (organisation seats included). */
export async function listFixtureMyListings(supabase: SupabaseClient): Promise<{ cargo: Record<string, unknown>[]; vessels: Record<string, unknown>[] }> {
  const { data, error } = await supabase.rpc("list_fixture_my_listings");
  if (error) throw new FixtureRequestError(toError(error));
  const d = (data ?? {}) as { cargo?: Record<string, unknown>[]; vessels?: Record<string, unknown>[] };
  return { cargo: d.cargo ?? [], vessels: d.vessels ?? [] };
}

/** One durable access-log row of a room (admin console only; the RPC refuses members). */
export interface FixtureAccessLogEntry {
  id: number;
  userId: string | null;
  userLabel: string;
  isAdmin: boolean;
  reason: string;
  at: string;
}

export async function adminFixtureAccessLog(supabase: SupabaseClient, roomId: string, limit = 100): Promise<FixtureAccessLogEntry[]> {
  const { data, error } = await supabase.rpc("admin_fixture_access_log", { p_room_id: roomId, p_limit: limit });
  if (error) throw new FixtureRequestError(toError(error));
  return (data ?? []) as FixtureAccessLogEntry[];
}

// ── commands ────────────────────────────────────────────────────────────────
// The catalogue version is named explicitly: the database verifies the terms
// against exactly that versioned sheet and refuses any deviation (FR-H2).
export function createFixtureRoom(supabase: SupabaseClient, input: { cargoListingId: string; vesselAvailabilityId: string; terms: readonly FixtureTermInput[]; idempotencyKey: string; catalogueVersion?: string }) {
  return command<{ roomId: string; ref: string; status: FixtureRoomStatus }>(supabase, "create_fixture_room", {
    p_cargo_listing_id: input.cargoListingId,
    p_vessel_availability_id: input.vesselAvailabilityId,
    p_terms: input.terms,
    p_idempotency_key: input.idempotencyKey,
    p_options: { catalogueVersion: input.catalogueVersion ?? FIXTURE_TERM_CATALOGUE_VERSION },
  });
}

/** C2O-013: open a room from an opaque match handle (replay first, then actor, expiry, ownership, match). */
export function createFixtureRoomFromCandidate(supabase: SupabaseClient, input: { candidateKey: string; terms: readonly FixtureTermInput[]; idempotencyKey: string; catalogueVersion?: string }) {
  return command<{ roomId: string; ref: string; status: FixtureRoomStatus }>(supabase, "create_fixture_room_from_candidate", {
    p_candidate_key: input.candidateKey, p_terms: input.terms, p_idempotency_key: input.idempotencyKey,
    p_options: { catalogueVersion: input.catalogueVersion ?? FIXTURE_TERM_CATALOGUE_VERSION },
  });
}

/** C2O-013: a new room on a terminal room's pairing, taken from the room row. */
export function recreateFixtureRoom(supabase: SupabaseClient, input: { roomId: string; terms: readonly FixtureTermInput[]; idempotencyKey: string; catalogueVersion?: string }) {
  return command<{ roomId: string; ref: string; status: FixtureRoomStatus }>(supabase, "recreate_fixture_room", {
    p_room_id: input.roomId, p_terms: input.terms, p_idempotency_key: input.idempotencyKey,
    p_options: { catalogueVersion: input.catalogueVersion ?? FIXTURE_TERM_CATALOGUE_VERSION },
  });
}

export function inviteFixtureParty(supabase: SupabaseClient, input: CommandBase & { side: "cargo" | "vessel"; capacity: "principal" | "broker" | "viewer"; orgId?: string | null; userId?: string | null }) {
  return command<{ partyId: string; status: string }>(supabase, "invite_fixture_party", {
    ...base(input), p_side: input.side, p_capacity: input.capacity, p_org_id: input.orgId ?? null, p_user_id: input.userId ?? null,
  });
}

export function respondFixtureInvitation(supabase: SupabaseClient, input: { roomId: string; accept: boolean; expectedVersion: number; idempotencyKey: string; partyId?: string | null }) {
  return command<{ partyId: string; status: string }>(supabase, "respond_fixture_invitation", {
    p_room_id: input.roomId, p_accept: input.accept, p_expected_version: input.expectedVersion, p_idempotency_key: input.idempotencyKey,
    p_party_id: input.partyId ?? null,
  });
}

export function submitFixtureProposal(supabase: SupabaseClient, input: CommandBase & { termId: string; value: FixtureValue; comment?: string | null; isFinal?: boolean; expiresInMinutes?: number | null }) {
  return command<{ proposalId: string; termId: string; termStatus: string; roomStatus: FixtureRoomStatus; displayValue: string }>(supabase, "submit_fixture_proposal", {
    ...behalf(input), p_term_id: input.termId, p_value: input.value, p_comment: input.comment ?? null,
    p_is_final: input.isFinal ?? false, p_expires_in_minutes: input.expiresInMinutes ?? null,
  });
}

export function withdrawFixtureProposal(supabase: SupabaseClient, input: CommandBase & { proposalId: string }) {
  return command<{ proposalId: string; termId: string; termStatus: string }>(supabase, "withdraw_fixture_proposal", { ...behalf(input), p_proposal_id: input.proposalId });
}

export function acceptFixtureProposal(supabase: SupabaseClient, input: CommandBase & { proposalId: string }) {
  return command<{ termId: string; proposalId: string; termStatus: string; roomStatus: FixtureRoomStatus; displayValue: string }>(supabase, "accept_fixture_proposal", { ...behalf(input), p_proposal_id: input.proposalId });
}

export function reopenFixtureTerm(supabase: SupabaseClient, input: CommandBase & { termId: string; reason?: string | null }) {
  return command<{ termId: string; termStatus: string; roomStatus: FixtureRoomStatus }>(supabase, "reopen_fixture_term", { ...behalf(input), p_term_id: input.termId, p_reason: input.reason ?? null });
}

export function setFixtureTermFlag(supabase: SupabaseClient, input: CommandBase & { termId: string; flag: FixtureTermFlag; note?: string | null }) {
  return command<{ termId: string; flag: FixtureTermFlag }>(supabase, "set_fixture_term_flag", { ...behalf(input), p_term_id: input.termId, p_flag: input.flag, p_note: input.note ?? null });
}

export function addFixtureSubject(supabase: SupabaseClient, input: CommandBase & { title: string; description?: string | null; responsibleSide?: "cargo" | "vessel" | "mediator" | null; deadlineAt?: string | null }) {
  return command<{ subjectId: string; seq: number }>(supabase, "add_fixture_subject", {
    ...base(input), p_title: input.title, p_description: input.description ?? null, p_responsible_side: input.responsibleSide ?? null, p_deadline_at: input.deadlineAt ?? null,
  });
}

export function liftFixtureSubject(supabase: SupabaseClient, input: CommandBase & { subjectId: string }) {
  return command<{ subjectId: string; subjectStatus: string; roomStatus: FixtureRoomStatus; openSubjects: number }>(supabase, "lift_fixture_subject", { ...behalf(input), p_subject_id: input.subjectId });
}

/** Lifts every open subject the representing party may lift, in one governed command (C2O-012 item 5). */
export function liftAllFixtureSubjects(supabase: SupabaseClient, input: CommandBase) {
  return command<{ lifted: number; openSubjects: number; roomStatus: FixtureRoomStatus; subjectIds: string[] }>(supabase, "lift_all_fixture_subjects", behalf(input));
}

export function failFixtureSubject(supabase: SupabaseClient, input: CommandBase & { subjectId: string; reason?: string | null }) {
  return command<{ subjectId: string; subjectStatus: string; roomStatus: FixtureRoomStatus }>(supabase, "fail_fixture_subject", { ...behalf(input), p_subject_id: input.subjectId, p_reason: input.reason ?? null });
}

export function extendFixtureSubject(supabase: SupabaseClient, input: CommandBase & { subjectId: string; deadlineAt: string }) {
  return command<{ subjectId: string; deadlineAt: string }>(supabase, "extend_fixture_subject", { ...base(input), p_subject_id: input.subjectId, p_deadline_at: input.deadlineAt });
}

export function fixFixtureOnSubjects(supabase: SupabaseClient, input: CommandBase) {
  // PR-07: each principal side confirms; the mediator confirms for the relayed party it names
  return command<{ roomStatus: FixtureRoomStatus; openSubjects: number; confirmedSides: ("cargo" | "vessel")[]; awaitingSide: "cargo" | "vessel" | null }>(
    supabase, "fix_fixture_on_subjects", behalf(input));
}

/** PR-08: the mediator moves the negotiation window (one hour to 60 days from now). */
export function extendFixtureNegotiationWindow(supabase: SupabaseClient, input: CommandBase & { endsAt: string }) {
  return command<{ endsAt: string }>(supabase, "extend_fixture_negotiation_window", { ...base(input), p_ends_at: input.endsAt });
}

/** Applies only the caller-owned marketplace listing targets recorded by the room (decision D4). */
export function syncFixtureListingStatus(supabase: SupabaseClient, input: Pick<CommandBase, "roomId" | "expectedVersion" | "idempotencyKey">) {
  return command<{ cargoUpdated: boolean; vesselUpdated: boolean; outstanding: boolean }>(supabase, "sync_fixture_listing_status", {
    p_room_id: input.roomId, p_expected_version: input.expectedVersion, p_idempotency_key: input.idempotencyKey,
  });
}

/** Links a PDA through its permission-checked, vessel-safe header contract. */
export function linkFixturePdaEstimate(supabase: SupabaseClient, input: CommandBase & { pdaEstimateId: string; purpose: "load" | "discharge" | "other" }) {
  return command<{ pdaLink: FixturePdaLinkDisplay }>(supabase, "link_fixture_pda_estimate", {
    ...base(input), p_pda_estimate_id: input.pdaEstimateId, p_purpose: input.purpose,
  });
}

export function publishFixtureRecap(supabase: SupabaseClient, input: CommandBase) {
  return command<{ recapVersionId: string; versionNo: number }>(supabase, "publish_fixture_recap", base(input));
}

export function acknowledgeFixtureRecap(supabase: SupabaseClient, input: CommandBase & { recapVersionId: string }) {
  return command<{ recapVersionId: string; versionNo: number }>(supabase, "acknowledge_fixture_recap", { ...behalf(input), p_recap_version_id: input.recapVersionId });
}

export function postFixtureMessage(supabase: SupabaseClient, input: CommandBase & { body: string; kind?: "note" | "nudge" | "ack"; visibility?: "room" | "side" | "mediator"; termId?: string | null }) {
  return command<{ messageId: string }>(supabase, "post_fixture_message", {
    ...base(input), p_body: input.body, p_kind: input.kind ?? "note", p_visibility: input.visibility ?? "room", p_term_id: input.termId ?? null,
  });
}

export function agreeFixtureDisclosure(supabase: SupabaseClient, input: CommandBase) {
  return command<{ partyId: string; disclosed: boolean }>(supabase, "agree_fixture_disclosure", behalf(input));
}

export function closeFixtureRoom(supabase: SupabaseClient, input: CommandBase & { reason: FixtureCloseReason; note?: string | null }) {
  return command<{ roomStatus: FixtureRoomStatus }>(supabase, "close_fixture_room", { ...behalf(input), p_reason: input.reason, p_note: input.note ?? null });
}

export function redactFixtureMessage(supabase: SupabaseClient, input: { roomId: string; messageId: string; reason: string; expectedVersion: number; idempotencyKey: string }) {
  return command<{ messageId: string }>(supabase, "redact_fixture_message", {
    p_room_id: input.roomId, p_message_id: input.messageId, p_reason: input.reason, p_expected_version: input.expectedVersion, p_idempotency_key: input.idempotencyKey,
  });
}
