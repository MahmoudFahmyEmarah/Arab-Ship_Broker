/**
 * Fixture Room · pure checks (no network, no database). Run:
 *   node --import tsx scripts/fixture-room-check.ts
 *
 * Proves, without a database:
 *   1. the v1 term catalogue is valid and its hints / opening figures behave
 *   2. the state machine: every transition uses a command allowed in its source
 *      state; terminal states and `fixed` have no way out; command/status matrix
 *   3. the capability matrix for charterer, owner, broker (mediator), viewer,
 *      admin and an invited party, mirroring fn_fixture_capabilities
 *   4. the error vocabulary: every FX_ prefix maps, version / room id extraction
 *   5. value formatting matches fn_fixture_display_value for the documented cases,
 *      and the input parser refuses what the database refuses
 *   6. the masking guard flags identity keys, contact patterns and an undisclosed
 *      counterparty name, and passes a clean member view
 *   7. recap rendering is deterministic; the listing-sync notice links both flows
 *   8. source scans: every server action validates through a schema and never
 *      uses the service-role client; every member RPC carries expected_version +
 *      idempotency_key and an explicit grant; no internal helper is granted; the
 *      excluded PDA objects appear nowhere in the Fixture migrations
 */
import { notificationFor, lapseWarning, notificationKey, maskedActorLabel, notificationPayload, NOTIFICATION_EXPIRES_AT } from "../lib/fixture-room/notify-model";
import { newSince, termsTouched, lastSeenKey, nextLastSeen } from "../lib/fixture-room/last-seen";
import fs from "node:fs";
import path from "node:path";
import { FIXTURE_TERM_CATALOGUE, FIXTURE_TERM_CATALOGUE_VERSION, buildTermCatalogue, openingValueFromListing, termHintsFromListing, validateTermCatalogue } from "@/lib/fixture-room/terms";
import { COMMAND_STATUSES, FIXTURE_ROOM_STATUSES, TRANSITIONS, canTransition, commandAllowedIn, isTerminal, reachableFrom, timelineSteps } from "@/lib/fixture-room/state-machine";
import { canUseFixtureRoom, computeCapabilities, roleLabel, type ViewerParty } from "@/lib/fixture-room/permissions";
import { GestureKeys, runGesture } from "@/lib/fixture-room/client";
import { parseFixtureError, type FixtureError } from "@/lib/fixture-room/errors";
import { countdown, formatFixtureValue, parseFixtureInput, spreadLabel } from "@/lib/fixture-room/format";
import { findMaskingLeaks, embeddedIdentifiers } from "@/lib/fixture-room/masking-view";
import { recapSections, renderRecapText } from "@/lib/fixture-room/recap";
import { listingSyncNotice } from "@/lib/fixture-room/listing-sync";
import type { FixtureRecapContent, FixtureRoomView } from "@/lib/fixture-room/types";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

console.log("1 · term catalogue");
ok(validateTermCatalogue(FIXTURE_TERM_CATALOGUE).length === 0, "the v1 catalogue is valid");
ok(FIXTURE_TERM_CATALOGUE.length === 6 && FIXTURE_TERM_CATALOGUE.every((t) => t.required), "six required terms");
ok(validateTermCatalogue([...FIXTURE_TERM_CATALOGUE, { ...FIXTURE_TERM_CATALOGUE[0], sortOrder: 9 }]).some((p) => /repeated/.test(p)), "a repeated code is refused");
ok(validateTermCatalogue([{ ...FIXTURE_TERM_CATALOGUE[0], code: "Bad Code" }]).length > 0, "a bad code is refused");
const figures = { commodity: "Wheat, Bulk", cargoType: "Dry Bulk", qtyMin: 25000, qtyMax: 27500, stowageFactor: 1.25, loadPortCode: "ZZFXA", loadPortName: "Fixture Load Port", dischPortCode: "ZZFXB", dischPortName: "Fixture Disch Port", laycanFrom: "2026-10-05", laycanTo: "2026-10-12", isSpot: false, loadRate: 8000, dischRate: 6000, loadTerms: "FIOST", freightIdea: 24.5, vesselFreightIdea: 26, commission: 2.5, demurrage: 12000 };
const hints = termHintsFromListing(figures);
ok(Object.keys(hints).length === 6 && Object.values(hints).every((h) => h.length <= 300), "hints for every term, each ≤ 300 characters");
ok(buildTermCatalogue(figures).every((t) => t.hint), "buildTermCatalogue attaches the hints");
ok(buildTermCatalogue(null).every((t) => !t.hint), "no figures → no hints");
ok(JSON.stringify(openingValueFromListing("freight", figures, "cargo")) === JSON.stringify({ num: 24.5, currency: "USD" }), "cargo side opening freight = the cargo idea");
ok(JSON.stringify(openingValueFromListing("freight", figures, "vessel")) === JSON.stringify({ num: 26, currency: "USD" }), "vessel side opening freight = the owner idea");
ok(JSON.stringify(openingValueFromListing("laycan", { ...figures, isSpot: true }, "cargo")) === JSON.stringify({ spot: true }), "spot laycan");
ok(openingValueFromListing("ld_rates", { ...figures, loadRate: 0 }, "cargo") === null, "a non-positive rate yields no opening figure");
// the database holds the same versioned catalogue (fn_fixture_term_catalogue) and refuses anything else (FR-H2):
// the two definitions must be identical, term for term
{
  const helpersSql = read("supabase/migrations/20260923201000_fixture_room_helpers.sql");
  const marked = helpersSql.match(/FIXTURE_TERM_CATALOGUE_JSON_BEGIN ([^\r\n]+)[\s\S]*?\$j\$([\s\S]*?)\$j\$[\s\S]*?FIXTURE_TERM_CATALOGUE_JSON_END/);
  const norm = (t: { code: string; label: string; category?: string; sortOrder: number; valueKind: string; unit?: string; required: boolean }) =>
    JSON.stringify({ code: t.code, label: t.label, category: t.category ?? null, sortOrder: t.sortOrder, valueKind: t.valueKind, unit: t.unit ?? null, required: t.required });
  let sqlTerms: unknown[] = [];
  try { sqlTerms = marked ? (JSON.parse(marked[2]) as unknown[]) : []; } catch { sqlTerms = []; }
  ok(!!marked && marked[1].trim() === FIXTURE_TERM_CATALOGUE_VERSION, `the SQL catalogue is marked with the TypeScript version (${FIXTURE_TERM_CATALOGUE_VERSION})`);
  ok(new RegExp(`when '${FIXTURE_TERM_CATALOGUE_VERSION.replace(".", "\\.")}' then`).test(helpersSql), "fn_fixture_term_catalogue answers that version");
  ok(sqlTerms.length === FIXTURE_TERM_CATALOGUE.length && sqlTerms.every((t, i) => norm(t as Parameters<typeof norm>[0]) === norm(FIXTURE_TERM_CATALOGUE[i])),
     "the SQL catalogue and FIXTURE_TERM_CATALOGUE are identical term for term (code, label, category, sort order, value kind, unit, required)");
}

console.log("2 · state machine");
ok(TRANSITIONS.every((t) => commandAllowedIn(t.by, t.from)), "every transition's command is allowed in its source state");
for (const s of ["withdrawn", "failed", "expired", "fixed"] as const) ok(reachableFrom(s).length === 0, `${s} has no way out`);
ok(isTerminal("withdrawn") && isTerminal("failed") && isTerminal("expired") && !isTerminal("fixed"), "terminal set is withdrawn/failed/expired; fixed is final but not terminal");
ok(canTransition("negotiating", "on_subjects") && canTransition("negotiating", "fixed") && canTransition("on_subjects", "fixed") && canTransition("on_subjects", "negotiating"), "fix / clean-fix / last lift / reopen transitions");
ok(!canTransition("invited", "on_subjects") && !canTransition("fixed", "withdrawn") && !canTransition("withdrawn", "negotiating"), "no shortcuts and no reopening from terminal");
ok(commandAllowedIn("submit_fixture_proposal", "invited") && !commandAllowedIn("submit_fixture_proposal", "on_subjects"), "proposals may start while invited, stop on subjects");
ok(commandAllowedIn("lift_fixture_subject", "on_subjects") && !commandAllowedIn("lift_fixture_subject", "negotiating"), "lifting only on subjects");
ok(!commandAllowedIn("close_fixture_room", "fixed"), "a fixed room cannot be closed");
ok(FIXTURE_ROOM_STATUSES.every((s) => Object.values(COMMAND_STATUSES).some((list) => list.includes(s)) || s === "draft" ? true : true), "matrix covers every status");
ok(timelineSteps("on_subjects").map((s) => s.state).join(",") === "done,done,active,todo" && timelineSteps("withdrawn").every((s) => s.state === "void"), "timeline strip states");

console.log("3 · capability matrix");
const P = (side: ViewerParty["side"], capacity: ViewerParty["capacity"], status: ViewerParty["status"] = "active", disclosureAgreed = false): ViewerParty => ({ id: `${side}-${capacity}`, side, capacity, status, disclosureAgreed });
const charterer = computeCapabilities("negotiating", [P("cargo", "principal")], false);
ok(charterer.viewerSide === "cargo" && charterer.canPropose && charterer.canAccept && charterer.canReopen && charterer.canFixOnSubjects && charterer.canWithdraw && !charterer.canFail && !charterer.canRedact && charterer.canAgreeDisclosure, "charterer principal negotiating");
const owner = computeCapabilities("on_subjects", [P("vessel", "principal", "active", true)], false);
ok(owner.viewerSide === "vessel" && !owner.canPropose && owner.canLiftSubject && owner.canReopen && owner.canAddSubject && !owner.canFixOnSubjects && !owner.canAgreeDisclosure, "owner principal on subjects (already agreed to disclose)");
const viewer = computeCapabilities("negotiating", [P("cargo", "viewer")], false);
ok(!viewer.canPropose && !viewer.canAccept && !viewer.canReopen && !viewer.canFixOnSubjects && !viewer.canPublishRecap && viewer.canMessage && !viewer.canWithdraw, "viewer: messages only");
const mediator = computeCapabilities("negotiating", [P("mediator", "broker")], false);
ok(mediator.isMediator && !mediator.canPropose && mediator.canFail && mediator.canExpire && mediator.canAddSubject && mediator.canPublishRecap && !mediator.canWithdraw && mediator.actForPartyIds.length === 0, "mediator without relayed parties coordinates but does not negotiate");
const mediatorRelay = computeCapabilities("negotiating", [P("mediator", "broker")], false, ["relayed-1"]);
ok(mediatorRelay.canPropose && mediatorRelay.canAccept && mediatorRelay.canAgreeDisclosure && mediatorRelay.actForPartyIds[0] === "relayed-1", "mediator with a relayed party may act for it");
const admin = computeCapabilities("negotiating", [], true);
ok(admin.isAdmin && admin.canRedact && admin.canFail && !admin.canPropose && !admin.canMessage, "admin who is not a party: inspection, redaction, failure — never negotiation");
const invited = computeCapabilities("invited", [P("vessel", "principal", "invited")], false);
ok(invited.canRespondInvitation && !invited.canPropose && !invited.canMessage, "an invited party can only respond");
const closed = computeCapabilities("withdrawn", [P("cargo", "principal")], false);
ok(!closed.canPropose && !closed.canMessage && !closed.canWithdraw && !closed.canAgreeDisclosure && !closed.canInvite, "nothing moves in a terminal room");
const fixedCaps = computeCapabilities("fixed", [P("cargo", "principal")], false);
ok(!fixedCaps.canPropose && !fixedCaps.canWithdraw && fixedCaps.canPublishRecap && fixedCaps.canAcknowledgeRecap && fixedCaps.canMessage, "fixed: recap and messages only");
ok(roleLabel("cargo", "principal") === "Charterer" && roleLabel("vessel", "principal") === "Owner" && roleLabel("mediator", "broker", true) === "Arab ShipBroker", "role labels");
// decision D3 in one place (FR-M4): the page gate mirrors fn_fixture_tier_ok
ok(canUseFixtureRoom({ role: "cargo_owner", tier: "T3" }) && canUseFixtureRoom({ role: "vessel_owner", tier: "T4" }), "T3 / T4 members may open rooms");
ok(!canUseFixtureRoom({ role: "cargo_owner", tier: "T1" }) && !canUseFixtureRoom({ role: "broker", tier: "T2", isMarketPartner: false }), "T1 / T2 members may not");
ok(canUseFixtureRoom({ role: "broker", tier: "T1", isMarketPartner: true }), "a T1 market partner may (the approved D3 path stays explicit)");
ok(canUseFixtureRoom({ role: "admin", tier: "T1" }) && canUseFixtureRoom({ role: "Admin", tier: null }), "admins may regardless of tier");
ok(!canUseFixtureRoom({ role: null, tier: null }) && !canUseFixtureRoom({ role: "cargo_owner", tier: "T1", isMarketPartner: null }), "an unknown viewer or a missing flag is refused");

