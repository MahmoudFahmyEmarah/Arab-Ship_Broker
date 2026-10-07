/**
 * E2E · exact-id teardown and partial-seed recovery (C2O-075 P0, C2O-078 P1).
 *
 * cleanupSql() is ONE transaction that removes exactly the named e2e rows and what hangs off them:
 * - target binding: the named rows must be on THIS database (teardown) — a zero-row "success" on the wrong database
 *   is refused; a retry after a lost connection accepts only the proved replay state (all of them gone, none left);
 * - every named row must be an e2e row, and every room touched must pair e2e listings only;
 * - foreign keys stay ON (no replica mode): an unlisted dependent fails the transaction instead of dangling;
 * - exactly the six Fixture append-only guards must exist and be enabled before; they are lifted inside the
 *   transaction only, and proved enabled at its end;
 * - chains (PDA links, proposals, successor rooms; self links included) are broken inside the transaction, then
 *   removed — PDA links before the events they cite; agreed terms are reopened consistently (status with agreed_*);
 * - fixed ports are removed only when this seed created them;
 * - a residue proof ends it.
 */
import { randomBytes } from "node:crypto";
import { dbQuery, dbTx, isHostedTarget } from "./e2e-db";

export interface CleanupIds {
  userIds?: string[]; orgIds?: string[]; cargoIds?: string[]; availabilityIds?: string[]; vesselIds?: string[];
  /** ports the seed itself created (never pre-existing ones) */
  portCodes?: string[];
}
export type CleanupMode = "teardown" | "replay" | "undo";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PORT_RE = /^ZZFX[A-Z0-9]$/;
const rows = (vals: string[] | undefined, re: RegExp, cast: string) => {
  const ok = [...new Set((vals ?? []).filter(Boolean))];
  for (const v of ok) if (!re.test(v)) throw new Error(`e2e cleanup: refusing malformed value ${v}`);
  return ok.length ? `values ${ok.map((v) => `('${v}'::${cast})`).join(", ")}` : `select null::${cast} where false`;
};

export const FIXTURE_GUARDS = [
  "public.fixture_events:trg_fixture_events_immutable", "public.fixture_proposals:trg_fixture_proposals_immutable",
  "public.fixture_messages:trg_fixture_messages_immutable", "public.fixture_recap_versions:trg_fixture_recaps_immutable",
  "public.fixture_subjects:trg_fixture_subjects_immutable", "public.fixture_access_log:trg_fixture_access_log_immutable",
] as const;
const guardList = `array['${FIXTURE_GUARDS.join("','")}']`;
const guardCount = (state: string) =>
  `(select count(*) from unnest(${guardList}) g join pg_trigger t on t.tgrelid = to_regclass(split_part(g, ':', 1)) and t.tgname = split_part(g, ':', 2) and t.tgenabled ${state})`;
const guardAlter = (mode: "disable" | "enable") => `do $g$ declare g text; begin
  foreach g in array ${guardList} loop execute format('alter table %s ${mode} trigger %I', split_part(g, ':', 1), split_part(g, ':', 2)); end loop;
end $g$;`;

