// Fixture Room · read-model and command types (architecture 1.0, 23 Sep 2026).
//
// These mirror what the governed RPCs return (get_fixture_room,
// list_fixture_rooms) and what the commands accept. The database is the
// authority; nothing here re-derives commercial state on the client.

export type FixtureRoomStatus =
  | "draft" | "invited" | "negotiating" | "on_subjects" | "fixed"
  | "withdrawn" | "failed" | "expired";
export const FIXTURE_TERMINAL_STATUSES: readonly FixtureRoomStatus[] = ["withdrawn", "failed", "expired"];

export type FixtureTermStatus = "open" | "countered" | "agreed" | "withdrawn";
export type FixtureSide = "cargo" | "vessel" | "mediator";
export type FixtureCapacity = "principal" | "broker" | "viewer";
export type FixtureParticipationMode = "direct" | "relayed";
export type FixturePartyStatus = "invited" | "active" | "declined" | "removed";
export type FixtureSubjectStatus = "open" | "lifted" | "failed" | "withdrawn";
export type FixtureMessageKind = "note" | "nudge" | "ack" | "system";
export type FixtureMessageVisibility = "room" | "side" | "mediator";
export type FixtureCloseReason = "withdrawn" | "failed" | "expired";
export type FixtureTermFlag = "hold" | "resume" | "refer" | "clear_referral";

export type FixtureValueKind = "text" | "number" | "money_per_mt" | "rate_pair" | "date_range" | "port_pair";

export type FixtureValue =
  | { text: string }
  | { num: number; currency?: string }
  | { load: number; disch: number }
  | { spot: true }
  | { from: string; to: string }
  | { load: string; disch: string; load_name?: string | null; disch_name?: string | null };

export type FixtureEventType =
  | "room.created" | "party.invited" | "party.accepted" | "party.declined" | "party.removed"
  | "party.disclosure_agreed" | "room.counterparty_disclosed"
  | "proposal.submitted" | "proposal.withdrawn" | "proposal.lapsed" | "proposal.accepted"
  | "term.agreed" | "term.reopened" | "term.held" | "term.resumed" | "term.referred" | "term.referral_cleared"
  | "subject.added" | "subject.lifted" | "subject.failed" | "subject.extended"
  | "room.fixed_on_subjects" | "room.fixed" | "room.returned_to_negotiation"
  | "recap.published" | "recap.acknowledged" | "recap.invalidated"
  | "message.posted" | "message.redacted"
  | "listing_sync.required" | "room.closed";

export interface FixturePartyView {
  id: string;
  side: FixtureSide;
  capacity: FixtureCapacity;
  participationMode: FixtureParticipationMode;
  status: FixturePartyStatus;
  isPlatform: boolean;
  label: string;
  isViewer: boolean;
  disclosureAgreed: boolean;
  invitedAt: string | null;
  acceptedAt: string | null;
  resolved: boolean;
  /** Organisation / desk name: own side always, counterparty only after disclosure. Never a person, email or phone. */
  name: string | null;
  deskLabel: string | null;
  // admin-only (unmasked reads)
  orgId?: string | null;
  userId?: string | null;
  contactId?: string | null;
  anchorListingType?: string | null;
  anchorListingId?: string | null;
}

export interface FixtureProposalView {
  id: string;
  termId: string;
  partyId: string;
  side: FixtureSide;
  label: string;
  kind: "bid" | "offer";
  valueKind: FixtureValueKind;
  value: FixtureValue;
  displayValue: string;
  comment: string | null;
  isFinal: boolean;
  expiresAt: string | null;
  lapsed: boolean;
  supersedesId: string | null;
  round: number;
  relayed: boolean;
  isMine: boolean;
  eventId: number | null;
  createdAt: string;
}

export interface FixtureTermView {
  id: string;
  code: string;
  label: string;
  category: string | null;
  sortOrder: number;
  valueKind: FixtureValueKind;
  unit: string | null;
  required: boolean;
  hint: string | null;
  status: FixtureTermStatus;
  cargoPosition: FixtureProposalView | null;
  vesselPosition: FixtureProposalView | null;
  agreed: FixtureProposalView | null;
  agreedAt: string | null;
  agreedByLabel: string | null;
  /** Whose move it is: the side that has not answered the latest proposal. */
  holder: "cargo" | "vessel" | null;
  lastProposalSide: FixtureSide | null;
  round: number;
  reopenCount: number;
  heldByLabel: string | null;
  heldAt: string | null;
  referredAt: string | null;
  referredByLabel: string | null;
}

export interface FixtureSubjectView {
  id: string;
  seq: number;
  title: string;
  description: string | null;
  responsibleSide: FixtureSide | null;
  deadlineAt: string | null;
  extendedCount: number;
  status: FixtureSubjectStatus;
  addedByLabel: string | null;
  resolvedAt: string | null;
  resolvedByLabel: string | null;
  createdAt: string;
}

