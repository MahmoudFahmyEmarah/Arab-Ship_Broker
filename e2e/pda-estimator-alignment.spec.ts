import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PASSWORD = "e2e-PDA-Passw0rd!";

interface PdaSeed {
  email: string;
  userId: string;
  orgId: string;
  cargoId: string;
  vesselId: string;
  availabilityId: string;
  vesselName: string;
  cargoName: string;
}

function localAdmin(): SupabaseClient {
  const url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error(`PDA browser test refuses to seed ${url}`);
  if (!key) throw new Error("E2E_SUPABASE_SERVICE_ROLE_KEY is required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function seedPda(): Promise<PdaSeed> {
  const admin = localAdmin();
  const stamp = Date.now().toString(36);
  const email = `e2e-pda-${stamp}@arabshipbroker.test`;
  const vesselName = `E2E PDA VESSEL ${stamp.toUpperCase()}`;
  const cargoName = `E2E PDA WHEAT ${stamp.toUpperCase()}`;
  const imo = String(1_000_000 + (Number.parseInt(stamp, 36) % 9_000_000));
  const { data: auth, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authError || !auth.user) throw new Error(`create PDA user: ${authError?.message}`);

  const userId = auth.user.id;
  const { error: userError } = await admin.from("users").insert({
    id: userId,
    supabase_user_id: userId,
    email,
    full_name: "E2E PDA Broker",
    company: `E2E PDA ${stamp}`,
    role: "broker",
    subscription_tier: "T3",
    is_active: true,
  });
  if (userError) throw new Error(`PDA user row: ${userError.message}`);

  const { data: org, error: orgError } = await admin.from("organizations").insert({
    name: `E2E PDA ${stamp}`,
    org_type: "broker",
    desk_contact_name: "PDA Desk",
  }).select("id").single();
  if (orgError) throw new Error(`PDA org: ${orgError.message}`);
  await admin.from("organization_members").insert({
    org_id: org.id,
    user_id: userId,
    member_role: "admin",
    is_current: true,
    status: "active",
  });
  await admin.from("profiles").insert({
    account_id: userId,
    profile_type: "broker",
    display_name: "E2E PDA Broker",
    is_active: true,
  });

  const { error: portsError } = await admin.from("ports").upsert([
    { locode: "ZZP1A", trade_name: "Alexandria Test", country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    { locode: "ZZP1B", trade_name: "Jeddah Test", country: "Saudi Arabia", zone: "R.SEA", port_type: "Sea Port", is_active: true, is_verified: true },
  ], { onConflict: "locode" });
  if (portsError) throw new Error(`PDA ports: ${portsError.message}`);

  const d = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const { data: cargo, error: cargoError } = await admin.from("cargo_listings").insert({
    ref: `E2EPDA-${stamp}`,
    status: "IN",
    review_status: "APPROVED",
    cargo_type: "Dry Bulk",
    commodity_name: cargoName,
    is_dg_cargo: false,
    is_grain_cargo: true,
    qty_min_mt: 25_000,
    qty_max_mt: 27_500,
    load_port_locode: "ZZP1A",
    load_port_name: "Alexandria Test",
    load_zone: "E.MED",
    disch_port_locode: "ZZP1B",
    disch_port_name: "Jeddah Test",
    disch_zone: "R.SEA",
    laycan_from: d(10),
    laycan_to: d(20),
    is_spot: false,
    load_terms: "FIOST",
    load_rate: 1_200,
    disch_rate: 1_200,
  }).select("id").single();
  if (cargoError) throw new Error(`PDA cargo: ${cargoError.message}`);

  const { data: vessel, error: vesselError } = await admin.from("vessels").insert({
    vessel_name: vesselName,
    imo_number: imo,
    vessel_type: "Bulk Carrier",
    dwt_grain: 35_000,
    gross_tonnage: 22_400,
    scnrt: 18_500,
    max_loa_m: 182,
    build_year: 2015,
    flag: "Malta",
    is_geared: true,
    grain_certified: true,
    dg_certified: false,
    is_sanctioned: false,
  }).select("id").single();
  if (vesselError) throw new Error(`PDA vessel: ${vesselError.message}`);

  const { data: availability, error: availabilityError } = await admin.from("vessel_availability").insert({
    vessel_id: vessel.id,
    open_port_locode: "ZZP1A",
    open_port_name: "Alexandria Test",
    open_zone: "E.MED",
    open_date: d(5),
    status: "OPEN",
    review_status: "APPROVED",
    service_speed_kn: 12,
    accepts_part_cargo: false,
  }).select("id").single();
  if (availabilityError) throw new Error(`PDA availability: ${availabilityError.message}`);

  const { error: ownershipError } = await admin.from("listing_ownership").insert([
    { listing_type: "cargo", listing_id: cargo.id, owner_user_id: userId, owner_org_id: org.id, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: availability.id, owner_user_id: userId, owner_org_id: org.id, role: "primary", is_current: true, transfer_reason: "initial_post" },
  ]);
  if (ownershipError) throw new Error(`PDA ownership: ${ownershipError.message}`);

  return {
    email,
    userId,
    orgId: org.id,
    cargoId: cargo.id,
    vesselId: vessel.id,
    availabilityId: availability.id,
    vesselName,
    cargoName,
  };
}

async function cleanupPda(seed: PdaSeed | null) {
  if (!seed) return;
  const admin = localAdmin();
  await admin.from("listing_ownership").delete().in("listing_id", [seed.cargoId, seed.availabilityId]);
  await admin.from("matches").delete().or(`cargo_id.eq.${seed.cargoId},vessel_avail_id.eq.${seed.availabilityId}`);
  await admin.from("vessel_availability").delete().eq("id", seed.availabilityId);
  await admin.from("vessels").delete().eq("id", seed.vesselId);
  await admin.from("cargo_listings").delete().eq("id", seed.cargoId);
  await admin.from("profiles").delete().eq("account_id", seed.userId);
  await admin.from("organization_members").delete().eq("user_id", seed.userId);
  await admin.from("organizations").delete().eq("id", seed.orgId);
  await admin.from("users").delete().eq("id", seed.userId);
  await admin.auth.admin.deleteUser(seed.userId);
}

async function cleanupDanglingPdaFixtures() {
  const admin = localAdmin();
  const { data: cargos } = await admin.from("cargo_listings").select("id").like("ref", "E2EPDA-%");
  const { data: vessels } = await admin.from("vessels").select("id").like("vessel_name", "E2E PDA VESSEL %");
  const cargoIds = (cargos ?? []).map((row) => row.id as string);
  const vesselIds = (vessels ?? []).map((row) => row.id as string);
  const { data: availabilities } = vesselIds.length
    ? await admin.from("vessel_availability").select("id").in("vessel_id", vesselIds)
    : { data: [] as Array<{ id: string }> };
  const availabilityIds = (availabilities ?? []).map((row) => row.id as string);
  const listingIds = [...cargoIds, ...availabilityIds];
  if (listingIds.length) await admin.from("listing_ownership").delete().in("listing_id", listingIds);
  if (cargoIds.length) await admin.from("matches").delete().in("cargo_id", cargoIds);
  if (availabilityIds.length) {
    await admin.from("matches").delete().in("vessel_avail_id", availabilityIds);
    await admin.from("vessel_availability").delete().in("id", availabilityIds);
  }
  if (vesselIds.length) await admin.from("vessels").delete().in("id", vesselIds);
  if (cargoIds.length) await admin.from("cargo_listings").delete().in("id", cargoIds);

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  const testUsers = users?.users.filter((user) => user.email?.startsWith("e2e-pda-")) ?? [];
  const userIds = testUsers.map((user) => user.id);
  if (userIds.length) {
    const { data: memberships } = await admin.from("organization_members").select("org_id").in("user_id", userIds);
    const orgIds = [...new Set((memberships ?? []).map((row) => row.org_id as string))];
    await admin.from("profiles").delete().in("account_id", userIds);
    await admin.from("organization_members").delete().in("user_id", userIds);
    await admin.from("users").delete().in("id", userIds);
    if (orgIds.length) await admin.from("organizations").delete().in("id", orgIds);
    for (const user of testUsers) await admin.auth.admin.deleteUser(user.id);
  }
}

async function dismissPortalDialogs(page: Page) {
  const cookie = page.getByRole("dialog", { name: "Cookie consent" });
  if (await cookie.isVisible().catch(() => false)) await cookie.getByRole("button", { name: "Accept all" }).click();

  const checkin = page.getByRole("dialog", { name: "Vessel position check-in" });
  await checkin.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  if (await checkin.isVisible().catch(() => false)) await checkin.getByRole("button", { name: "Remind me later" }).click();
}

async function signIn(browser: Browser, baseURL: string, seed: PdaSeed, width: number, height: number) {
  const context = await browser.newContext({ baseURL, viewport: { width, height }, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await expect(page.locator(".asb-loading-overlay")).not.toHaveClass(/is-visible/, { timeout: 30_000 });
  await page.locator('input[name="email"]').fill(seed.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 90_000 });
  await dismissPortalDialogs(page);
  return { context, page };
}

async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

let seed: PdaSeed | null = null;

test.beforeAll(async () => {
  await cleanupDanglingPdaFixtures();
  seed = await seedPda();
});
test.afterAll(async () => {
  await cleanupPda(seed);
  await cleanupDanglingPdaFixtures();
});

const VIEWPORTS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 1024, height: 768, name: "tablet" },
  { width: 390, height: 844, name: "mobile" },
] as const;

test("desktop, tablet and mobile: exact empty and selected Estimate structure", async ({ browser, baseURL }) => {
  if (!seed) throw new Error("PDA seed was not created");
  const activeSeed = seed;
  const first = VIEWPORTS[0];
  const { context, page } = await signIn(browser, baseURL!, activeSeed, first.width, first.height);
  try {
    for (const viewport of VIEWPORTS) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/dashboard/ports-da");
        await expect(page.getByRole("heading", { name: "Ports Cost Estimator" })).toBeVisible({ timeout: 90_000 });
        await dismissPortalDialogs(page);
        await expect(page.getByRole("heading", { name: "Pick a vessel and a cargo." })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Estimate" })).toHaveAttribute("aria-selected", "true");
        await assertNoPageOverflow(page);
        await page.screenshot({ path: `test-results/pda-alignment/empty-${viewport.name}.png`, fullPage: true });

        const vesselSearch = page.getByRole("combobox", { name: "Vessel" });
        await vesselSearch.fill(activeSeed.vesselName);
        await page.getByRole("option", { name: new RegExp(activeSeed.vesselName) }).click();
        const cargoSearch = page.getByRole("combobox", { name: "Cargo" });
        await cargoSearch.fill(activeSeed.cargoName);
        await page.getByRole("option", { name: new RegExp(activeSeed.cargoName) }).click();

        await expect(page.getByText("POL Alexandria Test \u2192 POD Jeddah Test", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Voyage timeline" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Alexandria Test" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Jeddah Test" })).toBeVisible();
        await expect(page.locator(".pda-summary__tiles")).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
        await expect(page.getByText("NOT SOURCED", { exact: true }).first()).toBeVisible();
        await assertNoPageOverflow(page);
        await page.screenshot({ path: `test-results/pda-alignment/selected-${viewport.name}.png`, fullPage: true });
      });
    }
  } finally {
    await context.close();
  }
});
