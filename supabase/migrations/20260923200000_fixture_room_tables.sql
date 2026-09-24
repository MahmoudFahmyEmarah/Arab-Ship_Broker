-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · Phase 1 · tables (23 Sep 2026, architecture version 1.0)
--
-- One room pairs one cargo_listings row with one vessel_availability row and
-- keeps a server-authoritative, append-only negotiation record:
--
--   fixture_rooms            the aggregate: pairing, status, version, immutable
--                            listing snapshots, disclosure and listing-sync marks
--   fixture_parties          side (cargo | vessel | mediator) + capacity
--                            (principal | broker | viewer); participation_mode is
--                            direct (a registered organisation or member) or
--                            relayed (a contact, a known org/member without a
--                            seat, or an unresolved party anchored to the source
--                            listing); the platform party is explicit
--   fixture_terms            the term sheet copied from the TypeScript catalogue
--                            at creation; one agreed proposal per agreed term
--   fixture_proposals        immutable bids / offers; supersession by pointer
--   fixture_subjects         subjects with a responsible side; lifting the last
--                            open subject fixes the room in the same statement
--   fixture_messages         notes / nudges / acks with room, side or mediator
--                            visibility; redaction is an audited column change
--   fixture_events           the ledger: one row per command (plus the lazy
--                            observations a command makes), seq = room version
--   fixture_recap_versions   immutable recap snapshots; acknowledgements are events
--   fixture_access_log       durable audit of every admin read (not the prunable
--                            platform_events analytics stream)
--
-- The PDA link table is NOT created here: the integration range 2026092330xxxx
-- creates fixture_pda_links with a real foreign key once pda_estimates exists.
--
-- Security: every table has RLS enabled and NO grant to anon / authenticated.
-- Members read and write only through the governed RPCs in the sibling
-- migrations (20260923201000 … 20260923203000). Actor columns store
-- public.users.id obtained through fn_app_user_id(), never a raw auth uid.
--
-- Idempotent. DOWN: supabase/rollback/20260923_fixture_room_down.sql
-- ════════════════════════════════════════════════════════════════════════

create sequence if not exists public.fixture_room_ref_seq;

-- ── 1 · rooms ───────────────────────────────────────────────────────────────
create table if not exists public.fixture_rooms (
  id                        uuid primary key default gen_random_uuid(),
  ref                       text not null unique,
  cargo_listing_id          uuid not null references public.cargo_listings(id) on delete restrict,
  vessel_availability_id    uuid not null references public.vessel_availability(id) on delete restrict,
  vessel_id                 uuid not null references public.vessels(id) on delete restrict,
  status                    text not null default 'draft'
                            check (status in ('draft','invited','negotiating','on_subjects','fixed','withdrawn','failed','expired')),
  version                   integer not null default 0,
  mediation                 text not null default 'platform' check (mediation in ('platform','member')),
  created_by_user_id        uuid not null references public.users(id) on delete restrict,
  created_by_party_id       uuid,
  create_idempotency_key    text,
  cargo_snapshot            jsonb not null,
  vessel_snapshot           jsonb not null,
  snapshot_at               timestamptz not null default now(),
  snapshot_hash             text not null,
  brokerage_terms_snapshot  jsonb,
  counterparty_disclosed_at timestamptz,
  negotiation_window_ends_at timestamptz,
  fixed_on_subs_at          timestamptz,
  fixed_at                  timestamptz,
  listing_sync_target       jsonb,
  listing_sync_required_at  timestamptz,
  closed_at                 timestamptz,
  closed_reason             text check (closed_reason is null or closed_reason in ('withdrawn','failed','expired')),
  closed_note               text,
  closed_by_user_id         uuid references public.users(id) on delete restrict,
  supersedes_room_id        uuid references public.fixture_rooms(id) on delete restrict,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint fixture_rooms_fixed_ck  check ((status = 'fixed') = (fixed_at is not null)),
  constraint fixture_rooms_closed_ck check ((status in ('withdrawn','failed','expired')) = (closed_at is not null and closed_reason is not null)),
  constraint fixture_rooms_closed_reason_ck check (closed_reason is null or closed_reason = status),
  constraint fixture_rooms_version_ck check (version >= 0)
);
comment on table public.fixture_rooms is 'Fixture Room aggregate: one cargo listing paired with one vessel availability. version = seq of the last fixture_events row. Snapshots are immutable copies of the listings at creation (no contact PII).';
comment on column public.fixture_rooms.listing_sync_target is 'Set when the room enters on_subjects / fixed (or leaves them): the listing statuses the marketplace should now show, e.g. {"cargo_status":"OUT","vessel_status":"ON SUBS"}. The room never writes the listings itself (decision D4).';

