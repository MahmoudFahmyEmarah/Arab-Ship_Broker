"use server";

// Fixture Room · server actions (architecture 1.0, 23 Sep 2026).
//
// Every action runs with the member's COOKIE session (never the service role)
// so auth.uid() inside the SECURITY DEFINER RPCs is the real person. Inputs
// are validated with the Zod schemas first; the database validates again.
// Commands return the typed envelope or a typed FixtureError — never throw
// for a refusal, so the room can show the reason and refetch on a conflict.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import * as sdk from "@/sdk/app/fixtures";
import { getMyCargoListings, getMatchesForCargo, type CargoMatchResult } from "@/sdk/app/cargos";
import { getMyVesselAvailability, getMatchesForAvailability } from "@/sdk/app/vessels";
import { stripVesselNamePrefix, type VesselMatchResult, type VesselAvailabilityWithVessel } from "@/lib/schemas/vessel";
import type { CargoListingRow } from "@/lib/schemas/cargo";
import { buildTermCatalogue, type ListingFigures } from "@/lib/fixture-room/terms";
import { findMaskingLeaks } from "@/lib/fixture-room/masking-view";
import type { FixtureError } from "@/lib/fixture-room/errors";
import {
  addSubjectSchema, closeRoomSchema, createRoomSchema, extendSubjectSchema, failSubjectSchema, invitePartySchema, postMessageSchema,
  proposalRefSchema, reopenTermSchema, recapRefSchema, redactMessageSchema, respondInvitationSchema, submitProposalSchema, subjectRefSchema,
  termFlagSchema, commandBaseSchema, listRoomsSchema,
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
export interface MatchCargoOption {
  id: string; ref: string | null; commodity: string; type: string; qtyMin: number; qtyMax: number;
  loadPort: string | null; dischPort: string | null; laycanFrom: string | null; laycanTo: string | null; isSpot: boolean;
  freightIdea: number | null; rateAligned: boolean | null; mine: boolean;
}
export interface MatchVesselOption {
  availabilityId: string; vesselId: string | null; name: string; type: string; dwt: number | null; openPort: string | null;
  openZone: string | null; openDate: string | null; freightIdea: number | null; rateAligned: boolean | null; geared: boolean | null; mine: boolean;
}
export interface MatchBuilderData {
  myCargo: MatchCargoOption[];
  myVessels: MatchVesselOption[];
  candidates: { cargo: MatchCargoOption[]; vessels: MatchVesselOption[] };
  existingPairs: { cargoListingId: string; vesselAvailabilityId: string; roomId: string; ref: string; status: FixtureRoomStatus }[];
  preselected: { kind: "cargo"; id: string } | { kind: "vessel"; id: string } | null;
  error: string | null;
}

const cargoOpt = (r: CargoListingRow, mine: boolean): MatchCargoOption => ({
  id: r.id, ref: r.ref ?? null, commodity: r.commodity_name, type: r.cargo_type, qtyMin: r.qty_min_mt, qtyMax: r.qty_max_mt,
  loadPort: r.load_port_name ?? r.load_port_locode ?? null, dischPort: r.disch_port_name ?? r.disch_port_locode ?? null,
  laycanFrom: r.laycan_from ?? null, laycanTo: r.laycan_to ?? null, isSpot: !!r.is_spot, freightIdea: r.freight_idea_usd_mt ?? null, rateAligned: null, mine,
});
const cargoFromMatch = (m: VesselMatchResult): MatchCargoOption => ({
  id: m.cargo_id, ref: m.ref ?? null, commodity: m.commodity_name, type: m.cargo_type, qtyMin: m.qty_min_mt, qtyMax: m.qty_max_mt,
  loadPort: m.load_port_name, dischPort: m.disch_port_name, laycanFrom: m.laycan_from, laycanTo: m.laycan_to, isSpot: m.is_spot,
  freightIdea: m.freight_idea_usd_mt, rateAligned: m.is_rate_aligned, mine: false,
});
const vesselOpt = (r: VesselAvailabilityWithVessel, mine: boolean): MatchVesselOption => ({
  availabilityId: r.id, vesselId: r.vessel_id, name: stripVesselNamePrefix(r.vessel?.vessel_name ?? "Vessel"), type: r.vessel?.vessel_type ?? "—",
  dwt: r.vessel?.dwt_grain ?? null, openPort: r.open_port_name ?? r.open_port_locode ?? null, openZone: r.open_zone ?? null, openDate: r.open_date ?? null,
  freightIdea: r.freight_idea_usd_mt ?? null, rateAligned: null, geared: r.vessel?.is_geared ?? null, mine,
});
const vesselFromMatch = (m: CargoMatchResult): MatchVesselOption => ({
  availabilityId: m.availability_id, vesselId: m.vessel_id, name: stripVesselNamePrefix(m.vessel_name), type: m.vessel_type, dwt: m.dwt_grain,
  openPort: m.open_port_name, openZone: m.open_zone, openDate: m.open_date, freightIdea: m.freight_idea_usd_mt, rateAligned: m.is_rate_aligned, geared: m.is_geared, mine: false,
});

/** Own listings, ranked counterparts from the existing match RPCs, and the pairs that already have a room. */
export async function loadMatchBuilder(params: { cargo?: string | null; vessel?: string | null }): Promise<MatchBuilderData> {
  const out: MatchBuilderData = { myCargo: [], myVessels: [], candidates: { cargo: [], vessels: [] }, existingPairs: [], preselected: null, error: null };
  const isUuid = (s: string | null | undefined) => !!s && /^[0-9a-f-]{36}$/i.test(s);
  try {
    const supabase = await getSupabaseServerClient();
    const [mine, myAvail, rooms] = await Promise.all([
      getMyCargoListings(supabase).catch(() => [] as CargoListingRow[]),
      getMyVesselAvailability(supabase).catch(() => [] as VesselAvailabilityWithVessel[]),
      sdk.listFixtureRooms(supabase, ["draft", "invited", "negotiating", "on_subjects", "fixed"], 200).catch(() => [] as FixtureRoomListItem[]),
    ]);
    out.myCargo = mine.map((r) => cargoOpt(r, true));
    out.myVessels = myAvail.map((r) => vesselOpt(r, true));
    out.existingPairs = rooms.map((r) => ({ cargoListingId: "", vesselAvailabilityId: "", roomId: r.id, ref: r.ref, status: r.status }));
    // list_fixture_rooms does not carry listing ids for members; resolve pairs through the room reads the viewer may open
    out.existingPairs = [];
    if (isUuid(params.cargo)) {
      out.preselected = { kind: "cargo", id: params.cargo! };
      const rows = await getMatchesForCargo(supabase, params.cargo!).catch(() => [] as CargoMatchResult[]);
      out.candidates.vessels = rows.map(vesselFromMatch);
    } else if (isUuid(params.vessel)) {
      out.preselected = { kind: "vessel", id: params.vessel! };
      const rows = await getMatchesForAvailability(supabase, params.vessel!).catch(() => [] as VesselMatchResult[]);
      out.candidates.cargo = rows.map(cargoFromMatch);
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : "Could not load the match builder.";
  }
  return out;
}

/** Ranked counterparts for a chosen side (called when the user changes the first pick). */
export async function loadMatchCandidates(kind: "cargo" | "vessel", id: string): Promise<{ cargo: MatchCargoOption[]; vessels: MatchVesselOption[] }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { cargo: [], vessels: [] };
  try {
    const supabase = await getSupabaseServerClient();
    if (kind === "cargo") return { cargo: [], vessels: (await getMatchesForCargo(supabase, id)).map(vesselFromMatch) };
    return { cargo: (await getMatchesForAvailability(supabase, id)).map(cargoFromMatch), vessels: [] };
  } catch {
    return { cargo: [], vessels: [] };
  }
}

// ── commands ────────────────────────────────────────────────────────────────
async function listingFigures(cargoListingId: string, vesselAvailabilityId: string): Promise<ListingFigures> {
  const supabase = await getSupabaseServerClient();
  const f: ListingFigures = {};
  try {
    const { data: c } = await supabase.from("cargo_listings").select("*").eq("id", cargoListingId).maybeSingle();
    const row = c as CargoListingRow | null;
    if (row) {
      Object.assign(f, {
        commodity: row.commodity_name, cargoType: row.cargo_type, qtyMin: row.qty_min_mt, qtyMax: row.qty_max_mt, stowageFactor: row.stowage_factor,
        loadPortCode: row.load_port_locode, loadPortName: row.load_port_name, dischPortCode: row.disch_port_locode, dischPortName: row.disch_port_name,
        laycanFrom: row.laycan_from, laycanTo: row.laycan_to, isSpot: row.is_spot, loadRate: row.load_rate == null ? null : Number(row.load_rate),
        dischRate: row.disch_rate == null ? null : Number(row.disch_rate), loadTerms: row.load_terms, freightIdea: row.freight_idea_usd_mt,
        commission: row.commission_pct, demurrage: row.demurrage_rate,
      } satisfies ListingFigures);
    }
    const { data: a } = await supabase.from("vessel_availability").select("freight_idea_usd_mt").eq("id", vesselAvailabilityId).maybeSingle();
    if (a && (a as { freight_idea_usd_mt?: number | null }).freight_idea_usd_mt != null) f.vesselFreightIdea = Number((a as { freight_idea_usd_mt: number }).freight_idea_usd_mt);
  } catch {
    // hints are optional; the room is created without them
  }
  return f;
}

export async function createFixtureRoomAction(input: { cargoListingId: string; vesselAvailabilityId: string; idempotencyKey: string }) {
  const figures = await listingFigures(input.cargoListingId, input.vesselAvailabilityId).catch(() => ({} as ListingFigures));
  const p = parse(createRoomSchema, { ...input, terms: buildTermCatalogue(figures) });
  if (!p.ok) return p.error;
  const supabase = await getSupabaseServerClient();
  return sdk.createFixtureRoom(supabase, p.value);
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

export async function failFixtureSubjectAction(input: unknown) {
  const p = parse(failSubjectSchema, input);
  if (!p.ok) return p.error;
  return sdk.failFixtureSubject(await getSupabaseServerClient(), p.value);
}

export async function extendFixtureSubjectAction(input: unknown) {
  const p = parse(extendSubjectSchema, input);
  if (!p.ok) return p.error;
  return sdk.extendFixtureSubject(await getSupabaseServerClient(), p.value);
}

export async function fixFixtureOnSubjectsAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  return sdk.fixFixtureOnSubjects(await getSupabaseServerClient(), p.value);
}

export async function publishFixtureRecapAction(input: unknown) {
  const p = parse(commandBaseSchema, input);
  if (!p.ok) return p.error;
  return sdk.publishFixtureRecap(await getSupabaseServerClient(), p.value);
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
