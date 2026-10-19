// PDA · the new tabs and the agency quote loop in a real browser (O2ALL-008/009; staging run approved 19 Oct 2026).
//   Ports, Agents and Setup tabs render; a saved estimate asks two agencies for quotes; the agency with an account
//   answers in its inbox (masked: no vessel name), the desk records the other agency's emailed quote, and the member
//   accepts one into a new version. Seeds its own users, organisations, ports and listings and removes them after.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createBoundTestUser } from "./e2e-auth";
import { resolveTarget, type E2ETarget } from "./e2e-db";

const PASSWORD = "e2e-PDA-Agents-Passw0rd!";

interface Seed {
  stamp: string;
  member: { id: string; email: string };
  staff: { id: string; email: string };
  admin: { id: string; email: string };
  memberOrg: string;
  portalAgency: string;
  emailAgency: string;
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

// the local stack, or the approved hosted staging project (resolveTarget refuses production and any unbound target)
function service(): { db: SupabaseClient; target: E2ETarget } {
  const target = resolveTarget();
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("E2E_SUPABASE_SERVICE_ROLE_KEY is required");
  return { db: createClient(target.apiUrl, key, { auth: { persistSession: false } }), target };
}

async function user(db: SupabaseClient, target: E2ETarget, email: string, row: Record<string, unknown>) {
  const { data, error } = await createBoundTestUser(db, target, { email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
  const { error: rowError } = await db.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, is_active: true, ...row });
  if (rowError) throw new Error(`users row ${email}: ${rowError.message}`);
  return { id: data.user.id, email };
}

async function seed(): Promise<Seed> {
  const { db, target } = service();
  const stamp = Date.now().toString(36);
  const S = stamp.toUpperCase();
  const suffix = stamp.slice(-3).toUpperCase().padStart(3, "0");
  const loadLocode = `ZV${suffix}`;
  const dischargeLocode = `ZW${suffix}`;
  const loadPortName = `E2E AGENTS PORT LOAD ${S}`;
  const dischargePortName = `E2E AGENTS PORT DISCHARGE ${S}`;
  const vesselName = `E2E AGENTS VESSEL ${S}`;
  const cargoName = `E2E AGENTS WHEAT ${S}`;

  const member = await user(db, target, `e2e-pda-ag-m-${stamp}@arabshipbroker.test`, { full_name: "E2E Agents Member", role: "broker", subscription_tier: "T3" });
  const staff = await user(db, target, `e2e-pda-ag-s-${stamp}@arabshipbroker.test`, { full_name: "E2E Agency Staff", role: "broker", subscription_tier: "T1" });
  const admin = await user(db, target, `e2e-pda-ag-a-${stamp}@arabshipbroker.test`, { full_name: "E2E Agents Owner", role: "admin", subscription_tier: "T4", admin_tier: null });

  const org = async (name: string) => {
    const { data, error } = await db.from("organizations").insert({ name, org_type: "broker", desk_contact_name: "Desk" }).select("id").single();
    if (error) throw new Error(`org ${name}: ${error.message}`);
    return data.id as string;
  };
  const memberOrg = await org(`E2E Agents Charterers ${S}`);
  const portalAgency = await org(`E2E Portal Agency ${S}`);
  const emailAgency = await org(`E2E Email Agency ${S}`);
  await db.from("organization_members").insert([
    { org_id: memberOrg, user_id: member.id, member_role: "admin", is_current: true, status: "active" },
    { org_id: portalAgency, user_id: staff.id, member_role: "admin", is_current: true, status: "active" },
  ]);
  await db.from("profiles").insert({ account_id: member.id, profile_type: "broker", display_name: "E2E Agents Member", is_active: true });

  const { error: portsError } = await db.from("ports").upsert([
    { locode: loadLocode, trade_name: loadPortName, country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    { locode: dischargeLocode, trade_name: dischargePortName, country: "Saudi Arabia", zone: "R.SEA", port_type: "Sea Port", is_active: true, is_verified: true },
  ], { onConflict: "locode" });
  if (portsError) throw new Error(`ports: ${portsError.message}`);

  // the registry through the governed service commands, as the owner-tier admin
  for (const [agency, name] of [[portalAgency, `Portal Agency ${S}`], [emailAgency, `Email Agency ${S}`]] as const) {
    const { error } = await db.rpc("pda_admin_upsert_agency", { p_actor: admin.id, p_org_id: agency, p_payload: { displayName: name } });
    if (error) throw new Error(`agency: ${error.message}`);
    const { error: listError } = await db.rpc("pda_admin_set_port_agent", { p_actor: admin.id, p_org_id: agency, p_port_locode: loadLocode, p_services: ["agency", "cargo_handling"], p_active: true });
    if (listError) throw new Error(`listing: ${listError.message}`);
  }

  const d = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const { data: cargo, error: cargoError } = await db.from("cargo_listings").insert({
    ref: `E2EPDAAG-${stamp}`, status: "IN", review_status: "APPROVED", cargo_type: "Dry Bulk", commodity_name: cargoName,
    is_dg_cargo: false, is_grain_cargo: true, qty_min_mt: 25_000, qty_max_mt: 27_500,
    load_port_locode: loadLocode, load_port_name: loadPortName, load_zone: "E.MED",
    disch_port_locode: dischargeLocode, disch_port_name: dischargePortName, disch_zone: "R.SEA",
    laycan_from: d(10), laycan_to: d(20), is_spot: false, load_terms: "FIOST", load_rate: 1_200, disch_rate: 1_200,
  }).select("id").single();
  if (cargoError) throw new Error(`cargo: ${cargoError.message}`);
  const { data: vessel, error: vesselError } = await db.from("vessels").insert({
    vessel_name: vesselName, imo_number: String(1_000_000 + (Number.parseInt(stamp, 36) % 9_000_000)), vessel_type: "Bulk Carrier",
    dwt_grain: 35_000, gross_tonnage: 22_400, scnrt: 18_500, max_loa_m: 182, build_year: 2015, flag: "Malta",
    is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false,
  }).select("id").single();
  if (vesselError) throw new Error(`vessel: ${vesselError.message}`);
  const { data: availability, error: availabilityError } = await db.from("vessel_availability").insert({
    vessel_id: vessel.id, open_port_locode: loadLocode, open_port_name: loadPortName, open_zone: "E.MED", open_date: d(5),
    status: "OPEN", review_status: "APPROVED", service_speed_kn: 12, accepts_part_cargo: false,
  }).select("id").single();
  if (availabilityError) throw new Error(`availability: ${availabilityError.message}`);
  const { error: ownershipError } = await db.from("listing_ownership").insert([
    { listing_type: "cargo", listing_id: cargo.id, owner_user_id: member.id, owner_org_id: memberOrg, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: availability.id, owner_user_id: member.id, owner_org_id: memberOrg, role: "primary", is_current: true, transfer_reason: "initial_post" },
  ]);
  if (ownershipError) throw new Error(`ownership: ${ownershipError.message}`);

  return { stamp, member, staff, admin, memberOrg, portalAgency, emailAgency, cargoId: cargo.id, vesselId: vessel.id, availabilityId: availability.id,
    vesselName, cargoName, loadLocode, dischargeLocode, loadPortName, dischargePortName };
}

async function signIn(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 90_000 });
  const overlay = page.locator(".asb-loading-overlay");
  if (await overlay.count()) await expect(overlay).not.toHaveClass(/is-visible/, { timeout: 30_000 });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await expect(page).toHaveURL(/\/(dashboard|admin)/, { timeout: 90_000 });
  await dismissDialogs(page);
  return { context, page };
}

