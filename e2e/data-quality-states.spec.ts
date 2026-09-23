/**
 * Data Quality console · the states an operator has to be able to read.
 *
 * NEVER EXECUTED IN THIS REPOSITORY — see e2e/README.md. Written 21 Sep 2026.
 *
 * A run that is stalled and a run that is merely slow look the same unless the
 * console says which it is, and the difference decides whether anyone needs to
 * act. Same for a notification that is retrying and one that has given up.
 * These are the states the seeding script creates, each asserted by what the
 * operator sees and by the action the console offers for it.
 */
import { test, expect } from "@playwright/test";

const CONSOLE = "/admin/data-quality";

test.use({ storageState: "e2e/.auth/edit.json" });

test.describe("run states", () => {
  test("a stalled run says so, and offers Recover", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=runs`);
    const stalled = page.getByTestId("run-state-stalled").first();
    await expect(stalled).toBeVisible();
    await expect(stalled).toContainText(/stalled/i);
    // the state and the remedy sit together: an operator should not have to
    // know that "stalled" is the one Recover applies to
    const row = page.getByTestId(/^run-row-/).filter({ has: page.getByTestId("run-state-stalled") }).first();
    await expect(row.getByRole("button", { name: /recover/i })).toBeEnabled();
  });

  test("completed with errors is not shown as completed", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=runs`);
    const row = page.getByTestId(/^run-row-/).filter({ hasText: /completed with errors/i }).first();
    await expect(row).toBeVisible();
    // the distinction the whole workstream exists for: a run that could not
    // evaluate every rule has NOT checked everything, and the coverage says so
    await expect(row.getByTestId("run-coverage")).not.toContainText("100");
    await expect(row.getByRole("button", { name: /retry/i })).toBeEnabled();
  });

  test("a failed run names why it failed", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=runs`);
    const row = page.getByTestId(/^run-row-/).filter({ hasText: /^failed/i }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("run-error")).toContainText(/seeded for the browser suite/i);
  });

  test("the rule errors of a partial run are listed, not summarised away", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=runs`);
    await page.getByTestId(/^run-row-/).filter({ hasText: /completed with errors/i }).first().click();
    await expect(page.getByTestId("run-rule-errors")).toContainText("E2E-01");
    await expect(page.getByTestId("run-rule-errors")).toContainText("ports");
  });
});

test.describe("notification states", () => {
  test("pending, retrying, failed and sent each read differently", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=settings`);
    const outbox = page.getByTestId("notification-outbox");
    await expect(outbox).toBeVisible();

    await expect(page.getByTestId("notification-e2e/pending")).toContainText(/pending/i);
    // retrying must say WHEN, or it is indistinguishable from stuck
    const retrying = page.getByTestId("notification-e2e/retrying");
    await expect(retrying).toContainText(/retrying/i);
    await expect(retrying).toContainText(/attempt 3|3 of 8|in \d+ min/i);

    const failed = page.getByTestId("notification-e2e/failed");
    await expect(failed).toContainText(/failed/i);
    await expect(failed.getByRole("button", { name: /requeue/i })).toBeEnabled();

    await expect(page.getByTestId("notification-e2e/sent")).toContainText(/sent/i);
  });

  test("requeue moves a failed notification back to pending", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=settings`);
    await page.getByTestId("notification-e2e/failed").getByRole("button", { name: /requeue/i }).click();
    await expect(page.getByTestId("notification-e2e/failed")).toContainText(/pending|queued/i);
  });
});
