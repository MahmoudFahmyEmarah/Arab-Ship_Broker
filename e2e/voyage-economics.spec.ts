/**
 * Voyage Economics · Stream S browser proof (4 Oct 2026).
 *
 * 1. An admin records an SDR rate, creates a draft Suez tariff version copied
 *    from the published one, pastes the SCA toll bands, and publishes it with
 *    the typed confirmation — the control plane the owner uses to load the
 *    official circular.
 * 2. The member calculator prices a transit from that version: Manual SCNT
 *    and GT, the toll from the bands, the fixed layer, the imposed-tug risk
 *    flag, the export, and saving the facts to the vessel economics profile
 *    (member RPC). On a date without bands the toll reads "unavailable".
 *
 * Self-seeding on the local stack; everything is removed afterwards, and the
 * previously open published version gets its open window back.
 */
import { test, expect, type Browser } from "@playwright/test";
import { execSync } from "node:child_process";
import { cleanupAdmin, cleanupFixture, seedAdmin, seedFixture, signInAs, type FixtureSeed } from "./fixture-room.helpers";

const stamp = Date.now().toString(36);
const plus = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const today = plus(0);
const tomorrow = plus(1);
const BANDS = ["dry_bulk,laden,0,0,5000,8.0000", "dry_bulk,laden,1,5000,10000,6.0000", "dry_bulk,laden,2,10000,,4.5000", "dry_bulk,ballast,0,0,,6.5150"].join("\n");

let admin: { email: string; userId: string };
let seed: FixtureSeed;
let versionId: string | null = null;

function psql(sql: string) {
  try { execSync("docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0", { input: sql, stdio: ["pipe", "ignore", "ignore"] }); } catch { /* disposable rows */ }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = await seedAdmin(stamp);
  seed = await seedFixture();
});

test.afterAll(async () => {
  psql(`
delete from public.suez_tariff_versions where source_ref like 'e2e ${stamp}%';
update public.suez_tariff_versions set effective_to = null where status = 'published' and effective_to = '${today}' and version_no = (select max(version_no) from public.suez_tariff_versions where status = 'published');
delete from public.sdr_rates where source = 'e2e-${stamp}';
delete from public.vessel_economics_profiles where vessel_id = '${seed.vesselId}';
`);
  cleanupFixture(seed);
  cleanupAdmin(admin);
});

async function asAdmin(browser: Browser, baseURL: string) {
  return signInAs(browser, baseURL, admin.email);
}

test("admin records an SDR rate, loads toll bands into a draft and publishes it", async ({ browser, baseURL }) => {
  const { page, context } = await asAdmin(browser, baseURL!);
  try {
    await page.goto("/admin/voyage-data?tab=sdr");
    await expect(page.getByRole("heading", { name: /Voyage estimator data/ })).toBeVisible();
    await page.locator('input[name="asOf"]').fill(today);
    await page.locator('input[name="rateUsd"]').fill("1.36");
    await page.locator('input[name="source"]').fill(`e2e-${stamp}`);
    await page.getByRole("button", { name: "Record rate" }).click();
    await expect(page.locator(".vd-alert--success")).toContainText("SDR rate 1.36 USD recorded");

    await page.goto("/admin/voyage-data?tab=suez");
    await page.locator('input[name="effectiveFrom"]').fill(tomorrow);
    await page.locator('input[name="sourceRef"]').fill(`e2e ${stamp} SCA tolls circular (test)`);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.locator(".vd-alert--success")).toContainText(/Draft version \d+ created with copied items and tiers/);
    versionId = new URL(page.url()).searchParams.get("version");
    expect(versionId).toBeTruthy();

    await page.goto(`/admin/voyage-data?tab=tiers&version=${versionId}`);
    await expect(page.locator(".vd-alert--error")).toContainText("No toll bands in this version");
    await page.locator('textarea[name="csv"]').fill(BANDS);
    await page.getByRole("button", { name: /Replace bands of v\d+/ }).click();
    await expect(page.locator(".vd-alert--success")).toContainText("4 toll bands saved for 1 categories (official)");
    await expect(page.locator(".vd-table")).toContainText("8.0000");

    await page.goto(`/admin/voyage-data?tab=suez&version=${versionId}`);
    const row = page.locator(".vd-row", { hasText: `e2e ${stamp}` });
    await row.locator('input[name="confirm"]').fill("PUBLISH");
    await row.getByRole("button", { name: "Publish" }).click();
    await expect(page.locator(".vd-alert--success")).toContainText(/Version \d+ published \(\d+ items, 4 toll bands\)/);
    await expect(row.locator(".vd-chip--published")).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("member calculator prices a transit from the published bands and saves the vessel facts", async ({ browser, baseURL }) => {
  const { page, context } = await asAdmin(browser, baseURL!);
  try {
    await page.goto("/dashboard/suez-toll");
    await expect(page.getByText("Suez Canal Transit Cost", { exact: true })).toBeVisible();
    const select = page.getByRole("combobox", { name: "Vessel" });
    const optionValue = await select.locator("option", { hasText: seed.vesselName }).first().getAttribute("value");
    expect(optionValue).toBeTruthy();
    await select.selectOption(optionValue!);
    await expect(page.locator(".sz-rail")).toContainText(seed.vesselName);

    // Today: the published version in force has no toll bands → unavailable toll, fixed layer priced.
    await expect(page.locator(".sz-unavailable").first()).toContainText(/SCA toll bands|SCNT is not sourced/);

    // Manual facts and the date the e2e version is in force.
    await page.locator('input[type="date"]').first().fill(tomorrow);
    const scnt = page.locator(".sz-fact", { hasText: "SCNT" }).first();
    await scnt.getByRole("button", { name: "Manual" }).click();
    await scnt.getByLabel("SCNT manual value").fill("16070");
    const gt = page.locator(".sz-fact", { hasText: /^GT/ }).first();
    await gt.getByRole("button", { name: "Manual" }).click();
    await gt.getByLabel("GT manual value").fill("18000");
    await page.getByLabel("SCA vessel category").selectOption("dry_bulk");
    const cranes = page.locator(".sz-fact", { hasText: "mooring boats" });
    await cranes.getByRole("button", { name: "no", exact: true }).click();

    // Toll = 5,000×8 + 5,000×6 + 6,070×4.5 = 97,315 SDR × 1.36 = 132,348.40 USD.
    const tollCard = page.locator(".ve-pl-card", { hasText: "1 · Transit toll" });
    await expect(tollCard).toContainText("SDR 97,315.00");
    await expect(tollCard).toContainText("$132,348.40");
    const strip = page.locator(".ve-results");
    await expect(strip).toContainText("$132,348");
    await expect(page.locator(".ve-pl-card", { hasText: "2 · Fixed accompanying charges" })).toContainText("Mooring services");
    const flags = page.locator(".ve-pl-card", { hasText: "risk flags" });
    await expect(flags.locator(".sz-flag.is-applied", { hasText: "Imposed tug" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export estimate" })).toBeEnabled();

    // Save the facts to the vessel economics profile through the member RPC, then they load as Record.
    await page.getByRole("button", { name: "Save facts to vessel profile" }).click();
    await expect(page.locator(".sz-save")).toContainText("saved to the economics profile");
    await page.reload();
    await select.selectOption(optionValue!);
    await expect(page.locator(".sz-fact", { hasText: "SCNT" }).first()).toContainText("16,070");
    await expect(page.locator(".ve-input-card__head", { hasText: "economics profile" })).toBeVisible();
  } finally {
    await context.close();
  }
});
