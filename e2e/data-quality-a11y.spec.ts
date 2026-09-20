/**
 * Data Quality console · keyboard reach.
 *
 * NEVER EXECUTED IN THIS REPOSITORY — see e2e/README.md. Written 21 Sep 2026.
 *
 * Issue rows and run rows are clickable divs in this console. A clickable div
 * is invisible to the keyboard unless it is given a tab stop, a role and key
 * handlers — and the difference is not visible in a screenshot, which is why
 * it belongs in a test rather than in a review.
 */
import { test, expect } from "@playwright/test";

const CONSOLE = "/admin/data-quality";
test.use({ storageState: "e2e/.auth/edit.json" });

test("an issue row takes focus and opens with Enter and with Space", async ({ page }) => {
  await page.goto(`${CONSOLE}?tab=issues`);
  const row = page.getByTestId(/^issue-row-/).first();
  await expect(row).toBeVisible();

  await expect(row).toHaveAttribute("tabindex", "0");
  await expect(row).toHaveAttribute("role", /button|link|row/);

  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("issue-drawer")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("issue-drawer")).toBeHidden();

  await row.focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("issue-drawer")).toBeVisible();
});

test("a run row takes focus and opens with the keyboard", async ({ page }) => {
  await page.goto(`${CONSOLE}?tab=runs`);
  const row = page.getByTestId(/^run-row-/).first();
  await expect(row).toHaveAttribute("tabindex", "0");
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("run-detail")).toBeVisible();
});

test("focus is visible, not merely present", async ({ page }) => {
  await page.goto(`${CONSOLE}?tab=issues`);
  const row = page.getByTestId(/^issue-row-/).first();
  await row.focus();
  // an outline of none with no replacement is a keyboard user working blind
  const outline = await row.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
  });
  const hasRing = (outline.outlineStyle !== "none" && outline.outlineWidth !== "0px") || outline.boxShadow !== "none";
  expect(hasRing, `focused row has no visible focus ring: ${JSON.stringify(outline)}`).toBe(true);
});

test("tabbing reaches the rows without a mouse", async ({ page }) => {
  await page.goto(`${CONSOLE}?tab=issues`);
  let reached = false;
  for (let i = 0; i < 40 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => !!document.activeElement?.getAttribute("data-testid")?.startsWith("issue-row-"));
  }
  expect(reached, "no issue row was reachable within 40 tab stops").toBe(true);
});
