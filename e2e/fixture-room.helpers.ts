/**
 * Fixture Room · browser-suite seeding (Fixture Room-only file, 23 Sep 2026).
 *
 * The shared global-setup seeds ADMIN seats; a fixture needs two real MEMBER
 * seats on opposite sides. This helper creates them on the LOCAL stack only
 * (a charterer with a live cargo, an owner with a live position that the
 * platform's own match rules pair with it), signs them in through the real
 * login form, and removes everything afterwards.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

export const PASSWORD = "e2e-Fixture-Passw0rd!";

export interface FixtureSeed {
  stamp: string;
  charterer: { email: string; userId: string; orgId: string };
  owner: { email: string; userId: string; orgId: string };
  cargoId: string;
  vesselId: string;
  vesselImo: string;
  /** the named (not TBN) hull's display name, how a test finds its candidate card (no id is in the page, C2O-013) */
  vesselName: string;
  availabilityId: string;
  /** a TBN hull of the owner that also matches the cargo (C2O-011): its name and id must never reach the cargo side */
  tbn: { vesselId: string; name: string; availabilityId: string };
}

function localKeys() {
  let url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    service = out.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)?.[1];
    url = out.match(/^API_URL="?([^"\n]+)"?/m)?.[1] ?? url;
  }
  if (!service) throw new Error("no local service role key (E2E_SUPABASE_SERVICE_ROLE_KEY or `supabase status`)");
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error(`refusing to seed members against ${url}`);
  return { url, service };
}

