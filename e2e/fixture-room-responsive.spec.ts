/**
 * Fixture Room · layout at 390, 768, 1280 and 1440 px (23 Sep 2026).
 *
 * No horizontal page scroll at any width; the rail sits beside the main
 * column on desktop and below it at ≤1120 px; the footer action stays
 * reachable on a phone.
 */
import { test, expect } from "@playwright/test";
import { cleanupFixture, seedFixture, signInAs, type FixtureSeed } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

let seed: FixtureSeed;
let roomUrl = "";

test.beforeAll(async () => { seed = await seedFixture(); });
test.afterAll(async () => { if (seed) cleanupFixture(seed); });

test("open a room to lay out", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await page.getByTestId("cand-vessel").filter({ hasText: seed.vesselName }).getByRole("button", { name: /open fixture/i }).click();
  await page.waitForURL(/\/dashboard\/fixture-room\/[0-9a-f-]{36}$/);
  roomUrl = new URL(page.url()).pathname;
  await context.close();
});

for (const width of [390, 768, 1280, 1440]) {
  test(`${width}px: no horizontal scroll, rail placement, footer reachable`, async ({ browser, baseURL }) => {
    const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(roomUrl);
    await expect(page.getByTestId("room-header")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    const main = await page.getByTestId("term-row-cargo_grade").boundingBox();
    const rail = await page.getByTestId("counterparty-card").boundingBox();
    expect(main && rail).toBeTruthy();
    if (width > 1120) {
      expect(rail!.x, "rail beside the main column").toBeGreaterThan(main!.x + main!.width - 1);
    } else {
      expect(rail!.y, "rail below the main column").toBeGreaterThan(main!.y);
    }
    await page.getByTestId("room-footer").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("room-footer")).toBeVisible();
    await context.close();
  });
}
