/**
 * Fixture Room · browser-suite seeding (Fixture Room-only file, 23 Sep 2026).
 *
 * The shared global-setup seeds ADMIN seats; a fixture needs two real MEMBER
 * seats on opposite sides. This helper creates them on the LOCAL stack only
 * (a charterer with a live cargo, an owner with a live position that the
 * platform's own match rules pair with it), signs them in through the real
 * login form, and removes everything afterwards.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/** A run against a hosted project (staging): E2E_DB_URL is set or the Supabase URL is not the local stack. */
export const HOSTED = !!process.env.E2E_DB_URL || !/127\.0\.0\.1|localhost/.test(process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321");
/**
 * A known password must never sit on a hosted account (C2O-075 P0): a hosted run gets a random password per test
 * process (Playwright creates and signs in a spec's seeds in the same worker, and a restarted worker re-seeds).
 * The local stack keeps the fixed one.
 */
export const PASSWORD = HOSTED ? `e2e-${randomBytes(18).toString("base64url")}-Aa1!` : "e2e-Fixture-Passw0rd!";

export interface FixtureSeed {
  stamp: string;
  charterer: { email: string; userId: string; orgId: string };
  owner: { email: string; userId: string; orgId: string };
  cargoId: string;
  vesselId: string;
  vesselImo: string;
  /** the named (not TBN) hull's display name, how a test finds its candidate card (no id is in the page, C2O-013) */
  vesselName: string;
  availabilityId: string;
  /** a TBN hull of the owner that also matches the cargo (C2O-011): its name and id must never reach the cargo side */
  tbn: { vesselId: string; name: string; availabilityId: string };
}

/**
 * Runs SQL as the database owner. Default: the local Supabase container. With E2E_DB_URL set (a staging
 * session-pooler string) the same statements run there through the local image's psql. The production
 * project is refused by ref, whatever the environment says.
 */
export function dbExec(sql: string): void {
  const cmd = psqlCommand("-q -v ON_ERROR_STOP=0");
  // A hosted session pooler can refuse a connection while the app under test holds its slots; psql then exits
  // non-zero before running anything (statement errors alone exit 0 here). Retry the whole batch a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      execSync(cmd, { input: sql, stdio: ["pipe", "ignore", "ignore"], env: psqlEnv() });
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt);
    }
  }
}

/**
 * The psql command for the target. A hosted connection string travels in the container's environment
 * (E2E_PGURL), never on the docker command line; the production project is refused by ref.
 */
function psqlCommand(flags: string): string {
  const remote = process.env.E2E_DB_URL;
  if (remote && /rezfejaxbmdzkslrrefr/.test(remote)) throw new Error("e2e refuses to run SQL against the production project");
  // the container's sh expands $E2E_PGURL; the host shell must not (cmd.exe ignores single quotes, and $ is not special there)
  const inner = process.platform === "win32" ? `"exec psql \\"$E2E_PGURL\\" -X ${flags}"` : `'exec psql "$E2E_PGURL" -X ${flags}'`;
  return remote
    ? `docker run --rm -i -e E2E_PGURL --entrypoint sh ${process.env.E2E_PG_IMAGE ?? "public.ecr.aws/supabase/postgres:17.6.1.127"} -c ${inner}`
    : `docker exec -i supabase_db_arab-ship-broker psql -U postgres -d postgres -X ${flags}`;
}
const psqlEnv = () => ({ ...process.env, MSYS_NO_PATHCONV: "1", E2E_PGURL: process.env.E2E_DB_URL ?? "" });

/**
 * Runs a batch as ONE transaction with ON_ERROR_STOP (psql -1): every statement commits, or none does — guards
 * lifted inside it come back on a rollback too. Errors are raised with the database's message (connection strings
 * redacted). Only a connection failure is retried: the batches given here delete exact ids and are idempotent.
 */