export function cleanupSql(ids: CleanupIds, mode: CleanupMode = "teardown"): string {
  return `
set local lock_timeout = '15s';
create temp table e2e_u (id uuid primary key) on commit drop; insert into e2e_u ${rows(ids.userIds, UUID_RE, "uuid")};
create temp table e2e_o (id uuid primary key) on commit drop; insert into e2e_o ${rows(ids.orgIds, UUID_RE, "uuid")};
create temp table e2e_c (id uuid primary key) on commit drop; insert into e2e_c ${rows(ids.cargoIds, UUID_RE, "uuid")};
create temp table e2e_a (id uuid primary key) on commit drop; insert into e2e_a ${rows(ids.availabilityIds, UUID_RE, "uuid")};
create temp table e2e_v (id uuid primary key) on commit drop; insert into e2e_v ${rows(ids.vesselIds, UUID_RE, "uuid")};
create temp table e2e_p (locode text primary key) on commit drop; insert into e2e_p ${rows(ids.portCodes, PORT_RE, "text")};
create temp table e2e_l (id uuid primary key) on commit drop; insert into e2e_l select id from e2e_c union select id from e2e_a;
do $target$
declare named int; found int;
begin
  named := (select count(*) from e2e_u) + (select count(*) from e2e_o) + (select count(*) from e2e_c) + (select count(*) from e2e_a) + (select count(*) from e2e_v);
  found := (select count(*) from auth.users where id in (select id from e2e_u)) + (select count(*) from public.organizations where id in (select id from e2e_o))
         + (select count(*) from public.cargo_listings where id in (select id from e2e_c)) + (select count(*) from public.vessel_availability where id in (select id from e2e_a))
         + (select count(*) from public.vessels where id in (select id from e2e_v));
  ${mode === "teardown" ? `if found <> named then raise exception 'E2E_TARGET: % of % named rows are on this database — wrong target or already removed', found, named; end if;`
    : mode === "replay" ? `if found <> named and found <> 0 then raise exception 'E2E_TARGET: replay found % of % named rows — neither the untouched nor the committed state', found, named; end if;`
    : `-- undo of a partial seed: any subset may exist`}
  if ${guardCount("is not null")} <> ${FIXTURE_GUARDS.length} or ${guardCount("= 'O'")} <> ${FIXTURE_GUARDS.length} then
    raise exception 'E2E_GUARD: the six Fixture append-only guards must exist and be enabled before a teardown';
  end if;
end $target$;
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
${guardAlter("disable")}
delete from public.fixture_access_log where room_id in (select id from e2e_r) or user_id in (select id from e2e_u);
-- PDA links cite events (RESTRICT) and supersede each other (self links and cycles included): the chain is broken,
-- then the links go, all before the events
do $pda$ begin
  if to_regclass('public.fixture_pda_links') is not null then
    update public.fixture_pda_links set supersedes_link_id = null where room_id in (select id from e2e_r) and supersedes_link_id is not null;
    delete from public.fixture_pda_links where room_id in (select id from e2e_r);
  end if;
end $pda$;
delete from public.fixture_events where room_id in (select id from e2e_r);
delete from public.fixture_recap_versions where room_id in (select id from e2e_r);
delete from public.fixture_messages where room_id in (select id from e2e_r);
delete from public.fixture_subjects where room_id in (select id from e2e_r);
-- an agreed term is reopened consistently (the CHECK ties status to agreed_proposal_id), then loses its proposal refs
update public.fixture_terms
   set status = case when status = 'agreed' then 'open' else status end, agreed_proposal_id = null, agreed_at = null, agreed_by_party_id = null, agreed_event_id = null,
       cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, held_by_party_id = null, held_at = null, referred_at = null, referred_by_party_id = null
 where room_id in (select id from e2e_r);
-- proposals supersede each other (RESTRICT): the chain is broken (guard lifted above), then they go
update public.fixture_proposals set supersedes_proposal_id = null where room_id in (select id from e2e_r) and supersedes_proposal_id is not null;
delete from public.fixture_proposals where room_id in (select id from e2e_r);
delete from public.fixture_terms where room_id in (select id from e2e_r);
-- parties go with their room (a room points at its creating party); a successor chain is broken first
update public.fixture_rooms set supersedes_room_id = null where id in (select id from e2e_r) and supersedes_room_id is not null;
delete from public.fixture_rooms where id in (select id from e2e_r);
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
delete from public.ports where locode in (select locode from e2e_p);
delete from public.profiles where account_id in (select id from e2e_u);
delete from public.organization_members where user_id in (select id from e2e_u) or org_id in (select id from e2e_o);
delete from public.users where id in (select id from e2e_u);
delete from auth.users where id in (select id from e2e_u);
delete from public.organizations where id in (select id from e2e_o);
${guardAlter("enable")}
do $residue$ begin
  if exists (select 1 from auth.users where id in (select id from e2e_u)) or exists (select 1 from public.users where id in (select id from e2e_u))
     or exists (select 1 from public.organizations where id in (select id from e2e_o)) or exists (select 1 from public.cargo_listings where id in (select id from e2e_c))
     or exists (select 1 from public.vessel_availability where id in (select id from e2e_a)) or exists (select 1 from public.vessels where id in (select id from e2e_v))
     or exists (select 1 from public.fixture_rooms where id in (select id from e2e_r)) or exists (select 1 from public.fixture_parties where room_id in (select id from e2e_r))
     or exists (select 1 from public.listing_ownership where listing_id in (select id from e2e_l)) or exists (select 1 from public.ports where locode in (select locode from e2e_p)) then
    raise exception 'E2E_RESIDUE: a named row survived the teardown';
  end if;
  if ${guardCount("= 'O'")} <> ${FIXTURE_GUARDS.length} then raise exception 'E2E_GUARD: a Fixture guard is not enabled at the end of the teardown'; end if;
end $residue$;
`;
}

/** The teardown of named rows: a first attempt requires them all present; a retry accepts only the proved replay. */
export function teardownRows(label: string, ids: CleanupIds): void {
  dbTx(label, (attempt) => cleanupSql(ids, attempt === 1 ? "teardown" : "replay"));
}

/**
 * Runs every teardown step even when an earlier one fails. On a hosted target a failure is an error carrying every
 * message (residue there is never acceptable); on the local stack it is a warning.
 */
export function teardownAll(label: string, steps: (() => void)[]): void {
  const errors: unknown[] = [];
  for (const step of steps) { try { step(); } catch (e) { errors.push(e); } }
  if (!errors.length) return;
  const msg = `${label}: ${errors.map((e) => (e as Error).message).join(" | ")}`;
  if (isHostedTarget()) throw new AggregateError(errors, msg);
  console.warn(`[e2e] ${msg}`);
}

