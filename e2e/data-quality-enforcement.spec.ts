/**
 * Data Quality console · what a refusal looks like.
 *
 * NEVER EXECUTED IN THIS REPOSITORY — see e2e/README.md. Written 21 Sep 2026.
 *
 * When the gate refuses a write, two things have to reach the person who was
 * refused: the rule that refused it, and a correlation id. Without the rule
 * the message is "no"; without the correlation id nobody can find the event in
 * Data quality → Gate → log and say what actually happened.
 *
 * These specs drive the ADMIN paths gated on 21 Sep 2026 — the ones that used
 * to publish past the rules entirely.
 */
import { test, expect } from "@playwright/test";

test.use({ storageState: "e2e/.auth/edit.json" });

test("an admin cargo status change that violates a block rule is refused, with the rule named", async ({ page }) => {
  // the seeding script leaves one cargo that fails DQ-P03 (unroutable ports)
  await page.goto("/admin/cargo");
  const row = page.getByTestId("cargo-row-e2e-unroutable");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^in$/i }).click();

  const refusal = page.getByTestId("gate-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(/DQ-[A-Z]?\d+/);            // the rule code
  await expect(refusal).toContainText(/nothing was changed/i);    // and that nothing happened
});

test("the refusal carries a correlation id that the gate log can be searched by", async ({ page }) => {
  await page.goto("/admin/cargo");
  await page.getByTestId("cargo-row-e2e-unroutable").getByRole("button", { name: /^in$/i }).click();
  const id = await page.getByTestId("gate-correlation-id").innerText();
  expect(id).toMatch(/[0-9a-f-]{8,}/i);

  await page.goto("/admin/data-quality?tab=gate");
  await page.getByPlaceholder(/search/i).fill(id.trim());
  await expect(page.getByTestId("gate-log-rows")).toContainText(id.trim());
});

test("a withdrawal is never refused, even while the row fails a rule", async ({ page }) => {
  // taking a listing off the market introduces no new value: a broken rule
  // must not be able to trap a bad listing in front of members
  await page.goto("/admin/cargo");
  await page.getByTestId("cargo-row-e2e-unroutable").getByRole("button", { name: /closed/i }).click();
  await expect(page.getByTestId("gate-refusal")).toHaveCount(0);
  await expect(page.getByTestId("cargo-row-e2e-unroutable")).toContainText(/closed/i);
});

test("publishing a port that fails a port rule is refused", async ({ page }) => {
  await page.goto("/admin/ports");
  const row = page.getByTestId("port-row-ZZE2E");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /verify/i }).click();
  await expect(page.getByTestId("gate-refusal")).toContainText(/DQ-[A-Z]?\d+/);
});
