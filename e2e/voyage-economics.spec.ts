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
import { cleanupAdmin, cleanupFixture, dbTx, seedAdmin, seedFixture, signInAs, teardownAll, type FixtureSeed } from "./fixture-room.helpers";

const stamp = Date.now().toString(36);
const plus = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const today = plus(0);
const tomorrow = plus(1);
const BANDS = ["dry_bulk,laden,0,0,5000,8.0000", "dry_bulk,laden,1,5000,10000,6.0000", "dry_bulk,laden,2,10000,,4.5000", "dry_bulk,ballast,0,0,,6.5150"].join("\n");

let admin: { email: string; userId: string };
let seed: FixtureSeed;
let versionId: string | null = null;

// One transaction (C2O-075 P0): the guards lifted below come back even if a statement or the connection fails.
function psql(sql: string) {
  dbTx("voyage e2e teardown", sql);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = await seedAdmin(stamp);
  seed = await seedFixture();
});

test.afterAll(async () => {
  // Published versions, SDR rates and events are immutable by trigger (20261003205000); the disposable e2e rows are
  // removed by the local superuser with the guards lifted for this statement batch only, then the previous version's open window is restored.
  teardownAll("voyage e2e teardown", [() => psql(`
alter table public.suez_tariff_versions disable trigger trg_suez_version_guard;
alter table public.suez_tariff_versions disable trigger trg_suez_version_events;
alter table public.suez_tariff_items disable trigger trg_suez_items_guard;
alter table public.suez_toll_tiers disable trigger trg_suez_tiers_guard;
alter table public.sdr_rates disable trigger trg_sdr_rates_guard;
alter table public.suez_tariff_events disable trigger trg_suez_events_append_only;
delete from public.suez_tariff_events where version_id in (select id from public.suez_tariff_versions where source_ref like 'e2e ${stamp}%');
delete from public.suez_tariff_events where entity = 'sdr_rate' and entity_id in (select id from public.sdr_rates where source = 'e2e-${stamp}');
delete from public.suez_tariff_versions where source_ref like 'e2e ${stamp}%';
update public.suez_tariff_versions set effective_to = null where status = 'published' and effective_to = '${today}' and version_no = (select max(version_no) from public.suez_tariff_versions where status = 'published');
delete from public.sdr_rates where source = 'e2e-${stamp}';
alter table public.suez_tariff_versions enable trigger trg_suez_version_guard;
alter table public.suez_tariff_versions enable trigger trg_suez_version_events;
alter table public.suez_tariff_items enable trigger trg_suez_items_guard;
alter table public.suez_toll_tiers enable trigger trg_suez_tiers_guard;
alter table public.sdr_rates enable trigger trg_sdr_rates_guard;
alter table public.suez_tariff_events enable trigger trg_suez_events_append_only;
alter table public.voyage_estimate_runs disable trigger trg_voyage_run_immutable;
alter table public.voyage_estimate_lines disable trigger trg_voyage_lines_immutable;
delete from public.voyage_estimate_runs where actor_user_id = '${admin.userId}' and label like '%${seed.vesselName}%';
alter table public.voyage_estimate_runs enable trigger trg_voyage_run_immutable;
alter table public.voyage_estimate_lines enable trigger trg_voyage_lines_immutable;
alter table public.vessel_economics_profile_events disable trigger trg_vep_events_append_only;
delete from public.vessel_economics_profile_events where vessel_id = '${seed.vesselId}';
alter table public.vessel_economics_profile_events enable trigger trg_vep_events_append_only;
delete from public.vessel_economics_profiles where vessel_id = '${seed.vesselId}';
`),
    () => cleanupFixture(seed),
    () => cleanupAdmin(admin),
  ]);
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
    const draftForm = page.locator(".vd-panel", { hasText: "New draft version" });
    await draftForm.locator('input[name="effectiveFrom"]').fill(tomorrow);
    await draftForm.locator('input[name="sourceRef"]').fill(`e2e ${stamp} SCA tolls circular (test)`);
    await draftForm.getByRole("button", { name: "Create draft" }).click();
    await expect(page.locator(".vd-alert--success")).toContainText(/Draft version \d+ created with copied items and tiers/);
    versionId = new URL(page.url()).searchParams.get("version");
    expect(versionId).toBeTruthy();

    await page.goto(`/admin/voyage-data?tab=tiers&version=${versionId}`);
    // the draft copies the bands of the version in force: none on a fresh database, the official set once v3+ is
    // loaded (staging since 6 Oct) — either way the replacement below must leave exactly the test's bands
    await expect(page.locator(".vd-alert--error", { hasText: "No toll bands in this version" }).or(page.locator(".vd-panel", { hasText: /Toll bands of v\d+/ })).first()).toBeVisible();
    await page.locator('textarea[name="csv"]').fill(BANDS);
    await page.getByRole("button", { name: /Replace bands of v\d+/ }).click();
    await expect(page.locator(".vd-alert--success")).toContainText("4 toll bands saved for 1 categories (official)");
    await expect(page.locator(".vd-panel", { hasText: /Toll bands of v\d+/ })).toContainText("8.0000");

    await page.goto(`/admin/voyage-data?tab=suez&version=${versionId}`);
    const row = page.locator(".vd-row", { hasText: `e2e ${stamp}` });
    await row.locator('input[name="confirm"]').fill("PUBLISH");
    await row.getByRole("button", { name: "Publish" }).click();
    await expect(page.locator(".vd-alert--success")).toContainText(/Version \d+ published \(\d+ items, 4 toll bands, \d+ sources\)/);
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
    const select = page.getByRole("combobox", { name: "Vessel", exact: true }); // "SCA vessel category" is a combobox too
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
    // Searchlight and first transit are unknown → undecided flags; the estimate says so instead of charging or waiving.
    await expect(flags.locator(".sz-flag.is-undecided").first()).toBeVisible();
    await expect(page.locator(".sz-status")).toContainText("partial");
    // The e2e version (copied, surcharge regime unknown) prices base dues only: never trusted, no total (C2O-039 P0-1).
    await expect(tollCard).toContainText("does not model the SCA category surcharges");
    await expect(page.locator(".sz-status")).toContainText("category surcharge");

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

test("voyage estimator prices the seeded pairing and saves an immutable estimate run", async ({ browser, baseURL }) => {
  const { page, context } = await asAdmin(browser, baseURL!);
  try {
    await page.goto("/dashboard/voyage-estimator");
    await expect(page.getByText("Voyage Cost Estimator", { exact: true })).toBeVisible();
    const vesselSelect = page.getByRole("combobox", { name: "Vessel", exact: true });
    const vesselValue = await vesselSelect.locator("option", { hasText: seed.vesselName }).first().getAttribute("value");
    expect(vesselValue).toBeTruthy();
    await vesselSelect.selectOption(vesselValue!);
    const cargoSelect = page.getByRole("combobox", { name: "Cargo" });
    const cargoOptions = await cargoSelect.locator("option").allTextContents();
    expect(cargoOptions.length).toBeGreaterThan(1);
    await cargoSelect.selectOption({ index: 1 });

    // The saved profile from the Suez test feeds the SCNT; speeds come from the profile or defaults.
    await expect(page.locator(".vy-rail")).toBeVisible();
    await page.getByLabel("Sea · laden residual").fill("20");
    await page.getByLabel("Sea · laden distillate").fill("1");
    await page.getByLabel("Port · working residual").fill("3");
    await page.getByLabel("Port · working distillate").fill("1");
    // Local routes cover four pairs only; force the laden leg to a manual distance.
    const ladenLeg = page.locator(".vy-leg", { hasText: "Laden" });
    await ladenLeg.getByRole("checkbox", { name: "Manual" }).check();
    await ladenLeg.getByLabel("NM", { exact: true }).fill("1200");
    await ladenLeg.getByLabel("of which ECA NM").fill("600");
    // A manual distance is a manual value: it needs its reason (else the input is invalid, never silently accepted).
    await expect(page.locator(".vy-status")).toContainText("invalid");
    await ladenLeg.getByLabel("Reason").fill("owner distance table, e2e");
    await expect(page.locator(".vy-status")).toContainText("partial");

    const strip = page.locator(".ve-results");
    await expect(strip).toContainText("Total voyage days");
    await expect(strip).not.toContainText("$0");
    await expect(page.locator(".ve-pl-card", { hasText: "Fuel by product" })).toContainText("LSMGO");
    // hasText is a case-insensitive substring: "Total voyage cost" elsewhere also matches "Voyage costs" — pin the card by its exact title.
    const costsCard = page.locator(".ve-pl-card", { has: page.locator(".ve-pl-card__title", { hasText: /^Voyage costs$/ }) });
    await expect(costsCard).toContainText("Running cost");

    // Statuses are visible: manual leg, fallback fuel (no live index), DAs not entered → unavailable, total incomplete.
    await expect(page.locator(".vy-table")).toContainText("manual");
    await expect(page.locator(".ve-pl-card", { hasText: "Fuel by product" })).toContainText("fallback");
    await expect(costsCard).toContainText("not entered — unavailable");
    await page.getByRole("button", { name: "Save estimate" }).click();
    await expect(page.locator(".ve-head")).toContainText("Estimate saved");
    await expect(page.locator(".ve-head")).toContainText("partial");
  } finally {
    await context.close();
  }
});

test("a member without the calculator entitlement is refused both calculator pages", async ({ browser, baseURL }) => {
  // One rule for pages and actions (lib/voyage/calculator-policy.ts): members wait for the rollout; T1/T2 are locked.
  const { page, context } = await signInAs(browser, baseURL!, seed.charterer.email);
  try {
    await page.goto("/dashboard/suez-toll");
    await expect(page.getByText("Plotting the Course").first()).toBeVisible();
    await expect(page.getByText("Suez Canal Transit Cost", { exact: true })).toHaveCount(0);
    await page.goto("/dashboard/voyage-estimator");
    await expect(page.getByText("Still Charting These Waters").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save estimate" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
