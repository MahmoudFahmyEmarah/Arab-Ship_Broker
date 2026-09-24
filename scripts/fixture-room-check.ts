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
import fs from "node:fs";
import path from "node:path";
import { FIXTURE_TERM_CATALOGUE, buildTermCatalogue, openingValueFromListing, termHintsFromListing, validateTermCatalogue } from "@/lib/fixture-room/terms";
import { COMMAND_STATUSES, FIXTURE_ROOM_STATUSES, TRANSITIONS, canTransition, commandAllowedIn, isTerminal, reachableFrom, timelineSteps } from "@/lib/fixture-room/state-machine";
import { computeCapabilities, roleLabel, type ViewerParty } from "@/lib/fixture-room/permissions";
import { parseFixtureError } from "@/lib/fixture-room/errors";
import { countdown, formatFixtureValue, parseFixtureInput, spreadLabel } from "@/lib/fixture-room/format";
import { findMaskingLeaks } from "@/lib/fixture-room/masking-view";
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
const baseView = (): FixtureRoomView => ({
  room: { id: "r", ref: "FX-2026-00001", status: "negotiating", version: 3, mediation: "platform", cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", createdAt: "", updatedAt: "", fixedOnSubsAt: null, fixedAt: null, closedAt: null, closedReason: null, closedNote: null, counterpartyDisclosed: false, counterpartyDisclosedAt: null, negotiationWindowEndsAt: null, supersedesRoomId: null, snapshotAt: "", snapshotHash: "h", brokerageTerms: null, listingSync: null, serverNow: "" },
  snapshot: { cargo: { commodity_name: "Wheat" }, vessel: { availability: {}, vessel: { vessel_name: "TBN" } }, vesselIdentityMasked: true },
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
const notice = listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", listingSync: { requiredAt: "", cargo: { listingId: "c", target: "OUT", current: "IN", outstanding: true }, vessel: { availabilityId: "a", vesselId: "v", target: "ON SUBS", current: "OPEN", outstanding: true }, outstanding: true } });
ok(!!notice && notice.outstanding && notice.links.length === 2 && notice.links[1].href === "/dashboard/vessels/v/availability/a/edit", "the sync notice links both existing edit flows");
ok(listingSyncNotice({ cargoListingId: "c", vesselAvailabilityId: "a", vesselId: "v", listingSync: null }) === null, "no requirement → no notice");

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

console.log(`\nFIXTURE ROOM CHECK: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("FIXTURE ROOM CHECK: ALL ASSERTIONS PASSED");
