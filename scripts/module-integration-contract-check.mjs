import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260923320000_fixture_pda_shared_integration.sql", "utf8");
const rollback = await readFile("supabase/rollback/20260923_fixture_pda_shared_integration_down.sql", "utf8");
const fixtureTypes = await readFile("lib/fixture-room/types.ts", "utf8");
const fixtureSdk = await readFile("sdk/app/fixtures.ts", "utf8");
const portalSidebar = await readFile("components/portal/PortalSidebar.tsx", "utf8");
const harness = await readFile("scripts/module-integration-harness.sh", "utf8");

assert.match(migration, /create or replace function public\.sync_fixture_listing_status/i);
assert.match(migration, /fn_fixture_owns_listing\('cargo', r\.cargo_listing_id\)/i);
assert.match(migration, /fn_fixture_owns_listing\('vessel_availability', r\.vessel_availability_id\)/i);
assert.match(migration, /status = v_cargo_target::public\.cargo_status_enum/i);
assert.match(migration, /status = v_vessel_target::public\.vessel_status_enum/i);
assert.match(migration, /listing_sync\.applied/i);

assert.match(migration, /create table if not exists public\.fixture_pda_links/i);
assert.match(migration, /pda_estimate_id\s+uuid not null,/i);
assert.doesNotMatch(migration, /pda_estimate_id\s+uuid[^\n]*references public\.pda_estimates/i);
assert.match(migration, /if not public\.fn_can_read_pda_estimate\(p_pda_estimate_id\)/i);
assert.match(migration, /v_header := public\.fn_pda_estimate_header\(p_pda_estimate_id\)/i);
assert.match(migration, /The vessel id is validation-only\. It is never persisted here or returned\./i);
for (const field of ["terminal_id", "call_date", "fx_rate", "fx_source", "is_superseded", "line_count", "manual_line_count", "warning_count"]) {
  assert.match(migration, new RegExp(field, "i"));
}
assert.match(migration, /alter table public\.fixture_pda_links enable row level security/i);
assert.match(migration, /revoke all on table public\.fixture_pda_links from public, anon, authenticated/i);
assert.doesNotMatch(migration, /'vesselId', v_header/i);
assert.match(migration, /create or replace function public\.list_fixture_pda_links/i);
assert.match(migration, /grant execute on function public\.list_fixture_pda_links\(uuid\) to authenticated, service_role/i);
assert.match(migration, /'pda\.linked'/i);
assert.match(migration, /a\.attname = 'type'[\s\S]+a\.attnum = any\(c\.conkey\)/i);
assert.match(rollback, /drop table if exists public\.fixture_pda_links/i);
assert.match(rollback, /drop function if exists public\.link_fixture_pda_estimate/i);
assert.match(rollback, /a\.attname = 'type'[\s\S]+a\.attnum = any\(c\.conkey\)/i);
assert.match(fixtureTypes, /"listing_sync\.applied" \| "pda\.linked"/i);
assert.match(fixtureSdk, /export function syncFixtureListingStatus/i);
assert.match(fixtureSdk, /export function linkFixturePdaEstimate/i);
assert.match(portalSidebar, /href: `\$\{basePath\}\/ports-da`[^\n]*disabled: econLocked/i);
assert.doesNotMatch(portalSidebar, /href: `\$\{basePath\}\/ports-da`[^\n]*comingSoon/i);
for (const version of [
  "20260923100000", "20260923101000", "20260923102000", "20260923103000",
  "20260923200000", "20260923201000", "20260923202000", "20260923203000",
  "20260923206000", "20260923207000", "20260923208000",
  "20260923310000", "20260923320000", "20260923330000", "20260923340000",
  "20260923360000", "20260923361000", "20260923362000",
]) assert.match(harness, new RegExp(version), `combined harness is missing ${version}`);
assert.match(harness, /account_anonymisation_smoke\.sql/i);
assert.match(harness, /user_privilege_boundary_smoke\.sql/i);
assert.match(harness, /fixture_pda_shared_smoke\.sql/i);
assert.match(harness, /fixture_candidates_smoke\.sql/i);
assert.match(harness, /fixture_liftall_smoke\.sql/i);
assert.match(harness, /fixture_handles_smoke\.sql/i);
assert.match(harness, /market_tbn_privacy\.sql/i);
assert.doesNotMatch(harness, /2026092320(4000|5000)|fixture_(expiry|notify)_smoke/i);

console.log("MODULE INTEGRATION CONTRACT: ALL ASSERTIONS PASSED");