async function dismissDialogs(page: Page) {
  const cookie = page.getByRole("dialog", { name: "Cookie consent" });
  if (await cookie.isVisible().catch(() => false)) await cookie.getByRole("button", { name: "Accept all" }).click();
  const checkin = page.getByRole("dialog", { name: "Vessel position check-in" });
  await checkin.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await checkin.isVisible().catch(() => false)) await checkin.getByRole("button", { name: "Remind me later" }).click();
}

async function pricedRoute(page: Page, s: Seed) {
  await page.goto("/dashboard/ports-da");
  await expect(page.getByRole("heading", { name: "Ports Cost Estimator" })).toBeVisible({ timeout: 90_000 });
  await dismissDialogs(page);
  await page.getByRole("combobox", { name: "Vessel" }).fill(s.vesselName);
  await page.getByRole("option", { name: new RegExp(s.vesselName) }).click();
  await page.getByRole("combobox", { name: "Cargo" }).fill(s.cargoName);
  await page.getByRole("option", { name: new RegExp(s.cargoName) }).click();
  await page.getByLabel("Load-port local call date").fill("2026-11-01");
  await page.getByLabel("Discharge-port local call date").fill("2026-11-09");
  await page.getByLabel("Cargo status").selectOption("laden");
  await page.getByLabel("Voyage scope").selectOption("international");
  await page.getByLabel("Load-port location").selectOption("alongside");
  await page.getByLabel("Discharge-port location").selectOption("alongside");
  await page.getByRole("group", { name: "Load-port requested services" }).getByRole("checkbox", { name: "Agency" }).check();
  await page.getByRole("group", { name: "Discharge-port requested services" }).getByRole("checkbox", { name: "Agency" }).check();
  const groups = page.locator(".pda-timeline__inputs fieldset");
  await page.getByLabel("ETA (UTC)").fill("2026-11-01T00:00");
  await groups.nth(0).locator('input[inputmode="decimal"]').nth(0).fill("13000");
  await groups.nth(0).locator('input[inputmode="decimal"]').nth(1).fill("1");
  await groups.nth(1).locator('input[inputmode="decimal"]').nth(0).fill("900");
  await groups.nth(1).locator('input[inputmode="decimal"]').nth(1).fill("12");
  await groups.nth(2).locator('input[inputmode="decimal"]').nth(0).fill("13000");
  await groups.nth(2).locator('input[inputmode="decimal"]').nth(1).fill("1");
  await expect(page.locator(".pda-port-card")).toHaveCount(2, { timeout: 90_000 });
  await expect(page.locator(".pda-summary__tiles")).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
}

