// PDA · the Ports Module pages and the ?tab= contract in a real browser (Codex C2ALL-164 P1-1 / P2-3), bounded:
//   an entitled member opens the nine new routes and each renders its own heading (or its honest "not found");
//   every cross-page link that names a tab lands on that tab, a reload keeps it, an invalid tab never wins;
//   a T1 member meets the tier lock. Two users are seeded, stamped with the agents run id when one is given (the
//   runner's teardown removes them on staging) or with a local stamp the spec removes itself.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createBoundTestUser } from "./e2e-auth";
import { resolveTarget, type E2ETarget } from "./e2e-db";

const PASSWORD = "e2e-PDA-Nav-Passw0rd!";
const UUID_NONE = "00000000-0000-4000-8000-000000000000";

function service(): { db: SupabaseClient; target: E2ETarget } {
  const target = resolveTarget();
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("E2E_SUPABASE_SERVICE_ROLE_KEY is required");
  return { db: createClient(target.apiUrl, key, { auth: { persistSession: false } }), target };
}
/** the agents runner's run id when this spec runs under it (its teardown removes `e2e-<run>-%`), else a local stamp */
function stamp(): { run: string; local: boolean } {
  const run = process.env.E2E_RUN_ID ?? "";
  if (/^pdaag-[0-9a-f]{12}$/.test(run)) return { run, local: false };
  return { run: `pdanav-${Array.from({ length: 12 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`, local: true };
}
const must = <T,>(label: string, result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.message ?? "no data"}`);
  return result.data as NonNullable<T>;
};

interface Seed { run: string; local: boolean; member: { id: string; email: string }; basic: { id: string; email: string }; port: { locode: string; name: string } }
let seed: Seed;

async function user(db: SupabaseClient, target: E2ETarget, email: string, row: Record<string, unknown>) {
  const { data, error } = await createBoundTestUser(db, target, { email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
  must(`users row ${email}`, await db.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, is_active: true, ...row }).select("id").single());
  return { id: data.user.id, email };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { db, target } = service();
  const { run, local } = stamp();
  const member = await user(db, target, `e2e-${run}-nav-m@arabshipbroker.test`, { full_name: "E2E Nav Member", role: "cargo_owner", subscription_tier: "T3" });
  const basic = await user(db, target, `e2e-${run}-nav-t1@arabshipbroker.test`, { full_name: "E2E Nav Basic", role: "cargo_owner", subscription_tier: "T1" });
  // any active, verified port of the network is enough for the record and settings routes
  const port = must("a port", await db.from("ports").select("locode, trade_name").eq("is_active", true).eq("is_verified", true).order("trade_name").limit(1).single());
  seed = { run, local, member, basic, port: { locode: port.locode as string, name: port.trade_name as string } };
});

test.afterAll(async () => {
  if (!seed?.local) return; // under the agents runner the checked-in teardown removes `e2e-<run>-%`
  const { db } = service();
  const ids = [seed.member.id, seed.basic.id];
  await db.from("platform_events").delete().in("user_id", ids);
  await db.from("users").delete().in("id", ids);
  for (const id of ids) await db.auth.admin.deleteUser(id);
});

async function login(browser: Browser, email: string, baseURL: string): Promise<Page> {
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
  const cookie = page.getByRole("dialog", { name: "Cookie consent" });
  if (await cookie.isVisible().catch(() => false)) await cookie.getByRole("button", { name: "Necessary only" }).click();
  const checkin = page.getByRole("dialog", { name: "Vessel position check-in" });
  await checkin.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await checkin.isVisible().catch(() => false)) await checkin.getByRole("button", { name: "Remind me later" }).click();
  return page;
}

const selectedTab = (page: Page) => page.getByRole("tab", { selected: true });

test("an entitled member opens the nine Ports Module routes", async ({ browser, baseURL }) => {
  const page = await login(browser, seed.member.email, baseURL!);
  const routes: Array<[string, string]> = [
    ["/dashboard/ports-da/hub", "Two calls, one estimate"],
    ["/dashboard/ports-da/hub?arm=setup", "Ports Module"],
    ["/dashboard/ports-da/directory", "Port Directory"],
    ["/dashboard/ports-da/map", "Ports Map"],
    ["/dashboard/ports-da/tariff-packs", "Tariff Packs"],
    ["/dashboard/ports-da/tariff-layouts", "Tariff Layouts"],
    [`/dashboard/ports-da/ports/${seed.port.locode}`, seed.port.name],
    [`/dashboard/ports-da/ports/${seed.port.locode}/settings`, `${seed.port.name} — port settings`],
  ];
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 90_000 });
  }
  // unknown records say so instead of failing
  await page.goto(`/dashboard/ports-da/agents/${UUID_NONE}`);
  await expect(page.locator(".pdr-missing__t")).toBeVisible({ timeout: 90_000 });
  await page.goto("/dashboard/ports-da/tariff-packs/not-a-pack");
  await expect(page.locator(".pdr-missing__t")).toBeVisible({ timeout: 90_000 });
  await page.context().close();
});

test("every link that names a tab lands on it; the URL follows; an invalid tab never wins", async ({ browser, baseURL }) => {
  const page = await login(browser, seed.member.email, baseURL!);
  for (const [tab, label] of [["agents", "Agents"], ["ports", "Ports"], ["setup", "Setup"], ["estimate", "Estimate"]] as const) {
    await page.goto(`/dashboard/ports-da?tab=${tab}`);
    await expect(selectedTab(page)).toHaveText(new RegExp(label), { timeout: 90_000 });
  }
  await page.goto("/dashboard/ports-da?tab=bogus");
  await expect(selectedTab(page)).toHaveText(/Estimate/, { timeout: 90_000 }); // the default start tab, never a guess
  // a switch writes the tab back; a reload keeps it
  await page.getByRole("tab", { name: "Ports" }).click();
  await expect(page).toHaveURL(/[?&]tab=ports(&|$)/);
  await page.reload();
  await expect(selectedTab(page)).toHaveText(/Ports/, { timeout: 90_000 });
  // the hub's Agents tool and the port record's back link
  await page.goto("/dashboard/ports-da/hub?arm=setup");
  await page.getByRole("link", { name: /^Agents/ }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/ports-da\?.*tab=agents/);
  await expect(selectedTab(page)).toHaveText(/Agents/, { timeout: 90_000 });
  await page.goto(`/dashboard/ports-da/ports/${seed.port.locode}`);
  await page.locator(".pd-back").first().click();
  await expect(page).toHaveURL(/\/dashboard\/ports-da\?.*tab=ports/);
  await expect(selectedTab(page)).toHaveText(/Ports/, { timeout: 90_000 });
  await page.context().close();
});

test("a T1 member meets the tier lock on the module's pages", async ({ browser, baseURL }) => {
  const page = await login(browser, seed.basic.email, baseURL!);
  for (const path of ["/dashboard/ports-da/hub", "/dashboard/ports-da/directory", "/dashboard/ports-da/tariff-layouts"]) {
    await page.goto(path);
    await expect(page.locator(".locked-title")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1, name: /Port Directory|Tariff Layouts|Two calls/ })).toHaveCount(0);
  }
  await page.context().close();
});
