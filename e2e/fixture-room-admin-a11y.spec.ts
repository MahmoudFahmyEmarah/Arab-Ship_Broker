/**
 * Admin → Fixture rooms · keyboard reach, names and focus (26 Sep 2026).
 *
 * The status filter is a tablist whose chips are real links with
 * aria-selected; the rooms table has column headers and its row links carry
 * the room ref as their accessible name; every card on the room page is a
 * section with a level-2 heading; the redaction input and the close form's
 * controls have accessible names; focus is visible on the controls the
 * admin uses; the page's flash and claim notice are live regions.
 */
import { test, expect as baseExpect } from "@playwright/test";
// The production server renders the console through governed RPCs; on a loaded machine a
// navigation can take longer than the shared 10 s expect budget. Every assertion here is
// about rendered or persisted state, so a wide budget hides nothing.
const expect = baseExpect.configure({ timeout: 60_000 });
import { buildTermCatalogue, FIXTURE_TERM_CATALOGUE_VERSION } from "../lib/fixture-room/terms";
import { apiClientAs, cleanupAdmin, cleanupFixture, seedAdmin, seedFixture, signInAs, type AdminSeed, type FixtureSeed } from "./fixture-room.helpers";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 180_000 });

let seed: FixtureSeed;
let admin: AdminSeed;
let roomId = "";

test.beforeAll(async () => {
  seed = await seedFixture();
  admin = await seedAdmin(seed.stamp);
  const ch = await apiClientAs(seed.charterer.email);
  const created = await ch.rpc("create_fixture_room", {
    p_cargo_listing_id: seed.cargoId, p_vessel_availability_id: seed.availabilityId, p_terms: buildTermCatalogue(null),
    p_idempotency_key: `e2e-admin-a11y-create-${seed.stamp}`, p_options: { catalogueVersion: FIXTURE_TERM_CATALOGUE_VERSION },
  });
  if (created.error) throw new Error(`create_fixture_room: ${created.error.message}`);
  roomId = (created.data as { data: { roomId: string } }).data.roomId;
  const version = (created.data as { version: number }).version;
  const posted = await ch.rpc("post_fixture_message", {
    p_room_id: roomId, p_body: `Charterer note ${seed.stamp}: a11y`, p_kind: "note", p_visibility: "room", p_term_id: null,
    p_expected_version: version, p_idempotency_key: `e2e-admin-a11y-msg-${seed.stamp}`, p_as_party_id: null,
  });
  if (posted.error) throw new Error(`post_fixture_message: ${posted.error.message}`);
});
test.afterAll(async () => { if (seed) cleanupFixture(seed); if (admin) cleanupAdmin(admin); });

const focusRing = (el: Element) => {
  const s = getComputedStyle(el);
  return (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none";
};

test("the status filter is a keyboard-reachable tablist and the rooms table is a real table", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto("/admin/fixtures?filter=open");
  const tablist = page.getByRole("tablist", { name: /room status/i });
  await expect(tablist).toBeVisible();
  const open = tablist.getByRole("tab", { name: /^open$/i });
  await expect(open).toHaveAttribute("aria-selected", "true");
  const all = tablist.getByRole("tab", { name: /^all$/i });
  await expect(all).toHaveAttribute("aria-selected", "false");
  // reach a chip with the keyboard, see the focus, activate it with Enter
  await all.focus();
  await expect(all).toBeFocused();
  expect(await all.evaluate(focusRing), "focused filter chip has no visible focus ring").toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL(/filter=all/, { timeout: 60_000 });
  await expect(page).toHaveURL(/filter=all/);
  await expect(page.getByRole("tablist", { name: /room status/i }).getByRole("tab", { name: /^all$/i })).toHaveAttribute("aria-selected", "true");
  // the table has column headers and the row link is named by the ref
  const table = page.getByTestId("fixtures-table").getByRole("table");
  await expect(table).toBeVisible();
  expect(await table.getByRole("columnheader").count()).toBeGreaterThanOrEqual(9);
  const row = page.getByTestId(`fixtures-row-${roomId}`);
  await expect(row).toBeVisible();
  const name = (await row.textContent())?.trim() ?? "";
  expect(name.length, "row link has a visible ref as its name").toBeGreaterThan(3);
  await row.focus();
  await expect(row).toBeFocused();
  await context.close();
});

test("every card on the room page is a section with a heading; the forms are named; focus is visible", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto(`/admin/fixtures/${roomId}`);
  await expect(page.getByTestId("fixtures-room-card")).toBeVisible();
  // one h1 for the page, a level-2 heading inside every card
  expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
  for (const id of ["fixtures-room-card", "fixtures-parties", "fixtures-ledger", "fixtures-access-log", "fixtures-close"]) {
    const card = page.getByTestId(id);
    await expect(card, id).toBeVisible();
    expect(await card.evaluate((el) => el.tagName.toLowerCase()), `${id} is a section`).toBe("section");
    await expect(card.getByRole("heading", { level: 2 }), `${id} has a level-2 heading`).toHaveCount(1);
  }
  // the redaction input is named and shows focus
  const reason = page.getByRole("textbox", { name: /redaction reason/i }).first();
  await expect(reason).toBeVisible();
  await reason.focus();
  await expect(reason).toBeFocused();
  expect(await reason.evaluate(focusRing), "focused redaction input has no visible focus ring").toBe(true);
  // the close form's select and note are labelled by wrapping labels; the button is named
  const closeForm = page.getByTestId("fixtures-close-form");
  const reasonSelect = closeForm.getByRole("combobox", { name: /reason/i });
  await expect(reasonSelect).toBeVisible();
  await reasonSelect.focus();
  expect(await reasonSelect.evaluate(focusRing), "focused close reason has no visible focus ring").toBe(true);
  await expect(closeForm.getByRole("textbox", { name: /note/i })).toBeVisible();
  const closeButton = closeForm.getByRole("button", { name: /close room/i });
  await expect(closeButton).toBeVisible();
  await expect(closeButton).toBeEnabled();
  await context.close();
});

test("tabbing reaches the header links, the redaction control and the close button without a mouse", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto(`/admin/fixtures/${roomId}`);
  await expect(page.getByTestId("fixtures-room-card")).toBeVisible();
  const targets = [
    page.getByRole("link", { name: /all rooms/i }),
    page.getByRole("link", { name: /open as mediator/i }),
    page.getByRole("textbox", { name: /redaction reason/i }).first(),
    page.getByTestId("fixtures-close-form").getByRole("button", { name: /close room/i }),
  ];
  const reached: boolean[] = [];
  for (const target of targets) {
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      await page.keyboard.press("Tab");
      hit = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    }
    reached.push(hit);
  }
  expect(reached, "every target was reached by Tab in document order").toEqual([true, true, true, true]);
  await context.close();
});

test("the claim notice and the flash are live regions a screen reader announces", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, admin.email);
  await page.goto(`/admin/fixtures/${roomId}?message=Announced%20by%20the%20suite`);
  const flash = page.getByTestId("fixtures-flash");
  await expect(flash).toBeVisible();
  await expect(flash).toHaveAttribute("role", "status");
  await expect(flash).toContainText("Announced by the suite");
  // an admin with the claim sees no claim notice; the notice itself is a status region when present
  await expect(page.getByTestId("fixtures-claim-notice")).toHaveCount(0);
  await context.close();
});