create unique index if not exists fixture_rooms_active_pair_uq
  on public.fixture_rooms (cargo_listing_id, vessel_availability_id)
  where status not in ('withdrawn','failed','expired');
create unique index if not exists fixture_rooms_create_idem_uq
  on public.fixture_rooms (created_by_user_id, create_idempotency_key)
  where create_idempotency_key is not null;
create index if not exists fixture_rooms_cargo_idx   on public.fixture_rooms (cargo_listing_id);
create index if not exists fixture_rooms_vessel_idx  on public.fixture_rooms (vessel_availability_id);
create index if not exists fixture_rooms_open_idx    on public.fixture_rooms (status, updated_at desc) where status not in ('withdrawn','failed','expired');
create index if not exists fixture_rooms_creator_idx on public.fixture_rooms (created_by_user_id, created_at desc);

-- ── 2 · parties ─────────────────────────────────────────────────────────────
create table if not exists public.fixture_parties (
  id                        uuid primary key default gen_random_uuid(),
  room_id                   uuid not null references public.fixture_rooms(id) on delete cascade,
  side                      text not null check (side in ('cargo','vessel','mediator')),
  capacity                  text not null check (capacity in ('principal','broker','viewer')),
  participation_mode        text not null check (participation_mode in ('direct','relayed')),
  is_platform               boolean not null default false,
  org_id                    uuid references public.organizations(id) on delete restrict,
  user_id                   uuid references public.users(id) on delete restrict,
  contact_id                uuid references public.contacts(id) on delete restrict,
  anchor_listing_type       text check (anchor_listing_type is null or anchor_listing_type in ('cargo','vessel_availability')),
  anchor_listing_id         uuid,
  display_label             text not null,
  status                    text not null check (status in ('invited','active','declined','removed')),
  invited_by_user_id        uuid references public.users(id) on delete restrict,
  invited_at                timestamptz,
  accepted_at               timestamptz,
  declined_at               timestamptz,
  removed_at                timestamptz,
  disclosure_agreed_at      timestamptz,
  disclosure_agreed_by_user_id uuid references public.users(id) on delete restrict,
  created_at                timestamptz not null default now(),
  -- amendment A1: one normalised identity mode per party
  constraint fixture_parties_identity_ck check (
       (is_platform
        and side = 'mediator' and capacity = 'broker' and participation_mode = 'direct'
        and org_id is null and user_id is null and contact_id is null and anchor_listing_id is null)
    or (not is_platform and participation_mode = 'direct'
        and (org_id is not null or user_id is not null)
        and contact_id is null and anchor_listing_id is null)
    or (not is_platform and participation_mode = 'relayed'
        and side in ('cargo','vessel')
        and (org_id is not null or user_id is not null or contact_id is not null or anchor_listing_id is not null))
  ),
  constraint fixture_parties_anchor_ck check ((anchor_listing_type is null) = (anchor_listing_id is null)),
  constraint fixture_parties_mediator_ck check (side <> 'mediator' or capacity in ('broker','viewer'))
);
comment on table public.fixture_parties is 'Who takes part in a room. side + capacity are the commercial dimensions; participation_mode says whether the party acts itself (direct) or the mediator records its positions (relayed). display_label is the side-safe label every counterparty sees before disclosure.';

create unique index if not exists fixture_parties_org_uq       on public.fixture_parties (room_id, org_id)  where org_id is not null and status in ('invited','active');
create unique index if not exists fixture_parties_user_uq      on public.fixture_parties (room_id, user_id) where user_id is not null and status in ('invited','active');
create unique index if not exists fixture_parties_platform_uq  on public.fixture_parties (room_id) where is_platform;
create unique index if not exists fixture_parties_principal_uq on public.fixture_parties (room_id, side) where capacity = 'principal' and status in ('invited','active');
create index if not exists fixture_parties_room_idx on public.fixture_parties (room_id);
create index if not exists fixture_parties_org_idx  on public.fixture_parties (org_id)  where org_id is not null;
create index if not exists fixture_parties_user_idx on public.fixture_parties (user_id) where user_id is not null;

