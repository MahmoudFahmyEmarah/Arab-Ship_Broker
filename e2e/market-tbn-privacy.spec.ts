/**
 * Market / TBN privacy browser proof.
 *
 * The fixture contains one TBN position whose hull, IMO, poster and every raw
 * listing/vessel UUID are canaries. A non-owner must see a useful "TBN" card
 * and match/detail flow without any canary in HTML, RSC/action/REST responses,
 * links, request payloads, the PDA page, or telemetry-visible URLs. Exact owner
 * and admin sessions must still see the real identity.
 */
import { test, expect as baseExpect, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

import {
  PASSWORD,
  apiClientAs,
  dismissOverlays,
  signInAs,
} from "./fixture-room.helpers";

const expect = baseExpect.configure({ timeout: 120_000 });
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 600_000 });

interface PrivacySeed {
  stamp: string;
  owner: { email: string; userId: string; orgId: string };
  outsider: { email: string; userId: string; orgId: string };
  publicOwner: { email: string; userId: string; orgId: string };
  admin: { email: string; userId: string };
  cargoId: string;
  tbn: { vesselId: string; availabilityId: string; name: string; imo: string };
  named: { vesselId: string; availabilityId: string; name: string; imo: string };
  posterSecrets: string[];
}

function localKeys() {
  let url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    const out = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    service = out.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)?.[1];
    url = out.match(/^API_URL="?([^"\n]+)"?/m)?.[1] ?? url;
  }
  if (!service) throw new Error("No local service key");
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(`Refusing to seed market privacy data against ${url}`);
  }
  return { url, service };
}

async function required<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error || data == null) throw new Error(`${label}: ${error?.message ?? "no data"}`);
  return data;
}

