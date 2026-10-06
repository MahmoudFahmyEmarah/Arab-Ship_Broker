/**
 * Stream R browser acceptance.
 *
 * The suite is intentionally self-contained. It creates one super admin and
 * one T3 member plus enough governed cargo/vessel rows to exercise the real
 * admin consoles, member intelligence flags and authoritative Top Matches.
 * Every write goes through a service-role client whose URL is checked as an
 * exact disposable loopback host or the one approved staging project; cleanup
 * uses the same API and never shells into Postgres.
 */
import {
  expect as baseExpect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const expect = baseExpect.configure({ timeout: 90_000 });
const PASSWORD = "e2e-Rules-Passw0rd!";
const MATCH_RPC_GLOB = "**/rest/v1/rpc/list_market_matches";
const FORCE_INTELLIGENCE_FAILURE_COOKIE = "asb-e2e-force-intelligence-failure";
const APPROVED_STAGING_SUPABASE_ORIGIN = "https://sidcsytgqalqacsgyguz.supabase.co";
const PRODUCTION_SUPABASE_ORIGIN = "https://rezfejaxbmdzkslrrefr.supabase.co";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 720_000 });

interface SeedIdentity {
  email: string;
  userId: string;
}

interface RulesSeed {
  stamp: string;
  admin: SeedIdentity;
  member: SeedIdentity & { orgId: string };
  orgIds: string[];
  portLocodes: string[];
  cargoIds: string[];
  cargoNames: string[];
  vesselIds: string[];
  availabilityIds: string[];
  vesselNames: string[];
}

interface MutableSeed {
  stamp: string;
  admin: SeedIdentity | null;
  member: SeedIdentity | null;
  orgIds: string[];
  portLocodes: string[];
  cargoIds: string[];
  cargoNames: string[];
  vesselIds: string[];
  availabilityIds: string[];
  vesselNames: string[];
}

type BetaModeSnapshot =
  | { exists: false }
  | { exists: true; value: unknown; updatedAt: string };

function exactLoopbackUrl(raw: string, label: string): string {
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  const host = value.hostname.toLowerCase();
  if (
    value.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)
  ) {
    throw new Error(`${label} must be an exact HTTP loopback URL; received ${raw}`);
  }
  return value.toString().replace(/\/$/, "");
}

function approvedSupabaseUrl(raw: string, label: string): string {
  const normalized = new URL(raw).toString().replace(/\/$/, "");
  const origin = new URL(normalized).origin;
  if (origin === PRODUCTION_SUPABASE_ORIGIN) {
    throw new Error(`${label} must never target the production Supabase project.`);
  }
  if (process.env.E2E_ALLOW_REMOTE === "1" && origin === APPROVED_STAGING_SUPABASE_ORIGIN) {
    return normalized;
  }
  return exactLoopbackUrl(raw, label);
}

function localEnvironment() {
  const rawUrl = process.env.E2E_SUPABASE_URL;
  const anon = process.env.E2E_SUPABASE_ANON_KEY;
  const service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  const nonce = process.env.E2E_RULES_STACK_NONCE;
  if (
    process.env.E2E_RULES_DISPOSABLE_STACK !== "1"
    && process.env.E2E_ALLOW_REMOTE !== "1"
  ) {
    throw new Error("Select either the disposable Stream R stack or the approved staging target.");
  }
  if (!rawUrl || !anon || !service || !nonce) {
    throw new Error(
      "Set E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_SUPABASE_SERVICE_ROLE_KEY and E2E_RULES_STACK_NONCE for the disposable local Supabase stack.",
    );
  }
  if (nonce.length < 32) {
    throw new Error("E2E_RULES_STACK_NONCE must contain at least 32 characters.");
  }
  const url = approvedSupabaseUrl(rawUrl, "E2E_SUPABASE_URL");
  if (new URL(url).hostname !== "sidcsytgqalqacsgyguz.supabase.co" && new URL(url).port === "54321") {
    throw new Error("The Stream R suite refuses the shared local Supabase API on port 54321.");
  }
  return {
    url,
    anon,
    service,
    nonce,
  };
}

function assertDisposableSupabaseRequest(raw: string): void {
  const requestUrl = new URL(raw);
  const isSupabaseRequest = requestUrl.pathname.startsWith("/auth/v1/")
    || requestUrl.pathname.startsWith("/rest/v1/");
  if (!isSupabaseRequest) return;
  const expectedBackendOrigin = new URL(localEnvironment().url).origin;
  if (requestUrl.origin !== expectedBackendOrigin) {
    throw new Error(`Browser attempted a Supabase request outside the disposable stack: ${requestUrl.origin}`);
  }
}

function serviceClient(): SupabaseClient {
  const { url, service } = localEnvironment();
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requiredRows<T extends { id: string }>(
  promise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const { data, error } = await promise;
  if (error || !data) throw new Error(`${label}: ${error?.message ?? "no rows returned"}`);
  return data;
}

async function requiredRow<T extends { id: string }>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error || !data) throw new Error(`${label}: ${error?.message ?? "no row returned"}`);
  return data;
}