export async function seedFixture(): Promise<FixtureSeed> {
  const { url, service } = localKeys();
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const stamp = Date.now().toString(36);
  const testImo = String(1_000_000 + (Number.parseInt(stamp, 36) % 9_000_000));
  const mk = async (email: string, role: string, company: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
    const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: `E2E ${role}`, company, role, subscription_tier: "T3", is_active: true });
    if (e2) throw new Error(`users: ${e2.message}`);
    const { data: org, error: e3 } = await admin.from("organizations").insert({ name: company, org_type: role === "cargo_owner" ? "charterer" : "owner", desk_contact_name: "Desk" }).select("id").single();
    if (e3) throw new Error(`org: ${e3.message}`);
    await admin.from("organization_members").insert({ org_id: org.id, user_id: data.user.id, member_role: "admin", is_current: true, status: "active" });
    // the account's profile row lets the dashboard shell show the workspace
    await admin.from("profiles").insert({ account_id: data.user.id, profile_type: role === "cargo_owner" ? "cargo" : "vessel", display_name: `E2E ${role}`, is_active: true });
    return { email, userId: data.user.id as string, orgId: org.id as string };
  };
  const charterer = await mk(`e2e-fx-ch-${stamp}@arabshipbroker.test`, "cargo_owner", `E2E Charterers ${stamp}`);
  const owner = await mk(`e2e-fx-ow-${stamp}@arabshipbroker.test`, "vessel_owner", `E2E Owners ${stamp}`);
  await admin.from("ports").upsert([
    { locode: "ZZFXA", trade_name: "Fixture Load Port", country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    { locode: "ZZFXB", trade_name: "Fixture Disch Port", country: "Turkey", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
  ], { onConflict: "locode", ignoreDuplicates: true });
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const { data: c, error: ce } = await admin.from("cargo_listings").insert({
    ref: `E2EFX-${stamp}`, status: "IN", review_status: "APPROVED", cargo_type: "Dry Bulk", commodity_name: "E2E Wheat, Bulk", is_dg_cargo: false, is_grain_cargo: true,
    qty_min_mt: 25000, qty_max_mt: 27500, load_port_locode: "ZZFXA", load_port_name: "Fixture Load Port", load_zone: "E.MED",
    disch_port_locode: "ZZFXB", disch_port_name: "Fixture Disch Port", disch_zone: "E.MED", laycan_from: d(10), laycan_to: d(20), is_spot: false, load_terms: "FIOST", freight_idea_usd_mt: 24.5,
  }).select("id").single();
  if (ce) throw new Error(`cargo: ${ce.message}`);
  await admin.from("cargo_listings").update({ status: "IN", review_status: "APPROVED" }).eq("id", c.id);
  const { data: v, error: ve } = await admin.from("vessels").insert({ vessel_name: `E2E HULL ${stamp.toUpperCase()}`, imo_number: testImo, vessel_type: "Bulk Carrier", dwt_grain: 30000, build_year: 2012, flag: "Malta", is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false }).select("id").single();
  if (ve) throw new Error(`vessel: ${ve.message}`);
  const { data: a, error: ae } = await admin.from("vessel_availability").insert({ vessel_id: v.id, open_port_locode: "ZZFXA", open_port_name: "Fixture Load Port", open_zone: "E.MED", open_date: d(5), status: "OPEN", review_status: "APPROVED", freight_idea_usd_mt: 26, accepts_part_cargo: false }).select("id").single();
  if (ae) throw new Error(`availability: ${ae.message}`);
  await admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", a.id);
  const tbnName = `E2E SECRET HULL ${stamp.toUpperCase()}`;
  const { data: tv, error: tve } = await admin.from("vessels").insert({ vessel_name: tbnName, imo_number: null, vessel_type: "Bulk Carrier", dwt_grain: 29000, build_year: 2016, flag: "Liberia", is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false, is_tbn: true }).select("id").single();
  if (tve) throw new Error(`tbn vessel: ${tve.message}`);
  const { data: ta, error: tae } = await admin.from("vessel_availability").insert({ vessel_id: tv.id, open_port_locode: "ZZFXA", open_port_name: "Fixture Load Port", open_zone: "E.MED", open_date: d(7), status: "OPEN", review_status: "APPROVED", freight_idea_usd_mt: 27, accepts_part_cargo: false }).select("id").single();
  if (tae) throw new Error(`tbn availability: ${tae.message}`);
  await admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", ta.id);
  const { error: oe } = await admin.from("listing_ownership").insert([
    { listing_type: "cargo", listing_id: c.id, owner_user_id: charterer.userId, owner_org_id: charterer.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: a.id, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: ta.id, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
  ]);
  if (oe) throw new Error(`ownership: ${oe.message}`);
  return { stamp, charterer, owner, cargoId: c.id, vesselId: v.id, vesselImo: testImo, vesselName: `E2E HULL ${stamp.toUpperCase()}`, availabilityId: a.id, tbn: { vesselId: tv.id, name: tbnName, availabilityId: ta.id } };
}

/**
 * A second active seat in the charterer's organisation (re-audit C2O-011 item 3):
 * it did not post the cargo, but represents it through the organisation, so the
 * match builder must offer it. Local stack only; removed by cleanupSeat.
 */
export async function seedOrgSeat(seed: FixtureSeed): Promise<{ email: string; userId: string }> {
  const { url, service } = localKeys();
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const email = `e2e-fx-seat-${seed.stamp}@arabshipbroker.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: "E2E second seat", company: `E2E Charterers ${seed.stamp}`, role: "cargo_owner", subscription_tier: "T3", is_active: true });
  if (e2) throw new Error(`users (seat): ${e2.message}`);
  const { error: e3 } = await admin.from("organization_members").insert({ org_id: seed.charterer.orgId, user_id: data.user.id, member_role: "broker", is_current: true, status: "active" });
  if (e3) throw new Error(`seat membership: ${e3.message}`);
  await admin.from("profiles").insert({ account_id: data.user.id, profile_type: "cargo", display_name: "E2E second seat", is_active: true });
  return { email, userId: data.user.id as string };
}

export function cleanupSeat(seat: { userId: string }) {
  const sql = `
set session_replication_role = replica;
delete from public.profiles where account_id = '${seat.userId}';
delete from public.organization_members where user_id = '${seat.userId}';
delete from public.users where id = '${seat.userId}';
delete from auth.users where id = '${seat.userId}';
`;
  try {
    execSync("docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0", { input: sql, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // leaving rows behind on a disposable database is not a test failure
  }
}

/**
 * The charterer opens a room on the named hull through the governed path a member has
 * (C2O-013): list the candidates, take the named hull's opaque key, create from it.
 * Members hold no EXECUTE on the raw-id create_fixture_room any more.
 */
export async function openRoomViaApi(seed: FixtureSeed, idempotencyKey: string, terms: unknown, options: Record<string, unknown>): Promise<{ roomId: string; version: number }> {
  const ch = await apiClientAs(seed.charterer.email);
  const list = await ch.rpc("list_fixture_match_candidates", { p_kind: "cargo", p_listing_id: seed.cargoId });
  if (list.error) throw new Error(`list_fixture_match_candidates: ${list.error.message}`);
  const key = (list.data as { candidateKey: string; name: string }[]).find((x) => x.name === seed.vesselName)?.candidateKey;
  if (!key) throw new Error(`the named hull ${seed.vesselName} is not a candidate`);
  const created = await ch.rpc("create_fixture_room_from_candidate", { p_candidate_key: key, p_terms: terms, p_idempotency_key: idempotencyKey, p_options: options });
  if (created.error) throw new Error(`create_fixture_room_from_candidate: ${created.error.message}`);
  const d = created.data as { data: { roomId: string }; version: number };
  return { roomId: d.data.roomId, version: d.version };
}

export interface AdminSeed { email: string; userId: string }

/**
 * A super admin whose session carries the claim the ledger's admin check reads
 * (app_metadata.role = 'admin'), set through the Auth admin API — the shared
 * global setup seeds sub-admins without it. Local stack only; removed by
 * cleanupAdmin.
 */
export async function seedAdmin(stamp: string): Promise<AdminSeed> {
  const { url, service } = localKeys();
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const email = `e2e-fx-adm-${stamp}@arabshipbroker.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, app_metadata: { role: "admin" } });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: "E2E Fixture Admin", company: "Arab ShipBroker", role: "admin", admin_tier: "super", subscription_tier: "T4", is_active: true });
  if (e2) throw new Error(`users (admin): ${e2.message}`);
  return { email, userId: data.user.id as string };
}

