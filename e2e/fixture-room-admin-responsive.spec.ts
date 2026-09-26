/**
 * Admin → Fixture rooms · layout at 390, 768, 1280 and 1440 px (26 Sep 2026).
 *
 * No horizontal page scroll on the list or the room page at any width: wide
 * tables scroll inside their container, the room's forms wrap, and the
 * close button stays reachable on a phone.
 */
import { test, expect as baseExpect } from "@playwright/test";
// The production server renders the console through governed RPCs; on a loaded machine a
// navigation can take longer than the shared 10 s expect budget. Every assertion here is
// about rendered or persisted state, so a wide budget hides nothing.
const expect = baseExpect.configure({ timeout: 60_000 });
import { buildTermCatalogue, FIXTURE_TERM_CATALOGUE_VERSION } from "../lib/fixture-room/terms";
import { apiClientAs, cleanupAdmin, cleanupFixture, seedAdmin, seedFixture, signInAs, type AdminSeed, type FixtureSeed } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 180_000 });

let seed: FixtureSeed;
let admin: AdminSeed;
let roomId = "";

test.beforeAll(async () => {
  seed = await seedFixture();
  admin = await seedAdmin(seed.stamp);
  const ch = await apiClientAs(seed.charterer.email);
  const created = await ch.rpc("create_fixture_room", {
    p_cargo_listing_id: seed.cargoId, p_vessel_availability_id: seed.availabilityId, p_terms: buildTermCatalogue(null),
    p_idempotency_key: `e2e-admin-resp-create-${seed.stamp}`, p_options: { catalogueVersion: FIXTURE_TERM_CATALOGUE_VERSION },
  });
  if (created.error) throw new Error(`create_fixture_room: ${created.error.message}`);
  roomId = (created.data as { data: { roomId: string } }).data.roomId;
  const version = (created.data as { version: number }).version;
  const posted = await ch.rpc("post_fixture_message", {
    p_room_id: roomId, p_body: `Charterer note ${seed.stamp}: layout`, p_kind: "note", p_visibility: "room", p_term_id: null,
    p_expected_version: version, p_idempotency_key: `e2e-admin-resp-msg-${seed.stamp}`, p_as_party_id: null,
  });
  if (posted.error) throw new Error(`post_fixture_message: ${posted.error.message}`);
});
test.afterAll(async () => { if (seed) cleanupFixture(seed); if (admin) cleanupAdmin(admin); });

const pageOverflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [390, 768, 1280, 1440]) {
  test(`${width}px: the rooms list has no horizontal page scroll; a wide table scrolls inside its container`, async ({ browser, baseURL }) => {
    const { context, page } = await signInAs(browser, baseURL!, admin.email);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/fixtures?filter=all");
    await expect(page.getByTestId("fixtures-table")).toBeVisible();
    await expect(page.getByTestId(`fixtures-row-${roomId}`)).toBeAttached();
    const overflow = await pageOverflow(page);
    expect(overflow, `horizontal page overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    const wrap = page.getByTestId("fixtures-table").locator(".adm-table").first();
    const scrolls = await wrap.evaluate((el) => ({ inner: el.scrollWidth > el.clientWidth + 1, overflowX: getComputedStyle(el).overflowX }));
    if (width <= 768 && scrolls.inner) {
      expect(["auto", "scroll"], `at ${width}px the table container must scroll, not the page`).toContain(scrolls.overflowX);
    }
    await context.close();
  });

  test(`${width}px: the room page has no horizontal page scroll and the close button is reachable`, async ({ browser, baseURL }) => {
    const { context, page } = await signInAs(browser, baseURL!, admin.email);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/admin/fixtures/${roomId}`);
    await expect(page.getByTestId("fixtures-room-card")).toBeVisible();
    const overflow = await pageOverflow(page);
    expect(overflow, `horizontal page overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    // the redaction form and the close form stay inside the viewport
    for (const id of ["fixtures-messages", "fixtures-close"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} is laid out`).toBeTruthy();
      expect(box!.x + box!.width, `${id} fits the ${width}px viewport`).toBeLessThanOrEqual(width + 1);
    }
    const closeButton = page.getByTestId("fixtures-close-form").getByRole("button", { name: /close room/i });
    await closeButton.scrollIntoViewIfNeeded();
    await expect(closeButton).toBeVisible();
    const b = await closeButton.boundingBox();
    expect(b!.x + b!.width, "close button inside the viewport").toBeLessThanOrEqual(width + 1);
    await context.close();
  });
}