export function dbTx(label: string, sql: string): void {
  const cmd = psqlCommand("-q -1 -v ON_ERROR_STOP=1");
  for (let attempt = 1; ; attempt++) {
    try {
      execSync(cmd, { input: sql, stdio: ["pipe", "ignore", "pipe"], env: psqlEnv() });
      return;
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer | string };
      const msg = String(err.stderr ?? "").replace(/postgres(ql)?:\/\/\S+/g, "<db-url>").trim().slice(0, 800);
      if (err.status === 2 && attempt < 4) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt); continue; }
      throw new Error(`${label}: rolled back (psql exit ${err.status ?? "?"}) — ${msg || "no message"}`);
    }
  }
}

/** A teardown failure is an error on a hosted project (residue there is never acceptable); a warning locally. */
function reportTeardown(label: string, e: unknown): void {
  if (HOSTED) throw e;
  console.warn(`[e2e] ${label} left rows on the local stack: ${(e as Error).message}`);
}

export interface CleanupIds { userIds?: string[]; orgIds?: string[]; cargoIds?: string[]; availabilityIds?: string[]; vesselIds?: string[] }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idRows = (ids: string[] | undefined) => {
  const ok = (ids ?? []).filter(Boolean);
  for (const id of ok) if (!UUID_RE.test(id)) throw new Error(`e2e cleanup: not a uuid: ${id}`);
  return ok.length ? `values ${ok.map((id) => `('${id}'::uuid)`).join(", ")}` : "select null::uuid where false";
};
/** append-only guards the teardown lifts INSIDE its transaction (named, never all triggers; foreign keys stay enforced) */
const GUARDS = [
  "public.fixture_events:trg_fixture_events_immutable", "public.fixture_proposals:trg_fixture_proposals_immutable",
  "public.fixture_messages:trg_fixture_messages_immutable", "public.fixture_recap_versions:trg_fixture_recaps_immutable",
  "public.fixture_subjects:trg_fixture_subjects_immutable", "public.fixture_access_log:trg_fixture_access_log_immutable",
];
const guardSql = (mode: "disable" | "enable") => `do $g$ declare g text; begin
  foreach g in array array['${GUARDS.join("','")}'] loop
    if exists (select 1 from pg_trigger t where t.tgrelid = to_regclass(split_part(g, ':', 1)) and t.tgname = split_part(g, ':', 2)) then
      execute format('alter table %s ${mode} trigger %I', split_part(g, ':', 1), split_part(g, ':', 2));
    end if;
  end loop;
end $g$;`;

/**
 * One transaction that removes exactly the named e2e rows and everything that hangs off them (C2O-075 P0):
 * - refuses unless every named row is an e2e row (emails e2e-…@arabshipbroker.test, organisations "E2E …",
 *   cargo refs E2EFX-…, hulls "E2E …") and every room it touches pairs e2e listings only;
 * - foreign keys stay ON (no replica mode): a dependent row nobody listed fails the transaction instead of dangling;
 * - only the named append-only guards are lifted, inside the transaction;
 * - ends with a residue proof: any named row or handle left raises and rolls everything back.
 */
