import { defineConfig, devices } from "@playwright/test";

/**
 * Browser proof for the Fuel Bar (Stream B): supplier portal → admin approval
 * → ticker → index. The spec self-seeds tagged identities into the LOCAL
 * Supabase stack and removes them afterwards; it refuses any other target.
 *   E2E_BASE_URL=http://127.0.0.1:3102 npx playwright test --config=playwright.bunker.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /bunker\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/.bunker-report" }]],
  timeout: 240_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3102",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "bunker", use: { ...devices["Desktop Chrome"] } }],
});
