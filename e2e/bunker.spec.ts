/**
 * Fuel Bar browser proof (plan r2 §3.2, Stream B).
 *
 * An unverified supplier's editor publishes a price in the supplier portal; it
 * waits for approval and is invisible to the index; an admin approves it in
 * /admin/bunker; the sponsor then appears on the dashboard ticker and the
 * index average reflects it without naming the supplier. An outsider gets the
 * invitation page and cannot submit through the API either.
 *
 * Seeds are tagged `src:bunker-e2e` and removed in afterAll (local stack only).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PASSWORD, apiClientAs, signInAs } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 600_000 });

const PORT = "GRPIR";
const PRICE = 612;

interface Seed {
  stamp: string;
  supplierName: string;
  /** The port as the portal labels it: trade name, else the LOCODE. */
  portLabel: string;
  supplierId: string;
  editor: { email: string; userId: string };
  outsider: { email: string; userId: string };
  admin: { email: string; userId: string };
}

function localKeys() {
  let url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    service = out.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)?.[1];
    url = out.match(/^API_URL="?([^"\n]+)"?/m)?.[1] ?? url;
  }
  if (!service) throw new Error("No local service key");
  assertTarget(url);
  return { url, service };
}

// Target guard (O2B-010 P0). Local by default; hosted staging only when
// E2E_STAGING_REF names it, the API host is exactly that project, and the
// cleanup workdir is linked to it. Production is refused by ref everywhere.
const PROD_REF = "rezfejaxbmdzkslrrefr";
const STAGING_PROJECT = "sidcsytgqalqacsgyguz";
const STAGING_REF = process.env.E2E_STAGING_REF === STAGING_PROJECT ? STAGING_PROJECT : "";

function linkedRef(dir: string): string {
  try { return readFileSync(path.join(dir, "supabase", ".temp", "project-ref"), "utf8").trim(); } catch { return ""; }
}