export function cleanupSql(ids: CleanupIds): string {
  return `
set local lock_timeout = '15s';
create temp table e2e_u (id uuid primary key) on commit drop; insert into e2e_u ${idRows(ids.userIds)};
create temp table e2e_o (id uuid primary key) on commit drop; insert into e2e_o ${idRows(ids.orgIds)};
create temp table e2e_c (id uuid primary key) on commit drop; insert into e2e_c ${idRows(ids.cargoIds)};
create temp table e2e_a (id uuid primary key) on commit drop; insert into e2e_a ${idRows(ids.availabilityIds)};
create temp table e2e_v (id uuid primary key) on commit drop; insert into e2e_v ${idRows(ids.vesselIds)};
create temp table e2e_l (id uuid primary key) on commit drop; insert into e2e_l select id from e2e_c union select id from e2e_a;
create temp table e2e_r (id uuid primary key) on commit drop;
insert into e2e_r select r.id from public.fixture_rooms r
 where r.cargo_listing_id in (select id from e2e_c) or r.vessel_availability_id in (select id from e2e_a)
    or r.created_by_user_id in (select id from e2e_u) or r.id in (select p.room_id from public.fixture_parties p where p.user_id in (select id from e2e_u));
do $guard$ begin
  if exists (select 1 from auth.users u join e2e_u x using (id) where u.email not like 'e2e-%@arabshipbroker.test')
     or exists (select 1 from public.users u join e2e_u x using (id) where u.email not like 'e2e-%@arabshipbroker.test') then
    raise exception 'E2E_GUARD: a named user is not an e2e account'; end if;
  if exists (select 1 from public.organizations o join e2e_o x using (id) where o.name not like 'E2E %') then raise exception 'E2E_GUARD: a named organisation is not an e2e one'; end if;
  if exists (select 1 from public.cargo_listings c join e2e_c x using (id) where c.ref not like 'E2EFX-%') then raise exception 'E2E_GUARD: a named cargo is not an e2e listing'; end if;
  if exists (select 1 from public.vessels v join e2e_v x using (id) where v.vessel_name not like 'E2E %') then raise exception 'E2E_GUARD: a named hull is not an e2e vessel'; end if;
  if exists (select 1 from public.vessel_availability a join e2e_a x using (id) join public.vessels v on v.id = a.vessel_id where v.vessel_name not like 'E2E %') then raise exception 'E2E_GUARD: a named position is not on an e2e hull'; end if;
  if exists (select 1 from public.fixture_rooms r join e2e_r x using (id)
              left join public.cargo_listings c on c.id = r.cargo_listing_id
              left join public.vessel_availability a on a.id = r.vessel_availability_id left join public.vessels v on v.id = a.vessel_id
             where coalesce(c.ref, '') not like 'E2EFX-%' or coalesce(v.vessel_name, '') not like 'E2E %') then
    raise exception 'E2E_GUARD: a room to remove pairs a non-e2e listing'; end if;
end $guard$;
${guardSql("disable")}
delete from public.fixture_access_log where room_id in (select id from e2e_r) or user_id in (select id from e2e_u);
delete from public.fixture_events where room_id in (select id from e2e_r);
delete from public.fixture_recap_versions where room_id in (select id from e2e_r);
delete from public.fixture_messages where room_id in (select id from e2e_r);
delete from public.fixture_subjects where room_id in (select id from e2e_r);
do $pda$ begin if to_regclass('public.fixture_pda_links') is not null then delete from public.fixture_pda_links where room_id in (select id from e2e_r); end if; end $pda$;
update public.fixture_terms set cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, agreed_proposal_id = null where room_id in (select id from e2e_r);
delete from public.fixture_proposals where room_id in (select id from e2e_r);
delete from public.fixture_terms where room_id in (select id from e2e_r);
-- parties go with their room (ON DELETE CASCADE): a room points at its creating party, so parties cannot go first.
-- Successor chains: remove the rooms no other remaining room points at, until none is left.
do $rooms$ declare n int; begin
  loop
    delete from public.fixture_rooms r where r.id in (select id from e2e_r)
       and not exists (select 1 from public.fixture_rooms s where s.supersedes_room_id = r.id);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
end $rooms$;
do $handles$ begin
  if to_regclass('market_private.listing_handles') is not null then
    delete from market_private.listing_handles where listing_id in (select id from e2e_l) or actor_user_id in (select id from e2e_u);
  end if;
  if to_regclass('fixture_private.match_handles') is not null then
    delete from fixture_private.match_handles where own_listing_id in (select id from e2e_l) or cargo_listing_id in (select id from e2e_c)
       or vessel_availability_id in (select id from e2e_a) or actor_user_id in (select id from e2e_u);
  end if;
end $handles$;
delete from public.listing_ownership where listing_id in (select id from e2e_l) or owner_user_id in (select id from e2e_u) or transferred_by in (select id from e2e_u);
delete from public.matches where cargo_id in (select id from e2e_c) or vessel_avail_id in (select id from e2e_a);
delete from public.vessel_availability where id in (select id from e2e_a);
delete from public.vessels where id in (select id from e2e_v);
delete from public.cargo_listings where id in (select id from e2e_c);
delete from public.profiles where account_id in (select id from e2e_u);
delete from public.organization_members where user_id in (select id from e2e_u) or org_id in (select id from e2e_o);
delete from public.users where id in (select id from e2e_u);
delete from auth.users where id in (select id from e2e_u);
delete from public.organizations where id in (select id from e2e_o);
do $residue$ begin
  if exists (select 1 from auth.users where id in (select id from e2e_u)) or exists (select 1 from public.users where id in (select id from e2e_u))
     or exists (select 1 from public.organizations where id in (select id from e2e_o)) or exists (select 1 from public.cargo_listings where id in (select id from e2e_c))
     or exists (select 1 from public.vessel_availability where id in (select id from e2e_a)) or exists (select 1 from public.vessels where id in (select id from e2e_v))
     or exists (select 1 from public.fixture_rooms where id in (select id from e2e_r)) or exists (select 1 from public.fixture_parties where room_id in (select id from e2e_r))
     or exists (select 1 from public.listing_ownership where listing_id in (select id from e2e_l)) then
    raise exception 'E2E_RESIDUE: a named row survived the teardown';
  end if;
end $residue$;
${guardSql("enable")}
`;
}

