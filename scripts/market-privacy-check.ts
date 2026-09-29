/**
 * Market/TBN privacy firewall pure checks (no network and no database).
 *
 * Run with:
 *   node --import tsx scripts/market-privacy-check.ts
 *
 * The executable SQL suites prove behaviour.  This checker complements them
 * by pinning the release shape: private opaque handles, exact ownership, the
 * four governed discovery RPCs, exact-owner management commands, closure of
 * every known raw-id bypass, app cut-over, rollback coverage, and the required
 * regression assets.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
const exists = (relative: string) => fs.existsSync(path.join(root, relative));
const uncomment = (value: string) =>
  value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(` FAIL  ${label}`);
  }
};
const has = (value: string, pattern: RegExp | string) =>
  typeof pattern === "string" ? value.includes(pattern) : pattern.test(value);
const all = (value: string, patterns: Array<RegExp | string>) =>
  patterns.every((pattern) => has(value, pattern));
const occurrences = (value: string, pattern: RegExp) => value.match(pattern)?.length ?? 0;
const normalizedSqlList = (value: string) => value
  .split(",")
  .map((part) => part.replace(/\s+/g, "").toLowerCase())
  .filter(Boolean)
  .sort()
  .join(",");

const stage1Path = "supabase/migrations/20260923360000_market_candidate_handles.sql";
const stage2Path = "supabase/migrations/20260923361000_market_tbn_firewall.sql";
const stage3Path = "supabase/migrations/20260923362000_market_review_status_firewall.sql";
const down1Path = "supabase/rollback/20260923360000_market_candidate_handles_down.sql";
const down2Path = "supabase/rollback/20260923361000_market_tbn_firewall_down.sql";
const down3Path = "supabase/rollback/20260923362000_market_review_status_firewall_down.sql";
const sqlTestPath = "supabase/tests/market_privacy/market_tbn_privacy.sql";
const perfTestPath = "supabase/tests/market_privacy/market_performance_200x200.sql";
const racePath = "supabase/tests/market_privacy/market_handle_two_sessions.sh";
const vesselRacePath = "supabase/tests/market_privacy/market_vessel_rpc_two_sessions.sh";
const harnessPath = "scripts/market-privacy-harness.sh";
const browserPath = "e2e/market-tbn-privacy.spec.ts";
const configPath = "playwright.market-privacy.config.ts";

console.log("1 · release assets");
for (const file of [
  stage1Path,
  stage2Path,
  stage3Path,
  down1Path,
  down2Path,
  down3Path,
  sqlTestPath,
  perfTestPath,
  racePath,
  vesselRacePath,
  harnessPath,
  browserPath,
  configPath,
]) {
  ok(exists(file), `${file} exists`);
}

const stage1 = read(stage1Path);
const stage2 = read(stage2Path);
const stage3 = read(stage3Path);
const down1 = read(down1Path);
const down2 = read(down2Path);
const down3 = read(down3Path);
const dollarBlock = (value: string, label: string) =>
  value.match(new RegExp(`do \\$${label}\\$[\\s\\S]*?\\$${label}\\$;`, "i"))?.[0] ?? "";
const insertBlock = (value: string, table: string) =>
  value.match(new RegExp(`insert into ${table.replaceAll(".", "\\.")}[\\s\\S]*?on conflict do nothing;`, "i"))?.[0] ?? "";
const restoreLegacyRelationAcl = dollarBlock(down2, "restore_acl");
const restoreLegacyColumnAcl = dollarBlock(down2, "restore_column_acl");
const restoreLegacyRoutineAcl = dollarBlock(down2, "restore_routine_acl");
const restoreReviewRelationAcl = dollarBlock(down3, "restore_review_acl");
const restoreReviewColumnAcl = dollarBlock(down3, "restore_review_column_acl");
const legacyRelationAclSnapshot = insertBlock(stage2, "market_private.legacy_relation_acl_snapshot");
const legacyColumnAclSnapshot = insertBlock(stage2, "market_private.legacy_column_acl_snapshot");
const legacyRoutineAclSnapshot = insertBlock(stage2, "market_private.legacy_routine_acl_snapshot");
const reviewRelationAclSnapshot = insertBlock(stage3, "market_private.review_relation_acl_snapshot");
const reviewColumnAclSnapshot = insertBlock(stage3, "market_private.review_column_acl_snapshot");
const sqlTest = read(sqlTestPath);
const perfTest = read(perfTestPath);
const race = read(racePath);
const vesselRace = read(vesselRacePath);
const harness = read(harnessPath);
const browser = read(browserPath);
const config = read(configPath);

console.log("2 · private actor-bound handle store");
ok(all(stage1, [
  "create schema if not exists market_private",
  "create table if not exists market_private.listing_handles",
  /key\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i,
  /actor_user_id\s+uuid\s+not null/i,
  /purpose\s+text\s+not null/i,
  /listing_type\s+text\s+not null/i,
  /listing_id\s+uuid\s+not null/i,
  /expires_at\s+timestamptz\s+not null/i,
]), "opaque handle table records actor, purpose, listing type/id and expiry");
ok(all(stage1, [
  "revoke all on schema market_private from public, anon, authenticated",
  "revoke all on table market_private.listing_handles from public, anon, authenticated",
  "grant usage on schema market_private to service_role",
  "grant all on table market_private.listing_handles to service_role",
]), "private schema/table have no member ACL and retain service maintenance");
const handleDdl = stage1.match(/create table if not exists market_private\.listing_handles\s*\(([\s\S]*?)\n\);/i)?.[1] ?? "";
ok(!/references\s+(?:public\.)?(?:pda|fixture)/i.test(handleDdl), "market handles have no PDA/Fixture foreign key");
ok(/unique index[\s\S]*actor_user_id, purpose, listing_type, listing_id/i.test(stage1), "one reusable tuple per actor/purpose/listing");
ok(all(stage1, [
  /'cargo_board'\s*,\s*'vessel_board'\s*,\s*'cargo_match'\s*,\s*'vessel_match'/,
  /(?:now\(\)|v_now) \+ interval '30 minutes'/,
  /when h\.expires_at > (?:now\(\)|v_now) then h\.key[\s\S]*else gen_random_uuid\(\)/i,
]), "purpose allow-list and 30-minute handle reuse/rotation are explicit");
const issueHandle = stage1.match(/create or replace function public\.fn_market_issue_handle[\s\S]*?\$function\$;/i)?.[0] ?? "";
const issueHandlesBulk = stage1.match(/create or replace function market_private\.issue_listing_handles_bulk[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(/#variable_conflict use_column/i.test(issueHandlesBulk),
  "bulk handle upsert resolves RETURNS TABLE names as SQL columns");
const purgeHandles = stage1.match(/create or replace function market_private\.purge_listing_handles[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(all(purgeHandles, [
  /p_limit\s+integer\s+default\s+1000/i,
  /returns\s+integer/i,
  /expires_at < now\(\) - interval '1 day'/i,
  /v_limit\s+integer\s*:=\s*least\(greatest\(coalesce\(p_limit,\s*1000\),\s*1\),\s*1000\)/i,
  /limit\s+v_limit/i,
]), "abandoned-handle purge has a hard one-day/1000-row bound");
ok(!/purge_listing_handles|delete\s+from\s+market_private\.listing_handles/i.test(issueHandle),
  "per-row handle issuance performs no retention purge");
for (const fn of ["list_market_cargo", "list_market_vessels", "list_market_matches", "get_market_listing_detail"]) {
  const body = stage1.match(new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\$function\\$;`, "i"))?.[0] ?? "";
  ok(occurrences(body, /market_private\.purge_listing_handles\(/gi) === 1, `${fn} performs exactly one bounded purge per request`);
}
ok(all(stage1, [
  /from public\.users u[\s\S]*u\.supabase_user_id = auth\.uid\(\)[\s\S]*u\.id = auth\.uid\(\)/i,
  /return v_actor/i,
]), "handles bind to public.users identity across the dual auth key");
ok(occurrences(stage1, /order by coalesce\(u\.supabase_user_id = auth\.uid\(\), false\) desc,[\s\S]*?coalesce\(u\.id = auth\.uid\(\), false\) desc,[\s\S]*?u\.id/gi) >= 3 &&
   /order by coalesce\(u\.supabase_user_id = v_auth_id, false\) desc,[\s\S]*?coalesce\(u\.id = v_auth_id, false\) desc,[\s\S]*?u\.id/i.test(stage2),
  "dual-key actor resolution prefers the mapped Supabase identity with null-safe deterministic ordering");
ok(all(stage1, [
  /lo\.role = 'primary'/,
  /lo\.is_current/,
  /lo\.owned_until is null or lo\.owned_until > now\(\)/,
  /lo\.owner_org_id is null[\s\S]*lo\.owner_user_id = p_actor/,
  /om\.org_id = lo\.owner_org_id[\s\S]*om\.user_id = p_actor[\s\S]*om\.is_current[\s\S]*om\.status = 'active'/,
]), "ownership is exact personal identity or a current active seat in the exact organisation");
for (const [prefix, state] of [
  ["MARKET_AUTH", "42501"],
  ["MARKET_NOT_FOUND", "P0002"],
  ["MARKET_EXPIRED", "55000"],
  ["MARKET_VALIDATION", "22023"],
] as const) {
  ok(stage1.includes(prefix) && stage1.includes(`errcode = '${state}'`), `${prefix} uses SQLSTATE ${state}`);
}
ok(/unknown and foreign handles are deliberately indistinguishable/i.test(stage1), "foreign and unknown handles share MARKET_NOT_FOUND");

console.log("3 · governed payload/API contract");
for (const fn of [
  "list_market_cargo(date, date)",
  "list_market_vessels(date, date)",
  "list_market_matches(uuid)",
  "get_market_listing_detail(uuid)",
]) {
  ok(stage1.includes(`grant execute on function public.${fn} to authenticated`), `${fn} is authenticated only`);
  const signature = fn.replace(/[().]/g, "\\$&");
  ok(new RegExp(`revoke all on function public\\.${signature}[\\s\\S]{0,100}from public, anon`, "i").test(stage1), `${fn} is not anonymous/public`);
}
for (const fn of [
  "list_my_cargo()",
  "list_my_vessels()",
  "get_managed_vessel(uuid)",
  "set_market_vessel_availability_status(uuid, public.vessel_status_enum)",
  "fn_owns_cargo(uuid)",
  "fn_owns_vessel(uuid)",
  "fn_position_checkin(uuid, text, date, time without time zone, date)",
]) {
  const words = fn.replace(/[(),.]/g, " ").trim().split(/\s+/).join("[\\s\\n,().]*");
  ok(new RegExp(`revoke all on function public\\.${words}[\\s\\S]{0,100}from public, anon, authenticated, service_role`, "i").test(stage1) &&
     new RegExp(`grant execute on function public\\.${words}[\\s\\S]{0,40}to authenticated`, "i").test(stage1),
     `${fn} is an authenticated actor RPC only`);
}
ok(all(stage1, [
  /'id', v_key/,
  /'listing_key', v_key/,
  /'board_listing_key', v_board_key/,
  /'owned_listing_id', case when v_manage then c\.id else null end/,
  /'owned_listing_id', case when v_manage then a\.id else null end/,
  /'id', case when v_manage then v\.id else null end/,
]), "public ids are purpose-bound handles, match rows correlate by board key, and raw ids are management-only");
ok(all(stage1, [
  /v_mask_tbn := coalesce\(v\.is_tbn, false\) and not v_manage/,
  /'vessel_name', case when v_mask_tbn then 'TBN' else v\.vessel_name end/,
  /'imo_number', case when v_mask_tbn then null else v\.imo_number end/,
  /'poster', case when v_mask_tbn then null else public\.fn_market_poster/,
]), "an unowned TBN has fixed label, null IMO/id and null poster");
const ownershipHelper = stage1.match(/create or replace function market_private\.vessel_ownership[\s\S]*?\$function\$;/i)?.[0] ?? "";
const ownershipObject = ownershipHelper.match(/return jsonb_build_object\(([\s\S]*?)\n\s*\);/i)?.[1] ?? "";
for (const key of [
  "owner_company", "owner_org_name", "owner_org_imo", "owner_org_country",
  "owner_org_fleet", "owner_org_desk", "manager_company",
  "manager_org_name", "manager_org_country", "manager_org_fleet",
  "manager_org_desk",
]) {
  ok(ownershipObject.includes(`'${key}'`), `management ownership allow-list contains ${key}`);
}
ok(!/['"](?:email|phone|address|org_id|user_id|account_id)['"]/i.test(ownershipObject), "ownership result carries no contact PII or stable id key");
ok(/'ownership', case[\s\S]*when v_manage then market_private\.vessel_ownership\(v\.id\)[\s\S]*else null/i.test(stage1), "ownership is null unless exact owner/admin management is established");
const posterFn = stage1.match(/create or replace function public\.fn_market_poster[\s\S]*?\$function\$;/i)?.[0] ?? "";
const posterObject = posterFn.match(/jsonb_build_object\(([\s\S]*?)\)\s*(?:from|into|;)/i)?.[1] ?? "";
ok(all(posterObject, ["'name'", "'company'", "'kind'", "'is_admin'"]) &&
   !/['"](?:org_id|user_id|account_id|owner_user_id|owner_org_id)['"]/i.test(posterObject),
   "named-row poster is display-only and carries no stable identity id");
ok(/lo\.owner_org_id[\s\S]*organizations[\s\S]*o\.id\s*=\s*lo\.owner_org_id/i.test(posterFn),
  "poster company is selected from the listing's exact owning organisation");
const governedHandlePeeks = stage1.match(
  /select\s+\*\s+into h\s+from market_private\.peek_listing_handle\(v_actor,\s*p_listing_key\)/gi,
) ?? [];
ok(governedHandlePeeks.length === 2 &&
   /revoke all on function market_private\.peek_listing_handle\(uuid, uuid\)[\s\S]{0,80}from public, anon, authenticated, service_role/i.test(stage1),
  "matches/detail privately inspect only the caller's handle before globally ordered bulk refresh");
ok(/p_purpose not in \('cargo_board', 'vessel_board', 'cargo_match', 'vessel_match'\)/.test(stage1), "board and match handles share the governed resolver domain");
ok(/if not \([\s\S]*h\.purpose = 'cargo_board'[\s\S]*h\.purpose = 'vessel_board'[\s\S]*MARKET_NOT_FOUND/i.test(stage1),
  "match enumeration refuses a purpose-mismatched handle");
const requestContext = stage1.match(/create or replace function market_private\.market_request_context[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(all(requestContext, [
  /fresh_after\s*:=\s*now\(\)\s*-\s*make_interval/i,
  /v_server\s*:=\s*current_date\s*-\s*v_cargo_days/i,
  /p_cargo_requested is null or p_cargo_requested < v_server/i,
  /v_server\s*:=\s*current_date\s*-\s*v_vessel_days/i,
  /p_vessel_requested is null or p_vessel_requested < v_server/i,
]) && all(stage1, [
  /market_request_context\([\s\S]{0,100}v_actor, p_spot_active_from, null/i,
  /market_request_context\([\s\S]{0,100}v_actor, null, p_vessel_active_from/i,
]), "NULL or ancient caller cutoffs cannot widen request-scoped server windows");
const discoveryFresh = stage1.match(/create or replace function market_private\.discovery_fresh_ok[\s\S]*?\$function\$;/i)?.[0] ?? "";
const cargoIsMarketLive = stage1.match(/create or replace function market_private\.cargo_is_market_live[\s\S]*?\$function\$;/i)?.[0] ?? "";
const vesselIsMarketLive = stage1.match(/create or replace function market_private\.vessel_is_market_live[\s\S]*?\$function\$;/i)?.[0] ?? "";
const listMarketMatches = stage1.match(/create or replace function public\.list_market_matches[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(discoveryFresh.length > 0 &&
   !/fn_is_admin|fn_market_owns_listing|listing_ownership/i.test(discoveryFresh) &&
   /market_private\.discovery_fresh_ok\(c\.refreshed_at, c\.laycan_to\)/i.test(cargoIsMarketLive) &&
   /market_private\.discovery_fresh_ok\(a\.refreshed_at, a\.open_date\)/i.test(vesselIsMarketLive),
   "strict discovery freshness has no owner/admin bypass and governs both listing kinds");
ok(all(listMarketMatches, [
  /not market_private\.cargo_is_market_live\(h\.listing_id\)/i,
  /not market_private\.vessel_is_market_live\(h\.listing_id\)/i,
  /MARKET_NOT_FOUND: listing is no longer available/i,
]), "match enumeration re-checks strict source liveness after resolving a handle");

console.log("4 · legacy and side-channel closure");
for (const index of [
  "market_cargo_board_scan_idx",
  "market_vessel_board_scan_idx",
  "market_matches_vessel_cargo_idx",
  "market_sync_cargo_poster_idx",
  "market_vrq_availability_poster_idx",
]) {
  ok(stage1.includes(`create index ${index}`), `${index} supports governed bulk reads`);
}
const metadataBulk = stage1.match(/create or replace function market_private\.market_listing_metadata[\s\S]*?\$function\$;/i)?.[0] ?? "";
const countBulk = stage1.match(/create or replace function market_private\.market_match_counts[\s\S]*?\$function\$;/i)?.[0] ?? "";
const cargoRenderer = stage1.match(/create or replace function market_private\.render_cargo_payload[\s\S]*?\$function\$;/i)?.[0] ?? "";
const vesselRenderer = stage1.match(/create or replace function market_private\.render_vessel_payload[\s\S]*?\$function\$;/i)?.[0] ?? "";
for (const [name, signature] of [
  ["request context", "market_request_context\\(uuid, date, date\\)"],
  ["bulk metadata", "market_listing_metadata\\([\\s\\n]*uuid, text, uuid\\[\\], boolean[\\s\\n]*\\)"],
  ["bulk counts", "market_match_counts\\([\\s\\n]*text, uuid\\[\\], timestamptz, boolean, date, date[\\s\\n]*\\)"],
] as const) {
  ok(new RegExp(`revoke all on function market_private\\.${signature}[\\s\\S]{0,80}from public, anon, authenticated, service_role`, "i").test(stage1),
    `${name} helper is private to governed RPCs`);
}
ok(all(metadataBulk, [
  /unnest\(p_listing_ids\)/i,
  /o\.owner_org_id is null and o\.owner_user_id = p_actor/i,
  /am\.org_id = o\.owner_org_id[\s\S]*am\.user_id = p_actor[\s\S]*am\.is_current[\s\S]*am\.status = 'active'/i,
  /sync_staged_row/i,
  /vessel_review_queue/i,
  /vessel_management as materialized/i,
  /'owner_org_imo'/i,
  /'manager_org_desk'/i,
]), "ownership and poster metadata resolve once for the response id set");
ok(all(countBulk, [
  /live_vessels as materialized/i,
  /live_cargo as materialized/i,
  /group by e\.cargo_id/i,
  /group by e\.vessel_avail_id/i,
]) && !/cargo_is_market_live|vessel_is_market_live/i.test(countBulk),
  "match badges group over set-based live counterparts without per-edge liveness calls");
for (const [name, renderer] of [["cargo", cargoRenderer], ["vessel", vesselRenderer]] as const) {
  const executable = uncomment(renderer);
  ok(renderer.length > 0 && !/\bselect\b|\bfrom\s+public\./i.test(executable) &&
     !/fn_market_|market_match_counts|market_listing_metadata/i.test(executable),
     `${name} bulk renderer is query-free`);
}
const listCargo = stage1.match(/create or replace function public\.list_market_cargo[\s\S]*?\$function\$;/i)?.[0] ?? "";
const listVessels = stage1.match(/create or replace function public\.list_market_vessels[\s\S]*?\$function\$;/i)?.[0] ?? "";
for (const [name, body, renderer] of [
  ["cargo board", listCargo, "render_cargo_payload"],
  ["vessel board", listVessels, "render_vessel_payload"],
] as const) {
  ok(all(body, [
    "market_request_context",
    "market_listing_metadata",
    "market_match_counts",
    renderer,
  ]) && !/payload_preissued|(?:cargo|vessel)_is_market_live|active_window_cutoff|vessel_ownership/i.test(body),
  `${name} uses request-scoped set-based assembly`);
}
ok(all(listCargo, [
  /c\.review_status = 'APPROVED'/i,
  /c\.status in \('IN', 'PARTIAL'\)/i,
  /order by c\.created_at desc, c\.id[\s\S]*limit 1000/i,
  /jsonb_agg\(x\.payload order by x\.created_at desc, x\.id\)/i,
]) && !/c\.(?:review_status|status)::text/.test(listCargo),
  "cargo board predicate matches its partial index and has a stable id tie-breaker");
ok(all(listVessels, [
  /a\.review_status = 'APPROVED'/i,
  /a\.status = 'OPEN'/i,
  /order by a\.open_date nulls last, a\.created_at desc, a\.id[\s\S]*limit 500/i,
  /x\.open_date nulls last, x\.created_at desc, x\.id/i,
]) && !/a\.(?:review_status|status)::text/.test(listVessels),
  "vessel board predicate matches its partial index and has a stable id tie-breaker");
ok(occurrences(listMarketMatches, /limit\s+500/gi) === 2 &&
   occurrences(listMarketMatches, /market_private\.market_listing_metadata\(/gi) === 2 &&
   occurrences(listMarketMatches, /market_private\.market_match_counts\(/gi) === 2 &&
   /x\.rate_aligned desc, x\.dwt_delta, x\.availability_id/i.test(listMarketMatches) &&
   /x\.rate_aligned desc, x\.dwt_delta, x\.cargo_id/i.test(listMarketMatches) &&
   !/payload_preissued|vessel_ownership/i.test(listMarketMatches),
  "both match directions are deterministically capped at 500 and use bulk metadata/count rendering");
ok(all(perfTest, [
  /current_database\(\) not like '%market_perf%'/i,
  /generate_series\(1, 200\)/i,
  /cross join mp_perf_vessel/i,
  /cargo_board_200[\s\S]*750/i,
  /vessel_board_200[\s\S]*750/i,
  /cargo_matches_200[\s\S]*900/i,
  /listing_detail[\s\S]*150/i,
  /primary key \(endpoint, run_no\)/i,
  /array_agg\(endpoint order by endpoint\)[\s\S]*endpoint set is incomplete or unexpected/i,
  /r\.sample_count <> 5/i,
  /r\.min_returned <> v_expected[\s\S]*r\.max_returned <> v_expected/i,
  /r\.min_tagged <> v_expected[\s\S]*r\.max_tagged <> v_expected/i,
  /case when v_detail is null then 0 else 1 end/i,
  /^rollback;$/im,
]), "disposable 200x200/40k-edge benchmark pins endpoints, five samples, exact row counts and latency gates");

ok(all(stage2, [
  /create policy "cl: governed owner read"[\s\S]*fn_market_owns_listing\('cargo', id\)/i,
  /create policy "va: governed owner read"[\s\S]*fn_market_owns_listing\('vessel_availability', id\)/i,
  "revoke all on table public.cargo_listings from public, anon, authenticated",
  "revoke all on table public.vessel_availability from public, anon, authenticated",
]), "raw cargo/availability reads are exact owner/admin management paths");
ok(all(stage2, [
  /create policy "vessels: named registry read"[\s\S]*not coalesce\(is_tbn, false\)/i,
  /create policy "vessels: governed tbn owner read"[\s\S]*fn_market_owns_listing\('vessel_availability', va\.id\)/i,
]), "registry remains useful for named hulls while TBN rows require ownership/admin");
ok(all(stage2, [
  "revoke all on table public.vessel_contact_history from public, anon, authenticated",
  /create policy "vch: governed admin all"[\s\S]*for all to authenticated[\s\S]*fn_is_admin\(\)/i,
  "revoke all on table public.matches from public, anon, authenticated",
]), "contact history and match cache are not member feeds");
const legacyAvailabilityWrapper = stage2.match(/create or replace function public\.create_vessel_availability[\s\S]*?\$function\$;/i)?.[0] ?? "";
const legacyPositionWrapper = stage2.match(/create or replace function public\.create_vessel_position[\s\S]*?\$function\$;/i)?.[0] ?? "";
const existingVesselPostLock = stage2.match(/create or replace function market_private\.lock_existing_vessel_for_post[\s\S]*?\$function\$;/i)?.[0] ?? "";
const vesselImoGuard = stage2.match(/create or replace function market_private\.guard_vessel_imo_identity[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(all(stage2, [
  /alter function public\.create_vessel_availability\(jsonb\)[\s\S]*set schema market_private/i,
  /alter function public\.create_vessel_position\(jsonb\)[\s\S]*set schema market_private/i,
  /revoke all on function market_private\.create_vessel_availability\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/i,
  /revoke all on function market_private\.create_vessel_position\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/i,
]), "legacy vessel-post bodies are private and directly uncallable");
ok(all(legacyAvailabilityWrapper, [
  "market_private.lock_vessel_post_actor()",
  "market_private.lock_existing_vessel_for_post",
  "market_private.create_vessel_availability(payload)",
]) && all(legacyPositionWrapper, [
  "market_private.lock_vessel_post_actor()",
  /v_mode not in \('fleet', 'new', 'tbn'\)[\s\S]*MARKET_VALIDATION/i,
  /v_mode <> 'fleet'[\s\S]*payload->>'vessel_id'[\s\S]*MARKET_VALIDATION/i,
  /v_imo is null or not public\.fn_imo_check_digit\(v_imo\)[\s\S]*MARKET_VALIDATION/i,
  /v_mode\s*=\s*'fleet'/i,
  "market_private.lock_existing_vessel_for_post",
  "market_private.create_vessel_position(payload)",
]), "public legacy vessel-post signatures authorize before calling unchanged private cores");
for (const fn of ["create_vessel_availability(jsonb)", "create_vessel_position(jsonb)"]) {
  const words = fn.replace(/[(),.]/g, " ").trim().split(/\s+/).join("[\\s\\n,().]*");
  ok(new RegExp(`revoke all on function public\\.${words}[\\s\\S]{0,100}from public, anon, authenticated, service_role`, "i").test(stage2) &&
     new RegExp(`grant execute on function public\\.${words}[\\s\\S]{0,60}to authenticated, service_role`, "i").test(stage2),
     `${fn} exposes only the guarded authenticated/service facade`);
}
ok(all(existingVesselPostLock, [
  /from public\.vessels v[\s\S]*for update of v/i,
  /from public\.vessel_claims vc[\s\S]*vc\.user_id = p_auth_id[\s\S]*order by vc\.id[\s\S]*for share of vc/i,
  /from public\.vessel_availability a[\s\S]*order by a\.id[\s\S]*for share of a/i,
  /lo\.role::text = 'primary'[\s\S]*lo\.is_current[\s\S]*lo\.owned_until[\s\S]*order by lo\.listing_id, lo\.id[\s\S]*for share of lo/i,
  /om\.user_id = p_actor[\s\S]*order by om\.org_id, om\.user_id[\s\S]*for share of om[\s\S]*r\.is_current and r\.status = 'active'/i,
]), "existing-vessel authorization is exact and held by deterministic row locks through commit");
ok(all(legacyPositionWrapper, [
  "pg_catalog.pg_advisory_xact_lock",
  "pg_catalog.hashtextextended('market:vessel-imo:' || v_imo, 0)",
  /where pg_catalog\.btrim\(v\.imo_number\) = v_imo[\s\S]*order by v\.id[\s\S]*for update of v/i,
  /cardinality\(v_imo_vessel_ids\) > 1[\s\S]*MARKET_VALIDATION: duplicate registry rows/i,
  /v_imo_noncanonical[\s\S]*MARKET_VALIDATION: registry IMO % must be canonicalized/i,
]) && all(vesselImoGuard, [
  "new.imo_number := v_imo",
  "pg_catalog.pg_advisory_xact_lock",
  "pg_catalog.hashtextextended('market:vessel-imo:' || v_imo, 0)",
  /where pg_catalog\.btrim\(v\.imo_number\) = v_imo[\s\S]*v\.id is distinct from new\.id/i,
  /errcode = '23505'[\s\S]*constraint = 'vessels_imo_identity_guard'/i,
]) && all(stage2, [
  /create trigger trg_vessels_imo_identity_guard[\s\S]*before insert or update of imo_number on public\.vessels/i,
  /revoke all on function market_private\.guard_vessel_imo_identity\(\)[\s\S]*from public, anon, authenticated, service_role/i,
]), "new-mode IMO resolution serializes register_vessel, direct writers, and peer position creators");
for (const view of [
  "v_live_cargo",
  "v_live_vessels",
  "v_cargo_match_counts",
  "v_vessel_match_counts",
  "v_vessel_detail",
  "v_admin_queue",
  "v_eligible_matches",
]) {
  ok(stage2.includes(`'${view}'`), `${view} is in the legacy-view closure list`);
}
for (const fn of [
  "get_matches_for_cargo(uuid)",
  "get_matches_for_availability(uuid)",
  "get_listing_posters(text, uuid[])",
  "count_live_matches(text, uuid[])",
]) {
  ok(stage2.includes(`revoke all on function public.${fn}`) && stage2.includes(`grant execute on function public.${fn} to service_role`), `${fn} is service-only`);
}
ok(stage2.includes("v_vessel_flag_issues") &&
   /revoke all on table public\.%I from public, anon, authenticated/i.test(stage2),
   "v_vessel_flag_issues cannot expose vessel id/name/IMO to an ordinary member");
ok(all(stage2, [
  "create or replace function public.count_admin_vessel_flag_issues()",
  /public\.fn_is_admin\(\)[\s\S]*auth\.role\(\) = 'service_role'/i,
  /grant execute on function public\.count_admin_vessel_flag_issues\(\)[\s\S]*to authenticated, service_role/i,
  /grant select on table public\.%I to service_role/i,
]), "admin gets a count-only flag RPC and service retains the raw maintenance view");
ok(all(stage2, [
  "fn_refresh_matches()",
  "fn_refresh_matches_for_cargo(uuid)",
  "fn_refresh_matches_for_availability(uuid)",
]), "all known raw match refresh commands are closed dynamically");
ok(all(legacyRelationAclSnapshot, [
  /from pg_catalog\.pg_class c[\s\S]*pg_catalog\.aclexplode\(c\.relacl\)/i,
  /c\.relacl is not null/i,
  /coalesce\(grantee_role\.rolname, 'PUBLIC'\) = any/i,
  "v_live_cargo", "v_live_vessels", "v_vessel_flag_issues",
]) && all(restoreLegacyRelationAcl, [
  /where grantee = any \(array\['PUBLIC', 'anon', 'authenticated', 'service_role'\]\)/i,
  /set local role %I/i,
  /when r\.is_grantable then ' with grant option'/i,
  /grant %s on table public\.%I to %s%s/i,
]) && /grantor\s+text\s+not\s+null/i.test(stage2),
  "legacy view ACL snapshot restores exact privileges including grant option");
ok(all(legacyColumnAclSnapshot, [
  "cargo_listings", "vessel_availability", "listing_ownership",
  "vessels", "vessel_claims", "vessel_contact_history", "matches",
  /from pg_catalog\.pg_attribute a[\s\S]*pg_catalog\.aclexplode\(a\.attacl\)/i,
  /a\.attacl is not null/i,
  /coalesce\(grantee_role\.rolname, 'PUBLIC'\) = any/i,
]) && all(stage2, [
  /revoke all \(%I\) on table public\.%I from public, anon, authenticated, service_role/i,
  /v_safe_columns constant text\[\][\s\S]*grant select \(%I\) on table public\.vessels to authenticated/i,
  /revoke all on table public\.vessels from public, anon, authenticated/i,
]) && all(restoreLegacyColumnAcl, [
  /where grantee = any \(array\['PUBLIC', 'anon', 'authenticated', 'service_role'\]\)/i,
  /grant %s \(%I\) on table public\.%I to %s%s/i,
]) && /revoke all \(%I\) on table public\.%I from public, anon, authenticated, service_role/i.test(down2),
  "closure removes column-level bypasses while preserving the authenticated vessel allow-list and restores exact base/view ACLs");
ok(all(stage2, [
  /revoke all on table public\.vessel_claims from public, anon, authenticated/i,
  /grant all on table public\.vessel_claims to service_role/i,
]) && legacyRelationAclSnapshot.includes("vessel_claims") &&
   legacyColumnAclSnapshot.includes("vessel_claims") &&
   restoreLegacyRelationAcl.includes("legacy_relation_acl_snapshot") &&
   restoreLegacyColumnAcl.includes("legacy_column_acl_snapshot"),
  "direct vessel-claim mutation is closed and its exact ACL state participates in rollback");
const vesselRegistryGrant = stage2.match(/do \$grant_named_vessel_registry\$[\s\S]*?\$grant_named_vessel_registry\$;/i)?.[0] ?? "";
ok(all(vesselRegistryGrant, [
  "vessel_name", "imo_number", "dwt_grain", "risk_level",
  "vessel_review_status", "source_tag",
]) && !/['"](?:owner_company|manager_company|registered_owner|technical_operator|email_chartering|commercial_manager_email|owner_address|notes|risk_notes|trading_zone_raw|created_at|updated_at)['"]/i.test(vesselRegistryGrant),
  "named-vessel column allow-list includes required UI fields and excludes PII, narrative and unused metadata");
ok(all(stage2, [
  "legacy_relation_acl_preflight",
  "delegated relation ACL grant",
  "migration executor cannot assume ACL grantor",
  "legacy_routine_acl_preflight",
  "delegated routine ACL grant",
  "migration executor cannot assume routine ACL grantor",
]), "Stage-2 refuses delegated or non-restorable ACL state before closure");
ok(all(stage2, [
  "market_private.legacy_policy_snapshot",
  /unnest\(p\.polroles\) with ordinality/i,
  "drop_legacy_market_policies",
]) && all(down2, [
  "market_private.legacy_policy_snapshot",
  "restore_legacy_market_policies",
  /unnest\(r\.role_names\) with ordinality/i,
  /create policy %I on public\.%I as %s for %s to %s/i,
  "drop table market_private.legacy_policy_snapshot",
]), "Stage-2 snapshots, replaces and exactly restores deployment-specific policies");
ok(all(legacyRoutineAclSnapshot, [
  /coalesce\(grantor_role\.rolname, pg_catalog\.pg_get_userbyid\(p\.proowner\)\)/i,
  /pg_catalog\.aclexplode\([\s\S]*pg_catalog\.acldefault\('f', p\.proowner\)/i,
  /pg_catalog\.oidvectortypes\(p\.proargtypes\)/i,
  /coalesce\(grantee_role\.rolname, 'PUBLIC'\)/i,
  /coalesce\(grantee_role\.rolname, 'PUBLIC'\) = any/i,
  "public.create_vessel_availability(jsonb)",
  "public.create_vessel_position(jsonb)",
  "public.fn_refresh_matches_for_availability(uuid)",
]) && all(restoreLegacyRoutineAcl, [
  /where grantee = any \(array\['PUBLIC', 'anon', 'authenticated', 'service_role'\]\)/i,
  /routine ACL grantor % no longer exists/i,
  /grant %s on function %s to %s%s/i,
]) && occurrences(restoreLegacyRoutineAcl, /when r\.is_grantable then ' with grant option'/gi) >= 1,
   "legacy routine ACL snapshot uses canonical signatures and restores grantor, PUBLIC/named grantees and grant options exactly");
ok(all(harness, [
  /pg_catalog\.oidvectortypes\(p\.proargtypes\)/i,
  "public.get_matches_for_cargo(uuid)",
  "public.create_vessel_availability(jsonb)",
  "public.create_vessel_position(jsonb)",
  "public.fn_refresh_matches_for_availability(uuid)",
]), "market lifecycle fingerprint selects named routines by canonical type-only signature");
ok(!/comment\s+on\s+schema\s+market_private/i.test(stage2),
  "Stage 2 does not mutate the Stage-1 private-schema comment");
const cargoUpdateGrant = stage2.match(/grant\s+update\s*\(([^()]*)\)\s+on\s+table\s+public\.cargo_listings\s+to\s+authenticated/i)?.[1] ?? "";
const vesselUpdateGrant = stage2.match(/grant\s+update\s*\(([^()]*)\)\s+on\s+table\s+public\.vessel_availability\s+to\s+authenticated/i)?.[1] ?? "";
ok(cargoUpdateGrant.length > 0 && vesselUpdateGrant.length > 0 &&
   !/\b(?:review_status|goes_live_at|status)\b/i.test(cargoUpdateGrant) &&
   !/\b(?:review_status|goes_live_at|status)\b/i.test(vesselUpdateGrant),
   "owner table grants exclude approval and workflow columns");
const cargoUpdateRevoke = down2.match(/revoke\s+update\s*\(([^()]*)\)\s+on\s+table\s+public\.cargo_listings\s+from\s+authenticated/i)?.[1] ?? "";
const vesselUpdateRevoke = down2.match(/revoke\s+update\s*\(([^()]*)\)\s+on\s+table\s+public\.vessel_availability\s+from\s+authenticated/i)?.[1] ?? "";
ok(cargoUpdateRevoke.length > 0 && vesselUpdateRevoke.length > 0 &&
   normalizedSqlList(cargoUpdateRevoke) === normalizedSqlList(cargoUpdateGrant) &&
   normalizedSqlList(vesselUpdateRevoke) === normalizedSqlList(vesselUpdateGrant),
   "Stage-2 DOWN revokes every explicit authenticated column UPDATE grant installed by UP");
ok(all(stage2, [
  "create or replace function public.fn_market_protect_listing_workflow()",
  /new\.review_status is distinct from old\.review_status/i,
  /new\.goes_live_at is distinct from old\.goes_live_at/i,
  /new\.status is distinct from old\.status/i,
  "trg_market_protect_cargo_workflow",
  "trg_market_protect_vessel_workflow",
]), "workflow trigger blocks approval/publication/status drift even after a future grant change");
ok(all(stage3, [
  /from pg_catalog\.pg_policy[\s\S]*drop policy if exists %I on public\.review_queue/i,
  /create policy "rq: governed admin all"[\s\S]*for all to authenticated[\s\S]*fn_is_admin\(\)/i,
  /revoke all on table public\.review_queue[\s\S]*from public, anon, authenticated, service_role/i,
  /v_admin_queue_detail must be security_invoker=true/i,
  "market_private.review_view_snapshot",
  /create or replace view public\.v_admin_queue_detail[\s\S]*left join lateral[\s\S]*competing\.id is distinct from candidate\.id/i,
]), "moderation ledger and admin join view are RLS-governed administrator surfaces");
const reviewStatusFn = stage3.match(/create or replace function public\.list_my_review_statuses[\s\S]*?\$function\$;/i)?.[0] ?? "";
const reviewStatusExecutable = uncomment(reviewStatusFn);
const reviewStatusReturns = reviewStatusExecutable.match(/returns table\s*\(([\s\S]*?)\)\s*language/i)?.[1] ?? "";
ok(all(reviewStatusFn, [
  "public.fn_market_actor()",
  /v_auth_key_safe[\s\S]*u\.id = v_auth_id[\s\S]*u\.id is distinct from v_actor/i,
  /rq\.submitted_by = v_actor[\s\S]*v_auth_key_safe and rq\.submitted_by = v_auth_id/i,
  /least\(greatest\(coalesce\(p_limit, 100\), 1\), 200\)/i,
  /select rq\.listing_type, rq\.status, rq\.action_taken,[\s\S]*rq\.submitted_at, rq\.reviewed_at/i,
]) && !/\bid\s+uuid\b/i.test(reviewStatusReturns) &&
   !/rq\.(?:listing_id|review_reason|admin_note|amendment_detail|trust_tier_at_submit|is_random_sample|reviewed_by)\b/i.test(reviewStatusExecutable),
  "member review history is bounded, dual-keyed and excludes raw ids and moderation internals");
ok(all(reviewRelationAclSnapshot, [
  /from pg_catalog\.pg_class c[\s\S]*pg_catalog\.aclexplode\(c\.relacl\)/i,
  /c\.relacl is not null/i,
  /coalesce\(grantee_role\.rolname, 'PUBLIC'\) = any/i,
]) && all(reviewColumnAclSnapshot, [
  /from pg_catalog\.pg_attribute a[\s\S]*pg_catalog\.aclexplode\(a\.attacl\)/i,
  /a\.attacl is not null/i,
  /coalesce\(grantee_role\.rolname, 'PUBLIC'\) = any/i,
]) && all(stage3, [
  /revoke all \(%I\) on table public\.%I from public, anon, authenticated, service_role/i,
]) && stage3.includes("market_private.review_policy_snapshot"),
  "review closure snapshots targeted relation, column and policy state and clears column-level bypasses");
ok(all(stage3, [
  "review_acl_preflight",
  "delegated review ACL grant",
  "migration executor cannot assume review ACL grantor",
  /unnest\(p\.polroles\) with ordinality/i,
]) && /unnest\(r\.role_names\) with ordinality/i.test(down3),
  "Stage-3 refuses non-restorable ACLs and preserves policy role ordinality");
const positionCheckin = stage1.match(/create or replace function public\.fn_position_checkin[\s\S]*?\$function\$;/i)?.[0] ?? "";
const ownsCargo = stage1.match(/create or replace function public\.fn_owns_cargo[\s\S]*?\$function\$;/i)?.[0] ?? "";
const ownsVessel = stage1.match(/create or replace function public\.fn_owns_vessel[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(all(positionCheckin, ["fn_market_owns_listing", "'vessel_availability'", "p_availability_id"]) &&
   all(ownsCargo, ["fn_market_owns_listing", "'cargo'", "p_cargo_id"]) &&
   all(ownsVessel, ["fn_market_owns_listing", "'vessel_availability'", "a.id"]),
   "position check-in and legacy ownership helpers use exact market ownership");
const managedVessel = stage1.match(/create or replace function public\.get_managed_vessel[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(all(managedVessel, ["fn_market_owns_listing", "'vessel_availability'", "a.id", "MARKET_NOT_FOUND: managed vessel was not found"]) &&
   /grant execute on function public\.get_managed_vessel\(uuid\) to authenticated/i.test(stage1),
   "raw managed vessel lookup is an exact owner/admin RPC");
const vesselStatusCommand = stage1.match(/create or replace function public\.set_market_vessel_availability_status[\s\S]*?\$function\$;/i)?.[0] ?? "";
ok(all(vesselStatusCommand, [
  "fn_market_owns_listing", "'vessel_availability'", "MARKET_NOT_FOUND",
  /OPEN'[\s\S]*'ON SUBS', 'FIXED', 'INACTIVE'/,
  /ON SUBS'[\s\S]*'OPEN', 'FIXED', 'INACTIVE'/,
  /v_position\.status = p_status[\s\S]*return to_jsonb\(v_position\)/i,
]) && !/set\s+(?:review_status|goes_live_at)/i.test(vesselStatusCommand) &&
   /grant execute on function public\.set_market_vessel_availability_status\([\s\S]*?\) to authenticated/i.test(stage1),
   "exact-owner vessel lifecycle command has a closed transition graph and cannot self-approve");

console.log("5 · application cut-over");
const sdk = read("sdk/app/market.ts");
for (const fn of ["list_market_cargo", "list_market_vessels", "list_market_matches", "get_market_listing_detail"]) {
  ok(sdk.includes(`rpc("${fn}"`), `market SDK calls ${fn}`);
}
ok(all(sdk, ["listing_key: string", "owned_listing_id: string | null", "is_owned: boolean", "can_manage: boolean"]), "market SDK exposes opaque access metadata");
const adapters = read("lib/portal/adapters.ts");
ok(all(adapters, [
  /const publicId = market\?\.listing_key \?\? row\.id/g,
  /vesselId: canManage && rawVesselId \? rawVesselId : undefined/,
  /identityMasked:[\s\S]*is_tbn[\s\S]*!canManage/,
]), "portal view models use handles and guard raw vessel identity behind canManage");
const actions = uncomment(read("lib/portal/actions.ts"));
ok(all(actions, ["listMarketMatches", "getMarketListingDetail"]) && !/get_matches_for_|v_live_|v_vessel_detail/.test(actions), "portal actions use governed match/detail APIs only");
const runtimeMarketFiles = [
  "sdk/app/market.ts",
  "lib/portal/data.ts",
  "lib/portal/actions.ts",
  "components/portal/MatchesPopover.tsx",
  "components/portal/DetailPanels.tsx",
  "components/portal/MarketMap.tsx",
].map((file) => uncomment(read(file))).join("\n");
ok(!/\.from\(["'](?:matches|v_live_cargo|v_live_vessels|v_cargo_match_counts|v_vessel_match_counts|v_vessel_detail|v_vessel_flag_issues)["']\)/.test(runtimeMarketFiles), "market runtime has no direct legacy view/cache read");
ok(!/\.rpc\(["'](?:get_matches_for_cargo|get_matches_for_availability|get_listing_posters|count_live_matches|fn_refresh_matches)/.test(runtimeMarketFiles), "market runtime has no legacy raw-id RPC call");
ok(all(read("components/portal/MatchesPopover.tsx"), [
  "marketBoardKey",
  /const id = marketBoardKey\(r\)/,
]), "match UI correlates match-purpose rows through marketBoardKey");
const adminDq = uncomment(read("app/(admin)/admin/data-quality/actions.ts"));
ok(/\.rpc\(["']count_admin_vessel_flag_issues["']\)/.test(adminDq) && !/\.from\(["']v_vessel_flag_issues["']\)/.test(adminDq), "admin DQ count uses the governed count-only RPC, not the raw flag view");

console.log("6 · executable regression coverage");
for (let i = 1; i <= 27; i++) ok(sqlTest.includes(`M${i}`), `SQL suite contains M${i}`);
ok(all(sqlTest, ["u_owner", "u_seat", "u_pending", "u_ended", "u_out", "u_admin", "u_dual", "auth_dual"]), "SQL suite covers owner, seat-state, outsider, admin and dual-key identities");
ok(all(sqlTest, ["vessel_contact_history", "v_vessel_flag_issues", "service_role", "perform pg_temp.mp_anon()"]), "SQL suite proves side-channel denial plus admin/service/anon boundaries");
ok(all(sqlTest, ["mp_assert_ownership", "owner_org_imo", "manager_org_fleet", "unowned TBN detail exposed ownership"]), "SQL suite proves null outsider ownership and the owner/seat/admin allow-list");
ok(all(sqlTest, ["pda_estimates", "list_fixture_match_candidates", "create_fixture_room_from_candidate"]), "SQL suite pins PDA decoupling and optional Fixture/market key separation");
ok(all(sqlTest, [
  "board_listing_key", "purpose-mismatched", "STALE PRIVACY CARGO", "PUBLIC STALE HULL",
  "self-approval", "v_admin_queue", "v_eligible_matches", "fn_position_checkin",
  "fn_owns_cargo", "fn_owns_vessel", "mp_purge_keys", "get_managed_vessel",
]), "SQL suite covers every audit-blocker regression surface");
ok(all(sqlTest, [
  "strict discovery freshness canary",
  "stale_cargo_owner_key", "stale_cargo_admin_key",
  "stale_vessel_owner_key", "stale_vessel_admin_key",
  "array['u_cargo','u_admin']", "array['u_owner','u_admin']",
  "M24 ok: strict freshness rejects stale cargo/vessel discovery and match sources for owner and admin",
]), "SQL suite rejects otherwise-live stale discovery/match sources for exact owners and admins");
ok(all(sqlTest, [
  "mp_post_state", "OUTSIDER DIRECT AVAILABILITY", "OUTSIDER FLEET POSITION",
  "OUTSIDER EXISTING IMO POSITION", "state_after is distinct from state_before",
  "authenticated can forge or rewrite a vessel claim",
  "service availability post without actor expected MARKET_AUTH",
  "service can bypass a guarded vessel-post signature through market_private",
  "direct service duplicate IMO expected 23505",
  "ambiguous existing IMO expected MARKET_VALIDATION",
  "noncanonical existing IMO expected MARKET_VALIDATION",
  "unknown position mode expected MARKET_VALIDATION",
  "invalid new-mode IMO expected MARKET_VALIDATION",
  "non-fleet vessel_id smuggling expected MARKET_VALIDATION",
  "exact listing owner lost create_vessel_availability",
  "verified admin lost guarded vessel-post compatibility",
  "genuinely new IMO path did not create exact claim/listing ownership",
  "new TBN path did not create exact claim/listing ownership",
  "M25 ok: legacy vessel RPCs fail closed with zero-write takeover denial and retain owner/admin/new/TBN posting",
]), "SQL suite proves fail-closed zero-write denial plus owner/admin/new/TBN success for both legacy vessel RPCs");
ok(all(sqlTest, [
  "M26 ok: review ledger is admin-only and member status history is identifier-free",
  "list_my_review_statuses",
  "ordinary member read review_queue",
  "ordinary member read v_admin_queue_detail",
  "review status payload leaked a raw identifier",
  "dual-key review history expected 2 rows",
  "collided auth key must retain only the mapped cargo actor row",
  "ambiguous dual-key queue item expected exactly one view row",
  "ambiguous dual-key submitter was attributed to a guessed profile",
  "authenticated retained a private vessel registry column",
]), "SQL suite proves review-ledger denial and the bounded dual-key safe projection");
ok(all(sqlTest, [
  "M27 ok: set-based board renderers preserve the one-row payload contract",
  "cargo bulk/detail payload drift",
  "vessel bulk/detail payload drift",
  "managed vessel bulk/detail payload drift",
  "detail is distinct from item",
]), "SQL suite pins exact JSON compatibility between bulk renderers and one-row detail");
ok(all(race, ["run_pair", "issue-1.out", "issue-2.out", "rotate-1.out", "rotate-2.out", "detail-1.out", "detail-2.out"]), "two-session proof covers issue, expiry rotation and detail races");
ok(all(race, [
  /\[ "\$K1" != "\$K2" \]/,
  /\[ "\$K3" = "\$K1" \]/,
  /\[ "\$K3" != "\$K4" \]/,
  /\[ "\$N" = 1 \]/,
]), "race proof requires a single reusable/rotated active key");
ok(all(vesselRace, [
  "create_vessel_position", "'entry_mode', 'new'", "IMO=9876529",
  "GATE_ONE_WAITER", "v_waiters >= 2", "statement_timeout = '30s'",
  "kill \"$child_pid\"",
  "MARKET_AUTH:", "expected exactly one successful same-IMO creator",
  "WINNER", "LOSER", "1|1|1|1|1|0|1|0|$WINNER_NAME",
]), "two-session vessel RPC proof requires one same-IMO creator and zero loser claim/listing ownership");
ok(all(vesselRace, [
  "REGISTER_IMO=9876555", "public.register_vessel", "RACE WRAPPER HULL",
  "stale absent-read", "23505", "1|1|1|1|1|0|RACE WRAPPER HULL",
]), "two-session vessel RPC proof queues a stale register_vessel writer behind the shared IMO guard");
ok(all(browser, ["captureBrowserBoundary", "assertNoCanary", "/dashboard/vessels/browse", "/dashboard/cargo", "/dashboard/ports-da"]), "browser proof scans rendered/network boundaries across tonnage, cargo/matches and PDA");
ok(all(browser, ["exact owner and admin", "phone viewport", "MARKET_NOT_FOUND", "owned_listing_id"]), "browser proof covers privileged paths, responsive privacy and actor binding");
ok(all(browser, ["allowedOwnershipKeys", "owner_org_imo", "not.toMatch(/email|phone|address|org_id|user_id|account_id/i)"]), "browser/API proof checks the governed ownership allow-list and excludes contact ids/PII");
ok(all(browser, ["board_listing_key", "wrongPurpose", "get_managed_vessel", "stolenManagedVessel"]),
  "browser/API proof covers board correlation, purpose refusal and raw management isolation");
ok(/testMatch:\s*\/market-tbn-privacy\\?\.spec\\?\.ts\//.test(config) && config.includes("workers: 1"), "Playwright config isolates the self-seeding privacy spec");
ok(all(harness, [stage1Path.split("/").at(-1)!, stage2Path.split("/").at(-1)!, stage3Path.split("/").at(-1)!, sqlTestPath, "migration-harness.sh"]), "harness applies all three stages and executes the transactional proof");
ok(all(harness, [perfTestPath, "--performance", "*market_perf*", '$PSQL -v ON_ERROR_STOP=1 -q -f - < "$P"']),
  "harness exposes the guarded disposable performance gate without adding it to shared-DB runs");
ok(all(harness, [racePath, vesselRacePath, 'HARNESS_PSQL="$PSQL" bash "$f"']),
  "release-validation harness executes both real two-session race proofs while the module is applied");
ok(/market_private[\s\S]*listing_handles/i.test(harness), "harness checks private-schema down residue");
ok(all(harness, [
  "MARKET_FINGERPRINT_SQL", "pg_catalog.pg_attribute", "a.attacl",
  "view-acl", "routine-acl", "acl.is_grantable",
  "schema-comment", "relation-options", "p.polpermissive",
  "view-definition", "pg_catalog.pg_get_viewdef",
  "private-snapshot-relation",
  '"$MARKET_TMP/before.txt"', '"$MARKET_TMP/after.txt"',
]), "market lifecycle fingerprint covers column/view/routine ACLs, grant options, schema comments and private snapshots");

console.log("7 · rollback completeness");
for (const fn of ["get_market_listing_detail", "list_market_matches", "list_market_vessels", "list_market_cargo"]) {
  ok(down1.includes(`drop function if exists public.${fn}`), `stage-1 rollback drops ${fn}`);
}
for (const fn of [
  "list_my_cargo()",
  "list_my_vessels()",
  "get_managed_vessel(uuid)",
  "set_market_vessel_availability_status(uuid, public.vessel_status_enum)",
  "market_private.purge_listing_handles(integer)",
]) {
  ok(down1.includes(`drop function if exists ${fn.startsWith("market_private") ? fn : `public.${fn}`}`), `stage-1 rollback drops ${fn}`);
}
ok(all(down1, ["CREATE OR REPLACE FUNCTION public.fn_owns_cargo", "CREATE OR REPLACE FUNCTION public.fn_owns_vessel", "CREATE OR REPLACE FUNCTION public.fn_position_checkin"]),
  "stage-1 rollback restores replaced legacy management helpers");
for (const fn of [
  "fn_owns_cargo(uuid)",
  "fn_owns_vessel(uuid)",
  "fn_position_checkin(uuid, text, date, time without time zone, date)",
]) {
  const words = fn.replace(/[(),.]/g, " ").trim().split(/\s+/).join("[\\s\\n,().]*");
  const revoked = new RegExp(`revoke all on function public\\.${words}[\\s\\S]{0,100}from public, anon, authenticated, service_role`, "i").test(down1);
  const restored = new RegExp(`grant execute on function public\\.${words}[\\s\\S]{0,80}to anon, authenticated, service_role\\s*;`, "i").test(down1);
  const publicGrant = new RegExp(`grant execute on function public\\.${words}[\\s\\S]{0,80}to public(?:\\s*[,;])`, "i").test(down1);
  ok(revoked && restored && !publicGrant,
    `stage-1 rollback restores exact anon/authenticated/service ACL without PUBLIC for ${fn}`);
}
ok(all(down1, ["drop table if exists market_private.listing_handles", "drop schema if exists market_private"]), "stage-1 rollback removes the private handle domain");
for (const object of [
  "market_private.market_request_context",
  "market_private.market_listing_metadata",
  "market_private.market_match_counts",
  "market_private.render_cargo_payload",
  "market_private.render_vessel_payload",
  "public.market_cargo_board_scan_idx",
  "public.market_vessel_board_scan_idx",
  "public.market_matches_vessel_cargo_idx",
  "public.market_sync_cargo_poster_idx",
  "public.market_vrq_availability_poster_idx",
]) {
  ok(down1.includes(`drop ${object.startsWith("public.market_") ? "index" : "function"} if exists ${object}`),
    `stage-1 rollback removes ${object}`);
}
for (const legacy of [
  "get_matches_for_cargo", "get_matches_for_availability",
  "get_listing_posters", "count_live_matches",
  "create_vessel_availability", "create_vessel_position",
]) {
  ok(stage2.includes(legacy) && all(down2, [
    "market_private.legacy_routine_acl_snapshot",
    /grant %s on function %s to %s%s/i,
  ]), `stage-2 rollback restores snapshotted ${legacy} compatibility ACLs`);
}
ok(all(down2, [
  "drop function if exists public.create_vessel_availability(jsonb)",
  "drop function if exists public.create_vessel_position(jsonb)",
  /alter function market_private\.create_vessel_availability\(jsonb\)[\s\S]*set schema public/i,
  /alter function market_private\.create_vessel_position\(jsonb\)[\s\S]*set schema public/i,
  "drop function if exists market_private.lock_vessel_post_actor()",
  "drop function if exists market_private.lock_existing_vessel_for_post(uuid, uuid, uuid)",
  "drop trigger if exists trg_vessels_imo_identity_guard on public.vessels",
  "drop function if exists market_private.guard_vessel_imo_identity()",
]), "Stage-2 DOWN removes guarded wrappers/helpers and restores the original legacy function objects");
ok(down2.includes("v_vessel_flag_issues"), "stage-2 rollback restores the previous flag-issue view contract");
ok(down2.includes("drop function if exists public.count_admin_vessel_flag_issues()"), "stage-2 rollback removes the temporary admin flag-count RPC");
ok(all(down2, ["trg_market_protect_cargo_workflow", "trg_market_protect_vessel_workflow", "drop function if exists public.fn_market_protect_listing_workflow()"]),
  "stage-2 rollback removes workflow-protection triggers and helper");
const snapshotTables = [...stage2.matchAll(/create table if not exists market_private\.(legacy_[a-z_]+_acl_snapshot)/gi)]
  .map((match) => match[1]);
ok(snapshotTables.length >= 2 && snapshotTables.every((table) =>
  new RegExp(`drop table(?: if exists)? market_private\\.${table}\\s*;`, "i").test(down2)),
  "Stage-2 DOWN removes every private ACL snapshot table");
ok(down2.includes("drop table market_private.legacy_policy_snapshot"),
  "Stage-2 DOWN removes the private policy snapshot after exact restoration");
ok(all(down3, [
  "drop function if exists public.list_my_review_statuses(integer)",
  "market_private.review_policy_snapshot",
  "create policy %I on public.review_queue",
  "market_private.review_relation_acl_snapshot",
  "market_private.review_column_acl_snapshot",
  "market_private.review_view_snapshot",
  /grant %s \(%I\) on table public\.%I to %s%s/i,
  /create or replace view public\.v_admin_queue_detail as %s/i,
  /alter view public\.v_admin_queue_detail reset/i,
  "drop table market_private.review_policy_snapshot",
  "drop table market_private.review_view_snapshot",
]) && all(restoreReviewRelationAcl, [
  /where grantee = any \(array\['PUBLIC', 'anon', 'authenticated', 'service_role'\]\)/i,
  /grant %s on table public\.%I to %s%s/i,
]) && all(restoreReviewColumnAcl, [
  /where grantee = any \(array\['PUBLIC', 'anon', 'authenticated', 'service_role'\]\)/i,
  /grant %s \(%I\) on table public\.%I to %s%s/i,
]), "Stage-3 DOWN restores snapshotted policies plus targeted relation/column ACLs and removes its private state");
ok(!/references\s+(?:public\.)?(?:pda_estimates|fixture_rooms)/i.test(stage1), "PDA and Fixture schemas are not dependencies of the market migration");

console.log(`\nMARKET PRIVACY PURE CHECK: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
