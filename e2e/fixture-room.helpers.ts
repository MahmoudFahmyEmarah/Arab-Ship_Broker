/**
 * Fixture Room · browser-suite seeding (23 Sep 2026; hosted-safe 7 Oct 2026, C2O-075 / C2O-078).
 *
 * The shared global-setup seeds ADMIN seats; a fixture needs two real MEMBER seats on opposite sides. This helper
 * creates them (a charterer with a live cargo, an owner with a live position that the platform's own match rules
 * pair with it), signs them in through the real login form, and removes everything afterwards.
 *
 * One target (e2e/e2e-db.ts resolveTarget) is bound for seeding, sign-in and teardown alike: the local stack, or a
 * named staging project whose API and database URL carry the same ref. Every id a seed writes is generated and
 * recorded BEFORE the call that writes it; a seed that fails part-way undoes itself (e2e/e2e-cleanup.ts).
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dbExec, dbQuery, dbTx, isForeignSupabaseRequest, isHostedTarget, resolveTarget } from "./e2e-db";
import { cleanupSql, noneCreated, teardownAll, teardownRows, undoPartialSeed, type Created, type RecoveryClient } from "./e2e-cleanup";

export { dbExec, dbQuery, dbTx, cleanupSql, teardownAll };

/** A run against a hosted project; an unresolvable environment counts as hosted (fail closed). */
export const HOSTED = isHostedTarget();
/**
 * A known password must never sit on a hosted account (C2O-075 P0): a hosted run gets a random password per test
 * process (Playwright creates and signs in a spec's seeds in the same worker, and a restarted worker re-seeds).
 * The local stack keeps the fixed one.
 */
export const PASSWORD = HOSTED ? `e2e-${randomBytes(18).toString("base64url")}-Aa1!` : "e2e-Fixture-Passw0rd!";

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
  /** this run's own ports (random ZY… codes named "E2E Port <stamp>"), created and removed by this seed only */
  ports: { load: string; disch: string };
  portCodes: string[];
}

function keys(): { url: string; service: string; anon: string | null } {
  const t = resolveTarget();
  let service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? null;
  let anon = process.env.E2E_SUPABASE_ANON_KEY ?? null;
  if (t.kind === "local" && (!service || !anon)) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    service ??= out.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)?.[1] ?? null;
    anon ??= out.match(/^ANON_KEY="?([^"\n]+)"?/m)?.[1] ?? null;
  }
  if (!service) throw new Error(t.kind === "local" ? "no local service role key (E2E_SUPABASE_SERVICE_ROLE_KEY or `supabase status`)" : "a hosted run needs E2E_SUPABASE_SERVICE_ROLE_KEY");
  return { url: t.apiUrl, service, anon };
}
const adminClient = () => { const k = keys(); return createClient(k.url, k.service, { auth: { persistSession: false } }); };
const must = (what: string, r: { error: { message: string } | null }) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); };