function localKeys() {
  let url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    service = out.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)?.[1];
    url = out.match(/^API_URL="?([^"\n]+)"?/m)?.[1] ?? url;
  }
  if (!service) throw new Error("no local service role key (E2E_SUPABASE_SERVICE_ROLE_KEY or `supabase status`)");
  // Remote seeding only for the staging project named in E2E_ALLOW_REMOTE (never production).
  const allowed = process.env.E2E_ALLOW_REMOTE;
  if (!/127\.0\.0\.1|localhost/.test(url) && !(allowed && url.includes(allowed) && !/rezfejaxbmdzkslrrefr/.test(url))) throw new Error(`refusing to seed members against ${url}`);
  return { url, service };
}

/**
 * A seed that fails part-way removes what it created (exact ids, one transaction). If even that fails, every
 * account it created is banned and deactivated, so no half-seeded account stays usable (C2O-075 P0).
 */
async function undoPartialSeed(admin: SupabaseClient, created: Required<CleanupIds>, cause: unknown): Promise<never> {
  const why = (cause as Error)?.message ?? String(cause);
  try {
    dbTx("e2e partial-seed undo", cleanupSql(created));
  } catch (undo) {
    for (const id of created.userIds) {
      await admin.auth.admin.updateUserById(id, { ban_duration: "876000h", password: `x-${randomBytes(24).toString("base64url")}` }).catch(() => undefined);
      await admin.from("users").update({ is_active: false }).eq("id", id).then(() => undefined, () => undefined);
    }
    throw new Error(`${why} — and the partial seed could not be removed (${(undo as Error).message}); its ${created.userIds.length} account(s) were banned and deactivated`);
  }
  throw new Error(`${why} — the partial seed was removed`);
}
const noneCreated = (): Required<CleanupIds> => ({ userIds: [], orgIds: [], cargoIds: [], availabilityIds: [], vesselIds: [] });

export async function seedFixture(): Promise<FixtureSeed> {
  const { url, service } = localKeys();
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const created = noneCreated();
  try {
    return await seedFixtureInto(admin, created);
  } catch (e) {
    return undoPartialSeed(admin, created, e);
  }
}

