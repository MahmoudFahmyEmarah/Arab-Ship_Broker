/**
 * Fixture Room · match candidates are governed (C2O-011, 28 Sep 2026).
 *
 * The owner has two positions matching the charterer's cargo: a named hull
 * and a TBN hull. The charterer's match builder must list the TBN one as
 * "TBN" and nothing in the page (HTML, the server-rendered payload, or any
 * server-action response) may carry the hidden name, a vessel id or an IMO.
 * A member who does not own a listing cannot see its matches, neither through
 * the page nor through the RPC.
 *
 * Runs against the local stack only (see fixture-room.helpers.ts).
 */
import { test, expect as baseExpect } from "@playwright/test";
import { apiClientAs, cleanupFixture, dismissOverlays, seedFixture, signInAs, type FixtureSeed } from "./fixture-room.helpers";

const expect = baseExpect.configure({ timeout: 180_000 });
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 600_000 });

let seed: FixtureSeed;
test.beforeAll(async () => { seed = await seedFixture(); });
test.afterAll(async () => { if (seed) cleanupFixture(seed); });

const secrets = () => [seed.tbn.name, seed.tbn.vesselId, seed.vesselId, seed.vesselImo];

test("the charterer sees the TBN hull as TBN, with no identity anywhere in the page", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  // every server-action response is captured by fetching it through the route (the browser may
  // discard a streamed body before a response listener can read it)
  const bodies: string[] = [];
  await page.route("**/dashboard/fixture-room/**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    bodies.push(await response.text());
    await route.fulfill({ response });
  });
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await dismissOverlays(page);
  const tbn = page.getByTestId(`cand-vessel-${seed.tbn.availabilityId}`);
  await expect(tbn).toBeVisible();
  await expect(tbn.locator(".fxm-card__name")).toContainText("TBN");
  await expect(tbn).toContainText(/identity withheld/i);
  await expect(page.getByTestId(`cand-vessel-${seed.availabilityId}`)).toBeVisible();
  // the reasons are the governed rule's facts, all of them, and none contradicts the match
  await expect(tbn.getByRole("list", { name: /why this matches/i })).toContainText(/grain certified/i);
  await expect(tbn).not.toContainText(/under capacity|opens after laycan|gearless/i);
  // pick again: the candidates now come from the server action, scanned too
  await page.getByRole("button", { name: /^change$/i }).click();
  const before = bodies.length;
  await page.getByTestId(`pick-cargo-${seed.cargoId}`).getByRole("button").click();
  await expect(page.getByTestId(`cand-vessel-${seed.tbn.availabilityId}`)).toBeVisible();
  await expect.poll(() => bodies.length, { message: "the re-pick went through the server action" }).toBeGreaterThan(before);
  const html = await page.content();
  for (const s of secrets()) {
    expect(html, `the page carries ${s}`).not.toContain(s);
    for (const b of bodies) expect(b, `a server-action response carries ${s}`).not.toContain(s);
  }
  await context.close();
});

test("the governed read masks the TBN hull and carries no vessel identifier", async () => {
  const ch = await apiClientAs(seed.charterer.email);
  const { data, error } = await ch.rpc("list_fixture_match_candidates", { p_kind: "cargo", p_listing_id: seed.cargoId });
  expect(error, error?.message).toBeNull();
  const text = JSON.stringify(data);
  for (const s of secrets()) expect(text).not.toContain(s);
  const tbn = (data as { availabilityId: string; name: string }[]).find((x) => x.availabilityId === seed.tbn.availabilityId);
  expect(tbn?.name).toBe("TBN");
});

test("a member cannot list the matches of someone else's cargo", async ({ browser, baseURL }) => {
  const ow = await apiClientAs(seed.owner.email);
  const { data, error } = await ow.rpc("list_fixture_match_candidates", { p_kind: "cargo", p_listing_id: seed.cargoId });
  expect(data).toBeNull();
  expect(error?.message ?? "").toMatch(/FX_AUTH/);
  const { context, page } = await signInAs(browser, baseURL!, seed.owner.email);
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await dismissOverlays(page);
  await expect(page.getByTestId("builder-error")).toContainText(/not one of yours/i);
  await expect(page.getByTestId(/^cand-vessel-/)).toHaveCount(0);
  await context.close();
});
