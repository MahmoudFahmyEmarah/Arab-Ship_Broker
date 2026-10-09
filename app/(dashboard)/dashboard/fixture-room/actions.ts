"use server";

// Fixture Room · server actions (architecture 1.0, 23 Sep 2026).
//
// Every action runs with the member's COOKIE session (never the service role)
// so auth.uid() inside the SECURITY DEFINER RPCs is the real person. One bounded exception (O2ALL-005): AFTER the
// member's own session has published a recap or proven room access, lib/fixture-room/recap-pdf-store.ts (never this
// file) uses the service role to store the recap PDF in the private bucket and to sign a 60-second download link. Inputs
// are validated with the Zod schemas first; the database validates again.
// Commands return the typed envelope or a typed FixtureError — never throw
// for a refusal, so the room can show the reason and refetch on a conflict.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { issueRecapPdfLink, storePublishedRecapPdf } from "@/lib/fixture-room/recap-pdf-store";
import * as sdk from "@/sdk/app/fixtures";
import { stripVesselNamePrefix } from "@/lib/schemas/vessel";
import { buildTermCatalogue, type ListingFigures } from "@/lib/fixture-room/terms";
import { findMaskingLeaks } from "@/lib/fixture-room/masking-view";
import type { FixtureError } from "@/lib/fixture-room/errors";
import {
  addSubjectSchema, closeRoomSchema, extendWindowSchema, createFromCandidateSchema, recreateRoomSchema, extendSubjectSchema, failSubjectSchema, invitePartySchema, postMessageSchema,
  proposalRefSchema, reopenTermSchema, recapRefSchema, redactMessageSchema, respondInvitationSchema, submitProposalSchema, subjectRefSchema,
  termFlagSchema, commandBaseSchema, listRoomsSchema, suggestBridgeSchema, recapPdfRefSchema, respondExtensionSchema,
} from "@/lib/fixture-room/schemas";
import type { FixtureRoomListItem, FixtureRoomStatus, FixtureRoomView } from "@/lib/fixture-room/types";
import type { ZodType } from "zod";

const invalid = (message: string): FixtureError => ({ ok: false, code: "VALIDATION", message });