async function assertMutation(
  promise: PromiseLike<{ error: { message: string } | null }>,
  label: string,
): Promise<void> {
  const { error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
}

function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

function imoFromSixDigitCore(core: number): string {
  if (!Number.isInteger(core) || core < 100_000 || core > 999_999) {
    throw new Error(`IMO core must be a six-digit integer; received ${core}`);
  }
  const digits = String(core);
  const checkDigit = [7, 6, 5, 4, 3, 2]
    .reduce((sum, weight, index) => sum + weight * Number(digits[index]), 0) % 10;
  return `${digits}${checkDigit}`;
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function cleanupRulesSeed(input: MutableSeed | RulesSeed): Promise<void> {
  const admin = serviceClient();
  const errors: string[] = [];
  const attempt = async (
    label: string,
    action: () => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<boolean> => {
    for (let tryNumber = 1; tryNumber <= 3; tryNumber += 1) {
      try {
        const { error } = await action();
        if (!error) return true;
        const transient = /statement timeout|request timeout|gateway timeout|temporarily unavailable/i.test(error.message);
        if (transient && tryNumber < 3) continue;
        errors.push(`${label}: ${error.message}`);
        return false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = /statement timeout|request timeout|gateway timeout|temporarily unavailable/i.test(message);
        if (transient && tryNumber < 3) continue;
        errors.push(`${label}: ${message}`);
        return false;
      }
    }
    return false;
  };

  // `matches` and `matching_candidates` are governed caches: service_role may
  // read but cannot write them. Deleting the exact source listings below runs
  // the SECURITY DEFINER refresh triggers and ON DELETE CASCADE constraints.
  const listingIds = [...input.cargoIds, ...input.availabilityIds];
  if (listingIds.length) {
    await attempt("delete listing ownership", () => admin.from("listing_ownership").delete().in("listing_id", listingIds));
  }
  if (input.availabilityIds.length) {
    await attempt("delete availability", () => admin.from("vessel_availability").delete().in("id", input.availabilityIds));
  }
  if (input.vesselIds.length) {
    await attempt("delete vessels", () => admin.from("vessels").delete().in("id", input.vesselIds));
  }
  if (input.cargoIds.length) {
    await attempt("delete cargo", () => admin.from("cargo_listings").delete().in("id", input.cargoIds));
  }

  const userIds = [input.admin?.userId, input.member?.userId].filter((id): id is string => Boolean(id));
  const authDeletionReady = new Set<string>();
  if (userIds.length) {
    await attempt("delete profiles", () => admin.from("profiles").delete().in("account_id", userIds));
    await attempt("delete memberships", () => admin.from("organization_members").delete().in("user_id", userIds));
  }
  if (input.admin?.userId) {
    const anonymized = await attempt("anonymize admin account", () => admin.rpc("fn_anonymize_account", {
      p_auth_user_id: input.admin!.userId,
    }));
    if (anonymized) authDeletionReady.add(input.admin.userId);
  }
  if (input.member?.userId) {
    const deleted = await attempt("delete member app user", () => admin
      .from("users")
      .delete()
      .eq("id", input.member!.userId));
    if (deleted) authDeletionReady.add(input.member.userId);
  }
  if (input.orgIds.length) {
    await attempt("delete organization", () => admin.from("organizations").delete().in("id", input.orgIds));
  }
  if (input.portLocodes.length) {
    await attempt("delete ports", () => admin
      .from("ports")
      .delete()
      .in("locode", input.portLocodes)
      .like("trade_name", `E2E Rules ${input.stamp} %`));
  }
  for (const userId of userIds) {
    if (!authDeletionReady.has(userId)) continue;
    let deleted = false;
    let lastDeleteError = "unknown Auth error";
    for (let tryNumber = 1; tryNumber <= 3 && !deleted; tryNumber += 1) {
      try {
        // The production erasure path soft-deletes Auth only after the stable
        // public.users audit anchor has been anonymized successfully.
        const { error } = await admin.auth.admin.deleteUser(userId, userId === input.admin?.userId);
        if (!error) {
          deleted = true;
          break;
        }
        lastDeleteError = error.message || JSON.stringify(error);
      } catch (error) {
        lastDeleteError = error instanceof Error ? error.message : String(error);
      }
      if (tryNumber < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, tryNumber * 500));
    }
    if (!deleted) errors.push(`delete auth user ${userId}: ${lastDeleteError}`);
  }

  const residueChecks = await Promise.all([
    admin.from("cargo_listings").select("id", { count: "exact", head: true }).like("ref", `E2ER-${input.stamp}-%`),
    admin.from("vessels").select("id", { count: "exact", head: true }).like("vessel_name", `%${input.stamp.toUpperCase()}`),
    admin.from("organizations").select("id", { count: "exact", head: true }).like("name", `%${input.stamp}`),
    admin.from("ports").select("locode", { count: "exact", head: true }).like("trade_name", `E2E Rules ${input.stamp} %`),
    admin.from("users").select("id", { count: "exact", head: true }).like("email", `%${input.stamp}@arabshipbroker.test`),
  ]);
  const residueLabels = ["cargo", "vessels", "organizations", "ports", "app users"];
  residueChecks.forEach((result, index) => {
    if (result.error) errors.push(`check ${residueLabels[index]} residue: ${result.error.message}`);
    else if ((result.count ?? 0) !== 0) errors.push(`${residueLabels[index]} residue: ${result.count}`);
  });

  if (input.admin?.userId && authDeletionReady.has(input.admin.userId)) {
    const { data: tombstone, error: tombstoneError } = await admin
      .from("users")
      .select("full_name,email,supabase_user_id,is_active,erased_at")
      .eq("id", input.admin.userId)
      .maybeSingle();
    if (tombstoneError) errors.push(`check admin tombstone: ${tombstoneError.message}`);
    else if (
      !tombstone
      || tombstone.full_name !== "Deleted account"
      || tombstone.email !== null
      || tombstone.supabase_user_id !== null
      || tombstone.is_active !== false
      || !tombstone.erased_at
    ) {
      errors.push("admin tombstone is missing or retains identity/access data");
    }
  }

  const { data: authUsers, error: authListError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (authListError) errors.push(`check auth residue: ${authListError.message}`);
  else if (authUsers.users.some((user) => user.email?.includes(input.stamp))) errors.push("auth user residue remains");

  if (errors.length) throw new Error(`Stream R cleanup failed:\n${errors.join("\n")}`);
}

async function captureBetaMode(): Promise<BetaModeSnapshot> {
  const { data, error } = await serviceClient()
    .from("app_settings")
    .select("value,updated_at")
    .eq("key", "beta_mode")
    .maybeSingle();
  if (error) throw new Error(`capture beta_mode: ${error.message}`);
  if (!data) return { exists: false };
  if (typeof data.updated_at !== "string" || !Number.isFinite(Date.parse(data.updated_at))) {
    throw new Error("capture beta_mode: stored updated_at is invalid");
  }
  return { exists: true, value: data.value, updatedAt: data.updated_at };
}

async function disableBetaModeForSuite(): Promise<void> {
  await assertMutation(serviceClient().from("app_settings").upsert({
    key: "beta_mode",
    value: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" }), "disable beta_mode for guarded browser proof");
}

let betaModeSnapshot: BetaModeSnapshot | undefined;

async function restoreBetaModeOnce(): Promise<void> {
  const snapshot = betaModeSnapshot;
  if (!snapshot) return;
  const admin = serviceClient();
  if (snapshot.exists) {
    await assertMutation(admin.from("app_settings").upsert({
      key: "beta_mode",
      value: snapshot.value,
      updated_at: snapshot.updatedAt,
    }, { onConflict: "key" }), "restore beta_mode row");
  } else {
    await assertMutation(
      admin.from("app_settings").delete().eq("key", "beta_mode"),
      "remove test-created beta_mode row",
    );
  }

  const { data, error } = await admin
    .from("app_settings")
    .select("value,updated_at")
    .eq("key", "beta_mode")
    .maybeSingle();
  if (error) throw new Error(`verify beta_mode restoration: ${error.message}`);
  if (!snapshot.exists) {
    if (data) throw new Error("verify beta_mode restoration: test-created row remains");
  } else if (
    !data
    || JSON.stringify(data.value) !== JSON.stringify(snapshot.value)
    || Date.parse(String(data.updated_at)) !== Date.parse(snapshot.updatedAt)
  ) {
    throw new Error("verify beta_mode restoration: original row was not restored exactly");
  }
  betaModeSnapshot = undefined;
}

async function seedRulesData(): Promise<RulesSeed> {
  const admin = serviceClient();
  const stamp = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const portToken = () => (randomBytes(4).readUInt32BE(0) % (36 ** 3)).toString(36).padStart(3, "0").toUpperCase();
  const loadToken = portToken();
  let dischargeToken = portToken();
  while (dischargeToken === loadToken) dischargeToken = portToken();
  const plannedPortLocodes = [`ZZ${loadToken}`, `ZZ${dischargeToken}`];
  const partial: MutableSeed = {
    stamp,
    admin: null,
    member: null,
    orgIds: [],
    portLocodes: [],
    cargoIds: [],
    cargoNames: [],
    vesselIds: [],
    availabilityIds: [],
    vesselNames: [],
  };

  try {
    const createUser = async (kind: "admin" | "member") => {
      const email = `e2e-rules-${kind}-${stamp}@arabshipbroker.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        app_metadata: kind === "admin" ? { role: "admin" } : { role: "member" },
      });
      if (error || !data.user) throw new Error(`create ${kind} auth user: ${error?.message ?? "no user"}`);
      return { email, userId: data.user.id };
    };

    const adminUser = await createUser("admin");
    partial.admin = adminUser;
    await assertMutation(admin.from("users").insert({
      id: adminUser.userId,
      supabase_user_id: adminUser.userId,
      email: adminUser.email,
      full_name: `E2E Rules Admin ${stamp}`,
      company: "Arab ShipBroker",
      role: "admin",
      admin_tier: "super",
      subscription_tier: "T4",
      is_active: true,
    }), "insert admin app user");

    const memberUser = await createUser("member");
    partial.member = memberUser;
    await assertMutation(admin.from("users").insert({
      id: memberUser.userId,
      supabase_user_id: memberUser.userId,
      email: memberUser.email,
      full_name: `E2E Rules Member ${stamp}`,
      company: `E2E Rules Chartering ${stamp}`,
      role: "cargo_owner",
      subscription_tier: "T3",
      is_active: true,
    }), "insert member app user");
    const org = await requiredRow<{ id: string }>(
      admin.from("organizations").insert({
        name: `E2E Rules Chartering ${stamp}`,
        org_type: "charterer",
        desk_contact_name: "Rules E2E Desk",
      }).select("id").single(),
      "insert organization",
    );
    partial.orgIds.push(org.id);
    await assertMutation(admin.from("organization_members").insert({
      org_id: org.id,
      user_id: memberUser.userId,
      member_role: "admin",
      is_current: true,
      status: "active",
    }), "insert member seat");
    await assertMutation(admin.from("profiles").insert({
      account_id: memberUser.userId,
      profile_type: "cargo",
      display_name: `E2E Rules Member ${stamp}`,
      is_active: true,
    }), "insert member profile");

    await assertMutation(admin.from("ports").insert([
      {
        locode: plannedPortLocodes[0],
        trade_name: `E2E Rules ${stamp} Load`,
        country: "Egypt",
        zone: "E.MED",
        port_type: "Sea Port",
        is_active: true,
        is_verified: true,
      },
      {
        locode: plannedPortLocodes[1],
        trade_name: `E2E Rules ${stamp} Discharge`,
        country: "Turkey",
        zone: "E.MED",
        port_type: "Sea Port",
        is_active: true,
        is_verified: true,
      },
    ]), "insert ports");
    partial.portLocodes = plannedPortLocodes;

    const freshnessBase = Date.now();
    const firstImoCore = 100_000 + (randomBytes(4).readUInt32BE(0) % (900_000 - 8));
    const vesselImos = Array.from({ length: 8 }, (_, index) => imoFromSixDigitCore(firstImoCore + index));
    const cargoNames = Array.from({ length: 8 }, (_, index) =>
      `E2E RULES CARGO ${String(index + 1).padStart(2, "0")} ${stamp.toUpperCase()}`,
    );
    const cargos = await requiredRows<{ id: string }>(
      admin.from("cargo_listings").insert(cargoNames.map((commodity, index) => ({
        ref: `E2ER-${stamp}-${index + 1}`,
        status: "IN",
        review_status: "APPROVED",
        cargo_type: "Dry Bulk",
        commodity_name: commodity,
        is_dg_cargo: false,
        is_grain_cargo: true,
        qty_min_mt: 25_000,
        qty_max_mt: 26_000 + index,
        stowage_factor: 55,
        load_port_locode: partial.portLocodes[0],
        load_port_name: `E2E Rules ${stamp} Load`,
        load_zone: "E.MED",
        disch_port_locode: partial.portLocodes[1],
        disch_port_name: `E2E Rules ${stamp} Discharge`,
        disch_zone: "E.MED",
        laycan_from: utcDay(1 + index),
        laycan_to: utcDay(5 + index),
        is_spot: false,
        requires_geared: false,
        load_terms: "FIOST",
        load_rate: "6500",
        freight_idea_usd_mt: 20,
        commission_pct: 2.5,
        created_at: new Date(freshnessBase - index * 60_000).toISOString(),
        refreshed_at: new Date(freshnessBase - index * 60_000).toISOString(),
      }))).select("id"),
      "insert cargo listings",
    );
    partial.cargoIds = cargos.map((row) => row.id);
    partial.cargoNames = cargoNames;
    await assertMutation(
      admin.from("cargo_listings").update({ status: "IN", review_status: "APPROVED" }).in("id", partial.cargoIds),
      "approve cargo listings after intake triggers",
    );

    const vesselNames = Array.from({ length: 8 }, (_, index) =>
      `E2E RULES VESSEL ${String(index + 1).padStart(2, "0")} ${stamp.toUpperCase()}`,
    );
    const vessels = await requiredRows<{ id: string }>(
      admin.from("vessels").insert(vesselNames.map((vesselName, index) => ({
        vessel_name: vesselName,
        imo_number: vesselImos[index],
        vessel_type: "Bulk Carrier",
        dwt_grain: 26_000 + index,
        grain_cbm: 33_000 + index,
        build_year: 1990,
        flag: "Liberia",
        is_geared: true,
        grain_certified: true,
        dg_certified: false,
        is_sanctioned: false,
      }))).select("id"),
      "insert vessels",
    );
    partial.vesselIds = vessels.map((row) => row.id);
    partial.vesselNames = vesselNames;

    const availabilities = await requiredRows<{ id: string }>(
      admin.from("vessel_availability").insert(vessels.map((vessel, index) => ({
        vessel_id: vessel.id,
        open_port_locode: partial.portLocodes[0],
        open_port_name: `E2E Rules ${stamp} Load`,
        open_zone: "E.MED",
        open_date: utcDay(index),
        status: "OPEN",
        review_status: "APPROVED",
        accepts_part_cargo: false,
        freight_idea_usd_mt: 22,
        vlsfo_sea_mt_day: 31,
        vlsfo_port_mt_day: 3,
        lsmgo_sea_mt_day: null,
        lsmgo_port_mt_day: 0.5,
        created_at: new Date(freshnessBase - index * 60_000).toISOString(),
        refreshed_at: new Date(freshnessBase - index * 60_000).toISOString(),
      }))).select("id"),
      "insert availability",
    );
    partial.availabilityIds = availabilities.map((row) => row.id);
    await assertMutation(
      admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).in("id", partial.availabilityIds),
      "approve vessel availability after intake triggers",
    );

    await assertMutation(admin.from("listing_ownership").insert([
      ...partial.cargoIds.map((listingId) => ({
        listing_type: "cargo",
        listing_id: listingId,
        owner_user_id: memberUser.userId,
        owner_org_id: org.id,
        role: "primary",
        is_current: true,
        transfer_reason: "initial_post",
      })),
      ...partial.availabilityIds.map((listingId) => ({
        listing_type: "vessel_availability",
        listing_id: listingId,
        owner_user_id: memberUser.userId,
        owner_org_id: org.id,
        role: "primary",
        is_current: true,
        transfer_reason: "initial_post",
      })),
    ]), "insert listing ownership");

    return {
      stamp,
      admin: adminUser,
      member: { ...memberUser, orgId: org.id },
      orgIds: partial.orgIds,
      portLocodes: partial.portLocodes,
      cargoIds: partial.cargoIds,
      cargoNames,
      vesselIds: partial.vesselIds,
      availabilityIds: partial.availabilityIds,
      vesselNames,
    };
  } catch (error) {
    try {
      await cleanupRulesSeed(partial);
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nPartial-seed cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }
    throw error;
  }
}

async function dismissOverlays(page: Page): Promise<void> {
  const cookie = page.getByRole("dialog", { name: "Cookie consent" });
  if (await cookie.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await cookie.getByRole("button", { name: "Accept all" }).click();
  }
  const checkin = page.getByRole("dialog", { name: "Vessel position check-in" });
  if (await checkin.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await checkin.getByRole("button", { name: "Remind me later" }).click();
  }
}

async function signInAs(
  browser: Browser,
  baseURL: string,
  email: string,
  prepare?: (page: Page) => Promise<void>,
): Promise<{ context: BrowserContext; page: Page }> {
  exactLoopbackUrl(baseURL, "Playwright baseURL");
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await context.route("**/*", async (route) => {
    try {
      assertDisposableSupabaseRequest(route.request().url());
    } catch (error) {
      await route.abort("blockedbyclient");
      throw error;
    }
    await route.fallback();
  });
  if (prepare) await prepare(page);
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const signIn = page.getByRole("button", { name: /sign in|log in/i }).first();
  let lastAuthStatus = "no token response";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const tokenResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().startsWith(`${localEnvironment().url}/auth/v1/token`),
    { timeout: 60_000 });
    await signIn.click();
    const response = await tokenResponse;
    lastAuthStatus = `${response.status()} ${response.statusText()}`;
    if (response.ok()) {
      await expect(page).toHaveURL(/\/(?:admin\/)?dashboard/, { timeout: 90_000 });
      await dismissOverlays(page);
      return { context, page };
    }
    if (attempt < 3) await expect(signIn).toBeEnabled({ timeout: 30_000 });
  }
  await context.close();
  throw new Error(`Disposable Supabase password sign-in failed after 3 attempts (${lastAuthStatus}).`);
}

function topMatchesPanel(page: Page) {
  return page.locator(".dash-panel").filter({ hasText: "Top matches" }).first();
}

type RuleSnapshot = {
  versions: number;
  events: number;
  requests: number;
  activeId: string | null;
  revision: number;
  versionsHash: string;
  eventsHash: string;
  requestsHash: string;
  stateHash: string;
};

type RulesEnvironmentSnapshot = {
  marker: true;
  matching: RuleSnapshot;
  intelligence: RuleSnapshot;
};

async function rulesEnvironmentSnapshot(): Promise<RulesEnvironmentSnapshot> {
  const { nonce } = localEnvironment();
  const { data, error } = await serviceClient().rpc("e2e_rules_environment_snapshot", {
    p_nonce: nonce,
  });
  if (error) throw new Error(`disposable environment marker: ${error.message}`);
  const value = data as RulesEnvironmentSnapshot | null;
  if (!value || value.marker !== true) {
    throw new Error("The database did not return the disposable Stream R marker.");
  }
  return value;
}

async function matchingRuleSnapshot(): Promise<RuleSnapshot> {
  return (await rulesEnvironmentSnapshot()).matching;
}

async function intelligenceRuleSnapshot(): Promise<RuleSnapshot> {
  return (await rulesEnvironmentSnapshot()).intelligence;
}

type GovernedBoardRow = {
  listing_key?: unknown;
  owned_listing_id?: unknown;
  match_count?: unknown;
  refreshed_at?: unknown;
  created_at?: unknown;
};

function unwrapGovernedBoardRows(value: unknown): GovernedBoardRow[] {
  if (Array.isArray(value)) return value as GovernedBoardRow[];
  if (value && typeof value === "object") {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items as GovernedBoardRow[];
  }
  throw new Error("Governed market board did not return an item array.");
}

function exactExpectedSourceKeys(rows: GovernedBoardRow[], ownedIds: readonly string[]): string[] {
  const owned = new Set(ownedIds);
  const postedAt = (row: GovernedBoardRow): number => {
    const raw = typeof row.refreshed_at === "string"
      ? row.refreshed_at
      : typeof row.created_at === "string"
        ? row.created_at
        : "";
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return rows
    .filter((row) => typeof row.owned_listing_id === "string" && owned.has(row.owned_listing_id))
    .filter((row) => Number(row.match_count ?? 0) > 0)
    .filter((row): row is GovernedBoardRow & { listing_key: string } => typeof row.listing_key === "string")
    .sort((left, right) => postedAt(right) - postedAt(left))
    .slice(0, 6)
    .map((row) => row.listing_key);
}

async function expectedMemberBoardSourceKeys(input: RulesSeed): Promise<{
  cargo: string[];
  vessel: string[];
}> {
  const { url, anon } = localEnvironment();
  const member = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await member.auth.signInWithPassword({
    email: input.member.email,
    password: PASSWORD,
  });
  if (signInError) throw new Error(`sign in member board oracle: ${signInError.message}`);

  try {
    const [cargoResult, vesselResult] = await Promise.all([
      member.rpc("list_market_cargo", {
        p_archive_cutoff: null,
        p_spot_active_from: null,
      }),
      member.rpc("list_market_vessels", {
        p_archive_cutoff: null,
        p_vessel_active_from: null,
      }),
    ]);
    if (cargoResult.error) throw new Error(`load member cargo board oracle: ${cargoResult.error.message}`);
    if (vesselResult.error) throw new Error(`load member vessel board oracle: ${vesselResult.error.message}`);

    const cargo = exactExpectedSourceKeys(
      unwrapGovernedBoardRows(cargoResult.data),
      input.cargoIds,
    );
    const vessel = exactExpectedSourceKeys(
      unwrapGovernedBoardRows(vesselResult.data),
      input.availabilityIds,
    );
    if (cargo.length !== 6 || vessel.length !== 6) {
      throw new Error(`Expected exactly six governed source keys per mode; received cargo=${cargo.length}, vessel=${vessel.length}.`);
    }
    return { cargo, vessel };
  } finally {
    await member.auth.signOut();
  }
}

let seed: RulesSeed;
let seedNeedsCleanup = false;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function cleanupSuiteState(): Promise<void> {
  const errors: Error[] = [];
  if (seedNeedsCleanup) {
    try {
      await cleanupRulesSeed(seed);
      seedNeedsCleanup = false;
    } catch (error) {
      errors.push(asError(error));
    }
  }
  try {
    await restoreBetaModeOnce();
  } catch (error) {
    errors.push(asError(error));
  }
  if (errors.length) throw new AggregateError(errors, "Stream R suite cleanup failed");
}

test.beforeAll(async () => {
  try {
    // Verify the out-of-band database nonce before the first write. Staging may
    // be in Beta mode, which intentionally blocks member pages. Preserve that
    // shared setting byte-for-byte and open it only for this guarded proof.
    localEnvironment();
    await rulesEnvironmentSnapshot();
    betaModeSnapshot = await captureBetaMode();
    await disableBetaModeForSuite();
    seed = await seedRulesData();
    seedNeedsCleanup = true;
  } catch (setupError) {
    try {
      await cleanupSuiteState();
    } catch (cleanupError) {
      throw new AggregateError(
        [asError(setupError), asError(cleanupError)],
        "Stream R suite setup and rollback failed",
      );
    }
    throw setupError;
  }
});

test.afterAll(async () => {
  await cleanupSuiteState();
});

test("invalid admin matching and intelligence inputs cannot mutate governed state", async ({ browser, baseURL }) => {
  const beforeMatching = await matchingRuleSnapshot();
  const beforeIntelligence = await intelligenceRuleSnapshot();
  const { context, page } = await signInAs(browser, baseURL!, seed.admin.email);

  await page.goto("/admin/matching-rules");
  await expect(page.getByRole("heading", { name: "Matching rules" })).toBeVisible();
  const dwtTolerance = page.locator("#matching-dwtTolerancePct");
  await dwtTolerance.fill("51");
  await expect(dwtTolerance).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Preview impact" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create immutable version" })).toBeDisabled();
  await expect.poll(() => matchingRuleSnapshot()).toEqual(beforeMatching);

  await page.goto("/admin/intelligence-rules");
  await expect(page.getByRole("heading", { name: "Intelligence rules" })).toBeVisible();
  await page.getByRole("button", { name: "Create from this version" }).click();
  await expect(page.getByRole("button", { name: "Create version" })).toBeVisible();
  await page.getByLabel("Version label").fill(`Rejected E2E draft ${seed.stamp}`);
  await page.getByLabel("Change note").fill("E2E invalid-input proof; this must not create a version.");
  await page.getByLabel("Rule code").first().fill("");
  await page.getByRole("button", { name: "Create version" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect.poll(() => intelligenceRuleSnapshot()).toEqual(beforeIntelligence);

  await context.close();
});

test("typed release confirmations gate and execute matching and intelligence activation and rollback", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.admin.email);

  await page.goto("/admin/matching-rules");
  const rateAlignment = page.locator("#matching-rateAlignmentUsd");
  const currentRate = Number(await rateAlignment.inputValue());
  const changedRate = currentRate < 1_000 ? currentRate + 0.01 : currentRate - 0.01;
  await rateAlignment.fill(changedRate.toFixed(2));
  await page.locator("#matching-change-note").fill(`E2E typed release proof ${seed.stamp}`);
  await page.getByRole("button", { name: "Preview impact" }).click();
  await expect(page.getByText("Publication preview", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create immutable version" }).click();

  const activateMatching = page.getByRole("button", { name: /^Activate v\d+$/ });
  await expect(activateMatching).toBeVisible();
  const matchingVersion = (await activateMatching.textContent())?.match(/v(\d+)/)?.[1];
  expect(matchingVersion).toBeTruthy();
  const matchingActivationInput = page.locator("#matching-activation-confirmation");
  await matchingActivationInput.fill(`ACTIVATE v${Number(matchingVersion) + 1}`);
  await expect(activateMatching).toBeDisabled();
  await matchingActivationInput.fill(`ACTIVATE v${matchingVersion}`);
  await expect(activateMatching).toBeEnabled();
  await activateMatching.click();
  await expect(page.getByRole("status")).toContainText(`Version v${matchingVersion} is live`);

  await page.getByRole("button", { name: "Version history" }).click();
  const openMatchingRollback = page.getByRole("button", { name: "Roll back", exact: true });
  await expect(openMatchingRollback).toHaveCount(1);
  await openMatchingRollback.click();
  const matchingRollbackGroup = page.getByRole("group", { name: /^Roll back to v\d+$/ });
  const matchingRollbackButton = matchingRollbackGroup.getByRole("button", { name: /^Roll back to v\d+$/ });
  const matchingRollbackVersion = (await matchingRollbackButton.textContent())?.match(/v(\d+)/)?.[1];
  expect(matchingRollbackVersion).toBeTruthy();
  const matchingRollbackInput = matchingRollbackGroup.getByRole("textbox");
  await matchingRollbackInput.fill(`ROLLBACK v${Number(matchingRollbackVersion) + 1}`);
  await expect(matchingRollbackButton).toBeDisabled();
  await matchingRollbackInput.fill(`ROLLBACK v${matchingRollbackVersion}`);
  await expect(matchingRollbackButton).toBeEnabled();
  await matchingRollbackButton.click();
  await expect(page.getByRole("status")).toContainText(`Matching rules rolled back to v${matchingRollbackVersion}`);

  await page.goto("/admin/intelligence-rules");
  await page.getByRole("button", { name: "Create from this version" }).click();
  const intelligenceLabel = `E2E typed release ${seed.stamp}`;
  await page.getByLabel("Version label").fill(intelligenceLabel);
  await page.getByLabel("Change note").fill("E2E typed activation and rollback proof.");
  await page.getByRole("button", { name: "Create version" }).click();
  await expect(page.getByRole("status")).toContainText("remains inactive pending separate review and activation");

  const intelligenceRow = page.getByRole("row").filter({ hasText: intelligenceLabel });
  await intelligenceRow.getByRole("button", { name: "Activate", exact: true }).click();
  const intelligenceReleaseGroup = page.getByRole("group", { name: /^Activate v\d+/ });
  const intelligenceActivate = intelligenceReleaseGroup.getByRole("button", { name: /^Activate v\d+$/ });
  const intelligenceVersion = (await intelligenceActivate.textContent())?.match(/v(\d+)/)?.[1];
  expect(intelligenceVersion).toBeTruthy();
  const intelligenceConfirmation = intelligenceReleaseGroup.getByRole("textbox");
  await intelligenceConfirmation.fill(`ACTIVATE v${Number(intelligenceVersion) + 1}`);
  await expect(intelligenceActivate).toBeDisabled();
  await intelligenceConfirmation.fill(`ACTIVATE v${intelligenceVersion}`);
  await expect(intelligenceActivate).toBeEnabled();
  await intelligenceActivate.click();
  await expect(page.getByRole("status")).toContainText(`Version ${intelligenceVersion} was activated`);

  const openIntelligenceRollback = page.getByRole("button", { name: "Roll back", exact: true });
  await expect(openIntelligenceRollback).toHaveCount(1);
  await openIntelligenceRollback.click();
  const intelligenceRollbackGroup = page.getByRole("group", { name: /^Roll back v\d+/ });
  const intelligenceRollback = intelligenceRollbackGroup.getByRole("button", { name: /^Roll back v\d+$/ });
  const intelligenceRollbackVersion = (await intelligenceRollback.textContent())?.match(/v(\d+)/)?.[1];
  expect(intelligenceRollbackVersion).toBeTruthy();
  const intelligenceRollbackConfirmation = intelligenceRollbackGroup.getByRole("textbox");
  await intelligenceRollbackConfirmation.fill(`ROLLBACK v${Number(intelligenceRollbackVersion) + 1}`);
  await expect(intelligenceRollback).toBeDisabled();
  await intelligenceRollbackConfirmation.fill(`ROLLBACK v${intelligenceRollbackVersion}`);
  await expect(intelligenceRollback).toBeEnabled();
  await intelligenceRollback.click();
  await expect(page.getByRole("status")).toContainText(`Version ${intelligenceRollbackVersion} was rolled back`);

  await context.close();
});

test("a live match-RPC failure preserves listings and renders the exact neutral unavailable copy", async ({ browser, baseURL }) => {
  let failedCalls = 0;
  const { context, page } = await signInAs(
    browser,
    baseURL!,
    seed.member.email,
    async (target) => {
      await target.route(MATCH_RPC_GLOB, async (route) => {
        assertDisposableSupabaseRequest(route.request().url());
        failedCalls += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "E2E_FORCED", message: "forced local acceptance failure" }),
        });
      });
    },
  );

  await expect(page.locator(".dash-row__name", { hasText: seed.cargoNames[0] })).toBeVisible();
  await expect(page.locator(".dash-row__name", { hasText: seed.vesselNames[0] })).toBeVisible();
  await expect(
    topMatchesPanel(page).getByText("Matching is temporarily unavailable. Please try again.", { exact: true }),
  ).toBeVisible();
  expect(failedCalls).toBeGreaterThan(0);
  expect(failedCalls).toBeLessThanOrEqual(6);

  await context.close();
});

test("a live intelligence-RPC failure preserves every cargo and vessel row with the exact neutral notice", async ({ browser, baseURL }) => {
  const { nonce } = localEnvironment();
  const { context, page } = await signInAs(browser, baseURL!, seed.member.email);
  await context.addCookies([{
    name: FORCE_INTELLIGENCE_FAILURE_COOKIE,
    value: nonce,
    url: baseURL!,
    httpOnly: true,
    sameSite: "Strict",
  }]);

  await page.goto("/dashboard/cargo");
  await dismissOverlays(page);
  for (const cargoName of seed.cargoNames) {
    await expect(page.locator(".cargo-card").filter({ hasText: cargoName })).toHaveCount(1);
  }
  await expect(
    page.getByText("Intelligence checks unavailable.", { exact: true }),
  ).toHaveCount(seed.cargoNames.length);

  await page.goto("/dashboard/vessels/browse");
  await dismissOverlays(page);
  for (const vesselName of seed.vesselNames) {
    await expect(page.locator(".vessel-card").filter({ hasText: vesselName })).toHaveCount(1);
  }
  await expect(
    page.getByText("Intelligence checks unavailable.", { exact: true }),
  ).toHaveCount(seed.vesselNames.length);

  await context.close();
});

test("Top Matches performs exactly one bounded six-request batch per active mode", async ({ browser, baseURL }) => {
  const expectedKeys = await expectedMemberBoardSourceKeys(seed);
  const listingKeys: string[] = [];
  const { context, page } = await signInAs(
    browser,
    baseURL!,
    seed.member.email,
    async (target) => {
      await target.route(MATCH_RPC_GLOB, async (route) => {
        assertDisposableSupabaseRequest(route.request().url());
        const body = route.request().postDataJSON() as { p_listing_key?: unknown };
        if (typeof body.p_listing_key !== "string") {
          throw new Error("list_market_matches request omitted p_listing_key");
        }
        listingKeys.push(body.p_listing_key);
        const response = await route.fetch();
        await route.fulfill({ response });
      });
    },
  );

  const panel = topMatchesPanel(page);
  await expect(panel.locator(".dash-match").first()).toBeVisible();
  expect(listingKeys).toEqual(expectedKeys.cargo);

  listingKeys.length = 0;
  await page.getByRole("button", { name: /Vessels.*cargo/i }).click();
  await expect(panel.locator(".dash-match")).toHaveCount(0);
  await expect(panel.locator(".dash-match").first()).toBeVisible();
  expect(listingKeys).toEqual(expectedKeys.vessel);

  await context.close();
});

test("rapid mode and filter changes discard the late cargo-mode response", async ({ browser, baseURL }) => {
  let releaseHeld!: () => void;
  let announceHeld!: () => void;
  const release = new Promise<void>((resolve) => { releaseHeld = resolve; });
  const held = new Promise<void>((resolve) => { announceHeld = resolve; });
  let announceCompleted!: () => void;
  const staleCompleted = new Promise<void>((resolve) => { announceCompleted = resolve; });
  let didHold = false;

  const { context, page } = await signInAs(
    browser,
    baseURL!,
    seed.member.email,
    async (target) => {
      await target.route(MATCH_RPC_GLOB, async (route: Route) => {
        assertDisposableSupabaseRequest(route.request().url());
        if (!didHold) {
          didHold = true;
          const response = await route.fetch();
          announceHeld();
          await release;
          await route.fulfill({ response });
          announceCompleted();
          return;
        }
        await route.continue();
      });
    },
  );

  try {
    await within(held, "initial cargo-mode RPC interception");
    await page.getByRole("button", { name: /Vessels.*cargo/i }).click();
    const gear = page.locator(".filter-bar").getByRole("button", { name: /^Gear/ }).first();
    await gear.click();
    await page.getByRole("button", { name: "Geared", exact: true }).click();

    const anchors = topMatchesPanel(page).locator(".dash-match__top .dm-name");
    await expect(anchors.first()).toContainText("E2E RULES VESSEL");
    releaseHeld();
    await within(staleCompleted, "held stale cargo response completion");
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const texts = await anchors.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((text) => text.includes("E2E RULES VESSEL"))).toBe(true);
    expect(texts.some((text) => text.includes("E2E RULES CARGO"))).toBe(false);
  } finally {
    releaseHeld();
    await context.close();
  }
});

test("390px market cards do not overflow and intelligence tooltips work from the keyboard", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.member.email);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/cargo");
  await dismissOverlays(page);
  const hideMap = page.getByRole("button", { name: /Hide map/i });
  if (await hideMap.isVisible().catch(() => false)) await hideMap.click();

  const card = page.locator(".cargo-card").filter({ hasText: seed.cargoNames[0] }).first();
  await expect(card).toBeVisible();
  const trigger = card.locator('button[data-intelligence-rule="R-005"]');
  await expect(trigger).toBeVisible();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.hover();
  let tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(tooltip).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // The pointer remains over the trigger. Keyboard activation must explicitly
  // reopen the portal, and a second Escape must keep it dismissed even while
  // the CSS hover state is still true.
  await trigger.press("Enter");
  tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Rate review");
  await expect(tooltip).toContainText("Rule R-005");
  const tooltipId = await tooltip.getAttribute("id");
  expect(tooltipId).toBeTruthy();
  await expect(trigger).toHaveAttribute("aria-describedby", tooltipId!);

  const tooltipBounds = await tooltip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const intersectionWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const intersectionHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const area = rect.width * rect.height;
    const intersectionRatio = area > 0 ? (intersectionWidth * intersectionHeight) / area : 0;
    const style = getComputedStyle(element);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      intersectionRatio,
      portalParent: element.parentElement === document.body,
      position: style.position,
      visibility: style.visibility,
      opacity: style.opacity,
    };
  });
  expect(tooltipBounds.left).toBeGreaterThanOrEqual(-1);
  expect(tooltipBounds.right).toBeLessThanOrEqual(391);
  expect(tooltipBounds.top).toBeGreaterThanOrEqual(-1);
  expect(tooltipBounds.bottom).toBeLessThanOrEqual(845);
  expect(tooltipBounds.intersectionRatio).toBeGreaterThan(0.99);
  expect(tooltipBounds.portalParent).toBe(true);
  expect(tooltipBounds.position).toBe("fixed");
  expect(tooltipBounds.visibility).toBe("visible");
  expect(Number(tooltipBounds.opacity)).toBeGreaterThan(0.99);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(tooltip).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await context.close();
});