export function cleanupAdmin(a: AdminSeed) {
  const sql = `
set session_replication_role = replica;
delete from public.fixture_access_log where user_id = '${a.userId}';
delete from public.users where id = '${a.userId}';
delete from auth.users where id = '${a.userId}';
`;
  try {
    execSync("docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0", { input: sql, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // leaving rows behind on a disposable database is not a test failure
  }
}

/** A supabase-js client signed in as a seeded member, for API calls the browser is not needed for. */
export async function apiClientAs(email: string): Promise<SupabaseClient> {
  const url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let anon = process.env.E2E_SUPABASE_ANON_KEY;
  if (!anon) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    anon = out.match(/^ANON_KEY="?([^"\n]+)"?/m)?.[1];
  }
  if (!anon) throw new Error("no local anon key (E2E_SUPABASE_ANON_KEY or `supabase status`)");
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

export function cleanupFixture(s: FixtureSeed) {
  const sql = `
set session_replication_role = replica;
delete from public.fixture_access_log where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_events where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_recap_versions where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_messages where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_subjects where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
update public.fixture_terms set cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, agreed_proposal_id = null, status = 'open' where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_proposals where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_terms where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_parties where room_id in (select id from public.fixture_rooms where cargo_listing_id = '${s.cargoId}');
delete from public.fixture_rooms where cargo_listing_id = '${s.cargoId}';
delete from public.listing_ownership where listing_id in ('${s.cargoId}', '${s.availabilityId}', '${s.tbn.availabilityId}');
delete from public.matches where cargo_id = '${s.cargoId}' or vessel_avail_id in ('${s.availabilityId}', '${s.tbn.availabilityId}');
delete from public.vessel_availability where id in ('${s.availabilityId}', '${s.tbn.availabilityId}');
delete from public.vessels where id in ('${s.vesselId}', '${s.tbn.vesselId}');
delete from public.cargo_listings where id = '${s.cargoId}';
delete from public.profiles where account_id in ('${s.charterer.userId}', '${s.owner.userId}');
delete from public.organization_members where user_id in ('${s.charterer.userId}', '${s.owner.userId}');
delete from public.users where id in ('${s.charterer.userId}', '${s.owner.userId}');
delete from auth.users where id in ('${s.charterer.userId}', '${s.owner.userId}');
delete from public.organizations where id in ('${s.charterer.orgId}', '${s.owner.orgId}');
`;
  try {
    execSync("docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0", { input: sql, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // leaving rows behind on a disposable database is not a test failure
  }
}

/**
 * The portal shell greets a member with two overlays that intercept clicks:
 * the cookie-consent banner (first visit) and, for a vessel owner with an
 * open position, the position check-in modal. A real member answers them
 * once; so does the test. Both remember the answer for the context.
 */
export async function dismissOverlays(page: Page) {
  const cookie = page.getByRole("dialog", { name: "Cookie consent" });
  if (await cookie.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
    await cookie.getByRole("button", { name: "Accept all" }).click();
    await cookie.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }
  const checkin = page.getByRole("dialog", { name: "Vessel position check-in" });
  if (await checkin.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
    await checkin.getByRole("button", { name: "Remind me later" }).click();
    await checkin.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }
}

/** A fresh context signed in through the real login form, with the shell's overlays answered. */
export async function signInAs(browser: Browser, baseURL: string, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  // The app uses client-side routing after the auth call. Waiting for a page
  // `load` event can miss that transition even when the dashboard is already
  // rendered, so assert the observable URL instead.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 90_000 });
  // Wait for the router transition itself, not only its early URL update.
  // Starting the next navigation while the login transition is still
  // rendering can let its pending router.push win and send the test back to
  // /dashboard after it has requested a Fixture page.
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 90_000 });
  await dismissOverlays(page);
  return { context, page };
}