function assertTarget(url: string) {
  const host = new URL(url).hostname;
  if (url.includes(PROD_REF)) throw new Error("Refusing to seed bunker data against production");
  if (!STAGING_REF) {
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to seed bunker data against ${host}`);
    return;
  }
  if (host !== `${STAGING_REF}.supabase.co`) throw new Error(`E2E_STAGING_REF is set but the API host is ${host}`);
  const dir = process.env.E2E_STAGING_WORKDIR ?? "";
  const ref = dir ? linkedRef(dir) : "";
  if (ref === PROD_REF) throw new Error("The cleanup workdir is linked to production");
  if (ref !== STAGING_REF) throw new Error(`The cleanup workdir must be linked to ${STAGING_REF} (found "${ref}")`);
}

async function seed(): Promise<Seed> {
  const { url, service } = localKeys();
  const db: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const stamp = Date.now().toString(36);
  const createdUsers: string[] = [];
  let createdSupplier: string | null = null;
  try {
  const mk = async (prefix: string, admin: boolean) => {
    const email = `e2e-bk-${prefix}-${stamp}@arabshipbroker.test`;
    const { data, error } = await db.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, app_metadata: { role: admin ? "admin" : "member" },
    });
    if (error || !data.user) throw new Error(`auth ${prefix}: ${error?.message}`);
    const userId = data.user.id;
    createdUsers.push(userId);
    const { error: e2 } = await db.from("users").insert({
      id: userId, supabase_user_id: userId, email, full_name: `src:bunker-e2e ${prefix}`,
      company: "src:bunker-e2e", role: admin ? "admin" : "vessel_owner", admin_tier: admin ? "super" : null,
      subscription_tier: admin ? "T4" : "T3", is_active: true,
    });
    if (e2) throw new Error(`users ${prefix}: ${e2.message}`);
    return { email, userId };
  };
  const admin = await mk("admin", true);
  const editor = await mk("editor", false);
  const outsider = await mk("outsider", false);
  const supplierName = `src:bunker-e2e Supplier ${stamp}`;
  const { data: supplierId, error } = await db.rpc("admin_bunker_upsert_supplier", {
    p_actor: admin.userId,
    p_supplier: { name: supplierName, url: "https://example.com/bunker-e2e", verified: false, status: "enabled",
                  ports: [{ locode: PORT, isPrimary: true }] },
  });
  if (error) throw new Error(`supplier: ${error.message}`);
  createdSupplier = supplierId as string;
  const { error: e3 } = await db.rpc("admin_bunker_set_member", {
    p_actor: admin.userId, p_supplier_id: supplierId, p_user_id: editor.userId, p_role: "editor",
  });
  if (e3) throw new Error(`member: ${e3.message}`);
  // The portal labels prices by the port's trade name ("Piraeus" on production
  // data), falling back to the LOCODE when the ports row has none (local stack).
  const { data: portRow } = await db.from("ports").select("trade_name").eq("locode", PORT).maybeSingle();
  const portLabel = (portRow?.trade_name as string | null | undefined) || PORT;
  return { stamp, supplierName, portLabel, supplierId: supplierId as string, editor, outsider, admin };
  } catch (e) {
    // A seed that fails half-way removes what it created before failing the run.
    cleanupIds(stamp, createdUsers, createdSupplier);
    throw e;
  }
}

function cleanup(s: Seed) {
  cleanupIds(s.stamp, [s.editor.userId, s.outsider.userId, s.admin.userId], s.supplierId);
}

// Removes exactly what a seed created, also a partial seed (C2O-049): users by id,
// the supplier and everything hanging off it when it exists.
function cleanupIds(stamp: string, userIds: string[], supplierId: string | null) {
  if (!userIds.length && !supplierId) return;
  const ids = userIds.length ? userIds.map((x) => `'${x}'`).join(",") : "null";
  const supplierSql = supplierId ? `
delete from public.bunker_quote_supersessions where approved_quote_id in (select id from public.bunker_quotes where supplier_id = '${supplierId}')
   or superseded_quote_id in (select id from public.bunker_quotes where supplier_id = '${supplierId}');
delete from public.bunker_quote_events where supplier_id = '${supplierId}';
delete from public.bunker_quotes where supplier_id = '${supplierId}';
delete from public.bunker_supplier_members where supplier_id = '${supplierId}';
delete from public.bunker_supplier_ports where supplier_id = '${supplierId}';
delete from public.bunker_suppliers where id = '${supplierId}';` : "";
  // Quotes and events are append-only by trigger; replica mode bypasses it for test teardown.
  const sql = `
set session_replication_role = replica;${supplierSql}
delete from public.profiles where account_id in (${ids});
delete from public.users where id in (${ids});
delete from auth.users where id in (${ids});
`;
  if (STAGING_REF) {
    // Hosted staging: one linked query; a failure must be visible, not swallowed.
    const dir = process.env.E2E_STAGING_WORKDIR ?? "";
    if (linkedRef(dir) !== STAGING_REF) throw new Error("Refusing to clean: the workdir is not linked to staging");
    // Hosted postgres is not a superuser: instead of replica mode, the table owner
    // disables only the two append-only guards for this one transaction (O2ALL-001 §D).
    const hosted = sql.replace("set session_replication_role = replica;",
      "alter table public.bunker_quotes disable trigger trg_bunker_quote_append_only;\n" +
      "alter table public.bunker_quote_events disable trigger trg_bunker_event_immutable;");
    const file = path.join(os.tmpdir(), `bunker-e2e-cleanup-${stamp}.sql`);
    writeFileSync(file, `begin;\n${hosted}\n` +
      "alter table public.bunker_quotes enable trigger trg_bunker_quote_append_only;\n" +
      "alter table public.bunker_quote_events enable trigger trg_bunker_event_immutable;\ncommit;\n");
    try {
      execSync(`supabase db query --linked --workdir "${dir}" --file "${file}"`, { stdio: ["ignore", "ignore", "inherit"] });
    } finally {
      rmSync(file, { force: true });
    }
    return;
  }
  try {
    execSync("docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0",
      { input: sql, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // local disposable data; a leftover is visible by its src:bunker-e2e tag
  }
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let s: Seed;
const base = (b: { baseURL?: string }) => b.baseURL ?? "http://127.0.0.1:3102";

test.beforeAll(async () => { s = await seed(); });
test.afterAll(async () => { if (s) cleanup(s); });

async function signedIn(browser: Browser, baseURL: string, email: string) {
  return signInAs(browser, baseURL, email);
}

// The login transition can still push /dashboard after we navigate away
// (see fixture-room.helpers signInAs); retry until the requested URL sticks.
async function gotoStable(page: Page, path: string) {
  for (let i = 0; i < 3; i++) {
    await page.goto(path);
    if (await page.waitForURL((u) => u.pathname === path, { timeout: 10_000 }).then(() => true).catch(() => false)) {
      await page.waitForTimeout(500);
      if (new URL(page.url()).pathname === path) return;
    }
  }
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/]/g, "\/")}$`));
}

test("outsider gets the invitation page and cannot submit through the API", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.outsider.email);
  await gotoStable(page, "/dashboard/bunker-supplier");
  await expect(page.getByRole("heading", { name: "Bunker prices" })).toBeVisible();
  await expect(page.getByText("Supplier access is by invitation")).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact us to join" })).toBeVisible();
  await context.close();

  const api = await apiClientAs(s.outsider.email);
  const { error } = await api.rpc("supplier_upsert_quotes", {
    p_quotes: [{ portLocode: PORT, productKey: "VLSFO", priceUsdMt: 1, clientRef: "outsider-1",
                 validUntil: new Date(Date.now() + 864e5).toISOString() }],
    p_supplier_id: s.supplierId,
  });
  expect(error?.code).toBe("42501");
});

