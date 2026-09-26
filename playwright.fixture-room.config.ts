import { defineConfig, devices } from "@playwright/test";

/**
 * Fixture Room acceptance is self-seeding: every spec creates and cleans up
 * the member/admin records it needs on the local stack. Keep it independent
 * from the Data Quality global setup so a Fixture regression never depends on
 * unrelated administrator fixtures.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /fixture-room.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/.fixture-report" }]],
  // The complete pack seeds through the local Auth/Data APIs and renders
  // governed server components. On a constrained Windows runner these are
  // occasionally slow even though direct RPCs stay healthy; keep the same
  // per-test budget used by the negotiation specs so hooks do not inherit a
  // shorter, unrelated 60-second ceiling.
  timeout: 180_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "fixture", use: { ...devices["Desktop Chrome"] } }],
});
