/**
 * Fixture Room · Wave 3 in the browser (7 Oct 2026): the mediator's bridging suggestion and the standard-subject chips.
 *
 * The charterer opens a room through the governed candidate path, the owner joins, and both sides put a figure on
 * freight. The platform mediator (a seeded super admin) suggests a bridging figure from its console; the owner sees it
 * and adopts it as an ordinary offer; the charterer accepts, and the suggestion is gone with the agreement. The
 * charterer then adds a standard subject with one click and its chip disappears. Every row is removed afterwards.
 */
import { test, expect as baseExpect } from "@playwright/test";
import { buildTermCatalogue, FIXTURE_TERM_CATALOGUE_VERSION } from "../lib/fixture-room/terms";
import { apiClientAs, cleanupAdmin, cleanupFixture, dismissOverlays, openRoomViaApi, seedAdmin, seedFixture, signInAs, type AdminSeed, type FixtureSeed } from "./fixture-room.helpers";

const expect = baseExpect.configure({ timeout: 60_000 });

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 300_000 });

let seed: FixtureSeed;
let admin: AdminSeed;
let roomId = "";

test.beforeAll(async () => {
  seed = await seedFixture();
  admin = await seedAdmin(seed.stamp);
  const created = await openRoomViaApi(seed, `e2e-w3-create-${seed.stamp}`, buildTermCatalogue(null), { catalogueVersion: FIXTURE_TERM_CATALOGUE_VERSION });
  roomId = created.roomId;
  const ch = await apiClientAs(seed.charterer.email);
  const ow = await apiClientAs(seed.owner.email);
  const version = async () => ((await ch.rpc("get_fixture_room_version", { p_room_id: roomId })).data as number);
  const joined = await ow.rpc("respond_fixture_invitation", { p_room_id: roomId, p_accept: true, p_expected_version: await version(), p_idempotency_key: `e2e-w3-join-${seed.stamp}` });
  if (joined.error) throw new Error(`respond_fixture_invitation: ${joined.error.message}`);
  const room = (await ch.rpc("get_fixture_room", { p_room_id: roomId, p_events_after: 0 })).data as { terms: { id: string; code: string }[] };
  const freight = room.terms.find((t) => t.code === "freight")!.id;
  const propose = async (c: typeof ch, num: number, key: string) => {
    const r = await c.rpc("submit_fixture_proposal", { p_room_id: roomId, p_term_id: freight, p_value: { num, currency: "USD" }, p_comment: null, p_is_final: false, p_expires_in_minutes: null, p_expected_version: await version(), p_idempotency_key: `${key}-${seed.stamp}`, p_as_party_id: null, p_on_behalf_of_party_id: null });
    if (r.error) throw new Error(`submit_fixture_proposal: ${r.error.message}`);
  };
  await propose(ow, 27, "e2e-w3-offer");
  await propose(ch, 25, "e2e-w3-bid");   // the move is now the owner's
});
test.afterAll(async () => { if (seed) cleanupFixture(seed); if (admin) cleanupAdmin(admin); });

async function openTerm(page: import("@playwright/test").Page, code: string) {
  const strip = page.getByTestId(`term-strip-${code}`);
  await expect(strip).toBeVisible();
  if ((await strip.getAttribute("aria-expanded")) !== "true") await strip.click();
}

test("the mediator suggests a bridging figure from its console; it moves nothing", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto(`/dashboard/fixture-room/${roomId}`);
  await dismissOverlays(page);
  await openTerm(page, "freight");
  const form = page.getByTestId("suggest-freight");
  await expect(form).toBeVisible();
  await form.getByLabel("USD per MT").fill("26");
  await form.getByLabel("Currency").fill("USD");
  await form.getByLabel("Why this figure").fill("splits the difference");
  await form.getByTestId("suggest-send-freight").click();
  await expect(page.getByTestId("term-thread-freight")).toContainText("SUGGESTED");
  await expect(form).toContainText(/Your live suggestion: \$26\.00\/MT/);
  await expect(page.getByTestId("activity-feed")).toContainText(/suggested \$26\.00\/MT on freight/i);
  // advisory only: both standing figures are unchanged
  await expect(page.getByTestId("term-strip-freight")).toContainText("$25.00/MT");
  await expect(page.getByTestId("term-strip-freight")).toContainText("$27.00/MT");
  await context.close();
});

test("the owner adopts the suggestion as its offer; the charterer accepts and the suggestion retires", async ({ browser, baseURL }) => {
  const ow = await signInAs(browser, baseURL!, seed.owner.email);
  await ow.page.goto(`/dashboard/fixture-room/${roomId}`);
  await dismissOverlays(ow.page);
  await openTerm(ow.page, "freight");
  const banner = ow.page.getByTestId("bridge-freight");
  await expect(banner).toContainText(/suggests \$26\.00\/MT/);
  await expect(banner).toContainText("splits the difference");
  await ow.page.getByTestId("adopt-freight").click();
  await expect(ow.page.getByTestId("term-thread-freight")).toContainText("Adopted the mediator's suggestion.");
  await ow.context.close();

  const ch = await signInAs(browser, baseURL!, seed.charterer.email);
  await ch.page.goto(`/dashboard/fixture-room/${roomId}`);
  await dismissOverlays(ch.page);
  await openTerm(ch.page, "freight");
  await expect(ch.page.getByTestId("bridge-freight")).toBeVisible();   // still live until the term is agreed
  await ch.page.getByTestId("accept-freight").click();
  await expect(ch.page.getByTestId("term-strip-freight")).toContainText(/agreed/i);
  await expect(ch.page.getByTestId("bridge-freight")).toHaveCount(0);
  await ch.context.close();
});

test("a standard subject is one click, and its chip disappears", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(`/dashboard/fixture-room/${roomId}`);
  await dismissOverlays(page);
  const rail = page.getByTestId("subjects-rail");
  await expect(rail.getByTestId("subject-std-stem")).toBeVisible();
  await rail.getByTestId("subject-std-stem").click();
  await expect(rail).toContainText("Subject shippers' stem approval");
  await expect(rail.getByTestId("subject-std-stem")).toHaveCount(0);
  await expect(rail.getByTestId("subject-std-owners_management")).toBeVisible();
  await expect(rail.getByTestId("subject-std-cp_details")).toBeVisible();
  await context.close();
});
