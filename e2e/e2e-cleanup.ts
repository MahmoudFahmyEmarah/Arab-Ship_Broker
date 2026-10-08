/**
 * E2E · exact-id teardown and partial-seed recovery (C2O-075 P0, C2O-078 P1).
 *
 * cleanupSql() is ONE transaction that removes exactly the named e2e rows and what hangs off them:
 * - target binding: the named rows must be on THIS database (teardown) — a zero-row "success" on the wrong database
 *   is refused; a retry after a lost connection accepts only the proved replay state (all of them gone, none left);
 * - every named row must be an e2e row, and every room touched must pair e2e listings only;
 * - foreign keys stay ON (no replica mode): an unlisted dependent fails the transaction instead of dangling;
 * - exactly the six Fixture append-only guards (and, with the shared notification core, its snapshot guard) must
 *   exist and be enabled before; they are lifted inside the transaction only, and proved enabled at its end;
 * - notifications of the e2e accounts, and anyone's notifications about this run's rooms, are removed;
 * - chains (PDA links, proposals, successor rooms; self links included) are broken inside the transaction, then
 *   removed — PDA links before the events they cite; agreed terms are reopened consistently (status with agreed_*);
 * - fixed ports are removed only when this seed created them;
 * - a residue proof ends it.
 */
import { randomBytes } from "node:crypto";
import { dbQuery, dbTx, isHostedTarget } from "./e2e-db";

export interface CleanupIds {
  userIds?: string[]; orgIds?: string[]; cargoIds?: string[]; availabilityIds?: string[]; vesselIds?: string[];
  /** this run's own ports, and the stamp their names carry ("E2E Port <stamp> …"): only those are ever removed */
  portCodes?: string[];
  portStamp?: string;
}
export type CleanupMode = "teardown" | "replay" | "undo";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PORT_RE = /^ZY[A-Z0-9]{3}$/;
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
// the shared notification core's snapshot guard, when the core is installed (Wave 4): a Fixture room's events
// notify its parties and, for some events, the platform's administrators
const NTF_GUARD = "public.notifications:notifications_snapshot_guard";
const ntfGuardState = (state: string) =>
  `(select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.notifications') and t.tgname = 'notifications_snapshot_guard' and t.tgenabled ${state})`;
const guardAlter = (mode: "disable" | "enable") => `do $g$ declare g text; begin
  foreach g in array ${guardList} loop execute format('alter table %s ${mode} trigger %I', split_part(g, ':', 1), split_part(g, ':', 2)); end loop;
  if to_regclass('public.notifications') is not null then
    execute format('alter table %s ${mode} trigger %I', split_part('${NTF_GUARD}', ':', 1), split_part('${NTF_GUARD}', ':', 2));
  end if;
end $g$;`;

