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
import { apiClientAs, cleanupFixture, cleanupSeat, dismissOverlays, seedFixture, seedOrgSeat, signInAs, type FixtureSeed } from "./fixture-room.helpers";

const expect = baseExpect.configure({ timeout: 180_000 });
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 600_000 });

let seed: FixtureSeed;
let seat: { email: string; userId: string } | null = null;
test.beforeAll(async () => { seed = await seedFixture(); seat = await seedOrgSeat(seed); });
test.afterAll(async () => { if (seat) cleanupSeat(seat); if (seed) cleanupFixture(seed); });

// the raw identifiers of the owner's two positions (C2O-013: the availability ids are hull identifiers too)
const secrets = () => [seed.tbn.name, seed.tbn.vesselId, seed.vesselId, seed.vesselImo, seed.tbn.availabilityId, seed.availabilityId];
// C2O-015 item 4: a leak in any form — any case, and a uuid with or without its hyphens
const leaks = (text: string) => {
  const t = text.toLowerCase(), flat = t.replace(/-/g, "");
  return secrets().filter((s) => { const x = s.toLowerCase(); return t.includes(x) || flat.includes(x.replace(/-/g, "")); });
};

test("the charterer sees the TBN hull as TBN, with no identity anywhere in the page", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  // every server-action response is captured by fetching it through the route (the browser may
  // discard a streamed body before a response listener can read it)
  const bodies: string[] = [];
  await page.route("**/dashboard/fixture-room/**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    try {
      const response = await route.fetch();
      bodies.push(await response.text());
      await route.fulfill({ response });
    } catch {
      // the page navigated (or closed) mid-request; nothing to scan from this one
    }
  });
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await dismissOverlays(page);
  const tbn = page.getByTestId("cand-vessel").filter({ hasText: "identity withheld" });
  await expect(tbn).toBeVisible();
  await expect(tbn.locator(".fxm-card__name")).toContainText("TBN");
  await expect(tbn).toContainText(/identity withheld/i);
  await expect(page.getByTestId("cand-vessel").filter({ hasText: seed.vesselName })).toBeVisible();
  // the reasons are the governed rule's facts, all of them, and none contradicts the match
  await expect(tbn.getByRole("list", { name: /why this matches/i })).toContainText(/grain certified/i);
  await expect(tbn).not.toContainText(/under capacity|opens after laycan|gearless/i);
  // pick again: the candidates now come from the server action, scanned too
  await page.getByRole("button", { name: /^change$/i }).click();
  const before = bodies.length;
  await page.getByTestId(`pick-cargo-${seed.cargoId}`).getByRole("button").click();
  await expect(page.getByTestId("cand-vessel").filter({ hasText: "identity withheld" })).toBeVisible();
  await expect.poll(() => bodies.length, { message: "the re-pick went through the server action" }).toBeGreaterThan(before);
  const html = await page.content();
  for (const s of secrets()) {
    expect(html, `the page carries ${s}`).not.toContain(s);
    for (const b of bodies) expect(b, `a server-action response carries ${s}`).not.toContain(s);
  }
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
});
test("the governed read masks the TBN hull and carries no vessel identifier", async () => {
  const ch = await apiClientAs(seed.charterer.email);
  const { data, error } = await ch.rpc("list_fixture_match_candidates", { p_kind: "cargo", p_listing_id: seed.cargoId });
  expect(error, error?.message).toBeNull();
  const text = JSON.stringify(data);
  for (const s of secrets()) expect(text).not.toContain(s);
  const rows = data as { candidateKey?: string; name: string; availabilityId?: string }[];
  expect(rows.every((x) => typeof x.candidateKey === "string" && x.availabilityId === undefined), "every candidate is an opaque key, never a raw id").toBe(true);
  expect(rows.some((x) => x.name === "TBN")).toBe(true);
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
  await expect(page.getByTestId("cand-vessel")).toHaveCount(0);
  await context.close();
});
// re-audit C2O-011 item 3: a second active seat of the owning organisation can pick the
// organisation's cargo (it did not post it) and gets the same masked candidates
test("a second seat of the charterer organisation picks the organisation's cargo", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seat!.email);
  await page.goto("/dashboard/fixture-room/new");
  await dismissOverlays(page);
  const pick = page.getByTestId(`pick-cargo-${seed.cargoId}`);
  await expect(pick).toBeVisible();
  await pick.getByRole("button").click();
  const tbn = page.getByTestId("cand-vessel").filter({ hasText: "identity withheld" });
  await expect(tbn).toBeVisible();
  await expect(tbn.locator(".fxm-card__name")).toContainText("TBN");
  const html = await page.content();
  for (const s of secrets()) expect(html, `the page carries ${s}`).not.toContain(s);
  // and through the API: the governed own-listing read includes it, the candidates stay masked
  const api = await apiClientAs(seat!.email);
  const mine = await api.rpc("list_fixture_my_listings");
  expect(mine.error, mine.error?.message).toBeNull();
  expect(JSON.stringify(mine.data)).toContain(seed.cargoId);
  const nul = await api.rpc("list_fixture_match_candidates", { p_kind: null, p_listing_id: seed.cargoId });
  expect(nul.error?.message ?? "").toMatch(/FX_VALIDATION/);   // re-audit item 4: a null kind is refused
  await context.close();
});
// C2O-013: the room opened on the TBN hull carries no hull or position id in its page or reads
test("a room opened from the TBN key reveals no hull or position id", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.charterer.email);
  const bodies: string[] = [];
  await page.route("**/dashboard/fixture-room/**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    try {
      const response = await route.fetch();
      bodies.push(await response.text());
      await route.fulfill({ response });
    } catch {
      // the page navigated (or closed) mid-request; nothing to scan from this one
    }
  });
  await page.goto(`/dashboard/fixture-room/new?cargo=${seed.cargoId}`);
  await dismissOverlays(page);
  await page.getByTestId("cand-vessel").filter({ hasText: "identity withheld" }).getByRole("button", { name: /open fixture/i }).click();
  await page.waitForURL(/\/dashboard\/fixture-room\/[0-9a-f-]{36}$/);
  const roomId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("room-header")).toBeVisible();
  const html = await page.content();
  for (const s of secrets()) {
    expect(html, `the room page carries ${s}`).not.toContain(s);
    for (const b of bodies) expect(b, `a server-action response carries ${s}`).not.toContain(s);
  }
  // the owner joins and types hidden identifiers into the room (C2O-015 items 4 and 5):
  // the position id in upper case, the vessel id without hyphens, the hull's name in lower case
  const ow = await apiClientAs(seed.owner.email);
  const v1 = (await ow.rpc("get_fixture_room_version", { p_room_id: roomId })).data as number;
  const joined = await ow.rpc("respond_fixture_invitation", { p_room_id: roomId, p_accept: true, p_expected_version: v1, p_idempotency_key: `e2e-hostile-accept-${seed.stamp}` });
  expect(joined.error, joined.error?.message).toBeNull();
  const v2 = (await ow.rpc("get_fixture_room_version", { p_room_id: roomId })).data as number;
  const hostile = `our ref ${seed.tbn.availabilityId.toUpperCase()}/x, hull ${seed.tbn.vesselId.replace(/-/g, "")}, she is the ${seed.tbn.name.toLowerCase()}`;
  const posted = await ow.rpc("post_fixture_message", { p_room_id: roomId, p_body: hostile, p_kind: "note", p_visibility: "room", p_term_id: null, p_expected_version: v2, p_idempotency_key: `e2e-hostile-msg-${seed.stamp}`, p_as_party_id: null });
  expect(posted.error, posted.error?.message).toBeNull();
  // the charterer's page, its server-action bodies and its own JWT read carry none of it, in any form
  bodies.length = 0;
  await page.reload();
  await dismissOverlays(page);
  await expect(page.getByTestId("room-header")).toBeVisible();
  await expect(page.getByText(/our ref \[withheld\]/)).toBeVisible();
  expect(leaks(await page.content()), "the room page after the hostile message").toEqual([]);
  for (const b of bodies) expect(leaks(b), "a server-action body after the hostile message").toEqual([]);
  const ch = await apiClientAs(seed.charterer.email);
  const room = await ch.rpc("get_fixture_room", { p_room_id: roomId });
  expect(room.error, room.error?.message).toBeNull();
  expect(leaks(JSON.stringify(room.data)), "the member-JWT room read").toEqual([]);
  expect(JSON.stringify(room.data)).toContain("[withheld]");
  // and the raw-id create is no longer callable by a member
  const raw = await ch.rpc("create_fixture_room", { p_cargo_listing_id: seed.cargoId, p_vessel_availability_id: seed.tbn.availabilityId, p_terms: [], p_idempotency_key: `e2e-raw-${seed.stamp}`, p_options: {} });
  expect(raw.error?.message ?? "").toMatch(/permission denied/i);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
});
