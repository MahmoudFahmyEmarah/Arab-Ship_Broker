/**
 * Fixture Room · integration check through the REAL API path (23 Sep 2026).
 *
 *   node --import tsx scripts/fixture-room-integration-check.ts
 *
 * Talks to the LOCAL Supabase stack over PostgREST with member JWTs (the way
 * the server actions do), not through psql role switching:
 *   · two members are created (charterer T3, owner T3) with organisations,
 *     a live cargo and a live position, through the service role;
 *   · the charterer opens a room; an outsider is refused; the owner accepts
 *     the invitation; bids and offers cross; a stale version is refused; the
 *     owner accepts; a recap is published and acknowledged; a direct table
 *     read is refused for members (no PostgREST grant);
 *   · every row is removed afterwards.
 *
 * Needs the local stack. Keys come from E2E_SUPABASE_URL,
 * E2E_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_ROLE_KEY, or from
 * `npx supabase status -o env` when those are not set. Refuses any URL that
 * is not localhost.
 */
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as sdk from "@/sdk/app/fixtures";
import { buildTermCatalogue } from "@/lib/fixture-room/terms";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

function localEnv() {
  let url = process.env.E2E_SUPABASE_URL, anon = process.env.E2E_SUPABASE_ANON_KEY, service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1];
    url = url ?? get("API_URL"); anon = anon ?? get("ANON_KEY"); service = service ?? get("SERVICE_ROLE_KEY");
  }
  if (!url || !anon || !service) throw new Error("no local Supabase keys (set E2E_SUPABASE_* or run the local stack)");
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error(`refusing to seed against ${url}: local stack only`);
  return { url, anon, service };
}

const stamp = Date.now().toString(36);
const PASSWORD = "fx-Integration-Passw0rd!";
const ids = { orgCh: "", orgOw: "", uCh: "", uOw: "", uOut: "", cargo: "", vessel: "", avail: "" };