async function seedPrivacy(): Promise<PrivacySeed> {
  const { url, service } = localKeys();
  const adminClient: SupabaseClient = createClient(url, service, {
    auth: { persistSession: false },
  });
  const stamp = Date.now().toString(36);
  const imoBase = 1_000_000 + (Number.parseInt(stamp, 36) % 8_900_000);
  const d = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const mk = async (
    prefix: string,
    role: "cargo_owner" | "vessel_owner" | "admin",
    company: string,
    appMetadata: Record<string, unknown> = { role: "member" },
  ) => {
    const email = `e2e-mp-${prefix}-${stamp}@arabshipbroker.test`;
    const { data: auth, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
    });
    if (authError || !auth.user) {
      throw new Error(`auth ${prefix}: ${authError?.message ?? "no user"}`);
    }
    const userId = auth.user.id;
    const { error: userError } = await adminClient.from("users").insert({
      id: userId,
      supabase_user_id: userId,
      email,
      full_name: prefix === "owner" ? `E2E HIDDEN POSTER PERSON ${stamp}` : `E2E ${prefix}`,
      company,
      role,
      admin_tier: role === "admin" ? "super" : null,
      subscription_tier: role === "admin" ? "T4" : "T3",
      is_active: true,
    });
    if (userError) throw new Error(`users ${prefix}: ${userError.message}`);
    if (role === "admin") return { email, userId };
    const org = await required<{ id: string }>(
      adminClient
        .from("organizations")
        .insert({
          name: company,
          org_type: role === "cargo_owner" ? "charterer" : "owner",
          desk_contact_name: prefix === "owner" ? `E2E HIDDEN POSTER DESK ${stamp}` : "Cargo Desk",
          desk_email: prefix === "owner" ? `e2e-hidden-desk-${stamp}@privacy.test` : null,
          desk_phone: prefix === "owner" ? "+30 555 441122" : null,
          address: prefix === "owner" ? `E2E HIDDEN OWNER ADDRESS ${stamp}` : null,
          imo: prefix === "owner" ? "1234567" : null,
          country: prefix === "owner" ? "Egypt" : null,
          fleet_total: prefix === "owner" ? 7 : null,
        })
        .select("id")
        .single(),
      `org ${prefix}`,
    );
    const { error: seatError } = await adminClient.from("organization_members").insert({
      org_id: org.id,
      user_id: userId,
      member_role: "admin",
      is_current: true,
      status: "active",
    });
    if (seatError) throw new Error(`seat ${prefix}: ${seatError.message}`);
    const { error: profileError } = await adminClient.from("profiles").insert({
      account_id: userId,
      profile_type: role === "cargo_owner" ? "cargo" : "vessel",
      display_name: `E2E ${prefix}`,
      is_active: true,
    });
    if (profileError) throw new Error(`profile ${prefix}: ${profileError.message}`);
    return { email, userId, orgId: org.id };
  };

  const ownerCompany = `E2E HIDDEN POSTER ORG ${stamp}`;
  const owner = await mk("owner", "vessel_owner", ownerCompany);
  const outsider = await mk("outsider", "cargo_owner", `E2E Privacy Charterers ${stamp}`);
  const publicOwner = await mk("public-owner", "cargo_owner", `E2E Public Named Owners ${stamp}`);
  const admin = await mk("admin", "admin", "Arab ShipBroker", { role: "admin" });

  const { error: portsError } = await adminClient.from("ports").upsert(
    [
      { locode: "ZZMPA", trade_name: "Privacy Load Port", country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
      { locode: "ZZMPB", trade_name: "Privacy Disch Port", country: "Turkey", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    ],
    { onConflict: "locode", ignoreDuplicates: true },
  );
  if (portsError) throw new Error(`ports: ${portsError.message}`);

  const cargo = await required<{ id: string }>(
    adminClient
      .from("cargo_listings")
      .insert({
        ref: `E2EMP-${stamp}`,
        status: "IN",
        review_status: "APPROVED",
        cargo_type: "Dry Bulk",
        commodity_name: `PRIVACY E2E WHEAT ${stamp}`,
        is_dg_cargo: false,
        is_grain_cargo: true,
        qty_min_mt: 30_000,
        qty_max_mt: 32_000,
        load_port_locode: "ZZMPA",
        load_port_name: "Privacy Load Port",
        load_zone: "E.MED",
        disch_port_locode: "ZZMPB",
        disch_port_name: "Privacy Disch Port",
        disch_zone: "E.MED",
        laycan_from: d(10),
        laycan_to: d(20),
        is_spot: false,
        load_terms: "FIOST",
      })
      .select("id")
      .single(),
    "cargo",
  );
  await adminClient.from("cargo_listings").update({ status: "IN", review_status: "APPROVED" }).eq("id", cargo.id);

  const insertVessel = async (kind: "tbn" | "named", dwt: number) => {
    const isTbn = kind === "tbn";
    const name = isTbn ? `E2E HIDDEN TBN HULL ${stamp.toUpperCase()}` : `E2E PUBLIC NAMED HULL ${stamp.toUpperCase()}`;
    const imo = String(isTbn ? imoBase : imoBase + 1);
    const vessel = await required<{ id: string }>(
      adminClient
        .from("vessels")
        .insert({
          vessel_name: name,
          imo_number: imo,
          vessel_type: "Bulk Carrier",
          dwt_grain: dwt,
          build_year: 2014,
          flag: "Liberia",
          is_geared: true,
          grain_certified: true,
          dg_certified: false,
          is_sanctioned: false,
          is_tbn: isTbn,
          owner_company: isTbn ? ownerCompany : `E2E Public Named Owners ${stamp}`,
          pic_name: isTbn ? `E2E HIDDEN PIC ${stamp}` : "Public Named PIC",
          email_chartering: isTbn ? `hidden-${stamp}@privacy.test` : `public-named-${stamp}@privacy.test`,
        })
        .select("id")
        .single(),
      `${kind} vessel`,
    );
    const availability = await required<{ id: string }>(
      adminClient
        .from("vessel_availability")
        .insert({
          vessel_id: vessel.id,
          open_port_locode: "ZZMPA",
          open_port_name: "Privacy Load Port",
          open_zone: "E.MED",
          open_date: d(5),
          status: "OPEN",
          review_status: "APPROVED",
          accepts_part_cargo: false,
          broker: isTbn ? `E2E HIDDEN BROKER ${stamp}` : "Public named broker",
        })
        .select("id")
        .single(),
      `${kind} availability`,
    );
    await adminClient.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", availability.id);
    return { vesselId: vessel.id, availabilityId: availability.id, name, imo };
  };
  const tbn = await insertVessel("tbn", 31_337);
  const named = await insertVessel("named", 31_500);

  const { error: ownershipError } = await adminClient.from("listing_ownership").insert([
    { listing_type: "cargo", listing_id: cargo.id, owner_user_id: publicOwner.userId, owner_org_id: publicOwner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: tbn.availabilityId, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: named.availabilityId, owner_user_id: publicOwner.userId, owner_org_id: publicOwner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
  ]);
  if (ownershipError) throw new Error(`ownership: ${ownershipError.message}`);
  const { error: matchError } = await adminClient.from("matches").upsert(
    [
      { cargo_id: cargo.id, vessel_avail_id: tbn.availabilityId, score_label: "Strong" },
      { cargo_id: cargo.id, vessel_avail_id: named.availabilityId, score_label: "Good" },
    ],
    { onConflict: "cargo_id,vessel_avail_id" },
  );
  if (matchError) throw new Error(`matches: ${matchError.message}`);

  return {
    stamp,
    owner: owner as PrivacySeed["owner"],
    outsider: outsider as PrivacySeed["outsider"],
    publicOwner: publicOwner as PrivacySeed["publicOwner"],
    admin,
    cargoId: cargo.id,
    tbn,
    named,
    posterSecrets: [
      `E2E HIDDEN POSTER PERSON ${stamp}`,
      ownerCompany,
      `E2E HIDDEN POSTER DESK ${stamp}`,
      `e2e-hidden-desk-${stamp}@privacy.test`,
      "+30 555 441122",
      `E2E HIDDEN OWNER ADDRESS ${stamp}`,
      `E2E HIDDEN BROKER ${stamp}`,
      `E2E HIDDEN PIC ${stamp}`,
      `hidden-${stamp}@privacy.test`,
    ],
  };
}

function cleanupPrivacy(seed: PrivacySeed) {
  const ids = [seed.owner.userId, seed.outsider.userId, seed.publicOwner.userId, seed.admin.userId];
  const sql = `
set session_replication_role = replica;
delete from market_private.listing_handles where actor_user_id in ('${ids.join("','")}') or listing_id in ('${seed.cargoId}','${seed.tbn.availabilityId}','${seed.named.availabilityId}');
delete from public.matches where cargo_id='${seed.cargoId}' or vessel_avail_id in ('${seed.tbn.availabilityId}','${seed.named.availabilityId}');
delete from public.listing_ownership where listing_id in ('${seed.cargoId}','${seed.tbn.availabilityId}','${seed.named.availabilityId}');
delete from public.vessel_contact_history where vessel_id in ('${seed.tbn.vesselId}','${seed.named.vesselId}');
delete from public.vessel_availability where id in ('${seed.tbn.availabilityId}','${seed.named.availabilityId}');
delete from public.vessels where id in ('${seed.tbn.vesselId}','${seed.named.vesselId}');
delete from public.cargo_listings where id='${seed.cargoId}';
delete from public.profiles where account_id in ('${ids.join("','")}');
delete from public.organization_members where user_id in ('${ids.join("','")}');
delete from public.users where id in ('${ids.join("','")}');
delete from auth.users where id in ('${ids.join("','")}');
delete from public.organizations where id in ('${seed.owner.orgId}','${seed.outsider.orgId}','${seed.publicOwner.orgId}');
`;
  try {
    execSync(
      "docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -q -v ON_ERROR_STOP=0",
      { input: sql, stdio: ["pipe", "ignore", "ignore"] },
    );
  } catch {
    // Local test database only; a failed cleanup is reported by the next seed.
  }
}

function forbidden(seed: PrivacySeed) {
  return [
    seed.cargoId,
    seed.tbn.availabilityId,
    seed.tbn.vesselId,
    seed.named.availabilityId,
    seed.named.vesselId,
    seed.tbn.name,
    seed.tbn.imo,
    ...seed.posterSecrets,
  ];
}

function assertNoCanary(haystack: string, seed: PrivacySeed, label: string) {
  const lower = haystack.toLowerCase();
  const compact = lower.replaceAll("-", "");
  for (const secret of forbidden(seed)) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
    if (/^[0-9a-f-]{36}$/i.test(secret)) {
      expect(compact, `${label} leaked compact UUID ${secret}`).not.toContain(secret.replaceAll("-", "").toLowerCase());
    }
  }
}

function captureBrowserBoundary(page: Page) {
  const records: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/dashboard|rest\/v1|telemetry|analytics/i.test(url)) {
      records.push(`REQUEST ${url}\n${request.postData() ?? ""}`);
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!/document|fetch|xhr/.test(request.resourceType())) return;
    const url = response.url();
    if (!/dashboard|rest\/v1/i.test(url)) return;
    void response.text().then((body) => records.push(`RESPONSE ${url}\n${body}`)).catch(() => undefined);
  });
  return records;
}

