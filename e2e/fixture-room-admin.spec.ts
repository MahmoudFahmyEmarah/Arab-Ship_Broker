/**
 * Fixture Room · the admin console (26 Sep 2026).
 *
 * A super admin whose session carries the claim the ledger's admin check reads
 * (app_metadata.role = 'admin', set through the Auth admin API on a seeded
 * seat) opens /admin/fixtures: the room a charterer opened through the API is
 * listed, its parties are unmasked, the access log shows the read, a message
 * is redacted through the form and the room is closed as failed. A member is
 * bounced off the console. Local stack only; every row is removed afterwards.
 */
import { test, expect as baseExpect } from "@playwright/test";
import { buildTermCatalogue, FIXTURE_TERM_CATALOGUE_VERSION } from "../lib/fixture-room/terms";
import { apiClientAs, cleanupAdmin, cleanupFixture, seedAdmin, seedFixture, signInAs, type AdminSeed, type FixtureSeed } from "./fixture-room.helpers";

const expect = baseExpect.configure({ timeout: 60_000 });

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 300_000 });

let seed: FixtureSeed;
let admin: AdminSeed;
let roomId = "";
let messageBody = "";

test.beforeAll(async () => {
  seed = await seedFixture();
  admin = await seedAdmin(seed.stamp);
  // the charterer opens the room and posts a room-wide message through the governed RPCs
  const ch = await apiClientAs(seed.charterer.email);
  const created = await ch.rpc("create_fixture_room", {
    p_cargo_listing_id: seed.cargoId, p_vessel_availability_id: seed.availabilityId, p_terms: buildTermCatalogue(null),
    p_idempotency_key: `e2e-admin-create-${seed.stamp}`, p_options: { catalogueVersion: FIXTURE_TERM_CATALOGUE_VERSION },
  });
  if (created.error) throw new Error(`create_fixture_room: ${created.error.message}`);
  roomId = (created.data as { data: { roomId: string }; version: number }).data.roomId;
  const version = (created.data as { version: number }).version;
  messageBody = `Charterer note ${seed.stamp}: workable basis prompt`;
  const posted = await ch.rpc("post_fixture_message", {
    p_room_id: roomId, p_body: messageBody, p_kind: "note", p_visibility: "room", p_term_id: null,
    p_expected_version: version, p_idempotency_key: `e2e-admin-msg-${seed.stamp}`, p_as_party_id: null,
  });
  if (posted.error) throw new Error(`post_fixture_message: ${posted.error.message}`);
});
test.afterAll(async () => { if (seed) cleanupFixture(seed); if (admin) cleanupAdmin(admin); });

test("a member is bounced off the admin console", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  await page.goto("/admin/fixtures");
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/fixtures"));
  await expect(page.getByTestId("fixtures-table")).toHaveCount(0);
  await context.close();
});

test("the admin sees the room unmasked and the access log records the read", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto("/admin/fixtures?filter=open");
  await expect(page.getByTestId("fixtures-claim-notice")).toHaveCount(0);
  await expect(page.getByTestId(`fixtures-row-${roomId}`)).toBeVisible();
  await page.getByTestId(`fixtures-row-${roomId}`).click();
  await page.waitForURL(new RegExp(`/admin/fixtures/${roomId}$`));
  await expect(page.getByTestId("fixtures-room-card")).toBeVisible();
  // unmasked: both organisations by name, and the raw org ids the member read never carries
  const parties = page.getByTestId("fixtures-parties");
  await expect(parties).toContainText(`E2E Charterers ${seed.stamp}`);
  await expect(parties).toContainText(`E2E Owners ${seed.stamp}`);
  await expect(parties).toContainText(seed.owner.orgId);
  // the ledger shows the message event without its text; the message panel shows the text
  await expect(page.getByTestId("fixtures-ledger")).toContainText("message.posted");
  await expect(page.getByTestId("fixtures-messages")).toContainText(messageBody);
  // this open was logged: reload and the log lists an admin read of this room
  await page.reload();
  await expect(page.getByTestId("fixtures-access-log")).toContainText("admin");
  await context.close();
});

test("the admin redacts a message and closes the room through the forms", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto(`/admin/fixtures/${roomId}`);
  const form = page.locator('[data-testid^="fixtures-redact-"]').first();
  await form.getByRole("textbox", { name: "Redaction reason" }).fill("contains a walk-away figure");
  await form.getByRole("button", { name: "Redact" }).click();
  await expect(page.getByTestId("fixtures-flash")).toContainText(/redacted/i);
  await expect(page.getByTestId("fixtures-messages")).not.toContainText(messageBody);
  await expect(page.getByTestId("fixtures-messages")).toContainText("redacted");
  await expect(page.getByTestId("fixtures-ledger")).toContainText("message.redacted");
  // close as failed with a note
  const close = page.getByTestId("fixtures-close");
  await close.locator('select[name="reason"]').selectOption("failed");
  await close.locator('input[name="note"]').fill("stem not approved");
  await close.getByRole("button", { name: "Close room" }).click();
  await expect(page.getByTestId("fixtures-flash")).toContainText(/closed as failed/i);
  await expect(page.getByTestId("fixtures-room-card")).toContainText("Failed");
  await expect(page.getByTestId("fixtures-close")).toHaveCount(0);
  await context.close();
});