function parse<T>(schema: ZodType<T>, input: unknown): { ok: true; value: T } | { ok: false; error: FixtureError } {
  const r = schema.safeParse(input);
  if (!r.success) return { ok: false, error: invalid(r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")) };
  return { ok: true, value: r.data };
}

// ── reads ───────────────────────────────────────────────────────────────────
export async function loadFixtureRoom(roomId: string): Promise<FixtureRoomView | FixtureError> {
  const p = parse(commandBaseSchema.pick({ roomId: true }), { roomId });
  if (!p.ok) return p.error;
  try {
    const supabase = await getSupabaseServerClient();
    const view = await sdk.getFixtureRoom(supabase, roomId);
    if (process.env.NODE_ENV !== "production") {
      const leaks = findMaskingLeaks(view);
      if (leaks.length) console.error("[fixture-room] masking guard flagged a member payload:", leaks.slice(0, 10));
    }
    return view;
  } catch (e) {
    if (e instanceof sdk.FixtureRequestError) return e.fx;
    return { ok: false, code: "UNKNOWN", message: e instanceof Error ? e.message : "Could not load the room." };
  }
}

export async function pollFixtureRoomVersion(roomId: string): Promise<number | null> {
  try {
    const supabase = await getSupabaseServerClient();
    return await sdk.getFixtureRoomVersion(supabase, roomId);
  } catch {
    return null;
  }
}

export async function loadFixtureRooms(input?: { statuses?: FixtureRoomStatus[] | null; limit?: number }): Promise<FixtureRoomListItem[] | FixtureError> {
  const p = parse(listRoomsSchema, input ?? {});
  if (!p.ok) return p.error;
  try {
    const supabase = await getSupabaseServerClient();
    return await sdk.listFixtureRooms(supabase, p.value.statuses ?? null, p.value.limit ?? 50);
  } catch (e) {
    if (e instanceof sdk.FixtureRequestError) return e.fx;
    return { ok: false, code: "UNKNOWN", message: e instanceof Error ? e.message : "Could not load your fixtures." };
  }
}

// ── match builder data ──────────────────────────────────────────────────────
/**
 * Why the governed matcher paired the two listings, as list_fixture_match_candidates
 * reports it (C2O-012 item 4): the card explains these facts and nothing else, so an
 * explanation can never contradict a valid match.
 */
export interface MatchFacts {
  zone: "load" | "discharge" | "other"; openZone: string | null; laycan: "spot" | "window"; grain: boolean; dg: boolean;
  gearRequired: boolean; partCargo: boolean; dwtDelta: number;
}
/** the governed Rules label of a candidate pair (active rule version); members see the word only, never a score */
export type MatchLabel = "Strong" | "Good" | "Possible" | "Weak";
const MATCH_LABELS: readonly string[] = ["Strong", "Good", "Possible", "Weak"];
const labelOf = (v: unknown): MatchLabel | null => (typeof v === "string" && MATCH_LABELS.includes(v) ? (v as MatchLabel) : null);
export interface MatchCargoOption {
  /** the member's own listing id (step 1); absent on a counterparty candidate */
  id?: string;
  /** the opaque handle of a counterparty candidate (C2O-013); never a raw id */
  candidateKey?: string;
  /** the listing figures for the term hints (no identifier) */
  hints?: Record<string, unknown> | null;
  ref: string | null; commodity: string; type: string; qtyMin: number; qtyMax: number;
  loadPort: string | null; dischPort: string | null; laycanFrom: string | null; laycanTo: string | null; isSpot: boolean;
  freightIdea: number | null; rateAligned: boolean | null; mine: boolean; fit?: MatchFacts; matchLabel?: MatchLabel | null;
}
/** No vessel id, IMO or (for a counterparty) availability id, ever (C2O-011, C2O-013). A TBN hull a member does not own is named "TBN". */
export interface MatchVesselOption {
  /** the member's own position id (step 1); absent on a counterparty candidate */
  availabilityId?: string;
  /** the opaque handle of a counterparty candidate (C2O-013) */
  candidateKey?: string;
  /** the listing figures for the term hints (no identifier) */
  hints?: Record<string, unknown> | null;
  name: string; isTbn?: boolean; type: string; dwt: number | null; openPort: string | null;
  openZone: string | null; openDate: string | null; freightIdea: number | null; rateAligned: boolean | null; geared: boolean | null; mine: boolean; fit?: MatchFacts;
  matchLabel?: MatchLabel | null;
}
export interface MatchBuilderData {
  myCargo: MatchCargoOption[];
  myVessels: MatchVesselOption[];
  candidates: { cargo: MatchCargoOption[]; vessels: MatchVesselOption[] };
  existingPairs: { cargoListingId: string; vesselAvailabilityId: string; roomId: string; ref: string; status: FixtureRoomStatus }[];
  preselected: { kind: "cargo"; id: string } | { kind: "vessel"; id: string } | null;
  error: string | null;
}

// rows of list_fixture_match_candidates, already masked by the database; mapped field by
// field so nothing the RPC might add later reaches the browser unreviewed
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const facts = (f: unknown): MatchFacts | undefined => {
  if (!f || typeof f !== "object") return undefined;
  const r = f as Row;
  return { zone: r.zone === "discharge" ? "discharge" : r.zone === "other" ? "other" : "load", openZone: r.openZone == null ? null : String(r.openZone), laycan: r.laycan === "spot" ? "spot" : "window", grain: r.grain === true, dg: r.dg === true,
    gearRequired: r.gearRequired === true, partCargo: r.partCargo === true, dwtDelta: Number(r.dwtDelta ?? 0) };
};
const hintsOf = (r: Row) => (r.hints && typeof r.hints === "object" ? (r.hints as Record<string, unknown>) : null);
const vesselCandidate = (r: Row): MatchVesselOption => ({
  candidateKey: String(r.candidateKey), hints: hintsOf(r), name: r.isTbn === true && r.name === "TBN" ? "TBN" : stripVesselNamePrefix(String(r.name ?? "Vessel")), isTbn: r.isTbn === true,
  type: String(r.type ?? "—"), dwt: num(r.dwt), openPort: str(r.openPort), openZone: str(r.openZone), openDate: str(r.openDate),
  freightIdea: num(r.freightIdea), rateAligned: r.rateAligned === true, geared: r.geared == null ? null : r.geared === true, mine: r.mine === true, fit: facts(r.fit),
  matchLabel: labelOf(r.matchLabel),
});
// the member's own live listings (list_fixture_my_listings: the create rule, organisation seats included)
const ownCargo = (r: Row): MatchCargoOption => ({ ...cargoCandidate(r), id: String(r.id), candidateKey: undefined, hints: null, rateAligned: null, mine: true, fit: undefined });
const ownVessel = (r: Row): MatchVesselOption => ({
  availabilityId: String(r.availabilityId), name: stripVesselNamePrefix(String(r.name ?? "Vessel")), type: String(r.type ?? "—"), dwt: num(r.dwt),
  openPort: str(r.openPort), openZone: str(r.openZone), openDate: str(r.openDate), freightIdea: num(r.freightIdea), rateAligned: null,
  geared: r.geared == null ? null : r.geared === true, mine: true,
});
const cargoCandidate = (r: Row): MatchCargoOption => ({
  candidateKey: r.candidateKey == null ? undefined : String(r.candidateKey), hints: hintsOf(r), ref: str(r.ref), commodity: String(r.commodity ?? "Cargo"), type: String(r.type ?? "—"), qtyMin: Number(r.qtyMin ?? 0), qtyMax: Number(r.qtyMax ?? 0),
  loadPort: str(r.loadPort), dischPort: str(r.dischPort), laycanFrom: str(r.laycanFrom), laycanTo: str(r.laycanTo), isSpot: r.isSpot === true,
  freightIdea: num(r.freightIdea), rateAligned: r.rateAligned === true, mine: r.mine === true, fit: facts(r.fit),
  matchLabel: labelOf(r.matchLabel),
});
async function candidatesFor(supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>, kind: "cargo" | "vessel", id: string) {
  const rows = await sdk.listFixtureMatchCandidates(supabase, kind, id);
  return kind === "cargo" ? { cargo: [], vessels: rows.map(vesselCandidate) } : { cargo: rows.map(cargoCandidate), vessels: [] };
}

/** Own listings, ranked counterparts from the existing match RPCs, and the pairs that already have a room. */
export async function loadMatchBuilder(params: { cargo?: string | null; vessel?: string | null }): Promise<MatchBuilderData> {
  const out: MatchBuilderData = { myCargo: [], myVessels: [], candidates: { cargo: [], vessels: [] }, existingPairs: [], preselected: null, error: null };
  const isUuid = (s: string | null | undefined) => !!s && /^[0-9a-f-]{36}$/i.test(s);
  try {
    const supabase = await getSupabaseServerClient();
    const [mine, rooms] = await Promise.all([
      sdk.listFixtureMyListings(supabase).catch(() => ({ cargo: [], vessels: [] })),
      sdk.listFixtureRooms(supabase, ["draft", "invited", "negotiating", "on_subjects", "fixed"], 200).catch(() => [] as FixtureRoomListItem[]),
    ]);
    out.myCargo = mine.cargo.map(ownCargo);
    out.myVessels = mine.vessels.map(ownVessel);
    out.existingPairs = rooms.map((r) => ({ cargoListingId: "", vesselAvailabilityId: "", roomId: r.id, ref: r.ref, status: r.status }));
    // list_fixture_rooms does not carry listing ids for members; resolve pairs through the room reads the viewer may open
    out.existingPairs = [];
    // a preselection is honoured only for the member's own listing; the RPC checks ownership again (C2O-011)
    if (isUuid(params.cargo) && out.myCargo.some((c) => c.id === params.cargo)) {
      out.preselected = { kind: "cargo", id: params.cargo! };
      out.candidates = await candidatesFor(supabase, "cargo", params.cargo!).catch(() => ({ cargo: [], vessels: [] }));
    } else if (isUuid(params.vessel) && out.myVessels.some((v) => v.availabilityId === params.vessel)) {
      out.preselected = { kind: "vessel", id: params.vessel! };
      out.candidates = await candidatesFor(supabase, "vessel", params.vessel!).catch(() => ({ cargo: [], vessels: [] }));
    } else if (isUuid(params.cargo) || isUuid(params.vessel)) {
      out.error = "That listing is not one of yours. Pick one of your own listings to start a fixture.";
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : "Could not load the match builder.";
  }
  return out;
}

/**
 * Ranked counterparts for a chosen side (called when the user changes the first pick).
 * Governed by list_fixture_match_candidates: a listing the member does not own is refused.
 */
export async function loadMatchCandidates(kind: "cargo" | "vessel", id: string): Promise<{ cargo: MatchCargoOption[]; vessels: MatchVesselOption[]; error?: string }> {
  if ((kind !== "cargo" && kind !== "vessel") || !/^[0-9a-f-]{36}$/i.test(id)) return { cargo: [], vessels: [], error: "Pick one of your own listings." };
  try {
    return await candidatesFor(await getSupabaseServerClient(), kind, id);
  } catch (e) {
    const message = e instanceof sdk.FixtureRequestError ? e.fx.message : "Could not load the ranked counterparts.";
    return { cargo: [], vessels: [], error: message };
  }
}

// ── commands ────────────────────────────────────────────────────────────────
// C2O-013: the browser never holds a raw listing, availability or vessel id for
// a counterparty. A room opens from the opaque candidate key; a terminal room is
// restarted by its room id. The term hints come from governed reads that return
// listing figures only.
const figuresFromHints = (h: Record<string, unknown>): ListingFigures => {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const t = (v: unknown) => (v == null ? null : String(v));
  return {
    commodity: t(h.commodity), cargoType: t(h.cargoType), qtyMin: n(h.qtyMin), qtyMax: n(h.qtyMax), stowageFactor: n(h.stowageFactor),
    loadPortCode: t(h.loadPortCode), loadPortName: t(h.loadPortName), dischPortCode: t(h.dischPortCode), dischPortName: t(h.dischPortName),
    laycanFrom: t(h.laycanFrom), laycanTo: t(h.laycanTo), isSpot: h.isSpot === true, loadRate: n(h.loadRate), dischRate: n(h.dischRate),
    loadTerms: t(h.loadTerms), freightIdea: n(h.freightIdea), commission: n(h.commission), demurrage: n(h.demurrage), vesselFreightIdea: n(h.vesselFreightIdea),
  } as ListingFigures;
};

/**
 * Open a room from a candidate key. The term hints are the listing figures that
 * came with the candidate; the browser holds them for the gesture, so every retry
 * builds the identical request and the server's idempotency hash replays it, even
 * after the key has expired (C2O-014 item 2). A changed hint is a mismatch.
 */
export async function createFixtureRoomFromCandidateAction(input: { candidateKey: string; hints?: Record<string, unknown> | null; idempotencyKey: string }) {
  const supabase = await getSupabaseServerClient();
  const figures = input.hints && typeof input.hints === "object" ? figuresFromHints(input.hints) : null;
  const p = parse(createFromCandidateSchema, { candidateKey: input.candidateKey, idempotencyKey: input.idempotencyKey, terms: buildTermCatalogue(figures) });
  if (!p.ok) return p.error;
  return sdk.createFixtureRoomFromCandidate(supabase, p.value);
}

/** Figures for a restart, from the old room's own snapshot (the member's masked read). */
const figuresFromRoom = (view: FixtureRoomView): ListingFigures => {
  const c = view.snapshot.cargo as Record<string, unknown>;
  const a = (view.snapshot.vessel.availability ?? {}) as Record<string, unknown>;
  return figuresFromHints({
    commodity: c.commodity_name, cargoType: c.cargo_type, qtyMin: c.qty_min_mt, qtyMax: c.qty_max_mt, stowageFactor: c.stowage_factor,
    loadPortCode: c.load_port_locode, loadPortName: c.load_port_name, dischPortCode: c.disch_port_locode, dischPortName: c.disch_port_name,
    laycanFrom: c.laycan_from, laycanTo: c.laycan_to, isSpot: c.is_spot, loadRate: c.load_rate, dischRate: c.disch_rate,
    loadTerms: c.load_terms, freightIdea: c.freight_idea_usd_mt, commission: c.commission_pct, demurrage: c.demurrage_rate,
    vesselFreightIdea: a.freight_idea_usd_mt,
  });
};

export async function recreateFixtureRoomAction(input: { roomId: string; idempotencyKey: string }) {
  const supabase = await getSupabaseServerClient();
  const view = await sdk.getFixtureRoom(supabase, input.roomId).catch(() => null);
  const p = parse(recreateRoomSchema, { ...input, terms: buildTermCatalogue(view ? figuresFromRoom(view) : null) });
  if (!p.ok) return p.error;
  return sdk.recreateFixtureRoom(supabase, p.value);
}

export async function inviteFixturePartyAction(input: unknown) {
  const p = parse(invitePartySchema, input);
  if (!p.ok) return p.error;
  return sdk.inviteFixtureParty(await getSupabaseServerClient(), p.value);
}

export async function respondFixtureInvitationAction(input: unknown) {
  const p = parse(respondInvitationSchema, input);
  if (!p.ok) return p.error;
  return sdk.respondFixtureInvitation(await getSupabaseServerClient(), p.value);
}

export async function submitFixtureProposalAction(input: unknown) {
  const p = parse(submitProposalSchema, input);
  if (!p.ok) return p.error;
  return sdk.submitFixtureProposal(await getSupabaseServerClient(), p.value);
}

export async function withdrawFixtureProposalAction(input: unknown) {
  const p = parse(proposalRefSchema, input);
  if (!p.ok) return p.error;
  return sdk.withdrawFixtureProposal(await getSupabaseServerClient(), p.value);
}

export async function acceptFixtureProposalAction(input: unknown) {
  const p = parse(proposalRefSchema, input);
  if (!p.ok) return p.error;
  return sdk.acceptFixtureProposal(await getSupabaseServerClient(), p.value);
}

export async function reopenFixtureTermAction(input: unknown) {
  const p = parse(reopenTermSchema, input);
  if (!p.ok) return p.error;
  return sdk.reopenFixtureTerm(await getSupabaseServerClient(), p.value);
}

export async function setFixtureTermFlagAction(input: unknown) {
  const p = parse(termFlagSchema, input);
  if (!p.ok) return p.error;
  return sdk.setFixtureTermFlag(await getSupabaseServerClient(), p.value);
}

export async function suggestFixtureBridgeAction(input: unknown) {
  const p = parse(suggestBridgeSchema, input);
  if (!p.ok) return p.error;
  return sdk.suggestFixtureBridge(await getSupabaseServerClient(), p.value);
}

export async function addFixtureSubjectAction(input: unknown) {
  const p = parse(addSubjectSchema, input);
  if (!p.ok) return p.error;
  return sdk.addFixtureSubject(await getSupabaseServerClient(), p.value);
}

export async function liftFixtureSubjectAction(input: unknown) {
  const p = parse(subjectRefSchema, input);
  if (!p.ok) return p.error;
  return sdk.liftFixtureSubject(await getSupabaseServerClient(), p.value);
}

export async function liftAllFixtureSubjectsAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  return sdk.liftAllFixtureSubjects(await getSupabaseServerClient(), p.value);
}

export async function failFixtureSubjectAction(input: unknown) {
  const p = parse(failSubjectSchema, input);
  if (!p.ok) return p.error;
  return sdk.failFixtureSubject(await getSupabaseServerClient(), p.value);
}

export async function extendFixtureSubjectAction(input: unknown) {
  // O2ALL-006: "extend" now PROPOSES the new deadline; the other side accepts it (respondFixtureSubjectExtensionAction)
  const p = parse(extendSubjectSchema, input);
  if (!p.ok) return p.error;
  return sdk.proposeFixtureSubjectExtension(await getSupabaseServerClient(), p.value);
}

export async function respondFixtureSubjectExtensionAction(input: unknown) {
  const p = parse(respondExtensionSchema, input);
  if (!p.ok) return p.error;
  return sdk.respondFixtureSubjectExtension(await getSupabaseServerClient(), p.value);
}

export async function fixFixtureOnSubjectsAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  return sdk.fixFixtureOnSubjects(await getSupabaseServerClient(), p.value);
}

export async function extendFixtureWindowAction(input: unknown) {
  const p = parse(extendWindowSchema, input);
  if (!p.ok) return p.error;
  return sdk.extendFixtureNegotiationWindow(await getSupabaseServerClient(), p.value);
}

/** D4: one server-authoritative action, scoped by the listing ownership row. */
export async function syncFixtureListingStatusAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  return sdk.syncFixtureListingStatus(await getSupabaseServerClient(), p.value);
}