alter table public.fixture_rooms
  drop constraint if exists fixture_rooms_created_by_party_fk,
  add constraint fixture_rooms_created_by_party_fk foreign key (created_by_party_id) references public.fixture_parties(id) on delete restrict deferrable initially deferred;

-- ── 3 · terms and proposals ─────────────────────────────────────────────────
create table if not exists public.fixture_terms (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.fixture_rooms(id) on delete cascade,
  code                text not null,
  label               text not null,
  category            text,
  sort_order          smallint not null,
  value_kind          text not null check (value_kind in ('text','number','money_per_mt','rate_pair','date_range','port_pair')),
  unit                text,
  required            boolean not null default true,
  hint                text,
  status              text not null default 'open' check (status in ('open','countered','agreed','withdrawn')),
  cargo_proposal_id   uuid,
  vessel_proposal_id  uuid,
  last_proposal_id    uuid,
  agreed_proposal_id  uuid,
  agreed_at           timestamptz,
  agreed_by_party_id  uuid references public.fixture_parties(id) on delete restrict,
  agreed_event_id     bigint,
  reopen_count        integer not null default 0,
  held_by_party_id    uuid references public.fixture_parties(id) on delete restrict,
  held_at             timestamptz,
  referred_at         timestamptz,
  referred_by_party_id uuid references public.fixture_parties(id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fixture_terms_agreed_ck check ((status = 'agreed') = (agreed_proposal_id is not null)),
  constraint fixture_terms_code_ck  check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  unique (room_id, code),
  unique (room_id, sort_order)
);
comment on table public.fixture_terms is 'The room''s term sheet, copied from the TypeScript catalogue at creation (decision D5). status is derived by the commands: open (no live position), countered (a live proposal exists), agreed (exactly one accepted proposal), withdrawn.';

create table if not exists public.fixture_proposals (
  id                    uuid primary key default gen_random_uuid(),
  room_id               uuid not null references public.fixture_rooms(id) on delete cascade,
  term_id               uuid not null references public.fixture_terms(id) on delete cascade,
  party_id              uuid not null references public.fixture_parties(id) on delete restrict,
  recorded_by_user_id   uuid not null references public.users(id) on delete restrict,
  relayed               boolean not null default false,
  kind                  text not null check (kind in ('bid','offer')),
  value_kind            text not null check (value_kind in ('text','number','money_per_mt','rate_pair','date_range','port_pair')),
  value                 jsonb not null,
  display_value         text not null,
  comment               text,
  is_final              boolean not null default false,
  expires_at            timestamptz,
  supersedes_proposal_id uuid references public.fixture_proposals(id) on delete restrict,
  round                 integer not null,
  event_id              bigint,
  created_at            timestamptz not null default now()
);
comment on table public.fixture_proposals is 'Immutable bids (cargo side) and offers (vessel side). party_id is whose commercial position this is; recorded_by_user_id is who typed it; relayed = true when a mediator recorded it on behalf of a relayed party.';
create index if not exists fixture_proposals_term_idx on public.fixture_proposals (term_id, created_at desc);
create index if not exists fixture_proposals_room_idx on public.fixture_proposals (room_id, created_at);
create index if not exists fixture_proposals_expiry_idx on public.fixture_proposals (expires_at) where expires_at is not null;

alter table public.fixture_terms
  drop constraint if exists fixture_terms_cargo_proposal_fk,
  add constraint fixture_terms_cargo_proposal_fk  foreign key (cargo_proposal_id)  references public.fixture_proposals(id) on delete restrict,
  drop constraint if exists fixture_terms_vessel_proposal_fk,
  add constraint fixture_terms_vessel_proposal_fk foreign key (vessel_proposal_id) references public.fixture_proposals(id) on delete restrict,
  drop constraint if exists fixture_terms_last_proposal_fk,
  add constraint fixture_terms_last_proposal_fk   foreign key (last_proposal_id)   references public.fixture_proposals(id) on delete restrict,
  drop constraint if exists fixture_terms_agreed_proposal_fk,
  add constraint fixture_terms_agreed_proposal_fk foreign key (agreed_proposal_id) references public.fixture_proposals(id) on delete restrict;

-- ── 4 · subjects ────────────────────────────────────────────────────────────
create table if not exists public.fixture_subjects (
  id                    uuid primary key default gen_random_uuid(),
  room_id               uuid not null references public.fixture_rooms(id) on delete cascade,
  seq                   smallint not null,
  title                 text not null,
  description           text,
  responsible_side      text check (responsible_side is null or responsible_side in ('cargo','vessel','mediator')),
  deadline_at           timestamptz,
  extended_count        integer not null default 0,
  status                text not null default 'open' check (status in ('open','lifted','failed','withdrawn')),
  added_by_party_id     uuid references public.fixture_parties(id) on delete restrict,
  added_event_id        bigint,
  resolved_at           timestamptz,
  resolved_by_party_id  uuid references public.fixture_parties(id) on delete restrict,
  resolved_event_id     bigint,
  created_at            timestamptz not null default now(),
  constraint fixture_subjects_resolved_ck check ((status = 'open') = (resolved_at is null)),
  unique (room_id, seq)
);

-- ── 5 · messages ────────────────────────────────────────────────────────────
create table if not exists public.fixture_messages (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.fixture_rooms(id) on delete cascade,
  party_id            uuid not null references public.fixture_parties(id) on delete restrict,
  author_user_id      uuid not null references public.users(id) on delete restrict,
  kind                text not null check (kind in ('note','nudge','ack','system')),
  visibility          text not null check (visibility in ('room','side','mediator')),
  term_id             uuid references public.fixture_terms(id) on delete cascade,
  body                text not null check (length(body) between 1 and 4000),
  event_id            bigint,
  redacted_at         timestamptz,
  redacted_by_user_id uuid references public.users(id) on delete restrict,
  redacted_event_id   bigint,
  created_at          timestamptz not null default now()
);
create index if not exists fixture_messages_room_idx on public.fixture_messages (room_id, created_at);

-- ── 6 · events ──────────────────────────────────────────────────────────────
create table if not exists public.fixture_events (
  id                    bigint generated always as identity primary key,
  room_id               uuid not null references public.fixture_rooms(id) on delete cascade,
  seq                   integer not null,
  type                  text not null check (type in (
    'room.created','party.invited','party.accepted','party.declined','party.removed',
    'party.disclosure_agreed','room.counterparty_disclosed',
    'proposal.submitted','proposal.withdrawn','proposal.lapsed','proposal.accepted',
    'term.agreed','term.reopened','term.held','term.resumed','term.referred','term.referral_cleared',
    'subject.added','subject.lifted','subject.failed','subject.extended',
    'room.fixed_on_subjects','room.fixed','room.returned_to_negotiation',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','room.closed')),
  actor_user_id         uuid references public.users(id) on delete restrict,
  actor_party_id        uuid references public.fixture_parties(id) on delete restrict,
  on_behalf_of_party_id uuid references public.fixture_parties(id) on delete restrict,
  relayed               boolean not null default false,
  command               text,
  idempotency_key       text,
  request_hash          text,
  payload               jsonb not null default '{}'::jsonb,
  result                jsonb,
  created_at            timestamptz not null default now(),
  unique (room_id, seq)
);
comment on table public.fixture_events is 'Append-only ledger. seq is assigned under the room lock and equals fixture_rooms.version after the event. Every event a command writes carries the command''s idempotency_key and request_hash; the first one also carries the result, so a retried command replays its original result at the command''s final version. Payloads carry fixture ids, labels and display values only — never org / user / contact ids, emails or phones.';
create index if not exists fixture_events_idem_idx on public.fixture_events (room_id, idempotency_key) where idempotency_key is not null;
create index if not exists fixture_events_room_idx on public.fixture_events (room_id, created_at);
create index if not exists fixture_events_type_idx on public.fixture_events (type, created_at desc);

-- ── 7 · recap versions ──────────────────────────────────────────────────────
create table if not exists public.fixture_recap_versions (
  id                    uuid primary key default gen_random_uuid(),
  room_id               uuid not null references public.fixture_rooms(id) on delete cascade,
  version_no            integer not null,
  room_version          integer not null,
  content               jsonb not null,
  content_text          text not null,
  content_hash          text not null,
  published_by_party_id uuid references public.fixture_parties(id) on delete restrict,
  published_by_user_id  uuid references public.users(id) on delete restrict,
  published_at          timestamptz not null default now(),
  published_event_id    bigint,
  invalidated_at        timestamptz,
  invalidated_event_id  bigint,
  created_at            timestamptz not null default now(),
  unique (room_id, version_no)
);

-- ── 8 · admin access log ────────────────────────────────────────────────────
create table if not exists public.fixture_access_log (
  id          bigint generated always as identity primary key,
  room_id     uuid references public.fixture_rooms(id) on delete restrict,
  user_id     uuid not null references public.users(id) on delete restrict,
  is_admin    boolean not null,
  reason      text not null,
  at          timestamptz not null default now()
);
comment on table public.fixture_access_log is 'Every admin read of a room (inspection or mediation) and every admin room listing. Durable; never pruned by fn_prune_ops_tables.';
create index if not exists fixture_access_log_room_idx on public.fixture_access_log (room_id, at desc);

-- ── 9 · immutability ────────────────────────────────────────────────────────
-- One trigger for the append-only tables. TG_ARGV[0] is the comma-separated
-- list of columns that MAY change (bookkeeping such as redaction or
-- invalidation); everything else raises for every role, service_role included.
create or replace function public.fn_fixture_immutable()
 returns trigger language plpgsql set search_path to ''
as $$
declare v_allowed text[] := case when tg_nargs > 0 then string_to_array(tg_argv[0], ',') else '{}'::text[] end;
begin
  if tg_op = 'DELETE' then
    raise exception 'FX_IMMUTABLE: % rows are append-only and cannot be deleted', tg_table_name using errcode = '55000';
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'FX_IMMUTABLE: % rows are append-only (only % may change)', tg_table_name, coalesce(tg_argv[0], 'nothing') using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.fn_fixture_immutable() from public, anon, authenticated;

drop trigger if exists trg_fixture_events_immutable on public.fixture_events;
create trigger trg_fixture_events_immutable before update or delete on public.fixture_events
  for each row execute function public.fn_fixture_immutable();
drop trigger if exists trg_fixture_proposals_immutable on public.fixture_proposals;
create trigger trg_fixture_proposals_immutable before update or delete on public.fixture_proposals
  for each row execute function public.fn_fixture_immutable();
drop trigger if exists trg_fixture_messages_immutable on public.fixture_messages;
create trigger trg_fixture_messages_immutable before update or delete on public.fixture_messages
  for each row execute function public.fn_fixture_immutable('redacted_at,redacted_by_user_id,redacted_event_id');
drop trigger if exists trg_fixture_recaps_immutable on public.fixture_recap_versions;
create trigger trg_fixture_recaps_immutable before update or delete on public.fixture_recap_versions
  for each row execute function public.fn_fixture_immutable('invalidated_at,invalidated_event_id');
drop trigger if exists trg_fixture_subjects_immutable on public.fixture_subjects;
create trigger trg_fixture_subjects_immutable before update or delete on public.fixture_subjects
  for each row execute function public.fn_fixture_immutable('status,deadline_at,extended_count,resolved_at,resolved_by_party_id,resolved_event_id');
drop trigger if exists trg_fixture_access_log_immutable on public.fixture_access_log;
create trigger trg_fixture_access_log_immutable before update or delete on public.fixture_access_log
  for each row execute function public.fn_fixture_immutable();

-- ── 10 · private by default: RLS on, no member table grants ────────────────
alter table public.fixture_rooms          enable row level security;
alter table public.fixture_parties        enable row level security;
alter table public.fixture_terms          enable row level security;
alter table public.fixture_proposals      enable row level security;
alter table public.fixture_subjects       enable row level security;
alter table public.fixture_messages       enable row level security;
alter table public.fixture_events         enable row level security;
alter table public.fixture_recap_versions enable row level security;
alter table public.fixture_access_log     enable row level security;

revoke all on table public.fixture_rooms, public.fixture_parties, public.fixture_terms, public.fixture_proposals,
  public.fixture_subjects, public.fixture_messages, public.fixture_events, public.fixture_recap_versions,
  public.fixture_access_log from public, anon, authenticated;
grant all on table public.fixture_rooms, public.fixture_parties, public.fixture_terms, public.fixture_proposals,
  public.fixture_subjects, public.fixture_messages, public.fixture_events, public.fixture_recap_versions,
  public.fixture_access_log to service_role;

revoke all on sequence public.fixture_room_ref_seq, public.fixture_events_id_seq, public.fixture_access_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.fixture_room_ref_seq, public.fixture_events_id_seq, public.fixture_access_log_id_seq to service_role;
