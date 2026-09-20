import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level acceptance for the Data Quality console (21 Sep 2026).
 *
 * NOT YET EXECUTED IN THIS REPOSITORY. `@playwright/test` is not installed and
 * no browser binary is present; the specs in e2e/ are written against the
 * console as it stands but have never been run, and nothing in the release
 * report claims otherwise. To run them:
 *
 *   npm install --save-dev @playwright/test
 *   npx playwright install chromium
 *   npx playwright test
 *
 * They need three seeded admin seats — a view seat, a run seat and an edit
 * seat — and storage states for each. e2e/README.md says exactly what to
 * create and why the suite cannot honestly be run without them: every
 * permission assertion is about what a REAL seat can do, and a test that
 * signs in as the owner and then pretends to be a view seat proves nothing.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "view", use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/view.json" } },
    { name: "run", use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/run.json" } },
    { name: "edit", use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/edit.json" } },
  ],
  // The dev server is started with the LOCAL Supabase stack in its environment,
  // overriding .env.local. That file points at the production project, and a
  // browser suite that signs in as three administrators and starts audit runs
  // must never reach it. The env below wins because Next.js prefers process
  // env over .env files.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "",
          SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "",
          DQ_ENGINE_URL: "http://localhost:3000",
          CRON_SECRET: "e2e-cron-secret",
        },
      },
});
