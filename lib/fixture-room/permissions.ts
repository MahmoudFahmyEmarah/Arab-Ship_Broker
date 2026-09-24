// Fixture Room · capability matrix (23 Sep 2026).
//
// A pure mirror of fn_fixture_capabilities in
// supabase/migrations/20260923201000_fixture_room_helpers.sql. The server
// computes `viewer.capabilities` on every read and every command re-checks;
// this module exists so the UI and scripts/fixture-room-check.ts can reason
// about the same table without a database.
import { FIXTURE_TERMINAL_STATUSES, type FixtureCapabilities, type FixtureCapacity, type FixturePartyStatus, type FixtureRoomStatus, type FixtureSide } from "./types";

export interface ViewerParty {
  id: string;
  side: FixtureSide;
  capacity: FixtureCapacity;
  status: FixturePartyStatus;
  disclosureAgreed: boolean;
}

export function computeCapabilities(
  status: FixtureRoomStatus,
  parties: readonly ViewerParty[],
  isAdmin: boolean,
  relayedPartyIds: readonly string[] = [],
): FixtureCapabilities {
  const terminal = FIXTURE_TERMINAL_STATUSES.includes(status);
  let side: FixtureSide | null = null;
  let mediator = false;
  let commercial = false;
  let any = false;
  let invited = false;
  let canDisclose = false;
  let sidePrincipalOrBroker = false;
  for (const p of parties) {
    if (p.status === "invited") invited = true;
    if (p.status !== "active") continue;
    any = true;
    if ((p.side === "cargo" || p.side === "vessel") && side === null) side = p.side;
    if (p.side === "mediator" && p.capacity === "broker") mediator = true;
    if ((p.side === "cargo" || p.side === "vessel") && (p.capacity === "principal" || p.capacity === "broker")) {
      commercial = true;
      sidePrincipalOrBroker = true;
    }
    if ((p.side === "cargo" || p.side === "vessel") && p.capacity === "principal" && !p.disclosureAgreed) canDisclose = true;
  }
  if (mediator && relayedPartyIds.length > 0) commercial = true;
  if (side === null && mediator) side = "mediator";
  const open = status === "invited" || status === "negotiating";
  const reviewing = status === "negotiating" || status === "on_subjects" || status === "fixed";
  return {
    viewerSide: side,
    isMediator: mediator,
    isAdmin,
    canPropose: open && commercial,
    canAccept: open && commercial,
    canWithdrawProposal: open && commercial,
    canReopen: (status === "negotiating" || status === "on_subjects") && commercial,
    canFlagTerm: open && (commercial || mediator),
    canAddSubject: (status === "negotiating" || status === "on_subjects") && (commercial || mediator),
    canLiftSubject: status === "on_subjects" && (commercial || mediator),
    canFailSubject: status === "on_subjects" && (commercial || mediator),
    canExtendSubject: status === "on_subjects" && (commercial || mediator),
    canFixOnSubjects: status === "negotiating" && (commercial || mediator),
    canPublishRecap: reviewing && (commercial || mediator),
    canAcknowledgeRecap: reviewing && commercial,
    canMessage: any && !terminal,
    canWithdraw: !terminal && status !== "fixed" && commercial && !(mediator && !sidePrincipalOrBroker),
    canFail: !terminal && status !== "fixed" && (mediator || isAdmin),
    canExpire: !terminal && status !== "fixed" && (mediator || isAdmin),
    canAgreeDisclosure: !terminal && (canDisclose || (mediator && relayedPartyIds.length > 0)),
    canInvite: !terminal && (commercial || mediator),
    canRespondInvitation: invited,
    canRedact: isAdmin,
    actForPartyIds: mediator ? [...relayedPartyIds] : [],
  };
}

/** The label a party's role gets in copy ("Charterer", "Owner", "Broker", "Viewer"). */
export function roleLabel(side: FixtureSide, capacity: FixtureCapacity, isPlatform = false): string {
  if (isPlatform) return "Arab ShipBroker";
  if (capacity === "viewer") return `${side === "cargo" ? "Cargo-side" : side === "vessel" ? "Vessel-side" : "Mediator"} viewer`;
  if (capacity === "broker") return side === "mediator" ? "Broker (mediator)" : `${side === "cargo" ? "Cargo-side" : "Vessel-side"} broker`;
  return side === "cargo" ? "Charterer" : side === "vessel" ? "Owner" : "Mediator";
}
