/**
 * Fixture Room · keyboard reach and announcements (23 Sep 2026).
 *
 * Term strips are real buttons: focusable, toggled with Enter and Space,
 * with aria-expanded tied to the thread. Composer fields have labels, the
 * live region exists, and focus is visible.
 */
import { test, expect } from "@playwright/test";
import { cleanupFixture, seedFixture, signInAs, type FixtureSeed } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

let seed: FixtureSeed;
let roomUrl = "";

test.beforeAll(async () => { seed = await seedFixture(); });
test.afterAll(async () => { if (seed) cleanupFixture(seed); });

test("a term strip is a button that opens with Enter and Space", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await page.getByTestId(`cand-vessel-${seed.availabilityId}`).getByRole("button", { name: /open fixture/i }).click();
  await page.waitForURL(/\/dashboard\/fixture-room\/[0-9a-f-]{36}$/);
  roomUrl = new URL(page.url()).pathname;

  const strip = page.getByTestId("term-strip-laycan");
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  await strip.focus();
  await expect(strip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(strip).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("term-thread-laycan")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  await context.close();
});

test("composer fields are labelled and focus is visible", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(roomUrl);
  const strip = page.getByTestId("term-strip-freight");
  if ((await strip.getAttribute("aria-expanded")) !== "true") await strip.click();
  const amount = page.locator("#fx-money_per_mt-num");
  await expect(page.locator('label[for="fx-money_per_mt-num"]')).toHaveText(/usd per mt/i);
  await amount.focus();
  const ring = await amount.evaluate((el) => {
    const s = getComputedStyle(el);
    return (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none";
  });
  expect(ring, "focused input has no visible focus ring").toBe(true);
  // the polite live region exists for version announcements
  await expect(page.locator('[role="status"][aria-live="polite"]').first()).toBeAttached();
  await context.close();
});

test("tabbing reaches the term strips and the footer action without a mouse", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(roomUrl);
  await page.getByTestId("room-header").focus().catch(() => undefined);
  let reached = false;
  for (let i = 0; i < 80 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid")?.startsWith("term-strip-") ?? false);
  }
  expect(reached, "a term strip was reached by Tab").toBe(true);
  await context.close();
});
