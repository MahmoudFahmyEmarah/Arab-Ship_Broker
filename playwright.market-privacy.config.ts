import { defineConfig, devices } from "@playwright/test";

/**
 * Browser proof for the global market/TBN privacy boundary.
 *
 * The spec self-seeds hostile identities into the local Supabase stack and
 * deletes them afterwards.  It must never be pointed at a hosted database;
 * the seed helper independently enforces that guard as a second line of
 * defence.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /market-tbn-privacy\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/.market-privacy-report" }],
  ],
  timeout: 240_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "market-privacy", use: { ...devices["Desktop Chrome"] } },
  ],
});
