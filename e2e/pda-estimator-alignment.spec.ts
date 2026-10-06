import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isExactLoopbackUrl } from "../lib/pda/local-test-url";

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
  loadLocode: string;
  dischargeLocode: string;
  loadPortName: string;
  dischargePortName: string;
}

function localAdmin(): SupabaseClient {
  const url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!isExactLoopbackUrl(url)) throw new Error(`PDA browser test refuses to seed ${url}`);
  if (!key) throw new Error("E2E_SUPABASE_SERVICE_ROLE_KEY is required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function seedPda(): Promise<PdaSeed> {
  const admin = localAdmin();
  const stamp = Date.now().toString(36);
  const email = `e2e-pda-${stamp}@arabshipbroker.test`;
  const vesselName = `E2E PDA VESSEL ${stamp.toUpperCase()}`;
  const cargoName = `E2E PDA WHEAT ${stamp.toUpperCase()}`;
  const locodeSuffix = stamp.slice(-3).toUpperCase().padStart(3, "0");
  const loadLocode = `ZX${locodeSuffix}`;
  const dischargeLocode = `ZY${locodeSuffix}`;
  const loadPortName = `E2E PDA PORT LOAD ${stamp.toUpperCase()}`;
  const dischargePortName = `E2E PDA PORT DISCHARGE ${stamp.toUpperCase()}`;
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
    { locode: loadLocode, trade_name: loadPortName, country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    { locode: dischargeLocode, trade_name: dischargePortName, country: "Saudi Arabia", zone: "R.SEA", port_type: "Sea Port", is_active: true, is_verified: true },
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
    load_port_locode: loadLocode,
    load_port_name: loadPortName,
    load_zone: "E.MED",
    disch_port_locode: dischargeLocode,
    disch_port_name: dischargePortName,
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
    open_port_locode: loadLocode,
    open_port_name: loadPortName,
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
    loadLocode,
    dischargeLocode,
    loadPortName,
    dischargePortName,
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
  await admin.from("ports").delete().in("locode", [seed.loadLocode, seed.dischargeLocode]);
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
  const { data: ports } = await admin
    .from("ports")
    .select("locode")
    .like("trade_name", "E2E PDA PORT %")
    .or("locode.like.ZX%,locode.like.ZY%");
  const portLocodes = (ports ?? []).map((row) => row.locode as string);
  if (portLocodes.length) await admin.from("ports").delete().in("locode", portLocodes);

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
  const emailInput = page.locator('input[name="email"]');
  await expect(emailInput).toBeVisible({ timeout: 90_000 });
  const overlay = page.locator(".asb-loading-overlay");
  if (await overlay.count()) {
    await expect(overlay).not.toHaveClass(/is-visible/, { timeout: 30_000 });
  }
  await emailInput.fill(seed.email);
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

async function exerciseManualQuoteEditors(page: Page) {
  for (const side of ["Load port", "Discharge port"] as const) {
    const editor = page.locator(`section[aria-label="${side} attributed manual quotations"]`);
    await expect(editor.getByRole("button", { name: "Add quote" })).toBeVisible();
    await editor.getByRole("button", { name: "Add quote" }).click();
    await editor.getByLabel("Rule code optional").fill("towage");
    await editor.getByLabel("Quote label").fill(`${side} agent quote`);
    await editor.getByLabel("Amount").fill("425");
    await editor.getByLabel("Quote reason / reference").fill("Agent email Q-425");
    await expect(editor.getByRole("button", { name: new RegExp(`Remove ${side.toLowerCase()} quote 1`) })).toBeVisible();
    await editor.getByRole("button", { name: new RegExp(`Remove ${side.toLowerCase()} quote 1`) }).click();
    await expect(editor.getByLabel("Quote label")).toHaveCount(0);
  }
}

async function completeGovernedRouteFacts(page: Page) {
  await page.getByLabel("Load-port local call date").fill("2026-10-01");
  await page.getByLabel("Discharge-port local call date").fill("2026-10-08");
  await page.getByLabel("Cargo status").selectOption("laden");
  await page.getByLabel("Voyage scope").selectOption("international");
  await page.getByLabel("Load-port location").selectOption("alongside");
  await page.getByLabel("Discharge-port location").selectOption("anchorage");

  const loadServices = page.getByRole("group", { name: "Load-port requested services" });
  const dischargeServices = page.getByRole("group", { name: "Discharge-port requested services" });
  for (const service of ["Port dues", "Cargo handling", "Agency", "Pilotage"]) {
    await loadServices.getByRole("checkbox", { name: service }).check();
  }
  for (const service of ["Port dues", "Cargo handling", "Agency"]) {
    await dischargeServices.getByRole("checkbox", { name: service }).check();
  }
  await expect(dischargeServices.getByRole("checkbox", { name: "Pilotage" })).not.toBeChecked();

  const timelineGroups = page.locator(".pda-timeline__inputs fieldset");
  await page.getByLabel("ETA (UTC)").fill("2026-10-01T00:00");
  await timelineGroups.nth(0).locator('input[inputmode="decimal"]').nth(0).fill("1200");
  await timelineGroups.nth(0).locator('input[inputmode="decimal"]').nth(1).fill("1");
  await timelineGroups.nth(1).locator('input[inputmode="decimal"]').nth(0).fill("1100");
  await timelineGroups.nth(1).locator('input[inputmode="decimal"]').nth(1).fill("11");
  await timelineGroups.nth(2).locator('input[inputmode="decimal"]').nth(0).fill("1200");
  await timelineGroups.nth(2).locator('input[inputmode="decimal"]').nth(1).fill("1");
}

async function assertDuplicateManualRuleError(page: Page) {
  const editor = page.locator('section[aria-label="Load port attributed manual quotations"]');
  for (const [index, amount] of ["425", "475"].entries()) {
    await editor.getByRole("button", { name: "Add quote" }).click();
    await editor.getByLabel("Rule code optional").nth(index).fill("towage");
    await editor.getByLabel("Quote label").nth(index).fill(`Duplicate towage ${index + 1}`);
    await editor.getByLabel("Amount").nth(index).fill(amount);
    await editor.getByLabel("Quote reason / reference").nth(index).fill(`Agent email DUP-${index + 1}`);
  }
  const estimatorError = page.locator(".pda-summary__error");
  await expect(estimatorError).toHaveText("Duplicate manual quotation rule code: towage", { timeout: 90_000 });
  const removeButtons = editor.getByRole("button", { name: /Remove load port quote/ });
  await removeButtons.last().click();
  await removeButtons.first().click();
  await expect(estimatorError).toHaveCount(0);
  await expect(page.locator(".pda-port-card").first().locator("footer")).toContainText("No tariff version", { timeout: 90_000 });
}

async function assertUnsourcedGovernedPreview(page: Page) {
  const portCards = page.locator(".pda-port-card");
  await expect(portCards).toHaveCount(2);
  await expect(portCards.nth(0).locator(".pda-port-card__total strong")).toHaveText("NOT SOURCED", { timeout: 90_000 });
  await expect(portCards.nth(1).locator(".pda-port-card__total strong")).toHaveText("NOT SOURCED");
  await expect(portCards.nth(0).locator("footer")).toContainText("No tariff version");
  await expect(portCards.nth(1).locator("footer")).toContainText("No tariff version");

  const inclusive = page.locator(".pda-summary-tile").filter({ hasText: "incl. handling & agency" });
  await expect(inclusive.locator("strong")).toHaveText("NOT SOURCED");
  await expect(inclusive).toContainText("NOT SOURCED until both components are evidenced");

  await portCards.nth(0).locator(".pda-port-card__handling summary").click();
  await portCards.nth(0).locator(".pda-port-card__breakdown summary").click();
  await portCards.nth(1).locator(".pda-port-card__breakdown summary").click();
  await expect(portCards.nth(0)).toContainText("Load port Pilotage");
  await expect(portCards.nth(1)).not.toContainText("Discharge port Pilotage");
  await expect(portCards.nth(0)).toContainText("No published tariff provenance");
  await expect(portCards.nth(0)).toContainText("NO_PUBLISHED_TARIFF");
  await expect(portCards.nth(0)).toContainText("No priced tariff lines");
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
        await vesselSearch.fill("NO MATCH FOR EMPTY PICKER");
        await vesselSearch.press("ArrowUp");
        await expect(vesselSearch).not.toHaveAttribute("aria-activedescendant", /.+/);
        await vesselSearch.fill(activeSeed.vesselName);
        await page.getByRole("option", { name: new RegExp(activeSeed.vesselName) }).click();
        const cargoSearch = page.getByRole("combobox", { name: "Cargo" });
        await cargoSearch.fill(activeSeed.cargoName);
        await page.getByRole("option", { name: new RegExp(activeSeed.cargoName) }).click();

        await expect(page.getByText(`POL ${activeSeed.loadPortName} \u2192 POD ${activeSeed.dischargePortName}`, { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Voyage timeline" })).toBeVisible();
        await expect(page.getByRole("heading", { name: activeSeed.loadPortName })).toBeVisible();
        await expect(page.getByRole("heading", { name: activeSeed.dischargePortName })).toBeVisible();
        await exerciseManualQuoteEditors(page);
        await completeGovernedRouteFacts(page);
        await assertUnsourcedGovernedPreview(page);
        if (viewport.name === "desktop") await assertDuplicateManualRuleError(page);
        await expect(page.locator(".pda-summary__tiles")).toHaveAttribute("aria-busy", "false");
        await assertNoPageOverflow(page);
        await page.screenshot({ path: `test-results/pda-alignment/selected-${viewport.name}.png`, fullPage: true });
        if (viewport.name === "desktop") {
          // C2B-013: "New" must not carry settlement modes into the next estimate.
          await page.getByLabel("Load-port settlement").selectOption("cash");
          await page.getByLabel("Discharge-port settlement").selectOption("agent_account");
          await page.getByRole("button", { name: "New" }).click();
          await page.getByRole("combobox", { name: "Vessel" }).fill(activeSeed.vesselName);
          await page.getByRole("option", { name: new RegExp(activeSeed.vesselName) }).click();
          await page.getByRole("combobox", { name: "Cargo" }).fill(activeSeed.cargoName);
          await page.getByRole("option", { name: new RegExp(activeSeed.cargoName) }).click();
          await expect(page.getByLabel("Load-port settlement")).toHaveValue("");
          await expect(page.getByLabel("Discharge-port settlement")).toHaveValue("");
          await expect(page.getByLabel("Load-port settlement").locator("option:checked")).toHaveText("Not stated");
        }
      });
    }
  } finally {
    await context.close();
  }
});
