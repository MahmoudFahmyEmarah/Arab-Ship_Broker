import { defineConfig, devices } from "@playwright/test";

const managedBaseURL = "http://localhost:3212";
const managedProbeURL = "http://127.0.0.1:3212";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /pda-estimator-alignment\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 600_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? managedBaseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "pda", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --hostname 0.0.0.0 --port 3212",
        url: managedProbeURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "",
          SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "",
          DQ_ENGINE_URL: managedBaseURL,
          CRON_SECRET: "pda-e2e-local-secret",
        },
      },
});