let seed: PrivacySeed;
test.beforeAll(async () => { seed = await seedPrivacy(); });
test.afterAll(async () => { if (seed) cleanupPrivacy(seed); });

test("non-owner TBN board, detail, match and PDA payloads contain no identity or raw id", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.outsider.email);
  const records = captureBrowserBoundary(page);

  await page.goto("/dashboard/vessels/browse");
  await dismissOverlays(page);
  await expect(page.getByRole("heading", { name: "Tonnage Market" })).toBeVisible();
  const tbnCard = page.locator(".vessel-card").filter({ hasText: "TBN" }).filter({ hasText: "31,337 MT" });
  await expect(tbnCard).toBeVisible();
  await expect(tbnCard).toContainText("TBN");
  await expect(tbnCard).not.toContainText(seed.tbn.imo);
  await expect(page.getByText(seed.named.name, { exact: true })).toBeVisible();
  await tbnCard.click();
  await expect(page.locator("body")).toContainText("TBN");

  await page.goto("/dashboard/cargo");
  await dismissOverlays(page);
  const cargoCard = page.locator(".cargo-card, .asb-card").filter({ hasText: `PRIVACY E2E WHEAT ${seed.stamp}` }).first();
  await expect(cargoCard).toBeVisible();
  const matchButton = cargoCard.locator(".cc-foot-col--match").first();
  await expect(matchButton).toBeVisible();
  await matchButton.click();
  await expect(page.getByRole("dialog")).toContainText(/TBN|PUBLIC NAMED HULL/i);

  // PDA may use exact owner-only raw vessel catalogues. A cargo-side outsider
  // must not receive this TBN through page/RSC data, and no market handle is a
  // substitute vessel FK.
  await page.goto("/dashboard/ports-da");
  await dismissOverlays(page);
  await expect(page.locator("body")).toBeVisible();

  await page.waitForTimeout(500);
  assertNoCanary(await page.content(), seed, "rendered page");
  assertNoCanary(records.join("\n"), seed, "browser/network boundary");
  await context.close();
});