export async function publishFixtureRecapAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  const result = await sdk.publishFixtureRecap(await getSupabaseServerClient(), p.value);
  // O2ALL-005: the member's own publish succeeded, so store that version's PDF now. A failure here never undoes the
  // publish: the download path renders the same bytes later (deterministic) if the file is missing.
  const versionId = (result as { ok?: boolean; data?: { recapVersionId?: string } }).ok ? (result as { data?: { recapVersionId?: string } }).data?.recapVersionId : undefined;
  if (versionId) await storePublishedRecapPdf(versionId);
  return result;
}

/** O2ALL-005: a 60-second link to the stored PDF of a recap version, after the member's session proves room access. */
export async function getFixtureRecapPdfAction(input: unknown): Promise<{ ok: true; url: string; sha256: string; fileName: string } | FixtureError> {
  const p = parse(recapPdfRefSchema, input);
  if (!p.ok) return p.error;
  const supabase = await getSupabaseServerClient();
  const ref = await supabase.rpc("get_fixture_recap_pdf", { p_room_id: p.value.roomId, p_version_no: p.value.versionNo });
  if (ref.error || !ref.data) return { ok: false, code: "NOT_FOUND", message: "That recap is not available to you." };
  const rec = ref.data as { recapVersionId: string; versionNo: number; ref: string; status: string; path: string | null; sha256: string | null };
  try {
    const fileName = `Fixture-${rec.ref}-recap-v${rec.versionNo}.pdf`;
    const link = await issueRecapPdfLink(rec, fileName);
    return { ok: true, url: link.url, sha256: link.sha256, fileName };
  } catch (e) {
    console.error("fixture recap PDF unavailable", { recapVersionId: rec.recapVersionId, reason: (e as Error).message });
    // truthful state (C2O-101 P1-1): the record says pending or failed; the stored file is never replaced by another
    return { ok: false, code: "UNKNOWN", message: `The stored recap PDF is not available (${rec.status === "failed" ? "its last store failed" : "it is still being stored"}): ${(e as Error).message}. Please try again, or ask the Arab ShipBroker desk.` };
  }
}

export async function acknowledgeFixtureRecapAction(input: unknown) {
  const p = parse(recapRefSchema, input);
  if (!p.ok) return p.error;
  return sdk.acknowledgeFixtureRecap(await getSupabaseServerClient(), p.value);
}

export async function postFixtureMessageAction(input: unknown) {
  const p = parse(postMessageSchema, input);
  if (!p.ok) return p.error;
  return sdk.postFixtureMessage(await getSupabaseServerClient(), p.value);
}

export async function agreeFixtureDisclosureAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  return sdk.agreeFixtureDisclosure(await getSupabaseServerClient(), p.value);
}

export async function closeFixtureRoomAction(input: unknown) {
  const p = parse(closeRoomSchema, input);
  if (!p.ok) return p.error;
  return sdk.closeFixtureRoom(await getSupabaseServerClient(), p.value);
}

export async function redactFixtureMessageAction(input: unknown) {
  const p = parse(redactMessageSchema, input);
  if (!p.ok) return p.error;
  return sdk.redactFixtureMessage(await getSupabaseServerClient(), p.value);
}