async function seedFixtureInto(admin: SupabaseClient, created: Required<CleanupIds>): Promise<FixtureSeed> {
  const stamp = Date.now().toString(36);
  const testImo = String(1_000_000 + (Number.parseInt(stamp, 36) % 9_000_000));
  const mk = async (email: string, role: string, company: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
    created.userIds.push(data.user.id);
    const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: `E2E ${role}`, company, role, subscription_tier: "T3", is_active: true });
    if (e2) throw new Error(`users: ${e2.message}`);
    const { data: org, error: e3 } = await admin.from("organizations").insert({ name: company, org_type: role === "cargo_owner" ? "charterer" : "owner", desk_contact_name: "Desk" }).select("id").single();
    if (e3) throw new Error(`org: ${e3.message}`);
    created.orgIds.push(org.id);
    const { error: e4 } = await admin.from("organization_members").insert({ org_id: org.id, user_id: data.user.id, member_role: "admin", is_current: true, status: "active" });
    if (e4) throw new Error(`membership: ${e4.message}`);
    // the account's profile row lets the dashboard shell show the workspace
    await admin.from("profiles").insert({ account_id: data.user.id, profile_type: role === "cargo_owner" ? "cargo" : "vessel", display_name: `E2E ${role}`, is_active: true });
    return { email, userId: data.user.id as string, orgId: org.id as string };
  };
  const charterer = await mk(`e2e-fx-ch-${stamp}@arabshipbroker.test`, "cargo_owner", `E2E Charterers ${stamp}`);
  const owner = await mk(`e2e-fx-ow-${stamp}@arabshipbroker.test`, "vessel_owner", `E2E Owners ${stamp}`);
  await admin.from("ports").upsert([
    { locode: "ZZFXA", trade_name: "Fixture Load Port", country: "Egypt", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
    { locode: "ZZFXB", trade_name: "Fixture Disch Port", country: "Turkey", zone: "E.MED", port_type: "Sea Port", is_active: true, is_verified: true },
  ], { onConflict: "locode", ignoreDuplicates: true });
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const { data: c, error: ce } = await admin.from("cargo_listings").insert({
    ref: `E2EFX-${stamp}`, status: "IN", review_status: "APPROVED", cargo_type: "Dry Bulk", commodity_name: "E2E Wheat, Bulk", is_dg_cargo: false, is_grain_cargo: true,
    qty_min_mt: 25000, qty_max_mt: 27500, load_port_locode: "ZZFXA", load_port_name: "Fixture Load Port", load_zone: "E.MED",
    disch_port_locode: "ZZFXB", disch_port_name: "Fixture Disch Port", disch_zone: "E.MED", laycan_from: d(10), laycan_to: d(20), is_spot: false, load_terms: "FIOST", freight_idea_usd_mt: 24.5,
  }).select("id").single();
  if (ce) throw new Error(`cargo: ${ce.message}`);
  created.cargoIds.push(c.id);
  await admin.from("cargo_listings").update({ status: "IN", review_status: "APPROVED" }).eq("id", c.id);
  const { data: v, error: ve } = await admin.from("vessels").insert({ vessel_name: `E2E HULL ${stamp.toUpperCase()}`, imo_number: testImo, vessel_type: "Bulk Carrier", dwt_grain: 30000, build_year: 2012, flag: "Malta", is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false }).select("id").single();
  if (ve) throw new Error(`vessel: ${ve.message}`);
  created.vesselIds.push(v.id);
  const { data: a, error: ae } = await admin.from("vessel_availability").insert({ vessel_id: v.id, open_port_locode: "ZZFXA", open_port_name: "Fixture Load Port", open_zone: "E.MED", open_date: d(5), status: "OPEN", review_status: "APPROVED", freight_idea_usd_mt: 26, accepts_part_cargo: false }).select("id").single();
  if (ae) throw new Error(`availability: ${ae.message}`);
  created.availabilityIds.push(a.id);
  await admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", a.id);
  const tbnName = `E2E SECRET HULL ${stamp.toUpperCase()}`;
  const { data: tv, error: tve } = await admin.from("vessels").insert({ vessel_name: tbnName, imo_number: null, vessel_type: "Bulk Carrier", dwt_grain: 29000, build_year: 2016, flag: "Liberia", is_geared: true, grain_certified: true, dg_certified: false, is_sanctioned: false, is_tbn: true }).select("id").single();
  if (tve) throw new Error(`tbn vessel: ${tve.message}`);
  created.vesselIds.push(tv.id);
  const { data: ta, error: tae } = await admin.from("vessel_availability").insert({ vessel_id: tv.id, open_port_locode: "ZZFXA", open_port_name: "Fixture Load Port", open_zone: "E.MED", open_date: d(7), status: "OPEN", review_status: "APPROVED", freight_idea_usd_mt: 27, accepts_part_cargo: false }).select("id").single();
  if (tae) throw new Error(`tbn availability: ${tae.message}`);
  created.availabilityIds.push(ta.id);
  await admin.from("vessel_availability").update({ status: "OPEN", review_status: "APPROVED" }).eq("id", ta.id);
  const { error: oe } = await admin.from("listing_ownership").insert([
    { listing_type: "cargo", listing_id: c.id, owner_user_id: charterer.userId, owner_org_id: charterer.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: a.id, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
    { listing_type: "vessel_availability", listing_id: ta.id, owner_user_id: owner.userId, owner_org_id: owner.orgId, role: "primary", is_current: true, transfer_reason: "initial_post" },
  ]);
  if (oe) throw new Error(`ownership: ${oe.message}`);
  return { stamp, charterer, owner, cargoId: c.id, vesselId: v.id, vesselImo: testImo, vesselName: `E2E HULL ${stamp.toUpperCase()}`, availabilityId: a.id, tbn: { vesselId: tv.id, name: tbnName, availabilityId: ta.id } };
}

/**
 * A second active seat in the charterer's organisation (re-audit C2O-011 item 3):
 * it did not post the cargo, but represents it through the organisation, so the
 * match builder must offer it. Local stack only; removed by cleanupSeat.
 */
export async function seedOrgSeat(seed: FixtureSeed): Promise<{ email: string; userId: string }> {
  const { url, service } = localKeys();
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const created = noneCreated();
  try {
    return await seedOrgSeatInto(admin, seed, created);
  } catch (e) {
    return undoPartialSeed(admin, created, e);
  }
}

async function seedOrgSeatInto(admin: SupabaseClient, seed: FixtureSeed, created: Required<CleanupIds>): Promise<{ email: string; userId: string }> {
  const email = `e2e-fx-seat-${seed.stamp}@arabshipbroker.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  created.userIds.push(data.user.id);
  const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: "E2E second seat", company: `E2E Charterers ${seed.stamp}`, role: "cargo_owner", subscription_tier: "T3", is_active: true });
  if (e2) throw new Error(`users (seat): ${e2.message}`);
  const { error: e3 } = await admin.from("organization_members").insert({ org_id: seed.charterer.orgId, user_id: data.user.id, member_role: "broker", is_current: true, status: "active" });
  if (e3) throw new Error(`seat membership: ${e3.message}`);
  const { error: e4 } = await admin.from("profiles").insert({ account_id: data.user.id, profile_type: "cargo", display_name: "E2E second seat", is_active: true });
  if (e4) throw new Error(`seat profile: ${e4.message}`);
  return { email, userId: data.user.id as string };
}

export function cleanupSeat(seat: { userId: string }) {
  try {
    dbTx("e2e seat teardown", cleanupSql({ userIds: [seat.userId] }));
  } catch (e) {
    reportTeardown("seat teardown", e);
  }
}

/**
 * The charterer opens a room on the named hull through the governed path a member has
 * (C2O-013): list the candidates, take the named hull's opaque key, create from it.
 * Members hold no EXECUTE on the raw-id create_fixture_room any more.
 */
export async function openRoomViaApi(seed: FixtureSeed, idempotencyKey: string, terms: unknown, options: Record<string, unknown>): Promise<{ roomId: string; version: number }> {
  const ch = await apiClientAs(seed.charterer.email);
  const list = await ch.rpc("list_fixture_match_candidates", { p_kind: "cargo", p_listing_id: seed.cargoId });
  if (list.error) throw new Error(`list_fixture_match_candidates: ${list.error.message}`);
  const key = (list.data as { candidateKey: string; name: string }[]).find((x) => x.name === seed.vesselName)?.candidateKey;
  if (!key) throw new Error(`the named hull ${seed.vesselName} is not a candidate`);
  const created = await ch.rpc("create_fixture_room_from_candidate", { p_candidate_key: key, p_terms: terms, p_idempotency_key: idempotencyKey, p_options: options });
  if (created.error) throw new Error(`create_fixture_room_from_candidate: ${created.error.message}`);
  const d = created.data as { data: { roomId: string }; version: number };
  return { roomId: d.data.roomId, version: d.version };
}

export interface AdminSeed { email: string; userId: string }

/**
 * A super admin whose session carries the claim the ledger's admin check reads
 * (app_metadata.role = 'admin'), set through the Auth admin API — the shared
 * global setup seeds sub-admins without it. Local stack only; removed by
 * cleanupAdmin.
 */
export async function seedAdmin(stamp: string): Promise<AdminSeed> {
  const { url, service } = localKeys();
  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
  const created = noneCreated();
  try {
    return await seedAdminInto(admin, stamp, created);
  } catch (e) {
    return undoPartialSeed(admin, created, e);
  }
}

async function seedAdminInto(admin: SupabaseClient, stamp: string, created: Required<CleanupIds>): Promise<AdminSeed> {
  const email = `e2e-fx-adm-${stamp}@arabshipbroker.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, app_metadata: { role: "admin" } });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  created.userIds.push(data.user.id);
  const { error: e2 } = await admin.from("users").insert({ id: data.user.id, supabase_user_id: data.user.id, email, full_name: "E2E Fixture Admin", company: "Arab ShipBroker", role: "admin", admin_tier: "super", subscription_tier: "T4", is_active: true });
  if (e2) throw new Error(`users (admin): ${e2.message}`);
  return { email, userId: data.user.id as string };
}

