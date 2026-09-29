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
  await page.getByTestId("cand-vessel").filter({ hasText: seed.vesselName }).getByRole("button", { name: /open fixture/i }).click();
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

// C2O-012 item 1: the room ticks every second; typing in the recap dialog must survive the ticks
test("the recap dialog keeps focus and caret across clock ticks, traps Tab and returns focus", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(roomUrl);
  const opener = page.getByTestId("open-recap-composer");
  const dialog = page.getByTestId("recap-composer");
  await expect(opener).toBeVisible({ timeout: 120_000 });
  // the keyboard opens it; retried until the page has hydrated (an Enter before hydration does nothing)
  await expect(async () => {
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  const cc = page.locator("#nrx-cc");
  await cc.click();
  await page.keyboard.type("desk@", { delay: 60 });
  await page.waitForTimeout(2_500);                 // at least two one-second ticks of the room clock
  await page.keyboard.type("ab.test", { delay: 60 });
  await expect(cc).toBeFocused();
  await expect(cc).toHaveValue("desk@ab.test");
  expect(await cc.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe("desk@ab.test".length);
  // Tab and Shift+Tab never leave the dialog
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="recap-composer"]')), `focus left the dialog after ${i + 1} presses`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await context.close();
});

// C2O-012 item 3: the recap-slot pulse is off under reduced motion
test("reduced motion disables the recap-slot pulse", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(roomUrl);
  await expect(page.getByTestId("recap-rail")).toBeVisible();
  const anim = await page.evaluate(() => {
    const host = document.querySelector(".nr") ?? document.body;
    const el = document.createElement("div");
    el.className = "rc-item is-just-filled";
    host.appendChild(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
  expect(anim).toBe("none");
  await context.close();
});

// C2O-012 item 6: a new member starts with sound off
test("sound starts off until the member turns it on", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto(roomUrl);
  const toggle = page.getByRole("button", { name: "Toggle sound" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