test("direct member RPCs are opaque and a foreign actor cannot use their keys", async () => {
  const outsider = await apiClientAs(seed.outsider.email);
  const vessels = await outsider.rpc("list_market_vessels", { p_archive_cutoff: null, p_vessel_active_from: null });
  expect(vessels.error, vessels.error?.message).toBeNull();
  assertNoCanary(JSON.stringify(vessels.data), seed, "list_market_vessels");
  const rows = vessels.data as Array<Record<string, unknown>>;
  const tbn = rows.find((row) => {
    const vessel = row.vessel as Record<string, unknown> | undefined;
    return vessel?.vessel_name === "TBN";
  });
  expect(tbn).toBeTruthy();
  expect(tbn?.poster).toBeNull();
  expect(tbn?.ownership).toBeNull();
  expect(tbn?.owned_listing_id).toBeNull();
  expect(tbn?.id).toBe(tbn?.listing_key);

  const cargo = await outsider.rpc("list_market_cargo", { p_archive_cutoff: null, p_spot_active_from: null });
  expect(cargo.error, cargo.error?.message).toBeNull();
  const cargoRows = cargo.data as Array<Record<string, unknown>>;
  const ownCargo = cargoRows.find((row) => row.commodity_name === `PRIVACY E2E WHEAT ${seed.stamp}`);
  expect(ownCargo?.owned_listing_id).toBeNull();
  const matches = await outsider.rpc("list_market_matches", { p_listing_key: ownCargo?.listing_key });
  expect(matches.error, matches.error?.message).toBeNull();
  assertNoCanary(JSON.stringify(matches.data), seed, "list_market_matches");
  const matchedTbn = (matches.data as Array<Record<string, unknown>>).find((row) => {
    const vessel = row.vessel as Record<string, unknown> | undefined;
    return vessel?.vessel_name === "TBN";
  });
  expect(matchedTbn).toBeTruthy();
  expect(matchedTbn?.board_listing_key).toBe(tbn?.listing_key);
  expect(matchedTbn?.listing_key).not.toBe(matchedTbn?.board_listing_key);

  const wrongPurpose = await outsider.rpc("list_market_matches", {
    p_listing_key: matchedTbn?.listing_key,
  });
  expect(wrongPurpose.data).toBeNull();
  expect(wrongPurpose.error?.message ?? "").toMatch(/MARKET_NOT_FOUND/);

  const outsiderDetail = await outsider.rpc("get_market_listing_detail", { p_listing_key: matchedTbn?.listing_key });
  expect(outsiderDetail.error, outsiderDetail.error?.message).toBeNull();
  expect((outsiderDetail.data as { ownership?: unknown } | null)?.ownership).toBeNull();
  assertNoCanary(JSON.stringify(outsiderDetail.data), seed, "get_market_listing_detail outsider");

  const owner = await apiClientAs(seed.owner.email);
  const stolen = await owner.rpc("get_market_listing_detail", { p_listing_key: tbn?.listing_key });
  expect(stolen.data).toBeNull();
  expect(stolen.error?.message ?? "").toMatch(/MARKET_NOT_FOUND/);
  const stolenManagedVessel = await outsider.rpc("get_managed_vessel", {
    p_vessel_id: seed.tbn.vesselId,
  });
  expect(stolenManagedVessel.data).toBeNull();
  expect(stolenManagedVessel.error?.message ?? "").toMatch(/MARKET_NOT_FOUND/);

  const allowedOwnershipKeys = [
    "manager_company", "manager_org_country", "manager_org_desk",
    "manager_org_fleet", "manager_org_name", "owner_company",
    "owner_org_country", "owner_org_desk", "owner_org_fleet",
    "owner_org_imo", "owner_org_name",
  ];
  for (const account of [seed.owner, seed.admin]) {
    const client = await apiClientAs(account.email);
    const listed = await client.rpc("list_market_vessels", { p_archive_cutoff: null, p_vessel_active_from: null });
    expect(listed.error, listed.error?.message).toBeNull();
    const ownTbn = (listed.data as Array<Record<string, unknown>>).find((row) => {
      const vessel = row.vessel as Record<string, unknown> | undefined;
      return vessel?.vessel_name === seed.tbn.name;
    });
    expect(ownTbn).toBeTruthy();
    const governed = await client.rpc("get_market_listing_detail", { p_listing_key: ownTbn?.listing_key });
    expect(governed.error, governed.error?.message).toBeNull();
    const ownership = (governed.data as { ownership?: Record<string, unknown> } | null)?.ownership;
    expect(ownership).toBeTruthy();
    expect(Object.keys(ownership ?? {}).sort()).toEqual(allowedOwnershipKeys);
    expect(ownership?.owner_company).toBe(`E2E HIDDEN POSTER ORG ${seed.stamp}`);
    expect(ownership?.owner_org_name).toBe(`E2E HIDDEN POSTER ORG ${seed.stamp}`);
    expect(ownership?.owner_org_imo).toBe("1234567");
    expect(ownership?.owner_org_country).toBe("Egypt");
    expect(ownership?.owner_org_fleet).toBe(7);
    expect(ownership?.owner_org_desk).toBe(`E2E HIDDEN POSTER DESK ${seed.stamp}`);
    expect(JSON.stringify(ownership)).not.toMatch(/email|phone|address|org_id|user_id|account_id/i);
    expect(JSON.stringify(ownership)).not.toContain(seed.owner.orgId);

    const managed = await client.rpc("get_managed_vessel", { p_vessel_id: seed.tbn.vesselId });
    expect(managed.error, managed.error?.message).toBeNull();
    expect((managed.data as Record<string, unknown> | null)?.id).toBe(seed.tbn.vesselId);
    expect((managed.data as Record<string, unknown> | null)?.vessel_name).toBe(seed.tbn.name);
  }
});

test("exact owner and admin keep the TBN identity and management links", async ({ browser, baseURL }) => {
  for (const account of [seed.owner, seed.admin]) {
    const { context, page } = await signInAs(browser as Browser, baseURL!, account.email);
    await page.goto("/dashboard/vessels/browse");
    await dismissOverlays(page);
    const card = page.locator(".vessel-card").filter({ hasText: seed.tbn.name });
    await expect(card).toBeVisible();
    await expect(card).toContainText(seed.tbn.imo);
    await card.click();
    await expect(page.locator(`a[href*="${seed.tbn.availabilityId}"]`).first()).toBeVisible();
    await context.close();
  }
});

test("phone viewport keeps the same privacy boundary", async ({ browser, baseURL }) => {
  const { context, page } = await signInAs(browser, baseURL!, seed.outsider.email);
  await page.setViewportSize({ width: 390, height: 844 });
  const records = captureBrowserBoundary(page);
  await page.goto("/dashboard/vessels/browse");
  await dismissOverlays(page);
  await expect(page.locator(".vessel-card").filter({ hasText: "TBN" }).first()).toBeVisible();
  assertNoCanary(await page.content(), seed, "phone HTML");
  assertNoCanary(records.join("\n"), seed, "phone network boundary");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await context.close();
});