export function cleanupAdmin(a: AdminSeed) {
  try {
    dbTx("e2e admin teardown", cleanupSql({ userIds: [a.userId] }));
  } catch (e) {
    reportTeardown("admin teardown", e);
  }
}

/** A supabase-js client signed in as a seeded member, for API calls the browser is not needed for. */
export async function apiClientAs(email: string): Promise<SupabaseClient> {
  const url = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  let anon = process.env.E2E_SUPABASE_ANON_KEY;
  if (!anon) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    anon = out.match(/^ANON_KEY="?([^"\n]+)"?/m)?.[1];
  }
  if (!anon) throw new Error("no local anon key (E2E_SUPABASE_ANON_KEY or `supabase status`)");
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

export function cleanupFixture(s: FixtureSeed) {
  try {
    dbTx("e2e fixture teardown", cleanupSql({
      userIds: [s.charterer.userId, s.owner.userId], orgIds: [s.charterer.orgId, s.owner.orgId], cargoIds: [s.cargoId],
      availabilityIds: [s.availabilityId, s.tbn.availabilityId], vesselIds: [s.vesselId, s.tbn.vesselId],
    }));
  } catch (e) {
    reportTeardown("fixture teardown", e);
  }
}

/**
 * The portal shell greets a member with two overlays that intercept clicks:
 * the cookie-consent banner (first visit) and, for a vessel owner with an
 * open position, the position check-in modal. A real member answers them
 * once; so does the test. Both remember the answer for the context.
 */
export async function dismissOverlays(page: Page) {
  const cookie = page.getByRole("dialog", { name: "Cookie consent" });
  if (await cookie.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
    await cookie.getByRole("button", { name: "Accept all" }).click();
    await cookie.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }
  const checkin = page.getByRole("dialog", { name: "Vessel position check-in" });
  if (await checkin.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
    await checkin.getByRole("button", { name: "Remind me later" }).click();
    await checkin.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }
}

/** A fresh context signed in through the real login form, with the shell's overlays answered. */
export async function signInAs(browser: Browser, baseURL: string, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  // The app uses client-side routing after the auth call. Waiting for a page
  // `load` event can miss that transition even when the dashboard is already
  // rendered, so assert the observable URL instead.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 90_000 });
  // Wait for the router transition itself, not only its early URL update.
  // Starting the next navigation while the login transition is still
  // rendering can let its pending router.push win and send the test back to
  // /dashboard after it has requested a Fixture page.
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 90_000 });
  await dismissOverlays(page);
  return { context, page };
}
