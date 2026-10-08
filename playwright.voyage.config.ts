import { defineConfig, devices } from "@playwright/test";
import { isHostedTarget } from "./e2e/e2e-db";

/**
 * Voyage Economics (Stream S) browser proof: the admin control plane at
 * /admin/voyage-data and the member Suez calculator at /dashboard/suez-toll.
 * Self-seeding on the local stack (one super admin per run, removed after);
 * independent of the Data Quality global setup. Port 3101 by convention.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /voyage-economics.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/.voyage-report" }]],
  // Sized for the shared 4-CPU box, where another agent's build can stretch a page load past a minute.
  timeout: 300_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3101",
    // a hosted (staging) run never keeps traces: they would hold sign-in requests and session cookies (C2O-078 P3)
    trace: isHostedTarget() ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "voyage", use: { ...devices["Desktop Chrome"] } }],
});