export interface FixtureMessageView {
  id: string;
  partyId: string;
  label: string;
  side: FixtureSide;
  kind: FixtureMessageKind;
  visibility: FixtureMessageVisibility;
  termId: string | null;
  body: string | null;
  redacted: boolean;
  isMine: boolean;
  createdAt: string;
}

export interface FixtureRecapAck { partyId: string; label: string; at: string; relayed: boolean }

export interface FixtureRecapContent {
  ref: string;
  status: FixtureRoomStatus;
  roomVersion: number;
  generatedAt: string;
  cargo: { ref: string | null; commodity: string | null; qtyMin: number | null; qtyMax: number | null; loadPort: string | null; dischPort: string | null };
  vessel: { name: string | null; type: string | null; dwt: number | null };
  counterpartyDisclosed: boolean;
  parties: { side: FixtureSide; capacity: FixtureCapacity; label: string; name: string | null }[];
  terms: { code: string; label: string; sortOrder: number; status: FixtureTermStatus; required: boolean; agreedValue: string | null; agreedAt: string | null; cargoPosition: string | null; vesselPosition: string | null }[];
  subjects: { seq: number; title: string; status: FixtureSubjectStatus; responsibleSide: FixtureSide | null; deadlineAt: string | null }[];
  brokerageTerms: Record<string, unknown> | null;
  listingSyncTarget: { cargo_status?: string; vessel_status?: string } | null;
}

export interface FixtureRecapView {
  id: string;
  versionNo: number;
  roomVersion: number;
  publishedAt: string;
  publishedByLabel: string | null;
  invalidatedAt: string | null;
  contentHash: string;
  content: FixtureRecapContent;
  contentText: string;
  acknowledgements: FixtureRecapAck[];
  acknowledgedByAllPrincipals: boolean;
  viewerAcknowledged: boolean;
}

export interface FixtureEventView {
  id: number;
  seq: number;
  type: FixtureEventType;
  at: string;
  command: string | null;
  relayed: boolean;
  actorPartyId: string | null;
  onBehalfOfPartyId: string | null;
  actorLabel: string;
  onBehalfOfLabel: string | null;
  payload: Record<string, unknown>;
  actorUserId?: string | null;
  idempotencyKey?: string | null;
}

export interface FixtureCapabilities {
  viewerSide: FixtureSide | null;
  isMediator: boolean;
  isAdmin: boolean;
  canPropose: boolean;
  canAccept: boolean;
  canWithdrawProposal: boolean;
  canReopen: boolean;
  canFlagTerm: boolean;
  canAddSubject: boolean;
  canLiftSubject: boolean;
  canFailSubject: boolean;
  canExtendSubject: boolean;
  canFixOnSubjects: boolean;
  canPublishRecap: boolean;
  canAcknowledgeRecap: boolean;
  canMessage: boolean;
  canWithdraw: boolean;
  canFail: boolean;
  canExpire: boolean;
  canAgreeDisclosure: boolean;
  canInvite: boolean;
  canRespondInvitation: boolean;
  canRedact: boolean;
  actForPartyIds: string[];
}

export interface FixtureListingSyncSide {
  target: string | null;
  current: string | null;
  outstanding: boolean;
}
export interface FixtureListingSync {
  requiredAt: string | null;
  cargo: FixtureListingSyncSide & { listingId: string };
  /** vesselId is null for a viewer the vessel identity is masked from (a TBN vessel seen from the cargo side). */
  vessel: FixtureListingSyncSide & { availabilityId: string; vesselId: string | null };
  outstanding: boolean;
}

export interface FixtureRoomHeader {
  id: string;
  ref: string;
  status: FixtureRoomStatus;
  version: number;
  mediation: "platform" | "member";
  cargoListingId: string;
  vesselAvailabilityId: string;
  /** Null while the vessel identity is masked from this viewer (snapshot.vesselIdentityMasked). */
  vesselId: string | null;
  /** The versioned term sheet the room was opened on (fn_fixture_term_catalogue). */
  termCatalogueVersion: string;
  createdAt: string;
  updatedAt: string;
  fixedOnSubsAt: string | null;
  fixedAt: string | null;
  closedAt: string | null;
  closedReason: FixtureCloseReason | null;
  closedNote: string | null;
  counterpartyDisclosed: boolean;
  counterpartyDisclosedAt: string | null;
  negotiationWindowEndsAt: string | null;
  supersedesRoomId: string | null;
  snapshotAt: string;
  snapshotHash: string;
  brokerageTerms: Record<string, unknown> | null;
  listingSync: FixtureListingSync | null;
  serverNow: string;
  createdByUserId?: string;
}