async function cleanup(s: Seed | null) {
  if (!s) return;
  const { db } = service();
  // quote and estimate records are append-only by design; the run leaves them on staging (identified by the stamp)
  await db.from("listing_ownership").delete().in("listing_id", [s.cargoId, s.availabilityId]);
  await db.from("matches").delete().or(`cargo_id.eq.${s.cargoId},vessel_avail_id.eq.${s.availabilityId}`);
}

let s: Seed | null = null;
test.beforeAll(async () => { s = await seed(); });
test.afterAll(async () => { await cleanup(s); });

test("PDA tabs and the agency quote loop", async ({ browser, baseURL }) => {
  if (!s) throw new Error("seed missing");
  const seedNow = s;
  const member = await signIn(browser, baseURL!, seedNow.member.email);
  try {
    await test.step("Ports, Agents and Setup tabs render governed data", async () => {
      await member.page.goto("/dashboard/ports-da");
      await expect(member.page.getByRole("heading", { name: "Ports Cost Estimator" })).toBeVisible({ timeout: 90_000 });
      await member.page.getByRole("tab", { name: "Ports" }).click();
      await expect(member.page.getByRole("heading", { name: "Ports", exact: true })).toBeVisible({ timeout: 60_000 });
      await member.page.getByRole("tab", { name: "Agents" }).click();
      await expect(member.page.getByRole("heading", { name: "Port agents" })).toBeVisible({ timeout: 60_000 });
      await expect(member.page.getByText(`Portal Agency ${seedNow.stamp.toUpperCase()}`)).toBeVisible({ timeout: 60_000 });
      await member.page.getByRole("tab", { name: "Setup" }).click();
      await expect(member.page.getByRole("heading", { name: "What you see" })).toBeVisible({ timeout: 60_000 });
      await member.page.screenshot({ path: "test-results/pda-agents/setup.png", fullPage: true });
    });

    await test.step("save the estimate and ask both agencies for a quote", async () => {
      await pricedRoute(member.page, seedNow);
      await member.page.getByRole("button", { name: "Save estimate" }).click();
      await expect(member.page.locator(".pda-save__done")).toContainText("Saved", { timeout: 90_000 });
      const history = member.page.getByRole("region", { name: "Saved estimates" });
      await history.getByRole("button", { name: "Quotes" }).first().click();
      const ask = member.page.getByRole("region", { name: "Request quotes from port agents" });
      await ask.getByRole("checkbox", { name: `Portal Agency ${seedNow.stamp.toUpperCase()}` }).check();
      await ask.getByRole("checkbox", { name: `Email Agency ${seedNow.stamp.toUpperCase()}` }).check();
      await ask.getByRole("button", { name: "Send request" }).click();
      await expect(ask).toContainText("Sent to 2 agencies.", { timeout: 60_000 });
      await member.page.screenshot({ path: "test-results/pda-agents/requested.png", fullPage: true });
    });
  } finally {
    await member.context.close();
  }

  const staff = await signIn(browser, baseURL!, seedNow.staff.email);
  try {
    await test.step("the agency answers in its inbox, masked", async () => {
      await staff.page.goto("/dashboard/agency");
      await expect(staff.page.getByRole("heading", { name: new RegExp(`Portal Agency ${seedNow.stamp.toUpperCase()} · quote requests`) })).toBeVisible({ timeout: 90_000 });
      await expect(staff.page.locator("section.pda-agency")).not.toContainText(seedNow.vesselName);
      const card = staff.page.locator(".pda-agency__card").first();
      await expect(card).toContainText("Member (identity not shared)");
      await card.getByLabel("Amount").first().fill("1250.50");
      await card.getByLabel("Valid until").fill(new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10));
      await card.getByRole("button", { name: "Send quote" }).click();
      await expect(staff.page.locator(".pda-agency__card").first()).toContainText("revision 1", { timeout: 60_000 });
      await staff.page.screenshot({ path: "test-results/pda-agents/agency-inbox.png", fullPage: true });
    });
  } finally {
    await staff.context.close();
  }

  const desk = await signIn(browser, baseURL!, seedNow.admin.email);
  try {
    await test.step("the desk records the other agency's emailed quote", async () => {
      await desk.page.goto("/admin/port-agents");
      const item = desk.page.locator("article").filter({ hasText: `Email Agency ${seedNow.stamp.toUpperCase()}` }).filter({ has: desk.page.getByRole("button", { name: "Record quote" }) });
      await expect(item).toBeVisible({ timeout: 90_000 });
      await item.getByLabel("Amount 1").fill("1180");
      await item.getByLabel("Valid until").fill(new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10));
      await item.getByPlaceholder(/Source/).fill(`Email from ops@email-agency.test, run ${seedNow.stamp}`);
      await item.getByRole("button", { name: "Record quote" }).click();
      await expect(desk.page.getByText("Quote recorded; the member has been notified")).toBeVisible({ timeout: 60_000 });
    });
  } finally {
    await desk.context.close();
  }

  const back = await signIn(browser, baseURL!, seedNow.member.email);
  try {
    await test.step("the member compares and accepts one quote into a new version", async () => {
      await back.page.goto("/dashboard/ports-da");
      const history = back.page.getByRole("region", { name: "Saved estimates" });
      await expect(history.getByRole("button", { name: "Quotes" }).first()).toBeVisible({ timeout: 90_000 });
      await history.getByRole("button", { name: "Quotes" }).first().click();
      const request = back.page.getByRole("region", { name: `Quote request for ${seedNow.loadLocode}` });
      await expect(request).toContainText("USD 1,250.50", { timeout: 60_000 });
      await expect(request).toContainText("recorded by Arab ShipBroker from the agency's email");
      await expect(request).toContainText("your estimate");
      await request.getByRole("listitem").filter({ hasText: `Portal Agency ${seedNow.stamp.toUpperCase()}` }).getByRole("button", { name: "Accept as new version" }).click();
      await expect(request.getByRole("group", { name: "Confirm the new version" })).toBeVisible({ timeout: 90_000 });
      await request.getByRole("button", { name: "Save the new version" }).click();
      await expect(history).toContainText("latest version", { timeout: 90_000 });
      await back.page.screenshot({ path: "test-results/pda-agents/accepted.png", fullPage: true });
    });
  } finally {
    await back.context.close();
  }
});
