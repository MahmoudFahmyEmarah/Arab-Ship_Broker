import { expect, test } from "@playwright/test";

import { cleanupFixture, dismissOverlays, seedFixture, signInAs, type FixtureSeed } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 180_000 });

let seed: FixtureSeed;

function exactLoopback(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  const target = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  if (!exactLoopback(target)) {
    throw new Error(`refusing to seed notification browser fixtures against non-loopback Supabase URL: ${target}`);
  }
  seed = await seedFixture();
});

test.afterAll(async () => {
  if (seed) cleanupFixture(seed);
});

test("bell is keyboard operable, announces unread state and fits a phone viewport", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.setViewportSize({ width: 390, height: 844 });

  await context.route("**/rest/v1/rpc/notification_badge", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "2" });
  });
  await context.route("**/rest/v1/rpc/list_my_notifications", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "10000000-0000-4000-8000-000000000001",
          kind: "fixture.proposal",
          importance: "urgent",
          title: "Proposal expires soon",
          body: "Open the governed Fixture Room before the proposal lapses.",
          href: null,
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ]),
    });
  });

  await page.reload();
  await dismissOverlays(page);
  const bell = page.getByRole("button", { name: "Notifications, 2 unread" });
  await expect(bell).toBeVisible();
  await bell.focus();
  await page.keyboard.press("Enter");

  const panel = page.getByRole("region", { name: "Notifications" });
  await expect(panel).toBeVisible();
  const unread = page.getByRole("button", { name: /Unread urgent notification: Proposal expires soon/i });
  await expect(unread).toBeVisible();
  await unread.focus();
  const focusStyle = await unread.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

  const box = await panel.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  await context.close();
});
