/**
 * Fixture Room · the negotiation, in two browsers (23 Sep 2026).
 *
 * Two real member seats on opposite sides: the charterer opens a room from
 * the match builder, the owner accepts the invitation, bids and offers cross,
 * a stale tab is refused with the conflict banner, one accepted offer becomes
 * the agreed value, a recap is published and acknowledged. Every assertion is
 * about persisted state read back through the server, never about the
 * optimistic UI.
 *
 * Runs against the local stack only (see fixture-room.helpers.ts). Uses no
 * shared storage state: each context signs in through the real form.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";

// Dev-mode server actions take 5–15 s on the local stack, 20–30 s when the shared stack is
// under load (observed 26 Sep 2026: a room page in 81 s, 60 s of it in the auth proxy); a
// command refetches the room, so an assertion that follows a command needs that budget twice.
// Every assertion is about persisted state, so a wide budget hides nothing: a wrong state
// stays wrong however long the wait.
const expect = baseExpect.configure({ timeout: 180_000 });   // 27–28 Sep 2026: <600 MB free on the runner, one accept took >90 s
import { apiClientAs, cleanupFixture, dismissOverlays, seedFixture, signInAs, type FixtureSeed } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
// Two browsers, about fifteen governed round trips and two sign-ins: on the loaded local machine
// (26–27 Sep 2026: statement timeouts in the portal loaders under six suites) 180 s runs out before
// the stale-tab step; the assertions are about persisted state, so the wider budget hides nothing.
test.describe.configure({ mode: "serial", timeout: 600_000 });

let seed: FixtureSeed;
let roomUrl = "";

test.beforeAll(async () => { seed = await seedFixture(); });
test.afterAll(async () => { if (seed) cleanupFixture(seed); });

async function openTerm(page: Page, code: string) {
  await dismissOverlays(page);
  const strip = page.getByTestId(`term-strip-${code}`);
  if ((await strip.getAttribute("aria-expanded")) !== "true") await strip.click();
  await expect(page.getByTestId(`term-thread-${code}`)).toBeVisible();
}

test("the charterer opens a room from the match builder", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await expect(page.getByTestId("match-builder")).toBeVisible();
  // the pre-seeded side is locked and the owner's position is a ranked candidate
  await expect(page.locator(".fxm__lockedtag")).toHaveText("Your side · fixed");
  const cand = page.getByTestId(`cand-vessel-${seed.availabilityId}`);
  await expect(cand).toBeVisible();
  await cand.getByRole("button", { name: /open fixture/i }).click();
  await page.waitForURL(/\/dashboard\/fixture-room\/[0-9a-f-]{36}$/);
  roomUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("room-status")).toHaveText(/invited/i);
  await expect(page.getByTestId("room-version")).toHaveText("v2");
  await expect(page.getByTestId("counterparty-chip")).toContainText(/owner side via asb/i);
  // six terms, none agreed
  await expect(page.getByTestId(/^term-row-/)).toHaveCount(6);
  await context.close();
});

test("the owner sees the invitation in the inbox and accepts", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.owner.email);
  await page.goto("/dashboard/fixture-room");
  await dismissOverlays(page);
  await expect(page.getByTestId("inbox-list")).toBeVisible();
  await expect(page.getByText("Invitation")).toBeVisible();
  await page.goto(roomUrl);
  await dismissOverlays(page);
  await expect(page.getByTestId("invitation-banner")).toBeVisible();
  // an invited party cannot negotiate yet: no composer on any term
  await openTerm(page, "freight");
  await expect(page.getByTestId("composer-freight")).toHaveCount(0);
  await dismissOverlays(page);
  await page.getByTestId("invitation-accept").click();
  await expect(page.getByTestId("invitation-banner")).toHaveCount(0);
  await expect(page.getByTestId("room-version")).toHaveText("v3");
  await context.close();
});

test("bid, counter-offer, stale tab refused, accept → one agreed value", async ({ browser, baseURL }) => {
  const ch = await signInAs(browser, baseURL!, seed.charterer.email);
  const ow = await signInAs(browser, baseURL!, seed.owner.email);
  await ch.page.goto(roomUrl);
  await ow.page.goto(roomUrl);
  await dismissOverlays(ch.page);
  await dismissOverlays(ow.page);

  // charterer bids on freight
  await openTerm(ch.page, "freight");
  await ch.page.locator("#fx-money_per_mt-num").fill("24.5");
  await ch.page.getByTestId("submit-freight").click();
  await expect(ch.page.getByTestId("room-status")).toHaveText(/negotiating/i);
  await expect(ch.page.getByTestId("term-holder-freight")).toHaveText(/→ vessel/i);

  // the owner's tab picks the bid up by polling (no reload)
  await expect(ow.page.getByTestId("term-holder-freight")).toHaveText(/your move/i, { timeout: 120_000 });
  await openTerm(ow.page, "freight");
  await expect(ow.page.getByTestId("term-thread-freight")).toContainText("$24.50/MT");

  // the owner counters while the charterer's tab is at the older version. That tab polls
  // every 5 s and would refresh itself; the poll pauses while the document is hidden (the
  // client checks document.visibilityState on every tick), so a "hidden" charterer tab is
  // provably stale when it bids. Aborting its requests instead fights the production router
  // (observed 27 Sep 2026: a hard navigation away from the room) and tests nothing real.
  const hide = (page: Page) => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const show = (page: Page) => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await hide(ch.page);
  await ow.page.locator("#fx-money_per_mt-num").fill("26.25");
  await ow.page.getByTestId("submit-freight").click();
  await expect(ow.page.getByTestId("term-holder-freight")).toHaveText(/→ cargo/i);

  // stale charterer tab: a second bid at the old version is refused, the room refreshes
  await expect(ch.page.getByTestId("term-holder-freight")).toHaveText(/→ vessel/i);   // still the old view
  await ch.page.locator("#fx-money_per_mt-num").fill("25");
  await ch.page.getByTestId("submit-freight").click();
  await show(ch.page);
  await expect(ch.page.getByTestId("conflict-banner")).toBeVisible();
  await expect(ch.page.getByTestId("term-thread-freight")).toContainText("$26.25/MT");

  // the charterer accepts the owner's offer: exactly one agreed value
  await ch.page.getByTestId("accept-freight").click();
  await expect(ch.page.getByTestId("term-row-freight")).toHaveClass(/s-agreed/);
  await expect(ch.page.getByTestId("recap-rail")).toContainText("$26.25/MT");
  await expect(ow.page.getByTestId("term-row-freight")).toHaveClass(/s-agreed/, { timeout: 120_000 });

  // the recap: published by the charterer, acknowledged by the owner
  await ch.page.getByTestId("recap-publish").click();
  await expect(ch.page.getByTestId("recap-latest")).toContainText("v1 published");
  await expect(ow.page.getByTestId("recap-ack")).toBeVisible({ timeout: 120_000 });
  await ow.page.getByTestId("recap-ack").click();
  await expect(ow.page.getByTestId("recap-latest")).toContainText(/1 acknowledgement/);

  // the activity feed shows the ledger, masked
  await expect(ch.page.getByTestId("activity-feed")).toContainText("Owner side");
  await expect(ch.page.getByTestId("activity-feed")).not.toContainText(/E2E Owners/);

  // reload reconstructs the same room from persisted state
  await ch.page.reload();
  await expect(ch.page.getByTestId("term-row-freight")).toHaveClass(/s-agreed/);
  await expect(ch.page.getByTestId("recap-latest")).toContainText("v1 published");
  await ch.context.close();
  await ow.context.close();
});

test("the printable recap renders the published version", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(`${roomUrl}/recap`);
  await dismissOverlays(page);
  await expect(page.getByTestId("recap-print")).toContainText(/fixture recap/i);
  await expect(page.getByTestId("recap-print")).toContainText("$26.25/MT");
  await expect(page.getByTestId("recap-print")).toContainText(/withheld/);
  // the negotiation summary: every round, masked, from the same read model
  await page.goto(`${roomUrl}/summary`);
  await expect(page.getByTestId("summary-print")).toContainText(/negotiation summary/i);
  await expect(page.getByTestId("summary-print")).toContainText("$24.50/MT");
  await expect(page.getByTestId("summary-print")).toContainText("$26.25/MT");
  await expect(page.getByTestId("summary-print")).not.toContainText(/E2E Owners/);
  await context.close();
});

test("a returning member sees what changed since their last visit", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(roomUrl);
  await dismissOverlays(page);
  await expect(page.getByTestId("room-header")).toBeVisible();
  await expect(page.getByTestId("new-since-banner")).toHaveCount(0);   // nothing is new on a visit with no earlier one
  await page.goto("/dashboard/fixture-room");                           // leaving the room remembers what was seen
  await expect(page.getByTestId("inbox-list")).toBeVisible();
  // meanwhile the owner writes to the room through the governed API
  const ow = await apiClientAs(seed.owner.email);
  const roomId = roomUrl.split("/").pop()!;
  const { data: version } = await ow.rpc("get_fixture_room_version", { p_room_id: roomId });
  const posted = await ow.rpc("post_fixture_message", { p_room_id: roomId, p_body: "Owners ready to lift subjects today.", p_kind: "note", p_visibility: "room", p_term_id: null, p_expected_version: version as number, p_idempotency_key: `e2e-since-${seed.stamp}`, p_as_party_id: null });
  expect(posted.error, posted.error?.message).toBeNull();
  // back in the room: the banner and the divider mark it; "Mark as seen" clears it
  await page.goto(roomUrl);
  await dismissOverlays(page);
  await expect(page.getByTestId("new-since-banner")).toContainText(/1 update since your last visit/);
  await expect(page.getByTestId("new-since-divider")).toBeVisible();
  await page.getByTestId("new-since-banner").getByRole("button", { name: /mark as seen/i }).click();
  await expect(page.getByTestId("new-since-banner")).toHaveCount(0);
  await context.close();
});
