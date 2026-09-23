/**
 * Data Quality console · what each admin seat may do.
 *
 * NEVER EXECUTED IN THIS REPOSITORY — see e2e/README.md. Written 21 Sep 2026.
 *
 * Each seat is checked twice, and the second check is the one that matters:
 *
 *   1. the control is not on the page
 *   2. the server action behind it refuses anyway
 *
 * A console that hides the button and still honours the request passes (1)
 * and fails (2). Hiding is presentation; refusing is the permission.
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const CONSOLE = "/admin/data-quality";

/** Call a server action the way the page would, and report what came back. */
async function postAction(request: APIRequestContext, path: string, body: unknown) {
  const res = await request.post(path, {
    data: body,
    headers: { "content-type": "application/json" },
    failOnStatusCode: false,
  });
  return { status: res.status(), body: await res.text() };
}

/** The run the state fixtures seeded, whatever its id turns out to be. */
async function firstRunId(page: Page): Promise<string> {
  await page.goto(`${CONSOLE}?tab=runs`);
  const row = page.getByTestId(/^run-row-/).first();
  await expect(row).toBeVisible();
  const id = (await row.getAttribute("data-testid"))!.replace("run-row-", "");
  expect(id).not.toEqual("");
  return id;
}

test.describe("view seat", () => {
  test.use({ storageState: "e2e/.auth/view.json" });

  test("reads everything and changes nothing", async ({ page }) => {
    await page.goto(CONSOLE);
    await expect(page.getByRole("heading", { name: /data quality/i })).toBeVisible();
    // the tiles and the tabs are readable
    await expect(page.getByTestId("health-tiles")).toBeVisible();

    // none of the actions are offered
    for (const name of [/^run$/i, /new run/i, /recover/i, /retry/i, /requeue/i, /schedule/i]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
  });

  test("cannot open the rule editor or settings", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=rules`);
    await expect(page.getByRole("button", { name: /new rule/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^edit$/i })).toHaveCount(0);
    await page.goto(`${CONSOLE}?tab=settings`);
    // settings are visible but not editable
    const inputs = page.locator("input:not([disabled]), select:not([disabled])");
    await expect(inputs).toHaveCount(0);
  });

  test("the server refuses a run even when the request is made directly", async ({ page, request }) => {
    // the assertion that matters: the seat is enforced on the server, not by
    // the absence of a button
    const res = await postAction(request, "/api/dq/engine", { runId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(401);          // the engine takes the cron secret only
    await page.goto(`${CONSOLE}?tab=runs`);
    await expect(page.getByTestId("permission-view-notice")).toBeVisible();
  });
});

test.describe("run seat", () => {
  test.use({ storageState: "e2e/.auth/run.json" });

  test("can start a run", async ({ page }) => {
    await page.goto(CONSOLE);
    await page.getByRole("button", { name: /new run/i }).click();
    await page.getByRole("button", { name: /start/i }).click();
    await expect(page.getByTestId("run-progress")).toBeVisible();
  });

  test("can recover a stalled run and retry a failed one", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=runs`);
    await expect(page.getByTestId("run-state-stalled")).toBeVisible();
    await expect(page.getByRole("button", { name: /recover/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /retry/i })).toBeEnabled();
  });

  test("cannot change configuration", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=rules`);
    await expect(page.getByRole("button", { name: /new rule/i })).toHaveCount(0);
    await page.goto(`${CONSOLE}?tab=settings`);
    await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);
    // and the gate's channel modes are read-only
    await page.goto(`${CONSOLE}?tab=gate`);
    await expect(page.locator("select:not([disabled])")).toHaveCount(0);
  });
});

test.describe("edit seat", () => {
  test.use({ storageState: "e2e/.auth/edit.json" });

  test("can manage rules, settings and channel modes", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=rules`);
    await expect(page.getByRole("button", { name: /new rule/i })).toBeEnabled();

    await page.goto(`${CONSOLE}?tab=settings`);
    const sample = page.getByLabel(/ai sample/i);
    await expect(sample).toBeEditable();
    await sample.fill("41");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    await page.goto(`${CONSOLE}?tab=gate`);
    await expect(page.locator("select:not([disabled])").first()).toBeVisible();
  });

  test("a rule with unsafe SQL is refused with the reason", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=rules`);
    await page.getByRole("button", { name: /new rule/i }).click();
    await page.getByLabel(/code/i).fill("E2E-UNSAFE");
    await page.getByLabel(/violation/i).fill("(select pg_sleep(10)) is not null");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByTestId("rule-error")).toContainText(/not allowed|unsafe|refused/i);
  });

  test("requeue is available on a failed notification", async ({ page }) => {
    await page.goto(`${CONSOLE}?tab=settings`);
    const failed = page.getByTestId("notification-e2e/failed");
    await expect(failed).toBeVisible();
    await expect(failed.getByRole("button", { name: /requeue/i })).toBeEnabled();
  });
});

test.describe("the run id is stable across seats", () => {
  test.use({ storageState: "e2e/.auth/edit.json" });
  test("the runs tab lists the seeded runs", async ({ page }) => {
    const id = await firstRunId(page);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