test("supplier publishes; the quote waits for approval and stays out of the index", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.editor.email);
  await gotoStable(page, "/dashboard/bunker-supplier");
  await expect(page.getByRole("heading", { name: s.supplierName })).toBeVisible();
  await expect(page.getByText("Prices are reviewed before going live")).toBeVisible();
  await page.getByLabel(new RegExp(`New VLSFO price at ${escapeRe(s.portLabel)}`)).fill(String(PRICE));
  await page.getByRole("button", { name: "Publish new prices" }).click();
  await expect(page.getByRole("status")).toContainText("go live after Arab ShipBroker approves");
  await expect(page.getByText(`$${PRICE} awaiting approval`)).toBeVisible();
  await context.close();

  const api = await apiClientAs(s.editor.email);
  const { data } = await api.rpc("get_fuel_price_index", { p_port_locode: PORT, p_product_keys: ["VLSFO"] });
  const vlsfo = (data as { products: { key: string; averageUsdMt: number }[] }).products.find((p) => p.key === "VLSFO");
  expect(vlsfo?.averageUsdMt ?? null).not.toBe(PRICE);
});

test("admin approves in /admin/bunker; the price goes live", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.admin.email);
  await gotoStable(page, "/admin/bunker");
  await expect(page.getByText("Awaiting approval").first()).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: s.supplierName });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toContainText("Quote approved");
  const live = page.getByRole("row").filter({ hasText: s.supplierName });
  await expect(live).toContainText(`$${PRICE}`);
  await expect(live).toContainText("Current");
  await page.getByRole("link", { name: /Suppliers & access/ }).click();
  await expect(page.getByText("Pilot suppliers: replace the sample details")).toBeVisible();
  await expect(page.getByText("Placeholder details").first()).toBeVisible();
  await page.getByRole("link", { name: /Update history/ }).click();
  await expect(page.getByRole("row").filter({ hasText: s.supplierName }).first()).toBeVisible();
  await context.close();
});

test("the sponsor appears on the dashboard ticker; the index averages without naming it", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.outsider.email);
  const ticker = page.getByRole("region", { name: "Bunker prices ticker" });
  await expect(ticker).toBeVisible();
  const seg = ticker.locator(".bt-seg", { hasText: s.supplierName }).first();
  await expect(seg).toContainText("VLSFO");
  await expect(seg).toContainText(`$${PRICE}/MT`);
  await expect(seg.getByRole("link", { name: new RegExp(s.supplierName) })).toHaveAttribute("href", "https://example.com/bunker-e2e");
  await context.close();

  const api = await apiClientAs(s.outsider.email);
  const { data, error } = await api.rpc("get_fuel_price_index", { p_port_locode: PORT, p_product_keys: ["VLSFO"] });
  expect(error).toBeNull();
  const idx = data as { scope: string; port: string | null; contributingPorts: string[]; products: { key: string; averageUsdMt: number; quoteCount: number; cohortSuppressed: boolean; minUsdMt: number | null }[] };
  expect(idx.scope).toBe("port");
  expect(idx.port).toBe(PORT); // C2O-033: a port scope names only a port that supplied the result
  expect(idx.contributingPorts).toContain(PORT);
  const vlsfo = idx.products.find((p) => p.key === "VLSFO")!;
  expect(vlsfo.averageUsdMt).toBeGreaterThan(0);
  if (vlsfo.quoteCount === 1) expect(vlsfo.averageUsdMt).toBe(PRICE);
  if (vlsfo.quoteCount < 3) {
    expect(vlsfo.cohortSuppressed).toBe(true);
    expect(vlsfo.minUsdMt).toBeNull();
  }
  expect(JSON.stringify(data)).not.toContain(s.supplierName);
  expect(JSON.stringify(data)).not.toContain(s.supplierId);
});

test("an unavailable feed says so instead of 'no offer'", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.outsider.email);
  await page.route("**/rest/v1/rpc/get_bunker_ticker", (r) => r.fulfill({ status: 500, body: "{}" }));
  await page.reload();
  const ticker = page.getByRole("region", { name: "Bunker prices ticker" });
  await expect(ticker).toContainText("Bunker prices are temporarily unavailable");
  await expect(ticker).not.toContainText("No current bunker offer");
  await context.close();
});