export function cleanupSql(ids: CleanupIds, mode: CleanupMode = "teardown"): string {
  if (ids.portCodes?.length && !/^[a-z0-9]{8,24}$/.test(ids.portStamp ?? "")) throw new Error("e2e cleanup: ports need the run's stamp");
  const portName = `E2E Port ${ids.portStamp ?? "-"} %`;
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
  if to_regclass('public.notifications') is not null and ${ntfGuardState("= 'O'")} <> 1 then
    raise exception 'E2E_GUARD: the notification snapshot guard must exist and be enabled before a teardown';
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
  if exists (select 1 from public.ports p join e2e_p x using (locode) where p.trade_name not like '${portName}') then raise exception 'E2E_GUARD: a named port is not this run''s e2e port'; end if;
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
-- notifications: the e2e accounts' own, and anyone's about this run's rooms (staff are told of some room events);
-- deliveries go with them; preferences go with the user. C2O-094 P1: every digest batch those deliveries sat in —
-- a staff member's too — is captured first; afterwards only captured batches left empty are removed, and a batch
-- that still holds a legitimate (non-run) item is kept
create temp table e2e_nb (id uuid primary key) on commit drop;
do $ntf$ begin
  if to_regclass('public.notifications') is not null then
    if to_regclass('public.notification_digest_batches') is not null then
      execute $q$insert into e2e_nb select distinct d.digest_batch_id from public.notification_deliveries d
        join public.notifications n on n.id = d.notification_id
       where d.digest_batch_id is not null
         and (n.recipient_user_id in (select id from e2e_u)
              or (n.kind like 'fixture.%' and n.payload->>'roomId' in (select id::text from e2e_r)))$q$;
      execute $q$insert into e2e_nb select b.id from public.notification_digest_batches b
       where b.recipient_user_id in (select id from e2e_u) on conflict do nothing$q$;
    end if;
    delete from public.notifications where recipient_user_id in (select id from e2e_u)
        or (kind like 'fixture.%' and payload->>'roomId' in (select id::text from e2e_r));
    if to_regclass('public.notification_digest_batches') is not null then
      execute $q$delete from public.notification_digest_batches b where b.id in (select id from e2e_nb)
         and not exists (select 1 from public.notification_deliveries d where d.digest_batch_id = b.id)$q$;
    end if;
  end if;
end $ntf$;
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
delete from public.ports where locode in (select locode from e2e_p) and trade_name like '${portName}';
delete from public.profiles where account_id in (select id from e2e_u);
delete from public.organization_members where user_id in (select id from e2e_u) or org_id in (select id from e2e_o);
delete from public.users where id in (select id from e2e_u);
delete from auth.users where id in (select id from e2e_u);
delete from public.organizations where id in (select id from e2e_o);
${guardAlter("enable")}
do $residue$ declare v_empty boolean; begin
  if exists (select 1 from auth.users where id in (select id from e2e_u)) or exists (select 1 from public.users where id in (select id from e2e_u))
     or exists (select 1 from public.organizations where id in (select id from e2e_o)) or exists (select 1 from public.cargo_listings where id in (select id from e2e_c))
     or exists (select 1 from public.vessel_availability where id in (select id from e2e_a)) or exists (select 1 from public.vessels where id in (select id from e2e_v))
     or exists (select 1 from public.fixture_rooms where id in (select id from e2e_r)) or exists (select 1 from public.fixture_parties where room_id in (select id from e2e_r))
     or exists (select 1 from public.listing_ownership where listing_id in (select id from e2e_l)) or exists (select 1 from public.ports where locode in (select locode from e2e_p)) then
    raise exception 'E2E_RESIDUE: a named row survived the teardown';
  end if;
  if ${guardCount("= 'O'")} <> ${FIXTURE_GUARDS.length} then raise exception 'E2E_GUARD: a Fixture guard is not enabled at the end of the teardown'; end if;
  if to_regclass('public.notifications') is not null and ${ntfGuardState("= 'O'")} <> 1 then raise exception 'E2E_GUARD: the notification guard is not enabled at the end of the teardown'; end if;
  -- nested: a statement naming public.notifications is planned only where the table exists (no core, no reference)
  if to_regclass('public.notifications') is not null then
    if exists (select 1 from public.notifications where recipient_user_id in (select id from e2e_u))
       or exists (select 1 from public.notifications where kind like 'fixture.%' and payload->>'roomId' in (select id::text from e2e_r)) then
      raise exception 'E2E_RESIDUE: a notification of the run survived the teardown';
    end if;
    if to_regclass('public.notification_digest_batches') is not null then
      -- (EXECUTE does not set FOUND; the answer comes back INTO a variable)
      execute $q$select exists (select 1 from public.notification_digest_batches b where b.id in (select id from e2e_nb)
         and not exists (select 1 from public.notification_deliveries d where d.digest_batch_id = b.id))$q$ into v_empty;
      if v_empty then raise exception 'E2E_RESIDUE: an affected digest batch was left empty'; end if;
    end if;
  end if;
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
export const noneCreated = (): Created => ({ userIds: [], orgIds: [], cargoIds: [], availabilityIds: [], vesselIds: [], portCodes: [], portStamp: "", emails: [] });

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
  // C2O-084 P1: an account counts as neutralised only when its sessions were revoked, it is banned (re-read) and its
  // public row is deactivated; any one of those failing leaves it UNRESOLVED (a token or an active row may still work)
  let sessionsRevoked = true;
  if (created.userIds.length) {
    try {
      deps.tx("e2e session revocation", `do $s$ begin
        if to_regclass('auth.refresh_tokens') is not null then delete from auth.refresh_tokens where user_id::text in (${sqlText(created.userIds)}); end if;
        if to_regclass('auth.sessions') is not null then delete from auth.sessions where user_id::text in (${sqlText(created.userIds)}); end if;
      end $s$;`);
    } catch (e) { sessionsRevoked = false; notes.push(`session revocation failed (${(e as Error).message})`); }
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
    // C2O-094 P1: an Auth 404 alone proves nothing about a stateless access token or the app row. Removed means both
    // containments held (sessions revoked AND the row deactivated), or the bound database proves the row absent/inactive.
    let rowState = "unknown";
    try { rowState = deps.query(`select coalesce((select is_active::text from public.users where id::text = ${sqlText([id])}), 'absent');`)[0] ?? "unknown"; }
    catch (e) { notes.push(`public row re-read failed for ${id} (${(e as Error).message})`); }
    const rowContained = rowState === "absent" || rowState === "false";
    const contained = (sessionsRevoked && !deactivated.error) || rowContained;
    if (gone && contained) neutralised.push(`${id} (removed)`);
    else if (!gone && banned && bannedNow && sessionsRevoked && (!deactivated.error || rowContained)) neutralised.push(`${id} (banned)`);
    else unresolved.push(`${id} (${[!gone && !(banned && bannedNow) && "ban not verified", gone && "auth account gone", !sessionsRevoked && "sessions not revoked", deactivated.error && !rowContained && "public row not deactivated"].filter(Boolean).join(", ")})`);
  }
  // an intended email we could not look up may still be an account: never reported as handled
  if (!reconciled) unresolved.push(...pending.map((e) => `email ${e}`));
  throw new Error(`${why} — the partial seed ${undoError ? `could NOT be removed (${undoError.message})` : "rows were removed, but an intended account could not be reconciled"}; neutralised: [${neutralised.join(", ")}]; UNRESOLVED: [${unresolved.join(", ")}]${notes.length ? `; ${notes.join("; ")}` : ""}`);
}