/** creates an Auth account with a pre-generated id, recorded (id and email) before the call */
async function createAccount(admin: SupabaseClient, created: Created, email: string, attrs: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  created.emails.push(email);
  created.userIds.push(id);
  const { data, error } = await admin.auth.admin.createUser({ id, email, password: PASSWORD, email_confirm: true, ...attrs });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message ?? "no user returned"}`);
  if (data.user.id !== id) { created.userIds.push(data.user.id); throw new Error(`createUser ${email}: the server ignored the pre-generated id`); }
  return id;
}

/** runs a seed; if it fails part-way, what it created is removed (or neutralised) and the failure re-raised */
async function seeded<T>(work: (admin: SupabaseClient, created: Created) => Promise<T>): Promise<T> {
  const admin = adminClient();
  const created = noneCreated();
  try {
    return await work(admin, created);
  } catch (e) {
    return undoPartialSeed(admin as unknown as RecoveryClient, created, e);
  }
}

export async function seedFixture(): Promise<FixtureSeed> {
  return seeded(async (admin, created) => {
    const stamp = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    created.portStamp = stamp;
    const testImo = String(1_000_000 + (Number.parseInt(stamp.slice(-9), 36) % 9_000_000));
    const mk = async (email: string, role: string, company: string) => {
      const userId = await createAccount(admin, created, email);
      must("users", await admin.from("users").insert({ id: userId, supabase_user_id: userId, email, full_name: `E2E ${role}`, company, role, subscription_tier: "T3", is_active: true }));
      const orgId = randomUUID();
      created.orgIds.push(orgId);
      must("org", await admin.from("organizations").insert({ id: orgId, name: company, org_type: role === "cargo_owner" ? "charterer" : "owner", desk_contact_name: "Desk" }));
      must("membership", await admin.from("organization_members").insert({ org_id: orgId, user_id: userId, member_role: "admin", is_current: true, status: "active" }));
      // the account's profile row lets the dashboard shell show the workspace
      must("profile", await admin.from("profiles").insert({ account_id: userId, profile_type: role === "cargo_owner" ? "cargo" : "vessel", display_name: `E2E ${role}`, is_active: true }));
      return { email, userId, orgId };
    };
    const charterer = await mk(`e2e-fx-ch-${stamp}@arabshipbroker.test`, "cargo_owner", `E2E Charterers ${stamp}`);
    const owner = await mk(`e2e-fx-ow-${stamp}@arabshipbroker.test`, "vessel_owner", `E2E Owners ${stamp}`);
    // this run's own ports (C2O-084 P1): random ZY codes named for the run, so two runs never share one and the
    // teardown removes only a port that is listed AND carries this e2e name (a real port can never match)
    const portCode = () => `ZY${[...randomBytes(3)].map((b) => "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[b % 36]).join("")}`;
    const loadPort = portCode();
    let dischPort = portCode();
    while (dischPort === loadPort) dischPort = portCode();
    for (const [locode, side, country] of [[loadPort, "Load", "Egypt"], [dischPort, "Disch", "Turkey"]] as const) {
      created.portCodes.push(locode);
      must(`port ${locode}`, await admin.from("ports").insert({ locode, trade_name: `E2E Port ${stamp} ${side}`, country, zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true }));
    }
    const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const cargoId = randomUUID();
    created.cargoIds.push(cargoId);
    must("cargo", await admin.from("cargo_listings").insert({
      id: cargoId, ref: `E2EFX-${stamp}`, status: "IN", review_status: "APPROVED", cargo_type: "Dry Bulk", commodity_name: "E2E Wheat, Bulk", is_dg_cargo: false, is_grain_cargo: true,
      qty_min_mt: 25000, qty_max_mt: 27500, load_port_locode: loadPort, load_port_name: "Fixture Load Port", load_zone: "E.MED",
      disch_port_locode: dischPort, disch_port_name: "Fixture Disch Port", disch_zone: "E.MED", laycan_from: d(10), laycan_to: d(20), is_spot: false, load_terms: "FIOST", freight_idea_usd_mt: 24.5,
    }));
    must("cargo status", await admin.from("cargo_listings").update({ status: "IN", review_status: "APPROVED" }).eq("id", cargoId));
    const hull = async (name: string, imo: string | null, dwt: number, build: number, flag: string, tbn: boolean, open: number, idea: number) => {
      const vesselId = randomUUID();
      created.vesselIds.push(vesselId);
      must(`vessel ${name}`, await admin.from("vessels").insert({ id: vesselId, vessel_name: name, imo_number: imo, vessel_type: "Bulk Carrier", dwt_grain: dwt, build_year: build, flag, is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false, ...(tbn ? { is_tbn: true } : {}) }));
      const availabilityId = randomUUID();
      created.availabilityIds.push(availabilityId);
      must(`availability ${name}`, await admin.from("vessel_availability").insert({ id: availabilityId, vessel_id: vesselId, open_port_locode: loadPort, open_port_name: "Fixture Load Port", open_zone: "E.MED", open_date: d(open), status: "OPEN", review_status: "APPROVED", freight_idea_usd_mt: idea, accepts_part_cargo: false }));
      must(`availability status ${name}`, await admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", availabilityId));
      return { vesselId, availabilityId };
    };
    const vesselName = `E2E HULL ${stamp.toUpperCase()}`;
    const named = await hull(vesselName, testImo, 30000, 2012, "Malta", false, 5, 26);
    const tbnName = `E2E SECRET HULL ${stamp.toUpperCase()}`;
    const tbn = await hull(tbnName, null, 29000, 2016, "Liberia", true, 7, 27);
    must("ownership", await admin.from("listing_ownership").insert([
      { listing_type: "cargo", listing_id: cargoId, owner_user_id: charterer.userId, owner_org_id: charterer.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
      { listing_type: "vessel_availability", listing_id: named.availabilityId, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
      { listing_type: "vessel_availability", listing_id: tbn.availabilityId, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    ]));
    return {
      stamp, charterer, owner, cargoId, vesselId: named.vesselId, vesselImo: testImo, vesselName, availabilityId: named.availabilityId,
      tbn: { vesselId: tbn.vesselId, name: tbnName, availabilityId: tbn.availabilityId }, ports: { load: loadPort, disch: dischPort }, portCodes: [...created.portCodes],
    };
  });
}

/**
 * A second active seat in the charterer's organisation (re-audit C2O-011 item 3): it did not post the cargo, but
 * represents it through the organisation, so the match builder must offer it. Removed by cleanupSeat.
 */
export async function seedOrgSeat(seed: FixtureSeed): Promise<{ email: string; userId: string }> {
  return seeded(async (admin, created) => {
    const email = `e2e-fx-seat-${seed.stamp}@arabshipbroker.test`;
    const userId = await createAccount(admin, created, email);
    must("users (seat)", await admin.from("users").insert({ id: userId, supabase_user_id: userId, email, full_name: "E2E second seat", company: `E2E Charterers ${seed.stamp}`, role: "cargo_owner", subscription_tier: "T3", is_active: true }));
    must("seat membership", await admin.from("organization_members").insert({ org_id: seed.charterer.orgId, user_id: userId, member_role: "broker", is_current: true, status: "active" }));
    must("seat profile", await admin.from("profiles").insert({ account_id: userId, profile_type: "cargo", display_name: "E2E second seat", is_active: true }));
    return { email, userId };
  });
}

/** Removes the seat in one guarded transaction; throws on failure (spec afterAll hooks wrap it in teardownAll). */
export function cleanupSeat(seat: { userId: string }) {
  teardownRows("e2e seat teardown", { userIds: [seat.userId] });
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
 * A super admin whose session carries the claim the ledger's admin check reads (app_metadata.role = 'admin'), set
 * through the Auth admin API — the shared global setup seeds sub-admins without it. Removed by cleanupAdmin.
 */
export async function seedAdmin(stamp: string): Promise<AdminSeed> {
  return seeded(async (admin, created) => {
    const email = `e2e-fx-adm-${stamp}@arabshipbroker.test`;
    const userId = await createAccount(admin, created, email, { app_metadata: { role: "admin" } });
    must("users (admin)", await admin.from("users").insert({ id: userId, supabase_user_id: userId, email, full_name: "E2E Fixture Admin", company: "Arab ShipBroker", role: "admin", admin_tier: "super", subscription_tier: "T4", is_active: true }));
    return { email, userId };
  });
}

/** Removes the admin seat in one guarded transaction; throws on failure (spec afterAll hooks wrap it in teardownAll). */
export function cleanupAdmin(a: AdminSeed) {
  teardownRows("e2e admin teardown", { userIds: [a.userId] });
}

/** A supabase-js client signed in as a seeded member, for API calls the browser is not needed for. */
export async function apiClientAs(email: string): Promise<SupabaseClient> {
  const k = keys();
  if (!k.anon) throw new Error("no anon key (E2E_SUPABASE_ANON_KEY or `supabase status`)");
  const c = createClient(k.url, k.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

/** Removes the whole seed (rooms and their ledgers included) in one guarded transaction; throws on failure. */
export function cleanupFixture(s: FixtureSeed) {
  teardownRows("e2e fixture teardown", {
    userIds: [s.charterer.userId, s.owner.userId], orgIds: [s.charterer.orgId, s.owner.orgId], cargoIds: [s.cargoId],
    availabilityIds: [s.availabilityId, s.tbn.availabilityId], vesselIds: [s.vesselId, s.tbn.vesselId], portCodes: s.portCodes, portStamp: s.stamp,
  });
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

/**
 * Binds a browser context to the e2e target (C2O-084 P0): every request to a Supabase service path on another
 * origin — the app under test was built against another project — is aborted and recorded, WebSockets included.
 * Callers check `violations` and fail with the offending URL.
 */
export async function bindSupabaseOrigin(context: BrowserContext): Promise<{ violations: string[] }> {
  const apiUrl = resolveTarget().apiUrl;
  const violations: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isForeignSupabaseRequest(url, apiUrl)) { violations.push(url); await route.abort("blockedbyclient"); return; }
    await route.fallback();
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (isForeignSupabaseRequest(ws.url(), apiUrl)) { violations.push(ws.url()); ws.close(); return; }
    ws.connectToServer();
  });
  return { violations };
}

/** A fresh context signed in through the real login form, with the shell's overlays answered. */
export async function signInAs(browser: Browser, baseURL: string, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const guard = await bindSupabaseOrigin(context);
  const failForeign = () => {
    if (guard.violations.length) throw new Error(`the app under test called Supabase outside the e2e target (${new URL(resolveTarget().apiUrl).origin}): ${guard.violations[0]}`);
  };
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  // The app uses client-side routing after the auth call. Waiting for a page
  // `load` event can miss that transition even when the dashboard is already
  // rendered, so assert the observable URL instead.
  try {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 90_000 });
  } catch (e) {
    failForeign();
    throw e;
  }
  // Wait for the router transition itself, not only its early URL update.
  // Starting the next navigation while the login transition is still
  // rendering can let its pending router.push win and send the test back to
  // /dashboard after it has requested a Fixture page.
  try {
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 90_000 });
  } catch (e) {
    failForeign();
    throw e;
  }
  failForeign();
  await dismissOverlays(page);
  return { context, page };
}
