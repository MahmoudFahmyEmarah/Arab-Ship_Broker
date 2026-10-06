import { defineConfig, devices } from "@playwright/test";

const APPROVED_STAGING_SUPABASE_ORIGIN = "https://sidcsytgqalqacsgyguz.supabase.co";
const PRODUCTION_SUPABASE_ORIGIN = "https://rezfejaxbmdzkslrrefr.supabase.co";

function exactLoopbackUrl(raw: string, label: string): string {
  const value = new URL(raw);
  const host = value.hostname.toLowerCase();
  if (
    value.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)
  ) {
    throw new Error(`${label} must be an exact HTTP loopback URL; received ${raw}`);
  }
  return value.toString().replace(/\/$/, "");
}

function approvedSupabaseUrl(raw: string, label: string): string {
  const normalized = new URL(raw).toString().replace(/\/$/, "");
  const origin = new URL(normalized).origin;
  if (origin === PRODUCTION_SUPABASE_ORIGIN) {
    throw new Error(`${label} must never target the production Supabase project.`);
  }
  if (process.env.E2E_ALLOW_REMOTE === "1" && origin === APPROVED_STAGING_SUPABASE_ORIGIN) {
    return normalized;
  }
  return exactLoopbackUrl(raw, label);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the disposable Stream R browser stack.`);
  return value;
}

const baseURL = exactLoopbackUrl(
  process.env.E2E_BASE_URL ?? "http://127.0.0.1:3103",
  "E2E_BASE_URL",
);
const appPort = new URL(baseURL).port || "80";
const supabaseURL = approvedSupabaseUrl(
  requiredEnvironment("E2E_SUPABASE_URL"),
  "E2E_SUPABASE_URL",
);
if (new URL(supabaseURL).hostname !== "sidcsytgqalqacsgyguz.supabase.co" && new URL(supabaseURL).port === "54321") {
  throw new Error("The Stream R suite refuses the shared local Supabase API on port 54321.");
}
if (
  process.env.E2E_RULES_DISPOSABLE_STACK !== "1"
  && process.env.E2E_ALLOW_REMOTE !== "1"
) {
  throw new Error("Select either the disposable Stream R stack or the approved staging target.");
}
const anonKey = requiredEnvironment("E2E_SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("E2E_SUPABASE_SERVICE_ROLE_KEY");
const stackNonce = requiredEnvironment("E2E_RULES_STACK_NONCE");

/**
 * Stream R browser proof. The spec owns its data and refuses every non-loopback
 * app/database endpoint before creating a user or listing.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /rules-governance\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/.rules-report" }],
  ],
  outputDir: "test-results/rules-governance",
  timeout: 240_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "rules-governance", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- -H 127.0.0.1 -p ${appPort}`,
    url: `${baseURL}/auth/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseURL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      E2E_RULES_DISPOSABLE_STACK: "1",
      E2E_RULES_STACK_NONCE: stackNonce,
      E2E_ALLOW_REMOTE: process.env.E2E_ALLOW_REMOTE ?? "",
    },
  },
});