/** The cargo snapshot is the allow-listed cargo_listings row; the vessel snapshot nests availability + vessel. */
export type FixtureCargoSnapshot = Record<string, unknown> & {
  ref?: string | null; commodity_name?: string | null; cargo_type?: string | null;
  qty_min_mt?: number | null; qty_max_mt?: number | null; stowage_factor?: number | null;
  load_port_locode?: string | null; load_port_name?: string | null; disch_port_locode?: string | null; disch_port_name?: string | null;
  laycan_from?: string | null; laycan_to?: string | null; is_spot?: boolean | null;
  load_rate?: number | string | null; disch_rate?: number | string | null; load_terms?: string | null;
  freight_idea_usd_mt?: number | null; commission_pct?: number | null; demurrage_rate?: number | null;
};
export interface FixtureVesselSnapshot {
  availability: Record<string, unknown> & { open_port_name?: string | null; open_date?: string | null; status?: string | null; freight_idea_usd_mt?: number | null };
  vessel: Record<string, unknown> & { vessel_name?: string | null; imo_number?: string | null; vessel_type?: string | null; dwt_grain?: number | null; build_year?: number | null; flag?: string | null; is_tbn?: boolean | null; is_geared?: boolean | null; grain_certified?: boolean | null };
}

export interface FixtureRoomView {
  room: FixtureRoomHeader;
  snapshot: { cargo: FixtureCargoSnapshot; vessel: FixtureVesselSnapshot; vesselIdentityMasked: boolean };
  viewer: { partyIds: string[]; side: FixtureSide | null; isAdmin: boolean; isMediator: boolean; capabilities: FixtureCapabilities };
  parties: FixturePartyView[];
  terms: FixtureTermView[];
  proposals: FixtureProposalView[];
  subjects: FixtureSubjectView[];
  messages: FixtureMessageView[];
  recaps: FixtureRecapView[];
  events: FixtureEventView[];
}

export interface FixtureRoomListItem {
  id: string;
  ref: string;
  status: FixtureRoomStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  fixedOnSubsAt: string | null;
  fixedAt: string | null;
  closedReason: FixtureCloseReason | null;
  counterpartyDisclosed: boolean;
  cargo: { ref: string | null; commodity: string | null; qtyMin: number | null; qtyMax: number | null; loadPort: string | null; dischPort: string | null; laycanFrom: string | null; laycanTo: string | null };
  vessel: { name: string | null; type: string | null; dwt: number | null; openPort: string | null; openDate: string | null };
  mySide: FixtureSide | null;
  myCapacity: FixtureCapacity | null;
  myStatus: FixturePartyStatus | null;
  counterpartyLabel: string | null;
  termCount: number;
  agreedTerms: number;
  openSubjects: number;
  listingSyncOutstanding: boolean;
}

/** A term definition as create_fixture_room accepts it (the catalogue shape; category unconstrained). */
export interface FixtureTermInput {
  code: string;
  label: string;
  sortOrder: number;
  valueKind: FixtureValueKind;
  required: boolean;
  category?: string;
  unit?: string;
  hint?: string;
}

/** Every command returns this envelope (or raises, see errors.ts). */
export interface FixtureCommandOk<T = Record<string, unknown>> {
  ok: true;
  version: number;
  eventId: number | null;
  replayed: boolean;
  data: T;
}

/**
 * Display shape for a future PDA link (integration migration 2026092330xxxx).
 * Nothing in the Fixture Room branch persists or returns this yet; it exists
 * so the room can render a link the moment the integration owner ships it.
 *
 * Aligned (26 Sep 2026, mailbox O2C-002) to the guarded
 * `fn_pda_estimate_header(uuid)` the PDA owner will provide: the safe display
 * header only. Deliberately absent: the estimate's `vessel_id` (validation-only
 * on the integration path; it would defeat TBN masking), the input snapshot,
 * line inputs and any `enteredBy` label (a person's name). The link event
 * snapshots exactly this header at link time.
 */
export interface FixturePdaLinkDisplay {
  id: string;
  purpose: "load" | "discharge" | "other";
  pdaEstimateId: string;
  portLocode: string | null;
  terminalId: string | null;
  terminalName: string | null;
  tariffVersionId: string | null;
  coverage: "published" | "partial" | "manual_required" | null;
  /** The port-call date the estimate was made for. */
  callDate: string | null;
  nativeCurrency: string | null;
  nativeTotal: number | null;
  convertedCurrency: string | null;
  convertedTotal: number | null;
  /** The rate behind convertedTotal and where it came from ("member" = typed by the estimate's owner). */
  fxRate: number | null;
  fxSource: "member" | null;
  generatedAt: string | null;
  /** True once the owner saved a newer estimate that supersedes this one. */
  isSuperseded: boolean | null;
  lineCount: number | null;
  manualLineCount: number | null;
  warningCount: number | null;
  linkedByLabel: string | null;
  supersededByLinkId: string | null;
}