// ── partial seeds ─────────────────────────────────────────────────────────────
export interface Created extends Required<CleanupIds> {
  /** intended emails, recorded BEFORE each createUser so an ambiguous response can be reconciled */
  emails: string[];
}
export const noneCreated = (): Created => ({ userIds: [], orgIds: [], cargoIds: [], availabilityIds: [], vesselIds: [], portCodes: [], emails: [] });

type Res = { error: { message: string } | null };
/** the Auth admin and table surface recovery needs (a SupabaseClient satisfies it; tests pass fakes) */
export interface RecoveryClient {
  auth: { admin: {
    updateUserById(id: string, attrs: Record<string, unknown>): PromiseLike<Res>;
    getUserById(id: string): PromiseLike<{ data: { user: { banned_until?: string | null } | null }; error: { message: string; status?: number } | null }>;
  } };
  from(table: string): { update(v: Record<string, unknown>): { eq(col: string, v: string): PromiseLike<Res> } };
}
export interface RecoveryDeps { tx: (label: string, sql: string) => void; query: (sql: string) => string[] }
const realDeps: RecoveryDeps = { tx: dbTx, query: dbQuery };

const sqlText = (vals: string[]) => vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
const E2E_EMAIL = /^e2e-[a-z0-9-]+@arabshipbroker\.test$/;

/**
 * A seed that failed part-way. (1) Reconcile: an intended email whose createUser response was lost or failed is
 * looked up on the bound database. (2) Remove every created id in one transaction. (3) If that fails, neutralise each
 * account — ban, random password, sessions and refresh tokens revoked, public row deactivated — checking every
 * response and re-reading the account. The error says exactly which ids/emails were removed, neutralised, or remain
 * UNRESOLVED; it never claims success it did not verify.
 */
export async function undoPartialSeed(admin: RecoveryClient, created: Created, cause: unknown, deps: RecoveryDeps = realDeps): Promise<never> {
  const why = (cause as Error)?.message ?? String(cause);
  const notes: string[] = [];
  // 1 · reconcile intended emails (a lost or failed createUser response may still have created the account)
  const pending = created.emails.filter((e) => E2E_EMAIL.test(e));
  let reconciled = true;
  if (pending.length) {
    try {
      for (const line of deps.query(`select id, email from auth.users where email in (${sqlText(pending)});`)) {
        const [id] = line.split("|");
        if (UUID_RE.test(id) && !created.userIds.includes(id)) { created.userIds.push(id); notes.push(`reconciled ${id}`); }
      }
    } catch (e) { reconciled = false; notes.push(`reconcile failed (${(e as Error).message})`); }
  }
  // 2 · remove every created id in one transaction
  let undoError: Error | null = null;
  try { deps.tx("e2e partial-seed undo", cleanupSql(created, "undo")); } catch (e) { undoError = e as Error; }
  if (!undoError && reconciled) {
    throw new Error(`${why} — the partial seed was removed (${created.userIds.length} account(s))${notes.length ? `; ${notes.join("; ")}` : ""}`);
  }
  // 3 · neutralise every known account; every response checked, every account re-read
  if (created.userIds.length) {
    try {
      deps.tx("e2e session revocation", `do $s$ begin
        if to_regclass('auth.refresh_tokens') is not null then delete from auth.refresh_tokens where user_id::text in (${sqlText(created.userIds)}); end if;
        if to_regclass('auth.sessions') is not null then delete from auth.sessions where user_id::text in (${sqlText(created.userIds)}); end if;
      end $s$;`);
    } catch (e) { notes.push(`session revocation failed (${(e as Error).message})`); }
  }
  const neutralised: string[] = [];
  const unresolved: string[] = [];
  for (const id of created.userIds) {
    let banned = false;
    for (let i = 0; i < 3 && !banned; i++) {
      const r = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h", password: `x-${randomBytes(24).toString("base64url")}` });
      banned = !r.error;
    }
    const deactivated = await admin.from("users").update({ is_active: false }).eq("id", id);
    const back = await admin.auth.admin.getUserById(id);
    const gone = !!back.error && (back.error.status === 404 || /not found/i.test(back.error.message));
    const bannedNow = !back.error && !!back.data.user?.banned_until && Date.parse(back.data.user.banned_until) > Date.now();
    if (gone) neutralised.push(`${id} (removed)`);
    else if (banned && bannedNow) neutralised.push(`${id} (banned${deactivated.error ? ", public row NOT deactivated" : ""})`);
    else unresolved.push(id);
  }
  // an intended email we could not look up may still be an account: never reported as handled
  if (!reconciled) unresolved.push(...pending.map((e) => `email ${e}`));
  throw new Error(`${why} — the partial seed ${undoError ? `could NOT be removed (${undoError.message})` : "rows were removed, but an intended account could not be reconciled"}; neutralised: [${neutralised.join(", ")}]; UNRESOLVED: [${unresolved.join(", ")}]${notes.length ? `; ${notes.join("; ")}` : ""}`);
}