async function seed(admin: SupabaseClient) {
  const mk = async (email: string, role: string, company: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
    const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: `Integration ${role}`, company, role, subscription_tier: "T3", is_active: true });
    if (e2) throw new Error(`users insert: ${e2.message}`);
    return data.user.id;
  };
  ids.uCh = await mk(`fx-ch-${stamp}@fixture.test`, "cargo_owner", `Integration Charterers ${stamp}`);
  ids.uOw = await mk(`fx-ow-${stamp}@fixture.test`, "vessel_owner", `Integration Owners ${stamp}`);
  ids.uOut = await mk(`fx-out-${stamp}@fixture.test`, "broker", `Integration Outsiders ${stamp}`);
  const org = async (name: string, type: string, user: string) => {
    const { data, error } = await admin.from("organizations").insert({ name, org_type: type, desk_contact_name: `${type} desk` }).select("id").single();
    if (error) throw new Error(`org: ${error.message}`);
    const { error: e2 } = await admin.from("organization_members").insert({ org_id: data.id, user_id: user, member_role: "admin", is_current: true, status: "active" });
    if (e2) throw new Error(`member: ${e2.message}`);
    return data.id as string;
  };
  ids.orgCh = await org(`Integration Charterers ${stamp}`, "charterer", ids.uCh);
  ids.orgOw = await org(`Integration Owners ${stamp}`, "owner", ids.uOw);
  await admin.from("ports").upsert([
    { locode: "ZZFXA", trade_name: "Fixture Load Port", country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    { locode: "ZZFXB", trade_name: "Fixture Disch Port", country: "Turkey", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
  ], { onConflict: "locode", ignoreDuplicates: true });
  const today = new Date();
  const d = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const { data: c, error: ce } = await admin.from("cargo_listings").insert({
    ref: `FXI-${stamp}`, status: "IN", review_status: "APPROVED", cargo_type: "Dry Bulk", commodity_name: "Wheat, Bulk", is_dg_cargo: false, is_grain_cargo: true,
    qty_min_mt: 25000, qty_max_mt: 27500, load_port_locode: "ZZFXA", load_port_name: "Fixture Load Port", load_zone: "E.MED",
    disch_port_locode: "ZZFXB", disch_port_name: "Fixture Disch Port", disch_zone: "E.MED", laycan_from: d(10), laycan_to: d(20), is_spot: false,
    load_terms: "FIOST", freight_idea_usd_mt: 24.5, commission_pct: 2.5,
  }).select("id, status, review_status").single();
  if (ce) throw new Error(`cargo: ${ce.message}`);
  ids.cargo = c.id;
  // the submission router may park a new listing for review; the integration seed wants it live
  await admin.from("cargo_listings").update({ status: "IN", review_status: "APPROVED" }).eq("id", ids.cargo);
  const { data: v, error: ve } = await admin.from("vessels").insert({ vessel_name: `INTEGRATION HULL ${stamp.toUpperCase()}`, imo_number: "9000003", vessel_type: "Bulk Carrier", dwt_grain: 30000, build_year: 2012, flag: "Malta", is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false, owner_company: `Integration Owners ${stamp}`, pic_name: "Capt. Integration", phone: "+30 210 000 0000" }).select("id").single();
  if (ve) throw new Error(`vessel: ${ve.message}`);
  ids.vessel = v.id;
  const { data: a, error: ae } = await admin.from("vessel_availability").insert({ vessel_id: ids.vessel, open_port_locode: "ZZFXA", open_port_name: "Fixture Load Port", open_zone: "E.MED", open_date: d(5), status: "OPEN", review_status: "APPROVED", freight_idea_usd_mt: 26, accepts_part_cargo: false }).select("id").single();
  if (ae) throw new Error(`availability: ${ae.message}`);
  ids.avail = a.id;
  await admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", ids.avail);
  const { error: oe } = await admin.from("listing_ownership").insert([
    { listing_type: "cargo", listing_id: ids.cargo, owner_user_id: ids.uCh, owner_org_id: ids.orgCh, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: ids.avail, owner_user_id: ids.uOw, owner_org_id: ids.orgOw, role: "primary", is_current: true, transfer_reason: "initial_post" },
  ]);
  if (oe) throw new Error(`ownership: ${oe.message}`);
}

function cleanupSql() {
  return `
set session_replication_role = replica;
delete from public.fixture_access_log where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}') or user_id in ('${ids.uCh}','${ids.uOw}','${ids.uOut}');
delete from public.fixture_events where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_recap_versions where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_messages where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_subjects where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
update public.fixture_terms set cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, agreed_proposal_id = null, status = 'open' where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_proposals where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_terms where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_parties where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${ids.cargo}');
delete from public.fixture_rooms where cargo_listing_id = '${ids.cargo}';
delete from public.listing_ownership where listing_id in ('${ids.cargo}', '${ids.avail}');
delete from public.matches where cargo_id = '${ids.cargo}' or vessel_avail_id = '${ids.avail}';
delete from public.vessel_availability where id = '${ids.avail}';
delete from public.vessels where id = '${ids.vessel}';
delete from public.cargo_listings where id = '${ids.cargo}';
delete from public.organization_members where user_id in ('${ids.uCh}','${ids.uOw}','${ids.uOut}');
delete from public.users where id in ('${ids.uCh}','${ids.uOw}','${ids.uOut}');
delete from auth.users where id in ('${ids.uCh}','${ids.uOw}','${ids.uOut}');
delete from public.organizations where id in ('${ids.orgCh}','${ids.orgOw}');
`;
}

async function signIn(url: string, anon: string, email: string): Promise<SupabaseClient> {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

async function main() {
  const { url, anon, service } = localEnv();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  try {
    await seed(admin);
    const ch = await signIn(url, anon, `fx-ch-${stamp}@fixture.test`);
    const ow = await signIn(url, anon, `fx-ow-${stamp}@fixture.test`);
    const out = await signIn(url, anon, `fx-out-${stamp}@fixture.test`);

    console.log("1 · create through the API");
    const created = await sdk.createFixtureRoom(ch, { cargoListingId: ids.cargo, vesselAvailabilityId: ids.avail, terms: buildTermCatalogue(null), idempotencyKey: `int-create-${stamp}` });
    ok(created.ok === true, `charterer creates a room (${created.ok ? created.data.ref : created.message})`);
    if (!created.ok) throw new Error("cannot continue");
    const roomId = created.data.roomId;
    const replay = await sdk.createFixtureRoom(ch, { cargoListingId: ids.cargo, vesselAvailabilityId: ids.avail, terms: buildTermCatalogue(null), idempotencyKey: `int-create-${stamp}` });
    ok(replay.ok === true && replay.replayed, "the same key replays over the API");

    console.log("2 · access");
    const outsider = await sdk.getFixtureRoom(out, roomId).then(() => null).catch((e: sdk.FixtureRequestError) => e.fx);
    ok(!!outsider && outsider.code === "AUTH", `outsider refused (${outsider?.code})`);
    const table = await ch.from("fixture_rooms").select("id").limit(1);
    ok(!!table.error, `direct table read refused for a member (${table.error?.code ?? "no error"} ${table.error?.message ?? ""})`);
    const events = await ch.from("fixture_events").select("id").limit(1);
    ok(!!events.error, "direct event-ledger read refused for a member");
    const view = await sdk.getFixtureRoom(ch, roomId);
    ok(view.room.status === "invited" && view.viewer.side === "cargo" && view.terms.length === 6, "charterer reads the masked room");
    const ownerParty = view.parties.find((p) => p.side === "vessel" && p.capacity === "principal");
    ok(!!ownerParty && ownerParty.name === null && ownerParty.status === "invited" && !("orgId" in ownerParty), "owner is a label-only invited principal");
    ok(!JSON.stringify(view).includes(ids.orgOw) && !JSON.stringify(view).includes("+30 210"), "no owner org id or phone in the payload");

    console.log("3 · negotiation");
    const owBefore = await sdk.getFixtureRoom(ow, roomId);
    ok(owBefore.viewer.capabilities.canRespondInvitation && !owBefore.viewer.capabilities.canPropose, "owner may only respond while invited");
    const accepted = await sdk.respondFixtureInvitation(ow, { roomId, accept: true, expectedVersion: owBefore.room.version, idempotencyKey: `int-accept-${stamp}` });
    ok(accepted.ok === true, "owner accepts the invitation");
    const freight = view.terms.find((t) => t.code === "freight")!;
    let v = accepted.ok ? accepted.version : 0;
    const bid = await sdk.submitFixtureProposal(ch, { roomId, expectedVersion: v, idempotencyKey: `int-bid-${stamp}`, termId: freight.id, value: { num: 24.5, currency: "USD" }, comment: "workable" });
    ok(bid.ok === true && bid.data.roomStatus === "negotiating" && bid.data.displayValue === "$24.50/MT", "charterer bids; room negotiating");
    v = bid.ok ? bid.version : v;
    const offer = await sdk.submitFixtureProposal(ow, { roomId, expectedVersion: v, idempotencyKey: `int-offer-${stamp}`, termId: freight.id, value: { num: 26.25 }, expiresInMinutes: 30 });
    ok(offer.ok === true, "owner counters with a 30-minute offer");
    const stale = await sdk.acceptFixtureProposal(ch, { roomId, expectedVersion: v, idempotencyKey: `int-stale-${stamp}`, proposalId: offer.ok ? offer.data.proposalId : "" });
    ok(stale.ok === false && stale.code === "VERSION_CONFLICT" && stale.currentVersion === (offer.ok ? offer.version : -1),
       `a stale expected_version is refused with the current version (got ${stale.ok ? "ok" : `${stale.code} current=${stale.currentVersion} sqlstate=${stale.sqlstate} msg=${stale.message.slice(0, 80)}`}; offer at v${offer.ok ? offer.version : "?"})`);
    const acc = await sdk.acceptFixtureProposal(ch, { roomId, expectedVersion: offer.ok ? offer.version : v, idempotencyKey: `int-accept-freight-${stamp}`, proposalId: offer.ok ? offer.data.proposalId : "" });
    ok(acc.ok === true && acc.data.termStatus === "agreed", "charterer accepts the offer: term agreed");
    const after = await sdk.getFixtureRoom(ch, roomId);
    ok(after.terms.find((t) => t.code === "freight")?.agreed?.displayValue === "$26.25/MT", "one agreed value on the term");

    console.log("4 · recap and inbox");
    const pub = await sdk.publishFixtureRecap(ch, { roomId, expectedVersion: after.room.version, idempotencyKey: `int-recap-${stamp}` });
    ok(pub.ok === true, "recap published");
    const ack = await sdk.acknowledgeFixtureRecap(ow, { roomId, expectedVersion: pub.ok ? pub.version : 0, idempotencyKey: `int-ack-${stamp}`, recapVersionId: pub.ok ? pub.data.recapVersionId : "" });
    ok(ack.ok === true, "owner acknowledges the recap");
    const inbox = await sdk.listFixtureRooms(ow);
    ok(inbox.some((r) => r.id === roomId && r.mySide === "vessel" && r.agreedTerms === 1), "the room is in the owner's inbox from the snapshot");
    const outInbox = await sdk.listFixtureRooms(out);
    ok(!outInbox.some((r) => r.id === roomId), "and not in the outsider's");
    const ver = await sdk.getFixtureRoomVersion(ch, roomId);
    ok(ver === (ack.ok ? ack.version : -1), "the version poll matches the last command");
  } finally {
    try {
      execSync("docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0", { input: cleanupSql(), stdio: ["pipe", "ignore", "ignore"] });
      console.log("  cleanup done");
    } catch (e) {
      console.error("  cleanup failed:", e instanceof Error ? e.message : e);
    }
  }
  console.log(`\nFIXTURE ROOM INTEGRATION: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log("FIXTURE ROOM INTEGRATION: ALL ASSERTIONS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