test("ticker: one focusable copy, pauses on keyboard focus, static under reduced motion", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.outsider.email);
  const ticker = page.getByRole("region", { name: "Bunker prices ticker" });
  await expect(ticker.getByRole("link", { name: new RegExp(s.supplierName) })).toHaveCount(1);
  await expect(ticker.getByRole("link", { name: /Contact us to join/ })).toHaveCount(1);
  await ticker.getByRole("link", { name: new RegExp(s.supplierName) }).focus();
  await expect(ticker.locator(".bt-track")).toHaveCSS("animation-play-state", "paused");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(ticker.locator(".bt-track")).toHaveCSS("animation-name", "none");
  await expect(ticker.locator(".bt-copy--dup")).toBeHidden();
  await context.close();
});

test("supplier portal fits a phone screen", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.editor.email);
  await page.setViewportSize({ width: 375, height: 780 });
  await gotoStable(page, "/dashboard/bunker-supplier");
  await expect(page.getByRole("heading", { name: s.supplierName })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const main = document.querySelector(".bks") as HTMLElement;
    return main.scrollWidth - main.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByLabel(new RegExp(`New VLSFO price at ${escapeRe(s.portLabel)}`))).toBeVisible();
  await context.close();
});

test("a retry after a lost response replays instead of duplicating (C2B-003 #2)", async ({ browser }, info) => {
  const { context, page } = await signedIn(browser, base(info.project.use), s.editor.email);
  await gotoStable(page, "/dashboard/bunker-supplier");
  await expect(page.getByRole("heading", { name: s.supplierName })).toBeVisible();
  // Let the first server action reach the server, then drop its response.
  let dropped = false;
  await page.route("**/dashboard/bunker-supplier", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.getByLabel(new RegExp(`New HSFO 380 price at ${escapeRe(s.portLabel)}`)).fill("533");
  await page.getByRole("button", { name: "Publish new prices" }).click();
  await expect(page.locator(".bks-notice--error")).toContainText("will not be duplicated");
  await page.getByRole("button", { name: "Publish new prices" }).click();
  await expect(page.getByRole("status")).toContainText("go live after Arab ShipBroker approves");
  await context.close();

  const { url, service } = localKeys();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const { count } = await db.from("bunker_quotes").select("id", { count: "exact", head: true })
    .eq("supplier_id", s.supplierId).eq("product_key", "HSFO380").eq("price", 533);
  expect(count).toBe(1);
});

test("a scheduled replacement shows beside the live price; each has its own action (C2O-049)", async ({ browser }, info) => {
  const { url, service } = localKeys();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const day = 86_400_000;
  const { data: q, error } = await db.from("bunker_quotes").insert({
    supplier_id: s.supplierId, port_locode: PORT, product_key: "VLSFO", price: PRICE + 20,
    valid_from: new Date(Date.now() + 2 * day).toISOString(), valid_until: new Date(Date.now() + 9 * day).toISOString(),
    source: "admin_input", status: "submitted",
  }).select("id").single();
  expect(error).toBeNull();
  const { error: approveError } = await db.rpc("admin_bunker_decide_quote", {
    p_actor: s.admin.userId, p_quote_id: q!.id, p_decision: "approve", p_reason: null,
  });
  expect(approveError).toBeNull();

  // Admin: the live price stays under "Live prices"; the replacement is listed as scheduled.
  const admin = await signedIn(browser, base(info.project.use), s.admin.email);
  await gotoStable(admin.page, "/admin/bunker");
  await expect(admin.page.getByRole("row").filter({ hasText: s.supplierName }).filter({ hasText: `$${PRICE}` }).first()).toContainText("Current");
  const scheduledSection = admin.page.getByRole("region", { name: "Scheduled prices" });
  await expect(scheduledSection).toBeVisible();
  await expect(scheduledSection.getByRole("row").filter({ hasText: s.supplierName })).toContainText(`$${PRICE + 20}`);
  await expect(scheduledSection.getByText("Scheduled · from").first()).toBeVisible();
  await admin.context.close();

  // Supplier: both are visible; cancelling the scheduled one keeps the live price.
  const { context, page } = await signedIn(browser, base(info.project.use), s.editor.email);
  await gotoStable(page, "/dashboard/bunker-supplier");
  await expect(page.getByTestId("scheduled-price")).toContainText(`$${PRICE + 20}`);
  await expect(page.getByText(`$${PRICE} · Current`)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Cancel the scheduled VLSFO price at ${escapeRe(s.portLabel)}`) }).click();
  await expect(page.getByRole("status")).toContainText("the current price stays live");
  await expect(page.getByTestId("scheduled-price")).toHaveCount(0);
  await expect(page.getByText(`$${PRICE} · Current`)).toBeVisible();
  await context.close();

  const { data: rows } = await db.from("bunker_quotes").select("price,status,superseded_at")
    .eq("supplier_id", s.supplierId).eq("product_key", "VLSFO").eq("status", "approved");
  expect(rows?.find((r) => Number(r.price) === PRICE)?.superseded_at ?? null).toBeNull();
});