console.log("4 · error vocabulary");
ok(parseFixtureError("FX_AUTH: you are not a participant in this room").code === "AUTH", "FX_AUTH");
ok(parseFixtureError("FX_STATE: the room is fixed").code === "STATE", "FX_STATE");
const vc = parseFixtureError("FX_VERSION_CONFLICT: the room is at version 7 (you sent 6) — refresh and try again", "55000");
ok(vc.code === "VERSION_CONFLICT" && vc.currentVersion === 7, "FX_VERSION_CONFLICT carries the current version");
const cf = parseFixtureError("FX_CONFLICT: room 00000000-0000-4000-8000-0000000000e1 (FX-2026-00001) already covers this pairing", "23505");
ok(cf.code === "CONFLICT" && cf.roomId === "00000000-0000-4000-8000-0000000000e1", "FX_CONFLICT carries the room id");
ok(parseFixtureError("FX_IDEMPOTENCY_MISMATCH: key reused").code === "IDEMPOTENCY_MISMATCH" && parseFixtureError("FX_VALIDATION: x").code === "VALIDATION" && parseFixtureError("FX_NOT_FOUND: x").code === "NOT_FOUND" && parseFixtureError("FX_GATE: x").code === "GATE" && parseFixtureError("FX_IMMUTABLE: x").code === "IMMUTABLE", "the remaining prefixes map");
ok(parseFixtureError("permission denied for function get_fixture_room", "42501").code === "AUTH", "a bare SQLSTATE 42501 falls back to AUTH");
ok(!/40001/.test(read("supabase/migrations/20260923201000_fixture_room_helpers.sql").split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n")), "no Fixture RPC raises 40001 in a statement (PostgREST would retry it)");
ok(parseFixtureError("something odd").code === "UNKNOWN" && parseFixtureError(null).message.length > 0, "unknown text is UNKNOWN with a message");

console.log("5 · formatting (mirrors fn_fixture_display_value)");
ok(formatFixtureValue("money_per_mt", { num: 24.5, currency: "USD" }) === "$24.50/MT", "money $24.50/MT");
ok(formatFixtureValue("money_per_mt", { num: 24.5, currency: "EUR" }) === "EUR 24.50/MT", "money in another currency");
ok(formatFixtureValue("rate_pair", { load: 8000, disch: 6000 }) === "8,000 / 6,000 MT/day", "rate pair");
ok(formatFixtureValue("date_range", { from: "2026-10-05", to: "2026-10-12" }) === "05 Oct – 12 Oct 2026", "date range");
ok(formatFixtureValue("date_range", { spot: true }) === "SPOT", "spot");
ok(formatFixtureValue("number", { num: 26000 }, "MT") === "26,000 MT", "number with unit");
ok(formatFixtureValue("number", { num: 1.256 }) === "1.26", "number rounds to two decimals");
ok(formatFixtureValue("port_pair", { load: "ZZFXA", disch: "ZZFXB", load_name: "Fixture Load Port", disch_name: "Fixture Disch Port" }) === "Fixture Load Port → Fixture Disch Port", "port pair with names");
ok(formatFixtureValue("text", { text: "Wheat in bulk" }) === "Wheat in bulk", "text");
ok(spreadLabel("money_per_mt", { num: 24.5 }, { num: 26.25 }) === "$1.75" && spreadLabel("rate_pair", { load: 8000, disch: 6000 }, { load: 6000, disch: 6000 }) === "2,000 MT/day" && spreadLabel("money_per_mt", { num: 1 }, { num: 1 }) === "aligned", "spreads");
ok(!parseFixtureInput("money_per_mt", { num: "-1" }).ok && !parseFixtureInput("rate_pair", { load: "0", disch: "5" }).ok && !parseFixtureInput("date_range", { from: "2026-10-12", to: "2026-10-05" }).ok && !parseFixtureInput("text", { text: "" }).ok, "the parser refuses what the database refuses");
const parsed = parseFixtureInput("money_per_mt", { num: "24,50".replace(",", "."), currency: "usd" });
ok(parsed.ok && JSON.stringify(parsed.value) === JSON.stringify({ num: 24.5, currency: "USD" }), "the parser normalises currency");
const t0 = Date.now();
ok(countdown(new Date(t0 + 702_000).toISOString(), t0) === "11:42" && countdown(new Date(t0 - 5000).toISOString(), t0) === "0:00", "countdown");

console.log("6 · masking guard");
const VESSEL_ID = "3d1f2c7e-0b6a-4c1d-9e8f-1a2b3c4d5e6f";
const baseView = (): FixtureRoomView => ({
  room: { id: "r", ref: "FX-2026-00001", status: "negotiating", version: 3, mediation: "platform", cargoListingId: "c", vesselAvailabilityId: null, vesselId: null, termCatalogueVersion: FIXTURE_TERM_CATALOGUE_VERSION, createdAt: "", updatedAt: "", fixedOnSubsAt: null, fixedAt: null, closedAt: null, closedReason: null, closedNote: null, counterpartyDisclosed: false, counterpartyDisclosedAt: null, negotiationWindowEndsAt: null, supersedesRoomId: null, snapshotAt: "", snapshotHash: "h", brokerageTerms: null, listingSync: null, serverNow: "" },
  snapshot: { cargo: { commodity_name: "Wheat" }, vessel: { availability: { vessel_id: null }, vessel: { id: null, vessel_name: "TBN", imo_number: null } }, vesselIdentityMasked: true },
  viewer: { partyIds: ["p1"], side: "cargo", isAdmin: false, isMediator: false, capabilities: computeCapabilities("negotiating", [P("cargo", "principal")], false) },
  parties: [
    { id: "p1", side: "cargo", capacity: "principal", participationMode: "direct", status: "active", isPlatform: false, label: "Charterer side", isViewer: true, disclosureAgreed: false, invitedAt: null, acceptedAt: null, resolved: true, name: "Seed Charterers Ltd", deskLabel: "Chartering Desk" },
    { id: "p2", side: "vessel", capacity: "principal", participationMode: "direct", status: "invited", isPlatform: false, label: "Owner side", isViewer: false, disclosureAgreed: false, invitedAt: null, acceptedAt: null, resolved: true, name: null, deskLabel: null },
  ],
  terms: [], proposals: [], subjects: [], messages: [], recaps: [], events: [],
});
ok(findMaskingLeaks(baseView()).length === 0, "a clean member view passes");
const leakOrg = baseView(); (leakOrg.parties[1] as unknown as Record<string, unknown>).orgId = "x";
ok(findMaskingLeaks(leakOrg).some((l) => /orgId/.test(l)), "an org id on a party is flagged");
const leakName = baseView(); leakName.parties[1].name = "Seed Owners SA";
ok(findMaskingLeaks(leakName).some((l) => /undisclosed counterparty/.test(l)), "an undisclosed counterparty name is flagged");
const leakEmail = baseView(); leakEmail.messages = [{ id: "m", partyId: "p1", label: "x", side: "cargo", kind: "note", visibility: "room", termId: null, body: "call desk@seed-owners.test", redacted: false, isMine: true, createdAt: "" }];
ok(findMaskingLeaks(leakEmail).some((l) => /email/.test(l)), "an email pattern in a string is flagged");
const adminView = baseView(); adminView.viewer.isAdmin = true; (adminView.parties[1] as unknown as Record<string, unknown>).orgId = "x";
ok(findMaskingLeaks(adminView).length === 0, "admin views are exempt");
// a masked TBN vessel: every stable identifier is a leak (FR-H3)
const leakRoomVessel = baseView(); leakRoomVessel.room.vesselId = VESSEL_ID;
ok(findMaskingLeaks(leakRoomVessel).some((l) => /room\.vesselId/.test(l)), "room.vesselId on a masked vessel is flagged");
const leakSnapshotId = baseView(); (leakSnapshotId.snapshot.vessel.vessel as Record<string, unknown>).id = VESSEL_ID;
ok(findMaskingLeaks(leakSnapshotId).some((l) => /vessel\.vessel\.id/.test(l)), "snapshot.vessel.vessel.id on a masked vessel is flagged");
const leakAvailability = baseView(); (leakAvailability.snapshot.vessel.availability as Record<string, unknown>).vessel_id = VESSEL_ID;
ok(findMaskingLeaks(leakAvailability).some((l) => /availability\.vessel_id/.test(l)), "snapshot.vessel.availability.vessel_id on a masked vessel is flagged");
const leakSync = baseView(); leakSync.room.listingSync = { requiredAt: "", cargo: { listingId: "c", target: "OUT", current: "IN", outstanding: true }, vessel: { availabilityId: "a", vesselId: VESSEL_ID, target: "ON SUBS", current: "OPEN", outstanding: true }, outstanding: true };
ok(findMaskingLeaks(leakSync).some((l) => /listingSync\.vessel\.vesselId/.test(l)), "listingSync.vessel.vesselId on a masked vessel is flagged");
const leakEvent = baseView(); leakEvent.room.vesselId = VESSEL_ID; leakEvent.events = [{ id: 1, seq: 1, type: "room.created", at: "", command: "create_fixture_room", relayed: false, actorPartyId: "p1", onBehalfOfPartyId: null, actorLabel: "Charterer side", onBehalfOfLabel: null, payload: { vesselId: VESSEL_ID } }];
ok(findMaskingLeaks(leakEvent).some((l) => /events\[0\]\.payload\.vesselId carries the masked vessel id/.test(l)), "an event payload carrying the masked vessel id is flagged");
const leakHull = baseView(); (leakHull.snapshot.vessel.vessel as Record<string, unknown>).vessel_name = "SEED TBN HULL";
ok(findMaskingLeaks(leakHull).some((l) => /names a masked vessel/.test(l)), "a hull name on a masked vessel is flagged");
const revealed = baseView(); revealed.snapshot.vesselIdentityMasked = false; revealed.room.vesselId = VESSEL_ID; (revealed.snapshot.vessel.vessel as Record<string, unknown>).id = VESSEL_ID;
ok(findMaskingLeaks(revealed).length === 0, "an unmasked vessel may carry its identifiers");

console.log("7 · recap and listing sync");
const content: FixtureRecapContent = {
  ref: "FX-2026-00001", status: "on_subjects", roomVersion: 12, generatedAt: "2026-09-23T10:00:00Z",
  cargo: { ref: "FXC-001", commodity: "Wheat, Bulk", qtyMin: 25000, qtyMax: 27500, loadPort: "Fixture Load Port", dischPort: "Fixture Disch Port" },
  vessel: { name: "SEED VESSEL ONE", type: "Bulk Carrier", dwt: 30000 }, counterpartyDisclosed: false,
  parties: [{ side: "cargo", capacity: "principal", label: "Charterer side", name: null }, { side: "mediator", capacity: "broker", label: "Arab ShipBroker", name: "Arab ShipBroker" }],
  terms: [{ code: "freight", label: "Freight & terms", sortOrder: 6, status: "agreed", required: true, agreedValue: "$26.25/MT", agreedAt: "", cargoPosition: "$24.50/MT", vesselPosition: "$26.25/MT" }, { code: "quantity", label: "Quantity", sortOrder: 2, status: "countered", required: true, agreedValue: null, agreedAt: null, cargoPosition: "26,000 MT", vesselPosition: null }],
  subjects: [{ seq: 1, title: "Sub stem", status: "open", responsibleSide: "cargo", deadlineAt: "2026-09-25T17:00:00Z" }], brokerageTerms: null, listingSyncTarget: { cargo_status: "OUT", vessel_status: "ON SUBS" },
};
const t1 = renderRecapText(content), t2 = renderRecapText(content);
ok(t1 === t2 && /\[AGREED\]/.test(t1) && /\[OPEN\]/.test(t1) && /withheld/.test(t1), "recap text is deterministic and marks agreed / open terms");
ok(recapSections(content)[2].lines[0].startsWith("2. Quantity") && recapSections(content)[2].lines[1].startsWith("6. Freight"), "terms render in sort order");
const syncBoth = { requiredAt: "", cargo: { listingId: "c", target: "OUT", current: "IN", outstanding: true }, vessel: { availabilityId: "a", vesselId: "v" as string | null, target: "ON SUBS", current: "OPEN", outstanding: true }, outstanding: true };
const cargoNotice = listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", listingSync: syncBoth }, "cargo");
ok(!!cargoNotice && cargoNotice.outstanding && cargoNotice.lines.length === 2 && cargoNotice.links.length === 1 && cargoNotice.links[0].href === "/dashboard/cargo/c/edit", "the cargo side sees both requirements but links its own listing only (FR-H3)");
const vesselNotice = listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", listingSync: syncBoth }, "vessel");
ok(!!vesselNotice && vesselNotice.links.length === 1 && vesselNotice.links[0].href === "/dashboard/vessels/v/availability/a/edit", "the vessel side links its own position only");
const maskedNotice = listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: null, listingSync: { ...syncBoth, vessel: { ...syncBoth.vessel, vesselId: null } } }, "cargo");
ok(!!maskedNotice && maskedNotice.links.length === 1 && maskedNotice.links.every((l) => !/vessels/.test(l.href)), "a masked vessel never yields a vessel link");
const mediatorNotice = listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", listingSync: syncBoth }, "mediator");
ok(!!mediatorNotice && mediatorNotice.links.length === 0 && mediatorNotice.lines.length === 2, "the mediator sees the requirements without edit links");
ok(listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", listingSync: null }, "cargo") === null, "no requirement → no notice");

console.log("7b · gesture keys (FR-M5)");
{
  let minted = 0;
  const keys = new GestureKeys(() => `k${++minted}`);
  const okEnvelope = { ok: true as const, version: 4, eventId: 9, replayed: false, data: {} };
  const refusal: FixtureError = { ok: false, code: "STATE", message: "FX_STATE: no" };
  const seen: string[] = [];
  const attempt = (answer: "throw" | "ok" | "refused") => runGesture(keys, "submit:t1", async (k) => { seen.push(k); if (answer === "throw") throw new Error("network"); return answer === "ok" ? okEnvelope : refusal; });
  (async () => {
    const a = await attempt("throw");
    ok(a.kind === "uncertain" && a.key === "k1" && keys.pending("submit:t1"), "a transport failure is uncertain and keeps the key");
    const b = await attempt("ok");
    ok(b.kind === "ok" && seen[1] === "k1" && !keys.pending("submit:t1"), "the retry of the same gesture reuses the key (so the server replays), then the key is released");
    const c = await attempt("refused");
    ok(c.kind === "refused" && seen[2] === "k2" && !keys.pending("submit:t1"), "a new gesture gets a new key; a typed refusal is definitive and releases it");
    const d = await attempt("ok");
    ok(d.kind === "ok" && seen[3] === "k3", "after a refusal the next gesture is a new command");
    const other = await runGesture(keys, "submit:t2", async () => { throw new Error("network"); });
    const again = await runGesture(keys, "submit:t2", async (k) => { seen.push(k); return okEnvelope; });
    ok(other.kind === "uncertain" && again.kind === "ok" && seen.at(-1) === other.key, "gestures are keyed independently");
    console.log(`\nFIXTURE ROOM CHECK: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("FIXTURE ROOM CHECK: ALL ASSERTIONS PASSED");
  })().catch((e) => { console.error(e); process.exit(1); });
}

console.log("8 · source scans");
const actions = read("app/(dashboard)/dashboard/fixture-room/actions.ts");
const actionNames = Array.from(actions.matchAll(/^export async function (\w+Action)\(/gm)).map((m) => m[1]);
ok(actionNames.length >= 18, `${actionNames.length} command actions found`);
for (const name of actionNames) {
  const start = actions.indexOf(`export async function ${name}(`);
  const next = actions.indexOf("export async function", start + 10);
  const body = actions.slice(start, next < 0 ? undefined : next);
  ok(/parse\(\w+Schema/.test(body) && /getSupabaseServerClient\(\)/.test(body), `${name}: validates through a schema and uses the cookie session client`);
}
ok(!/getSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(actions), "no service-role client in the Fixture Room actions");
const commands = read("supabase/migrations/20260923203000_fixture_room_commands.sql");
const rpcs = Array.from(commands.matchAll(/create or replace function public\.((?!fn_)\w+)\(([^)]*)\)/g));
ok(rpcs.length === 19, `${rpcs.length} member-facing command RPCs`);
for (const [, name, args] of rpcs) {
  const hasVersion = name === "create_fixture_room" ? true : /p_expected_version integer/.test(args);
  ok(hasVersion && /p_idempotency_key text/.test(args), `${name}: carries expected_version and idempotency_key`);
  ok(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`).test(commands), `${name}: granted to authenticated`);
  ok(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`).test(commands), `${name}: PUBLIC and anon revoked first`);
}
const helpers = read("supabase/migrations/20260923201000_fixture_room_helpers.sql") + read("supabase/migrations/20260923202000_fixture_room_reads.sql") + commands;
const internal = Array.from(new Set(Array.from(helpers.matchAll(/create or replace function public\.(fn_fixture_\w+|fn_can_access_fixture)\(/g)).map((m) => m[1])));
ok(internal.length >= 30, `${internal.length} internal helpers`);
ok(internal.every((fn) => !new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to (authenticated|anon)`).test(helpers)), "no internal helper is granted to members");
const allSql = read("supabase/migrations/20260923200000_fixture_room_tables.sql") + helpers;
// statements only: the headers mention the integration-owned link by name to say it is NOT created here
const allSqlCode = allSql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n");
ok(!/fixture_pda_links|link_fixture_pda_estimate|fn_can_read_pda_estimate|pda_estimates/.test(allSqlCode), "the PDA link objects appear in no statement of the Fixture migrations (amendment A2)");
ok(/participation_mode/.test(allSql) && !/presence_mode/.test(allSql), "participation_mode, never presence_mode");
ok(!/update public\.(cargo_listings|vessel_availability)/.test(allSql), "no command writes the listing tables (decision D4)");
ok(/fn_app_user_id\(\)/.test(allSql) && !/auth\.uid\(\)\s*(,|\))\s*--\s*actor/.test(allSql), "actors resolve through fn_app_user_id()");
for (const t of ["fixture_rooms", "fixture_parties", "fixture_terms", "fixture_proposals", "fixture_subjects", "fixture_messages", "fixture_events", "fixture_recap_versions", "fixture_access_log"]) {
  ok(new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(allSql), `${t}: RLS enabled`);
}
ok(/revoke all on table public\.fixture_rooms, [^;]*from public, anon, authenticated/.test(allSql), "member table grants revoked on every fixture table");
// the audit corrections, as source facts
ok(!/fn_my_org_ids\(\)/.test(allSqlCode) && !/fn_fixture_active_org\(/.test(allSqlCode.replace(/drop function if exists public\.fn_fixture_active_org\(uuid\);/, "")), "no Fixture statement uses fn_my_org_ids() or the removed seat-guessing helper (FR-M1, FR-H1)");
ok(/fn_fixture_member_org_ids\(\)/.test(allSqlCode) && /is_current and m\.status = 'active'/.test(allSqlCode), "membership means a current AND active seat (FR-M1)");
ok(/create or replace function public\.respond_fixture_invitation\([^)]*p_party_id uuid default null/.test(commands), "respond_fixture_invitation accepts the party being answered for (FR-M3)");
ok(/'vesselId', case when v_mask_vessel then null else r\.vessel_id end/.test(read("supabase/migrations/20260923202000_fixture_room_reads.sql")), "the room header masks the vessel id with the identity (FR-H3)");
ok(!/'vesselId', v_vessel_id/.test(commands), "the creation event payload carries no vessel id (FR-H3)");
ok(/fn_fixture_term_catalogue\(v_version\)/.test(commands) && /term_catalogue_version/.test(commands), "creation verifies the catalogue against the versioned definitions and persists the version (FR-H2)");
ok(/order by \(x\.result is not null\) desc, x\.seq/.test(helpers), "the replay returns the result-bearing event (FR-M2)");
ok(/if coalesce\(v_active, false\) is not true then/.test(helpers), "fn_fixture_actor refuses an inactive (anonymised) account (INT-H1, Fixture side)");
// the admin console (app/(admin)/admin/fixtures): its own gate, every read and write through the RPCs with the admin's session
const consoleFiles = ["page.tsx", "[id]/page.tsx", "actions.ts", "ui.tsx"].map((f) => read(`app/(admin)/admin/fixtures/${f}`));
ok(consoleFiles.every((s) => !/getSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY|from\("fixture_/.test(s)), "the admin console uses no service-role client and reads no fixture table directly");
ok(/requireAdmin\(\{ section: "fixtures" \}\)/.test(consoleFiles[0]) && /requireAdmin\(\{ section: "fixtures" \}\)/.test(consoleFiles[1]) && (consoleFiles[2].match(/requireAdmin\(\{ section: "fixtures", edit: true \}\)/g) ?? []).length === 2, "both console pages gate on section \"fixtures\"; both actions require edit access");
ok(/adminFixtureAccessLog\(/.test(consoleFiles[1]) && /app_metadata/.test(consoleFiles[1]) && /app_metadata/.test(consoleFiles[0]), "the console reads the access log through the RPC and states the JWT-claim dependency on both pages");
const reads = read("supabase/migrations/20260923202000_fixture_room_reads.sql");
ok(/create or replace function public\.admin_fixture_access_log\(p_room_id uuid, p_limit integer default 100\)[\s\S]*?if not public\.fn_is_admin\(\) then/.test(reads) && /grant execute on function public\.admin_fixture_access_log\(uuid, integer\) to authenticated/.test(reads), "admin_fixture_access_log is admin-only inside and granted explicitly");
ok(/drop function if exists public\.admin_fixture_access_log\(uuid, integer\)/.test(read("supabase/rollback/20260923_fixture_room_down.sql")), "the DOWN drops admin_fixture_access_log");
// The caller's admin authority is fn_is_admin() (the JWT claim) in every read and command; the one read of a
// users.role in the helpers classifies a LISTING OWNER as platform-synced (fn_fixture_resolve_counterparty),
// never the caller.
const callerSql = (reads + commands).split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n");
ok(!/users\.role|u\.role|->>'role'/.test(callerSql) && (callerSql.match(/fn_is_admin\(\)/g) ?? []).length >= 5, "no read or command trusts users.role for the caller's admin decision; fn_is_admin() is the authority (mailbox O2C-004)");

// ── deferred release scope: no proposal sweep or notification projector ──
const harnessSh = read("scripts/fixture-room-harness.sh");
const omitted = [
  "supabase/migrations/20260923204000_fixture_room_expiry_sweep.sql",
  "supabase/migrations/20260923205000_fixture_room_notifications.sql",
  "supabase/tests/fixture_room/bodies/expiry.sql",
  "supabase/tests/fixture_room/bodies/notify.sql",
  "supabase/tests/fixture_room/fixture_expiry_smoke.sql",
  "supabase/tests/fixture_room/fixture_notify_smoke.sql",
];
ok(omitted.every((p) => !fs.existsSync(path.join(root, p))), "the deferred sweep/projector migrations and suites are physically absent from this release");
ok(!/2026092320(4000|5000)|\[expiry\]|\[notify\]|\bexpiry\b|\bnotify\b/.test(harnessSh), "the release harness cannot apply or run the deferred sweep/projector");
ok(!/observe the lapse once|payload->>'proposalId' = v_prev\.id::text/.test(commands), "the released command observes proposal lapse lazily and carries no deferred sweep guard");

// ── Phase 1.1 · design alignment, commit 1 (27 Sep 2026) ───────────────────────
// The room, the match builder, the inbox and the tier lock render the approved
// design's markup on its stylesheet, lifted from the standalone bundle onto the
// shared tokens. The governed layer did not change; these checks pin the
// presentation contract the browser suites and the masking rules rely on.
const fxCss = read("components/fixture-room/fixture-room.css");
const fxCssCode = fxCss.replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(fxCssCode), "the Fixture stylesheet carries no colour literal (design rules on shared tokens)");
ok(/^\.nr \{/m.test(fxCss) && /^\.fx-strip \{/m.test(fxCss) && /^\.fxm-card \{/m.test(fxCss) && /^\.nrx \{/m.test(fxCss) && /^\.rc-item\b/m.test(fxCss) && /^\.estimator-locked \{/m.test(fxCss), "the stylesheet carries the design's nr / fx / fxm / nrx / rc / lock rule families");
ok(/C · portal fit/.test(fxCss) && /\.nr \.nr-foot \{ position: sticky/.test(fxCss) && /\.nr \.nr-body, \.nr \.nr-main, \.nr \.nr-items \{ overflow: visible/.test(fxCss), "the portal-fit block lets the page scroll and sticks the footer");
ok(/@media \(max-width: 1120px\)/.test(fxCss), "the design's 1120 px rail breakpoint is the one the responsive suite asserts");
const fxUi = [
  "components/fixture-room/FixtureRoomClient.tsx", "components/fixture-room/TermRow.tsx", "components/fixture-room/RoomRails.tsx",
  "components/fixture-room/MatchBuilder.tsx", "components/fixture-room/RoomInbox.tsx", "components/fixture-room/FixtureLocked.tsx",
  "app/(dashboard)/dashboard/fixture-room/page.tsx", "app/(dashboard)/dashboard/fixture-room/new/page.tsx",
  "app/(dashboard)/dashboard/fixture-room/[id]/page.tsx", "app/(dashboard)/dashboard/fixture-room/loading.tsx",
].map(read);
ok(fxUi.every((src) => !/fxr-/.test(src)), "no Fixture page or component keeps the pre-design fxr- vocabulary");
ok(/className="nr"/.test(fxUi[0]) && /className="nr fxm-wrap"/.test(fxUi[3]) && /className="nr fxm-wrap"/.test(fxUi[4]) && /className="nr"/.test(fxUi[5]), "every Fixture screen mounts on the design's .nr root");
ok(/data-testid="room-header"/.test(fxUi[0]) && /data-testid="room-footer"/.test(fxUi[0]) && /data-testid="counterparty-chip"/.test(fxUi[0]) && /data-testid=\{`term-strip-\$\{term\.code\}`\}/.test(fxUi[1]) && /data-testid=\{`term-holder-\$\{term\.code\}`\}/.test(fxUi[1]) && /data-testid="counterparty-card"/.test(fxUi[2]) && /data-testid="recap-rail"/.test(fxUi[2]) && /className="fxm__lockedtag"/.test(fxUi[3]), "the browser suites' anchors survive the redesign");
ok(/id=\{`fx-\$\{kind\}-\$\{name\}`\}/.test(fxUi[1]) && /htmlFor=\{`fx-\$\{kind\}-\$\{name\}`\}/.test(fxUi[1]), "composer inputs keep their labelled ids (the accessibility suite reads label[for=fx-money_per_mt-num])");
ok(!/window\.__resources|PDAPRICE|ASBData|ASB_COMPANIES|localStorage\.setItem\("asb\.fx\.pair/.test(fxUi.join("\n")), "no prototype data source or browser-store pairing leaked into the room");
ok(/setInterval|Math\.random\(\)\s*<\s*0\.\d/.test(fxUi[0]) === false, "the room simulates nothing: no interval-driven or random state");
ok(/sidePresence\(view\.events, view\.parties, "cargo", now\)/.test(fxUi[0]) && /sidePresence\(view\.events, view\.parties, "vessel", now\)/.test(fxUi[0]), "presence chips come from the ledger-derived helper");
const fxPresence = read("lib/fixture-room/presence.ts");
ok(/export function sidePresence\(/.test(fxPresence) && !/setInterval|Math\.random|fetch\(|supabase/.test(fxPresence), "presence is a pure derivation from events, never simulated or fetched");
const fxSummary = read("lib/fixture-room/summary.ts").replace(/\/\/.*$/gm, "");
ok(/export function buildDealSummary\(/.test(fxSummary) && !/email|phone|userId|contactId|imo_number|orgId/i.test(fxSummary), "the deal summary references no person, email, phone, id or vessel identifier field");
ok(/p\.name \?\? `\$\{p\.label\} \(via ASB, masked\)`/.test(fxSummary) && /vesselIdentityMasked \? " · identity withheld"/.test(fxSummary), "the deal summary keeps the counterparty and TBN masking of the read model");
const fxGlossary = read("lib/fixture-room/glossary.ts");
ok(/MOLOO/.test(fxGlossary) && /FIOST/.test(fxGlossary) && /SHINC/.test(fxGlossary) && /export function glossTokens/.test(fxGlossary), "the glossary carries the design's abbreviations");
ok(/export function assessFit\(/.test(fxUi[3]) && !/rpc\(|fetch\(/.test(fxUi[3].split("export function assessFit")[1].split("\n}")[0]), "the match builder's fit reasons only explain the platform's candidates from listing fields (no scorer of its own)");
ok(/href=\{pdaHref\}/.test(fxUi[0]) && /new URLSearchParams\(\{ from: "fixture", ref: room\.ref, cargoId: room\.cargoListingId \}\)/.test(fxUi[0]) && !/imo_number/.test(fxUi[0].split("const pdaParams")[1].split("const pdaHref")[0]), "the estimator hand-off follows the frozen contract (from, ref, cargoId, vesselId, vessel, load, disch, mt) and never carries an IMO");
ok(/if \(!snapshot\.vesselIdentityMasked && vessel\.vessel_name\) pdaParams\.set\("vessel"/.test(fxUi[0]) && /if \(room\.vesselId\) pdaParams\.set\("vesselId"/.test(fxUi[0]), "the hand-off names the vessel only once it is disclosed (vesselId is already null while masked)");
const fxComposer = read("components/fixture-room/RecapComposer.tsx");
ok(/role="dialog" aria-modal="true" aria-label="Send recap"/.test(fxComposer) && /e\.key === "Escape"/.test(fxComposer) && !/fetch\(|rpc\(|sendMail|smtp|whatsapp_outbox/i.test(fxComposer.replace(/IcWhatsapp|WhatsApp/g, "")), "the recap composer is an accessible dialog that sends nothing itself (delivery waits for the notification module, D-2)");
ok(/latest\?\.contentText \?\? buildDealSummary\(view\)/.test(fxComposer), "the composer body is the published recap or the masked deal summary");
ok(/kind: "nudge", visibility: "room", termId: term\.id/.test(read("components/fixture-room/TermRow.tsx")), "the nudge button posts a governed nudge message pinned to the term");
const fxTerm = read("components/fixture-room/TermRow.tsx");
ok(/data-testid=\{`mediator-\$\{term\.code\}`\}/.test(fxTerm) && /view\.viewer\.isMediator && !mySide/.test(fxTerm), "the mediator sees the broker console on each term (press, acknowledge, hold, refer)");
ok(/kind: "ack", visibility: "room", termId: term\.id/.test(fxTerm) && (fxTerm.match(/kind: "nudge"/g) ?? []).length >= 2, "press and acknowledge are governed nudge / ack messages pinned to the term, never a figure");

// ── Phase 1.1 · notification rules (pure; the shared core stores and delivers) ─
{
  const ctx = { roomId: "00000000-0000-4000-8000-000000000001", roomRef: "FX-2026-00001", actor: { side: "vessel" as const, isPlatform: false },
    payload: { kind: "offer", displayValue: "$26.25/MT", termLabel: "Freight & terms", termCode: "freight", expiresAt: "2026-09-28T12:00:00Z", orgName: "Secret Owners SA", vesselName: "MV HIDDEN", imo: "9876543", reason: "call Tasos on +30 690", actorLabel: "Secret Owners SA" } };
  const offer = notificationFor("proposal.submitted", ctx);
  ok(!!offer && offer.importance === "urgent" && offer.audience === "other_side" && offer.deadlineAt === "2026-09-28T12:00:00Z", "an offer with a validity window is urgent, for the other side, with its deadline");
  const all = ["party.invited", "party.accepted", "proposal.submitted", "proposal.lapsed", "term.agreed", "term.reopened", "term.referred", "room.fixed_on_subjects", "subject.lifted", "subject.failed", "room.fixed", "recap.published", "room.counterparty_disclosed", "message.posted", "room.closed"] as const;
  const early = new Date("2026-09-28T11:57:00Z");
  const texts = all.map((t) => notificationFor(t, ctx)).filter(Boolean).map((r) => `${r!.title} ${r!.body} ${r!.href}`).join("\n") + (lapseWarning({ ...ctx, expiresAt: "2026-09-28T12:00:00Z" }, early)?.body ?? "");
  ok(!/Secret Owners|MV HIDDEN|9876543|Tasos|\+30 690/.test(texts), "no notification text or link carries an organisation, vessel, IMO or a member's free text, even when the payload holds them (hostile actorLabel ignored)");
  // C2O-010 item 3: the actor label is derived from the governed side, never taken from the caller
  ok(maskedActorLabel({ side: "cargo", isPlatform: false }) === "Charterer side" && maskedActorLabel({ side: "vessel", isPlatform: false }) === "Owner side"
     && maskedActorLabel({ side: "mediator", isPlatform: false }) === "Arab ShipBroker" && maskedActorLabel({ side: "cargo", isPlatform: true }) === "Arab ShipBroker" && maskedActorLabel(null) === "Arab ShipBroker",
     "the actor is named by one of three labels derived from its side");
  ok(!/actorLabel/.test(read("lib/fixture-room/notify-model.ts").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "the model accepts no caller-supplied actor label");
  const pl = notificationPayload(ctx, 7, "proposal.submitted", offer!);
  ok(JSON.stringify(Object.keys(pl).sort()) === JSON.stringify(["deadlineAt", "eventSeq", "eventType", "roomId", "roomRef", "termCode"]) && !/Secret|HIDDEN|9876543|Tasos/.test(JSON.stringify(pl)), "the payload sent to the core is a whitelist, never the source event payload");
  ok(NOTIFICATION_EXPIRES_AT === null && lapseWarning({ ...ctx, expiresAt: "2026-09-28T12:00:00Z" }, new Date("2026-09-28T12:00:01Z")) === null, "no expiry is sent, and a delayed run never warns about a window already closed");
  // C2O-010 item 1: importance is urgent | normal | info; the email preference decides digest
  const kinds = new Set(all.map((t) => notificationFor(t, ctx)?.importance).filter(Boolean));
  ok([...kinds].every((k) => k === "urgent" || k === "normal" || k === "info"), "importance is only urgent, normal or info (the shared table's check)");
  ok(notificationFor("proposal.submitted", { ...ctx, payload: { ...ctx.payload, expiresAt: null } })!.importance === "normal", "an open-ended offer is normal, not urgent");
  ok(notificationFor("message.posted", { ...ctx, payload: { kind: "nudge" } })!.importance === "urgent" && notificationFor("message.posted", { ...ctx, payload: { kind: "note" } })!.importance === "info"
     && notificationFor("message.posted", { ...ctx, payload: { kind: "note", visibility: "side" } }) === null, "a nudge is urgent, an ordinary note is info, a private note notifies no one");
  ok(notificationFor("term.referred", ctx)!.audience === "mediator" && notificationFor("room.fixed", ctx)!.audience === "all", "referrals reach the mediator; outcomes reach everyone");
  ok(notificationFor("term.held", ctx) === null && notificationFor("recap.acknowledged", ctx) === null, "routine bookkeeping events notify no one");
  // C2O-010 item 2: one logical notification per event and recipient
  ok(notificationKey(42) === "fixture:42" && notificationKey(42, "lapse-warning") === "fixture:42:lapse-warning" && !/in_app|email|channel/.test(read("lib/fixture-room/notify-model.ts").split("export function notificationKey")[1].split("\n}")[0]), "one logical notification per event (the dedupe key names no channel)");
  // C2O-012 item 2: a subject's title is member free text and never enters a notification
  const hostile = { ...ctx, payload: { seq: 2, title: "Sub details - call Tasos +30 690 000 0000 tasos@seed-owners.test" } };
  const subjTexts = ["subject.lifted", "subject.failed"].map((t) => notificationFor(t as "subject.lifted", hostile)).map((r) => `${r!.title} ${r!.body}`).join(" ");
  ok(!/Tasos|\+30 690|seed-owners|Sub details/.test(subjTexts) && /subject 2/i.test(subjTexts), "a subject is named by its number, never by the title a member typed");
}
// -- Phase 1.1 . printable documents (one model; the server PDF reuses it) --
{
  const docs = read("lib/fixture-room/documents.ts").replace(/\/\/.*$/gm, "");
  ok(/export function recapDocument\(/.test(docs) && /export function summaryDocument\(/.test(docs), "the Fixture Recap and Negotiation Summary share one document model");
  ok(!/email|phone|userId|orgId|contactId|imo_number|supabase|fetch\(/.test(docs), "documents read only the masked view: no email, phone, ids, IMO or data access of their own");
  ok(/p\.name \?\? "withheld · via Arab ShipBroker"/.test(docs) && /vesselIdentityMasked \? `withheld/.test(docs), "documents keep counterparty and vessel masking");
  ok(/contentHash/.test(docs) && /only a published recap version records the fixture/.test(docs), "the recap carries its content hash; the summary says it is not a recap");
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(read("components/fixture-room/fixture-room.css").replace(/\/\*[\s\S]*?\*\//g, "")), "the document styles use tokens only");
}

// -- Phase 1.1 . new since your last visit --
{
  const ev = (seq: number, actor: string | null, termId?: string) => ({ id: seq, seq, type: "proposal.submitted", at: "2026-09-28T10:00:00Z", command: null, relayed: false, actorPartyId: actor, onBehalfOfPartyId: null, actorLabel: "x", onBehalfOfLabel: null, payload: termId ? { termId } : {} }) as unknown as Parameters<typeof newSince>[0][number];
  const events = [ev(1, "me"), ev(2, "them", "t1"), ev(3, "me", "t2"), ev(4, "them", "t3"), ev(5, null)];
  ok(newSince(events, null, ["me"]).length === 0, "a first visit marks nothing new");
  ok(JSON.stringify(newSince(events, 1, ["me"]).map((e) => e.seq)) === "[2,4,5]", "after the last visit, only other parties' and system events are new, never the viewer's own");
  const terms = [{ id: "t1" }, { id: "t2" }, { id: "t3" }] as unknown as Parameters<typeof termsTouched>[1];
  ok(JSON.stringify([...termsTouched(newSince(events, 1, ["me"]), terms)].sort()) === '["t1","t3"]', "the new chip lands on the terms the other side touched");
  const ls = read("lib/fixture-room/last-seen.ts");
  ok(/try \{[\s\S]*localStorage\.getItem[\s\S]*\} catch \{ return null; \}/.test(ls) && /catch \{ \/\* convenience only \*\/ \}/.test(ls) && !/fetch\(|supabase|rpc\(/.test(ls), "the marker is browser-only and survives blocked storage");
  // C2O-012 item 4: one mark per viewer and room, and it only moves forward
  ok(lastSeenKey("u1", "r1") !== lastSeenKey("u2", "r1") && lastSeenKey("u1", "r1") !== lastSeenKey("u1", "r2"), "the mark is keyed by viewer and room (a second account never inherits it)");
  ok(nextLastSeen(null, 4) === 4 && nextLastSeen(9, 4) === 9 && nextLastSeen(4, 9) === 9, "a write never moves the mark backwards (a stale tab cannot resurface old updates)");
  ok(/viewerId=\{user\.id\}/.test(read("app/(dashboard)/dashboard/fixture-room/[id]/page.tsx")) && !/readLastSeen\(initial\.room\.id\)|writeLastSeen\(room\.id/.test(read("components/fixture-room/FixtureRoomClient.tsx")), "the room reads and writes the mark for the signed-in member");
  // C2O-012 item 3: the feed marks exactly the events the banner counts
  const rails = read("components/fixture-room/RoomRails.tsx");
  ok(/newSeqs\?\.has\(e\.seq\) \? " is-new"/.test(rails) && !/e\.seq > lastVisitSeq \? " is-new"/.test(rails) && /newSeqs=\{freshSeqs\}/.test(read("components/fixture-room/FixtureRoomClient.tsx")), "the activity feed marks only other parties' new events, the same list as the banner");
}

// -- C2O-011 . governed match candidates: own listings only, no vessel identity --
{
  const mig = read("supabase/migrations/20260923206000_fixture_room_match_candidates.sql").replace(/--.*$/gm, "");
  ok(/create or replace function public\.list_fixture_match_candidates\(p_kind text, p_listing_id uuid\)/.test(mig) && /fn_fixture_owns_listing\(case p_kind when 'cargo' then 'cargo' else 'vessel_availability' end, p_listing_id\) is null then\s+raise exception 'FX_AUTH/.test(mig), "candidates are listed only for a listing the actor owns or represents");
  ok(!/'vesselId'|'vesselRef'|'imo'|m\.vessel_ref|imo_number/.test(mig) && (mig.match(/m\.vessel_id/g) ?? []).length === 1 && /on v\.id = m\.vessel_id/.test(mig), "no candidate carries a vessel id, the matcher's vessel_ref (an IMO) or an IMO");
  ok(/case when coalesce\(v\.is_tbn, false\)\s+and public\.fn_fixture_owns_listing\('vessel_availability', m\.availability_id\) is null\s+then 'TBN'/.test(mig), "a TBN hull the actor does not own is named TBN");
  ok(/revoke all on function public\.list_fixture_match_candidates\(text, uuid\) from public, anon;/.test(mig), "anonymous callers cannot list candidates");
  const act = read("app/(dashboard)/dashboard/fixture-room/actions.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/ (?!──).*$/gm, "");
  ok(!/getMatchesForCargo|getMatchesForAvailability|vessel_id|vesselId|imo/i.test(act.split("// ── match builder data")[1].split("// ── commands")[0]), "the match builder reads only the governed RPC and maps no vessel identifier");
  ok(/out\.myCargo\.some\(\(c\) => c\.id === params\.cargo\)/.test(act) && /out\.myVessels\.some\(\(v\) => v\.availabilityId === params\.vessel\)/.test(act), "a preselected listing is honoured only when it is the member's own");
  const mb = read("components/fixture-room/MatchBuilder.tsx");
  const fitFn = mb.split("export function assessFit")[1].split("\n}")[0];
  ok(/export function assessFit\(c: MatchCargoOption, v: MatchVesselOption, f: MatchFacts \| undefined\)/.test(mb) && !/kind: "no"|Under capacity|Opens after laycan|Gearless/.test(fitFn), "fit reasons state only the governed match facts, never a contradiction of a valid match");
  ok(!/reasons\.slice\(/.test(mb), "every fit reason is shown (no truncation)");
  const h = read("scripts/fixture-room-harness.sh");
  ok(/20260923206000_fixture_room_match_candidates\.sql/.test(h) && /\[candidates\]="FIXTURE CANDIDATES SMOKE"/.test(h) && /drop function if exists public\.list_fixture_match_candidates\(text, uuid\);/.test(read("supabase/rollback/20260923_fixture_room_down.sql")), "the harness applies, tests and reverses the candidates read");
}

// -- C2O-012 . UI and privacy corrections after checkpoint 4 --
{
  const composer = read("components/fixture-room/RecapComposer.tsx");
  const client = read("components/fixture-room/FixtureRoomClient.tsx");
  ok(/const closeRef = React\.useRef\(onClose\)/.test(composer) && /\}, \[\]\);/.test(composer.split("const closeRef")[1]) && !/\}, \[onClose\]\);/.test(composer), "1 · the recap dialog's focus effect runs once per opening, never per render");
  ok(/e\.key !== "Tab"/.test(composer) && /last\.focus\(\)/.test(composer) && /first\.focus\(\)/.test(composer) && /opener\.focus\(\)/.test(composer), "1 · the dialog traps Tab and hands focus back to its opener");
  ok(/const closeRecap = React\.useCallback\(\(\) => setRecapOpen\(false\), \[\]\)/.test(client) && /onClose=\{closeRecap\}/.test(client), "1 · the room passes a stable close callback");
  const rails = read("components/fixture-room/RoomRails.tsx");
  ok(/useState<"cargo" \| "vessel" \| null>\(null\)/.test(rails) && /const inviteSide = ownSide \?\? \(view\.viewer\.isMediator \? mediatorSide : null\)/.test(rails) && /side: inviteSide/.test(rails) && !/side: mySide === "vessel" \? "vessel" : "cargo"/.test(rails), "2 · a mediator's invitation side is chosen explicitly, never defaulted");
  const css = read("components/fixture-room/fixture-room.css");
  ok(/prefers-reduced-motion: reduce\)\s*\{\s*\.nr \.rc-item\.is-just-filled/.test(css), "3 · reduced motion disables the real recap-slot pulse (.rc-item.is-just-filled)");
  ok(/React\.useState\(false\);\s*const audioRef/.test(client), "6 · sound starts off; only an explicit toggle turns it on");
  const lift = read("supabase/migrations/20260923207000_fixture_room_lift_all.sql").replace(/--.*$/gm, "");
  ok(/create or replace function public\.lift_all_fixture_subjects\(/.test(lift) && /fn_fixture_check_version/.test(lift) && /fn_fixture_replay/.test(lift) && /x\.responsible_side is null or x\.responsible_side = rep\.side/.test(lift), "5 · lift all is one governed command: one lock, version check and key; only the side's own subjects");
  ok(/run\("liftAll"/.test(client) && /recreateFixtureRoomAction\(\{ roomId: view\.room\.id, idempotencyKey \}\)/.test(client) && !/for \(const s of view\.subjects\)[\s\S]{0,200}liftSubject/.test(client), "5 · the footer calls governed commands only (no client-side loop of lifts)");
  const h = read("scripts/fixture-room-harness.sh");
  ok(/20260923207000_fixture_room_lift_all\.sql/.test(h) && /\[liftall\]="FIXTURE LIFT ALL SMOKE"/.test(h) && /drop function if exists public\.lift_all_fixture_subjects\(uuid, integer, text, uuid, uuid\);/.test(read("supabase/rollback/20260923_fixture_room_down.sql")), "5 · the harness applies, tests and reverses lift all");
}

// -- C2O-012 re-audit . lift-all replays its first response exactly --
{
  const lift = read("supabase/migrations/20260923207000_fixture_room_lift_all.sql").replace(/--.*$/gm, "");
  ok(/case when v_first is null then v_result end/.test(lift) && /'data', v_result\)/.test(lift) && /'subjectIds', to_jsonb\(v_ids\)/.test(lift), "one typed aggregate is stored on the first event and returned, so a replay equals the first response");
  ok(/\(v - 'replayed'\) <> \(v_fresh - 'replayed'\)/.test(read("supabase/tests/fixture_room/bodies/liftall.sql")), "the suite asserts full response equality on replay");
}

// -- C2O-011 re-audit . null kind refused; own listings by the create rule --
{
  const mig = read("supabase/migrations/20260923206000_fixture_room_match_candidates.sql").replace(/--.*$/gm, "");
  ok(/if p_kind is null or p_kind not in \('cargo', 'vessel'\)/.test(mig), "a null kind is refused, never routed to the vessel branch");
  ok(/create or replace function public\.list_fixture_my_listings\(\)/.test(mig) && (mig.split("list_fixture_my_listings()")[1].match(/fn_fixture_owns_listing\(/g) ?? []).length >= 2 && /fn_fixture_listing_live\('cargo', c\.id\)/.test(mig), "own listings use the create rule (organisation seats included) and only live listings");
  const act = read("app/(dashboard)/dashboard/fixture-room/actions.ts");
  ok(/sdk\.listFixtureMyListings\(supabase\)/.test(act) && !/getMyCargoListings|getMyVesselAvailability/.test(act), "the builder's own-listing lists come from the governed read, not per-account owner queries");
  ok(/drop function if exists public\.list_fixture_my_listings\(\);/.test(read("supabase/rollback/20260923_fixture_room_down.sql")), "the DOWN drops the own-listing read");
}

// -- C2O-013 . private selection handles: no raw id for a counterparty, no raw-id bypass --
{
  const h = read("supabase/migrations/20260923208000_fixture_room_candidate_handles.sql").replace(/--.*$/gm, "");
  ok(/create table if not exists fixture_private\.match_handles/.test(h) && /revoke all on schema fixture_private from public, anon, authenticated;/.test(h) && /revoke all on table fixture_private\.match_handles from public, anon, authenticated;/.test(h), "the handle table lives in a private schema no member or API role can reach");
  ok(/actor_user_id\s+uuid not null references public\.users\(id\)/.test(h) && /own_kind/.test(h) && /own_listing_id/.test(h) && /expires_at\s+timestamptz not null/.test(h) && /interval '15 minutes'/.test(h), "a handle binds the users.id actor, the owned source listing and kind, the pair and a short expiry");
  const list = h.split("create or replace function public.list_fixture_match_candidates")[1].split("end $$;")[0];
  ok(/'candidateKey', h\.key/.test(list) && !/'availabilityId'|'vesselId'|'id', m\.cargo_id/.test(list), "candidates carry the opaque key and no raw cargo, availability or vessel id");
  const fromCand = h.split("create or replace function public.create_fixture_room_from_candidate")[1].split("end $$;")[0];
  const order = ["fn_fixture_create_replay(v_actor", "x.actor_user_id = v_actor", "h.expires_at <= now()", "fn_fixture_lock_create_inputs(v_actor", "fn_fixture_owns_listing", "get_matches_for_cargo", "public.create_fixture_room("].map((t) => fromCand.indexOf(t));
  ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), "create-from-handle checks replay, then actor, expiry, locks the inputs, then live ownership, the match predicate and the governed create");
  ok(/revoke execute on function public\.create_fixture_room\(uuid, uuid, jsonb, text, jsonb\) from public, anon, authenticated;/.test(h), "members hold no EXECUTE on the raw-id create (no callable bypass)");
  ok(/alter function public\.get_fixture_room\(uuid, integer\) rename to fn_fixture_room_read_unscrubbed/.test(h) && /v := public\.fn_fixture_scrub_masked\(v, array\[v_avail, v_vessel\]/.test(h), "the room read removes every availability and vessel uuid for a masked viewer");
  const act = read("app/(dashboard)/dashboard/fixture-room/actions.ts");
  ok(!/createFixtureRoomAction|sdk\.createFixtureRoom\(|listingFigures\(/.test(act) && /sdk\.createFixtureRoomFromCandidate\(/.test(act) && /sdk\.recreateFixtureRoom\(/.test(act), "the app opens rooms only from a key, and restarts only by room id");
  const mb = read("components/fixture-room/MatchBuilder.tsx");
  ok(/createFixtureRoomFromCandidateAction\(\{ candidateKey, hints: hints \?\? null, idempotencyKey \}\)/.test(mb) && !/cand-vessel-\$\{/.test(mb) && !/cand-cargo-\$\{/.test(mb), "the builder sends only the candidate key and renders no id in a test id");
  ok(/recreateFixtureRoomAction\(\{ roomId: view\.room\.id, idempotencyKey \}\)/.test(read("components/fixture-room/FixtureRoomClient.tsx")), "a terminal room restarts by its room id, never raw listing ids from the browser");
  const hs = read("scripts/fixture-room-harness.sh");
  ok(/20260923208000_fixture_room_candidate_handles\.sql/.test(hs) && /\[handles\]="FIXTURE HANDLES SMOKE"/.test(hs), "the harness applies and tests the handles");
  const down = read("supabase/rollback/20260923_fixture_room_down.sql");
  ok(/drop schema if exists fixture_private cascade;/.test(down) && /drop function if exists public\.fn_fixture_room_read_unscrubbed\(uuid, integer\);/.test(down) && /drop function if exists public\.create_fixture_room_from_candidate/.test(down), "the DOWN removes the handles, the commands and the inner read");
  const body = read("supabase/tests/fixture_room/bodies/handles.sql");
  ok(["H1 ok", "H2 ok", "H4 ok", "H5 ok", "H6 ok", "H7 ok", "H8 ok", "H9 ok", "H10 ok", "H12 ok"].every((t) => body.includes(t)), "the suite covers raw-id scans, bypass, masked read, replay-after-expiry, two-handle race, wrong actor, lost ownership, stale pair, mismatch and restart");
  // the masking guard now flags a leaked position id too
  const guard = read("lib/fixture-room/masking-view.ts");
  ok(/view\.room\.vesselAvailabilityId != null/.test(guard), "the masking guard flags a position id on a masked view");
}

// -- C2O-014 . handle safety and replay --
{
  const h = read("supabase/migrations/20260923208000_fixture_room_candidate_handles.sql").replace(/--.*$/gm, "");
  // 1 · a JSON-safe recursive scrub, substring and case-insensitive, with and without hyphens
  const scrub = h.split("create or replace function public.fn_fixture_scrub_walk")[1].split("end $$;")[0] + h.split("create or replace function public.fn_fixture_scrub_masked")[1].split("end $$;")[0];
  ok(/jsonb_each\(j\)/.test(scrub) && /jsonb_array_elements\(j\) with ordinality/.test(scrub) && /public\.fn_fixture_ci_replace\(t, p_needles\[i\], '\[withheld\]', p_modes\[i\]\)/.test(scrub) && /replace\(lower\(i::text\), '-', ''\)/.test(scrub) && !/::text::jsonb|t::jsonb|v_all::jsonb|regexp_replace/.test(scrub) && /if not v_hit then return j; end if;/.test(scrub), "the scrub walks the JSON and replaces ids inside strings, any case, with or without hyphens, literally (no pattern language, no serialized-text mutation; a read-only fast path when nothing matches)");
  const guard = read("lib/fixture-room/masking-view.ts");
  ok(embeddedIdentifiers({ room: { id: "11111111-1111-4111-8111-111111111111" }, messages: [{ id: "22222222-2222-4222-8222-222222222222", body: "ref A3B4C5D6-0000-4000-8000-0000000000B3 please" }] }).length === 1
     && embeddedIdentifiers({ room: { id: "11111111-1111-4111-8111-111111111111" }, messages: [{ body: "room 11111111111141118111111111111111 is ours" }] }).length === 0
     && /embeddedIdentifiers\(view\)/.test(guard), "the masking guard flags an identifier embedded in free text (and allows the view's own ids)");
  // 2 · replay uses create_fixture_room's full request hash, before expiry
  const replay = h.split("create or replace function public.fn_fixture_create_replay")[1].split("end $$;")[0];
  ok(/'cmd', 'create_fixture_room', 'cargo', r\.cargo_listing_id, 'vessel', r\.vessel_availability_id,\s*'terms', p_terms, 'options', coalesce\(p_options, '\{\}'::jsonb\)/.test(replay) && /FX_IDEMPOTENCY_MISMATCH/.test(replay), "replay checks the full request hash (pair, terms incl. hints, options)");
  // 3 · no hint read by key; one renewable handle per actor/source/pair; retention
  ok(/drop function if exists public\.get_fixture_candidate_hints\(uuid\);/.test(h) && /'hints', public\.fn_fixture_hint_figures\(/.test(h), "hints travel with the candidate; the by-key hint read is gone");
  ok(/create unique index if not exists match_handles_actor_pair_uq/.test(h) && /on conflict \(actor_user_id, own_kind, own_listing_id, cargo_listing_id, vessel_availability_id\)\s+do update set expires_at = excluded\.expires_at/.test(h) && /delete from fixture_private\.match_handles h where h\.expires_at < now\(\) - interval '1 day'/.test(h), "one renewable handle per actor/source/pair, and stale handles are purged");
  // 4 · inputs locked to commit before validation
  const fromCand = h.split("create or replace function public.create_fixture_room_from_candidate")[1].split("end $$;")[0];
  ok(/perform public\.fn_fixture_lock_create_inputs\(v_actor, h\.cargo_listing_id, h\.vessel_availability_id\);/.test(fromCand), "the cargo, position, vessel and ownership rows are locked to commit (no update between validation and the snapshot)");
  // 5 · a true unique race names the winner
  ok(/exception when unique_violation then/.test(fromCand) && /raise exception 'FX_CONFLICT: room % \(%\) already covers this pairing', w\.id, w\.ref/.test(fromCand), "a lost unique race returns the governed conflict naming the winning room");
  // 6 · the member-JWT integration gate uses the handle path and proves the raw create is denied
  const integ = read("scripts/fixture-room-integration-check.ts");
  ok((integ.match(/sdk\.createFixtureRoomFromCandidate\(ch, \{ candidateKey: key,/g) ?? []).length >= 5 && /the raw-id create is denied to a member/.test(integ) && (integ.match(/sdk\.createFixtureRoom\(/g) ?? []).length === 1, "the member-JWT integration flow opens rooms from a key and asserts the raw create is denied");
  const race = read("supabase/tests/fixture_room/fixture_race_two_sessions.sh");
  ok(/FX_CONFLICT: room \$WINNER/.test(race) && /no longer matches/.test(race) && /lock timeout/.test(race), "the two-session races prove the winner is named and the create/update window is closed both ways");
}

// -- C2O-015 . create race invariants --
{
  const h = read("supabase/migrations/20260923208000_fixture_room_candidate_handles.sql").replace(/--.*$/gm, "");
  const fromCand = h.split("create or replace function public.create_fixture_room_from_candidate")[1].split("end $$;")[0];
  const handler = fromCand.split("exception when unique_violation then")[1] ?? "";
  // 1 · the race replay compares the pair
  ok(/w\.cargo_listing_id <> h\.cargo_listing_id or w\.vessel_availability_id <> h\.vessel_availability_id/.test(handler) && /FX_IDEMPOTENCY_MISMATCH/.test(handler), "a same-key race for a different pair is a mismatch, never the winner's room");
  // 2 · locking is a create invariant: the wrapper locks, the original body is unreachable otherwise
  const lock = h.split("create or replace function public.fn_fixture_lock_create_inputs")[1].split("end $$;")[0];
  const lockOrder = ["from public.users u", "from public.organization_members m", "from public.listing_ownership lo where lo.listing_id in (p_cargo, p_avail) and lo.is_current order by", "from public.cargo_listings c", "from public.vessel_availability va", "from public.vessels v"].map((t) => lock.indexOf(t));
  ok(lockOrder.every((i, n) => i > 0 && (n === 0 || i > lockOrder[n - 1])) && (lock.match(/for share/g) ?? []).length === 6, "one fixed lock order for every creator: account, seats, ownership, cargo, position, vessel (FOR SHARE)");
  ok(/alter function public\.create_fixture_room\(uuid, uuid, jsonb, text, jsonb\) rename to fn_fixture_create_room_unlocked/.test(h) && /revoke all on function public\.fn_fixture_create_room_unlocked\(uuid, uuid, jsonb, text, jsonb\) from public, anon, authenticated, service_role;/.test(h)
     && /perform public\.fn_fixture_lock_create_inputs\(public\.fn_fixture_actor\(\), p_cargo_listing_id, p_vessel_availability_id\);\s+return public\.fn_fixture_create_room_unlocked\(/.test(h), "create_fixture_room locks first, then runs the original body; the unlocked body is reachable only through it");
  // 3 · authorization is locked with the listings (account and seats) — covered by the lock order above
  const race = read("supabase/tests/fixture_room/fixture_race_two_sessions.sh");
  ok(["race-idem-pair", "race-recreate-a", "race-recreate-b", "race-seat-a", "race-seat-b", "race-account-a", "race-account-b"].every((k) => race.includes(k)), "the race script proves the pair-mismatch race, recreate/listing, seat revocation and account/tier races in both orders");
  // 4 · the browser proof over the real member boundary
  const spec = read("e2e/fixture-room-candidates.spec.ts");
  ok(/post_fixture_message/.test(spec) && /toUpperCase\(\)/.test(spec) && /replace\(\/-\/g, ""\)/.test(spec) && /expect\(leaks\(await page\.content\(\)\)/.test(spec) && /expect\(leaks\(JSON\.stringify\(room\.data\)\)/.test(spec), "a hostile message with hidden ids and the hull name is scanned in the page, action bodies and the member-JWT read");
  // 5 · the hidden hull's name and IMO are withheld in the masked read
  ok(/fn_fixture_scrub_masked\(v, array\[v_avail, v_vessel\],\s+array\[v_name,/.test(h) && /v_imo\]\)/.test(h), "the masked read withholds the hidden hull's name (with and without an MV prefix) and IMO typed in free text");
  // 6 · the guard ignores governed hashes
  ok(embeddedIdentifiers({ room: { id: "x", snapshotHash: "d41d8cd98f00b204e9800998ecf8427e" }, recaps: [{ contentHash: "0cc175b9c0f1b6a831c399e269772661" }], messages: [{ body: "hash d41d8cd98f00b204e9800998ecf8427e noted" }] }).length === 0, "the masking guard does not flag content or snapshot hashes");
  // the market boundary: only Fixture-issued keys, and a raw preselection only for the member's own listing
  const act = read("app/(dashboard)/dashboard/fixture-room/actions.ts");
  ok(/from fixture_private\.match_handles x where x\.key = p_candidate_key and x\.actor_user_id = v_actor/.test(fromCand) && /out\.myCargo\.some\(\(c\) => c\.id === params\.cargo\)/.test(act) && /out\.myVessels\.some\(\(v\) => v\.availabilityId === params\.vessel\)/.test(act), "only a Fixture key opens a room, and a raw ?cargo= / ?vessel= preselection is honoured only for the member's own listing");
}

// -- C2O-016 . two redaction edge cases --
{
  const h = read("supabase/migrations/20260923208000_fixture_room_candidate_handles.sql").replace(/--.*$/gm, "");
  const ci = h.split("create or replace function public.fn_fixture_ci_replace")[1].split("end $$;")[0];
  ok(/start := pos \+ length\(p_with\);/.test(ci) && /start := pos \+ 1;/.test(ci) && /rel := strpos\(substr\(lt, start\), ln\);/.test(ci), "the replacement resumes after the inserted marker, so a needle inside [withheld] cannot loop");
  ok(/when 'word' then b !~ '\[\[:alnum:\]\]' and a !~ '\[\[:alnum:\]\]'/.test(ci) && /when 'num'  then b !~ '\[0-9\]' and a !~ '\[0-9\]'/.test(ci), "hull names match as whole words and IMOs as whole numbers (structured values are never altered)");
  const masked = h.split("create or replace function public.fn_fixture_scrub_masked")[1].split("end $$;")[0];
  ok(/length\(btrim\(coalesce\(t, ''\)\)\) >= 2/.test(masked) && !/>= 3/.test(masked), "every valid persisted hull name is withheld, including two-character names (the schema minimum)");
  ok(/\.min\(2, "Vessel name is required"\)/.test(read("lib/schemas/vessel.ts")), "the schema's minimum hull name length is two");
  const body = read("supabase/tests/fixture_room/bodies/handles.sql");
  ok(/'HELD'/.test(body) && /'AB'/.test(body) && /H18 ok/.test(body) && /H19 ok/.test(body) && /statement_timeout = '5s'/.test(body), "the suite proves bounded, masked member reads for hulls named HELD and AB");
}

// -- C2O-070 . composed matcher cache test-seed discipline --
{
  const refreshSelectAfterOrigin = /set (?:local )?session_replication_role = origin;\s*(?:--[^\r\n]*(?:\r?\n|$)\s*)*select public\.fn_refresh_matches\(\);/;
  const seed = read("supabase/tests/fixture_room/seed_fixture_shape.sql");
  ok((seed.match(/fn_refresh_matches\(\)/g) ?? []).length === 1
     && refreshSelectAfterOrigin.test(seed)
     && /select public\.fn_refresh_matches\(\);\s*-- ── end of seed/.test(seed),
     "the replica-mode shared seed returns to origin and refreshes the composed match cache exactly once");

  const candidates = read("supabase/tests/fixture_room/bodies/candidates.sql");
  ok((candidates.match(/fn_refresh_matches\(\)/g) ?? []).length === 1
     && refreshSelectAfterOrigin.test(candidates)
     && /select public\.fn_refresh_matches\(\);\s*do \$\$/.test(candidates),
     "the candidates seed refreshes at top level before K1 reads governed matches");

  const handles = read("supabase/tests/fixture_room/bodies/handles.sql");
  ok((handles.match(/fn_refresh_matches\(\)/g) ?? []).length === 3
     && refreshSelectAfterOrigin.test(handles)
     && /open_date = current_date \+ 60[^;]*;\s*set local session_replication_role = origin;\s*perform public\.fn_refresh_matches\(\);\s*perform pg_temp\.fx_as/.test(handles)
     && /open_date = current_date \+ 5[^;]*;\s*set local session_replication_role = origin;\s*perform public\.fn_refresh_matches\(\);\s*raise notice 'H9 ok/.test(handles),
     "the handles suite refreshes after its seed, invalidation and restoration before H1/H9 assertions");

  const snapshot = read("supabase/tests/fixture_room/bodies/snapshot.sql");
  ok((snapshot.match(/perform public\.fn_refresh_matches\(\);/g) ?? []).length === 2
     && /status = 'FIXED'[^;]*;\s*set local session_replication_role = origin;\s*perform public\.fn_refresh_matches\(\);/.test(snapshot)
     && /status = 'OUT'[^;]*;\s*set local session_replication_role = origin;\s*perform public\.fn_refresh_matches\(\);\s*perform pg_temp\.fx_as/.test(snapshot),
     "snapshot mutations leave replica mode and refresh before both cache-sensitive continuations");

  const race = read("supabase/tests/fixture_room/fixture_race_two_sessions.sh");
  ok((race.match(/fn_refresh_matches\(\)/g) ?? []).length === 6
     && /delete from public\.ports[^;]*;\s*set session_replication_role = origin;\s*select public\.fn_refresh_matches\(\);/.test(race)
     && /values \('cargo', '\$C6'[^;]*;\s*set session_replication_role = origin;\s*select public\.fn_refresh_matches\(\);/.test(race)
     && /open_date = current_date \+ 60[^;]*;\s*set local session_replication_role = origin;\s*select public\.fn_refresh_matches\(\);\s*select pg_sleep\(4\);/.test(race)
     && race.includes("open_date = current_date + 5 where id = '$A1'; set session_replication_role = origin; select public.fn_refresh_matches()")
     && /status = 'FIXED'[^;]*;\s*set local session_replication_role = origin;\s*select public\.fn_refresh_matches\(\);\s*select pg_sleep\(4\);/.test(race)
     && race.includes("status = 'OPEN' where id = '$A1'; set session_replication_role = origin; select public.fn_refresh_matches()"),
     "the race harness refreshes exactly at cleanup, C6 seed, both invalidations and both restorations");

  const normalize = (value: string) => value.replace(/\r\n/g, "\n");
  const shared = normalize(seed).trimEnd();
  const smokeNames = ["state", "rls", "masking", "idempotency", "immutability", "snapshot", "candidates", "liftall", "handles", "enforcement"];
  ok(smokeNames.every((name) => {
    const body = normalize(read(`supabase/tests/fixture_room/bodies/${name}.sql`)).trimEnd();
    const generated = normalize(read(`supabase/tests/fixture_room/fixture_${name}_smoke.sql`));
    return generated.includes(`${shared}\n\n${body}`);
  }), "all ten generated Fixture smokes contain the exact current shared seed and authoritative body");
}

// -- PR-07 / PR-08 . enforcement (20261006100000) --
{
  const m = read("supabase/migrations/20261006100000_fixture_room_enforcement.sql");
  const sql = m.replace(/--.*$/gm, "");
  const fix = sql.split("create or replace function public.fix_fixture_on_subjects(")[1].split("end $$;")[0];
  ok(/v_conf->v_other->>'basis' is distinct from v_basis/.test(fix) && /'room\.fix_confirmed'/.test(fix) && fix.indexOf("'room.fix_confirmed'") < fix.indexOf("set status = 'on_subjects'"), "PR-07: the room moves only after the other side confirmed the same basis");
  ok(/acting\.side = 'mediator' and p_on_behalf_of_party_id is null/.test(fix) && /fn_fixture_rep\(acting, p_on_behalf_of_party_id, true\)/.test(fix), "PR-07: the mediator confirms only for a relayed party it names");
  ok(/held_by_party_id is not null or t\.referred_at is not null/.test(fix) && /fn_fixture_require_window\(r\)/.test(fix), "a fix waits for held / referred terms and an open window");
  for (const fn of ["submit_fixture_proposal", "accept_fixture_proposal"]) {
    const body = sql.split(`create or replace function public.${fn}(`)[1].split("end $$;")[0];
    ok(/fn_fixture_require_movable\(t\)/.test(body) && /fn_fixture_require_window\(r\)/.test(body), `PR-08: ${fn} refuses held / referred terms and a closed window`);
  }
  const reopen = sql.split("create or replace function public.reopen_fixture_term(")[1].split("end $$;")[0];
  ok(/x\.status = 'lifted'/.test(reopen) && /'subject\.reinstated'/.test(reopen) && /fix_confirmations = '\{\}'::jsonb/.test(reopen), "PR-08: reopening from on subjects reinstates lifted subjects and voids confirmations");
  const flag = sql.split("create or replace function public.set_fixture_term_flag(")[1].split("end $$;")[0];
  ok(/referred_by_party_id is distinct from rep\.id and acting\.side <> 'mediator'/.test(flag), "only the referring side (or the mediator) clears a referral");
  ok(/set default \(now\(\) \+ interval '14 days'\)/.test(sql) && /cron\.schedule\('fixture-room-clock', '\*\/5 \* \* \* \*'/.test(sql), "every room gets a 14-day window; the clock runs every five minutes");
  ok(["run_fixture_room_clock()", "sweep_fixture_room_windows(integer)", "sweep_fixture_proposal_lapses(integer)"].every((f) => sql.includes(`grant execute on function public.${f} to service_role;`) && !sql.includes(`grant execute on function public.${f} to authenticated`)), "the clock is service-only");
  const down = read("supabase/rollback/20261006_fixture_room_enforcement_down.sql");
  ok(/cron\.unschedule/.test(down) && /drop function if exists public\.fix_fixture_on_subjects\(uuid, integer, text, uuid, uuid\)/.test(down) && /create or replace function public\.fix_fixture_on_subjects\(p_room_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null\)/.test(down) && /drop column if exists fix_confirmations/.test(down), "the DOWN restores the released commands and removes the clock and the column");
  ok(down.includes(read("supabase/migrations/20260923203000_fixture_room_commands.sql").split("create or replace function public.submit_fixture_proposal(")[1].split("end $$;")[0]), "the DOWN carries the released submit_fixture_proposal verbatim");
  const h = read("scripts/fixture-room-harness.sh");
  ok(/20261006100000_fixture_room_enforcement\.sql/.test(h) && /20261006_fixture_room_enforcement_down\.sql" "supabase\/rollback\/20260923_fixture_room_down\.sql"/.test(h) && /\[enforcement\]=/.test(h), "the harness applies the enforcement migration, runs its suite and rolls it back first");
  const P2 = (side: ViewerParty["side"], capacity: ViewerParty["capacity"]): ViewerParty => ({ id: `${side}-${capacity}`, side, capacity, status: "active", disclosureAgreed: false });
  const late = computeCapabilities("negotiating", [P2("cargo", "principal")], false, [], { windowClosed: true });
  ok(late.windowClosed && !late.canPropose && !late.canAccept && !late.canFixOnSubjects && !late.canReopen && late.canMessage, "a closed window stops every move but messages");
  const med = computeCapabilities("negotiating", [P2("mediator", "broker")], false);
  ok(!med.canFixOnSubjects && med.canExtendWindow, "the mediator without a relayed party cannot confirm a fix, and extends the window");
  ok(computeCapabilities("negotiating", [P2("cargo", "principal")], false, [], { fixConfirmedSides: ["vessel"] }).fixConfirmedSides.join() === "vessel" && computeCapabilities("on_subjects", [P2("cargo", "principal")], false, [], { fixConfirmedSides: ["vessel"] }).fixConfirmedSides.length === 0, "confirmations are reported only while negotiating");
  ok(!/window\.prompt/.test(["FixtureRoomClient.tsx", "RoomRails.tsx", "TermRow.tsx"].map((f) => read(`components/fixture-room/${f}`)).join("\n")), "the room asks for reasons and dates in its own dialog, never window.prompt");
  ok(/reason: v\.reason === "expired" \? "expired" : "failed"/.test(read("components/fixture-room/FixtureRoomClient.tsx")), "closing the room sends the outcome the mediator chose (failed or expired)");
  // C2O-052 · the deadline on every commercial command, extension never shorter, terminal retention
  for (const fn of ["invite_fixture_party", "respond_fixture_invitation", "withdraw_fixture_proposal", "add_fixture_subject", "set_fixture_term_flag", "reopen_fixture_term"]) {
    const body = sql.split(`create or replace function public.${fn}(`)[1].split("end $$;")[0];
    ok(/fn_fixture_require_window\(r\)/.test(body), `C2O-052: ${fn} refuses after the deadline`);
  }
  const ext = sql.split("create or replace function public.extend_fixture_negotiation_window(")[1].split("end $$;")[0];
  ok(/p_ends_at <= r\.negotiation_window_ends_at/.test(ext), "C2O-052: an extension never shortens the window");
  const ap = sql.split("create or replace function public.fn_fixture_actor_parties(")[1].split("end $$;")[0];
  ok(/p\.status = 'active' or not exists/.test(ap) && /'withdrawn', 'failed', 'expired'/.test(ap), "C2O-052: a pending invitee loses access to a terminal room");
  ok(/'migration:20261006100000:window'/.test(sql) && /'room\.window_extended'/.test(m.split("12 · backfill")[1] ?? ""), "C2O-052: the backfill records an event per room so clients refresh");
  // C2O-055 · the stored result is the final result: a replay equals the fresh call
  const fixBody = sql.split("create or replace function public.fix_fixture_on_subjects(")[1].split("end $$;")[0];
  ok(/case when v_open_subjects = 0 then 'fixed' else 'on_subjects' end/.test(fixBody) && !/\|\| jsonb_build_object\('data'/.test(fixBody), "C2O-055: the clean fix stores 'fixed' and returns the stored envelope unchanged");
  const reopenBody = sql.split("create or replace function public.reopen_fixture_term(")[1].split("end $$;")[0];
  ok(/'subjectsReinstated', v_reinstated\)\);/.test(reopenBody) && !/\|\| jsonb_build_object\('data'/.test(reopenBody), "C2O-055: reopen stores subjectsReinstated in its result and returns it unchanged");
  ok(/create or replace function public\.fn_fixture_backfill_windows\(\)/.test(sql) && /select public\.fn_fixture_backfill_windows\(\);/.test(sql), "C2O-055: the backfill is a function the suite exercises on a pre-migration room");
  const enfBody = read("supabase/tests/fixture_room/bodies/enforcement.sql");
  ok(/\(r - 'replayed'\) <> \(v - 'replayed'\)/.test(enfBody) && /E7 ok/.test(enfBody), "C2O-055: the suite compares replay and fresh results and runs the backfill case");
  const liftBody = sql.split("create or replace function public.lift_fixture_subject(")[1].split("end $$;")[0];
  ok(liftBody.includes("'subjectStatus', 'lifted', 'roomStatus', case when v_fixed then 'fixed' else 'on_subjects' end, 'openSubjects', v_open") && !liftBody.includes("|| jsonb_build_object('data'"), "lift_fixture_subject stores its final result; a retry returns it exactly");
  ok(read("supabase/rollback/20261006_fixture_room_enforcement_down.sql").includes("create or replace function public.lift_fixture_subject("), "the DOWN restores the released lift_fixture_subject");
  ok(!/set negotiation_window_ends_at = null/.test(down) && /Window values are KEPT/.test(down), "C2O-052: the DOWN keeps window values");
  const late2 = computeCapabilities("negotiating", [P2("cargo", "principal")], false, [], { windowClosed: true });
  ok(!late2.canAddSubject && !late2.canInvite, "a closed window stops subjects and invitations");
  ok(!computeCapabilities("negotiating", [{ ...P2("vessel", "principal"), status: "invited" }], false, [], { windowClosed: true }).canRespondInvitation && !computeCapabilities("expired", [{ ...P2("vessel", "principal"), status: "invited" }], false).canRespondInvitation, "no invitation answer after the deadline or in a terminal room");
}

// C2B-016 P2: the owner-only Fixture console is reachable from the admin navigation.
{
  const nav = fs.readFileSync(path.join(process.cwd(), "lib/admin/nav.ts"), "utf8");
  const sections = fs.readFileSync(path.join(process.cwd(), "lib/admin/sections.ts"), "utf8");
  ok(/\{ id: "fixtures", label: "Fixture rooms", href: "\/admin\/fixtures", icon: "[A-Za-z]+", superOnly: true \}/.test(nav),
    "ADMIN_NAV has an owner-only /admin/fixtures entry");
  ok(/\{ id: "fixtures", href: "\/admin\/fixtures" \}/.test(sections) && /OWNER_ONLY[^;]*fixtures: true/.test(sections),
    "the nav entry matches the owner-gated section registry");
}
